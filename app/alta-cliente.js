/* ==========================================================================
   ALTA DE CLIENTE — preparación, validación y envío a una única operación
   transaccional. No hay escrituras directas a clientes/contactos/sistemas.
   RFC y WhatsApp no se capturan: no existe contrato local confirmado para
   esos campos en clientes_contactos (CLIENT_RLS_BLOCKED=YES).
   ========================================================================== */
import { mountNav } from "./shared/nav-interna.js?v=frontend-final-20260716-01";
import { esc, toast, debounce } from "./global.js?v=frontend-final-20260716-01";
import { mapError, devLog, withTimeout } from "./shared/errors.js";
import { probeEdge, noteEdgeResponse } from "./shared/capabilities.js";
import { perfPrimaryDone, perfPageReady, perfCountRequest } from "./shared/perf.js";
import { JANOME_CATALOGO } from "./janome/janome_catalogo.js";

const $ = q => document.querySelector(q);
const EDGE = "crear-cliente-janome";
const MACHINE_MODELS = JANOME_CATALOGO
  .filter(group => String(group.grupo).startsWith("Máquinas — "))
  .flatMap(group => group.productos.map(product => ({ id: String(product.id), name: product.nombre, group: group.grupo })));
const MODEL_BY_ID = new Map(MACHINE_MODELS.map(model => [model.id, model]));
const ST = {
  sb: null, isAdmin: false, dups: [], dupState: "idle", dupSeq: 0,
  busy: false, cap: "checking", idempotencyKey: "", lastDupName: "", modelIndex: -1,
};

