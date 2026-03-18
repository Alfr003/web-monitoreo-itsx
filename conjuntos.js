// =================== Config API (Render) ===================

// URL base de tu API desplegada en Render.
// Todas las consultas fetch se construirán a partir de esta dirección.
const API_BASE = "https://monitoreo-climatico-itsx-wqxx.onrender.com";

// Zona de monitoreo que se desea visualizar.
// Aquí se está trabajando específicamente con la zona Z1.
const ZONA = "Z1";

// Intervalo de actualización automática de las gráficas.
// 60_000 ms = 60 segundos = 1 minuto.
const REFRESH_MS = 60_000;

// Número máximo de puntos que se mostrarán en la gráfica.
// Por ejemplo, 60 puntos pueden representar 1 hora si llega 1 dato por minuto.
const N_PUNTOS = 60;


// =================== Helpers ===================

// Función auxiliar para convertir un timestamp en una hora legible en formato local.
// Recibe una cadena de tiempo (por ejemplo, "2026-01-28T16:48:00" o "2026-01-28 16:48:00")
// y devuelve solo la hora y minutos.
function obtenerHoraLocal(ts) {

  // Si no viene timestamp, devuelve marcador por defecto.
  if (!ts) return "--:--";

  // Normaliza el string para que el constructor Date lo entienda mejor.
  // Si ya tiene "T", se usa tal cual.
  // Si viene con espacio entre fecha y hora, se reemplaza por "T".
  const iso = ts.includes("T") ? ts : ts.replace(" ", "T");

  // Crea un objeto Date a partir de la cadena.
  const d = new Date(iso);

  // Si la fecha no pudo interpretarse correctamente,
  // como respaldo toma manualmente la subcadena HH:MM.
  if (isNaN(d.getTime())) return ts.slice(11, 16);

  // Si sí fue válida, devuelve la hora local del navegador en formato 2 dígitos.
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Función auxiliar para escribir texto en el bloque de resumen/análisis.
// Recibe una cadena y la inserta en el elemento con id="analisis".
function setAnalisis(texto) {

  // Busca el elemento HTML con id "analisis".
  const el = document.getElementById("analisis");

  // Si existe, cambia su texto interno.
  if (el) el.innerText = texto;
}


// =================== Charts ===================

// Obtiene el contexto 2D del canvas donde se dibujará la gráfica de temperatura.
const ctxTemp = document.getElementById("graficaTempZ1").getContext("2d");

// Obtiene el contexto 2D del canvas donde se dibujará la gráfica de humedad.
const ctxHum = document.getElementById("graficaHumZ1").getContext("2d");

// Arreglo para etiquetas del eje X (horas).
const labels = [];

// Arreglo para datos de temperatura.
const dataTemp = [];

// Arreglo para datos de humedad.
const dataHum = [];


// =================== Gráfica de Temperatura ===================

// Crea una nueva instancia de Chart.js para temperatura.
const chartTemp = new Chart(ctxTemp, {
  type: "line", // Tipo de gráfica: línea

  data: {
    labels, // Etiquetas del eje X (usa el arreglo labels)
    datasets: [{
      label: "Temperatura (°C)", // Nombre del conjunto de datos
      data: dataTemp, // Arreglo con los valores de temperatura
      tension: 0.25, // Suaviza un poco la curva de la línea
      pointRadius: 2, // Tamaño del punto normal
      pointHoverRadius: 4, // Tamaño del punto al pasar el mouse
      borderWidth: 2 // Grosor de la línea
    }]
  },

  options: {
    responsive: true, // Hace que la gráfica se adapte al tamaño del contenedor

    animation: { duration: 450 }, // Duración de animación al actualizar

    plugins: {
      legend: { position: "top" }, // Coloca la leyenda arriba

      tooltip: {
        callbacks: {
          // Personaliza el texto del tooltip cuando pasas el mouse sobre un punto
          label: (ctx) => ` ${Number(ctx.parsed.y).toFixed(1)} °C`
        }
      }
    },

    scales: {
      y: {
        grace: "5%", // Agrega 5% de margen arriba/abajo del eje Y

        ticks: {
          stepSize: 0.5, // Incremento entre marcas del eje Y
          callback: (v) => Number(v).toFixed(1) // Formato de un decimal
        }
      }
    }
  }
});


// =================== Gráfica de Humedad ===================

// Crea una nueva instancia de Chart.js para humedad.
const chartHum = new Chart(ctxHum, {
  type: "line", // Tipo de gráfica: línea

  data: {
    labels, // Comparte el mismo arreglo de etiquetas de tiempo
    datasets: [{
      label: "Humedad (%)", // Nombre del conjunto
      data: dataHum, // Arreglo con valores de humedad
      tension: 0.25, // Suaviza la curva
      pointRadius: 2, // Radio del punto normal
      pointHoverRadius: 4, // Radio del punto al hacer hover
      borderWidth: 2 // Grosor de la línea
    }]
  },

  options: {
    responsive: true, // Ajuste automático al tamaño

    animation: { duration: 450 }, // Duración de transición al actualizar

    plugins: {
      legend: { position: "top" }, // Leyenda arriba

      tooltip: {
        callbacks: {
          // Tooltip personalizado para humedad
          label: (ctx) => ` ${Number(ctx.parsed.y).toFixed(1)} %`
        }
      }
    },

    scales: {
      y: {
        grace: "5%", // Margen adicional del 5%

        ticks: {
          stepSize: 0.5, // Espaciado entre marcas del eje Y
          callback: (v) => Number(v).toFixed(1) // Mostrar con 1 decimal
        }
      }
    }
  }
});


// =================== Cargar datos reales ===================

// Función principal que consulta el historial real a la API y actualiza ambas gráficas.
async function actualizarGraficas() {
  try {
    // Construye la URL del endpoint histórico.
    // n=${N_PUNTOS} pide cierta cantidad de datos.
    // t=${Date.now()} agrega un timestamp para evitar caché.
    const url = `${API_BASE}/api/historial?n=${N_PUNTOS}&t=${Date.now()}`;

    // Hace la petición al servidor.
    const res = await fetch(url, { cache: "no-store" });

    // Si el servidor responde con error HTTP, se lanza una excepción.
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    // Convierte la respuesta JSON a arreglo JS.
    const arr = await res.json();

    // Filtra solo los datos de la zona Z1.
    // Si algún registro no trae zona, asume "Z1" por defecto.
    // Luego toma los últimos N_PUNTOS registros.
    const datosZ1 = (arr || [])
      .filter(x => (x.zona || "Z1") === ZONA)
      .slice(-N_PUNTOS);

    // Vacía los arreglos manteniendo su referencia.
    // Esto es importante porque Chart.js ya está apuntando a esos arreglos.
    labels.length = 0;
    dataTemp.length = 0;
    dataHum.length = 0;

    // Recorre los datos ya filtrados en orden temporal (viejo -> nuevo).
    datosZ1.forEach(d => {

      // Intenta obtener el timestamp del registro.
      const ts = d.ts_server || d.timestamp || "";

      // Convierte ese timestamp a hora local legible y la agrega a labels.
      labels.push(obtenerHoraLocal(ts));

      // Convierte temperatura y humedad a número y las agrega a sus arreglos.
      dataTemp.push(Number(d.temperatura));
      dataHum.push(Number(d.humedad));
    });

    // Actualiza visualmente ambas gráficas con los nuevos datos.
    chartTemp.update();
    chartHum.update();

    // Resumen + valores actuales
    // Toma el último dato del arreglo (el más reciente).
    const last = datosZ1[datosZ1.length - 1];

    if (last) {
      // Convierte la última temperatura y humedad a número.
      const t = Number(last.temperatura);
      const h = Number(last.humedad);

      // ✅ valores actuales al lado de cada gráfica
      // Busca los elementos donde se mostrará el valor actual.
      const elT = document.getElementById("tempActual");
      const elH = document.getElementById("humActual");

      // Si existen, inserta el valor con un decimal.
      if (elT) elT.innerText = t.toFixed(1);
      if (elH) elH.innerText = h.toFixed(1);

      // ✅ menos decimales en el resumen
      // Comienza a construir el mensaje de análisis/resumen.
      let msg = `Última lectura Z1: ${t.toFixed(1)} °C | ${h.toFixed(1)} %`;

      // regla simple (ajústala si quieres)
      // Evalúa la temperatura y añade interpretación.
      if (t >= 30) msg += " — ⚠️ Temperatura alta.";
      else if (t <= 15) msg += " — ⚠️ Temperatura baja.";
      else msg += " — ✅ Temperatura normal.";

      // Evalúa la humedad y añade interpretación.
      if (h >= 85) msg += " ⚠️ Humedad alta.";
      else if (h <= 55) msg += " ⚠️ Humedad baja.";
      else msg += " ✅ Humedad normal.";

      // Escribe el mensaje en el bloque de análisis.
      setAnalisis(msg);

    } else {
      // Si no hay datos, muestra mensaje alternativo.
      setAnalisis("Aún no hay datos suficientes en historial para graficar.");
    }

  } catch (err) {
    // Si ocurre cualquier error (API caída, mala respuesta, red, etc.), se reporta.
    console.error("Error actualizando gráficas:", err);

    // También se informa al usuario en el texto del análisis.
    setAnalisis("Error cargando datos (revisa que la API esté en línea y que exista historial).");
  }
}

// Llama una vez a la función al cargar la página.
actualizarGraficas();

// Programa actualización automática cada REFRESH_MS (1 minuto).

setInterval(actualizarGraficas, REFRESH_MS);
