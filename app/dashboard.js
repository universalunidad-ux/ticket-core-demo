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
import { mountNav } from "./shared/nav-interna.js?v=frontend-final-20260716-01";
import { ticketStateLabel, ticketStateCls, ago, prettyBytes, setRailOpenCount } from "./global.js?v=frontend-final-20260716-01";
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
  }catch(e){box.innerHTML='<div class="empty-state">No se pudo cargar el resumen de agentes.</div>';console.error("AGENT_SUMMARY_LOAD_ERROR",e)}
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
  if (cached) { renderRail(keys, cached); renderMiCarga(cached);setRailOpenCount(CTX.isAdmin?[cached.abiertos,cached.proceso,cached.esperando,cached.resueltos].reduce((a,v)=>a+(Number(v)||0),0):(Number(cached.misAbiertos)||0)+(Number(cached.misCerrables)||0)); perfPrimaryDone(); return cached; }
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
  setRailOpenCount(CTX.isAdmin?[M.abiertos,M.proceso,M.esperando,M.resueltos].reduce((a,v)=>a+(Number(v)||0),0):(Number(M.misAbiertos)||0)+(Number(M.misCerrables)||0));
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

/* ---------- Supervisión pendiente (misma recarga central, sin polling adicional) ---------- */
async function loadSupervision(){
  if(!CTX.isAdmin){$("#dashSupervision")?.classList.add("hidden");return}
  const box=$("#dashSupervisionList");
  if(!box)return;
  try{
    perfCountRequest();
    let q=supabase.from("tickets").select("id,folio,titulo,tipo,cliente_id,requiere_supervision_en,asignado_a,prioridad").eq("requiere_supervision",true).order("requiere_supervision_en",{ascending:false}).limit(8);
    if(!CTX.isAdmin&&CTX.me)q=q.eq("asignado_a",CTX.me);
    const{data,error}=await q;
    if(error)throw error;
    const rows=data||[],ticketIds=rows.map(x=>x.id),profileIds=[...new Set(rows.map(x=>x.asignado_a).filter(Boolean))],clientIds=[...new Set(rows.map(x=>x.cliente_id).filter(Boolean))];
    let agentes={},clientes={},events=[];
    if(ticketIds.length){perfCountRequest();const r=await supabase.from("ticket_eventos").select("id,ticket_id,created_at,created_by,texto,meta").in("ticket_id",ticketIds).order("created_at",{ascending:false}).limit(48);if(!r.error)events=(r.data||[]).filter(x=>x.meta?.requires_admin_review);profileIds.push(...events.map(x=>x.created_by).filter(Boolean));}
    const uniqueProfiles=[...new Set(profileIds)];
    if(uniqueProfiles.length){perfCountRequest();const r=await supabase.from("perfiles").select("id,nombre").in("id",uniqueProfiles);if(!r.error)agentes=Object.fromEntries((r.data||[]).map(p=>[p.id,p.nombre||"Agente"]));}
    if(clientIds.length){perfCountRequest();const r=await supabase.from("clientes").select("id,nombre").in("id",clientIds);if(!r.error)clientes=Object.fromEntries((r.data||[]).map(c=>[c.id,c.nombre||"Cliente"]));}
    const latest={};events.forEach(e=>{if(!latest[e.ticket_id])latest[e.ticket_id]=e});
    const typeLabel=e=>e?.meta?.content_type==="image"?"Imagen":e?.meta?.content_type==="file"?"Archivo":"Texto";
    const headline=e=>e?.meta?.content_type==="image"?"Imagen enviada a supervisión":e?.meta?.content_type==="file"?"Archivo enviado a supervisión":"Mensaje enviado a supervisión";
    const imageRows=[];
    box.innerHTML=rows.length?rows.map((x,i)=>{const e=latest[x.id],file=e?.meta?.ref_archivo_meta||{},isImage=e?.meta?.content_type==="image",path=isImage?String(file.storage_path||""):"",messagePreview=e?.meta?.content_type==="text"?String(e?.meta?.comentario||e?.texto||"").replace(/\s+/g," ").trim().slice(0,220):"";if(path)imageRows.push({i,path});return`<article class="dash-supervision-card"><div class="dash-supervision-thumb${isImage?" is-image":""}" data-supervision-thumb="${i}" aria-label="${esc(typeLabel(e))}">${isImage?"▧":e?.meta?.content_type==="file"?"▣":"T"}</div><div class="dash-supervision-main"><div class="dash-supervision-title"><b>${esc(headline(e))}</b><span class="tag info">${esc(typeLabel(e))}</span></div><a href="ticket.html?id=${encodeURIComponent(x.id)}">${esc(x.folio||"—")} · ${esc(x.titulo||"Sin título")}</a><span>${esc(clientes[x.cliente_id]||"Cliente permitido por RLS")} · ${esc(agentes[e?.created_by]||agentes[x.asignado_a]||"Agente")}</span>${messagePreview?`<span>${esc(messagePreview)}</span>`:""}${file.nombre_archivo?`<span>${esc(file.nombre_archivo)}${file.tamano_bytes?` · ${esc(prettyBytes(file.tamano_bytes))}`:""}</span>`:""}</div><div class="dash-supervision-meta"><span>${esc(ago(e?.created_at||x.requiere_supervision_en))}</span><span>${esc(agentes[x.asignado_a]||"Sin responsable")}</span><a class="mini btn-ghost" href="ticket.html?id=${encodeURIComponent(x.id)}">Abrir ticket</a></div></article>`}).join(""):'<div class="empty-state">No hay tickets que requieran supervisión.</div>';
    imageRows.forEach(async item=>{try{const{data:signed,error:signedErr}=await supabase.storage.from("soporte_adjuntos").createSignedUrl(item.path,90);if(signedErr||!signed?.signedUrl)return;const host=box.querySelector(`[data-supervision-thumb="${item.i}"]`);if(!host)return;const img=document.createElement("img");img.alt="Miniatura segura del adjunto";img.loading="lazy";img.src=signed.signedUrl;img.addEventListener("error",()=>img.remove(),{once:true});host.textContent="";host.appendChild(img);setTimeout(()=>{img.removeAttribute("src");img.remove()},85000)}catch{}});
  }catch(err){box.innerHTML='<div class="empty-state">No se pudo cargar la cola de supervisión.</div>';console.error("SUPERVISION_DASHBOARD_LOAD_ERROR",err?.message||"query_failed")}
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
  let activeBtn = null;
  document.querySelectorAll("#admTabs .adm-tab").forEach(b => {const active=b.dataset.adm===tab;b.classList.toggle("is-active",active);b.setAttribute("aria-selected",String(active));b.tabIndex=active?0:-1;if(active)activeBtn=b});
  if (activeBtn?.id) $("#admPanel")?.setAttribute("aria-labelledby", activeBtn.id);
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
  /* replaceState: el hash refleja la tab sin crear historial ni provocar
     scroll-jump (nunca location.hash= ni anchors reales). */
  if (push && location.hash !== admHash(tab)) history.replaceState(null, "", admHash(tab));
}

