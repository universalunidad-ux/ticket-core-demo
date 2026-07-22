/* TC-U15A-2 — utilidades PURAS de resiliencia y presentación para el Dashboard.
   Propietario ÚNICO de: clasificación de fallas de carga, paginación de bandejas,
   guarda anti "respuesta rancia" (stale), conservación de datos parciales válidos y
   saneo/redacción de evidencia. Puro: sin DOM, sin red, sin Supabase, sin reloj ni
   aleatoriedad (el "ahora" siempre se recibe por parámetro). Consumido por dashboard.js
   (Supervisión y Agentes) y por las pruebas locales. NO debe existir un segundo
   clasificador de errores ni un segundo paginador para estas superficies.

   Seguridad: la frontera real es RLS/Edge. Estas funciones NO amplían permisos; sólo
   evitan filtrar datos sensibles (URLs firmadas, tokens, @thumb, metadata cruda) hacia
   la interfaz y clasifican causas para un mensaje administrativo honesto. */

/* ---------- Clasificación de fallas de carga (causa, no efecto) ---------- */
export const LOAD_ERROR_KINDS = Object.freeze([
  "PERMISSION_DENIED",
  "RLS_DENIED",
  "MISSING_COLUMN",
  "MISSING_VIEW",
  "NETWORK_ERROR",
  "TIMEOUT",
  "UNKNOWN_ERROR",
]);

const errText = error => {
  if (!error) return "";
  const parts = [error.code, error.name, error.message, error.details, error.hint]
    .filter(v => v != null)
    .map(String);
  return parts.join(" ");
};

/* Devuelve SIEMPRE una de LOAD_ERROR_KINDS. El orden importa: primero las causas
   inequívocas por código/palabra clave; la red y el timeout antes que "desconocido".
   RLS se distingue de un grant faltante: violación de política vs. permiso de tabla. */
export const classifyLoadError = error => {
  if (!error) return "UNKNOWN_ERROR";
  const text = errText(error);
  const code = String(error.code || "");

  if (/57014|statement timeout|timed?\s*out|\btimeout\b|AbortError/i.test(text)) return "TIMEOUT";
  if (/Failed to fetch|NetworkError|Load failed|ERR_NETWORK|ENOTFOUND|ECONNREFUSED|fetch failed/i.test(text)) return "NETWORK_ERROR";
  if (code === "42703" || /column .* does not exist|Could not find the '?[\w.]+'? column|unknown column/i.test(text)) return "MISSING_COLUMN";
  if (code === "42P01" || code === "PGRST205" || /relation .* does not exist|Could not find the table|does not exist in the schema|undefined table|unknown view/i.test(text)) return "MISSING_VIEW";
  if (/row-level security|violates row-level|RLS/i.test(text)) return "RLS_DENIED";
  if (code === "42501" || code === "401" || code === "403" || /permission denied|insufficient_privilege|not authorized|JWT|forbidden/i.test(text)) return "PERMISSION_DENIED";
  return "UNKNOWN_ERROR";
};

/* Mensaje ADMINISTRATIVO (nunca se muestra a soporte). Explica la causa sin exponer
   secretos ni volcar el error crudo del servidor. */
export const describeLoadError = kind => ({
  PERMISSION_DENIED: "Permisos insuficientes para esta consulta (falta un GRANT administrativo).",
  RLS_DENIED: "La política RLS rechazó la consulta para este rol.",
  MISSING_COLUMN: "Falta una columna requerida en la base de datos (integración incompleta).",
  MISSING_VIEW: "Falta una tabla o vista requerida (integración pendiente de desplegar).",
  NETWORK_ERROR: "Sin conexión con el servidor. Verifica la red e inténtalo de nuevo.",
  TIMEOUT: "La consulta tardó demasiado y se canceló. Reintenta en un momento.",
  UNKNOWN_ERROR: "No se pudo completar la consulta por un error no clasificado.",
}[kind] || "No se pudo completar la consulta por un error no clasificado.");

/* ---------- Paginación pura (bandejas compactas de altura estable) ---------- */
/* total/page/size → estado de paginación normalizado. page se acota a [0, pages-1];
   nunca produce índices fuera de rango ni páginas < 1. */
export const paginate = ({ total = 0, page = 0, size = 5 } = {}) => {
  const t = Math.max(0, Math.floor(Number(total) || 0));
  const s = Math.max(1, Math.floor(Number(size) || 1));
  const pages = Math.max(1, Math.ceil(t / s));
  const safePage = Math.min(Math.max(0, Math.floor(Number(page) || 0)), pages - 1);
  const from = safePage * s;
  const to = Math.min(from + s, t);
  return { total: t, size: s, pages, page: safePage, from, to, hasPrev: safePage > 0, hasNext: safePage < pages - 1 };
};

/* Rebana un arreglo para la página pedida usando el mismo cálculo que paginate. */
export const pageItems = (items, page = 0, size = 5) => {
  const list = Array.isArray(items) ? items : [];
  const { from, to } = paginate({ total: list.length, page, size });
  return list.slice(from, to);
};

