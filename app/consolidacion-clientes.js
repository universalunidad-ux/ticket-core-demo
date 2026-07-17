/* ==========================================================================
   CONSOLIDACIÓN — análisis y preview únicamente.
   No existe en el repositorio una RPC/implementación transaccional versionada
   que pueda autorizarse y probarse. Por eso este archivo no contiene fetch,
   rpc, insert, update ni delete. CLIENT_RLS_BLOCKED=YES.
   ========================================================================== */
import { mountNav } from "./shared/nav-interna.js?v=frontend-final-20260716-01";
import { readQS, writeQS } from "./shared/query-state.js";
import { fmtFecha, estadoTag } from "./shared/formatters.js?v=frontend-final-20260716-01";
import { esc } from "./global.js?v=frontend-final-20260716-01";
import { mapError, devLog, withTimeout } from "./shared/errors.js";
import { perfPrimaryDone, perfPageReady, perfCountRequest } from "./shared/perf.js";

const $ = q => document.querySelector(q);
const ST = {
  sb: null, isAdmin: false, rows: [], clients: {}, choices: new Map(),
  level: "", order: "oldest", loading: true, error: null, reqSeq: 0,
};

const normalize = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const equal = (a, b) => Boolean(normalize(a) && normalize(a) === normalize(b));
const scorePercent = score => {
  const number = Number(score);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(100, Math.round(number <= 1 ? number * 100 : number)));
};
const safeMatchTag = level => {
  const value = normalize(level), allowed = ["alto", "medio", "bajo"].includes(value) ? value : "";
  const tone = allowed === "alto" ? "ok" : allowed === "medio" ? "warn" : allowed === "bajo" ? "bad" : "";
  return `<span class="tag ${tone}">${allowed || "sin candidato"}</span>`;
};
const choiceFor = ticket => {
  if (!ST.choices.has(ticket.id)) ST.choices.set(ticket.id, { primary: ticket.cliente_id_sugerido && ST.clients[ticket.cliente_id_sugerido] ? "existing" : "new", confirmed: false });
  return ST.choices.get(ticket.id);
};

function comparison(ticket) {
  const candidate = ticket.cliente_id_sugerido ? ST.clients[ticket.cliente_id_sugerido] : null;
  const rows = [
    { label: "Cliente / empresa", captured: ticket.empresa_capturada, candidate: candidate?.nombre, state: equal(ticket.empresa_capturada, candidate?.nombre) ? "match" : candidate ? "different" : "unknown" },
    { label: "Contacto", captured: ticket.nombre_capturado, candidate: null, state: "unknown", note: "Contacto candidato no consultado: contrato RLS bloqueado." },
    { label: "Correo", captured: ticket.correo_capturado, candidate: null, state: "unknown", note: "Requiere comparación dentro de la transacción autorizada." },
    { label: "Teléfono", captured: ticket.telefono_capturado, candidate: null, state: "unknown", note: "Requiere normalización y comparación dentro de la transacción." },
  ];
  return { candidate, rows };
}

function scoreExplanation(ticket, rows) {
  const score = scorePercent(ticket.match_score);
  const matches = rows.filter(row => row.state === "match").map(row => row.label);
  const differences = rows.filter(row => row.state === "different").map(row => row.label);
  const unknown = rows.filter(row => row.state === "unknown").map(row => row.label);
  return `<div class="cq-score-box">
    <div><span class="cq-score">${score == null ? "—" : `${score}%`}</span><span class="mut">Score reportado por el matcher ${safeMatchTag(ticket.match_nivel)}</span></div>
    <p>El backend no expone el desglose del score; la UI no inventa ponderaciones. Observado aquí: ${matches.length ? `${esc(matches.join(", "))} coincide` : "sin coincidencias verificables"}${differences.length ? `; ${esc(differences.join(", "))} difiere` : ""}. ${unknown.length ? `${esc(unknown.join(", "))} queda sin verificar.` : ""}</p>
  </div>`;
}

const valueCell = (value, fallback = "—") => `<span>${esc(value || fallback)}</span>`;
const stateLabel = state => state === "match" ? '<span class="tag ok">Coincide</span>' : state === "different" ? '<span class="tag warn">Difiere</span>' : '<span class="tag">No verificable</span>';

function comparisonHtml(ticket) {
  const { candidate, rows } = comparison(ticket);
  return `<div class="cq-compare-table" role="table" aria-label="Comparación de identidad">
    <div class="cq-compare-row is-head" role="row"><b>Dato</b><b>Capturado en ticket</b><b>Registro candidato</b><b>Resultado</b></div>
    ${rows.map(row => `<div class="cq-compare-row" role="row"><b>${esc(row.label)}</b>${valueCell(row.captured, "Sin dato")}${valueCell(row.candidate, row.note || "No disponible")}${stateLabel(row.state)}</div>`).join("")}
  </div>${scoreExplanation(ticket, rows)}${!candidate ? '<div class="cq-inline-warn">No existe un registro candidato visible; sólo puede prepararse la opción de cliente nuevo.</div>' : ""}`;
}

