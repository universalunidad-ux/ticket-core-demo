/* ============================================================================
   B19D — DASHBOARD por rol (admin / soporte).
   - Nav canónica compartida (shared/nav-interna.js) con sesión obligatoria.
   - KPI rail compacto: counts head:true baratos, render progresivo con
     Promise.allSettled (una falla no bloquea el resto), cache breve en memoria
     de sesión para volver al dashboard sin repetir counts.
   - Rol soporte: SOLO sus consultas (nunca las globales de admin).
   - Administración (solo admin): tabs lazy con estado en hash. Nada de esto
     se carga en el arranque operativo.
   - site_config: NO se consulta al arrancar. Solo al abrir Personalización,
     con capability check único por sesión (config-loader.js). Si no existe:
     defaults locales, editor deshabilitado y aviso administrativo.
   - Adaptador para vistas B19B (v_janome_dashboard_agentes /
     v_janome_productos_metricas) SIN asumir que están desplegadas: se prueban
     una vez por sesión; si no existen, "Métrica pendiente de activación"
     (solo admin, nunca como KPI roto).
   ============================================================================ */
import { supabase, esc } from "./supabase.js";
import { mountNav } from "./shared/nav-interna.js";
import { ticketStateLabel, ticketStateCls, ago } from "./global.js";
import { perfPrimaryDone, perfSecondaryDone, perfPageReady, perfCountRequest } from "./shared/perf.js";

const $ = (q, c = document) => c.querySelector(q);
const OPEN_STATES = ["abierto", "en_proceso", "esperando_cliente"];
const CTX = { rol: "soporte", isAdmin: false, me: null, nombre: "" };
const busy = new Set(); // guardas anti doble-submit por acción
let AGENT_ROWS = [];
const metricValue=(row,...keys)=>{for(const k of keys)if(row?.[k]!==undefined&&row?.[k]!==null)return row[k];return null};
const AGENT_METRICS = [
  ["Tickets activos","tickets_abiertos"],
  ["Abiertos","abiertos"],
  ["En proceso","en_proceso"],
  ["Esperando cliente","esperando_cliente"],
  ["Cerrados / resueltos","cerrados_o_resueltos"],
  ["Alta / urgente","alta_urgente_abiertos"],
  ["SLA 1ª respuesta vencida","primera_respuesta_vencida"],
  ["SLA resolución vencida","resolucion_vencida"],
  ["Supervisiones pendientes","pendientes_supervision"]
];
const agentMetricHtml=(row,def)=>{const v=metricValue(row,...def.slice(1));return `<span class="dash-agent-metric"><span>${esc(String(def[0]??""))}</span><b>${v==null?"—":esc(String(v))}</b></span>`};

function openAgent(row){
  if(!CTX.isAdmin)return;
  $("#dashAgentTitle").textContent=row.agente_nombre||"Agente";
  $("#dashAgentDetail").innerHTML=AGENT_METRICS.map(d=>agentMetricHtml(row,d)).join("");
  const id=row.agente_id||row.id||row.perfil_id;
  $("#dashAgentTickets").href=id?`tickets.html?assignee=${encodeURIComponent(id)}`:"tickets.html";
  $("#dashAgentModal").hidden=false;
}

async function loadAgentSummary(){
  if(!CTX.isAdmin)return;
  const box=$("#dashAgentGrid");
  try{
    perfCountRequest();
    const {data,error}=await supabase.from("v_tickets_agente_resumen").select("*").order("agente_nombre",{ascending:true});
    if(error)throw error;
    AGENT_ROWS=(data||[]).filter(r=>String(r.agente_rol||"").toLowerCase()==="soporte");
    box.innerHTML=AGENT_ROWS.length?AGENT_ROWS.map((r,i)=>`<button class="dash-agent-card" type="button" data-agent-row="${i}"><span class="dash-agent-head"><b>${esc(r.agente_nombre||"Agente")}</b><span class="tag">${esc(r.agente_rol||"—")}</span></span><span class="dash-agent-metrics">${AGENT_METRICS.map(d=>agentMetricHtml(r,d)).join("")}</span></button>`).join(""):'<div class="empty-state">Sin agentes en el resumen.</div>';
  }catch(e){box.innerHTML='<div class="empty-state">No se pudo cargar el resumen de agentes.</div>';console.error("AGENT_SUMMARY_LOAD_ERROR")}
}

/* ---------- cache breve de métricas (volver al dashboard sin repetir counts) ---------- */
const MCACHE_KEY = "tc_dash_metrics";
const MCACHE_TTL = 60_000;
const mcacheGet = (rol) => {
  try {
    const raw = JSON.parse(sessionStorage.getItem(MCACHE_KEY) || "null");
    if (raw && raw.rol === rol && Date.now() - raw.ts < MCACHE_TTL) return raw.data;
  } catch { /* noop */ }
  return null;
};
const mcacheSet = (rol, data) => {
  try { sessionStorage.setItem(MCACHE_KEY, JSON.stringify({ rol, ts: Date.now(), data })); } catch { /* noop */ }
};

/* ---------- helpers de consulta (counts baratos, nunca inventar números) ---------- */
const t = () => supabase.from("tickets");
const BASE = { count: "exact", head: true };
const cnt = (build) => { perfCountRequest(); return build.then(r => (r.error ? null : (r.count ?? 0))).catch(() => null); };

/* ---------- KPI rail ---------- */
/* label con salto controlado (br autorizado, sin cortar palabras) */
const KPI_DEF = {
  abiertos:   { label: "Abiertos", href: "tickets.html?state=abierto" },
  proceso:    { label: "En proceso", href: "tickets.html?state=en_proceso" },
  esperando:  { label: "Esperando<br>cliente", href: "tickets.html?state=esperando_cliente" },
  resueltos:  { label: "Resueltos", href: "tickets.html?state=resuelto" },
  sinAsignar: { label: "Sin asignar", warnIf: v => v > 0 },
  urgentes:   { label: "Alta / urgente", href: "tickets.html?priority=urgente", warnIf: v => v > 0 },
  hoyN:       { label: "Creados hoy" },
  semana:     { label: "Creados<br>esta semana" },
  consolidar: { label: "Por consolidar", href: "consolidacion-clientes.html", warnIf: v => v > 0 },
  slaPR:      { label: "SLA 1ª respuesta<br>vencido", badIf: v => v > 0 },
  slaRes:     { label: "SLA resolución<br>vencido", badIf: v => v > 0 },
  misAbiertos:  { label: "Mis tickets<br>abiertos", href: "tickets.html" },
  misEsperando: { label: "Esperando<br>cliente", href: "tickets.html?state=esperando_cliente" },
  misUrgentes:  { label: "Alta / urgente", href: "tickets.html?priority=urgente", warnIf: v => v > 0 },
  misCerrables: { label: "Cerrables<br>(resueltos)", href: "tickets.html?state=resuelto" },
  misPorVencer: { label: "Próximos<br>a vencer", warnIf: v => v > 0 },
};
const ADMIN_RAIL = ["abiertos", "proceso", "esperando", "resueltos", "sinAsignar", "urgentes", "hoyN", "semana", "consolidar", "slaPR", "slaRes"];
const SOPORTE_RAIL = ["misAbiertos", "misEsperando", "misUrgentes", "misPorVencer", "misCerrables", "consolidar"];

