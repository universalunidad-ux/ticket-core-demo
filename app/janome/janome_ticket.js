
// D2B3: fallbacks runtime compartidos para módulos Janome/ticket.
const SYS_LOGO = globalThis.SYS_LOGO || (globalThis.SYS_LOGO = {
  janome: "../IMG/janome.jpg",
  janome_garantia: "../IMG/janome.jpg",
  garantia: "../IMG/janome.jpg",
  default: "../IMG/janome.jpg"
});

const syncChannelIcon = globalThis.syncChannelIcon || (globalThis.syncChannelIcon = (...args)=>{
  try{
    const el = args.find(x => x && x.nodeType === 1) || null;
    if(el && !el.textContent.trim()) el.textContent = "•";
  }catch(e){}
});

/* ============================================================================
   JANOME TICKET — helpers de integración para soporte.html y estado.html
   Conecta el catálogo enriquecido con el flujo de ticket (ver flujo_ticket.md).
   Sin dependencias. Degrada con gracia si aún no existe janome_enriquecido.json.
   ============================================================================ */

import { JANOME_PLANO } from "./janome_catalogo.js";

// Escape mínimo para texto dinámico inyectado en HTML (defensa en profundidad;
// el catálogo es estático/confiable, pero no cuesta blindar).
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

let ENRIQUECIDO = null;            // mapa id -> producto enriquecido
let PLANO = new Map(JANOME_PLANO.map((p) => [String(p.id), p]));

// Carga janome_enriquecido.json (si está disponible). Llamar una vez al inicio.
export async function cargarEnriquecido(url = null) {
  if (!url) {
    ENRIQUECIDO = new Map();
    return true;
  }
  try {
    const res = await fetch(url);
    if (!res.ok) return false;
    const arr = await res.json();
    ENRIQUECIDO = new Map(arr.map((p) => [String(p.id), p]));
    return true;
  } catch {
    return false; // el formulario sigue funcionando sin enriquecido
  }
}

// Devuelve info útil de un producto por id (mezcla catálogo base + enriquecido).
export function infoProducto(id) {
  const base = PLANO.get(String(id)) || null;
  const ext = ENRIQUECIDO ? ENRIQUECIDO.get(String(id)) : null;
  if (!base && !ext) return null;
  return {
    id: Number(id),
    nombre: ext?.nombre || base?.nombre || String(id),
    grupo: ext?.grupo || base?.grupo || "",
    tipo: ext?.tipo || null,
    descripcion: ext?.descripcion || null,
    incluye: ext?.incluye || [],
    garantia: ext?.garantia || null,
    manual: ext?.fichaTecnicaPdf || null,
    compatibles: ext?.compatibles || [],
    compatibleConMaquinas: ext?.compatibleConMaquinas || [],
    url: ext?.url || `https://janome.com.mx/disp.prod.aspx?id=${id}`,
  };
}

// Resuelve el producto a partir del texto 'sistema' que el ticket guarda,
// p.ej. "Janome 3008 (Máquinas — Mecánicas)" o "Janome MC9850".
export function infoDesdeSistema(sistema = "") {
  if (!sistema) return null;
  let s = String(sistema).replace(/^janome\s+/i, "").replace(/\s*\(.*\)\s*$/, "").trim();
  if (!s || /^otro/i.test(s)) return null;
  const key = s.toLowerCase();
  let hit = JANOME_PLANO.find((p) => p.nombre.toLowerCase() === key);
  if (!hit)
    hit = JANOME_PLANO.find(
      (p) => p.nombre.toLowerCase().includes(key) || key.includes(p.nombre.toLowerCase())
    );
  return hit ? infoProducto(hit.id) : null;
}

// Problemas comunes por tipo de equipo (ver §6 de flujo_ticket.md).
export const PROBLEMAS_COMUNES = {
  mecanica: [
    "No enciende / sin luz",
    "No cose o salta puntadas",
    "Se rompe o enreda el hilo (atora por abajo)",
    "Tensión despareja",
    "Ojal no funciona",
    "Se traba o hace ruido",
    "Pedal no responde",
    "Aguja se rompe",
  ],
  computarizada: [
    "Mensaje o error en pantalla",
    "Botones o pantalla no responden",
    "No avanza pese a presionar inicio",
    "No cose o salta puntadas",
    "Se rompe o enreda el hilo",
    "Tensión despareja",
  ],
  overlock: [
    "Enhebrado / no forma la cadeneta",
    "Cuchilla no corta",
    "Tensión de conos despareja",
    "Se rompe el hilo",
  ],
  bordadora: [
    "No carga el diseño / no reconoce USB o tarjeta",
    "Error de aro o posición",
    "Diseño descentrado",
    "Hilo de bordado se rompe",
  ],
  accesorio: [
    "No embona en mi modelo",
    "Pieza dañada o incompleta",
    "Duda de cuál comprar para mi máquina",
  ],
};

// Clasifica el grupo del catálogo en una llave de PROBLEMAS_COMUNES.
export function tipoDeEquipo(grupo = "") {
  const g = grupo.toLowerCase();
  if (g.includes("collaret") || g.includes("overlock")) return "overlock";
  if (g.includes("bordadora")) return "bordadora";
  if (g.includes("computarizad")) return "computarizada";
  if (g.startsWith("accesorios") || g.includes("refacc") || g.includes("miscel"))
    return "accesorio";
  return "mecanica";
}

