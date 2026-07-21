/* ============================================================================
   B19D — cliente.ui.js: SOLO render de la ficha 360 (datos: cliente.core.js).
   Cada pestaña tiene skeleton propio, error propio con retry, estado vacío
   diseñado (qué aparecerá + CTA permitido) y filas de ticket profesionales.
   No se inventan conteos: solo se muestran cuando el dato es real.
   ============================================================================ */
import { esc } from "./global.js?v=frontend-final-20260716-01";
import { fmtFecha, fmtFechaHora, estadoTag, prioTag, matchTag, initials } from "./shared/formatters.js?v=frontend-final-20260716-01";

const kv = (k, v) => `<div class="cf-item"><div class="k">${esc(k)}</div><div class="v">${v || "—"}</div></div>`;

/* Estado vacío diseñado: título + qué aparecerá aquí + CTA permitido */
const emptyBox = (titulo, desc, ctaHtml = "") =>
  `<div class="cf-empty"><div class="cf-empty-t">${esc(titulo)}</div><div class="cf-empty-d">${esc(desc)}</div>${ctaHtml}</div>`;

export const skeletonHtml = (n = 3) => Array.from({ length: n }, () => '<div class="cf-skel"></div>').join("");
export const errorHtml = (tab, msg = "") =>
  `<div class="cf-empty"><div class="cf-empty-t">No se pudo cargar esta pestaña</div><div class="cf-empty-d">${esc(msg || "Error consultando datos.")}</div><button class="btn btn-ghost" type="button" data-tab-retry="${esc(tab)}">Reintentar</button></div>`;

export function renderHeader(d) {
  const c = d.cliente, p = d.contactos.find(x => x.es_principal) || d.contactos[0];
  document.getElementById("cfAvatar").textContent = initials(c.nombre);
  document.getElementById("cfNombre").textContent = c.nombre || "Cliente sin nombre";
  document.getElementById("cfContactoLinea").textContent = p
    ? `${p.nombre || ""}${p.correo ? ` · ${p.correo}` : ""}${p.telefono ? ` · ${p.telefono}` : ""}`
    : "Sin contacto principal registrado";
  const put = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  put("cfKpiAbiertos", d.kpis.abiertos ?? "—");
  put("cfKpiEquipos", d.kpis.equipos ?? "—");
  put("cfKpiActividad", d.kpis.actividad ? fmtFecha(d.kpis.actividad) : "Sin tickets");
  document.getElementById("cfConsolidaAviso")?.classList.toggle("hidden", !d.kpis.consolidacion);
}

/* Conteos reales en las tabs (solo cuando existen) */
export function setTabCount(tab, n) {
  const el = document.querySelector(`#cfTabs [data-tab="${tab}"] .cf-tab-n`);
  if (!el) return;
  if (n === null || n === undefined) { el.textContent = ""; el.classList.add("hidden"); return; }
  el.textContent = String(n);
  el.classList.remove("hidden");
}

export function renderResumen(d) {
  const c = d.cliente, p = d.contactos.find(x => x.es_principal) || d.contactos[0];
  return `<div class="cf-grid">
    ${kv("Cliente / empresa", esc(c.nombre))}
    ${kv("Contacto principal", p ? esc(p.nombre) : "")}
    ${kv("Correo", p?.correo ? esc(p.correo) : "")}
    ${kv("Teléfono", p?.telefono ? esc(p.telefono) : "")}
    ${kv("Equipos registrados", d.kpis.equipos == null ? "—" : String(d.kpis.equipos))}
    ${kv("Tickets totales", d.kpis.totales == null ? "—" : String(d.kpis.totales))}
    ${kv("Tickets abiertos", d.kpis.abiertos == null ? "—" : String(d.kpis.abiertos))}
    ${kv("Última actividad", d.kpis.actividad ? fmtFechaHora(d.kpis.actividad) : "")}
  </div>${d.kpis.consolidacion ? '<p class="mut" style="margin-top:10px">⚠ Hay tickets pendientes de consolidación relacionados con este cliente (pestaña Consolidación).</p>' : ""}`;
}

export function renderContactos(d) {
  if (!d.contactos.length) return emptyBox(
    "Sin contactos registrados",
    "Aquí aparecerán las personas de contacto del cliente (nombre, puesto, correo y teléfono) cuando se registren.",
  );
  return `<div class="cf-list">${d.contactos.map(c => `<div class="cf-rowitem"><div><div class="cl-name">${esc(c.nombre || "—")} ${c.es_principal ? '<span class="tag ok">principal</span>' : ""}</div><div class="cl-sub">${esc([c.puesto, c.correo, c.telefono].filter(Boolean).join(" · ") || "Sin datos de contacto")}</div></div></div>`).join("")}</div>
  <p class="mut" style="margin-top:10px">La edición de contactos requiere una operación backend versionada. La cola de Consolidación permanece en modo análisis y no realiza escrituras desde el navegador.</p>`;
}

export function renderEquipos(equipos) {
  if (!equipos.length) return emptyBox(
    "Sin máquinas o accesorios",
    "Aquí aparecerán los equipos Janome del cliente (modelo, variante, serie y fecha de compra) cuando se registren.",
    '<a class="btn btn-ghost" href="alta-cliente.html">Registrar desde alta interna</a>',
  );
  return `<div class="cf-list">${equipos.map(e => {
    const modelo = e.sistema || e.producto || "Equipo", ver = e.version_sistema || e.version_producto || "", serie = e.serie || e.numero_serie || "";
    const extra = [ver && `Variante: ${ver}`, serie && `Serie: ${serie}`, e.fecha_compra && `Compra: ${fmtFecha(e.fecha_compra)}`, e.distribuidor && `Distribuidor: ${e.distribuidor}`].filter(Boolean).join(" · ");
    return `<div class="cf-rowitem"><div><div class="cl-name">🧵 ${esc(modelo)}</div><div class="cl-sub">${esc(extra || "Sin detalle adicional")}</div></div></div>`;
  }).join("")}</div>`;
}

