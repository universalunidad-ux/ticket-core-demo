const LAST_CONTEXT_KEY = "tc_operations_journey_v1";

export function createRunGate(task) {
  let active = null;
  let sequence = 0;
  const run = async reason => {
    if (active) return active;
    const token = ++sequence;
    active = Promise.resolve()
      .then(() => task({ reason, token }))
      .then(value => ({ status: "ok", value, token }))
      .catch(error => ({ status: "error", error, token }))
      .finally(() => { active = null; });
    return active;
  };
  return { run, isActive: () => Boolean(active), current: () => sequence };
}

export function createVisibilityScheduler({
  task,
  intervalMs = 0,
  documentRef = document,
  windowRef = window,
  now = () => Date.now(),
  setTimer = windowRef.setInterval.bind(windowRef),
  clearTimer = windowRef.clearInterval.bind(windowRef),
  onPause = () => {},
  onResume = () => {},
}) {
  const gate = createRunGate(task);
  let timer = null;
  let lastRunAt = now();
  let destroyed = false;
  const run = async reason => {
    if (destroyed || documentRef.hidden) return { status: "paused" };
    const result = await gate.run(reason);
    if (result.status === "ok") lastRunAt = now();
    return result;
  };
  const visibility = () => {
    if (documentRef.hidden) {
      onPause();
      return;
    }
    onResume();
    if (intervalMs > 0 && now() - lastRunAt >= intervalMs) run("visibility");
  };
  if (intervalMs > 0) {
    timer = setTimer(() => {
      if (documentRef.hidden) return onPause();
      run("interval");
    }, intervalMs);
  }
  documentRef.addEventListener("visibilitychange", visibility);
  const destroy = () => {
    destroyed = true;
    if (timer !== null) clearTimer(timer);
    documentRef.removeEventListener("visibilitychange", visibility);
  };
  return { run, destroy, isActive: gate.isActive, lastRunAt: () => lastRunAt };
}

const safeLocalHref = (raw, fallback) => {
  try {
    const url = new URL(raw || fallback, location.href);
    if (url.origin !== location.origin) return fallback;
    return `${url.pathname.split("/").pop()}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
};

const readContexts = () => {
  try { return JSON.parse(sessionStorage.getItem(LAST_CONTEXT_KEY) || "{}"); }
  catch { return {}; }
};

const rememberCurrentContext = page => {
  if (!["tickets", "clientes"].includes(page)) return;
  const state = readContexts();
  state[page] = `${location.pathname.split("/").pop()}${location.search}${location.hash}`;
  try { sessionStorage.setItem(LAST_CONTEXT_KEY, JSON.stringify(state)); } catch {}
};

const timeLabel = date => new Intl.DateTimeFormat("es-MX", {
  hour: "2-digit",
  minute: "2-digit",
}).format(date);

export function mountOperationsJourney({
  page,
  onRefresh,
  intervalMs = 0,
  autoRefresh = intervalMs > 0,
  root = document.querySelector("main"),
  documentRef = document,
  windowRef = window,
} = {}) {
  if (!root || typeof onRefresh !== "function") return null;
  const existing = documentRef.querySelector("[data-operations-journey]");
  if (existing) return existing.__operationsController || null;

  rememberCurrentContext(page);
  const contexts = readContexts();
  const query = new URLSearchParams(location.search);
  const ticketsHref = page === "tickets"
    ? `${location.pathname.split("/").pop()}${location.search}${location.hash}`
    : safeLocalHref(query.get("return") || contexts.tickets, "tickets.html");
  const clientsHref = page === "clientes"
    ? `${location.pathname.split("/").pop()}${location.search}${location.hash}`
    : safeLocalHref(contexts.clientes, "clientes.html");

  const bar = documentRef.createElement("section");
  bar.className = "tc-operations-journey";
  bar.dataset.operationsJourney = page || "operacion";
  bar.setAttribute("aria-label", "Recorrido operativo");
  bar.innerHTML = `
    <nav class="tc-operations-links" aria-label="Navegación operativa">
      <a href="dashboard.html"${page === "dashboard" ? ' aria-current="page"' : ""}>Resumen</a>
      <a href="${ticketsHref}"${page === "tickets" || page === "ticket" ? ' aria-current="page"' : ""}>Tickets</a>
      <a href="${clientsHref}"${page === "clientes" || page === "cliente" ? ' aria-current="page"' : ""}>Clientes</a>
      <a href="#" data-operations-client hidden>Ficha</a>
    </nav>
    <div class="tc-operations-sync">
      <span class="tc-operations-state" data-operations-state role="status" aria-live="polite">Lista para actualizar</span>
      <button class="mini btn-ghost" type="button" data-operations-refresh aria-describedby="tcOperationsHint">Actualizar</button>
      <span class="sr-only" id="tcOperationsHint">Actualiza esta vista sin perder filtros ni contexto.</span>
    </div>`;
  root.prepend(bar);

  const state = bar.querySelector("[data-operations-state]");
  const button = bar.querySelector("[data-operations-refresh]");
  const setState = (text, kind = "ready") => {
    state.textContent = text;
    bar.dataset.syncState = kind;
    button.disabled = kind === "busy";
    button.setAttribute("aria-busy", kind === "busy" ? "true" : "false");
  };

  const scheduler = createVisibilityScheduler({
    task: async meta => {
      setState(meta.reason === "manual" ? "Actualizando vista…" : "Sincronizando cambios…", "busy");
      const value = await onRefresh(meta);
      setState(`Actualizada ${timeLabel(new Date())}`, "ok");
      return value;
    },
    intervalMs: autoRefresh ? intervalMs : 0,
    documentRef,
    windowRef,
    onPause: () => setState("Actualización en pausa", "paused"),
    onResume: () => setState("Lista para actualizar", "ready"),
  });

  const refresh = async reason => {
    const result = await scheduler.run(reason);
    if (result.status === "error") setState("No se pudo actualizar · Reintentar", "error");
    return result;
  };
  const click = () => refresh("manual");
  button.addEventListener("click", click);

  const controller = {
    refresh,
    setClient(id, label = "Ficha") {
      const link = bar.querySelector("[data-operations-client]");
      if (!link) return;
      link.hidden = !id;
      if (id) {
        link.href = `cliente.html?id=${encodeURIComponent(id)}`;
        link.textContent = label || "Ficha";
      }
    },
    setState,
    destroy() {
      scheduler.destroy();
      button.removeEventListener("click", click);
      bar.remove();
    },
  };
  bar.__operationsController = controller;
  windowRef.addEventListener("pagehide", () => controller.destroy(), { once: true });
  return controller;
}