// Prioridad derivada del impacto (+ afectados). Ver §5 de flujo_ticket.md.
export function prioridadDesde(impacto, afectados = "solo_yo") {
  const base = { alta: "Alta", media: "Media", baja: "Baja", preventiva: "Baja" };
  let p = base[impacto] || "Media";
  if ((afectados === "varios" || afectados === "todos") && p !== "Alta") {
    p = p === "Baja" ? "Media" : "Alta"; // sube un nivel
  }
  return p;
}

/* ----------------------------------------------------------------------------
   pintarAyudaProducto: al elegir un producto, inyecta manual + problemas
   comunes en un contenedor. Pensado para el Paso 1 de soporte.html.
   - selectEl: el <select> del catálogo
   - cajaEl:   contenedor donde se pinta la ayuda (un <div> vacío)
   - onCategoria(cat): callback opcional para preseleccionar la categoría
   -------------------------------------------------------------------------- */
export function pintarAyudaProducto(selectEl, cajaEl, onCategoria) {
  if (!selectEl || !cajaEl) return;

  const ocultar = () => { cajaEl.innerHTML = ""; cajaEl.hidden = true; cajaEl.classList.add("hidden"); };
  const mostrar = () => { cajaEl.hidden = false; cajaEl.classList.remove("hidden"); };

  const render = () => {
    const id = selectEl.value;
    if (!id || id === "OTRO") return ocultar();

    const info = infoProducto(id);
    if (!info) return ocultar();

    const manualHtml = info.manual
      ? `<a class="mini btn-ghost" href="${encodeURI(info.manual)}" target="_blank" rel="noopener">📄 Ver manual</a>`
      : "";
    const garantiaHtml = info.garantia ? `<span class="tag">Garantía ${esc(info.garantia)}</span>` : "";

    // Problemas comunes según el tipo de equipo: chips que prellenan el título.
    const tipo = tipoDeEquipo(info.grupo);
    const probs = (PROBLEMAS_COMUNES[tipo] || []).slice(0, 6);
    const chipsHtml = probs.length
      ? `<div class="jn-ficha-probs"><div class="jn-ficha-probs-lbl">¿Qué le pasa? Toca lo más parecido para empezar:</div><div class="jn-prob-chips">${
          probs.map((p) => `<button type="button" class="jn-prob-chip" data-jn-prob="${esc(p)}">${esc(p)}</button>`).join("")
        }</div></div>`
      : "";

    mostrar();
    cajaEl.innerHTML = `
      <div class="jn-ficha-row">
        <div class="jn-ficha-txt">Elegiste <b>${esc(info.nombre)}</b>${info.tipo ? " — " + esc(info.tipo) : ""}. ${garantiaHtml}</div>
        ${manualHtml}
      </div>
      ${chipsHtml}
    `;
  };

  // Listener único en el contenedor: al tocar un chip se invoca onCategoria(problema).
  if (!cajaEl.dataset.jnProbBound) {
    cajaEl.dataset.jnProbBound = "1";
    cajaEl.addEventListener("click", (e) => {
      const b = e.target.closest("[data-jn-prob]");
      if (!b) return;
      e.preventDefault();
      if (typeof onCategoria === "function") onCategoria(b.dataset.jnProb);
    });
  }

  selectEl.addEventListener("change", render);
  render();
}

/* ----------------------------------------------------------------------------
   montarFichaAgente: para la CONSOLA DEL AGENTE (ticket.html).
   Recibe el contenedor y el texto 'sistema' del ticket; carga el enriquecido
   si hace falta y pinta la ficha del equipo (tipo, descripción, qué incluye,
   manual y problemas comunes). Toda la lógica vive aquí: ticket.js solo llama
   esta función con una línea. Degrada con gracia si no hay match.
   -------------------------------------------------------------------------- */
export async function montarFichaAgente(cajaEl, sistema, { url = null } = {}) {
  if (!cajaEl) return;
  if (!ENRIQUECIDO) await cargarEnriquecido(url);

  const info = infoDesdeSistema(sistema);
  if (!info) { cajaEl.innerHTML = ""; cajaEl.hidden = true; cajaEl.classList.add("hidden"); return; }

  const tipo = tipoDeEquipo(info.grupo);
  const problemas = (PROBLEMAS_COMUNES[tipo] || []).slice(0, 6);

  const desc = info.descripcion
    ? `<div class="mut mini">${info.descripcion.slice(0, 240)}${info.descripcion.length > 240 ? "…" : ""}</div>`
    : "";
  const incluye = (info.incluye && info.incluye.length)
    ? `<div class="mut mini">Incluye: ${info.incluye.slice(0, 8).join(", ")}</div>`
    : "";
  const garantia = info.garantia ? `<span class="tag">Garantía ${info.garantia}</span>` : "";
  const manual = info.manual
    ? `<a class="mini btn-ghost" href="${encodeURI(info.manual)}" target="_blank" rel="noopener">📄 Manual</a>`
    : "";

  cajaEl.hidden = false;
  cajaEl.classList.remove("hidden");
  cajaEl.innerHTML = `
    <div class="k">Ficha Janome</div>
    <div class="v small">${info.nombre}${info.tipo ? " — " + info.tipo : ""} ${garantia}</div>
    ${desc}
    ${incluye}
    <div class="mut mini">Problemas comunes: ${problemas.join(" · ")}</div>
    <div class="actions" style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
      ${manual}
      <a class="mini btn-ghost" href="${info.url}" target="_blank" rel="noopener">Ver en janome.com.mx</a>
    </div>
  `;
}
