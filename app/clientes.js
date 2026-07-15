/* ============================================================================
   B19A/B19D — listado interno de clientes.
   - Sin N+1: 1 query de clientes (paginada) + 3 queries por lote con in.(ids).
   - Debounce real en búsqueda; request sequence (respuestas obsoletas se
     ignoran); cambiar orden o filtro local NO ejecuta consultas nuevas.
   - Cabecera resumen con counts head baratos (sin descargar la BD).
   - Pill bar por rol: soporte ve "Mis clientes" = clientes con tickets
     asignados al usuario autenticado (derivado; NO existe ownership permanente
     de cliente — eso sería clientes.agente_responsable_id, contrato futuro).
   - Vista tabla/cards + filtros + búsqueda con estado en URL.
   ============================================================================ */
import { mountNav } from "./shared/nav-interna.js?v=frontend-final-20260715-01";
import { readQS, writeQS } from "./shared/query-state.js";
import { fmtFecha } from "./shared/formatters.js?v=frontend-final-20260715-01";
import { esc, debounce } from "./global.js?v=frontend-final-20260715-01";
import { perfPrimaryDone, perfSecondaryDone, perfPageReady, perfCountRequest } from "./shared/perf.js";
import { mapError, devLog, withTimeout } from "./shared/errors.js";

const $ = (q, c = document) => c.querySelector(q);
const PAGE = 30, OPEN = ["abierto", "en_proceso", "esperando_cliente"];
const ST = { sb: null, rol: "soporte", me: null, isAdmin: false, scopeIds: [], rows: [], page: 0, done: false, loading: false, q: "", filter: "todos", order: "actividad", vista: "tabla", reqSeq: 0, misClientes: null };
const TC_CLIENT_ORIGINS = ["ticket_core", "soporte_publico", "alta_cliente", "alta_interna", "alta_aprobada", "alta_publica", "registro_aprobado"];

const loadScopeIds = async () => {
  const own = ST.sb.from("tickets").select("cliente_id").not("cliente_id", "is", null);
  const ticketQuery = ST.isAdmin ? own : own.eq("asignado_a", ST.me);
  const jobs = [ticketQuery];
  if(ST.isAdmin){
    jobs.push(ST.sb.from("solicitudes_soporte").select("cliente_id").not("cliente_id", "is", null));
    jobs.push(ST.sb.from("clientes").select("id").in("origen_registro", TC_CLIENT_ORIGINS));
  }
  const results = await Promise.all(jobs);
  const failed = results.find(x=>x.error);
  if(failed?.error) throw failed.error;
  ST.scopeIds = [...new Set(results.flatMap((x,i)=>(x.data||[]).map(r=>i===2?r.id:r.cliente_id)).filter(Boolean))];
};

/* ---- Pills por rol (los filtros operan sobre la página cargada) ---- */
const PILLS_ADMIN = [
  ["todos", "Todos"], ["recientes", "Recientes"], ["abiertos", "Con tickets abiertos"],
  ["esperando", "Esperando cliente"], ["prio", "Prioridad alta"], ["sla", "Riesgo SLA"],
  ["consolidacion", "Por consolidar"], ["con_equipo", "Con equipo"], ["sin_equipo", "Sin equipo"],
  ["incompletos", "Datos incompletos"],
];
const PILLS_SOPORTE = [
  ["mios", "Mis clientes"], ["todos", "Todos"], ["recientes", "Recientes"],
  ["abiertos", "Con tickets abiertos"], ["esperando", "Esperando cliente"],
  ["prio", "Prioridad alta"], ["sla", "Riesgo SLA"], ["consolidacion", "Por consolidar"],
  ["sin_equipo", "Sin equipo"],
];

