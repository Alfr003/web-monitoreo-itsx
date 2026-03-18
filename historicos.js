// URL base de la API desplegada en Render.
// Todas las consultas del frontend hacia el backend se construirán usando esta base.
const API_BASE = "https://monitoreo-climatico-itsx-wqxx.onrender.com";

// Zona de monitoreo con la que trabajará esta página.
// En este caso, se usa la zona Z1 como valor fijo por defecto.
const ZONA = "Z1";

// Referencia al select HTML donde se elige el mes.
const selMes = document.getElementById("filtroMes");

// Referencia al select HTML donde se elige el día.
const selDia = document.getElementById("filtroDia");

// Referencia al input tipo time donde se elige la hora.
const inpHora = document.getElementById("filtroHora");

// Referencia al botón que aplica los filtros seleccionados.
const btnAplicar = document.getElementById("btnAplicar");

// Referencia al botón que limpia todos los filtros.
const btnLimpiar = document.getElementById("btnLimpiar");

// Referencia al botón que descarga todo el historial en CSV/Excel.
const btnExcelTodo = document.getElementById("btnExcelTodo");

// Referencia al botón que descarga solo el mes seleccionado.
const btnExcelMes = document.getElementById("btnExcelMes");

// Referencia al tbody de la tabla donde se insertarán las filas de datos.
// Primero intenta buscar un elemento con id="tablaBody".
// Si no existe, usa como respaldo el tbody dentro de la tabla con id="tablaHistoricos".
const tbody = document.getElementById("tablaBody") || document.querySelector("#tablaHistoricos tbody");

// Referencia al bloque donde se mostrará el estado del sistema:
// por ejemplo "Cargando...", "No hay registros", etc.
const estado = document.getElementById("estado");

// Variable global donde se guardará la relación mes -> lista de días.
// Esta estructura viene desde el endpoint /api/historial_resumen.
let DIAS_POR_MES = {};


// Función auxiliar para escribir mensajes en el elemento de estado.
// Si estado existe, cambia su contenido por el mensaje recibido.
function setEstado(msg) {
  if (estado) estado.textContent = msg || "";
}


// Función auxiliar para vaciar completamente la tabla antes de volver a llenarla.
function limpiarTabla() {
  if (tbody) tbody.innerHTML = "";
}


// Función para agregar una fila a la tabla a partir de un objeto de registro.
// Espera un objeto con propiedades como:
// fecha, hora, temperatura, humedad y zona.
function addRow(r) {
  // Crea un nuevo elemento <tr> (fila de tabla).
  const tr = document.createElement("tr");

  // Inserta el contenido HTML de las celdas.
  // Usa operador ?? para mostrar cadena vacía si algún campo no existe.
  tr.innerHTML = `
    <td>${r.fecha ?? ""}</td>
    <td>${r.hora ?? ""}</td>
    <td>${r.temperatura ?? ""}</td>
    <td>${r.humedad ?? ""}</td>
    <td>${r.zona ?? "Z1"}</td>
  `;

  // Agrega la fila construida al tbody de la tabla.
  tbody.appendChild(tr);
}


// Función auxiliar que convierte un valor tipo "HH:MM" a solo "HH".
// Ejemplo:
// "11:30" -> "11"
function horaToHH(val) {
  // Si no hay valor, devuelve cadena vacía.
  if (!val) return "";

  // Toma solo los dos primeros caracteres.
  return val.slice(0, 2); // "11:30" -> "11"
}


// ================== Cargar resumen ==================

// Función asíncrona que consulta al backend cuáles meses y días existen en el historial.
// Sirve para llenar dinámicamente los filtros de mes y día.
async function cargarResumen() {
  // Muestra estado informando que se están cargando los meses.
  setEstado("Cargando meses...");

  try {
    // Hace petición al endpoint /api/historial_resumen.
    // Se agrega timestamp para evitar caché del navegador.
    const res = await fetch(`${API_BASE}/api/historial_resumen?t=${Date.now()}`, { cache: "no-store" });

    // Convierte la respuesta en JSON.
    const data = await res.json();

    // Reinicia el select de meses dejando solo la opción por defecto.
    selMes.innerHTML = `<option value="">Mes (todos)</option>`;

    // Guarda localmente la estructura dias_por_mes recibida desde la API.
    DIAS_POR_MES = data.dias_por_mes || {};

    // Recorre la lista de meses recibidos y crea una opción <option> por cada uno.
    (data.meses || []).forEach(m => {
      const opt = document.createElement("option"); // Crea la opción
      opt.value = m; // Valor real del option, por ejemplo "2026-01"
      opt.textContent = m; // Texto visible en pantalla
      selMes.appendChild(opt); // Inserta la opción en el select
    });

    // Actualiza el estado indicando que el resumen fue cargado.
    setEstado("Resumen cargado");
  } catch (e) {
    // Si ocurre error, lo muestra en consola.
    console.error(e);

    // Informa al usuario que falló la carga.
    setEstado("Error cargando resumen");
  }
}