/* Fila de ticket profesional: folio, título 1–2 líneas, estado humano,
   prioridad, agente, producto, actualización; fila completa clicable. */
export function renderTickets(data) {
  const { tickets, agentes } = data;
  if (!tickets.length) return emptyBox(
    "Este cliente aún no tiene tickets",
    "Aquí aparecerá el historial de casos: folio, estado, prioridad, agente y última actualización.",
    `<a class="btn btn-ghost" href="soporte.html?from=cliente&amp;returnTo=cliente.html${location.search?`%3F${encodeURIComponent(location.search.slice(1))}`:""}">Crear un ticket</a>`,
  );
  return `<div class="cf-list">${tickets.map(t => `
    <div class="cf-ticket cf-link" data-ticket="${esc(t.id)}" role="link" tabindex="0">
      <div class="cf-ticket-main">
        <div class="cf-ticket-top"><span class="cf-ticket-folio">${esc(t.folio || "—")}</span>${estadoTag(t.estado)}${prioTag(t.prioridad)}</div>
        <div class="cf-ticket-title">${esc(t.titulo || "Sin título")}</div>
        <div class="cf-ticket-meta">
          <span>${agentes[t.asignado_a] ? esc(agentes[t.asignado_a]) : "Sin asignar"}</span>
          ${t.tipo ? `<span>· ${esc(t.tipo)}</span>` : ""}
          ${Number(t.evidencia_count) > 0 ? `<span>· 📎 ${t.evidencia_count}</span>` : ""}
          <span>· Actualizado ${fmtFecha(t.fecha_actualizacion)}</span>
        </div>
      </div>
      <span class="cf-ticket-cta" aria-hidden="true">›</span>
    </div>`).join("")}</div>`;
}

export function renderAdjuntos(data) {
  const con = data.tickets.filter(t => Number(t.evidencia_count) > 0);
  if (!con.length) return emptyBox(
    "Sin adjuntos registrados",
    "Aquí aparecerán los tickets del cliente que tienen archivos (fotos, PDF). Los archivos viven en cada ticket; se abren desde ahí.",
  );
  return `<p class="mut">Los adjuntos viven en cada ticket (fuente: archivos_ticket). Abre el ticket para ver o descargar.</p>
  <div class="cf-list" style="margin-top:10px">${con.map(t => `<div class="cf-rowitem cf-link" data-ticket="${esc(t.id)}" role="link" tabindex="0"><div><div class="cl-name">${esc(t.folio || "—")}</div><div class="cl-sub">${t.evidencia_count} archivo${t.evidencia_count == 1 ? "" : "s"} · ${esc(t.titulo || "")}</div></div><span class="cl-sub">Abrir ›</span></div>`).join("")}</div>`;
}

export function renderBitacora(rows) {
  if (!rows.length) return emptyBox(
    "Sin actividad en bitácora",
    "Aquí aparecerán los eventos internos relacionados con este cliente (altas, cambios, consolidaciones).",
  );
  return `<div class="cf-list">${rows.map(b => `<div class="cf-rowitem"><div><div class="cl-name">${esc(b.accion || "evento")}</div><div class="cl-sub">${fmtFechaHora(b.fecha)}</div></div></div>`).join("")}</div>`;
}

export function renderConsolidacion(data) {
  const { pend, sugeridos } = data;
  if (!pend.length && !sugeridos.length) return emptyBox(
    "Nada pendiente de consolidación",
    "Aquí aparecerán los tickets cuya identidad capturada sugiere a este cliente y los tickets propios pendientes de confirmar.",
    '<a class="btn btn-ghost" href="consolidacion-clientes.html">Ir a la cola de consolidación</a>',
  );
  return `${sugeridos.length ? `<h3>Tickets que sugieren a este cliente</h3><div class="cf-list" style="margin:8px 0 14px">${sugeridos.map(t => `<div class="cf-rowitem cf-link" data-ticket="${esc(t.id)}" role="link" tabindex="0"><div><div class="cl-name">${esc(t.folio || "—")} · ${esc(t.nombre_capturado || t.empresa_capturada || "—")}</div><div class="cl-sub">${matchTag(t.match_nivel)} score ${t.match_score ?? "—"} · ${fmtFecha(t.fecha_creacion)}</div></div><span class="cl-sub">Abrir ›</span></div>`).join("")}</div>` : ""}
  ${pend.length ? `<h3>Tickets del cliente pendientes</h3><div class="cf-list" style="margin-top:8px">${pend.map(t => `<div class="cf-rowitem cf-link" data-ticket="${esc(t.id)}" role="link" tabindex="0"><div><div class="cl-name">${esc(t.folio || "—")} · ${esc(t.titulo || "")}</div><div class="cl-sub">${estadoTag(t.estado)}</div></div><span class="cl-sub">Abrir ›</span></div>`).join("")}</div>` : ""}
  <p class="mut" style="margin-top:10px">La cola de <a href="consolidacion-clientes.html">Consolidación</a> presenta análisis y vista previa. La ejecución permanece deshabilitada hasta contar con un backend transaccional verificado.</p>`;
}