function conflicts(ticket) {
  const { candidate, rows } = comparison(ticket);
  const items = [];
  if (!candidate) items.push("No hay cliente candidato visible por RLS.");
  if (candidate && rows.some(row => row.state === "different")) items.push("El nombre de empresa capturado difiere del candidato.");
  if (["bajo", ""].includes(normalize(ticket.match_nivel))) items.push("El nivel de coincidencia no es suficiente para decidir automáticamente.");
  items.push("Correo y teléfono del candidato no pueden compararse sin el contrato seguro de contactos.");
  items.push("No hay versión esperada ni bloqueo transaccional para evitar carreras sobre el ticket.");
  return items;
}

function previewHtml(ticket) {
  const choice = choiceFor(ticket), candidate = ticket.cliente_id_sugerido ? ST.clients[ticket.cliente_id_sugerido] : null;
  const selectedExisting = choice.primary === "existing" && candidate;
  const principal = selectedExisting ? candidate.nombre : (ticket.empresa_capturada || ticket.nombre_capturado || "Nuevo cliente");
  const action = selectedExisting
    ? "Asociaría el ticket al cliente existente, conservaría la identidad capturada para auditoría y no modificaría contactos sin una decisión explícita del backend."
    : "Crearía cliente y contacto principal, asociaría el ticket y registraría auditoría como una sola transacción; ninguna de esas escrituras se ejecuta en esta vista.";
  const issues = conflicts(ticket);
  return `<section class="cq-preview" aria-label="Vista previa de consolidación">
    <div class="cq-preview-head"><div><span class="section-kicker">Vista previa</span><h3>${esc(principal)}</h3></div><span class="tag ${choice.confirmed ? "ok" : "warn"}">${choice.confirmed ? "Revisión confirmada" : "Pendiente de confirmación"}</span></div>
    <p>${esc(action)}</p>
    <div class="cq-conflicts"><b>Conflictos y pendientes</b><ul>${issues.map(issue => `<li>${esc(issue)}</li>`).join("")}</ul></div>
    <label class="cq-confirm"><input type="checkbox" data-confirm-review ${choice.confirmed ? "checked" : ""}> Confirmo que revisé coincidencias, diferencias, conflictos y el registro principal seleccionado.</label>
    <button class="btn btn-brand" type="button" disabled aria-disabled="true" title="Falta una operación backend transaccional, autorizada e idempotente">Consolidar registros</button>
    <span class="cq-disabled-reason">CTA deshabilitado: falta el contrato backend transaccional descrito arriba. Esta vista no realiza escrituras.</span>
  </section>`;
}

function cardHtml(ticket) {
  const candidate = ticket.cliente_id_sugerido ? ST.clients[ticket.cliente_id_sugerido] : null, choice = choiceFor(ticket);
  return `<article class="cq-card" data-id="${esc(ticket.id)}">
    <div class="cq-head"><div><div class="cl-name">${esc(ticket.folio || "—")} · ${esc(ticket.titulo || "Sin título")}</div><span class="mut">Creado ${fmtFecha(ticket.fecha_creacion)}</span></div><div>${estadoTag(ticket.estado)}</div></div>
    ${comparisonHtml(ticket)}
    <fieldset class="cq-primary"><legend>Selecciona el registro principal para la vista previa</legend>
      ${candidate ? `<label><input type="radio" name="primary_${esc(ticket.id)}" value="existing" data-primary ${choice.primary === "existing" ? "checked" : ""}> <span><b>${esc(candidate.nombre)}</b><small>Cliente existente sugerido</small></span></label>` : ""}
      <label><input type="radio" name="primary_${esc(ticket.id)}" value="new" data-primary ${choice.primary === "new" ? "checked" : ""}> <span><b>${esc(ticket.empresa_capturada || ticket.nombre_capturado || "Nuevo cliente")}</b><small>Identidad capturada; requeriría alta transaccional</small></span></label>
    </fieldset>
    ${previewHtml(ticket)}
    <div class="cq-actions"><a class="btn btn-ghost" href="ticket.html?id=${encodeURIComponent(ticket.id)}">Ver ticket</a>${candidate ? `<a class="btn btn-ghost" href="cliente.html?id=${encodeURIComponent(ticket.cliente_id_sugerido)}">Ver candidato</a>` : ""}</div>
  </article>`;
}