const kpiHtml = (key, v, skel = false) => {
  const d = KPI_DEF[key] || { label: key };
  const val = v === null || v === undefined ? "—" : String(v);
  const tone = skel ? "is-skel" : v == null ? "" : d.badIf?.(v) ? "is-bad" : d.warnIf?.(v) ? "is-warn" : "";
  const inner = `<span class="kk">${d.label}</span><span class="kv">${skel ? "…" : esc(val)}</span>`;
  const title = v === null ? ' title="No disponible (permisos o error de consulta)"' : "";
  return d.href && !skel && v != null
    ? `<a class="kpi ${tone}" href="${esc(d.href)}"${title}>${inner}</a>`
    : `<article class="kpi ${tone}"${title}>${inner}</article>`;
};

const renderRail = (keys, M, skel = false) => {
  const rail = $("#kpiRail");
  if (rail) rail.innerHTML = keys.map(k => kpiHtml(k, skel ? null : M?.[k] ?? null, skel)).join("");
};

/* ---------- métricas por rol ---------- */
async function loadMetrics() {
  const keys = CTX.isAdmin ? ADMIN_RAIL : SOPORTE_RAIL;
  const cached = mcacheGet(CTX.rol);
  if (cached) { renderRail(keys, cached); renderMiCarga(cached); perfPrimaryDone(); return cached; }
  renderRail(keys, null, true);

  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const iniSemana = new Date(hoy); iniSemana.setDate(hoy.getDate() - ((hoy.getDay() + 6) % 7));
  const nowIso = new Date().toISOString();
  const soonIso = new Date(Date.now() + 24 * 3600e3).toISOString();
  const me = CTX.me;

  const jobs = {};
  if (CTX.isAdmin) {
    jobs.abiertos = cnt(t().select("id", BASE).eq("estado", "abierto"));
    jobs.proceso = cnt(t().select("id", BASE).eq("estado", "en_proceso"));
    jobs.esperando = cnt(t().select("id", BASE).eq("estado", "esperando_cliente"));
    jobs.resueltos = cnt(t().select("id", BASE).eq("estado", "resuelto"));
    jobs.sinAsignar = cnt(t().select("id", BASE).is("asignado_a", null).in("estado", OPEN_STATES));
    jobs.urgentes = cnt(t().select("id", BASE).in("prioridad", ["alta", "urgente"]).in("estado", OPEN_STATES));
    jobs.hoyN = cnt(t().select("id", BASE).gte("fecha_creacion", hoy.toISOString()));
    jobs.semana = cnt(t().select("id", BASE).gte("fecha_creacion", iniSemana.toISOString()));
    jobs.consolidar = cnt(t().select("id", BASE).eq("requiere_consolidacion", true).neq("estado", "cerrado"));
    jobs.slaPR = cnt(t().select("id", BASE).lt("sla_first_response_deadline", nowIso).eq("estado", "abierto"));
    jobs.slaRes = cnt(t().select("id", BASE).lt("sla_resolution_deadline", nowIso).in("estado", OPEN_STATES));
  }
  if (me) {
    jobs.misAbiertos = cnt(t().select("id", BASE).eq("asignado_a", me).in("estado", OPEN_STATES));
    jobs.misEsperando = cnt(t().select("id", BASE).eq("asignado_a", me).eq("estado", "esperando_cliente"));
    jobs.misUrgentes = cnt(t().select("id", BASE).eq("asignado_a", me).in("prioridad", ["alta", "urgente"]).in("estado", OPEN_STATES));
    jobs.misCerrables = cnt(t().select("id", BASE).eq("asignado_a", me).eq("estado", "resuelto"));
    jobs.misPorVencer = cnt(t().select("id", BASE).eq("asignado_a", me).lt("sla_resolution_deadline", soonIso).in("estado", OPEN_STATES));
    if (!CTX.isAdmin) jobs.consolidar = cnt(t().select("id", BASE).eq("requiere_consolidacion", true).neq("estado", "cerrado"));
  }

  const names = Object.keys(jobs);
  const settled = await Promise.allSettled(names.map(k => jobs[k]));
  const M = Object.fromEntries(names.map((k, i) => [k, settled[i].status === "fulfilled" ? settled[i].value : null]));
  renderRail(keys, M);
  renderMiCarga(M);
  mcacheSet(CTX.rol, M);
  perfPrimaryDone();
  return M;
}

/* ---------- Mi carga (compacta, sin duplicar los KPIs del rail admin) ---------- */
function renderMiCarga(M) {
  const box = $("#dashMiKpis");
  if (!box) return;
  if (!CTX.me) { $("#dashMiCarga")?.classList.add("hidden"); return; }
  const items = CTX.isAdmin
    ? [["Mis abiertos", M.misAbiertos], ["Esperando cliente", M.misEsperando], ["Alta / urgente", M.misUrgentes], ["Próximos a vencer", M.misPorVencer]]
    : [["Cerrables", M.misCerrables], ["Próximos a vencer", M.misPorVencer]];
  box.innerHTML = items.map(([k, v]) =>
    `<article class="kpi ${v > 0 && /vencer|urgente/i.test(k) ? "is-warn" : ""}"><span class="kk">${esc(k)}</span><span class="kv">${v == null ? "—" : v}</span></article>`).join("");
  if (!CTX.isAdmin) $("#dashMiCarga .section-head h2") && ($("#dashMiCarga .section-head h2").textContent = "Mi resumen");
}