function bindAdmin() {
  if (document.documentElement.dataset.adminTabsBound === "1") return; /* singleton: sin listeners duplicados */
  document.documentElement.dataset.adminTabsBound = "1";
  $("#admTabs")?.addEventListener("click", e => {
    const b = e.target.closest(".adm-tab");
    if (b) { openAdmin(b.dataset.adm); b.focus({ preventScroll: true }); } /* conserva foco y scroll */
  });
  /* Teclado (patrón WAI-ARIA tabs): ←/→/Home/End mueven foco+selección. */
  $("#admTabs")?.addEventListener("keydown", e => {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(e.key)) return;
    const tabs = [...document.querySelectorAll("#admTabs .adm-tab")];
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const j = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    openAdmin(tabs[j].dataset.adm);
    tabs[j].focus({ preventScroll: true });
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

let AV_ROWS = []; /* última lista leída (para la regla de un solo aviso activo) */
async function avListar() {
  perfCountRequest();
  const { data, error } = await supabase.from("avisos_globales")
    .select("id,titulo,contenido,tipo,activo,mostrar_en_soporte,prioridad,starts_at,ends_at")
    .order("prioridad", { ascending: true }).limit(20);
  if (error) return { error };
  return { data: data || [] };
}
const avActivoActual = exceptId => AV_ROWS.find(a => a.activo && String(a.id) !== String(exceptId || "")) || null;
/* Tarjeta profesional: [icono] [título] [badge Activo/Inactivo] [icono borrar]
   y debajo el contenido. Sin “Visible en soporte” (redundante para el admin).
   Inactivo = opacidad moderada, legible y recuperable (botón Publicar). */
const avCardHtml = a => `<article class="av-card ${CLASE[a.tipo] || "info"}${a.activo ? " is-active" : " is-inactive"}" data-av-id="${a.id}">
    <div class="av-card-head">
      <span class="notice-ic" aria-hidden="true">${ICON[a.tipo] || "ℹ️"}</span>
      <span class="av-card-title">${esc(a.titulo || "Sin título")}</span>
      ${a.activo ? '<span class="tag ok">Activo</span>' : '<span class="tag">Inactivo</span>'}
      <button class="av-del-btn" type="button" data-av-del="${a.id}" aria-label="Eliminar aviso «${esc(a.titulo || "sin título")}»" title="Eliminar aviso"><img src="../IMG/borrar.webp" alt="" aria-hidden="true"></button>
    </div>
    <p class="av-card-body">${esc(a.contenido || "")}</p>
    <div class="av-item-meta">
      ${a.activo
        ? `<button class="mini btn-ghost" type="button" data-av-toggle="${a.id}" data-on="1">Deshacer</button>`
        : `<button class="mini btn-ghost" type="button" data-av-toggle="${a.id}" data-on="0">Publicar</button>`}
    </div>
  </article>`;
async function avRefrescar() {
  const cont = $("#avLista"); if (!cont) return;
  cont.innerHTML = '<div class="dash-skel"></div><div class="dash-skel"></div>';
  const r = await avListar();
  if (r.error) { cont.innerHTML = `<div class="empty-state av-state-error">${esc(errText(r.error, "leer los avisos"))} <button class="mini btn-ghost" id="avRetry" type="button">Reintentar</button></div>`; $("#avRetry")?.addEventListener("click", avRefrescar); return; }
  AV_ROWS = r.data;
  cont.innerHTML = AV_ROWS.length ? AV_ROWS.map(avCardHtml).join("") : '<div class="empty-state">Aún no hay avisos publicados.<br><span class="mut">Crea el primero con el formulario de la izquierda.</span></div>';
}
/* Regla de un solo aviso activo: si hay otro activo, se pide confirmación y
   se despublica el actual ANTES de publicar el nuevo. Solo se reporta éxito
   tras confirmación 2xx del servidor (nunca DOM fingiendo persistencia). */
async function avDespublicarActual(activo) {
  const { error } = await supabase.from("avisos_globales").update({ activo: false }).eq("id", activo.id);
  return error || null;
}
async function avPublicar() {
  if (busy.has("avPub")) return;
  const titulo = ($("#avTitulo")?.value || "").trim();
  const contenido = ($("#avMensaje")?.value || "").trim();
  const tipo = $("#avColor")?.value || "info";
  if (!titulo) return avToast("Escribe un título.", "bad");
  if (!contenido) return avToast("Escribe el mensaje: no se publica un aviso vacío.", "bad");
  if (titulo.length > LIM.titulo) return avToast(`El título no debe pasar de ${LIM.titulo} caracteres.`, "bad");
  if (contenido.length > LIM.mensaje) return avToast(`El mensaje no debe pasar de ${LIM.mensaje} caracteres.`, "bad");
  const activo = avActivoActual();
  if (activo && !confirm("Ya existe un aviso activo. Para publicar este aviso, primero se despublicará el actual.")) return;
  busy.add("avPub"); const btn = $("#avPublicar"); if (btn) btn.disabled = true;
  avToast("Publicando…");
  try {
    if (activo) {
      const offErr = await avDespublicarActual(activo);
      if (offErr) return avToast(errText(offErr, "despublicar el aviso actual"), "bad");
    }
    const row = { titulo, contenido, mensaje: contenido, tipo, activo: true, mostrar_en_soporte: true, starts_at: new Date().toISOString(), ends_at: null };
    const { error } = await supabase.from("avisos_globales").insert(row);
    if (error) { avRefrescar(); return avToast(errText(error, "publicar el aviso"), "bad"); } /* el formulario NO se pierde */
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
    const on = tg.dataset.on === "1";
    const activo = on ? null : avActivoActual(tg.dataset.avToggle);
    if (activo && !confirm("Ya existe un aviso activo. Para publicar este aviso, primero se despublicará el actual.")) return;
    busy.add("avTg"); tg.disabled = true;
    try {
      if (activo) {
        const offErr = await avDespublicarActual(activo);
        if (offErr) return avToast(errText(offErr, "despublicar el aviso actual"), "bad");
      }
      const { error } = await supabase.from("avisos_globales").update({ activo: !on }).eq("id", tg.dataset.avToggle);
      if (error) { avRefrescar(); return avToast(errText(error, "actualizar el aviso"), "bad"); }
      avToast(on ? "Aviso despublicado." : "Aviso publicado.", "ok");
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
    <p class="mut">Publica avisos visibles para los visitantes de la página de soporte (demoras, promociones, etc.). Solo administradores.</p>
    <div class="av-grid" style="margin-top:10px">
      <div class="av-form">
        <div class="field"><label class="lbl" for="avTitulo">Título <span id="avTituloCount" class="av-count">0/${LIM.titulo}</span></label>
          <input class="input" id="avTitulo" maxlength="${LIM.titulo}" placeholder="Ej. Cierre por mantenimiento"></div>
        <div class="field"><label class="lbl" for="avMensaje">Mensaje <span id="avMensajeCount" class="av-count">0/${LIM.mensaje}</span></label>
          <textarea class="area" id="avMensaje" maxlength="${LIM.mensaje}" placeholder="Ej. El taller estará cerrado el 16 de septiembre. Tu caso será atendido al día siguiente."></textarea></div>
        <div class="field"><label class="lbl" for="avColor">Color</label>
          <select class="select" id="avColor">${COLORS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select></div>
        <div class="actions"><button class="btn btn-brand" type="button" id="avPublicar">Publicar aviso</button></div>
        <div class="mut" id="avMsg" aria-live="polite">Solo puede existir un aviso activo a la vez; al publicar uno nuevo se despublica el anterior (con confirmación).</div>
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

  /* Workspace único para ambos estados (B20-FABLE-01): cuando el backend no
     existe, MISMA interfaz con controles disabled + estado informativo refinado
     («Personalización pendiente de activación», detalle técnico colapsado).
     Nunca se afirma que puede guardarse sin backend. */
  const fieldHtml = (k) => {
    const val = cfg(k.clave, "");
    const id = "sc_" + k.clave.replace(/[^a-z0-9]/gi, "_");
    const ctrl = k.multi
      ? `<textarea class="area" id="${id}" data-cfg-key="${k.clave}" rows="3" maxlength="${k.max}" ${disponible ? "" : "disabled"}>${esc(val)}</textarea>`
      : `<input class="input" id="${id}" data-cfg-key="${k.clave}" maxlength="${k.max}" value="${esc(val)}" ${disponible ? "" : "disabled"}>`;
    return `<div class="sc-field" data-sc-field="${k.clave}">
      <div class="sc-field-head"><label class="lbl" for="${id}">${esc(k.label)} <span class="sc-dirty" title="Cambio sin guardar"></span></label>
        <span>${disponible ? "" : '<span class="tag sc-availability">Pendiente de activación</span>'}<span class="av-count" data-sc-count="${k.clave}">0/${k.max}</span>${disponible ? `<button class="sc-reset" type="button" data-sc-reset="${k.clave}">Restablecer</button>` : ""}</span></div>
      <div class="sc-help">${esc(k.help)} <b>Valor por defecto:</b> “${esc(defaults[k.clave] || "—")}”</div>
      ${ctrl}
    </div>`;
  };

  host.innerHTML = `
    <p class="mut">Edita los textos públicos sin tocar código. Cada cambio queda en bitácora. Texto plano: no se permite HTML ni enlaces con script.</p>
    ${disponible ? "" : `<div class="sc-disabled-note" style="margin-top:10px" role="status">
        <b>Personalización pendiente de activación</b>
        <span>Los textos públicos siguen usando los valores locales seguros que ves abajo (idénticos a lo que hoy ven los clientes). Las acciones de guardado se habilitarán al completar la activación administrativa.</span>
        <details><summary>Detalle técnico</summary><p class="mut">Requiere desplegar site_config con RLS, grants y bitácora.</p></details>
      </div>`}
    <div class="av-grid" style="margin-top:12px">
      <div class="av-form" id="scForm">
        ${CFG_GROUPS.map(g => `<div class="sc-group"><h4>${esc(g.titulo)}</h4><div class="sc-help">${esc(g.desc)}</div>${g.keys.map(fieldHtml).join("")}</div>`).join("")}
        <div class="actions">
          <button class="btn btn-ghost" type="button" id="scBorrador" disabled title="Guardar borrador requiere un contrato backend de borradores aún no definido">Guardar borrador</button>
          <button class="btn btn-brand" type="button" id="scGuardar" ${disponible ? "" : "disabled"}>Publicar cambios</button>
          <button class="btn btn-ghost" type="button" id="scDescartar" ${disponible ? "" : "disabled"}>Deshacer</button>
          <button class="btn btn-ghost" type="button" id="scReset" ${disponible ? "" : "disabled"}>Restaurar valores</button>
        </div>
        <div class="mut" id="scMsg" aria-live="polite">${disponible ? "Sin cambios pendientes." : "Los botones se habilitarán cuando la personalización remota esté activada; mientras tanto nada se guarda ni se simula guardado."}</div>
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
/* Criterios previstos por contrato visual: visibles pero NO seleccionables.
   Requieren el motor de asignación (BLOCKED_BACKEND_ASSIGNMENT_ENGINE);
   habilitarlos hoy sería funcionalidad falsa. */
const COND_FUTURO = [
  ["canal", "Canal de entrada"],
  ["prioridad_caso", "Prioridad del caso"],
  ["disponibilidad_agente", "Disponibilidad del agente"],
  ["carga_agente", "Carga del agente"],
];
let AGENTES = [];
let RG_ROWS = [];
let RG_EDIT_ID = null;
const rgToast = (txt, cls = "") => { const s = $("#rgMsg"); if (s) { s.textContent = txt; s.className = `mut ${cls}`.trim(); } };

async function rgLoad() {
  const cont = $("#rgLista"); if (!cont) return;
  cont.innerHTML = '<div class="dash-skel"></div>';
  perfCountRequest();
  const { data, error } = await supabase.from("reglas_asignacion")
    .select("id,nombre,prioridad,tipo_condicion,valor,agente_id,activo")
    .is("eliminado_en", null)
    .order("prioridad", { ascending: true }).limit(100);
  if (error) { document.documentElement.dataset.assignmentRulesDeployRequired="1";cont.innerHTML = `<div class="empty-state"><b>Las reglas requieren una actualización administrativa del backend.</b><span class="mut">La asignación automática no está conectada. La vista previa permanece como simulación local y no modifica tickets.</span></div>`;document.querySelectorAll("#rgCrear,[data-rg-move],[data-rg-edit],[data-rg-dup],[data-rg-toggle],[data-rg-del]").forEach(b=>b.disabled=true);return; }
  RG_ROWS = data || [];
  rgRender();
}
const rgShadowed = (r, i) => RG_ROWS.slice(0, i).some(p => p.activo && p.tipo_condicion === r.tipo_condicion && String(p.valor || "").toLowerCase() === String(r.valor || "").toLowerCase());
const rgMismaPrioridad = (r, i) => r.activo && RG_ROWS.some((p, j) => j !== i && p.activo && p.prioridad === r.prioridad);
function rgRender() {
  const cont = $("#rgLista"); if (!cont) return;
  const nombreAg = id => AGENTES.find(a => a.id === id)?.nombre || "—";
  const labelCond = c => (COND.find(x => x[0] === c) || COND_FUTURO.find(x => x[0] === c) || ["", c])[1];
  const activas = RG_ROWS.filter(r => r.activo);
  /* Conflictos detectables localmente: sombreado (mismo criterio+valor arriba),
     misma prioridad entre activas y ausencia de regla de respaldo. */
  const fallbackNote = activas.length
    ? '<div class="mut rg-fallback-note">Sin regla de respaldo: los casos que no coincidan con ninguna regla quedarán sin asignación automática.</div>'
    : "";
  cont.innerHTML = (RG_ROWS.length ? RG_ROWS.map((r, i) => `
    <div class="rg-item${r.activo ? "" : " is-inactive"}">
      <div class="rg-item-head"><b>#${r.prioridad}</b> · <span class="rg-item-name">${esc(r.nombre || "")}</span> ${r.activo ? '<span class="tag ok">Activa</span>' : '<span class="tag">Inactiva</span>'}</div>
      <div class="mut">Si <b>${esc(labelCond(r.tipo_condicion))}</b>${r.valor ? ` = “${esc(r.valor)}”` : ""} → <b>${esc(nombreAg(r.agente_id))}</b></div>
      ${r.activo && rgShadowed(r, i) ? '<div class="rg-warn">⚠ Nunca se ejecutará: una regla activa con mayor prioridad ya cubre este mismo criterio y valor.</div>' : ""}
      ${rgMismaPrioridad(r, i) ? '<div class="rg-warn">⚠ Conflicto de orden: otra regla activa comparte la prioridad #' + r.prioridad + '. Ajusta el orden para un resultado predecible.</div>' : ""}
      <div class="av-item-meta">
        <button class="mini btn-ghost" type="button" data-rg-move="${r.id}" data-dir="-1" ${i === 0 ? "disabled" : ""}>▲ Subir</button>
        <button class="mini btn-ghost" type="button" data-rg-move="${r.id}" data-dir="1" ${i === RG_ROWS.length - 1 ? "disabled" : ""}>▼ Bajar</button>
        <button class="mini btn-ghost" type="button" data-rg-edit="${r.id}">Editar</button>
        <button class="mini btn-ghost" type="button" data-rg-dup="${r.id}">Duplicar</button>
        <button class="mini btn-ghost" type="button" data-rg-toggle="${r.id}" data-on="${r.activo ? 1 : 0}">${r.activo ? "Desactivar" : "Activar"}</button>
        <button class="mini btn-ghost" type="button" data-rg-del="${r.id}">Eliminar</button>
      </div>
    </div>`).join("") : '<div class="empty-state">Aún no hay reglas. Crea la primera con el formulario.</div>') + fallbackNote;
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
    <p class="mut">Define criterios administrativos para la distribución de casos entre agentes.</p>
    <div class="rg-engine-note" role="status" data-blocked="BLOCKED_BACKEND_ASSIGNMENT_ENGINE"><span aria-hidden="true">●</span> La asignación automática todavía no está conectada. Las reglas se guardan para cuando se integre el motor de distribución.</div>
    <div class="av-grid" style="margin-top:10px">
      <div class="av-form">
        <div class="field"><label class="lbl" for="rgNombre">Nombre de la regla</label><input class="input" id="rgNombre" maxlength="80" placeholder="Ej. Overlock → Juan"></div>
        <div class="field"><label class="lbl" for="rgTipo">Criterio</label><select class="select" id="rgTipo">${COND.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}${COND_FUTURO.map(([v, l]) => `<option value="${v}" disabled>${l} — requiere motor de asignación</option>`).join("")}</select></div>
        <div class="field" id="rgValorField"><label class="lbl" for="rgValor">Valor a comparar</label><input class="input" id="rgValor" maxlength="80" placeholder="Ej. overlock"></div>
        <div class="field"><label class="lbl" for="rgAgente">Asignar a</label><select class="select" id="rgAgente">${ags}</select></div>
        <div class="field"><label class="lbl" for="rgPrioridad">Prioridad (menor = primero)</label><input class="input" id="rgPrioridad" type="number" value="100" min="1"></div>
        <div class="actions"><button class="btn btn-brand" type="button" id="rgCrear">Crear regla</button><button class="btn btn-ghost hidden" type="button" id="rgCancelar">Cancelar edición</button></div>
        <div class="mut" id="rgMsg">Se advertirá si la regla se solapa con otra existente.</div>
        <div class="rg-test">
          <div class="lbl">Vista previa — no modifica tickets</div>
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
  const resetForm = () => {
    RG_EDIT_ID = null;
    $("#rgNombre").value = ""; $("#rgValor").value = ""; $("#rgPrioridad").value = "100";
    $("#rgTipo").value = "tipo_maquina";
    $("#rgCrear").textContent = "Crear regla";
    $("#rgCancelar").classList.add("hidden");
    toggleValor();
  };
  $("#rgTipo")?.addEventListener("change", toggleValor);
  $("#rgSimBtn")?.addEventListener("click", rgSimula);
  $("#rgCancelar")?.addEventListener("click", resetForm);
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
    const dup = RG_ROWS.find(r => r.id !== RG_EDIT_ID && r.tipo_condicion === tipo && String(r.valor || "").toLowerCase() === valor.toLowerCase());
    if (dup && !confirm(`Ya existe la regla “${dup.nombre}” con el mismo criterio y valor (prioridad #${dup.prioridad}). ¿Crear de todas formas?`)) return;
    busy.add("rgNew"); $("#rgCrear").disabled = true;
    rgToast("Guardando…");
    try {
      const payload = { nombre, tipo_condicion: tipo, valor: tipo === "cliente_nuevo" ? null : valor, agente_id, prioridad, actualizado_por: CTX.me };
      const result = RG_EDIT_ID
        ? await supabase.from("reglas_asignacion").update(payload).eq("id", RG_EDIT_ID).is("eliminado_en", null)
        : await supabase.from("reglas_asignacion").insert({ ...payload, activo: true, creado_por: CTX.me });
      if (result.error) return rgToast(errText(result.error, "guardar la regla"), "bad");
      rgToast(RG_EDIT_ID ? "Regla actualizada y auditada." : "Regla creada y auditada.", "ok");
      resetForm();
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
        const r1 = await supabase.from("reglas_asignacion").update({ prioridad: b.prioridad, actualizado_por: CTX.me }).eq("id", a.id).is("eliminado_en", null);
        const r2 = await supabase.from("reglas_asignacion").update({ prioridad: a.prioridad, actualizado_por: CTX.me }).eq("id", b.id).is("eliminado_en", null);
        if (r1.error || r2.error) rgToast(errText(r1.error || r2.error, "reordenar"), "bad");
        rgLoad();
      } finally { busy.delete("rgMv"); }
      return;
    }
    const edit = e.target.closest("[data-rg-edit]");
    if (edit) {
      const row = RG_ROWS.find(r => String(r.id) === edit.dataset.rgEdit);
      if (!row) return;
      RG_EDIT_ID = row.id;
      $("#rgNombre").value = row.nombre || ""; $("#rgTipo").value = row.tipo_condicion;
      $("#rgValor").value = row.valor || ""; $("#rgAgente").value = row.agente_id || "";
      $("#rgPrioridad").value = String(row.prioridad || 100);
      $("#rgCrear").textContent = "Guardar cambios"; $("#rgCancelar").classList.remove("hidden");
      toggleValor(); $("#rgNombre").focus();
      return;
    }
    const dup = e.target.closest("[data-rg-dup]");
    if (dup) {
      /* Duplicar = precargar el formulario como regla NUEVA (no escribe nada
         hasta que el admin pulse «Crear regla»). */
      const row = RG_ROWS.find(r => String(r.id) === dup.dataset.rgDup);
      if (!row) return;
      RG_EDIT_ID = null;
      $("#rgNombre").value = `${row.nombre || "Regla"} (copia)`; $("#rgTipo").value = row.tipo_condicion;
      $("#rgValor").value = row.valor || ""; $("#rgAgente").value = row.agente_id || "";
      $("#rgPrioridad").value = String(row.prioridad || 100);
      $("#rgCrear").textContent = "Crear regla"; $("#rgCancelar").classList.remove("hidden");
      toggleValor(); $("#rgNombre").focus();
      rgToast("Copia precargada: revisa prioridad y agente antes de crearla.");
      return;
    }
    const tg = e.target.closest("[data-rg-toggle]");
    if (tg) {
      const { error } = await supabase.from("reglas_asignacion").update({ activo: tg.dataset.on !== "1", actualizado_por: CTX.me }).eq("id", tg.dataset.rgToggle).is("eliminado_en", null);
      if (error) return rgToast(errText(error, "actualizar la regla"), "bad");
      return rgLoad();
    }
    const del = e.target.closest("[data-rg-del]");
    if (del) {
      if (!confirm("¿Retirar esta regla? Se conservará su historial administrativo.")) return;
      const { error } = await supabase.from("reglas_asignacion").update({ activo: false, eliminado_en: new Date().toISOString(), eliminado_por: CTX.me, actualizado_por: CTX.me }).eq("id", del.dataset.rgDel).is("eliminado_en", null);
      if (error) return rgToast(errText(error, "eliminar la regla"), "bad");
      rgToast("Regla retirada; su historial permanece en auditoría.", "ok");
      if (RG_EDIT_ID === del.dataset.rgDel) resetForm();
      return rgLoad();
    }
  });
  toggleValor();
  rgLoad();
}

/* ============================================================================
   BITÁCORA (solo admin, lazy) — B20-FABLE-01.
   Owner único de render: createLogView(root) — instancia parametrizada usada
   por la vista inline y por el modal «Ver toda la bitácora» (sin IDs globales
   duplicados: todo va scoped con data-attributes dentro de root).
   Sin payloads sensibles: sin UUID completos, sin URLs, sin PII en metadata.
   ============================================================================ */
const LOG_SAFE_KEYS = ["clave", "folio", "ticket_id", "cliente_id", "documento_id", "nombre", "resultado", "estado"];
const logSafeText = v => String(v ?? "").replace(/https?:\/\/\S+/gi, "[enlace protegido]").slice(0, 160);
const logSafeDetail = detail => {
  const d = detail && typeof detail === "object" ? detail : {};
  return LOG_SAFE_KEYS.flatMap(k => {
    const v = d[k];
    if (v == null || typeof v === "object") return [];
    const txt = logSafeText(v).slice(0, 90);
    return txt ? [`${k}: ${txt}`] : [];
  }).slice(0, 3).join(" · ");
};
const logFriendlyAction = value => ({portal_respondio:"El cliente respondió",portal_abierto:"El cliente abrió el seguimiento",ticket_asignado:"Ticket asignado",ticket_reasignado:"Ticket reasignado",supervision_solicitada:"Se solicitó supervisión",ticket_supervision_escalada:"Se solicitó supervisión",estado_actualizado:"Estado actualizado",ticket_seguimiento:"Seguimiento del ticket",ticket_solucion:"Solución registrada",ticket_creado:"Ticket creado",ticket_creado_desde_soporte_publico:"Solicitud de soporte creada",contacto_consolidado:"Contacto consolidado",aviso_publicado:"Aviso publicado",site_config_update:"Personalización actualizada"}[String(value||"")]||"Actividad registrada");
const logAbsoluteDate = value => {const d=new Date(value);return Number.isFinite(d.getTime())?d.toLocaleString("es-MX",{dateStyle:"medium",timeStyle:"short"}):"Fecha no disponible"};
const logFailed = b => /error|fall|rechaz/i.test(`${b.accion} ${b.detalle?.resultado || ""}`);
const logOrigin = b => {
  const a = String(b.accion || "");
  if (a.startsWith("portal_") || a === "ticket_creado_desde_soporte_publico") return "Cliente";
  return b.usuario_id ? "Agente" : "Sistema";
};
/* Tipos de evento → acciones conocidas (filtro server-side vía .in). */
const LOG_TYPES = [
  ["apertura", "Apertura", { in: ["ticket_creado", "ticket_creado_desde_soporte_publico"] }],
  ["respuesta", "Respuesta", { in: ["portal_respondio", "ticket_seguimiento", "ticket_solucion"] }],
  ["nota_interna", "Nota interna", { tipo: "nota_interna" }],
  ["asignacion", "Asignación", { in: ["ticket_asignado"] }],
  ["reasignacion", "Reasignación", { in: ["ticket_reasignado"] }],
  ["cambio_estado", "Cambio de estado", { in: ["estado_actualizado"] }],
  ["cierre", "Cierre", { in: ["estado_actualizado"], estado: ["cerrado", "resuelto"] }],
  ["reapertura", "Reapertura", { in: ["estado_actualizado"], estado: ["abierto", "en_proceso"] }],
  ["aviso", "Publicación de aviso", { in: ["aviso_publicado"] }],
  ["regla", "Regla modificada", { in: ["regla_creada", "regla_actualizada", "regla_modificada"] }],
  ["personalizacion", "Personalización", { in: ["site_config_update"] }],
  ["error", "Error", { client: "error" }],
];
let LOG_ACTORS = null; /* cache de perfiles para el filtro de actor/agente */
async function logActorOptions() {
  if (LOG_ACTORS) return LOG_ACTORS;
  perfCountRequest();
  const { data, error } = await supabase.from("perfiles").select("id,nombre").order("nombre");
  LOG_ACTORS = error ? [] : (data || []);
  return LOG_ACTORS;
}

function createLogView(root, { pageSize = 10 } = {}) {
  let page = 0, size = pageSize, total = 0, seq = 0;
  const el = q => root.querySelector(q);
  root.innerHTML = `
    <div class="adm-log-filters">
      <input class="input" type="search" data-lf="q" placeholder="Buscar acción, actor o entidad" aria-label="Buscar en la bitácora">
      <input class="input" type="text" data-lf="ticket" placeholder="Folio del ticket" aria-label="Filtrar por ticket">
      <select class="select" data-lf="tipo" aria-label="Tipo de evento"><option value="">Todos los tipos</option>${LOG_TYPES.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>
      <select class="select" data-lf="actor" aria-label="Actor o agente"><option value="">Todos los actores</option><option value="__system__">Sistema</option></select>
      <select class="select" data-lf="resultado" aria-label="Resultado"><option value="">Todos los resultados</option><option value="ok">Correctos</option><option value="error">Con error</option></select>
      <select class="select" data-lf="origen" aria-label="Origen"><option value="">Todos los orígenes</option><option value="Sistema">Sistema</option><option value="Agente">Agente</option><option value="Cliente">Cliente</option><option value="Integración">Integración</option></select>
      <label class="adm-log-date"><span class="lbl">Desde</span><input class="input" type="date" data-lf="desde" aria-label="Desde"></label>
      <label class="adm-log-date"><span class="lbl">Hasta</span><input class="input" type="date" data-lf="hasta" aria-label="Hasta"></label>
    </div>
    <div class="adm-log" data-log-rows style="margin-top:10px"><div class="dash-skel"></div><div class="dash-skel"></div></div>
    <div class="adm-log-pager">
      <button class="mini btn-ghost" type="button" data-log-prev>Anterior</button>
      <span class="mut" data-log-page aria-live="polite">Página 1</span>
      <button class="mini btn-ghost" type="button" data-log-next>Siguiente</button>
      <label class="adm-log-size"><span class="mut">Por página</span><select class="select" data-lf="size" aria-label="Eventos por página">${[10, 25, 50].map(n => `<option value="${n}"${n === size ? " selected" : ""}>${n}</option>`).join("")}</select></label>
    </div>`;
  logActorOptions().then(list => {
    const sel = el('[data-lf="actor"]');
    if (sel && list.length) sel.insertAdjacentHTML("beforeend", list.map(a => `<option value="${esc(a.id)}">${esc(a.nombre || "Usuario")}</option>`).join(""));
  });

  const rowHtml = (b, actors) => {
    const failed = logFailed(b);
    const folio = b.detalle?.folio, ticketId = b.detalle?.ticket_id;
    const actor = b.usuario_id ? (actors[b.usuario_id] || "Usuario interno") : "Automatización del sistema";
    const summary = logSafeDetail(b.detalle);
    const antes = b.detalle && typeof b.detalle === "object" && b.detalle.antes != null && typeof b.detalle.antes !== "object" ? logSafeText(b.detalle.antes) : "";
    const despues = b.detalle && typeof b.detalle === "object" && b.detalle.despues != null && typeof b.detalle.despues !== "object" ? logSafeText(b.detalle.despues) : "";
    return `<article class="adm-log-row${failed ? " is-error" : ""}">
      <span>
        <span class="adm-log-line"><b>${esc(logFriendlyAction(b.accion))}</b> <span class="tag ${failed ? "bad" : "ok"}">${failed ? "Error" : "Correcto"}</span>${folio && ticketId ? `<a class="adm-log-ticket" href="ticket.html?id=${encodeURIComponent(ticketId)}">${esc(folio)}</a>` : ""}</span>
        ${summary ? `<small class="mut">${esc(summary.replace(/ticket_id:[^·]+·?/i, "").trim())}</small>` : ""}
        <details class="adm-log-detail"><summary>Ver detalle</summary>
          <dl class="adm-log-detail-body">
            <div><dt>Antes</dt><dd>${antes ? esc(antes) : "—"}</dd></div>
            <div><dt>Después</dt><dd>${despues ? esc(despues) : "—"}</dd></div>
            <div><dt>Metadata</dt><dd>${summary ? esc(summary) : "Sin metadata adicional"}</dd></div>
            <div><dt>Origen</dt><dd>${esc(logOrigin(b))}</dd></div>
            <div><dt>Identificador</dt><dd>${esc(String(b.id ?? "—").slice(0, 8))}</dd></div>
            <div><dt>Relación</dt><dd>${folio && ticketId ? `<a href="ticket.html?id=${encodeURIComponent(ticketId)}">Ticket ${esc(folio)}</a>` : b.detalle?.clave ? `Configuración ${esc(String(b.detalle.clave))}` : "—"}</dd></div>
            <div><dt>Código</dt><dd>${esc(b.accion || "evento")}</dd></div>
          </dl>
        </details>
      </span>
      <span class="mut adm-log-meta-col">${esc(actor)}<br><time datetime="${esc(b.fecha || "")}">${esc(logAbsoluteDate(b.fecha))}</time> · ${esc(ago(b.fecha))}</span>
    </article>`;
  };

  const load = async () => {
    const mySeq = ++seq;
    const rowsHost = el("[data-log-rows]");
    rowsHost.innerHTML = '<div class="dash-skel"></div><div class="dash-skel"></div>';
    perfCountRequest();
    let q = supabase.from("bitacora").select("id,usuario_id,accion,tipo,fecha,detalle", { count: "exact" })
      .order("fecha", { ascending: false }).range(page * size, (page + 1) * size - 1);
    const tipoVal = el('[data-lf="tipo"]')?.value || "";
    const tipoDef = LOG_TYPES.find(t => t[0] === tipoVal)?.[2] || null;
    if (tipoDef?.in) q = q.in("accion", tipoDef.in);
    if (tipoDef?.tipo) q = q.eq("tipo", tipoDef.tipo);
    if (tipoDef?.estado) q = q.in("detalle->>estado", tipoDef.estado);
    const actorVal = el('[data-lf="actor"]')?.value || "";
    if (actorVal === "__system__") q = q.is("usuario_id", null);
    else if (actorVal) q = q.eq("usuario_id", actorVal);
    const desde = el('[data-lf="desde"]')?.value || "";
    if (desde) q = q.gte("fecha", `${desde}T00:00:00`);
    const hasta = el('[data-lf="hasta"]')?.value || "";
    if (hasta) q = q.lte("fecha", `${hasta}T23:59:59`);
    const ticketVal = (el('[data-lf="ticket"]')?.value || "").trim();
    if (ticketVal) q = q.ilike("detalle->>folio", `%${ticketVal.replace(/[%_]/g, "")}%`);
    const { data, error, count } = await q;
    if (mySeq !== seq) return; /* respuesta obsoleta descartada */
    if (error) {
      rowsHost.innerHTML = `<div class="empty-state">${esc(errText(error, "leer la bitácora"))} <button class="mini btn-ghost" type="button" data-log-retry>Reintentar</button></div>`;
      el("[data-log-retry]")?.addEventListener("click", load);
      return;
    }
    total = count ?? 0;
    const raw = data || [];
    const ids = [...new Set(raw.map(x => x.usuario_id).filter(Boolean))];
    let actors = {};
    if (ids.length) {
      const p = await supabase.from("perfiles").select("id,nombre").in("id", ids);
      if (mySeq !== seq) return;
      if (!p.error) actors = Object.fromEntries((p.data || []).map(x => [x.id, x.nombre || "Usuario"]));
    }
    const needle = (el('[data-lf="q"]')?.value || "").trim().toLowerCase();
    const resultFilter = el('[data-lf="resultado"]')?.value || (tipoDef?.client === "error" ? "error" : "");
    const origenFilter = el('[data-lf="origen"]')?.value || "";
    const filtered = raw.filter(b => {
      const result = logFailed(b) ? "error" : "ok";
      const haystack = `${b.accion} ${b.tipo} ${actors[b.usuario_id] || "Sistema"} ${logSafeDetail(b.detalle)}`.toLowerCase();
      return (!needle || haystack.includes(needle)) && (!resultFilter || result === resultFilter) && (!origenFilter || logOrigin(b) === origenFilter);
    });
    const anyFilter = needle || resultFilter || origenFilter || tipoVal || actorVal || desde || hasta || ticketVal;
    rowsHost.innerHTML = filtered.length ? filtered.map(b => rowHtml(b, actors)).join("")
      : raw.length || anyFilter
        ? '<div class="empty-state">Sin coincidencias con los filtros actuales.<br><span class="mut">Ajusta la búsqueda, el intervalo de fechas o el tipo de evento.</span></div>'
        : '<div class="empty-state">La bitácora aún no tiene eventos registrados.</div>';
    const pages = Math.max(1, Math.ceil(total / size));
    const pageEl = el("[data-log-page]"); if (pageEl) pageEl.textContent = `Página ${Math.min(page + 1, pages)} de ${pages}`;
    const prev = el("[data-log-prev]"); if (prev) prev.disabled = page === 0;
    const next = el("[data-log-next]"); if (next) next.disabled = (page + 1) * size >= total;
  };
  el("[data-log-prev]")?.addEventListener("click", () => { if (page) { page--; load(); } });
  el("[data-log-next]")?.addEventListener("click", () => { if ((page + 1) * size < total) { page++; load(); } });
  el('[data-lf="size"]')?.addEventListener("change", e => { size = parseInt(e.target.value, 10) || 10; page = 0; load(); });
  let debTimer = 0;
  root.querySelectorAll("[data-lf]").forEach(f => {
    if (f.dataset.lf === "size") return;
    const evt = f.matches("input[type=search],input[type=text]") ? "input" : "change";
    f.addEventListener(evt, () => { clearTimeout(debTimer); debTimer = setTimeout(() => { page = 0; load(); }, evt === "input" ? 320 : 0); });
  });
  load();
  return { reload: load };
}

/* Resumen superior: total real (count exacto) + categorías sobre los últimos
   200 eventos (ventana declarada; nunca se presentan como totales globales). */
async function loadLogSummary(box) {
  if (!box) return;
  box.innerHTML = '<div class="dash-skel"></div>';
  try {
    perfCountRequest();
    const [head, sample] = await Promise.all([
      supabase.from("bitacora").select("id", { count: "exact", head: true }),
      supabase.from("bitacora").select("id,usuario_id,accion,detalle").order("fecha", { ascending: false }).limit(200),
    ]);
    if (head.error || sample.error) throw head.error || sample.error;
    const rows = sample.data || [];
    const n = f => rows.filter(f).length;
    const chips = [
      ["Eventos totales", head.count ?? 0, ""],
      ["Errores", n(logFailed), "is-warnchip"],
      ["Cambios manuales", n(b => !!b.usuario_id && !String(b.accion || "").startsWith("portal_")), ""],
      ["Automatizaciones", n(b => !b.usuario_id), ""],
      ["Asignaciones", n(b => ["ticket_asignado", "ticket_reasignado"].includes(b.accion)), ""],
      ["Cierres", n(b => b.accion === "estado_actualizado" && ["cerrado", "resuelto"].includes(String(b.detalle?.estado || ""))), ""],
    ];
    box.innerHTML = chips.map(([k, v, cls], i) => `<article class="kpi adm-log-chip ${cls}"><span class="kk">${esc(k)}${i ? '<br><i class="adm-log-chip-note">últimos 200</i>' : ""}</span><span class="kv">${esc(String(v))}</span></article>`).join("");
  } catch (e) {
    box.innerHTML = `<div class="empty-state">${esc(errText(e, "leer el resumen de la bitácora"))}</div>`;
  }
}

async function mountBitacora(host) {
  host.innerHTML = `
    <div class="section-head"><div><h3>Bitácora administrativa</h3><p class="mut">Actividad administrativa y operativa relevante de la mesa de soporte.</p></div>
      <button class="mini btn-ghost" type="button" data-log-open-all>Ver toda la bitácora</button></div>
    <div class="adm-log-summary" data-log-summary><div class="dash-skel"></div></div>
    <div data-log-view style="margin-top:10px"></div>
    <div class="overlay" data-log-modal hidden>
      <div class="modal adm-log-modal" role="dialog" aria-modal="true" aria-labelledby="admLogModalTitle">
        <div class="section-head"><div><div class="section-kicker">Bitácora</div><h3 id="admLogModalTitle">Toda la bitácora</h3></div>
          <button class="icon-btn" type="button" data-log-modal-close aria-label="Cerrar bitácora completa">✕</button></div>
        <div data-log-view-full style="margin-top:10px"></div>
      </div>
    </div>`;
  loadLogSummary(host.querySelector("[data-log-summary]"));
  createLogView(host.querySelector("[data-log-view]"), { pageSize: 10 });
  const modal = host.querySelector("[data-log-modal]");
  let fullMounted = false, opener = null;
  const openModal = () => {
    opener = document.activeElement;
    modal.hidden = false; modal.classList.add("open");
    if (!fullMounted) { fullMounted = true; createLogView(host.querySelector("[data-log-view-full]"), { pageSize: 25 }); }
    host.querySelector("[data-log-modal-close]")?.focus();
  };
  const closeModal = () => {
    modal.classList.remove("open"); modal.hidden = true;
    if (opener?.focus) opener.focus({ preventScroll: true });
  };
  host.querySelector("[data-log-open-all]")?.addEventListener("click", openModal);
  host.querySelector("[data-log-modal-close]")?.addEventListener("click", closeModal);
  modal.addEventListener("click", e => { if (e.target === modal) closeModal(); });
  host.addEventListener("keydown", e => { if (e.key === "Escape" && !modal.hidden) closeModal(); });
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
  document.body.dataset.accessRole=CTX.isAdmin?"admin":"soporte";
  document.body.dataset.surface=CTX.isAdmin?"admin":"support";

  /* Hero — owner único del rol: badge INLINE al final de #dashLead (sin
     .dash-hero-meta ni badge duplicado a la derecha). Texto y badge fluyen
     juntos; máximo 2 filas visuales para admin (kicker+acciones / lead+badge). */
  const setLead = (text, badgeLabel, extraTag) => {
    const l1 = $("#dashLead"); if (!l1) return;
    l1.textContent = text + " ";
    const b = document.createElement("span");
    b.className = "tag ok dash-role-inline"; b.textContent = badgeLabel;
    l1.appendChild(b);
    if (extraTag) { const x = document.createElement("span"); x.className = "tag dash-role-inline"; x.textContent = extraTag; l1.appendChild(document.createTextNode(" ")); l1.appendChild(x); }
  };
  if (!CTX.isAdmin) {
    const rawFirst = String(CTX.nombre || "").trim().split(/\s+/)[0] || "";
    const firstName = rawFirst && !rawFirst.includes("@") ? rawFirst : "Soporte";
    const t1 = $("#dashTitle"); if (t1) t1.textContent = `Tu mesa de soporte, ${firstName}`;
    setLead("Atiende tus casos asignados, responde a tiempo y vigila tus compromisos de servicio.", "Soporte", "Mis casos asignados");
    const act = $("#dashActTitle"); if (act) act.textContent = "Mi actividad reciente";
    document.querySelectorAll(".dash-admin-only").forEach(el => el.classList.add("hidden"));
  } else {
    /* El kicker ya dice “Mesa de soporte Janome”: el h1 con el mismo texto era
       redundante → pasa a sr-only (se conserva un h1 accesible, sin fila extra). */
    const t1 = $("#dashTitle"); if (t1) { t1.textContent = "Administración de la mesa de soporte Janome"; t1.classList.add("sr-only"); }
    setLead("Prioriza casos, vigila compromisos de servicio y coordina la atención de tu equipo.", "Administrador");
    $("#dashAdmin")?.classList.remove("hidden");
    $("#dashAgents")?.classList.remove("hidden");
    $("#dashSupervision")?.classList.remove("hidden");
    $("#dashAgentGrid")?.addEventListener("click",e=>{const b=e.target.closest("[data-agent-row]");if(b)openAgent(AGENT_ROWS[Number(b.dataset.agentRow)])});
    const closeAgent=()=>{$("#dashAgentModal").hidden=true};
    $("#dashAgentClose")?.addEventListener("click",closeAgent);
    $("#dashAgentModal")?.addEventListener("click",e=>{if(e.target.id==="dashAgentModal")closeAgent()});
    bindAdmin();
  }

  /* Progresivo: KPIs primero; actividad y adaptador de vistas después. */
  await loadMetrics();
  perfPageReady();
  Promise.allSettled([loadActividad(), loadAgentSummary(), CTX.isAdmin?loadSupervision():Promise.resolve()]).then(perfSecondaryDone);
}

document.addEventListener("DOMContentLoaded", init);