function filteredRows() {
  let rows = [...ST.rows];
  if (ST.level === "none") rows = rows.filter(row => !row.cliente_id_sugerido);
  else if (ST.level) rows = rows.filter(row => normalize(row.match_nivel) === ST.level);
  if (ST.order === "recent") rows.sort((a, b) => String(b.fecha_creacion || "").localeCompare(String(a.fecha_creacion || "")));
  else if (ST.order === "score") rows.sort((a, b) => (scorePercent(b.match_score) ?? -1) - (scorePercent(a.match_score) ?? -1));
  else rows.sort((a, b) => String(a.fecha_creacion || "").localeCompare(String(b.fecha_creacion || "")));
  return rows;
}

function persist() {
  writeQS({ level: ST.level, order: ST.order === "oldest" ? "" : ST.order });
}

function render() {
  const box = $("#cqList");
  if (ST.loading) { box.innerHTML = '<div class="cl-skel"></div><div class="cl-skel"></div>'; $("#cqTotal").textContent = "Cargando…"; return; }
  if (ST.error) {
    box.innerHTML = `<div class="empty-state"><b>No se pudo cargar la cola.</b><span>${esc(ST.error.human)}</span><button class="btn btn-ghost" id="cqRetry" type="button">Reintentar</button></div>`;
    $("#cqTotal").textContent = "Error"; $("#cqRetry")?.addEventListener("click", load); return;
  }
  const rows = filteredRows();
  $("#cqTotal").textContent = `${rows.length} pendiente${rows.length === 1 ? "" : "s"}`;
  box.innerHTML = rows.length ? rows.map(cardHtml).join("") : '<div class="empty-state"><b>Sin pendientes</b><span>No hay tickets que coincidan con estos filtros dentro de tu alcance.</span></div>';
}

async function load() {
  const seq = ++ST.reqSeq, started = performance.now();
  ST.loading = true; ST.error = null; render();
  if (!ST.isAdmin) {
    ST.loading = false;
    ST.error = { human: "La revisión de consolidación está reservada para administración y no amplía permisos de RLS." };
    render(); return;
  }
  perfCountRequest();
  try {
    const { data, error } = await withTimeout(ST.sb.from("tickets")
      .select("id,folio,titulo,estado,fecha_creacion,empresa_capturada,nombre_capturado,correo_capturado,telefono_capturado,cliente_id_sugerido,match_score,match_nivel")
      .eq("requiere_consolidacion", true)
      .neq("estado", "cerrado")
      .order("fecha_creacion", { ascending: true })
      .limit(200), 12000);
    if (error) throw error;
    if (seq !== ST.reqSeq) return;
    ST.rows = data || [];
    const clientIds = [...new Set(ST.rows.map(row => row.cliente_id_sugerido).filter(Boolean))];
    if (clientIds.length) {
      perfCountRequest();
      const clients = await withTimeout(ST.sb.from("clientes").select("id,nombre").in("id", clientIds), 10000);
      if (clients.error) throw clients.error;
      ST.clients = Object.fromEntries((clients.data || []).map(client => [client.id, client]));
    } else ST.clients = {};
    if (seq !== ST.reqSeq) return;
    ST.loading = false; render(); perfPrimaryDone(); perfPageReady();
  } catch (ex) {
    if (seq !== ST.reqSeq) return;
    ST.loading = false; ST.error = mapError(ex, "CONSOLIDATION_LOAD_FAILED");
    devLog("consolidacion", "load_preview", `${ST.error.code}:${ST.error.kind}`, null, performance.now() - started);
    render();
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  const ctx = await mountNav("consolidacion");
  if (!ctx) return;
  ST.sb = ctx.sb; ST.isAdmin = String(ctx.rol || "").toLowerCase() === "admin";
  const query = readQS({ level: "", order: "oldest" });
  ST.level = ["", "none", "bajo", "medio", "alto"].includes(query.level) ? query.level : "";
  ST.order = ["oldest", "recent", "score"].includes(query.order) ? query.order : "oldest";
  $("#cqNivel").value = ST.level; $("#cqOrden").value = ST.order;
  ["cqNivel", "cqOrden"].forEach(id => $("#" + id).addEventListener("change", () => {
    ST.level = $("#cqNivel").value; ST.order = $("#cqOrden").value; persist(); render();
  }));
  $("#cqList").addEventListener("change", event => {
    const card = event.target.closest(".cq-card"), ticket = ST.rows.find(row => String(row.id) === String(card?.dataset.id));
    if (!ticket) return;
    const choice = choiceFor(ticket);
    if (event.target.matches("[data-primary]")) { choice.primary = event.target.value; choice.confirmed = false; }
    if (event.target.matches("[data-confirm-review]")) choice.confirmed = event.target.checked;
    render();
  });
  load();
});
