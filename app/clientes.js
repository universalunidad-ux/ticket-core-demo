/* ==========================================================================
   CLIENTES — directorio paginado dentro del alcance autorizado por RLS.
   El frontend no amplía permisos: soporte añade asignado_a = auth.uid() y el
   filtro de agente sólo existe para admin. Contactos, sistemas y supervisor
   permanecen fuera del contrato (CLIENT_RLS_BLOCKED=YES).
   ========================================================================== */
import { mountNav } from "./shared/nav-interna.js?v=frontend-final-20260716-01";
import { readQS, writeQS } from "./shared/query-state.js";
import { fmtFecha } from "./shared/formatters.js?v=frontend-final-20260716-01";
import { esc, debounce } from "./global.js?v=frontend-final-20260716-01";
import { perfPrimaryDone, perfSecondaryDone, perfPageReady, perfCountRequest } from "./shared/perf.js";
import { mapError, devLog, withTimeout } from "./shared/errors.js";

const $ = (q, c = document) => c.querySelector(q);
const OPEN = new Set(["abierto", "en_proceso", "esperando_cliente"]);
const PAGE_SIZES = new Set([12, 24, 48]);
const ORDERS = new Set(["actividad", "tickets", "abiertos", "az", "za"]);
const FILTERS = new Set(["todos", "abiertos"]);
const BATCH = 500;
const ST = {
  sb: null, me: null, rol: "soporte", isAdmin: false, agents: [],
  clients: [], tickets: [], rows: [], q: "", filter: "todos",
  agent: "all", order: "actividad", vista: "tabla", page: 1, size: 24,
  loading: true, error: null, reqSeq: 0,
};

const normalize = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const ticketState = ticket => normalize(ticket?.estado).replaceAll(" ", "_");
const isOpen = ticket => OPEN.has(ticketState(ticket));
const compareName = (a, b) => String(a?.nombre || "").localeCompare(String(b?.nombre || ""), "es", { sensitivity: "base" });
const stable = (a, b) => compareName(a, b) || String(a.id).localeCompare(String(b.id));

async function fetchAll(buildQuery) {
  const out = [];
  for (let from = 0; ; from += BATCH) {
    perfCountRequest();
    const { data, error } = await buildQuery().range(from, from + BATCH - 1);
    if (error) throw error;
    const rows = data || [];
    out.push(...rows);
    if (rows.length < BATCH) return out;
  }
}

const buildTicketQuery = () => {
  let query = ST.sb.from("tickets")
    .select("id,cliente_id,estado,fecha_actualizacion,asignado_a")
    .not("cliente_id", "is", null)
    .order("id", { ascending: true });
  if (!ST.isAdmin) query = query.eq("asignado_a", ST.me);
  return query;
};

async function loadAgents() {
  const select = $("#clAgentFilter");
  if (!ST.isAdmin) {
    select?.closest(".cl-admin-filter")?.remove();
    ST.agent = "all";
    return;
  }
  perfCountRequest();
  const { data, error } = await ST.sb.from("perfiles")
    .select("id,nombre,rol")
    .in("rol", ["admin", "supervisor", "soporte"])
    .order("nombre", { ascending: true });
  if (error) throw error;
  ST.agents = data || [];
  const allowed = new Set(["all", "unassigned", ...ST.agents.map(agent => String(agent.id))]);
  if (!allowed.has(ST.agent)) ST.agent = "all";
  select.innerHTML = `<option value="all">Todos los agentes</option><option value="unassigned">Sin agente</option>${ST.agents.map(agent => `<option value="${esc(agent.id)}">${esc(agent.nombre || "Agente")} · ${esc(agent.rol || "soporte")}</option>`).join("")}`;
  select.value = ST.agent;
}

const ticketsForAgent = tickets => {
  if (!ST.isAdmin || ST.agent === "all") return tickets;
  if (ST.agent === "unassigned") return tickets.filter(ticket => !ticket.asignado_a);
  return tickets.filter(ticket => String(ticket.asignado_a) === ST.agent);
};