const fetchPage = async () => {
  const seq = ++ST.reqSeq, from = ST.page * PAGE, to = from + PAGE - 1;
  if(!ST.scopeIds.length) return { rows: [], count: 0 };
  let q = ST.sb.from("clientes").select("id,nombre", { count: "exact" }).order("nombre", { ascending: true }).range(from, to);
  q = q.in("id", ST.scopeIds);
  if (ST.q) q = q.ilike("nombre", `%${ST.q}%`);
  perfCountRequest();
  const { data: clientes, error, count } = await q;
  if (error) throw error;
  if (seq !== ST.reqSeq) return null; /* respuesta obsoleta */
  const ids = (clientes || []).map(c => c.id);
  let tk = [], ct = [], eq = [];
  if (ids.length) {
    perfCountRequest(3);
    const [a, b, c] = await Promise.all([
      ST.sb.from("tickets").select("cliente_id,estado,prioridad,fecha_actualizacion,requiere_consolidacion,asignado_a,sla_resolution_deadline").in("cliente_id", ids),
      ST.sb.from("clientes_contactos").select("cliente_id,nombre,correo,telefono,es_principal").in("cliente_id", ids).eq("activo", true),
      ST.sb.from("cliente_sistemas").select("cliente_id").in("cliente_id", ids),
    ]);
    if (a.error || b.error || c.error) throw a.error || b.error || c.error;
    tk = a.data || []; ct = b.data || []; eq = c.data || [];
  }
  if (seq !== ST.reqSeq) return null;
  const soon = Date.now() + 24 * 3600e3;
  const rows = (clientes || []).map(cl => {
    const t = tk.filter(x => x.cliente_id === cl.id);
    const open = t.filter(x => OPEN.includes((x.estado || "").toLowerCase()));
    const abiertos = open.length;
    const ult = t.map(x => x.fecha_actualizacion).sort().pop() || null;
    const cons = t.some(x => x.requiere_consolidacion);
    const mio = ST.me ? t.some(x => x.asignado_a === ST.me) : false;
    const esperando = t.some(x => (x.estado || "").toLowerCase() === "esperando_cliente");
    const prioAlta = open.some(x => ["alta", "urgente"].includes((x.prioridad || "").toLowerCase()));
    const slaRiesgo = open.some(x => x.sla_resolution_deadline && new Date(x.sla_resolution_deadline).getTime() < soon);
    const contacto = ct.filter(x => x.cliente_id === cl.id).sort((x, y) => (y.es_principal ? 1 : 0) - (x.es_principal ? 1 : 0))[0] || null;
    const equipos = eq.filter(x => x.cliente_id === cl.id).length;
    return { ...cl, abiertos, ult, cons, mio, esperando, prioAlta, slaRiesgo, contacto, equipos, total: t.length };
  });
  return { rows, count };
};

const applyFilterOrder = rows => {
  let out = rows;
  if (ST.filter === "abiertos") out = out.filter(r => r.abiertos > 0);
  else if (ST.filter === "recientes") out = out.filter(r => r.ult && Date.now() - new Date(r.ult).getTime() < 7 * 864e5);
  else if (ST.filter === "esperando") out = out.filter(r => r.esperando);
  else if (ST.filter === "prio") out = out.filter(r => r.prioAlta);
  else if (ST.filter === "sla") out = out.filter(r => r.slaRiesgo);
  else if (ST.filter === "consolidacion") out = out.filter(r => r.cons);
  else if (ST.filter === "con_equipo") out = out.filter(r => r.equipos > 0);
  else if (ST.filter === "sin_equipo") out = out.filter(r => r.equipos === 0);
  else if (ST.filter === "incompletos") out = out.filter(r => !r.contacto || (!r.contacto.correo && !r.contacto.telefono));
  else if (ST.filter === "mios") out = out.filter(r => r.mio);
  if (ST.order === "nombre") out = [...out].sort((a, b) => a.nombre.localeCompare(b.nombre));
  else if (ST.order === "abiertos") out = [...out].sort((a, b) => b.abiertos - a.abiertos);
  else out = [...out].sort((a, b) => String(b.ult || "").localeCompare(String(a.ult || "")));
  return out;
};

const rowTable = r => `<tr class="cl-row" tabindex="0" role="link" data-id="${esc(r.id)}">
  <td><div class="cl-name">${esc(r.nombre || "—")}</div>${r.cons ? '<div class="cl-sub">⚠ pendiente de consolidación</div>' : ""}</td>
  <td>${r.contacto ? `<div>${esc(r.contacto.nombre || "—")}</div><div class="cl-sub">${esc(r.contacto.correo || r.contacto.telefono || "")}</div>` : '<span class="mut">—</span>'}</td>
  <td class="cl-num">${r.equipos || "—"}</td>
  <td class="cl-num">${r.abiertos ? `<span class="tag warn">${r.abiertos}</span>` : "0"}</td>
  <td>${r.ult ? fmtFecha(r.ult) : '<span class="mut">Sin tickets</span>'}</td>
  <td class="cl-sub">Abrir ›</td></tr>`;

