/* ==========================================================================
   CONSOLIDACIÓN — análisis y preview únicamente. Sin fetch, rpc, insert,
   update ni delete. CLIENT_CONSOLIDATION_BLOCKED_BACKEND=YES.
   Contactos siguen fuera del contrato integral: CLIENT_RLS_BLOCKED=YES.
   ========================================================================== */
import { mountNav } from "./shared/nav-interna.js?v=frontend-final-20260716-01";
import { isAdminRole } from "./shared/ticket-scope.js?v=frontend-final-20260716-01";
import { readQS, writeQS } from "./shared/query-state.js";
import { fmtFecha, estadoTag } from "./shared/formatters.js?v=frontend-final-20260716-01";
import { esc } from "./global.js?v=frontend-final-20260716-01";
import { mapError, devLog, withTimeout } from "./shared/errors.js";
import { perfPrimaryDone, perfPageReady, perfCountRequest } from "./shared/perf.js";

const $ = q => document.querySelector(q);
const PAGE_SIZE = 10, BATCH = 500, ID_CHUNK = 80;
const CONSOLIDATION_BACKEND_DECISION = "BACKEND_NOT_PRESENT";
const CONSOLIDATION_EXECUTION_ENABLED = false;
const EXPECTED_VERSION_FIELD = "fecha_actualizacion";
const expectedVersionFor = ticket =>
  String(ticket?.[EXPECTED_VERSION_FIELD] || "");
const ST = {
  sb: null, isAdmin: false, rows: [], clients: {}, agents: {}, choices: new Map(),
  level: "", order: "oldest", page: 1, loading: true, error: null, reqSeq: 0,
};

const normalize = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const present = value => Boolean(normalize(value));
const equal = (a, b) => Boolean(present(a) && normalize(a) === normalize(b));
const scorePercent = score => {
  const number = Number(score);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(100, Math.round(number <= 1 ? number * 100 : number)));
};