function rebuildRows() {
  const accessibleIds = new Set(ST.clients.map(client => client.id));
  const tickets = ticketsForAgent(ST.tickets).filter(ticket => accessibleIds.has(ticket.cliente_id));
  const byClient = new Map();
  for (const ticket of tickets) {
    const list = byClient.get(ticket.cliente_id) || [];
    list.push(ticket);
    byClient.set(ticket.cliente_id, list);
  }
  const agentIsFiltered = ST.isAdmin && ST.agent !== "all";
  const search = normalize(ST.q);
  let rows = ST.clients.map(client => {
    const related = byClient.get(client.id) || [];
    const lastTicket = related.reduce((latest, ticket) => String(ticket.fecha_actualizacion || "") > String(latest || "") ? ticket.fecha_actualizacion : latest, null);
    const ultima = [client.ultima_interaccion, lastTicket].filter(Boolean).sort().pop() || null;
    return { ...client, totalTickets: related.length, abiertos: related.filter(isOpen).length, ultima };
  });
  if (agentIsFiltered) rows = rows.filter(row => row.totalTickets > 0);
  if (search) rows = rows.filter(row => normalize(row.nombre).includes(search));
  if (ST.filter === "abiertos") rows = rows.filter(row => row.abiertos > 0);
  if (ST.order === "tickets") rows.sort((a, b) => b.totalTickets - a.totalTickets || stable(a, b));
  else if (ST.order === "abiertos") rows.sort((a, b) => b.abiertos - a.abiertos || stable(a, b));
  else if (ST.order === "az") rows.sort(stable);
  else if (ST.order === "za") rows.sort((a, b) => -stable(a, b));
  else rows.sort((a, b) => String(b.ultima || "").localeCompare(String(a.ultima || "")) || stable(a, b));
  ST.rows = rows;
  const pages = Math.max(1, Math.ceil(rows.length / ST.size));
  ST.page = Math.min(Math.max(1, ST.page), pages);
}

const rowTable = row => `<tr class="cl-row" tabindex="0" role="link" data-id="${esc(row.id)}">
  <td><div class="cl-name">${esc(row.nombre || "—")}</div></td>
  <td class="cl-num">${row.totalTickets}</td>
  <td class="cl-num">${row.abiertos ? `<span class="tag warn">${row.abiertos}</span>` : "0"}</td>
  <td>${row.ultima ? fmtFecha(row.ultima) : '<span class="mut">Sin actividad</span>'}</td>
  <td class="cl-sub">Abrir ›</td></tr>`;

const rowCard = row => `<article class="cl-card cl-row" tabindex="0" role="link" data-id="${esc(row.id)}">
  <div class="cl-card-top"><div class="cl-name">${esc(row.nombre || "—")}</div>${row.abiertos ? `<span class="tag warn">${row.abiertos} abierto${row.abiertos === 1 ? "" : "s"}</span>` : ""}</div>
  <div class="cl-card-meta"><span>${row.totalTickets} ticket${row.totalTickets === 1 ? "" : "s"}</span><span>${row.ultima ? `Actividad ${fmtFecha(row.ultima)}` : "Sin actividad"}</span></div>
</article>`;

function pageItems(totalPages) {
  const wanted = new Set([1, totalPages, ST.page - 1, ST.page, ST.page + 1]);
  const pages = [...wanted].filter(page => page >= 1 && page <= totalPages).sort((a, b) => a - b);
  const out = [];
  pages.forEach((page, index) => {
    if (index && page - pages[index - 1] > 1) out.push('<span class="cl-page-gap" aria-hidden="true">…</span>');
    out.push(`<button class="mini btn-ghost${page === ST.page ? " is-active" : ""}" type="button" data-page="${page}" ${page === ST.page ? 'aria-current="page"' : ""}>${page}</button>`);
  });
  return out.join("");
}

function renderSummary() {
  const box = $("#clSummary");
  if (!box) return;
  const accessibleIds = new Set(ST.clients.map(client => client.id));
  const tickets = ticketsForAgent(ST.tickets).filter(ticket => accessibleIds.has(ticket.cliente_id));
  const clientIds = new Set(tickets.map(ticket => ticket.cliente_id).filter(Boolean));
  const openTickets = tickets.filter(isOpen);
  const chip = (label, value, warn = false) => `<article class="cl-sum${warn && value ? " is-warn" : ""}"><span class="kk">${esc(label)}</span><span class="kv">${value}</span></article>`;
  box.innerHTML = [
    chip(ST.isAdmin && ST.agent !== "all" ? "Clientes del filtro" : "Clientes autorizados", ST.isAdmin && ST.agent !== "all" ? clientIds.size : ST.clients.length),
    chip("Tickets visibles", tickets.length),
    chip("Tickets abiertos", openTickets.length, true),
  ].join("");
  perfSecondaryDone();
}

