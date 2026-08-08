export const TICKET_RESOLUTION_VERSION = 1;
export const TICKET_RESOLUTION_PREFIX = "tc_ticket_resolution_v1_";

const cleanText = (value, max = 500) => String(value ?? "").trim().slice(0, max);
const normalize = value => cleanText(value, 1200)
  .normalize("NFD")
  .replace(/\p{Diacritic}/gu, "")
  .toLowerCase();

export const MACHINE_FAILURE_TAXONOMY = Object.freeze([
  {
    id: "thread",
    label: "Hilo, tensión o puntada",
    keywords: ["hilo", "tension", "puntada", "enreda", "costura", "bobina"],
    evidence: "Foto de la puntada por ambos lados y muestra del enhebrado.",
    steps: ["Confirmar hilo, aguja y tela", "Revisar enhebrado y bobina", "Comparar tensión con una muestra"],
  },
  {
    id: "needle",
    label: "Aguja, prensatelas o arrastre",
    keywords: ["aguja", "prensatelas", "arrastre", "diente", "placa"],
    evidence: "Foto de aguja, prensatelas y placa instalados.",
    steps: ["Validar tipo y posición de aguja", "Confirmar prensatelas correcto", "Probar arrastre sin forzar la tela"],
  },
  {
    id: "motion",
    label: "Movimiento, ruido o atasco",
    keywords: ["traba", "atorada", "atasco", "ruido", "volante", "motor", "pedal"],
    evidence: "Video corto del ruido o movimiento, sin desmontar la máquina.",
    steps: ["Detener operación y retirar material", "Revisar zona visible de canilla", "Escalar si persiste ruido mecánico"],
  },
  {
    id: "embroidery",
    label: "Bordado, bastidor o diseño",
    keywords: ["bordado", "bastidor", "diseno", "usb", "patron"],
    evidence: "Foto del bastidor y captura del diseño o mensaje mostrado.",
    steps: ["Confirmar bastidor y formato", "Revisar colocación y estabilizador", "Probar un diseño conocido"],
  },
  {
    id: "electronic",
    label: "Pantalla, energía o conectividad",
    keywords: ["pantalla", "error", "codigo", "enciende", "energia", "wifi", "conexion"],
    evidence: "Foto completa de la pantalla y código exacto, sin datos sensibles.",
    steps: ["Registrar el código exacto", "Comprobar energía y conexiones", "Reiniciar una vez y documentar resultado"],
  },
  {
    id: "other",
    label: "Otro o por confirmar",
    keywords: [],
    evidence: "Modelo exacto, foto general y una descripción paso a paso.",
    steps: ["Confirmar modelo y síntoma", "Reproducir sin asumir la causa", "Elegir evidencia o escalar"],
  },
]);

const categoryById = id => MACHINE_FAILURE_TAXONOMY.find(item => item.id === id)
  || MACHINE_FAILURE_TAXONOMY.at(-1);

export function classifyMachineFailure(ticket = {}) {
  const source = normalize([
    ticket.titulo,
    ticket.descripcion,
    ticket.producto,
    ticket.producto_detectado,
    ticket.tipo_producto,
  ].filter(Boolean).join(" "));
  let best = MACHINE_FAILURE_TAXONOMY.at(-1);
  let score = 0;
  for (const item of MACHINE_FAILURE_TAXONOMY.slice(0, -1)) {
    const next = item.keywords.reduce((total, keyword) => total + (source.includes(keyword) ? 1 : 0), 0);
    if (next > score) {
      best = item;
      score = next;
    }
  }
  return { ...best, confidence: score > 1 ? "alta" : score === 1 ? "media" : "por_confirmar" };
}

export function sanitizeResolutionState(raw = {}, ticket = {}) {
  const suggested = classifyMachineFailure(ticket);
  const category = categoryById(raw.category || suggested.id);
  const allowedSteps = new Set(category.steps);
  return {
    version: TICKET_RESOLUTION_VERSION,
    ticketId: cleanText(raw.ticketId || ticket.id, 100),
    category: category.id,
    completed: [...new Set(Array.isArray(raw.completed) ? raw.completed : [])]
      .filter(step => allowedSteps.has(step)),
    finding: cleanText(raw.finding),
    surveyPrepared: raw.surveyPrepared === true,
    updatedAt: Number.isFinite(Number(raw.updatedAt)) ? Number(raw.updatedAt) : 0,
  };
}

