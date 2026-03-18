# Importa Flask para crear la aplicación web/API,
# request para leer solicitudes entrantes,
# jsonify para devolver respuestas JSON,
# y Response para devolver archivos como CSV.
from flask import Flask, request, jsonify, Response

# Importa CORS para permitir peticiones desde otros dominios o puertos
# (por ejemplo, desde tu frontend HTML/JS hacia esta API).
from flask_cors import CORS

# Importa herramientas para manejo de fechas, horas, zonas horarias y diferencias de tiempo.
from datetime import datetime, timedelta, timezone

# Path facilita trabajar con rutas de archivos de forma más segura y ordenada.
from pathlib import Path

# Librería para leer y escribir JSON.
import json

# Librería para acceder a variables de entorno y otras funciones del sistema operativo.
import os

# ZoneInfo permite manejar zonas horarias reales del sistema, por ejemplo America/Costa_Rica.
from zoneinfo import ZoneInfo

# csv sirve para generar archivos CSV exportables.
import csv

# io permite crear archivos temporales en memoria, por ejemplo para generar un CSV sin guardarlo físicamente.
import io


# Crea la instancia principal de la aplicación Flask.
app = Flask(__name__)

# Habilita CORS para todas las rutas de la aplicación,
# permitiendo que tu frontend consulte esta API sin bloqueo del navegador.
CORS(app)


# Ruta del archivo donde se guardará el último dato recibido.
DATA_FILE = Path("datos_actuales.json")

# Ruta del archivo histórico en formato JSON Lines (un JSON por línea).
HIST_FILE = Path("historial.jsonl")  # JSON Lines


# -----------------------------
# Config tabla 5 días (cada 2h)
# -----------------------------

# Lista de bloques horarios que se usarán en la tabla histórica de 5 días.
# Cada bloque representa una agrupación cada 2 horas.
HORAS_2H = ["02:00","04:00","06:00","08:00","10:00","12:00","14:00","16:00","18:00","20:00","22:00","24:00"]

# Lista de abreviaturas de días de la semana en español.
# El orden corresponde a weekday(): lunes=0, martes=1, etc.
DOW_ES = ["Lun.", "Mar.", "Mié.", "Jue.", "Vie.", "Sáb.", "Dom."]


# -----------------------------
# Helpers tiempo
# -----------------------------

# Devuelve la fecha y hora actual en UTC en formato ISO 8601
# y reemplaza "+00:00" por "Z" para indicar UTC estándar.
def now_utc_iso_z():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


# Obtiene la zona horaria local definida en variable de entorno TZ.
# Si no existe, usa UTC por defecto.
def get_local_tz():
    # En Render define TZ=America/Costa_Rica
    tzname = os.environ.get("TZ", "UTC")
    try:
        # Intenta construir la zona horaria indicada.
        return ZoneInfo(tzname)
    except:
        # Si falla (por nombre inválido, por ejemplo), usa UTC.
        return ZoneInfo("UTC")


# Intenta interpretar el timestamp que venga en un diccionario item.
# Acepta distintos formatos para tener flexibilidad con los datos recibidos.
def parse_ts(item: dict):
    """
    Intenta parsear timestamp en estos formatos:
    - "YYYY-MM-DD HH:MM:SS"
    - ISO: "YYYY-MM-DDTHH:MM:SS(.micro)(Z opcional)"
    """
    # Busca primero "timestamp", si no existe usa "ts_server".
    s = item.get("timestamp") or item.get("ts_server")

    # Si no existe ninguno, devuelve None.
    if not s:
        return None

    # Convierte a string y elimina espacios extra.
    s = str(s).strip()

    # Intenta parsear formato "YYYY-MM-DD HH:MM:SS"
    try:
        if "T" not in s and len(s) >= 19 and s[10] == " ":
            return datetime.strptime(s[:19], "%Y-%m-%d %H:%M:%S")
    except:
        # Si falla, sigue intentando el siguiente formato.
        pass

    # Intenta parsear formato ISO, aceptando una "Z" al final.
    try:
        return datetime.fromisoformat(s.replace("Z", ""))
    except:
        # Si tampoco se puede interpretar, devuelve None.
        return None


# Convierte un item con timestamp a fecha/hora local según la zona configurada.
def to_local_dt(item: dict):
    # Obtiene la zona horaria local.
    tz = get_local_tz()

    # Intenta parsear el timestamp.
    dt = parse_ts(item)

    # Si no se pudo parsear, devuelve None.
    if not dt:
        return None

    # Si la fecha viene "naive" (sin zona horaria), se asume UTC y luego se convierte a local.
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=ZoneInfo("UTC")).astimezone(tz)
    else:
        # Si ya trae zona horaria, solo se convierte a local.
        dt = dt.astimezone(tz)

    return dt