function render() {
  const box = $("#clList"), panel = $("#clPanel");
  panel?.setAttribute("aria-busy", String(ST.loading));
  if (ST.loading) {
    box.innerHTML = '<div class="cl-skel"></div><div class="cl-skel"></div><div class="cl-skel"></div>';
    $("#clCount").textContent = "Cargando clientes…";
    $("#clPagination").innerHTML = "";
    return;
  }
  if (ST.error) {
    box.innerHTML = `<div class="empty-state"><b>No se pudo cargar Clientes.</b><span>${esc(ST.error.human)}</span><button class="btn btn-ghost" id="clRetry" type="button">Reintentar</button></div>`;
    $("#clCount").textContent = "Carga interrumpida";
    $("#clPagination").innerHTML = "";
    $("#clRetry")?.addEventListener("click", loadDirectory);
    return;
  }
  rebuildRows();
  const total = ST.rows.length, totalPages = Math.max(1, Math.ceil(total / ST.size));
  const from = (ST.page - 1) * ST.size, shown = ST.rows.slice(from, from + ST.size);
  document.querySelectorAll("#clPills [data-pill]").forEach(button => button.classList.toggle("is-active", button.dataset.pill === ST.filter));
  $("#clVistaTabla")?.classList.toggle("is-active", ST.vista === "tabla");
  $("#clVistaCards")?.classList.toggle("is-active", ST.vista === "cards");
  $("#clCount").textContent = total ? `${total} cliente${total === 1 ? "" : "s"} · ${from + 1}–${from + shown.length} · página ${ST.page} de ${totalPages}` : "0 clientes";
  if (!shown.length) {
    box.innerHTML = `<div class="empty-state"><b>Sin resultados</b><span>${ST.q || ST.filter !== "todos" || ST.agent !== "all" ? "No hay clientes que coincidan con los filtros actuales." : "No hay clientes dentro de tu alcance autorizado."}</span>${ST.q || ST.filter !== "todos" || ST.agent !== "all" ? '<button class="btn btn-ghost" id="clEmptyClear" type="button">Limpiar filtros</button>' : ""}</div>`;
    $("#clEmptyClear")?.addEventListener("click", clearFilters);
  } else {
    box.innerHTML = ST.vista === "cards"
      ? `<div class="cl-cards">${shown.map(rowCard).join("")}</div>`
      : `<div class="cl-table-wrap"><table class="cl-table"><thead><tr class="mut"><th>Cliente</th><th>Tickets</th><th>Abiertos</th><th>Última actividad</th><th></th></tr></thead><tbody>${shown.map(rowTable).join("")}</tbody></table></div>`;
  }
  $("#clPagination").innerHTML = totalPages > 1 ? `<button class="mini btn-ghost" type="button" data-page="${ST.page - 1}" ${ST.page === 1 ? "disabled" : ""}>Anterior</button>${pageItems(totalPages)}<button class="mini btn-ghost" type="button" data-page="${ST.page + 1}" ${ST.page === totalPages ? "disabled" : ""}>Siguiente</button>` : "";
}

const persist = () => writeQS({
  q: ST.q, filter: ST.filter === "todos" ? "" : ST.filter,
  agent: ST.isAdmin && ST.agent !== "all" ? ST.agent : "",
  order: ST.order === "actividad" ? "" : ST.order,
  size: ST.size === 24 ? "" : ST.size, page: ST.page === 1 ? "" : ST.page,
  vista: ST.vista === "tabla" ? "" : ST.vista,
});

function refresh({ resetPage = false } = {}) {
  if (resetPage) ST.page = 1;
  ST.error = null;
  render();
  renderSummary();
  persist();
}

function clearFilters() {
  ST.q = ""; ST.filter = "todos"; ST.agent = "all"; ST.order = "actividad"; ST.size = 24; ST.page = 1;
  $("#clSearch").value = "";
  $("#clOrder").value = ST.order;
  $("#clPageSize").value = String(ST.size);
  if ($("#clAgentFilter")) $("#clAgentFilter").value = ST.agent;
  refresh();
}

