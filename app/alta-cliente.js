/* ============================================================================
   B19D-cont — Alta interna de cliente.
   La creación multitabla (cliente+contacto+equipo+bitácora) NUNCA se hace desde
   el navegador: va por la Edge crear-cliente-janome (la UI no reemplaza RLS).
   Blindaje:
   - capability gate central (shared/capabilities.js): si la Edge no está
     desplegada se avisa desde el inicio y el submit queda bloqueado honesto;
   - validación por campo con mensaje propio y foco al primer error;
   - doble submit bloqueado; botón en estado "Creando…";
   - éxito SOLO tras respuesta válida del servidor;
   - si falla, el formulario conserva todos los valores;
   - errores distinguidos: permiso / indisponible / validación / red / timeout;
   - sin PII en consola (solo códigos sanitizados, dev-only);
   - sin PII en localStorage (no hay borrador persistente; documentado como
     deuda futura en FRONTEND_RESILIENCE_CONTRACT.md).
   ============================================================================ */
import { mountNav } from "./shared/nav-interna.js?v=frontend-final-20260715-01";
import { esc, toast, debounce } from "./global.js?v=frontend-final-20260715-01";
import { mapError, devLog, withTimeout } from "./shared/errors.js";
import { probeEdge, getCapability, noteEdgeResponse } from "./shared/capabilities.js";
import { perfPrimaryDone, perfPageReady, perfCountRequest } from "./shared/perf.js";

const $ = q => document.querySelector(q);
const ST = { sb: null, dups: [], busy: false, cap: "unknown" };
const EDGE = "crear-cliente-janome";
const digits = v => (v || "").replace(/\D/g, "");
const normTxt = v => (v || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

/* ---- validación por campo ---- */
const FIELD_RULES = [
  { id: "acNombre", check: v => (v.trim() ? "" : "Escribe el nombre del cliente o empresa.") },
  { id: "acContacto", check: v => (v.trim() ? "" : "Escribe el nombre del contacto principal.") },
  { id: "acCorreo", check: v => (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim()) ? "" : "Escribe un correo válido (ej. nombre@dominio.com).") },
  { id: "acTelefono", check: v => { const t = digits(v); return !t || t.length === 10 ? "" : "El teléfono debe tener 10 dígitos, o dejarse vacío."; } },
  { id: "acSerie", check: v => (!v.trim() || $("#acModelo").value.trim() ? "" : "Para capturar una serie indica también el modelo.") },
];
const setFieldError = (id, msg) => {
  const wrap = document.querySelector(`[data-field="${id}"]`);
  const errEl = $("#" + id + "Err");
  wrap?.classList.toggle("has-error", !!msg);
  if (errEl) errEl.textContent = msg || "";
};
const validate = (focusFirst = false) => {
  let firstBad = null;
  FIELD_RULES.forEach(r => {
    const msg = r.check($("#" + r.id)?.value || "");
    setFieldError(r.id, msg);
    if (msg && !firstBad) firstBad = r.id;
  });
  if (!firstBad && ST.dups.length && !$("#acDupOk").checked) {
    $("#acStatus").textContent = "Hay posibles duplicados: revísalos y confirma que es un cliente distinto.";
    $("#acStatus").className = "mut ac-status bad";
    return false;
  }
  if (firstBad && focusFirst) $("#" + firstBad)?.focus();
  return !firstBad;
};

/* ---- duplicados (correo / teléfono / nombre) ---- */
const findDups = async () => {
  const nombre = $("#acNombre").value.trim(), correo = $("#acCorreo").value.trim().toLowerCase(), tel = digits($("#acTelefono").value);
  const jobs = [];
  if (correo && /@/.test(correo)) jobs.push(ST.sb.from("clientes_contactos").select("cliente_id,nombre,correo").ilike("correo", correo).limit(5));
  if (tel.length >= 10) jobs.push(ST.sb.from("clientes_contactos").select("cliente_id,nombre,telefono").ilike("telefono", `%${tel}%`).limit(5));
  if (nombre.length >= 3) jobs.push(ST.sb.from("clientes").select("id,nombre").ilike("nombre", `%${nombre}%`).limit(5));
  if (!jobs.length) { ST.dups = []; $("#acDupBox").classList.add("hidden"); return; }
  perfCountRequest(jobs.length);
  const res = await Promise.allSettled(jobs); /* dedupe fallido no bloquea el alta */
  const seen = new Set(), out = [];
  res.forEach(r => {
    if (r.status !== "fulfilled" || r.value.error) return;
    (r.value.data || []).forEach(x => {
      const id = x.cliente_id || x.id;
      if (id && !seen.has(id)) { seen.add(id); out.push({ id, label: x.nombre || x.correo || x.telefono || "Registro" }); }
    });
  });
  ST.dups = out;
  $("#acDupBox").classList.toggle("hidden", !out.length);
  $("#acDupList").innerHTML = out.map(d => `<div class="ac-dup"><span>${esc(d.label)}</span><a class="btn btn-ghost" href="cliente.html?id=${encodeURIComponent(d.id)}" target="_blank" rel="noopener">Ver ficha</a></div>`).join("");
  if (!out.length) $("#acDupOk").checked = false;
};

/* ---- capability gate ---- */
async function checkGate() {
  ST.cap = await probeEdge(EDGE);
  const gate = $("#acGate"), btn = $("#acSubmit");
  if (ST.cap === "unavailable") {
    gate.classList.remove("hidden");
    gate.innerHTML = "<b>El alta de clientes aún no está habilitada en el servidor.</b><span>El formulario puede llenarse, pero la creación está bloqueada hasta que el servicio de alta esté desplegado (dependencia B19B). No se realizará ningún cambio.</span>";
    btn.disabled = true;
  } else if (ST.cap === "permission_denied") {
    gate.classList.remove("hidden");
    gate.innerHTML = "<b>No tienes permisos para crear clientes.</b><span>Contacta al administrador si crees que es un error.</span>";
    btn.disabled = true;
  } else {
    gate.classList.add("hidden");
    btn.disabled = false;
  }
}