# Agrupa una fecha local dentro de bloques de 2 horas.
# Por ejemplo:
# 14:35 -> 14:00
# 15:59 -> 14:00
# 00:30 -> 24:00
def bucket_hora_2h(dt_local: datetime) -> str:
    """
    Agrupa por bloque de 2 horas usando floor.
    00:00-01:59 -> 24:00 (misma fecha, por cómo está tu tabla)
    """
    # Hace división entera por 2 y multiplica por 2 para obtener el bloque inferior.
    h2 = (dt_local.hour // 2) * 2

    # Si cae entre 00:00 y 01:59, se representará como 24:00.
    if h2 == 0:
        return "24:00"

    # Devuelve la hora en formato HH:00.
    return f"{h2:02d}:00"


# -----------------------------
# Lectura eficiente JSONL
# -----------------------------

# Itera el archivo historial.jsonl línea por línea.
# Esto es útil para no cargar todo el archivo en memoria si crece mucho.
def iter_historial():
    """Itera historial.jsonl línea por línea."""
    # Si el archivo no existe, termina la función.
    if not HIST_FILE.exists():
        return

    # Abre el archivo histórico en modo lectura UTF-8.
    with HIST_FILE.open("r", encoding="utf-8") as f:
        for line in f:
            # Elimina espacios y saltos de línea.
            line = line.strip()

            # Si la línea quedó vacía, la salta.
            if not line:
                continue

            try:
                # Intenta parsear cada línea como JSON y devolverla.
                yield json.loads(line)
            except:
                # Si una línea está dañada, la ignora y sigue con la siguiente.
                continue


# -----------------------------
# Tabla 5 días (último dato de cada bloque 2h)
# -----------------------------

# Construye la estructura de datos para la tabla histórica de 5 días.
# Toma el último dato disponible dentro de cada bloque horario de 2 horas.
def build_tabla_5dias(zona: str, days: int = 5, max_lines: int = 8000):
    # Obtiene zona horaria local.
    tz = get_local_tz()

    # Obtiene la fecha actual local.
    today = datetime.now(tz).date()

    # Genera la lista de fechas a considerar, de la más antigua a la más reciente.
    fechas = [today - timedelta(days=(days - 1 - i)) for i in range(days)]  # viejo->nuevo

    # Convierte las fechas a string YYYY-MM-DD.
    fechas_str = [d.isoformat() for d in fechas]

    # Inicializa estructura de celdas vacías.
    # Cada hora tendrá una lista de longitud = days.
    celdas = {h: [None] * days for h in HORAS_2H}

    # Si no existe el histórico, devuelve la estructura vacía.
    if not HIST_FILE.exists():
        return {
            "zona": zona,
            "fechas": fechas_str,
            "dias": [f"{DOW_ES[d.weekday()]} {d.day:02d}" for d in fechas],
            "horas": HORAS_2H,
            "celdas": celdas
        }

    # Lee todas las líneas del archivo histórico.
    lines = HIST_FILE.read_text(encoding="utf-8").splitlines()

    # Si el archivo es muy grande, solo toma las últimas max_lines.
    if len(lines) > max_lines:
        lines = lines[-max_lines:]

    # Diccionario para guardar el mejor dato por (fecha, bloque 2h).
    # Valor: (dt_local, item)
    best = {}

    # Recorre cada línea del histórico.
    for ln in lines:
        if not ln.strip():
            continue

        try:
            item = json.loads(ln)
        except:
            continue

        # Filtra por zona.
        if item.get("zona", "Z1") != zona:
            continue

        # Convierte timestamp a fecha local.
        dt_local = to_local_dt(item)
        if not dt_local:
            continue

        # Obtiene fecha local en string.
        fecha_str = dt_local.date().isoformat()

        # Si la fecha no está dentro de los días requeridos, la ignora.
        if fecha_str not in fechas_str:
            continue

        # Obtiene el bucket horario de 2h.
        bucket = bucket_hora_2h(dt_local)

        # Clave única: fecha + bloque.
        key = (fecha_str, bucket)

        # Busca si ya había un dato previo en ese bloque.
        prev = best.get(key)

        # Si no había o el actual es más reciente, reemplaza.
        if (prev is None) or (dt_local > prev[0]):
            best[key] = (dt_local, item)

    # Inserta los datos seleccionados en la estructura de celdas.
    for (fecha_str, bucket), (dt_local, item) in best.items():
        # Índice del día dentro de fechas_str.
        d_index = fechas_str.index(fecha_str)

        # Obtiene temperatura y humedad.
        t = item.get("temperatura")
        h = item.get("humedad")

        # Si falta alguno, no lo usa.
        if t is None or h is None:
            continue

        # Guarda los datos de esa celda.
        celdas[bucket][d_index] = {
            "t": float(t),
            "h": float(h),
            "ts": dt_local.isoformat()
        }

    # Devuelve la estructura completa lista para el frontend.
    return {
        "zona": zona,
        "fechas": fechas_str,
        "dias": [f"{DOW_ES[d.weekday()]} {d.day:02d}" for d in fechas],
        "horas": HORAS_2H,
        "celdas": celdas
    }


# -----------------------------
# Rutas
# -----------------------------

# Ruta raíz: sirve para verificar rápidamente que la API está viva.
@app.get("/")
def home():
    return "API OK. Usa /api/datos, /api/historial, /api/historial_resumen, /api/historial_filtro, /api/historial_export y /api/historicos"


# Ruta GET para obtener el último dato actual guardado.
@app.get("/api/datos")
def get_datos():
    # Si el archivo de datos actuales existe...
    if DATA_FILE.exists():
        # Lo lee, lo convierte de texto JSON a objeto Python
        # y lo devuelve como JSON al cliente.
        return jsonify(json.loads(DATA_FILE.read_text(encoding="utf-8")))

    # Si no existe, devuelve estado sin datos y código 404.
    return jsonify({"status": "sin_datos"}), 404


# Ruta GET para recuperar historial reciente.
@app.get("/api/historial")
def get_historial():
    # Lee parámetro n de la URL; si no viene, usa 200.
    n = int(request.args.get("n", "200"))

    # Si no existe el histórico, devuelve arreglo vacío.
    if not HIST_FILE.exists():
        return jsonify([])

    # Lee todas las líneas del archivo.
    lines = HIST_FILE.read_text(encoding="utf-8").splitlines()

    # Arreglo donde se acumularán las últimas n válidas.
    out = []

    # Recorre solo las últimas n líneas.
    for x in lines[-n:]:
        x = x.strip()
        if not x:
            continue
        try:
            out.append(json.loads(x))
        except:
            continue

    # Devuelve el arreglo.
    return jsonify(out)


# Ruta GET para devolver resumen de meses y días disponibles.
@app.get("/api/historial_resumen")
def historial_resumen():
    """
    Devuelve meses/días disponibles para filtros.
    """
    # Conjunto de meses únicos.
    meses = set()

    # Diccionario mes -> conjunto de días.
    dias_por_mes = {}  # "YYYY-MM" -> set("YYYY-MM-DD")

    # Recorre todo el historial.
    for item in iter_historial():
        dt = to_local_dt(item)
        if not dt:
            continue

        # Obtiene mes y día en string.
        ym = dt.strftime("%Y-%m")
        ymd = dt.strftime("%Y-%m-%d")

        # Agrega el mes al conjunto.
        meses.add(ym)

        # Agrega el día al conjunto correspondiente de ese mes.
        dias_por_mes.setdefault(ym, set()).add(ymd)

    # Ordena los meses.
    meses = sorted(list(meses))

    # Convierte cada set de días en lista ordenada.
    dias_por_mes_out = {k: sorted(list(v)) for k, v in dias_por_mes.items()}

    # Devuelve la estructura como JSON.
    return jsonify({
        "meses": meses,
        "dias_por_mes": dias_por_mes_out
    })


# Ruta GET para filtrar historial por zona, mes, día, hora y límite.
@app.get("/api/historial_filtro")
def historial_filtro():
    """
    Filtros:
      - zona=Z1
      - mes=YYYY-MM (opcional)
      - dia=YYYY-MM-DD (opcional)
      - hora=HH (opcional, 00-23)
      - n=5000 (límite opcional)
    """
    # Lee parámetros de la URL.
    zona = request.args.get("zona", "Z1")
    mes = request.args.get("mes")        # "2026-01"
    dia = request.args.get("dia")        # "2026-01-28"
    hora = request.args.get("hora")      # "11"
    n = int(request.args.get("n", "5000"))

    # Arreglo de salida.
    out = []

    # Recorre historial.
    for item in iter_historial():
        # Filtra por zona.
        if item.get("zona", "Z1") != zona:
            continue

        # Convierte timestamp a fecha local.
        dt = to_local_dt(item)
        if not dt:
            continue

        # Filtra por mes si se pidió.
        if mes and dt.strftime("%Y-%m") != mes:
            continue

        # Filtra por día si se pidió.
        if dia and dt.strftime("%Y-%m-%d") != dia:
            continue

        # Filtra por hora si se pidió.
        if hora and dt.strftime("%H") != hora.zfill(2):
            continue

        # Agrega resultado normalizado.
        out.append({
            "fecha": dt.strftime("%Y-%m-%d"),
            "hora": dt.strftime("%H:%M"),
            "temperatura": item.get("temperatura"),
            "humedad": item.get("humedad"),
            "zona": item.get("zona", "Z1"),
            "ts": dt.isoformat()
        })

        # Si alcanzó el límite, deja de procesar.
        if len(out) >= n:
            break

    # Ordena del más reciente al más antiguo.
    out.sort(key=lambda x: x["ts"], reverse=True)

    # Devuelve resultados.
    return jsonify(out)


# Ruta GET para exportar historial a CSV.
@app.get("/api/historial_export")
def historial_export():
    """
    Exporta CSV (Excel compatible). Params:
      - zona=Z1
      - mes=YYYY-MM (opcional)
    Si no mandas mes => exporta TODO.
    """
    # Lee filtros.
    zona = request.args.get("zona", "Z1")
    mes = request.args.get("mes")  # opcional

    # Crea un "archivo" CSV en memoria.
    output = io.StringIO()

    # Crea escritor CSV.
    writer = csv.writer(output)

    # Escribe encabezado.
    writer.writerow(["fecha", "hora", "temperatura", "humedad", "zona"])

    # Recorre historial.
    for item in iter_historial():
        if item.get("zona", "Z1") != zona:
            continue

        dt = to_local_dt(item)
        if not dt:
            continue

        if mes and dt.strftime("%Y-%m") != mes:
            continue

        # Escribe una fila del CSV.
        writer.writerow([
            dt.strftime("%Y-%m-%d"),
            dt.strftime("%H:%M"),
            item.get("temperatura", ""),
            item.get("humedad", ""),
            item.get("zona", "Z1")
        ])

    # Nombre del archivo de descarga.
    filename = f"historial_{zona}_{mes if mes else 'TODO'}.csv"

    # Crea respuesta HTTP con contenido CSV.
    resp = Response(output.getvalue(), mimetype="text/csv; charset=utf-8")

    # Indica al navegador que se descargue como archivo adjunto.
    resp.headers["Content-Disposition"] = f'attachment; filename="{filename}"'

    return resp


# Ruta GET para tabla histórica de 5 días.
@app.get("/api/historicos")
def get_historicos_5dias():
    # Obtiene zona desde URL.
    zona = request.args.get("zona", "Z1")

    # Construye y devuelve la tabla histórica.
    return jsonify(build_tabla_5dias(zona=zona, days=5))


# Ruta POST para recibir nuevos datos desde sensores o cliente.
@app.post("/api/datos")
def post_datos():
    # ✅ Seguridad: si existe API_KEY en Render, exige header X-API-KEY
    api_key = os.environ.get("API_KEY")

    if api_key:
        # Obtiene la API key enviada en cabecera X-API-KEY.
        incoming = request.headers.get("X-API-KEY", "")

        # Si no coincide, rechaza con 403 Forbidden.
        if incoming != api_key:
            return jsonify({"status": "forbidden"}), 403

    # Lee el JSON enviado en el body de la petición.
    data = request.get_json(force=True)

    # Si no trae zona, asigna Z1 por defecto.
    data.setdefault("zona", "Z1")

    # Si no trae timestamp, genera uno en UTC con formato simple.
    data.setdefault("timestamp", datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"))

    # Siempre agrega sello horario del servidor en formato ISO UTC.
    data["ts_server"] = now_utc_iso_z()

    # Escribe el último dato recibido en datos_actuales.json con formato bonito.
    DATA_FILE.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )

    # Agrega el dato al archivo histórico, una línea por JSON.
    with HIST_FILE.open("a", encoding="utf-8") as f:
        f.write(json.dumps(data, ensure_ascii=False) + "\n")

    # Devuelve confirmación.
    return jsonify({"status": "ok"})


# Punto de entrada si se ejecuta directamente con python app.py
if __name__ == "__main__":
    # En Render normalmente no se usa esto porque Render usa gunicorn.
    # Pero localmente sí sirve para pruebas.
    app.run(host="0.0.0.0", port=5000, debug=True)