const cleanText = value => String(value || "").replace(/\s+/g, " ").trim();
const normalize = value => cleanText(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const digits = value => String(value || "").replace(/\D/g, "");
const normalizePhone = value => {
  const raw = digits(value);
  if (raw.length === 12 && raw.startsWith("52")) return raw.slice(2);
  if (raw.length === 13 && raw.startsWith("521")) return raw.slice(3);
  return raw;
};
const newIdempotencyKey = () => `client_create_${globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;

const FIELD_RULES = [
  { id: "acNombre", check: value => cleanText(value).length >= 2 ? "" : "Escribe al menos 2 caracteres para el cliente o empresa." },
  { id: "acContacto", check: value => cleanText(value).length >= 2 ? "" : "Escribe el nombre del contacto principal." },
  { id: "acCorreo", check: value => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanText(value).toLowerCase()) ? "" : "Escribe un correo válido (ej. nombre@dominio.com)." },
  { id: "acTelefono", check: value => { const phone = normalizePhone(value); return !phone || phone.length === 10 ? "" : "Usa 10 dígitos; también aceptamos el prefijo +52."; } },
  { id: "acModelo", check: value => {
    const typed = cleanText(value), selected = MODEL_BY_ID.get($("#acModeloCatalogId").value);
    if (!typed) return "";
    return selected && selected.name === typed ? "" : "Selecciona un modelo válido de las sugerencias del catálogo Janome.";
  } },
  { id: "acSerie", check: value => !cleanText(value) || cleanText($("#acModelo").value) ? "" : "Para capturar una serie indica también el modelo." },
];

const modelMatches = query => {
  const term = normalize(query);
  return MACHINE_MODELS.filter(model => !term || normalize(`${model.name} ${model.group}`).includes(term)).slice(0, 24);
};

function closeModelList() {
  $("#acModeloList").hidden = true;
  $("#acModelo").setAttribute("aria-expanded", "false");
  $("#acModelo").removeAttribute("aria-activedescendant");
}

function renderModelSuggestions() {
  const list = $("#acModeloList"), matches = modelMatches($("#acModelo").value);
  ST.modelIndex = Math.min(ST.modelIndex, matches.length - 1);
  list.innerHTML = matches.length ? matches.map((model, index) => `<button class="ac-model-option${index === ST.modelIndex ? " is-active" : ""}" id="acModelOption${index}" type="button" role="option" aria-selected="${index === ST.modelIndex}" data-model-id="${esc(model.id)}"><b>${esc(model.name)}</b><small>${esc(model.group)} · Producto válido</small></button>`).join("") : '<div class="ac-model-empty">Sin coincidencias entre las máquinas del catálogo vigente.</div>';
  list.hidden = false;
  $("#acModelo").setAttribute("aria-expanded", "true");
  if (ST.modelIndex >= 0) $("#acModelo").setAttribute("aria-activedescendant", `acModelOption${ST.modelIndex}`);
}

function chooseModel(id) {
  const model = MODEL_BY_ID.get(String(id));
  if (!model) return;
  $("#acModelo").value = model.name;
  $("#acModeloCatalogId").value = model.id;
  ST.modelIndex = -1;
  setFieldError("acModelo", ""); setFieldError("acSerie", ""); closeModelList();
  $("#acSerie").focus();
}

function initEquipmentCatalog() {
  if (MACHINE_MODELS.length) return;
  $("#acModelo").disabled = true; $("#acSerie").disabled = true;
  $("#acModeloHelp").textContent = "El catálogo local de máquinas no está disponible. El alta continuará sin equipo; no se aceptará captura libre.";
}

function setFieldError(id, message) {
  const input = $("#" + id), wrap = document.querySelector(`[data-field="${id}"]`), error = $("#" + id + "Err");
  wrap?.classList.toggle("has-error", Boolean(message));
  input?.setAttribute("aria-invalid", String(Boolean(message)));
  if (error) error.textContent = message || "";
}

function validate({ focusFirst = false } = {}) {
  let first = null;
  FIELD_RULES.forEach(rule => {
    const message = rule.check($("#" + rule.id)?.value || "");
    setFieldError(rule.id, message);
    if (message && !first) first = $("#" + rule.id);
  });
  if (!first && ST.dups.length && !$("#acDupOk").checked) {
    setStatus("Revisa los posibles duplicados y confirma que se trata de un cliente distinto.", "bad");
    first = $("#acDupOk");
  }
  if (focusFirst) first?.focus();
  return !first;
}

function normalizeForm() {
  ["acNombre", "acContacto", "acPuesto", "acModelo", "acSerie"].forEach(id => { const input = $("#" + id); input.value = cleanText(input.value); });
  $("#acCorreo").value = cleanText($("#acCorreo").value).toLowerCase();
  const phone = normalizePhone($("#acTelefono").value);
  $("#acTelefono").value = phone;
  $("#acNotas").value = String($("#acNotas").value || "").trim();
}

const setStatus = (text, tone = "") => {
  const status = $("#acStatus");
  status.textContent = text;
  status.className = `mut ac-status ${tone}`.trim();
};

function renderDups() {
  const box = $("#acDupBox"), list = $("#acDupList");
  $("#acDupConfirmWrap").classList.add("hidden");
  if (ST.dupState === "idle") { box.classList.add("hidden"); list.innerHTML = ""; return; }
  box.classList.remove("hidden");
  if (ST.dupState === "checking") { list.innerHTML = '<div class="mut ac-dup-state">Buscando coincidencias por nombre…</div>'; return; }
  if (ST.dupState === "error") {
    list.innerHTML = '<div class="ac-dup-state bad">No se pudo completar la revisión local. La transacción debe volver a validar duplicados antes de crear.</div><button class="mini btn-ghost" id="acDupRetry" type="button">Reintentar revisión</button>';
    $("#acDupRetry")?.addEventListener("click", () => findDups({ force: true }));
    return;
  }
  if (!ST.dups.length) {
    list.innerHTML = '<div class="ac-dup-state ok">No encontramos coincidencias por nombre dentro de tu alcance. Correo y teléfono se validan únicamente en el endpoint transaccional.</div>';
    return;
  }
  $("#acDupConfirmWrap").classList.remove("hidden");
  list.innerHTML = ST.dups.map(dup => `<div class="ac-dup"><span><b>${esc(dup.nombre || "Cliente")}</b><small>${esc(dup.reason)}</small></span><a class="btn btn-ghost" href="cliente.html?id=${encodeURIComponent(dup.id)}" target="_blank" rel="noopener">Ver ficha</a></div>`).join("");
}

async function findDups({ force = false } = {}) {
  const seq = ++ST.dupSeq;
  const name = cleanText($("#acNombre").value), safePattern = name.replace(/[%_*,()]/g, " ").replace(/\s+/g, " ").trim();
  const normalizedName = normalize(name), changed = normalizedName !== ST.lastDupName;
  if (!force && !changed && ST.dupState === "complete") return true;
  if (changed) $("#acDupOk").checked = false;
  if (safePattern.length < 3) { ST.dups = []; ST.dupState = "idle"; renderDups(); return true; }
  ST.dupState = "checking"; renderDups();
  try {
    perfCountRequest();
    const { data, error } = await withTimeout(ST.sb.from("clientes")
      .select("id,nombre")
      .ilike("nombre", `%${safePattern}%`)
      .order("nombre", { ascending: true })
      .limit(8), force ? 10000 : 7000);
    if (error) throw error;
    if (seq !== ST.dupSeq) return false;
    ST.dups = (data || []).map(client => ({
      id: client.id, nombre: client.nombre,
      reason: normalize(client.nombre) === normalize(name) ? "Nombre exacto" : "Nombre similar",
    }));
    ST.lastDupName = normalizedName;
    ST.dupState = "complete"; renderDups();
    return true;
  } catch (ex) {
    if (seq !== ST.dupSeq) return false;
    ST.dups = []; ST.dupState = "error"; renderDups();
    const error = mapError(ex, "CLIENT_DUP_CHECK_FAILED");
    devLog("alta-cliente", "duplicate_check", `${error.code}:${error.kind}`);
    return false;
  }
}

function updateSubmitAvailability() {
  const blocked = !ST.isAdmin || ["checking", "unavailable", "permission_denied"].includes(ST.cap);
  $("#acSubmit").disabled = ST.busy || blocked;
}

async function checkGate() {
  const gate = $("#acGate");
  if (!ST.isAdmin) {
    ST.cap = "permission_denied";
    gate.innerHTML = "<b>Alta reservada para administración.</b><span>La interfaz no concede permisos. El endpoint también debe validar el rol antes de cualquier escritura.</span>";
    updateSubmitAvailability();
    return;
  }
  ST.cap = "checking";
  gate.innerHTML = "<b>Verificando el contrato de alta…</b><span>El formulario no enviará datos hasta terminar esta comprobación.</span>";
  updateSubmitAvailability();
  ST.cap = await probeEdge(EDGE);
  if (ST.cap === "unavailable") gate.innerHTML = "<b>El alta aún no está habilitada en el servidor.</b><span>La creación seguirá bloqueada hasta contar con una operación transaccional para cliente, contacto principal, sistema y auditoría. No se realizará ningún cambio.</span>";
  else if (ST.cap === "permission_denied") gate.innerHTML = "<b>No tienes permisos para crear clientes.</b><span>El servicio rechazó este rol; no se realizará ningún cambio.</span>";
  else if (ST.cap === "unknown") gate.innerHTML = "<b>No pudimos confirmar la disponibilidad del servicio.</b><span>Puedes conservar el formulario e intentar el envío; cualquier fallo será recuperable y no se simulará éxito.</span>";
  else gate.classList.add("hidden");
  updateSubmitAvailability();
}

function payload() {
  return {
    cliente: { nombre: cleanText($("#acNombre").value), origen: $("#acOrigen").value },
    contacto: {
      nombre: cleanText($("#acContacto").value),
      puesto: cleanText($("#acPuesto").value) || null,
      correo: cleanText($("#acCorreo").value).toLowerCase(),
      telefono: normalizePhone($("#acTelefono").value) || null,
    },
    equipo: cleanText($("#acModelo").value) ? { modelo: cleanText($("#acModelo").value), serie: cleanText($("#acSerie").value) || null } : null,
    notas: String($("#acNotas").value || "").trim() || null,
    duplicados_revisados: !ST.dups.length || $("#acDupOk").checked,
    idempotency_key: ST.idempotencyKey,
  };
}

function showServerDups(candidates) {
  const rows = Array.isArray(candidates) ? candidates : [];
  ST.dups = rows.slice(0, 8).map((candidate, index) => ({
    id: candidate?.id || candidate?.cliente_id || "",
    nombre: cleanText(candidate?.nombre || candidate?.label) || `Coincidencia ${index + 1}`,
    reason: "Coincidencia confirmada por el servidor",
  })).filter(candidate => candidate.id);
  ST.dupState = ST.dups.length ? "complete" : "error";
  renderDups();
}

async function submit(event) {
  event.preventDefault();
  if (ST.busy) return;
  normalizeForm();
  const duplicateCheckFinished = ST.dupState === "complete" && ST.lastDupName === normalize($("#acNombre").value)
    ? true
    : await findDups({ force: true });
  if (!validate({ focusFirst: true })) { setStatus("Revisa los campos marcados antes de continuar.", "bad"); return; }
  if (!duplicateCheckFinished && ST.dupState === "checking") { setStatus("Espera a que termine la revisión de duplicados.", "bad"); return; }
  if (["checking", "unavailable", "permission_denied"].includes(ST.cap) || !ST.isAdmin) { setStatus("El alta está bloqueada por el contrato del servidor. No se realizó ningún cambio.", "bad"); return; }

  const data = payload();
  const system = data.equipo?.modelo ? ` y el sistema ${data.equipo.modelo}` : "";
  if (!confirm(`¿Crear a “${data.cliente.nombre}” con ${data.contacto.nombre} como contacto principal${system}?`)) { setStatus("Revisa los datos y confirma cuando estén listos."); return; }

  ST.busy = true;
  const button = $("#acSubmit"), started = performance.now();
  button.classList.add("is-busy"); button.textContent = "Creando…"; updateSubmitAvailability();
  setStatus("Creando cliente, contacto principal y datos relacionados…");
  try {
    const { data: { session } } = await ST.sb.auth.getSession();
    if (!session?.access_token) throw new Error("REQUEST_TIMEOUT: sesión expirada");
    const cfg = globalThis.TICKET_CORE_CONFIG || {}, url = `${String(cfg.supabaseUrl || "").trim()}/functions/v1/${EDGE}`;
    perfCountRequest();
    const response = await withTimeout(fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${session.access_token}`, "content-type": "application/json" },
      body: JSON.stringify(data),
    }), 20000);
    noteEdgeResponse(EDGE, response.status);
    const result = await response.json().catch(() => ({}));
    if (response.status === 404 && !result?.error) { ST.cap = "unavailable"; await checkGate(); throw new Error("CLIENT_CREATE_UNAVAILABLE"); }
    if (response.status === 401 || response.status === 403) { ST.cap = "permission_denied"; await checkGate(); throw new Error("PERMISSION_DENIED"); }
    if (response.status === 409) {
      showServerDups(result?.candidatos);
      setStatus("El servidor confirmó posibles duplicados. Revisa las fichas o corrige los datos antes de reintentar.", "bad");
      return;
    }
    if (!response.ok) throw Object.assign(new Error(typeof result?.error === "string" && result.error.length < 160 ? result.error : "CLIENT_CREATE_FAILED"), { status: response.status });
    if (!result?.cliente_id) throw new Error("CLIENT_CREATE_RESPONSE_INVALID");
    devLog("alta-cliente", "submit", "CLIENT_CREATE_OK", response.status, performance.now() - started);
    toast("Cliente creado", "ok");
    setStatus("Cliente creado correctamente. Abriendo la ficha…", "ok");
    ST.idempotencyKey = newIdempotencyKey();
    location.assign(`cliente.html?id=${encodeURIComponent(result.cliente_id)}`);
  } catch (ex) {
    const known = {
      CLIENT_CREATE_UNAVAILABLE: "El alta aún no está disponible en el servidor.",
      PERMISSION_DENIED: "No tienes permisos para crear clientes.",
      CLIENT_CREATE_RESPONSE_INVALID: "El servidor respondió sin un identificador de cliente verificable.",
    }[ex?.message];
    const error = known ? { code: ex.message, kind: "known", human: known } : mapError(ex, "CLIENT_CREATE_FAILED", ex?.status);
    devLog("alta-cliente", "submit", `${error.code}:${error.kind}`, ex?.status ?? null, performance.now() - started);
    setStatus(`${error.human} Tus datos siguen en el formulario; puedes corregirlos o reintentar.`, "bad");
  } finally {
    ST.busy = false; button.classList.remove("is-busy"); button.textContent = "Crear cliente"; updateSubmitAvailability();
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  const ctx = await mountNav("alta-cliente");
  if (!ctx) return;
  ST.sb = ctx.sb; ST.isAdmin = String(ctx.rol || "").toLowerCase() === "admin"; ST.idempotencyKey = newIdempotencyKey();
  if (ST.isAdmin) $("#acAgentBlock").classList.remove("hidden");
  initEquipmentCatalog();
  perfPrimaryDone(); perfPageReady();

  const duplicateCheck = debounce(() => findDups(), 450);
  $("#acNombre").addEventListener("input", duplicateCheck);
  FIELD_RULES.forEach(rule => {
    const input = $("#" + rule.id);
    input?.addEventListener("input", () => setFieldError(rule.id, ""));
    input?.addEventListener("blur", () => { normalizeForm(); setFieldError(rule.id, rule.check(input.value)); });
  });
  $("#acModelo").addEventListener("focus", () => { if (MACHINE_MODELS.length) renderModelSuggestions(); });
  $("#acModelo").addEventListener("input", () => {
    $("#acModeloCatalogId").value = ""; ST.modelIndex = -1; setFieldError("acModelo", ""); setFieldError("acSerie", "");
    if (MACHINE_MODELS.length) renderModelSuggestions();
  });
  $("#acModelo").addEventListener("keydown", event => {
    const matches = modelMatches($("#acModelo").value);
    if (["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      ST.modelIndex = event.key === "ArrowDown" ? Math.min(ST.modelIndex + 1, matches.length - 1) : Math.max(ST.modelIndex - 1, 0);
      renderModelSuggestions();
    } else if (event.key === "Enter" && matches.length) {
      event.preventDefault(); chooseModel(matches[Math.max(0, ST.modelIndex)].id);
    } else if (event.key === "Escape") { event.preventDefault(); closeModelList(); }
  });
  $("#acModeloList").addEventListener("click", event => { const option = event.target.closest("[data-model-id]"); if (option) chooseModel(option.dataset.modelId); });
  $("#acDupOk").addEventListener("change", () => { if ($("#acDupOk").checked) setStatus("Duplicados revisados. Ya puedes continuar."); });
  $("#acForm").addEventListener("submit", submit);
  $("#acClear").addEventListener("click", () => {
    if (ST.busy) return;
    $("#acForm").reset(); $("#acModeloCatalogId").value = ""; closeModelList(); ST.modelIndex = -1; ST.dups = []; ST.dupState = "idle"; ST.lastDupName = ""; ST.idempotencyKey = newIdempotencyKey();
    FIELD_RULES.forEach(rule => setFieldError(rule.id, "")); renderDups(); setStatus("Formulario limpio."); $("#acNombre").focus();
  });
  document.addEventListener("pointerdown", event => { if (!event.target.closest(".ac-model-field")) closeModelList(); });
  checkGate();
});
