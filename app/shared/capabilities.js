/* ============================================================================
   B19D-cont — shared/capabilities.js: detección central de capacidades backend.
   Consumidores: alta-cliente.js (crear-cliente-janome),
   consolidacion-clientes.js (consolidar-cliente-ticket).
   (site_config y vistas v_janome_* ya tienen probe propio cacheado en
   config-loader.js / dashboard.js — congelados; no duplicar aquí.)

   Estados: "available" | "unavailable" | "permission_denied" | "unknown".
   - El resultado available/unavailable se cachea por sesión de navegador:
     la misma capacidad NO se consulta en cada render.
   - "permission_denied" solo puede determinarse en una llamada real; los
     callers lo reportan con markCapability().
   - El probe de Edge usa OPTIONS (sin cuerpo, sin efectos): 2xx/204 → existe;
     404 → no desplegada; fallo de red → unknown (no se cachea).
   ============================================================================ */

const KEY = n => `tc_cap_${n}`;
const sget = n => { try { return sessionStorage.getItem(KEY(n)); } catch { return null; } };
const sset = (n, v) => { try { sessionStorage.setItem(KEY(n), v); } catch { /* noop */ } };

export const getCapability = (name) => sget(name) || "unknown";
export const markCapability = (name, state) => {
  if (["available", "unavailable", "permission_denied", "unknown"].includes(state)) sset(name, state);
};

/* Probe de una Edge Function por nombre (una vez por sesión). */
export async function probeEdge(name) {
  const cached = sget(name);
  if (cached === "available" || cached === "unavailable" || cached === "permission_denied") return cached;
  const cfg = globalThis.TICKET_CORE_CONFIG || {};
  const base = String(cfg.supabaseUrl || "").trim();
  if (!base) return "unknown";
  try {
    const r = await fetch(`${base}/functions/v1/${name}`, { method: "OPTIONS" });
    const state = r.status === 404 ? "unavailable" : "available";
    sset(name, state);
    return state;
  } catch {
    return "unknown"; /* red caída: no cachear, reintentable */
  }
}

/* Interpreta la respuesta de una llamada real a la Edge y actualiza el estado. */
export function noteEdgeResponse(name, status) {
  if (status === 404) sset(name, "unavailable");
  else if (status === 401 || status === 403) sset(name, "permission_denied");
  else if (status >= 200 && status < 500) sset(name, "available");
}