async function fetchAll(buildQuery) {
  const rows = [];
  for (let start = 0; ; start += BATCH) {
    perfCountRequest();
    const { data, error } = await buildQuery().range(start, start + BATCH - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if ((data || []).length < BATCH) return rows;
  }
}

async function loadByIds(table, columns, ids) {
  const rows = [];
  for (let start = 0; start < ids.length; start += ID_CHUNK) {
    perfCountRequest();
    const { data, error } = await ST.sb.from(table).select(columns).in("id", ids.slice(start, start + ID_CHUNK));
    if (error) throw error;
    rows.push(...(data || []));
  }
  return rows;
}

const candidateFor = ticket => {
  const candidate = ticket.cliente_id_sugerido ? ST.clients[ticket.cliente_id_sugerido] : null;
  return candidate && present(candidate.nombre) ? candidate : null;
};
const agentFor = ticket => ticket.asignado_a ? ST.agents[ticket.asignado_a]?.nombre || "Agente no verificable por RLS" : "Sin agente";
const safeMatchTag = level => {
  const value = normalize(level), allowed = ["alto", "medio", "bajo"].includes(value) ? value : "";
  const tone = allowed === "alto" ? "ok" : allowed === "medio" ? "warn" : allowed === "bajo" ? "bad" : "";
  return `<span class="tag ${tone}">${allowed || "sin nivel"}</span>`;
};
const choiceFor = ticket => {
  if (!ST.choices.has(ticket.id)) ST.choices.set(ticket.id, { primary: candidateFor(ticket) ? "existing" : "new", confirmed: false });
  return ST.choices.get(ticket.id);
};

function compareRows(ticket) {
  const candidate = candidateFor(ticket);
  return [
    { label: "Nombre", captured: ticket.nombre_capturado, candidate: null, state: "unknown", note: "El contacto candidato no se consulta mientras CLIENT_RLS_BLOCKED=YES." },
    { label: "Empresa", captured: ticket.empresa_capturada, candidate: candidate?.nombre, state: candidate ? (equal(ticket.empresa_capturada, candidate.nombre) ? "match" : "different") : "unknown" },
    { label: "Correo", captured: ticket.correo_capturado, candidate: null, state: "unknown", note: "Requiere lectura segura del contacto y normalización backend." },
    { label: "Teléfono", captured: ticket.telefono_capturado, candidate: null, state: "unknown", note: "Requiere lectura segura del contacto y normalización backend." },
  ];
}

const valueHtml = (value, fallback = "Sin dato") => `<span>${esc(present(value) ? value : fallback)}</span>`;
const stateHtml = state => state === "match" ? '<span class="tag ok">Coincide</span>' : state === "different" ? '<span class="tag warn">Difiere</span>' : '<span class="tag">No verificable</span>';

function comparisonHtml(ticket) {
  const candidate = candidateFor(ticket), rows = compareRows(ticket);
  return `<section class="cq-comparison" aria-label="Comparación del caso">
    <div class="cq-side cq-captured"><div class="cq-side-title">DATOS CAPTURADOS EN EL TICKET</div>
      <dl><div><dt>Nombre</dt><dd>${esc(ticket.nombre_capturado || "Sin dato")}</dd></div><div><dt>Empresa</dt><dd>${esc(ticket.empresa_capturada || "Sin dato")}</dd></div><div><dt>Correo</dt><dd>${esc(ticket.correo_capturado || "Sin dato")}</dd></div><div><dt>Teléfono</dt><dd>${esc(ticket.telefono_capturado || "Sin dato")}</dd></div><div><dt>Ticket</dt><dd><a href="ticket.html?id=${encodeURIComponent(ticket.id)}">${esc(ticket.folio || "Abrir ticket")}</a></dd></div><div><dt>Agente</dt><dd>${esc(agentFor(ticket))}</dd></div></dl>
    </div>
    <div class="cq-vs" aria-hidden="true">VS.</div>
    <div class="cq-side cq-candidate"><div class="cq-side-title">CANDIDATO DEL DIRECTORIO</div>
      ${candidate ? `<dl><div><dt>Cliente candidato</dt><dd>${esc(candidate.nombre)}</dd></div><div><dt>Contacto</dt><dd>${ticket.contacto_id_sugerido ? "Referencia presente; detalle bloqueado por RLS" : "Sin contacto candidato verificable"}</dd></div><div><dt>Correo</dt><dd>No verificable por RLS</dd></div><div><dt>Teléfono</dt><dd>No verificable por RLS</dd></div><div><dt>Ficha</dt><dd><a href="cliente.html?id=${encodeURIComponent(candidate.id)}">Abrir candidato</a></dd></div></dl>` : '<div class="cq-no-candidate"><b>Sin candidato válido</b><span>No se tratará un ID ausente, invisible o sin nombre como candidato.</span></div>'}
    </div>
  </section>
  <div class="cq-compare-table" role="table" aria-label="Coincidencias y diferencias">
    <div class="cq-compare-row is-head" role="row"><b>Dato</b><b>Ticket</b><b>Directorio</b><b>Resultado</b></div>
    ${rows.map(row => `<div class="cq-compare-row" role="row"><b>${esc(row.label)}</b>${valueHtml(row.captured)}${valueHtml(row.candidate, row.note || "No disponible")}${stateHtml(row.state)}</div>`).join("")}
  </div>${scoreHtml(ticket, rows)}`;
}

function scoreHtml(ticket, rows) {
  const score = scorePercent(ticket.match_score), matches = rows.filter(row => row.state === "match").map(row => row.label), differences = rows.filter(row => row.state === "different").map(row => row.label), unknown = rows.filter(row => row.state === "unknown").map(row => row.label);
  return `<div class="cq-score-box"><div><span class="cq-score">${score == null ? "—" : `${score}%`}</span><span><b>Confianza reportada</b> ${safeMatchTag(ticket.match_nivel)}</span></div>
    <p><b>Explicación del score:</b> el matcher sólo expone score y nivel; no expone ponderaciones. La UI no las inventa. Coincidencias verificables: ${esc(matches.join(", ") || "ninguna")}. Diferencias: ${esc(differences.join(", ") || "ninguna")}. Sin verificar: ${esc(unknown.join(", ") || "ninguno")}.</p></div>`;
}

function impactHtml(ticket) {
  const choice = choiceFor(ticket), candidate = candidateFor(ticket), existing = choice.primary === "existing" && candidate;
  const impact = existing
    ? `Asociar usaría “${candidate.nombre}” como registro principal y conservaría los datos capturados para auditoría. No debe sobrescribir contactos sin una decisión explícita del backend.`
    : "Mantener como nuevo requeriría crear cliente y contacto, asociar el ticket y registrar auditoría en una sola transacción.";
  const conflicts = [
    !candidate ? "No hay candidato válido visible." : null,
    candidate && !equal(ticket.empresa_capturada, candidate.nombre) ? "La empresa capturada difiere del nombre del candidato." : null,
    "Correo, teléfono y contacto del candidato no son verificables con el contrato RLS actual.",
    "Faltan bloqueo del ticket, versión esperada, idempotencia y respuesta auditable del backend.",
  ].filter(Boolean);
  return `<section class="cq-preview" aria-label="Vista previa e impacto"><div class="cq-preview-head"><div><span class="section-kicker">Vista previa</span><h3>${esc(existing ? candidate.nombre : ticket.empresa_capturada || ticket.nombre_capturado || "Nuevo cliente")}</h3></div><span class="tag ${choice.confirmed ? "ok" : "warn"}">${choice.confirmed ? "Revisión humana confirmada" : "Revisión humana pendiente"}</span></div>
    <p><b>Impacto de confirmar:</b> ${esc(impact)}</p><div class="cq-conflicts"><b>Conflictos</b><ul>${conflicts.map(item => `<li>${esc(item)}</li>`).join("")}</ul></div>
    <label class="cq-confirm"><input type="checkbox" data-confirm-review ${choice.confirmed ? "checked" : ""}> Confirmo que revisé datos, diferencias, candidato, score e impacto.</label>
  </section>`;
}

function actionHtml(ticket) {
  const candidate = candidateFor(ticket);
  const reason = CONSOLIDATION_EXECUTION_ENABLED
    ? "Ejecución disponible."
    : "Backend no disponible: falta una operación única que autorice, bloquee y versione el ticket, revalide la decisión, sea idempotente, audite y devuelva un resultado verificable.";

  return `<div class="cq-action-block"
    data-backend-decision="${esc(CONSOLIDATION_BACKEND_DECISION)}">
    <div class="cq-actions" aria-label="Acciones no disponibles">
      <button class="btn btn-brand" type="button"
        data-consolidation-action="associate"
        disabled aria-disabled="true">
        Asociar a cliente/contacto
      </button>
      <button class="btn btn-ghost" type="button"
        data-consolidation-action="create"
        disabled aria-disabled="true">
        Mantener como nuevo
      </button>
      <button class="btn btn-ghost" type="button"
        data-consolidation-action="discard"
        disabled aria-disabled="true">
        Descartar candidato
      </button>
      <button class="btn btn-ghost" type="button"
        data-consolidation-action="postpone"
        disabled aria-disabled="true">
        Posponer
      </button>
    </div>
    <span class="cq-disabled-reason">
      ${candidate
        ? esc(reason)
        : `Asociar carece además de candidato válido. ${esc(reason)}`}
    </span>
  </div>`;
}

function cardHtml(ticket, open = false) {
  const candidate = candidateFor(ticket), choice = choiceFor(ticket), score = scorePercent(ticket.match_score);
  return `<details class="cq-card" data-id="${esc(ticket.id)}" data-expected-version="${esc(expectedVersionFor(ticket))}" ${open ? "open" : ""}><summary><span><b>${esc(ticket.folio || "Ticket sin folio")}</b><small>${esc(ticket.titulo || ticket.empresa_capturada || "Caso de consolidación")}</small></span><span class="cq-summary-meta">${safeMatchTag(ticket.match_nivel)}<b>${score == null ? "—" : `${score}%`}</b><span>${candidate ? esc(candidate.nombre) : "Sin candidato válido"}</span></span></summary><div class="cq-body">
    <div class="cq-case-meta"><span>${estadoTag(ticket.estado)}</span><span>Creado ${fmtFecha(ticket.fecha_creacion)}</span><a href="ticket.html?id=${encodeURIComponent(ticket.id)}">Abrir ticket</a></div>
    ${comparisonHtml(ticket)}
    <fieldset class="cq-primary"><legend>Registro principal de la vista previa</legend>${candidate ? `<label><input type="radio" name="primary_${esc(ticket.id)}" value="existing" data-primary ${choice.primary === "existing" ? "checked" : ""}> <span><b>${esc(candidate.nombre)}</b><small>Cliente existente sugerido</small></span></label>` : ""}<label><input type="radio" name="primary_${esc(ticket.id)}" value="new" data-primary ${choice.primary === "new" ? "checked" : ""}> <span><b>${esc(ticket.empresa_capturada || ticket.nombre_capturado || "Nuevo cliente")}</b><small>Identidad capturada; requiere alta transaccional</small></span></label></fieldset>
    ${impactHtml(ticket)}${actionHtml(ticket)}
  </div></details>`;
}

function filteredRows() {
  let rows = [...ST.rows];
  if (ST.level === "none") rows = rows.filter(row => !candidateFor(row));
  else if (ST.level) rows = rows.filter(row => candidateFor(row) && normalize(row.match_nivel) === ST.level);
  if (ST.order === "recent") rows.sort((a, b) => String(b.fecha_creacion || "").localeCompare(String(a.fecha_creacion || "")));
  else if (ST.order === "score") rows.sort((a, b) => (scorePercent(b.match_score) ?? -1) - (scorePercent(a.match_score) ?? -1));
  else rows.sort((a, b) => String(a.fecha_creacion || "").localeCompare(String(b.fecha_creacion || "")));
  return rows;
}

const persist = () => writeQS({ level: ST.level, order: ST.order === "oldest" ? "" : ST.order, page: ST.page === 1 ? "" : ST.page });

function render() {
  const box = $("#cqList"), pager = $("#cqPagination");
  if (ST.loading) { box.innerHTML = '<div class="cl-skel"></div><div class="cl-skel"></div>'; $("#cqTotal").textContent = "Cargando…"; $("#cqCount").textContent = "Cargando pendientes…"; pager.innerHTML = ""; return; }
  if (ST.error) {
    box.innerHTML = `<div class="empty-state"><b>No se pudo cargar la cola.</b><span>${esc(ST.error.human)}</span><button class="btn btn-ghost" id="cqRetry" type="button">Reintentar</button></div>`;
    $("#cqTotal").textContent = "Error"; $("#cqCount").textContent = "Carga interrumpida"; pager.innerHTML = ""; $("#cqRetry")?.addEventListener("click", load); return;
  }
  const rows = filteredRows(), pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  ST.page = Math.min(ST.page, pages);
  const start = (ST.page - 1) * PAGE_SIZE, shown = rows.slice(start, start + PAGE_SIZE);
  $("#cqTotal").textContent = `${rows.length} pendiente${rows.length === 1 ? "" : "s"}`;
  $("#cqCount").textContent = rows.length ? `${rows.length} pendientes · ${start + 1}–${start + shown.length}` : "0 pendientes";
  box.innerHTML = shown.length ? shown.map(ticket => cardHtml(ticket)).join("") : '<div class="empty-state"><b>Sin pendientes</b><span>No hay tickets que coincidan con estos filtros dentro de tu alcance.</span></div>';
  pager.innerHTML = `<button class="mini btn-ghost cq-page-arrow" type="button" data-page="${ST.page - 1}" aria-label="Página anterior" ${ST.page === 1 ? "disabled" : ""}>‹</button><span>${ST.page}/${pages}</span><button class="mini btn-ghost cq-page-arrow" type="button" data-page="${ST.page + 1}" aria-label="Página siguiente" ${ST.page === pages ? "disabled" : ""}>›</button>`;
  persist();
}

async function load() {
  const seq = ++ST.reqSeq, started = performance.now();
  ST.loading = true; ST.error = null; render();
  if (!ST.isAdmin) { ST.loading = false; ST.error = { human: "La revisión está reservada para administración y no amplía permisos de RLS." }; render(); return; }
  try {
    const tickets = await withTimeout(fetchAll(() => ST.sb.from("tickets")
      .select("id,folio,titulo,estado,fecha_creacion,fecha_actualizacion,empresa_capturada,nombre_capturado,correo_capturado,telefono_capturado,asignado_a,cliente_id_sugerido,contacto_id_sugerido,match_score,match_nivel")
      .eq("requiere_consolidacion", true).neq("estado", "cerrado").order("fecha_creacion", { ascending: true })), 20000);
    if (seq !== ST.reqSeq) return;
    ST.rows = tickets;
    const clientIds = [...new Set(tickets.map(row => row.cliente_id_sugerido).filter(Boolean))];
    const agentIds = [...new Set(tickets.map(row => row.asignado_a).filter(Boolean))];
    const clients = clientIds.length ? await withTimeout(loadByIds("clientes", "id,nombre", clientIds), 10000) : [];
    let agents = [];
    if (agentIds.length) {
      try { agents = await withTimeout(loadByIds("perfiles", "id,nombre", agentIds), 10000); }
      catch (agentError) { const mapped = mapError(agentError, "CONSOLIDATION_AGENTS_UNAVAILABLE"); devLog("consolidacion", "load_agents", `${mapped.code}:${mapped.kind}`); }
    }
    if (seq !== ST.reqSeq) return;
    ST.clients = Object.fromEntries(clients.map(client => [client.id, client]));
    ST.agents = Object.fromEntries(agents.map(agent => [agent.id, agent]));
    ST.loading = false; render(); perfPrimaryDone(); perfPageReady();
  } catch (ex) {
    if (seq !== ST.reqSeq) return;
    ST.loading = false; ST.error = mapError(ex, "CONSOLIDATION_LOAD_FAILED");
    devLog("consolidacion", "load_preview", `${ST.error.code}:${ST.error.kind}`, null, performance.now() - started); render();
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  const ctx = await mountNav("consolidacion"); if (!ctx) return;
  ST.sb = ctx.sb;
  ST.isAdmin = isAdminRole(ctx.rol);
  const query = readQS({ level: "", order: "oldest", page: "1" });
  ST.level = ["", "none", "bajo", "medio", "alto"].includes(query.level) ? query.level : "";
  ST.order = ["oldest", "recent", "score"].includes(query.order) ? query.order : "oldest";
  ST.page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  $("#cqNivel").value = ST.level; $("#cqOrden").value = ST.order;
  ["cqNivel", "cqOrden"].forEach(id => $("#" + id).addEventListener("change", () => { ST.level = $("#cqNivel").value; ST.order = $("#cqOrden").value; ST.page = 1; render(); }));
  $("#cqList").addEventListener("change", event => {
    const card = event.target.closest(".cq-card"), ticket = ST.rows.find(row => String(row.id) === String(card?.dataset.id)); if (!ticket) return;
    const choice = choiceFor(ticket);
    if (event.target.matches("[data-primary]")) { choice.primary = event.target.value; choice.confirmed = false; }
    if (event.target.matches("[data-confirm-review]")) choice.confirmed = event.target.checked;
    card.outerHTML = cardHtml(ticket, true);
  });
  $("#cqPagination").addEventListener("click", event => { const button = event.target.closest("[data-page]"); if (!button || button.disabled) return; ST.page = Number(button.dataset.page); render(); });
  load();
});
