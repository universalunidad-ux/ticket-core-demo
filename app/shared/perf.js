/* B19C — Instrumentación de rendimiento SIN PII.
   Solo emite console.info cuando el flag de desarrollo está activo:
   localStorage.tc_dev = "1"  ó  ?dev=1 en la URL.
   Nunca envía telemetría externa; nunca registra datos de usuario/ticket.
   Métricas: PAGE_READY_MS, DATA_PRIMARY_MS, DATA_SECONDARY_MS, REQUEST_COUNT. */
const devFlag = () => {
  try {
    return localStorage.getItem("tc_dev") === "1" || new URLSearchParams(location.search).get("dev") === "1";
  } catch { return false; }
};
const T0 = performance.timeOrigin ? performance.now() : Date.now();
let reqCount = 0;
const page = () => (document.body?.dataset?.page || location.pathname.split("/").pop() || "page").replace(/\.html$/, "");

export const perfMark = (name) => { try { performance.mark(`tc:${name}`); } catch { /* noop */ } };

export const perfMeasure = (name, startMark) => {
  try {
    const m = startMark
      ? performance.measure(`tc:${name}`, `tc:${startMark}`)
      : performance.measure(`tc:${name}`, { start: 0 });
    return Math.round(m.duration);
  } catch { return null; }
};

/* Contador de requests de datos de la carga actual (lo incrementa quien consulta). */
export const perfCountRequest = (n = 1) => { reqCount += n; return reqCount; };
export const perfRequestCount = () => reqCount;

const emit = (k, v) => { if (devFlag()) console.info(`[perf:${page()}] ${k}=${v}`); };

/* Datos primarios listos (lo primero útil en pantalla). */
export const perfPrimaryDone = () => {
  perfMark("data_primary_done");
  emit("DATA_PRIMARY_MS", Math.round(performance.now() - T0));
};
/* Datos secundarios listos (lo que no bloquea el primer render útil). */
export const perfSecondaryDone = () => {
  perfMark("data_secondary_done");
  emit("DATA_SECONDARY_MS", Math.round(performance.now() - T0));
  emit("REQUEST_COUNT", reqCount);
};
/* Página interactiva (llámalo cuando el usuario ya puede operar). */
export const perfPageReady = () => {
  perfMark("page_ready");
  emit("PAGE_READY_MS", Math.round(performance.now() - T0));
};
