/* ==========================================================================
   CLIENTES-02 — filtros y paginación sobre el directorio completo autorizado.
   Sistemas se consultan sólo para IDs de clientes ya visibles por RLS. Si ese
   contrato no responde, el filtro de equipo se deshabilita de forma honesta.
   ========================================================================== */
import { mountNav } from "./shared/nav-interna.js?v=frontend-final-20260716-01";
import { readQS, writeQS } from "./shared/query-state.js";
import { fmtFecha } from "./shared/formatters.js?v=frontend-final-20260716-01";
import { esc, debounce } from "./global.js?v=frontend-final-20260716-01";
import { JANOME_CATALOGO } from "./janome/janome_catalogo.js";
import { perfPrimaryDone, perfSecondaryDone, perfPageReady, perfCountRequest } from "./shared/perf.js";
import { mapError, devLog, withTimeout } from "./shared/errors.js";

const $ = (q, c = document) => c.querySelector(q);
const OPEN = new Set(["abierto", "en_proceso", "esperando_cliente"]);
const PAGE_SIZES = new Set([10, 20, 40]);
const ORDERS = new Set(["actividad", "tickets", "abiertos", "az", "za"]);
const FILTER_KEYS = new Set(["recent", "open", "waiting", "priority", "sla", "consolidation"]);
const BATCH = 500, SYSTEM_CHUNK = 80;
const MACHINE_GROUPS = JANOME_CATALOGO.filter(group => String(group.grupo).startsWith("Máquinas — "));
const MACHINE_MODELS = MACHINE_GROUPS.flatMap(group => group.productos.map(product => ({
  id: String(product.id), name: product.nombre, group: group.grupo,
  family: group.grupo.replace(/^Máquinas — /, ""), kind: "model",
})));
const MACHINE_FAMILIES = MACHINE_GROUPS.map(group => ({
  id: group.grupo, name: group.grupo.replace(/^Máquinas — /, ""), group: group.grupo, kind: "family",
}));
const MODEL_BY_ID = new Map(MACHINE_MODELS.map(model => [model.id, model]));
const FAMILY_BY_ID = new Map(MACHINE_FAMILIES.map(family => [family.id, family]));

const ST = {
  sb: null, me: null, rol: "soporte", isAdmin: false, agents: [],
  clients: [], tickets: [], systems: [], rows: [], q: "", filters: new Set(),
  agent: "all", equipment: null, equipmentAvailable: true,
  order: "actividad", vista: "tabla", page: 1, size: 10,
  draftFilters: new Set(), draftEquipment: null, draftSize: 10,
  loading: true, error: null, reqSeq: 0, equipmentOptionIndex: -1,
};

const normalize = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const ticketState = ticket => normalize(ticket?.estado).replaceAll(" ", "_");
const isOpen = ticket => OPEN.has(ticketState(ticket));
const compareName = (a, b) => String(a?.nombre || "").localeCompare(String(b?.nombre || ""), "es", { sensitivity: "base" });
const stable = (a, b) => compareName(a, b) || String(a.id).localeCompare(String(b.id));
const equipmentFromQuery = (kind, value) => {
  if (kind === "model" && MODEL_BY_ID.has(String(value))) { const model = MODEL_BY_ID.get(String(value)); return { kind, value: model.id, label: model.name }; }
  if (kind === "family" && FAMILY_BY_ID.has(String(value))) { const family = FAMILY_BY_ID.get(String(value)); return { kind, value: family.id, label: family.name }; }
  return null;
};

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
    .select("id,cliente_id,estado,prioridad,fecha_actualizacion,asignado_a,requiere_consolidacion,sla_resolution_deadline")
    .not("cliente_id", "is", null)
    .order("id", { ascending: true });
  if (!ST.isAdmin) query = query.eq("asignado_a", ST.me);
  return query;
};

async function loadSystems(clientIds) {
  const rows = [];
  for (let start = 0; start < clientIds.length; start += SYSTEM_CHUNK) {
    const ids = clientIds.slice(start, start + SYSTEM_CHUNK);
    rows.push(...await fetchAll(() => ST.sb.from("cliente_sistemas")
      .select("id,cliente_id,sistema,tipo_instalacion")
      .in("cliente_id", ids)
      .order("id", { ascending: true })));
  }
  return rows;
}