// Evento que se dispara cuando cambia el select del mes.
selMes.addEventListener("change", () => {
  // Guarda el valor actualmente seleccionado.
  const mes = selMes.value;

  // Reinicia el select de días dejando solo la opción por defecto.
  selDia.innerHTML = `<option value="">Día (todos)</option>`;

  // Si no hay mes seleccionado...
  if (!mes) {
    // Deshabilita el select de día.
    selDia.disabled = true;

    // Deshabilita también la exportación por mes.
    btnExcelMes.disabled = true;

    // Sale de la función.
    return;
  }

  // Si sí hay mes seleccionado, recorre los días asociados a ese mes.
  (DIAS_POR_MES[mes] || []).forEach(d => {
    const opt = document.createElement("option"); // Crea nueva opción
    opt.value = d; // Valor interno, por ejemplo "2026-01-28"
    opt.textContent = d; // Texto visible
    selDia.appendChild(opt); // Inserta en el select
  });

  // Habilita el select de días.
  selDia.disabled = false;

  // Habilita el botón de exportar por mes.
  btnExcelMes.disabled = false;
});


// ================== Cargar tabla ==================

// Función asíncrona que consulta el endpoint filtrado y llena la tabla histórica.
async function cargarTabla() {
  // Limpia la tabla antes de cargar nuevos resultados.
  limpiarTabla();

  // Muestra estado indicando que los datos están cargando.
  setEstado("Cargando datos...");

  // Construye parámetros de consulta.
  const params = new URLSearchParams();

  // Siempre manda la zona.
  params.set("zona", ZONA);

  // Si el usuario seleccionó mes, lo agrega.
  if (selMes.value) params.set("mes", selMes.value);

  // Si el usuario seleccionó día, lo agrega.
  if (selDia.value) params.set("dia", selDia.value);

  // Si el usuario seleccionó hora, la convierte a HH y la agrega.
  if (inpHora.value) params.set("hora", horaToHH(inpHora.value));

  // Construye la URL final con parámetros y timestamp anti-caché.
  const url = `${API_BASE}/api/historial_filtro?${params.toString()}&t=${Date.now()}`;

  try {
    // Hace la petición al backend.
    const res = await fetch(url, { cache: "no-store" });

    // Convierte la respuesta a JSON.
    const rows = await res.json();

    // Si no hay filas devueltas...
    if (!rows.length) {
      // Muestra mensaje de tabla vacía.
      setEstado("No hay registros");
      return;
    }

    // Inserta cada fila en la tabla.
    rows.forEach(addRow);

    // Muestra cantidad de registros cargados.
    setEstado(`Registros mostrados: ${rows.length}`);
  } catch (e) {
    // Si ocurre error, lo manda a consola.
    console.error(e);

    // Informa al usuario.
    setEstado("Error cargando datos");
  }
}


// ================== Descargas ==================

// Evento para descargar TODO el historial en CSV.
btnExcelTodo.addEventListener("click", () => {
  // Abre una nueva pestaña o dispara descarga del endpoint de exportación.
  // encodeURIComponent asegura que el valor de la zona sea seguro dentro de la URL.
  window.open(`${API_BASE}/api/historial_export?zona=${encodeURIComponent(ZONA)}&t=${Date.now()}`, "_blank");
});


// Evento para descargar solo el historial del mes seleccionado.
btnExcelMes.addEventListener("click", () => {
  // Si no hay mes seleccionado, no hace nada.
  if (!selMes.value) return;

  // Si sí hay mes, llama al endpoint de exportación filtrando por zona y mes.
  window.open(`${API_BASE}/api/historial_export?zona=${encodeURIComponent(ZONA)}&mes=${encodeURIComponent(selMes.value)}&t=${Date.now()}`, "_blank");
});


// ================== Botones ==================

// Cuando se hace clic en "Aplicar", se consulta la tabla con los filtros actuales.
btnAplicar.addEventListener("click", cargarTabla);


// Cuando se hace clic en "Limpiar", se restauran todos los filtros al estado inicial.
btnLimpiar.addEventListener("click", () => {
  // Quita selección de mes.
  selMes.value = "";

  // Reinicia el select de días.
  selDia.innerHTML = `<option value="">Día (todos)</option>`;

  // Lo vuelve a deshabilitar.
  selDia.disabled = true;

  // Vacía la hora seleccionada.
  inpHora.value = "";

  // Deshabilita nuevamente exportación por mes.
  btnExcelMes.disabled = true;

  // Vuelve a cargar la tabla sin filtros.
  cargarTabla();
});


// ================== INIT ==================

// Función autoejecutable asíncrona que se ejecuta al cargar el archivo.
// Sirve para inicializar la página.
(async function init() {
  // Primero carga meses y días disponibles.
  await cargarResumen();

  // Después carga la tabla general inicial.
  await cargarTabla();

})();
