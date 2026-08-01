import assert from "node:assert/strict";
import test from "node:test";
import {
  TICKET_RESOLUTION_PREFIX,
  createResolutionStore,
} from "../../app/shared/ticket-resolution-workbench.js";

const memoryStorage = initial => {
  const values = new Map(initial);
  return {
    values,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
};

test("cada ticket usa una clave aislada", () => {
  const storage = memoryStorage();
  const a = createResolutionStore({ storage, ticketId: "A" });
  const b = createResolutionStore({ storage, ticketId: "B" });
  assert.equal(a.key, `${TICKET_RESOLUTION_PREFIX}A`);
  assert.notEqual(a.key, b.key);
});

test("store guarda una versión canónica y timestamp", () => {
  const storage = memoryStorage();
  const store = createResolutionStore({ storage, ticketId: "42", now: () => 77 });
  const state = store.write({ category: "needle", finding: "Listo" }, { id: "42" });
  assert.equal(state.updatedAt, 77);
  assert.equal(JSON.parse(storage.values.get(store.key)).version, 1);
});

test("store recupera el avance del ticket", () => {
  const storage = memoryStorage();
  const store = createResolutionStore({ storage, ticketId: "42" });
  store.write({ category: "electronic", finding: "Reinicio correcto" }, { id: "42" });
  assert.equal(store.read({ id: "42" }).finding, "Reinicio correcto");
});

test("store tolera JSON corrupto", () => {
  const storage = memoryStorage([[`${TICKET_RESOLUTION_PREFIX}42`, "{broken"]]);
  const state = createResolutionStore({ storage, ticketId: "42" }).read({ id: "42", titulo: "Ruido" });
  assert.equal(state.category, "motion");
});

test("clear elimina únicamente la guía activa", () => {
  const storage = memoryStorage([["unrelated", "keep"]]);
  const store = createResolutionStore({ storage, ticketId: "42" });
  store.write({ finding: "x" }, { id: "42" });
  store.clear();
  assert.equal(storage.values.has(store.key), false);
  assert.equal(storage.values.get("unrelated"), "keep");
});
