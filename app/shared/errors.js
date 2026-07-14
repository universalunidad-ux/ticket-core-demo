/* ============================================================================
   B19D-cont — shared/errors.js: contrato de errores del frontend interno.
   Consumidores: clientes.js, cliente.js, alta-cliente.js,
   consolidacion-clientes.js. (dashboard.js quedó congelado con su propio
   mapeo local equivalente; unificar es deuda documentada, no urgente.)

   Reglas (FRONTEND_RESILIENCE_CONTRACT.md):
   - El usuario final NUNCA ve tablas, vistas, códigos PostgREST, stacks,
     UUID, tokens ni signed URLs: solo mensajes humanos.
   - Cada fallo conserva un código interno sanitizado (catálogo en
     docs/fable/FRONTEND_ERROR_CATALOG.md) para diagnóstico.
   - El log dev-only registra código/página/operación/status/duración.
     PROHIBIDO registrar: token, correo, teléfono, nombre, texto de tickets,
     UUID completos, signed URLs.
   ============================================================================ */

const DEV = () => false;

/* Clasificación de una falla (error supabase-js, Response HTTP o excepción). */
export function classify(err, httpStatus = null) {
  const status = httpStatus ?? err?.status ?? err?.code ?? null;
  const msg = String(err?.message || err || "");
  if (status === 401 || status === 403 || /permission|policy|denied|RLS|42501|JWT/i.test(msg)) return "permission_denied";
  if (status === 404 || /does not exist|relation .* not|PGRST20[05]|schema cache/i.test(msg)) return "unavailable";
  if (/timeout|REQUEST_TIMEOUT/i.test(msg)) return "timeout";
  if (/Failed to fetch|NetworkError|network|ERR_INTERNET/i.test(msg)) return "network";
  if (status === 429 || /rate limit|too many/i.test(msg)) return "rate_limited";
  return "unknown";
}

/* Mensaje humano por tipo (el código interno NO se muestra al usuario). */
const HUMAN = {
  permission_denied: "No tienes permisos para esta acción. Si crees que es un error, contacta al administrador.",
  unavailable: "Esta función aún no está disponible en el servidor. No se realizó ningún cambio.",
  timeout: "El servidor tardó demasiado en responder. Inténtalo de nuevo.",
  network: "Sin conexión con el servidor. Verifica tu red e inténtalo de nuevo.",
  rate_limited: "Demasiadas solicitudes seguidas. Espera un momento e inténtalo de nuevo.",
  unknown: "Ocurrió un error inesperado. Inténtalo de nuevo; si persiste, avisa al administrador.",
};

/* mapError: error crudo → { code, kind, human } sin filtrar internals. */
export function mapError(err, code = "REQUEST_FAILED", httpStatus = null) {
  const kind = classify(err, httpStatus);
  return { code, kind, human: HUMAN[kind] || HUMAN.unknown };
}

/* Log dev-only sanitizado. Nunca incluir datos de personas ni de tickets. */
export function devLog(page, op, code, status = null, ms = null) {
  if (!DEV()) return;
  console.info(`[err:${page}] op=${op} code=${code}${status != null ? ` status=${status}` : ""}${ms != null ? ` ms=${Math.round(ms)}` : ""} ts=${new Date().toISOString()}`);
}

/* Timeout explícito para promesas (GET/lecturas). El código queda en el error. */
export function withTimeout(promise, ms = 12000, code = "REQUEST_TIMEOUT") {
  let t;
  const timer = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(code)), ms); });
  return Promise.race([promise, timer]).finally(() => clearTimeout(t));
}