async function loadAgents() {
  const select = $("#clAgentFilter");
  if (!ST.isAdmin) { select?.closest(".cl-admin-filter")?.remove(); ST.agent = "all"; return; }
  perfCountRequest();
  const { data, error } = await ST.sb.from("perfiles")
    .select("id,nombre,rol").in("rol", ["admin", "supervisor", "soporte"]).order("nombre", { ascending: true });
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

const equipmentMatches = (systems, selection) => {
  if (!selection) return true;
  const machineSystems = systems.filter(system => !["accesorio", "refaccion"].includes(normalize(system.tipo_instalacion)));
  const names = new Set(machineSystems.map(system => normalize(system.sistema)).filter(Boolean));
  if (selection.kind === "model") return names.has(normalize(MODEL_BY_ID.get(selection.value)?.name));
  const family = FAMILY_BY_ID.get(selection.value);
  if (!family) return false;
  const models = MACHINE_MODELS.filter(model => model.group === family.group);
  return models.some(model => names.has(normalize(model.name)));
};

function rebuildRows() {
  const accessibleIds = new Set(ST.clients.map(client => client.id));
  const tickets = ticketsForAgent(ST.tickets).filter(ticket => accessibleIds.has(ticket.cliente_id));
  const ticketsByClient = new Map(), systemsByClient = new Map();
  tickets.forEach(ticket => { const list = ticketsByClient.get(ticket.cliente_id) || []; list.push(ticket); ticketsByClient.set(ticket.cliente_id, list); });
  ST.systems.filter(system => accessibleIds.has(system.cliente_id)).forEach(system => { const list = systemsByClient.get(system.cliente_id) || []; list.push(system); systemsByClient.set(system.cliente_id, list); });
  const agentIsFiltered = ST.isAdmin && ST.agent !== "all", search = normalize(ST.q), now = Date.now(), slaLimit = now + 24 * 3600e3;
  let rows = ST.clients.map(client => {
    const related = ticketsByClient.get(client.id) || [], systems = systemsByClient.get(client.id) || [];
    const open = related.filter(isOpen);
    const lastTicket = related.reduce((latest, ticket) => String(ticket.fecha_actualizacion || "") > String(latest || "") ? ticket.fecha_actualizacion : latest, null);
    const ultima = [client.ultima_interaccion, lastTicket].filter(Boolean).sort().pop() || null;
    return {
      ...client, systems, totalTickets: related.length, abiertos: open.length, ultima,
      recent: Boolean(ultima && now - new Date(ultima).getTime() <= 7 * 864e5),
      waiting: related.some(ticket => ticketState(ticket) === "esperando_cliente"),
      priority: open.some(ticket => ["alta", "urgente"].includes(normalize(ticket.prioridad))),
      sla: open.some(ticket => { const deadline = new Date(ticket.sla_resolution_deadline).getTime(); return Number.isFinite(deadline) && deadline <= slaLimit; }),
      consolidation: related.some(ticket => ticket.requiere_consolidacion === true),
    };
  });
  if (agentIsFiltered) rows = rows.filter(row => row.totalTickets > 0);
  if (search) rows = rows.filter(row => normalize(row.nombre).includes(search));
  if (ST.filters.has("recent")) rows = rows.filter(row => row.recent);
  if (ST.filters.has("open")) rows = rows.filter(row => row.abiertos > 0);
  if (ST.filters.has("waiting")) rows = rows.filter(row => row.waiting);
  if (ST.filters.has("priority")) rows = rows.filter(row => row.priority);
  if (ST.filters.has("sla")) rows = rows.filter(row => row.sla);
  if (ST.filters.has("consolidation")) rows = rows.filter(row => row.consolidation);
  if (ST.equipment && ST.equipmentAvailable) rows = rows.filter(row => equipmentMatches(row.systems, ST.equipment));
  if (ST.order === "tickets") rows.sort((a, b) => b.totalTickets - a.totalTickets || stable(a, b));
  else if (ST.order === "abiertos") rows.sort((a, b) => b.abiertos - a.abiertos || stable(a, b));
  else if (ST.order === "az") rows.sort(stable);
  else if (ST.order === "za") rows.sort((a, b) => -stable(a, b));
  else rows.sort((a, b) => String(b.ultima || "").localeCompare(String(a.ultima || "")) || stable(a, b));
  ST.rows = rows;
  ST.page = Math.min(Math.max(1, ST.page), Math.max(1, Math.ceil(rows.length / ST.size)));
}

const rowTable = row => `<tr class="cl-row" tabindex="0" role="link" data-id="${esc(row.id)}">
  <td><div class="cl-name">${esc(row.nombre || "—")}</div>${ST.equipment ? `<div class="cl-sub">${esc(ST.equipment.label)}</div>` : ""}</td>
  <td class="cl-num">${row.totalTickets}</td><td class="cl-num">${row.abiertos ? `<span class="tag warn">${row.abiertos}</span>` : "0"}</td>
  <td>${row.ultima ? fmtFecha(row.ultima) : '<span class="mut">Sin actividad</span>'}</td><td class="cl-sub">Abrir ›</td></tr>`;
const rowCard = row => `<article class="cl-card cl-row" tabindex="0" role="link" data-id="${esc(row.id)}">
  <div class="cl-card-top"><div class="cl-name">${esc(row.nombre || "—")}</div>${row.abiertos ? `<span class="tag warn">${row.abiertos} abierto${row.abiertos === 1 ? "" : "s"}</span>` : ""}</div>
  <div class="cl-card-meta"><span>${row.totalTickets} ticket${row.totalTickets === 1 ? "" : "s"}</span><span>${row.ultima ? `Actividad ${fmtFecha(row.ultima)}` : "Sin actividad"}</span>${ST.equipment ? `<span>${esc(ST.equipment.label)}</span>` : ""}</div>
</article>`;

const activeFilterCount = () => ST.filters.size + (ST.equipment ? 1 : 0);
const hasAnyFilter = () => Boolean(ST.q || ST.agent !== "all" || ST.filters.size || ST.equipment);

function renderSummary() {
  const accessibleIds = new Set(ST.clients.map(client => client.id));
  const tickets = ticketsForAgent(ST.tickets).filter(ticket => accessibleIds.has(ticket.cliente_id));
  const clientIds = new Set(tickets.map(ticket => ticket.cliente_id).filter(Boolean));
  const chip = (label, value, warn = false) => `<article class="cl-sum${warn && value ? " is-warn" : ""}"><span class="kk">${esc(label)}</span><span class="kv">${value}</span></article>`;
  $("#clSummary").innerHTML = [
    chip(ST.isAdmin && ST.agent !== "all" ? "Clientes del agente" : "Clientes del directorio", ST.isAdmin && ST.agent !== "all" ? clientIds.size : ST.clients.length),
    chip("Tickets visibles", tickets.length), chip("Tickets abiertos", tickets.filter(isOpen).length, true),
  ].join("");
  perfSecondaryDone();
}

function renderFilterButton() {
  const count = activeFilterCount(), badge = $("#clFilterCount"), button = $("#clFiltersBtn");
  badge.textContent = String(count); badge.hidden = count === 0;
  button.classList.toggle("is-active", count > 0);
  button.setAttribute("aria-label", count ? `Filtros, ${count} activos` : "Filtros, ninguno activo");
}

function render() {
  const box = $("#clList"), panel = $("#clPanel");
  panel?.setAttribute("aria-busy", String(ST.loading)); renderFilterButton();
  if (ST.loading) { box.innerHTML = '<div class="cl-skel"></div><div class="cl-skel"></div>'; $("#clCount").textContent = "Cargando clientes…"; $("#clPagination").innerHTML = ""; return; }
  if (ST.error) {
    box.innerHTML = `<div class="empty-state"><b>No se pudo cargar Clientes.</b><span>${esc(ST.error.human)}</span><button class="btn btn-ghost" id="clRetry" type="button">Reintentar</button></div>`;
    $("#clCount").textContent = "Carga interrumpida"; $("#clPagination").innerHTML = ""; $("#clRetry")?.addEventListener("click", loadDirectory); return;
  }
  rebuildRows();
  const total = ST.rows.length, totalPages = Math.max(1, Math.ceil(total / ST.size)), from = (ST.page - 1) * ST.size, shown = ST.rows.slice(from, from + ST.size);
  $("#clVistaTabla")?.classList.toggle("is-active", ST.vista === "tabla"); $("#clVistaCards")?.classList.toggle("is-active", ST.vista === "cards");
  $("#clCount").textContent = total ? `${total} cliente${total === 1 ? "" : "s"} · ${from + 1}–${from + shown.length}` : "0 clientes";
  if (!shown.length) {
    box.innerHTML = `<div class="empty-state"><b>Sin resultados</b><span>${hasAnyFilter() ? "No hay clientes que coincidan con los filtros aplicados." : "No hay clientes dentro de tu alcance autorizado."}</span>${hasAnyFilter() ? '<button class="btn btn-ghost" id="clEmptyClear" type="button">Limpiar búsqueda y filtros</button>' : ""}</div>`;
    $("#clEmptyClear")?.addEventListener("click", clearAll);
  } else box.innerHTML = ST.vista === "cards"
    ? `<div class="cl-cards">${shown.map(rowCard).join("")}</div>`
    : `<div class="cl-table-wrap"><table class="cl-table"><thead><tr class="mut"><th>Cliente</th><th>Tickets</th><th>Abiertos</th><th>Última actividad</th><th></th></tr></thead><tbody>${shown.map(rowTable).join("")}</tbody></table></div>`;
  $("#clPagination").innerHTML = `<button class="mini btn-ghost cl-page-arrow" type="button" data-page="${ST.page - 1}" aria-label="Página anterior" ${ST.page === 1 ? "disabled" : ""}>‹</button><span class="cl-page-label">${ST.page}/${totalPages}</span><button class="mini btn-ghost cl-page-arrow" type="button" data-page="${ST.page + 1}" aria-label="Página siguiente" ${ST.page === totalPages ? "disabled" : ""}>›</button>`;
}

const persist = () => writeQS({
  q: ST.q, filters: [...ST.filters].sort().join(","), agent: ST.isAdmin && ST.agent !== "all" ? ST.agent : "",
  eq_kind: ST.equipment?.kind || "", eq: ST.equipment?.value || "", order: ST.order === "actividad" ? "" : ST.order,
  size: ST.size === 10 ? "" : ST.size, page: ST.page === 1 ? "" : ST.page, vista: ST.vista === "tabla" ? "" : ST.vista,
});

function refresh({ resetPage = false } = {}) { if (resetPage) ST.page = 1; ST.error = null; render(); renderSummary(); persist(); }
function clearAll() {
  ST.q = ""; ST.filters = new Set(); ST.agent = "all"; ST.equipment = null; ST.order = "actividad"; ST.size = 10; ST.page = 1;
  $("#clSearch").value = ""; $("#clOrder").value = ST.order; if ($("#clAgentFilter")) $("#clAgentFilter").value = ST.agent; refresh();
}

function equipmentSuggestions(query = "") {
  const term = normalize(query);
  const families = MACHINE_FAMILIES.filter(item => !term || normalize(`${item.name} ${item.group}`).includes(term));
  const models = MACHINE_MODELS.filter(item => !term || normalize(`${item.name} ${item.family} ${item.group}`).includes(term));
  return [...families, ...models].slice(0, 24);
}

function renderEquipmentSuggestions() {
  const input = $("#clEquipmentInput"), list = $("#clEquipmentList"), options = equipmentSuggestions(input.value);
  ST.equipmentOptionIndex = Math.min(ST.equipmentOptionIndex, options.length - 1);
  list.innerHTML = options.length ? options.map((option, index) => `<button class="cl-equipment-option${index === ST.equipmentOptionIndex ? " is-active" : ""}" type="button" role="option" aria-selected="${index === ST.equipmentOptionIndex}" data-equipment-kind="${option.kind}" data-equipment-value="${esc(option.id)}"><b>${esc(option.name)}</b><span>${option.kind === "family" ? "Familia de máquinas" : "Modelo · producto válido"}</span><small>${esc(option.group)}</small></button>`).join("") : '<div class="cl-equipment-empty">Sin coincidencias entre máquinas del catálogo Janome.</div>';
  list.hidden = false; input.setAttribute("aria-expanded", "true");
}

function chooseEquipment(button) {
  const item = equipmentFromQuery(button.dataset.equipmentKind, button.dataset.equipmentValue);
  if (!item) return;
  ST.draftEquipment = item; $("#clEquipmentInput").value = item.label; $("#clEquipmentList").hidden = true; $("#clEquipmentInput").setAttribute("aria-expanded", "false");
  $("#clFilterStatus").textContent = `${item.kind === "family" ? "Familia" : "Modelo"}: ${item.label}`;
}

function syncFilterDraft() {
  document.querySelectorAll("[data-client-filter]").forEach(input => { input.checked = ST.draftFilters.has(input.value); });
  $("#clFilterAll").classList.toggle("is-active", ST.draftFilters.size === 0);
  $("#clEquipmentInput").value = ST.draftEquipment?.label || ""; $("#clEquipmentInput").disabled = !ST.equipmentAvailable;
  $("#clEquipmentFallback").hidden = ST.equipmentAvailable;
  $("#clFilterPageSize").value = String(ST.draftSize);
  $("#clFilterStatus").textContent = ST.equipmentAvailable ? "Elige una familia o modelo del catálogo; no se incluyen accesorios." : "El filtro de equipo no está disponible porque la lectura autorizada de sistemas falló.";
}

function closeFilters({ focusTrigger = true } = {}) {
  const popup = $("#clFiltersPanel"); if (popup.hidden) return;
  popup.hidden = true; $("#clFiltersBtn").setAttribute("aria-expanded", "false"); $("#clEquipmentList").hidden = true;
  if (focusTrigger) $("#clFiltersBtn").focus();
}

function openFilters() {
  ST.draftFilters = new Set(ST.filters); ST.draftEquipment = ST.equipment ? { ...ST.equipment } : null; ST.draftSize = ST.size;
  syncFilterDraft(); $("#clFiltersPanel").hidden = false; $("#clFiltersBtn").setAttribute("aria-expanded", "true");
  requestAnimationFrame(() => $("#clFilterAll").focus());
}

function applyFilters() {
  const typed = $("#clEquipmentInput").value.trim();
  if (typed && !ST.draftEquipment) { $("#clFilterStatus").textContent = "Selecciona una sugerencia válida del catálogo antes de aplicar."; $("#clEquipmentInput").focus(); return; }
  ST.filters = new Set(ST.draftFilters); ST.equipment = ST.equipmentAvailable ? ST.draftEquipment : null; ST.size = ST.draftSize; ST.page = 1;
  closeFilters(); refresh();
}

async function loadDirectory() {
  const seq = ++ST.reqSeq, started = performance.now(); ST.loading = true; ST.error = null; render();
  try {
    if (!ST.isAdmin && !ST.me) throw new Error("AUTH_CONTEXT_MISSING");
    await loadAgents();
    const [clients, tickets] = await withTimeout(Promise.all([
      fetchAll(() => ST.sb.from("clientes").select("id,nombre,ultima_interaccion,rfc,origen_registro,activo,estatus,calidad_datos,requiere_revision").order("id", { ascending: true })), fetchAll(buildTicketQuery),
    ]), 20000);
    if (seq !== ST.reqSeq) return;
    ST.clients = clients; ST.tickets = tickets;
    try { ST.systems = await withTimeout(loadSystems(clients.map(client => client.id)), 15000); ST.equipmentAvailable = true; }
    catch (equipmentError) {
      ST.systems = []; ST.equipmentAvailable = false; ST.equipment = null;
      const mapped = mapError(equipmentError, "CLIENT_EQUIPMENT_FILTER_UNAVAILABLE"); devLog("clientes", "load_equipment", `${mapped.code}:${mapped.kind}`);
    }
    if (seq !== ST.reqSeq) return;
    ST.loading = false; render(); renderSummary(); persist(); perfPrimaryDone(); perfPageReady();
  } catch (ex) {
    if (seq !== ST.reqSeq) return;
    ST.loading = false; ST.error = mapError(ex, "CLIENTS_LOAD_FAILED"); devLog("clientes", "load_directory", `${ST.error.code}:${ST.error.kind}`, null, performance.now() - started); render();
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  const ctx = await mountNav("clientes"); if (!ctx) return;
  ST.sb = ctx.sb; ST.rol = String(ctx.rol || "soporte").toLowerCase(); ST.me = ctx.perfil?.id || ctx.user?.id || null; ST.isAdmin = ST.rol === "admin";
  document.body.dataset.accessRole = ST.rol; if (!ST.isAdmin) document.querySelectorAll(".cl-admin-only").forEach(node => node.remove());
  const query = readQS({ q: "", filters: "", filter: "", agent: "all", eq_kind: "", eq: "", order: "actividad", size: "10", page: "1", vista: "tabla" });
  ST.q = String(query.q || "").trim();
  ST.filters = new Set(String(query.filters || (query.filter === "abiertos" ? "open" : "")).split(",").filter(key => FILTER_KEYS.has(key)));
  ST.agent = ST.isAdmin ? String(query.agent || "all") : "all"; ST.equipment = equipmentFromQuery(query.eq_kind, query.eq);
  ST.order = ORDERS.has(query.order) ? query.order : "actividad"; ST.size = PAGE_SIZES.has(Number(query.size)) ? Number(query.size) : 10;
  ST.page = Math.max(1, Number.parseInt(query.page, 10) || 1); ST.vista = ["tabla", "cards"].includes(query.vista) ? query.vista : "tabla";
  if (window.matchMedia("(max-width:860px)").matches) ST.vista = "cards";
  $("#clSearch").value = ST.q; $("#clOrder").value = ST.order;
  $("#clScopeNote").textContent = "Filtros y count usan el directorio completo autorizado cargado por lotes; nunca sólo la página visible. Sistemas se intersectan con esos mismos clientes.";

  $("#clSearch").addEventListener("input", debounce(() => { ST.q = $("#clSearch").value.trim(); refresh({ resetPage: true }); }, 350));
  $("#clAgentFilter")?.addEventListener("change", () => { ST.agent = $("#clAgentFilter").value || "all"; refresh({ resetPage: true }); });
  $("#clOrder").addEventListener("change", () => { ST.order = $("#clOrder").value; refresh({ resetPage: true }); });
  $("#clVistaTabla").addEventListener("click", () => { ST.vista = "tabla"; refresh(); }); $("#clVistaCards").addEventListener("click", () => { ST.vista = "cards"; refresh(); });
  $("#clFiltersBtn").addEventListener("click", () => $("#clFiltersPanel").hidden ? openFilters() : closeFilters());
  $("#clFiltersClose").addEventListener("click", () => closeFilters());
  $("#clFiltersPanel").addEventListener("change", event => {
    if (event.target.matches("[data-client-filter]")) { event.target.checked ? ST.draftFilters.add(event.target.value) : ST.draftFilters.delete(event.target.value); syncFilterDraft(); }
    if (event.target.id === "clFilterPageSize") ST.draftSize = Number(event.target.value) || 10;
  });
  $("#clFilterAll").addEventListener("click", () => { ST.draftFilters.clear(); syncFilterDraft(); });
  $("#clFiltersClear").addEventListener("click", () => { ST.draftFilters.clear(); ST.draftEquipment = null; ST.draftSize = 10; syncFilterDraft(); applyFilters(); });
  $("#clFiltersApply").addEventListener("click", applyFilters);
  $("#clEquipmentInput").addEventListener("focus", renderEquipmentSuggestions);
  $("#clEquipmentInput").addEventListener("input", () => { ST.draftEquipment = null; ST.equipmentOptionIndex = -1; renderEquipmentSuggestions(); });
  $("#clEquipmentInput").addEventListener("keydown", event => {
    const options = [...document.querySelectorAll("#clEquipmentList [data-equipment-kind]")];
    if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); ST.equipmentOptionIndex = event.key === "ArrowDown" ? Math.min(ST.equipmentOptionIndex + 1, options.length - 1) : Math.max(ST.equipmentOptionIndex - 1, 0); renderEquipmentSuggestions(); }
    else if (event.key === "Enter" && options.length) { event.preventDefault(); chooseEquipment(options[Math.max(0, ST.equipmentOptionIndex)]); }
  });
  $("#clEquipmentList").addEventListener("click", event => { const option = event.target.closest("[data-equipment-kind]"); if (option) chooseEquipment(option); });
  $("#clPagination").addEventListener("click", event => { const button = event.target.closest("[data-page]"); if (!button || button.disabled) return; ST.page = Number(button.dataset.page); refresh(); });
  const go = row => {
    if (!row) return;
    persist();
    const returnTo = `clientes.html${location.search}`;
    location.href = `cliente.html?id=${encodeURIComponent(row.dataset.id)}&return=${encodeURIComponent(returnTo)}`;
  };
  $("#clList").addEventListener("click", event => go(event.target.closest?.(".cl-row"))); $("#clList").addEventListener("keydown", event => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); go(event.target.closest?.(".cl-row")); } });
  document.addEventListener("keydown", event => { if (event.key === "Escape" && !$("#clFiltersPanel").hidden) { event.preventDefault(); closeFilters(); } });
  document.addEventListener("pointerdown", event => { if (!$("#clFiltersPanel").hidden && !event.target.closest(".cl-filter-wrap")) closeFilters({ focusTrigger: false }); });
  await loadDirectory();
});