/* ---------- Actividad reciente (1 consulta pequeña + nombres de agentes en lote) ---------- */
async function loadActividad() {
  const box = $("#dashActividad");
  if (!box) return;
  try {
    perfCountRequest();
    let q = supabase.from("tickets")
      .select("id,folio,titulo,estado,asignado_a,fecha_actualizacion")
      .order("fecha_actualizacion", { ascending: false }).limit(8);
    if (!CTX.isAdmin && CTX.me) q = q.eq("asignado_a", CTX.me); // actividad propia para soporte
    const { data, error } = await q;
    if (error) throw error;
    const rows = data || [];
    let agentes = {};
    const aids = [...new Set(rows.map(x => x.asignado_a).filter(Boolean))];
    if (CTX.isAdmin && aids.length) {
      perfCountRequest();
      const r = await supabase.from("perfiles").select("id,nombre").in("id", aids);
      agentes = Object.fromEntries((r.data || []).map(p => [p.id, p.nombre || "Agente"]));
    }
    box.innerHTML = rows.length ? rows.map(x => `
      <a class="dash-act-row" href="ticket.html?id=${encodeURIComponent(x.id)}">
        <span class="dash-act-folio">${esc(x.folio || "—")}</span>
        <span class="dash-act-title">${esc(x.titulo || "Sin título")}${CTX.isAdmin && x.asignado_a ? `<span class="mut"> · ${esc(agentes[x.asignado_a] || "Agente")}</span>` : ""}</span>
        <span class="dash-act-meta"><span class="tag ${ticketStateCls(x.estado)}">${esc(ticketStateLabel(x.estado))}</span><span class="dash-act-when">${esc(ago(x.fecha_actualizacion))}</span></span>
      </a>`).join("")
      : `<div class="empty-state">${CTX.isAdmin ? "Sin actividad reciente." : "Aún no tienes tickets asignados con actividad."}</div>`;
  } catch {
    box.innerHTML = '<div class="empty-state">No se pudo cargar la actividad. <button class="mini btn-ghost" id="dashActRetry" type="button">Reintentar</button></div>';
    $("#dashActRetry")?.addEventListener("click", loadActividad);
  }
}

/* ---------- Adaptador de vistas B19B (sin asumir despliegue) ---------- */
const VIEW_CAP_KEY = "tc_cap_dashviews";
async function loadViewMetrics() {
  if (!CTX.isAdmin) return;
  const rail = $("#kpiRail");
  if (!rail) return;
  let cap = null;
  try { cap = sessionStorage.getItem(VIEW_CAP_KEY); } catch { /* noop */ }
  if (cap === "0") { renderViewsPending(); return; }
  try {
    perfCountRequest();
    const r = await supabase.from("v_janome_dashboard_agentes").select("agente_id,nombre,abiertos").limit(6);
    if (r.error) throw r.error;
    try { sessionStorage.setItem(VIEW_CAP_KEY, "1"); } catch { /* noop */ }
    if ((r.data || []).length) {
      const el = document.createElement("div");
      el.className = "kpi-pending";
      el.innerHTML = `<b>Carga por agente:</b> ${r.data.map(a => `${esc(a.nombre || "Agente")} ${a.abiertos ?? 0}`).join(" · ")}`;
      rail.appendChild(el);
    }
  } catch {
    try { sessionStorage.setItem(VIEW_CAP_KEY, "0"); } catch { /* noop */ }
    renderViewsPending();
  }
}
function renderViewsPending() {
  /* Estado administrativo discreto: nunca un KPI roto ni jerga de BD al usuario. */
  const rail = $("#kpiRail");
  if (!rail || rail.querySelector("[data-views-pending]")) return;
  const el = document.createElement("div");
  el.className = "kpi-pending";
  el.setAttribute("data-views-pending", "1");
  el.textContent = "Las métricas complementarias estarán disponibles al completar su integración operativa.";
  rail.appendChild(el);
}

/* ============================================================================
   ADMINISTRACIÓN — tabs lazy con estado en hash (#admin/<tab>)
   ============================================================================ */
const ADM = { current: "", mounted: {} };
const admHash = tab => `#admin${tab ? "/" + tab : ""}`;