export function createResolutionStore({
  storage = globalThis.localStorage,
  ticketId,
  now = () => Date.now(),
} = {}) {
  const key = `${TICKET_RESOLUTION_PREFIX}${cleanText(ticketId, 100) || "pending"}`;
  const read = ticket => {
    try {
      return sanitizeResolutionState(JSON.parse(storage?.getItem(key) || "{}"), ticket);
    } catch {
      return sanitizeResolutionState({}, ticket);
    }
  };
  const write = (value, ticket) => {
    const next = sanitizeResolutionState({ ...value, ticketId, updatedAt: now() }, ticket);
    try { storage?.setItem(key, JSON.stringify(next)); } catch {}
    return next;
  };
  const clear = () => {
    try { storage?.removeItem(key); } catch {}
  };
  return { key, read, write, clear };
}

export function resolutionProgress(state, ticket = {}) {
  const safe = sanitizeResolutionState(state, ticket);
  const category = categoryById(safe.category);
  const total = category.steps.length;
  const done = safe.completed.length;
  return {
    done,
    total,
    percent: total ? Math.round((done / total) * 100) : 0,
    readyForSurvey: done === total && Boolean(safe.finding),
  };
}

export function buildClosureSurvey({ ticket = {}, state = {}, clientName = "cliente" } = {}) {
  const safe = sanitizeResolutionState(state, ticket);
  const category = categoryById(safe.category);
  const folio = cleanText(ticket.folio, 80) || "este caso";
  const finding = safe.finding || "la solución aplicada";
  return [
    `Hola, ${cleanText(clientName, 100) || "cliente"}.`,
    `Concluimos la revisión de ${folio} (${category.label.toLowerCase()}) y registramos: ${finding}.`,
    "¿La solución resolvió el problema?",
    "Responde con una opción: 1) Sí, quedó resuelto · 2) Parcialmente · 3) No, necesito seguimiento.",
    "Si puedes, agrega una breve valoración del 1 al 5. Tu respuesta nos ayuda a mejorar.",
  ].join("\n\n");
}

export function buildNextStepMessage({ ticket = {}, state = {} } = {}) {
  const safe = sanitizeResolutionState(state, ticket);
  const category = categoryById(safe.category);
  const next = category.steps.find(step => !safe.completed.includes(step));
  if (!next) return `Diagnóstico completado: ${safe.finding || category.label}.`;
  return `Siguiente paso sugerido: ${next}. Evidencia recomendada: ${category.evidence}`;
}

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]));

