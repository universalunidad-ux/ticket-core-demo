export const TICKET_WORKSPACE_KEY = "tc_ticket_workspace_v2";

const SORT_MODES = new Set(["chrono", "smart"]);
const DENSITIES = new Set(["comfortable", "compact"]);
const FILTER_KEYS = [
  "q", "priority", "state", "type", "client", "clienteId", "noEvidence",
  "impactHigh", "urgentStale", "noClientLinked", "matchMedium", "frBreach",
  "rsBreach", "slaSoon",
];

const cleanText = (value, max = 160) => String(value ?? "").trim().slice(0, max);
const cleanBoolean = value => value === true;

export function sanitizeTicketWorkspace(raw = {}) {
  const filters = {};
  const source = raw && typeof raw.filters === "object" ? raw.filters : {};
  for (const key of FILTER_KEYS) {
    filters[key] = ["q", "priority", "state", "type", "client", "clienteId"].includes(key)
      ? cleanText(source[key])
      : cleanBoolean(source[key]);
  }
  return {
    version: 2,
    savedAt: Number.isFinite(Number(raw.savedAt)) ? Number(raw.savedAt) : 0,
    sort: SORT_MODES.has(raw.sort) ? raw.sort : "chrono",
    density: DENSITIES.has(raw.density) ? raw.density : "comfortable",
    view: raw.view === "compact" ? "compact" : "kanban",
    column: ["abierto", "en_proceso", "resuelto"].includes(raw.column) ? raw.column : "abierto",
    page: Math.max(0, Math.min(999, Number(raw.page) || 0)),
    filters,
  };
}

export function createTicketWorkspaceStore({
  storage = globalThis.localStorage,
  key = TICKET_WORKSPACE_KEY,
  now = () => Date.now(),
} = {}) {
  const read = () => {
    try { return sanitizeTicketWorkspace(JSON.parse(storage?.getItem(key) || "{}")); }
    catch { return sanitizeTicketWorkspace(); }
  };
  const write = value => {
    const next = sanitizeTicketWorkspace({ ...value, savedAt: now() });
    try { storage?.setItem(key, JSON.stringify(next)); } catch {}
    return next;
  };
  const clear = () => {
    try { storage?.removeItem(key); } catch {}
    return sanitizeTicketWorkspace();
  };
  return { read, write, clear };
}

export function createLatestRequestCoordinator({
  AbortControllerRef = globalThis.AbortController,
} = {}) {
  let sequence = 0;
  let active = null;
  const begin = () => {
    active?.abort?.();
    active = AbortControllerRef ? new AbortControllerRef() : null;
    const token = ++sequence;
    return {
      token,
      signal: active?.signal,
      isLatest: () => token === sequence,
      finish: () => {
        if (token === sequence) active = null;
      },
    };
  };
  const destroy = () => {
    sequence += 1;
    active?.abort?.();
    active = null;
  };
  return { begin, destroy, current: () => sequence };
}

export function ticketWorkspaceSummary(state, count = 0) {
  const safe = sanitizeTicketWorkspace(state);
  const active = Object.values(safe.filters).filter(Boolean).length;
  const sort = safe.sort === "smart" ? "prioridad inteligente" : "más recientes";
  const filters = active ? `${active} filtro${active === 1 ? "" : "s"}` : "sin filtros";
  return `${count} ticket${count === 1 ? "" : "s"} · ${sort} · ${filters}`;
}

export function ticketWorkspaceReturnHref(state, base = "tickets.html") {
  const safe = sanitizeTicketWorkspace(state);
  const query = new URLSearchParams();
  const map = {
    q: "q", priority: "priority", state: "state", type: "type",
    clienteId: "cliente_id", noClientLinked: "noClient", matchMedium: "match",
    noEvidence: "noEvidence", impactHigh: "impactHigh", urgentStale: "urgentStale",
    frBreach: "firstResponseOverdue", rsBreach: "slaOverdue", slaSoon: "slaSoon",
  };
  for (const [key, param] of Object.entries(map)) {
    const value = safe.filters[key];
    if (!value) continue;
    query.set(param, typeof value === "boolean" ? "1" : String(value));
  }
  query.set("layout", safe.view);
  query.set("column", safe.column);
  if (safe.page > 0) query.set("page", String(safe.page + 1));
  return `${base}?${query}`;
}