/* ---------- Guarda anti-stale (una respuesta previa no pisa una selección posterior) ----
   Contador monótono por superficie. La carga captura un token con next() y, al terminar,
   sólo aplica su resultado si isCurrent(token) sigue siendo verdadero. Puro y testeable. */
export const createSequence = () => {
  let current = 0;
  return {
    next: () => ++current,
    isCurrent: token => token === current,
    peek: () => current,
  };
};

/* ---------- Degradación parcial: conservar el último resultado válido ----------
   Recibe el estado previo y un resultado {ok, value}. Si ok, adopta el nuevo valor y
   limpia el error; si no, CONSERVA el valor previo y anota el tipo de error (stale=true
   cuando había datos previos que se preservan). Nunca inventa datos. */
export const keepLastValid = (prev, result) => {
  const previous = prev && "value" in prev ? prev.value : null;
  if (result && result.ok) {
    return { value: result.value, error: null, stale: false, hadPrevious: previous != null };
  }
  const errorKind = result && result.errorKind ? result.errorKind : classifyLoadError(result && result.error);
  return { value: previous, error: errorKind, stale: previous != null, hadPrevious: previous != null };
};

/* ---------- Redacción / saneo de evidencia ----------
   La interfaz NUNCA debe mostrar: URL firmada, token, sufijo @thumb ni metadata cruda.
   Estas funciones producen un modelo de vista seguro a partir del meta del evento. */
export const SENSITIVE_TEXT = /(?:https?:\/\/|token=|signature=|X-Amz-|\/sign\/|Bearer\s|@thumb|eyJ[A-Za-z0-9_-]{6,})/i;

/* True si un texto arrastra una referencia sensible que jamás debe renderizarse. */
export const hasSensitiveLeak = text => SENSITIVE_TEXT.test(String(text == null ? "" : text));

/* Quita el sufijo interno "@thumb" (y variantes) de un storage_path. El path se usa
   SÓLO para pedir una URL firmada del lado servidor; nunca se renderiza como texto. */
export const cleanStoragePath = path => String(path == null ? "" : path).replace(/@thumb(?=$|[/?#.])/i, "").trim();

const CONTENT_KIND = { image: "image", file: "file", text: "text" };

/* Modelo de vista de evidencia SEGURO para la tarjeta/modal. No expone storage_path,
   URL ni token: sólo el tipo, un nombre de archivo saneado y el tamaño legible ya provisto.
   `hasImage` indica si procede intentar una miniatura firmada (fetch aparte, no aquí). */
export const evidenceView = (meta, { prettyBytes = n => `${Number(n) || 0} B` } = {}) => {
  const m = meta && typeof meta === "object" ? meta : {};
  const kind = CONTENT_KIND[m.content_type] || (m.content_type ? "file" : "none");
  const ref = m.ref_archivo_meta && typeof m.ref_archivo_meta === "object" ? m.ref_archivo_meta : {};
  const rawName = String(ref.nombre_archivo || "").trim();
  /* El nombre visible se sanea: sin rutas, sin @thumb, sin marcadores sensibles. */
  const safeName = rawName && !hasSensitiveLeak(rawName)
    ? rawName.replace(/@thumb(?=\.|$)/i, "").split(/[\\/]/).pop().slice(0, 120)
    : "";
  const hasBytes = Number.isFinite(Number(ref.tamano_bytes)) && Number(ref.tamano_bytes) > 0;
  return {
    kind: kind === "none" ? "none" : kind,
    hasImage: kind === "image" && !!cleanStoragePath(ref.storage_path),
    hasFile: kind === "file" || (kind === "image" && !!safeName),
    fileName: safeName,
    fileSize: hasBytes ? prettyBytes(Number(ref.tamano_bytes)) : "",
    label: kind === "image" ? "Imagen" : kind === "file" ? "Archivo" : "Texto",
  };
};

/* Ruta interna para pedir la URL firmada (NUNCA se renderiza). Vacío si no hay imagen
   segura que solicitar. */
export const evidenceStoragePath = meta => {
  const m = meta && typeof meta === "object" ? meta : {};
  if (m.content_type !== "image") return "";
  const ref = m.ref_archivo_meta && typeof m.ref_archivo_meta === "object" ? m.ref_archivo_meta : {};
  return cleanStoragePath(ref.storage_path);
};

/* Vista previa saneada del texto interno enviado a supervisión (sin secretos, colapsado). */
export const internalMessagePreview = (meta, { max = 240 } = {}) => {
  const m = meta && typeof meta === "object" ? meta : {};
  if (m.content_type && m.content_type !== "text") return "";
  const raw = String(m.comentario || m.texto || "").replace(/\s+/g, " ").trim();
  if (!raw || hasSensitiveLeak(raw)) return "";
  return raw.slice(0, Math.max(0, Math.floor(max)));
};
