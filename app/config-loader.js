/* ============================================================================
   CONFIG-LOADER — Personalización de contenido sin tocar código (Ticket Core).
   Lee UNA vez (cacheada) la tabla `site_config` y expone cfg(clave, default).
   DEGRADACIÓN CON GRACIA: si la tabla no existe o no hay sesión/permiso,
   cfg() devuelve los DEFAULTS de abajo y la página se ve EXACTAMENTE igual
   que hoy. No rompe nada.

   Uso declarativo (recomendado): marca un elemento con
     <h1 data-cfg="soporte.hero.titulo">Texto por defecto</h1>
   y este módulo (al cargar) sustituye su texto por el valor configurado,
   o lo deja igual si no hay config. El texto actual del elemento sirve de
   fallback adicional al DEFAULT.

   Uso programático: import { cfg, loadSiteConfig } from "./config-loader.js"
   ============================================================================ */
import { supabase as s } from "./supabase.js";

/* DEFAULTS SEGUROS — fuente única de verdad del copy por defecto.
   Si añades una clave editable en el dashboard, agrégala también aquí. */
export const DEFAULTS = {
  "soporte.hero.kicker": "Soporte Janome",
  "soporte.hero.titulo": "Estamos para ayudarte con tu Janome",
  "soporte.ayuda.titulo": "Cómo agilizar tu caso",
  "soporte.evidencia.hint": "Sube hasta 3 fotos y un video corto (máx. 10 min) de la máquina y del problema. Una imagen clara ayuda muchísimo.",
  "estado.reply.titulo": "Envía lo que te pedimos para avanzar",
  "estado.reply.hint": "Puedes subir hasta 3 fotos y un video corto de la máquina y el problema.",
};

let _cache = null;
let _loaded = false;
let _loading = null;

/* Lectura única cacheada. Nunca lanza: cualquier fallo → cache vacío → defaults. */
export async function loadSiteConfig(force = false) {
  if (_loaded && !force) return _cache;
  if (_loading) return _loading;
  _loading = (async () => {
    const out = {};
    try {
      const r = await s.from("site_config").select("clave,valor").limit(500);
      if (!r.error && Array.isArray(r.data)) {
        for (const row of r.data) {
          if (row && row.clave != null) out[row.clave] = row.valor;
        }
      }
    } catch (_) { /* tabla ausente / sin permiso → degradación con gracia */ }
    _cache = out;
    _loaded = true;
    _loading = null;
    return out;
  })();
  return _loading;
}

/* cfg(clave, default) — síncrono. Llama loadSiteConfig() antes para tener datos;
   si no, devuelve el DEFAULT (o el default pasado). */
export function cfg(key, def = "") {
  const fallback = Object.prototype.hasOwnProperty.call(DEFAULTS, key) ? DEFAULTS[key] : def;
  if (!_cache || !Object.prototype.hasOwnProperty.call(_cache, key)) return fallback;
  const v = _cache[key];
  if (v === undefined || v === null || v === "") return fallback;
  return v;
}

export function configDefaults() { return { ...DEFAULTS }; }

/* Aplica los valores configurados a todos los [data-cfg] del documento.
   Solo toca texto plano (no HTML) por seguridad. */
export async function applyConfigDom(root = document) {
  await loadSiteConfig();
  root.querySelectorAll("[data-cfg]").forEach((el) => {
    const key = el.getAttribute("data-cfg");
    if (!key) return;
    const fallback = el.getAttribute("data-cfg-default") ?? el.textContent;
    const val = cfg(key, fallback);
    if (val != null && typeof val !== "object" && String(val) !== "") {
      el.textContent = String(val);
    }
  });
}

/* Auto-aplicación al cargar (no invasivo: si no hay [data-cfg], no hace nada). */
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { applyConfigDom(); });
  } else {
    applyConfigDom();
  }
}