async function loadDirectory() {
  const seq = ++ST.reqSeq, started = performance.now();
  ST.loading = true; ST.error = null; render();
  try {
    if (!ST.isAdmin && !ST.me) throw new Error("AUTH_CONTEXT_MISSING");
    await loadAgents();
    const [clients, tickets] = await withTimeout(Promise.all([
      fetchAll(() => ST.sb.from("clientes").select("id,nombre,ultima_interaccion").order("id", { ascending: true })),
      fetchAll(buildTicketQuery),
    ]), 20000);
    if (seq !== ST.reqSeq) return;
    ST.clients = clients; ST.tickets = tickets; ST.loading = false;
    render(); renderSummary(); persist();
    perfPrimaryDone(); perfPageReady();
  } catch (ex) {
    if (seq !== ST.reqSeq) return;
    ST.loading = false; ST.error = mapError(ex, "CLIENTS_LOAD_FAILED");
    devLog("clientes", "load_directory", `${ST.error.code}:${ST.error.kind}`, null, performance.now() - started);
    render();
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  const ctx = await mountNav("clientes");
  if (!ctx) return;
  ST.sb = ctx.sb; ST.rol = String(ctx.rol || "soporte").toLowerCase();
  ST.me = ctx.perfil?.id || ctx.user?.id || null; ST.isAdmin = ST.rol === "admin";
  document.body.dataset.accessRole = ST.rol;
  if (!ST.isAdmin) document.querySelectorAll(".cl-admin-only").forEach(node => node.remove());

  const qs = readQS({ q: "", filter: "todos", agent: "all", order: "actividad", size: "24", page: "1", vista: "tabla" });
  ST.q = String(qs.q || "").trim();
  ST.filter = FILTERS.has(qs.filter) ? qs.filter : "todos";
  ST.agent = ST.isAdmin ? String(qs.agent || "all") : "all";
  ST.order = ORDERS.has(qs.order) ? qs.order : "actividad";
  ST.size = PAGE_SIZES.has(Number(qs.size)) ? Number(qs.size) : 24;
  ST.page = Math.max(1, Number.parseInt(qs.page, 10) || 1);
  ST.vista = ["tabla", "cards"].includes(qs.vista) ? qs.vista : "tabla";
  if (window.matchMedia("(max-width:860px)").matches) ST.vista = "cards";

  $("#clPills").innerHTML = '<button class="mini btn-ghost" type="button" data-pill="todos">Todos</button><button class="mini btn-ghost" type="button" data-pill="abiertos">Con tickets abiertos</button>';
  $("#clSearch").value = ST.q; $("#clOrder").value = ST.order; $("#clPageSize").value = String(ST.size);
  $("#clScopeNote").textContent = ST.isAdmin
    ? "Directorio limitado a filas autorizadas por RLS. “Sin agente” incluye clientes con al menos un ticket visible sin asignar."
    : "Sólo se consultan clientes autorizados por RLS y tickets asignados a tu perfil.";

  $("#clSearch").addEventListener("input", debounce(() => { ST.q = $("#clSearch").value.trim(); refresh({ resetPage: true }); }, 350));
  $("#clAgentFilter")?.addEventListener("change", () => { ST.agent = $("#clAgentFilter").value || "all"; refresh({ resetPage: true }); });
  $("#clPills").addEventListener("click", event => { const button = event.target.closest("[data-pill]"); if (button) { ST.filter = button.dataset.pill; refresh({ resetPage: true }); } });
  $("#clOrder").addEventListener("change", () => { ST.order = $("#clOrder").value; refresh({ resetPage: true }); });
  $("#clPageSize").addEventListener("change", () => { ST.size = Number($("#clPageSize").value) || 24; refresh({ resetPage: true }); });
  $("#clClear").addEventListener("click", clearFilters);
  $("#clVistaTabla").addEventListener("click", () => { ST.vista = "tabla"; refresh(); });
  $("#clVistaCards").addEventListener("click", () => { ST.vista = "cards"; refresh(); });
  $("#clPagination").addEventListener("click", event => { const button = event.target.closest("[data-page]"); if (!button || button.disabled) return; ST.page = Number(button.dataset.page); refresh(); $("#clPanel")?.scrollIntoView({ behavior: "smooth", block: "start" }); });
  const go = row => { if (row) location.href = `cliente.html?id=${encodeURIComponent(row.dataset.id)}`; };
  $("#clList").addEventListener("click", event => go(event.target.closest?.(".cl-row")));
  $("#clList").addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); go(event.target.closest?.(".cl-row")); } });
  await loadDirectory();
});