export function createResolutionWorkbench({
  root,
  getTicket,
  getClientName = () => "cliente",
  storage = globalThis.localStorage,
  onApplyMessage = () => {},
  onStatus = () => {},
  openDialogOwner,
  closeDialogOwner,
} = {}) {
  if (!root) return { update() {}, destroy() {} };
  let controller = null;
  let activeTicketId = "";
  let store = null;
  let state = null;

  const ticket = () => getTicket?.() || {};
  const ensureState = () => {
    const current = ticket();
    const id = cleanText(current.id, 100);
    if (!store || id !== activeTicketId) {
      activeTicketId = id;
      store = createResolutionStore({ storage, ticketId: id });
      state = store.read(current);
    }
    return current;
  };
  const persist = next => {
    const current = ensureState();
    state = store.write(next, current);
    paint();
    return state;
  };
  const paint = () => {
    const current = ensureState();
    const category = categoryById(state.category);
    const progress = resolutionProgress(state, current);
    const categoryBox = root.querySelector("[data-resolution-categories]");
    const stepsBox = root.querySelector("[data-resolution-steps]");
    if (categoryBox) categoryBox.innerHTML = MACHINE_FAILURE_TAXONOMY.map(item => `
      <label class="resolution-choice">
        <input type="radio" name="ticketFailureCategory" value="${item.id}" ${item.id === state.category ? "checked" : ""}>
        <span>${escapeHtml(item.label)}</span>
      </label>`).join("");
    if (stepsBox) stepsBox.innerHTML = category.steps.map((step, index) => `
      <label class="resolution-step">
        <input type="checkbox" value="${escapeHtml(step)}" ${state.completed.includes(step) ? "checked" : ""}>
        <span><b>Paso ${index + 1}</b>${escapeHtml(step)}</span>
      </label>`).join("");
    const evidence = root.querySelector("[data-resolution-evidence]");
    if (evidence) evidence.textContent = category.evidence;
    const finding = root.querySelector("[data-resolution-finding]");
    if (finding && finding.value !== state.finding) finding.value = state.finding;
    const meter = root.querySelector("[data-resolution-meter]");
    if (meter) {
      meter.value = progress.done;
      meter.max = progress.total;
      meter.setAttribute("aria-valuetext", `${progress.done} de ${progress.total} pasos`);
    }
    const summary = root.querySelector("[data-resolution-summary]");
    if (summary) summary.textContent = `${progress.done}/${progress.total} pasos · ${progress.readyForSurvey ? "listo para encuesta" : "diagnóstico en curso"}`;
    const survey = root.querySelector("[data-resolution-survey]");
    if (survey) survey.disabled = !progress.readyForSurvey;
  };
  const open = () => {
    ensureState();
    paint();
    if (openDialogOwner) {
      openDialogOwner(root, {
        initialFocus: "[data-resolution-categories] input:checked",
        onCloseRequest: close,
      });
    } else {
      root.hidden = false;
      root.setAttribute("aria-hidden", "false");
      root.querySelector("input:checked, input, button")?.focus();
    }
  };
  const close = () => {
    if (closeDialogOwner) closeDialogOwner(root);
    else {
      root.hidden = true;
      root.setAttribute("aria-hidden", "true");
      document.querySelector("[data-resolution-open]")?.focus();
    }
  };
  const bind = () => {
    controller?.abort();
    controller = new AbortController();
    const { signal } = controller;
    document.querySelector("[data-resolution-open]")?.addEventListener("click", open, { signal });
    root.addEventListener("click", event => {
      const closeButton = event.target.closest("[data-resolution-close]");
      if (closeButton || event.target === root) return close();
      const nextButton = event.target.closest("[data-resolution-next]");
      if (nextButton) {
        onApplyMessage(buildNextStepMessage({ ticket: ticket(), state }));
        onStatus("Siguiente paso preparado en el compositor.");
      }
      const surveyButton = event.target.closest("[data-resolution-survey]");
      if (surveyButton) {
        const next = persist({ ...state, finding: root.querySelector("[data-resolution-finding]")?.value, surveyPrepared: true });
        onApplyMessage(buildClosureSurvey({ ticket: ticket(), state: next, clientName: getClientName() }), { close: true });
        onStatus("Encuesta de cierre preparada; revísala antes de enviar.");
        close();
      }
      const resetButton = event.target.closest("[data-resolution-reset]");
      if (resetButton) {
        store.clear();
        state = sanitizeResolutionState({}, ticket());
        paint();
        onStatus("Guía reiniciada.");
      }
    }, { signal });
    root.addEventListener("change", event => {
      if (event.target.matches('input[name="ticketFailureCategory"]')) {
        persist({ ...state, category: event.target.value, completed: [] });
      }
      if (event.target.matches("[data-resolution-steps] input")) {
        const checked = [...root.querySelectorAll("[data-resolution-steps] input:checked")].map(input => input.value);
        persist({ ...state, completed: checked });
      }
    }, { signal });
    root.querySelector("[data-resolution-finding]")?.addEventListener("input", event => {
      persist({ ...state, finding: event.target.value });
    }, { signal });
  };
  bind();
  return {
    update() { activeTicketId = ""; ensureState(); if (!root.hidden) paint(); },
    destroy() { controller?.abort(); controller = null; },
  };
}
