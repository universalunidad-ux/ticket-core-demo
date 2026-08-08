import assert from "node:assert/strict";
import test from "node:test";
import {
  createLatestRequestCoordinator,
  createTicketWorkspaceStore,
  sanitizeTicketWorkspace,
  ticketWorkspaceReturnHref,
  ticketWorkspaceSummary,
} from "../../app/shared/ticket-workspace.js";

test("workspace valida y limita estado persistido", () => {
  const state = sanitizeTicketWorkspace({
    sort: "invalid",
    density: "compact",
    view: "compact",
    column: "en_proceso",
    page: 5000,
    filters: { q: " x ".repeat(200), urgentStale: true, injected: "no" },
  });
  assert.equal(state.sort, "chrono");
  assert.equal(state.density, "compact");
  assert.equal(state.page, 999);
  assert.equal(state.filters.q.length, 160);
  assert.equal(state.filters.urgentStale, true);
  assert.equal("injected" in state.filters, false);
});

test("store tolera JSON inválido y escribe una versión canónica", () => {
  const values = new Map([["workspace", "{broken"]]);
  const storage = {
    getItem: key => values.get(key),
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
  const store = createTicketWorkspaceStore({ storage, key: "workspace", now: () => 42 });
  assert.equal(store.read().view, "kanban");
  const saved = store.write({ sort: "smart", filters: { state: "abierto" } });
  assert.equal(saved.savedAt, 42);
  assert.equal(JSON.parse(values.get("workspace")).sort, "smart");
});

test("coordinator cancela la solicitud anterior y rechaza resultados stale", () => {
  const requests = createLatestRequestCoordinator();
  const first = requests.begin();
  const second = requests.begin();
  assert.equal(first.signal.aborted, true);
  assert.equal(first.isLatest(), false);
  assert.equal(second.isLatest(), true);
  requests.destroy();
  assert.equal(second.signal.aborted, true);
  assert.equal(second.isLatest(), false);
});

test("resumen y retorno reconstruyen contexto sin parámetros desconocidos", () => {
  const state = sanitizeTicketWorkspace({
    sort: "smart",
    view: "compact",
    column: "resuelto",
    page: 2,
    filters: { q: "aguja", urgentStale: true },
  });
  assert.equal(ticketWorkspaceSummary(state, 4), "4 tickets · prioridad inteligente · 2 filtros");
  assert.equal(
    ticketWorkspaceReturnHref(state),
    "tickets.html?q=aguja&urgentStale=1&layout=compact&column=resuelto&page=3",
  );
});