const rowCard = r => `<article class="cl-card cl-row" tabindex="0" role="link" data-id="${esc(r.id)}">
  <div class="cl-card-top"><div class="cl-name">${esc(r.nombre || "—")}</div>${r.abiertos ? `<span class="tag warn">${r.abiertos} abierto${r.abiertos === 1 ? "" : "s"}</span>` : ""}</div>
  <div class="cl-sub">${r.contacto ? esc([r.contacto.nombre, r.contacto.correo || r.contacto.telefono].filter(Boolean).join(" · ")) : "Sin contacto registrado"}</div>
  <div class="cl-card-meta">
    <span>🧵 ${r.equipos || 0} equipo${r.equipos === 1 ? "" : "s"}</span>
    <span>${r.ult ? "Actividad " + fmtFecha(r.ult) : "Sin tickets"}</span>
    ${r.cons ? '<span class="tag warn">Por consolidar</span>' : ""}
  </div>
</article>`;

const render = () => {
  const box = $("#clList"), rows = applyFilterOrder(ST.rows);
  document.querySelectorAll("#clPills .mini").forEach(b => b.classList.toggle("is-active", b.dataset.pill === ST.filter));
  $("#clVistaTabla")?.classList.toggle("is-active", ST.vista === "tabla");
  $("#clVistaCards")?.classList.toggle("is-active", ST.vista === "cards");
  if (!rows.length) {
    box.innerHTML = `<div class="empty-state">${ST.rows.length ? "Ningún cliente coincide con el filtro en esta página cargada." : "Sin clientes para esta búsqueda."}</div>`;
    return;
  }
  box.innerHTML = ST.vista === "cards"
    ? `<div class="cl-cards">${rows.map(rowCard).join("")}</div>`
    : `<table class="cl-table"><thead><tr class="mut"><th style="text-align:left">Cliente</th><th style="text-align:left">Contacto principal</th><th>Equipos</th><th>Tickets abiertos</th><th style="text-align:left">Última actividad</th><th></th></tr></thead><tbody>${rows.map(rowTable).join("")}</tbody></table>`;
};

const persist = () => writeQS({ q: ST.q, filter: ST.filter === "todos" ? "" : ST.filter, order: ST.order === "actividad" ? "" : ST.order, vista: ST.vista === "tabla" ? "" : ST.vista });

const load = async (reset = false) => {
  if (ST.loading) return;
  ST.loading = true;
  const box = $("#clList");
  if (reset) { ST.page = 0; ST.rows = []; ST.done = false; box.innerHTML = '<div class="cl-skel"></div><div class="cl-skel"></div><div class="cl-skel"></div>'; }
  const t0 = performance.now();
  try {
    const res = await withTimeout(fetchPage(), 12000);
    if (res) {
      ST.rows = ST.rows.concat(res.rows);
      ST.done = ST.rows.length >= (res.count || 0);
      $("#clCount").textContent = `${ST.rows.length} de ${res.count ?? "?"} clientes`;
      $("#clMore").hidden = ST.done;
      render();
      perfPrimaryDone();
    }
  } catch (ex) {
    const e = mapError(ex, "CLIENTS_LOAD_FAILED");
    devLog("clientes", "load_page", e.code + ":" + e.kind, null, performance.now() - t0);
    /* la página sigue navegable: se conservan filtros, búsqueda y filas previas válidas */
    if (!ST.rows.length) {
      box.innerHTML = `<div class="empty-state">${esc(e.human)} <button class="btn btn-ghost" id="clRetry" type="button">Reintentar</button></div>`;
      $("#clRetry")?.addEventListener("click", () => load(true));
    } else {
      $("#clCount").textContent = e.human;
      $("#clMore").hidden = false;
    }
  } finally { ST.loading = false; }
};