/* ---- envío ---- */
const setStatus = (t, cls = "") => { const s = $("#acStatus"); if (s) { s.textContent = t; s.className = `mut ac-status ${cls}`.trim(); } };

const submit = async e => {
  e.preventDefault();
  if (ST.busy) return; /* doble submit bloqueado */
  if (!validate(true)) { if ($("#acStatus").className.indexOf("bad") < 0) setStatus("Revisa los campos marcados en rojo.", "bad"); return; }
  if (ST.cap === "unavailable" || ST.cap === "permission_denied") return; /* gate honesto */

  ST.busy = true;
  const btn = $("#acSubmit");
  btn.disabled = true; btn.classList.add("is-busy"); btn.textContent = "Creando…";
  setStatus("Creando cliente…");
  const t0 = performance.now();
  try {
    const { data: { session } } = await ST.sb.auth.getSession();
    if (!session?.access_token) throw new Error("REQUEST_TIMEOUT: sesión expirada");
    const cfg = globalThis.TICKET_CORE_CONFIG || {}, url = `${String(cfg.supabaseUrl || "").trim()}/functions/v1/${EDGE}`;
    const payload = {
      cliente: { nombre: $("#acNombre").value.trim(), origen: $("#acOrigen").value },
      contacto: { nombre: $("#acContacto").value.trim(), puesto: $("#acPuesto").value.trim() || null, correo: $("#acCorreo").value.trim().toLowerCase(), telefono: digits($("#acTelefono").value) || null },
      equipo: $("#acModelo").value.trim() ? { modelo: $("#acModelo").value.trim(), serie: $("#acSerie").value.trim() || null } : null,
      notas: $("#acNotas").value.trim() || null,
      duplicados_revisados: !ST.dups.length || $("#acDupOk").checked,
      idempotency_key: `alta_${normTxt($("#acNombre").value)}_${normTxt($("#acCorreo").value)}`,
    };
    perfCountRequest();
    const r = await withTimeout(fetch(url, { method: "POST", headers: { authorization: `Bearer ${session.access_token}`, "content-type": "application/json" }, body: JSON.stringify(payload) }), 20000);
    noteEdgeResponse(EDGE, r.status);
    const j = await r.json().catch(() => ({}));
    if (r.status === 404 && !j?.error) {
      ST.cap = "unavailable"; checkGate();
      devLog("alta-cliente", "submit", "CLIENT_CREATE_UNAVAILABLE", 404, performance.now() - t0);
      return setStatus("El alta aún no está habilitada en el servidor. No se creó nada; tus datos siguen en el formulario.", "bad");
    }
    if (r.status === 401 || r.status === 403) {
      ST.cap = "permission_denied"; checkGate();
      devLog("alta-cliente", "submit", "PERMISSION_DENIED", r.status, performance.now() - t0);
      return setStatus("No tienes permisos para crear clientes. No se realizó ningún cambio.", "bad");
    }
    if (r.status === 409 && j?.candidatos) {
      devLog("alta-cliente", "submit", "CLIENT_CREATE_DUPLICATE", 409, performance.now() - t0);
      return setStatus("El servidor detectó duplicados exactos. Revisa las fichas sugeridas antes de crear.", "bad");
    }
    if (!r.ok) {
      devLog("alta-cliente", "submit", "CLIENT_CREATE_FAILED", r.status, performance.now() - t0);
      return setStatus(j?.error && typeof j.error === "string" && j.error.length < 160 ? j.error : "No se pudo crear el cliente. Tus datos siguen en el formulario; inténtalo de nuevo.", "bad");
    }
    /* éxito SOLO con respuesta válida */
    devLog("alta-cliente", "submit", "CLIENT_CREATE_OK", r.status, performance.now() - t0);
    toast("Cliente creado", "ok");
    setStatus("Cliente creado correctamente. Abriendo la ficha…", "ok");
    if (j?.cliente_id) location.href = `cliente.html?id=${encodeURIComponent(j.cliente_id)}`;
  } catch (ex) {
    const err = mapError(ex, "CLIENT_CREATE_FAILED");
    devLog("alta-cliente", "submit", err.code + ":" + err.kind, null, performance.now() - t0);
    setStatus(`${err.human} Tus datos siguen en el formulario.`, "bad");
  } finally {
    ST.busy = false;
    btn.classList.remove("is-busy"); btn.textContent = "Crear cliente";
    if (ST.cap !== "unavailable" && ST.cap !== "permission_denied") btn.disabled = false;
  }
};

document.addEventListener("DOMContentLoaded", async () => {
  const ctx = await mountNav("alta-cliente");
  if (!ctx) return;
  ST.sb = ctx.sb;
  perfPrimaryDone(); perfPageReady();
  checkGate(); /* no bloquea el render: el gate aparece cuando responde */

  const dupCheck = debounce(findDups, 450);
  ["acNombre", "acCorreo", "acTelefono"].forEach(id => $("#" + id).addEventListener("input", dupCheck));
  /* limpiar el error del campo al corregirlo */
  FIELD_RULES.forEach(r => $("#" + r.id)?.addEventListener("input", () => setFieldError(r.id, "")));
  $("#acForm").addEventListener("submit", submit);
  $("#acClear").addEventListener("click", () => {
    $("#acForm").reset();
    ST.dups = [];
    $("#acDupBox").classList.add("hidden");
    FIELD_RULES.forEach(r => setFieldError(r.id, ""));
    setStatus("Formulario limpio.");
  });
});