function openAdmin(tab, push = true) {
  if (!CTX.isAdmin) return;
  const sec = $("#dashAdmin");
  sec?.classList.remove("hidden");
  tab = ["avisos", "personalizacion", "reglas", "bitacora"].includes(tab) ? tab : "avisos";
  ADM.current = tab;
  document.querySelectorAll("#admTabs .adm-tab").forEach(b => b.classList.toggle("is-active", b.dataset.adm === tab));
  document.querySelectorAll("#admPanel [data-adm-panel]").forEach(p => p.classList.toggle("hidden", p.dataset.admPanel !== tab));
  if (!ADM.mounted[tab]) {
    ADM.mounted[tab] = true;
    const host = document.createElement("div");
    host.dataset.admPanel = tab;
    if ($("#admPanel > .mut")) $("#admPanel").innerHTML = "";
    $("#admPanel").appendChild(host);
    document.querySelectorAll("#admPanel [data-adm-panel]").forEach(p => p.classList.toggle("hidden", p.dataset.admPanel !== tab));
    ({ avisos: mountAvisos, personalizacion: mountConfig, reglas: mountReglas, bitacora: mountBitacora }[tab])(host);
  }
  if (push && location.hash !== admHash(tab)) history.replaceState(null, "", admHash(tab));
  sec?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function bindAdmin() {
  $("#admTabs")?.addEventListener("click", e => {
    const b = e.target.closest(".adm-tab");
    if (b) openAdmin(b.dataset.adm);
  });
  window.addEventListener("hashchange", () => {
    const m = location.hash.match(/^#admin(?:\/(\w+))?/);
    if (m) openAdmin(m[1] || ADM.current || "avisos", false);
  });
  const m = location.hash.match(/^#admin(?:\/(\w+))?/);
  if (m) openAdmin(m[1] || "avisos", false);
}

/* ============================================================================
   AVISOS DEL SITIO (solo admin) — blindado: validación, guard pesimista,
   sin doble submit, confirmación al eliminar, errores específicos, retry.
   ============================================================================ */
const LIM = { titulo: 80, mensaje: 240 };
const COLORS = [["info", "Azul (informativo)"], ["success", "Verde (todo bien)"], ["warning", "Amarillo (preventivo)"], ["danger", "Rojo (importante)"], ["mantenimiento", "Gris (mantenimiento)"]];
const CLASE = { info: "info", success: "ok", warning: "warn", danger: "danger", mantenimiento: "warn" };
const ICON = { info: "ℹ️", success: "✅", warning: "⏳", danger: "⚠️", mantenimiento: "🛠️" };
const avToast = (t, cls = "") => { const s = $("#avMsg"); if (s) { s.textContent = t; s.className = `mut ${cls}`.trim(); } };
const errText = (error, accion) => {
  const m = String(error?.message || "");
  if (/permission|policy|RLS|denied|42501/i.test(m)) return `No tienes permisos para ${accion} (política RLS de administrador).`;
  if (/network|Failed to fetch/i.test(m)) return "Sin conexión con el servidor. Verifica tu red e inténtalo de nuevo.";
  return `No se pudo ${accion}. ${m ? "Detalle: " + m.slice(0, 120) : ""}`.trim();
};

const avPreviewHtml = () => {
  const tipo = $("#avColor")?.value || "info";
  const tit = ($("#avTitulo")?.value || "").trim() || "Título del aviso";
  const txt = ($("#avMensaje")?.value || "").trim() || "Aquí va el mensaje que verán los visitantes.";
  return `<div class="support-global-notice ${CLASE[tipo] || "info"}"><div class="notice-ic">${ICON[tipo] || "ℹ️"}</div><div class="notice-copy"><div class="notice-title">${esc(tit)}</div><div class="notice-text">${esc(txt)}</div></div></div>`;
};
const avSyncPreview = () => {
  const p = $("#avPreview"); if (p) p.innerHTML = avPreviewHtml();
  const ct = $("#avTituloCount"); if (ct) ct.textContent = `${($("#avTitulo")?.value || "").length}/${LIM.titulo}`;
  const cm = $("#avMensajeCount"); if (cm) cm.textContent = `${($("#avMensaje")?.value || "").length}/${LIM.mensaje}`;
};

async function avListar() {
  perfCountRequest();
  const { data, error } = await supabase.from("avisos_globales")
    .select("id,titulo,contenido,tipo,activo,mostrar_en_soporte,prioridad,starts_at,ends_at")
    .order("prioridad", { ascending: true }).limit(20);
  if (error) return { error };
  return { data: data || [] };
}
async function avRefrescar() {
  const cont = $("#avLista"); if (!cont) return;
  cont.innerHTML = '<div class="dash-skel"></div>';
  const r = await avListar();
  if (r.error) { cont.innerHTML = `<div class="empty-state">${esc(errText(r.error, "leer los avisos"))} <button class="mini btn-ghost" id="avRetry" type="button">Reintentar</button></div>`; $("#avRetry")?.addEventListener("click", avRefrescar); return; }
  cont.innerHTML = r.data.length ? r.data.map(a => `<div class="av-item">
      <div class="support-global-notice ${CLASE[a.tipo] || "info"}" style="margin:0"><div class="notice-ic">${ICON[a.tipo] || "ℹ️"}</div>
        <div class="notice-copy"><div class="notice-title">${esc(a.titulo || "")}</div><div class="notice-text">${esc(a.contenido || "")}</div></div></div>
      <div class="av-item-meta">${a.activo ? '<span class="tag ok">Activo</span>' : '<span class="tag">Inactivo</span>'}<span class="tag">${a.mostrar_en_soporte ? "Visible en soporte" : "Oculto"}</span>
        <button class="mini btn-ghost" type="button" data-av-toggle="${a.id}" data-on="${a.activo ? 1 : 0}">${a.activo ? "Desactivar" : "Activar"}</button>
        <button class="mini btn-ghost" type="button" data-av-del="${a.id}">Eliminar</button></div>
    </div>`).join("") : '<div class="empty-state">Aún no hay avisos. Crea el primero con el formulario.</div>';
}
async function avPublicar() {
  if (busy.has("avPub")) return;
  const titulo = ($("#avTitulo")?.value || "").trim();
  const contenido = ($("#avMensaje")?.value || "").trim();
  const tipo = $("#avColor")?.value || "info";
  const mostrar = !!$("#avMostrar")?.checked;
  if (!titulo) return avToast("Escribe un título.", "bad");
  if (!contenido) return avToast("Escribe el mensaje: no se publica un aviso vacío.", "bad");
  if (titulo.length > LIM.titulo) return avToast(`El título no debe pasar de ${LIM.titulo} caracteres.`, "bad");
  if (contenido.length > LIM.mensaje) return avToast(`El mensaje no debe pasar de ${LIM.mensaje} caracteres.`, "bad");
  busy.add("avPub"); const btn = $("#avPublicar"); if (btn) btn.disabled = true;
  avToast("Publicando…");
  try {
    const row = { titulo, contenido, mensaje: contenido, tipo, activo: true, mostrar_en_soporte: mostrar, starts_at: new Date().toISOString(), ends_at: null };
    const { error } = await supabase.from("avisos_globales").insert(row);
    if (error) return avToast(errText(error, "publicar el aviso"), "bad"); /* el formulario NO se pierde */
    try {
      const uid = (await supabase.auth.getUser()).data.user?.id || null;
      await supabase.from("bitacora").insert({ usuario_id: uid, accion: "aviso_publicado", tipo: "nota_interna", detalle: { titulo } });
    } catch { /* bitácora best-effort */ }
    avToast("Aviso publicado y confirmado en base de datos.", "ok"); /* solo tras confirmar */
    $("#avTitulo").value = ""; $("#avMensaje").value = ""; avSyncPreview();
    avRefrescar();
  } finally { busy.delete("avPub"); if (btn) btn.disabled = false; }
}
async function avClick(e) {
  const tg = e.target.closest("[data-av-toggle]");
  if (tg && !busy.has("avTg")) {
    busy.add("avTg"); tg.disabled = true;
    try {
      const on = tg.dataset.on === "1";
      const { error } = await supabase.from("avisos_globales").update({ activo: !on }).eq("id", tg.dataset.avToggle);
      if (error) return avToast(errText(error, "actualizar el aviso"), "bad");
      avToast(on ? "Aviso desactivado." : "Aviso activado.", "ok");
      avRefrescar();
    } finally { busy.delete("avTg"); tg.disabled = false; }
    return;
  }
  const del = e.target.closest("[data-av-del]");
  if (del && !busy.has("avDel")) {
    if (!confirm("¿Eliminar este aviso de forma permanente? Esta acción no se puede deshacer.")) return;
    busy.add("avDel"); del.disabled = true;
    try {
      const { error } = await supabase.from("avisos_globales").delete().eq("id", del.dataset.avDel);
      if (error) return avToast(errText(error, "eliminar el aviso"), "bad");
      avToast("Aviso eliminado.", "ok");
      avRefrescar();
    } finally { busy.delete("avDel"); del.disabled = false; }
  }
}
function mountAvisos(host) {
  host.innerHTML = `
    <p class="mut">Publica un aviso visible para los clientes en la página de soporte (mantenimiento, demoras, promociones). Solo administradores.</p>
    <div class="av-grid" style="margin-top:10px">
      <div class="av-form">
        <div class="field"><label class="lbl" for="avTitulo">Título <span id="avTituloCount" class="av-count">0/${LIM.titulo}</span></label>
          <input class="input" id="avTitulo" maxlength="${LIM.titulo}" placeholder="Ej. Cierre por mantenimiento"></div>
        <div class="field"><label class="lbl" for="avMensaje">Mensaje <span id="avMensajeCount" class="av-count">0/${LIM.mensaje}</span></label>
          <textarea class="area" id="avMensaje" maxlength="${LIM.mensaje}" placeholder="Ej. El taller estará cerrado el 16 de septiembre. Tu caso será atendido al día siguiente."></textarea></div>
        <div class="field"><label class="lbl" for="avColor">Color</label>
          <select class="select" id="avColor">${COLORS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select></div>
        <label class="lbl" style="display:flex;gap:8px;align-items:center;text-transform:none;letter-spacing:0"><input type="checkbox" id="avMostrar" checked> Mostrar en la página de soporte</label>
        <div class="actions"><button class="btn btn-brand" type="button" id="avPublicar">Publicar aviso</button></div>
        <div class="mut" id="avMsg">El aviso aparece arriba del formulario de soporte para todos los visitantes.</div>
      </div>
      <div class="av-preview-wrap">
        <div class="lbl">Vista previa</div>
        <div id="avPreview">${avPreviewHtml()}</div>
        <div class="lbl" style="margin-top:14px">Avisos existentes</div>
        <div id="avLista" class="av-lista"><div class="dash-skel"></div></div>
      </div>
    </div>`;
  ["avTitulo", "avMensaje", "avColor"].forEach(id => { $("#" + id)?.addEventListener("input", avSyncPreview); $("#" + id)?.addEventListener("change", avSyncPreview); });
  $("#avPublicar")?.addEventListener("click", avPublicar);
  host.addEventListener("click", avClick);
  avSyncPreview();
  avRefrescar();
}

/* ============================================================================
   PERSONALIZACIÓN PREMIUM (solo admin) — site_config LAZY.
   config-loader.js se importa DINÁMICAMENTE aquí: durante el arranque operativo
   el dashboard no toca site_config ni genera 404 (capability check único).
   ============================================================================ */
const CFG_GROUPS = [
  {
    titulo: "Soporte público", desc: "Textos que ven los clientes al levantar un caso.",
    keys: [
      { clave: "soporte.hero.kicker", label: "Etiqueta superior", help: "Texto corto arriba del título principal.", multi: false, max: 60 },
      { clave: "soporte.hero.titulo", label: "Título principal", help: "El encabezado grande de la página de soporte.", multi: false, max: 120 },
      { clave: "soporte.ayuda.titulo", label: "Título de «Cómo agilizar»", help: "Encabezado del bloque de consejos.", multi: false, max: 120 },
      { clave: "soporte.evidencia.hint", label: "Ayuda al subir fotos/video", help: "Instrucción junto al cargador de evidencia.", multi: true, max: 400 },
    ],
  },
  {
    titulo: "Seguimiento público", desc: "Textos de la página de seguimiento del ticket.",
    keys: [
      { clave: "estado.reply.titulo", label: "Título de «Responder»", help: "Encabezado del bloque para responder al equipo.", multi: false, max: 120 },
      { clave: "estado.reply.hint", label: "Ayuda al adjuntar archivos", help: "Instrucción del compositor de respuesta.", multi: true, max: 400 },
    ],
  },
];
const CFG_KEYS = CFG_GROUPS.flatMap(g => g.keys);
const sanitizeCfg = (v) => String(v || "")
  .replace(/<[^>]*>/g, "")            /* sin HTML arbitrario: texto plano */
  .replace(/javascript\s*:/gi, "")    /* sin URLs peligrosas */
  .replace(/[\u0000-\u001f\u007f]/g, "") /* sin caracteres de control */
  .trim();

let CFGMOD = null; /* módulo config-loader importado bajo demanda */

async function mountConfig(host) {
  host.innerHTML = '<div class="dash-skel"></div><div class="dash-skel"></div>';
  CFGMOD = CFGMOD || await import("./config-loader.js");
  const disponible = await CFGMOD.probeSiteConfig(); /* 1 request máx. por sesión */
  const cfg = CFGMOD.cfg, defaults = CFGMOD.configDefaults();

  const fieldHtml = (k) => {
    const val = cfg(k.clave, "");
    const id = "sc_" + k.clave.replace(/[^a-z0-9]/gi, "_");
    const ctrl = k.multi
      ? `<textarea class="area" id="${id}" data-cfg-key="${k.clave}" rows="3" maxlength="${k.max}" ${disponible ? "" : "disabled"}>${esc(val)}</textarea>`
      : `<input class="input" id="${id}" data-cfg-key="${k.clave}" maxlength="${k.max}" value="${esc(val)}" ${disponible ? "" : "disabled"}>`;
    return `<div class="sc-field" data-sc-field="${k.clave}">
      <div class="sc-field-head"><label class="lbl" for="${id}">${esc(k.label)} <span class="sc-dirty" title="Cambio sin guardar"></span></label>
        <span><span class="av-count" data-sc-count="${k.clave}">0/${k.max}</span>${disponible ? `<button class="sc-reset" type="button" data-sc-reset="${k.clave}">Restablecer</button>` : ""}</span></div>
      <div class="sc-help">${esc(k.help)} <b>Valor por defecto:</b> “${esc(defaults[k.clave] || "—")}”</div>
      ${ctrl}
    </div>`;
  };

  host.innerHTML = `
    <p class="mut">Edita los textos públicos sin tocar código. Cada cambio queda en bitácora. Texto plano: no se permite HTML ni enlaces con script.</p>
    ${disponible ? "" : `<div class="sc-disabled-note" style="margin-top:10px">
        <b>La personalización remota aún no está activada.</b>
        <span>Los textos públicos usan los valores por defecto locales (idénticos a lo que hoy ven los clientes). La activación requiere crear la tabla <code>site_config</code> en la base de datos — es una tarea administrativa de backend planificada (DDL DRAFT en docs/B20A_SITE_CONFIG_DRAFT.sql); no se hace desde esta pantalla.</span>
      </div>`}
    <div class="av-grid" style="margin-top:12px">
      <div class="av-form" id="scForm">
        ${CFG_GROUPS.map(g => `<div class="sc-group"><h4>${esc(g.titulo)}</h4><div class="sc-help">${esc(g.desc)}</div>${g.keys.map(fieldHtml).join("")}</div>`).join("")}
        <div class="actions">
          <button class="btn btn-brand" type="button" id="scGuardar" ${disponible ? "" : "disabled"}>Guardar cambios</button>
          <button class="btn btn-ghost" type="button" id="scDescartar" ${disponible ? "" : "disabled"}>Descartar</button>
          <button class="btn btn-ghost" type="button" id="scReset" ${disponible ? "" : "disabled"}>Restaurar todos los valores por defecto</button>
        </div>
        <div class="mut" id="scMsg">${disponible ? "Sin cambios pendientes." : "Editor deshabilitado hasta activar la personalización remota."}</div>
      </div>
      <div class="av-preview-wrap">
        <div class="sc-toolbar"><div class="lbl">Vista previa en vivo</div>
          <div class="actions"><button class="mini btn-ghost" type="button" id="scPrevDevice">📱 Móvil</button><button class="mini btn-ghost" type="button" id="scPrevMode">🌓 Oscuro</button></div></div>
        <div class="sc-preview" id="scPreview" data-mode="light">
          <div class="sc-preview-body">
            <div class="sc-mock">
              <div class="section-kicker" data-prev="soporte.hero.kicker">—</div>
              <div style="font-weight:900;font-size:18px" data-prev="soporte.hero.titulo">—</div>
              <div style="font-weight:800;font-size:13px;margin-top:6px" data-prev="soporte.ayuda.titulo">—</div>
              <div class="mut" style="font-size:12.5px" data-prev="soporte.evidencia.hint">—</div>
            </div>
            <div class="sc-mock">
              <div class="section-kicker">Seguimiento del ticket</div>
              <div style="font-weight:800" data-prev="estado.reply.titulo">—</div>
              <div class="mut" style="font-size:12.5px" data-prev="estado.reply.hint">—</div>
            </div>
          </div>
        </div>
      </div>
    </div>`;

  const valOf = clave => sanitizeCfg(host.querySelector(`[data-cfg-key="${clave}"]`)?.value || "");
  const baseOf = clave => cfg(clave, "") || defaults[clave] || "";
  const syncUi = () => {
    let dirty = 0;
    CFG_KEYS.forEach(k => {
      const el = host.querySelector(`[data-cfg-key="${k.clave}"]`);
      const wrap = host.querySelector(`[data-sc-field="${k.clave}"]`);
      const cEl = host.querySelector(`[data-sc-count="${k.clave}"]`);
      if (cEl && el) cEl.textContent = `${el.value.length}/${k.max}`;
      const isDirty = el && sanitizeCfg(el.value) !== String(cfg(k.clave, ""));
      wrap?.classList.toggle("is-dirty", !!isDirty && disponible);
      if (isDirty) dirty++;
      const prev = host.querySelector(`[data-prev="${k.clave}"]`);
      if (prev) prev.textContent = valOf(k.clave) || baseOf(k.clave) || "—";
    });
    const m = $("#scMsg");
    if (m && disponible) m.textContent = dirty ? `${dirty} cambio${dirty === 1 ? "" : "s"} sin guardar.` : "Sin cambios pendientes.";
    return dirty;
  };
  host.querySelectorAll("[data-cfg-key]").forEach(el => el.addEventListener("input", syncUi));
  host.addEventListener("click", e => {
    const rst = e.target.closest("[data-sc-reset]");
    if (rst) {
      const el = host.querySelector(`[data-cfg-key="${rst.dataset.scReset}"]`);
      if (el) { el.value = defaults[rst.dataset.scReset] || ""; syncUi(); }
    }
  });
  $("#scPrevDevice")?.addEventListener("click", () => {
    const p = $("#scPreview"); p?.classList.toggle("is-mobile");
    $("#scPrevDevice").textContent = p?.classList.contains("is-mobile") ? "🖥 Escritorio" : "📱 Móvil";
  });
  $("#scPrevMode")?.addEventListener("click", () => {
    const p = $("#scPreview"); if (!p) return;
    const next = p.dataset.mode === "dark" ? "light" : "dark";
    p.dataset.mode = next;
    $("#scPrevMode").textContent = next === "dark" ? "☀️ Claro" : "🌓 Oscuro";
  });
  $("#scDescartar")?.addEventListener("click", () => {
    CFG_KEYS.forEach(k => { const el = host.querySelector(`[data-cfg-key="${k.clave}"]`); if (el) el.value = cfg(k.clave, ""); });
    syncUi();
  });
  $("#scReset")?.addEventListener("click", () => {
    if (!confirm("¿Restaurar TODOS los textos a sus valores por defecto? Después deberás pulsar «Guardar cambios» para aplicarlos.")) return;
    CFG_KEYS.forEach(k => { const el = host.querySelector(`[data-cfg-key="${k.clave}"]`); if (el) el.value = defaults[k.clave] || ""; });
    syncUi();
  });
  $("#scGuardar")?.addEventListener("click", async () => {
    if (busy.has("scSave")) return;
    const pendientes = [];
    CFG_KEYS.forEach(k => {
      const despues = valOf(k.clave), antes = String(cfg(k.clave, ""));
      if (despues !== antes) pendientes.push({ k, antes, despues });
    });
    if (!pendientes.length) return;
    busy.add("scSave"); $("#scGuardar").disabled = true;
    const m = $("#scMsg"); if (m) m.textContent = "Guardando…";
    try {
      const uid = (await supabase.auth.getUser()).data.user?.id || null;
      let ok = 0;
      for (const p of pendientes) {
        perfCountRequest();
        const { error } = await supabase.from("site_config").upsert({
          clave: p.k.clave, valor: p.despues, pagina: p.k.clave.split(".")[0],
          tipo: "texto", publico: true, actualizado_por: uid, actualizado_en: new Date().toISOString(),
        }, { onConflict: "clave" });
        if (error) { if (m) m.textContent = errText(error, "guardar la personalización"); return; }
        try {
          await supabase.from("bitacora").insert({ usuario_id: uid, accion: "site_config_update", tipo: "nota_interna", detalle: { clave: p.k.clave, antes: p.antes, despues: p.despues } });
        } catch { /* best-effort */ }
        ok++;
      }
      await CFGMOD.loadSiteConfig(true);
      if (m) m.textContent = `Listo: ${ok} cambio${ok === 1 ? "" : "s"} guardado${ok === 1 ? "" : "s"} y registrado${ok === 1 ? "" : "s"} en bitácora.`;
      syncUi();
    } finally { busy.delete("scSave"); $("#scGuardar").disabled = false; }
  });
  syncUi();
}

/* ============================================================================
   REGLAS DE ASIGNACIÓN (solo admin) — configuración futura sin ejecución.
   ============================================================================ */
const COND = [
  ["tipo_maquina", "Producto o familia (overlock, bordadora…)"],
  ["tipo_caso", "Tipo de problema o atención (garantía, refacción…)"],
  ["empresa", "Empresa / cliente (texto)"],
  ["palabra_clave", "Palabra clave en el caso"],
  ["cliente_nuevo", "Cliente nuevo (sin valor)"],
];
let AGENTES = [];
let RG_ROWS = [];
const rgToast = (txt, cls = "") => { const s = $("#rgMsg"); if (s) { s.textContent = txt; s.className = `mut ${cls}`.trim(); } };

async function rgLoad() {
  const cont = $("#rgLista"); if (!cont) return;
  cont.innerHTML = '<div class="dash-skel"></div>';
  perfCountRequest();
  const { data, error } = await supabase.from("reglas_asignacion")
    .select("id,nombre,prioridad,tipo_condicion,valor,agente_id,activo")
    .order("prioridad", { ascending: true }).limit(100);
  if (error) { cont.innerHTML = `<div class="empty-state">${esc(errText(error, "leer las reglas"))} <button class="mini btn-ghost" id="rgRetry" type="button">Reintentar</button></div>`; $("#rgRetry")?.addEventListener("click", rgLoad); return; }
  RG_ROWS = data || [];
  rgRender();
}
const rgShadowed = (r, i) => RG_ROWS.slice(0, i).some(p => p.activo && p.tipo_condicion === r.tipo_condicion && String(p.valor || "").toLowerCase() === String(r.valor || "").toLowerCase());
function rgRender() {
  const cont = $("#rgLista"); if (!cont) return;
  const nombreAg = id => AGENTES.find(a => a.id === id)?.nombre || "—";
  const labelCond = c => (COND.find(x => x[0] === c) || ["", c])[1];
  cont.innerHTML = RG_ROWS.length ? RG_ROWS.map((r, i) => `
    <div class="rg-item">
      <div><b>#${r.prioridad}</b> · ${esc(r.nombre || "")} ${r.activo ? '<span class="tag ok">Activa</span>' : '<span class="tag">Inactiva</span>'}</div>
      <div class="mut">Si <b>${esc(labelCond(r.tipo_condicion))}</b>${r.valor ? ` = “${esc(r.valor)}”` : ""} → <b>${esc(nombreAg(r.agente_id))}</b></div>
      ${r.activo && rgShadowed(r, i) ? '<div class="rg-warn">⚠ Nunca se ejecutará: una regla activa con mayor prioridad ya cubre este mismo criterio y valor.</div>' : ""}
      <div class="av-item-meta">
        <button class="mini btn-ghost" type="button" data-rg-move="${r.id}" data-dir="-1" ${i === 0 ? "disabled" : ""}>▲ Subir</button>
        <button class="mini btn-ghost" type="button" data-rg-move="${r.id}" data-dir="1" ${i === RG_ROWS.length - 1 ? "disabled" : ""}>▼ Bajar</button>
        <button class="mini btn-ghost" type="button" data-rg-toggle="${r.id}" data-on="${r.activo ? 1 : 0}">${r.activo ? "Desactivar" : "Activar"}</button>
        <button class="mini btn-ghost" type="button" data-rg-del="${r.id}">Eliminar</button>
      </div>
    </div>`).join("") : '<div class="empty-state">Aún no hay reglas. Crea la primera con el formulario.</div>';
}
function rgSimula() {
  const maq = ($("#rgSimMaquina")?.value || "").trim().toLowerCase();
  const caso = ($("#rgSimCaso")?.value || "").trim().toLowerCase();
  const emp = ($("#rgSimEmpresa")?.value || "").trim().toLowerCase();
  const out = $("#rgSimOut"); if (!out) return;
  const activas = RG_ROWS.filter(r => r.activo);
  const match = activas.find(r => {
    const v = String(r.valor || "").toLowerCase();
    if (r.tipo_condicion === "tipo_maquina") return maq && maq.includes(v);
    if (r.tipo_condicion === "tipo_caso") return caso && caso.includes(v);
    if (r.tipo_condicion === "empresa") return emp && emp.includes(v);
    if (r.tipo_condicion === "palabra_clave") return v && (maq.includes(v) || caso.includes(v) || emp.includes(v));
    if (r.tipo_condicion === "cliente_nuevo") return false; /* no simulable sin dato real */
    return false;
  });
  const nombreAg = id => AGENTES.find(a => a.id === id)?.nombre || "el agente configurado";
  out.innerHTML = match
    ? `La vista previa dirigiría este ticket a <b>${esc(nombreAg(match.agente_id))}</b> por la regla “${esc(match.nombre)}” (#${match.prioridad}).<br><span class="mut">La vista previa no asigna ni modifica tickets.</span>`
    : `Ninguna regla activa coincide con esos datos.<br><span class="mut">La vista previa no asigna ni modifica tickets.</span>`;
}
async function mountReglas(host) {
  host.innerHTML = '<div class="dash-skel"></div>';
  perfCountRequest();
  const { data } = await supabase.from("perfiles").select("id,nombre,rol").in("rol", ["soporte", "admin"]).order("nombre");
  AGENTES = data || [];
  const ags = AGENTES.length ? AGENTES.map(a => `<option value="${a.id}">${esc(a.nombre || a.id)}</option>`).join("") : '<option value="">(crea perfiles de soporte primero)</option>';
  host.innerHTML = `
    <p class="mut">Define criterios administrativos para la distribución futura. Las reglas están disponibles para configuración; la asignación automática se habilitará al integrar el motor de distribución.</p>
    <div class="av-grid" style="margin-top:10px">
      <div class="av-form">
        <div class="field"><label class="lbl" for="rgNombre">Nombre de la regla</label><input class="input" id="rgNombre" maxlength="80" placeholder="Ej. Overlock → Juan"></div>
        <div class="field"><label class="lbl" for="rgTipo">Criterio</label><select class="select" id="rgTipo">${COND.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select></div>
        <div class="field" id="rgValorField"><label class="lbl" for="rgValor">Valor a comparar</label><input class="input" id="rgValor" maxlength="80" placeholder="Ej. overlock"></div>
        <div class="field"><label class="lbl" for="rgAgente">Asignar a</label><select class="select" id="rgAgente">${ags}</select></div>
        <div class="field"><label class="lbl" for="rgPrioridad">Prioridad (menor = primero)</label><input class="input" id="rgPrioridad" type="number" value="100" min="1"></div>
        <div class="actions"><button class="btn btn-brand" type="button" id="rgCrear">Crear regla</button></div>
        <div class="mut" id="rgMsg">Se advertirá si la regla se solapa con otra existente.</div>
        <div class="rg-test">
          <div class="lbl">Vista previa de reglas</div>
          <div class="form-grid" style="grid-template-columns:1fr 1fr 1fr;gap:8px">
            <input class="input" id="rgSimMaquina" placeholder="Producto o familia">
            <input class="input" id="rgSimCaso" placeholder="Problema o atención">
            <input class="input" id="rgSimEmpresa" placeholder="Empresa">
          </div>
          <button class="mini btn-ghost" type="button" id="rgSimBtn" style="justify-self:start">Probar</button>
          <div class="rg-test-out" id="rgSimOut" aria-live="polite"></div>
        </div>
      </div>
      <div class="av-preview-wrap"><div class="lbl">Reglas existentes</div><div id="rgLista" class="av-lista"><div class="dash-skel"></div></div></div>
    </div>`;
  const toggleValor = () => $("#rgValorField")?.classList.toggle("hidden", $("#rgTipo")?.value === "cliente_nuevo");
  $("#rgTipo")?.addEventListener("change", toggleValor);
  $("#rgSimBtn")?.addEventListener("click", rgSimula);
  $("#rgCrear")?.addEventListener("click", async () => {
    if (busy.has("rgNew")) return;
    const nombre = ($("#rgNombre")?.value || "").trim();
    const tipo = $("#rgTipo")?.value || "tipo_maquina";
    const valor = ($("#rgValor")?.value || "").trim();
    const agente_id = $("#rgAgente")?.value || "";
    const prioridad = parseInt($("#rgPrioridad")?.value || "100", 10) || 100;
    if (!nombre) return rgToast("Ponle un nombre a la regla.", "bad");
    if (!agente_id) return rgToast("Elige a quién se asigna.", "bad");
    if (tipo !== "cliente_nuevo" && !valor) return rgToast("Escribe el valor a comparar.", "bad");
    const dup = RG_ROWS.find(r => r.tipo_condicion === tipo && String(r.valor || "").toLowerCase() === valor.toLowerCase());
    if (dup && !confirm(`Ya existe la regla “${dup.nombre}” con el mismo criterio y valor (prioridad #${dup.prioridad}). ¿Crear de todas formas?`)) return;
    busy.add("rgNew"); $("#rgCrear").disabled = true;
    rgToast("Guardando…");
    try {
      const { error } = await supabase.from("reglas_asignacion").insert({ nombre, tipo_condicion: tipo, valor: tipo === "cliente_nuevo" ? null : valor, agente_id, prioridad, activo: true });
      if (error) return rgToast(errText(error, "guardar la regla"), "bad");
      rgToast("Regla creada.", "ok");
      $("#rgNombre").value = ""; $("#rgValor").value = "";
      rgLoad();
    } finally { busy.delete("rgNew"); $("#rgCrear").disabled = false; }
  });
  host.addEventListener("click", async e => {
    const mv = e.target.closest("[data-rg-move]");
    if (mv && !busy.has("rgMv")) {
      const i = RG_ROWS.findIndex(r => String(r.id) === mv.dataset.rgMove);
      const j = i + Number(mv.dataset.dir);
      if (i < 0 || j < 0 || j >= RG_ROWS.length) return;
      busy.add("rgMv");
      try {
        const a = RG_ROWS[i], b = RG_ROWS[j];
        /* intercambio de prioridades: dos updates puntuales, sin drag inseguro */
        const r1 = await supabase.from("reglas_asignacion").update({ prioridad: b.prioridad }).eq("id", a.id);
        const r2 = await supabase.from("reglas_asignacion").update({ prioridad: a.prioridad }).eq("id", b.id);
        if (r1.error || r2.error) rgToast(errText(r1.error || r2.error, "reordenar"), "bad");
        rgLoad();
      } finally { busy.delete("rgMv"); }
      return;
    }
    const tg = e.target.closest("[data-rg-toggle]");
    if (tg) {
      const { error } = await supabase.from("reglas_asignacion").update({ activo: tg.dataset.on !== "1" }).eq("id", tg.dataset.rgToggle);
      if (error) return rgToast(errText(error, "actualizar la regla"), "bad");
      return rgLoad();
    }
    const del = e.target.closest("[data-rg-del]");
    if (del) {
      if (!confirm("¿Eliminar esta regla de forma permanente?")) return;
      const { error } = await supabase.from("reglas_asignacion").delete().eq("id", del.dataset.rgDel);
      if (error) return rgToast(errText(error, "eliminar la regla"), "bad");
      return rgLoad();
    }
  });
  toggleValor();
  rgLoad();
}

/* ---------- Bitácora (solo admin, lazy, lectura ligera) ---------- */
async function mountBitacora(host) {
  host.innerHTML = '<div class="dash-skel"></div>';
  perfCountRequest();
  const { data, error } = await supabase.from("bitacora").select("accion,tipo,fecha").order("fecha", { ascending: false }).limit(25);
  if (error) { host.innerHTML = `<div class="empty-state">${esc(errText(error, "leer la bitácora"))}</div>`; return; }
  host.innerHTML = `<p class="mut">Últimos 25 eventos administrativos y operativos registrados.</p>
    <div class="adm-log" style="margin-top:10px">${(data || []).length
      ? data.map(b => `<div class="adm-log-row"><span>${esc(b.accion || "evento")}${b.tipo ? ` <span class="mut">· ${esc(b.tipo)}</span>` : ""}</span><span class="mut">${esc(ago(b.fecha))}</span></div>`).join("")
      : '<div class="empty-state">Sin eventos en bitácora.</div>'}</div>`;
}

/* ============================================================================
   INIT
   ============================================================================ */
async function init() {
  const ctx = await mountNav("dashboard");
  if (!ctx) return; /* guardSession redirige a index.html */
  CTX.rol = ctx.rol;
  CTX.isAdmin = ["admin", "jefe", "owner", "administrador"].includes(ctx.rol);
  CTX.me = ctx.perfil?.id || ctx.user?.id || null;
  CTX.nombre = ctx.perfil?.nombre || "";

  const badge = $("#dashRoleBadge");
  if (badge) badge.textContent = CTX.isAdmin ? "Administrador" : "Soporte";
  const scope = $("#dashScope");
  if (scope) scope.textContent = CTX.isAdmin ? "Toda la operación" : "Mis casos asignados";
  if (!CTX.isAdmin) {
    const t1 = $("#dashTitle"); if (t1) t1.textContent = `Tu mesa de soporte${CTX.nombre ? ", " + String(CTX.nombre).split(" ")[0] : ""}`;
    const l1 = $("#dashLead"); if (l1) l1.textContent = "Atiende tus casos asignados, responde a tiempo y vigila tus compromisos de servicio.";
    const act = $("#dashActTitle"); if (act) act.textContent = "Mi actividad reciente";
    document.querySelectorAll(".dash-admin-only").forEach(el => el.classList.add("hidden"));
  } else {
    $("#dashAdmin")?.classList.remove("hidden");
    $("#dashAgents")?.classList.remove("hidden");
    $("#dashAgentGrid")?.addEventListener("click",e=>{const b=e.target.closest("[data-agent-row]");if(b)openAgent(AGENT_ROWS[Number(b.dataset.agentRow)])});
    const closeAgent=()=>{$("#dashAgentModal").hidden=true};
    $("#dashAgentClose")?.addEventListener("click",closeAgent);
    $("#dashAgentModal")?.addEventListener("click",e=>{if(e.target.id==="dashAgentModal")closeAgent()});
    bindAdmin();
  }

  /* Progresivo: KPIs primero; actividad y adaptador de vistas después. */
  await loadMetrics();
  perfPageReady();
  Promise.allSettled([loadActividad(), loadAgentSummary()]).then(perfSecondaryDone);
}

document.addEventListener("DOMContentLoaded", init);