/* ---- Cabecera resumen: SOLO counts head baratos; lo global honesto ---- */
async function loadSummary() {
  const box = $("#clSummary");
  if (!box) return;
  const cnt = p => p.then(r => (r.error ? null : (r.count ?? 0))).catch(() => null);
  const BASE = { count: "exact", head: true };
  perfCountRequest(3);
  if(!ST.scopeIds.length){ box.innerHTML = '<div class="empty-state">Sin clientes dentro del alcance de Ticket Core.</div>'; perfSecondaryDone(); return; }
  let scopedTickets = ST.sb.from("tickets");
  const own = q => ST.isAdmin ? q : q.eq("asignado_a", ST.me);
  const [total, porConsolidar, abiertosTk] = await Promise.all([
    Promise.resolve(ST.scopeIds.length),
    cnt(own(scopedTickets.select("id", BASE).in("cliente_id", ST.scopeIds).eq("requiere_consolidacion", true).neq("estado", "cerrado"))),
    cnt(own(ST.sb.from("tickets").select("id", BASE).in("cliente_id", ST.scopeIds).in("estado", OPEN))),
  ]);
  const chip = (k, v, warn) => `<article class="cl-sum ${warn && v > 0 ? "is-warn" : ""}"><span class="kk">${esc(k)}</span><span class="kv">${v == null ? "—" : v}</span></article>`;
  box.innerHTML = [
    chip(ST.isAdmin ? "Clientes Ticket Core" : "Mis clientes", total),
    chip("Tickets abiertos", abiertosTk),
    chip("Por consolidar", porConsolidar, true),
  ].join("") + '<span class="mut" style="font-size:12px">Alcance temporal por relaciones de Ticket Core; no incluye el directorio completo de Panel.</span>';
  perfSecondaryDone();
}

document.addEventListener("DOMContentLoaded", async () => {
  const ctx = await mountNav("clientes");
  if (!ctx) return;
  ST.sb = ctx.sb; ST.rol = ctx.rol; ST.me = ctx.perfil?.id || ctx.user?.id || null;
  ST.isAdmin = String(ST.rol||"").toLowerCase() === "admin";
  document.body.dataset.accessRole = ST.isAdmin ? "admin" : "soporte";
  if(!ST.isAdmin) document.querySelectorAll(".cl-admin-only").forEach(x=>x.remove());
  try{ await loadScopeIds(); }
  catch(ex){
    const e=mapError(ex,"CLIENT_SCOPE_LOAD_FAILED");
    devLog("clientes","load_scope",e.code+":"+e.kind);
    $("#clList").innerHTML=`<div class="empty-state">${esc(e.human)} No se pudo determinar el alcance de clientes Ticket Core.</div>`;
    return;
  }

  const qs = readQS({ q: "", filter: "todos", order: "actividad", vista: "tabla" });
  ST.q = qs.q; ST.filter = qs.filter || "todos"; ST.order = qs.order || "actividad";
  ST.vista = window.matchMedia("(max-width:860px)").matches ? "cards" : (qs.vista || "tabla");

  /* pill bar por rol */
  const pills = (ST.rol === "admin" ? PILLS_ADMIN : PILLS_SOPORTE);
  $("#clPills").innerHTML = pills.map(([v, l]) => `<button class="mini btn-ghost" type="button" data-pill="${v}">${esc(l)}</button>`).join("");
  if (!pills.some(([v]) => v === ST.filter)) ST.filter = pills[0][0] === "mios" ? "todos" : pills[0][0];

  $("#clSearch").value = ST.q; $("#clOrder").value = ST.order;

  $("#clSearch").addEventListener("input", debounce(() => { ST.q = $("#clSearch").value.trim(); persist(); load(true); }, 350));
  $("#clPills").addEventListener("click", e => {
    const b = e.target.closest("[data-pill]");
    if (!b) return;
    ST.filter = b.dataset.pill; persist(); render(); /* filtro local: cero consultas nuevas */
  });
  $("#clOrder").addEventListener("change", () => { ST.order = $("#clOrder").value; persist(); render(); /* orden local: cero consultas */ });
  $("#clVistaTabla").addEventListener("click", () => { ST.vista = "tabla"; persist(); render(); });
  $("#clVistaCards").addEventListener("click", () => { ST.vista = "cards"; persist(); render(); });
  $("#clMore").addEventListener("click", () => { ST.page++; load(false); });
  const go = tr => { if (tr) location.href = `cliente.html?id=${encodeURIComponent(tr.dataset.id)}`; };
  $("#clList").addEventListener("click", e => go(e.target.closest?.(".cl-row")));
  $("#clList").addEventListener("keydown", e => { if (e.key === "Enter") go(e.target.closest?.(".cl-row")); });

  await load(true);
  perfPageReady();
  loadSummary(); /* secundario: no bloquea la lista */
});
