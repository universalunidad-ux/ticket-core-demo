import assert from "node:assert/strict";
import test from "node:test";
import {
  createRunGate,
  createVisibilityScheduler,
} from "../../app/shared/operations-journey.js";

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

test("createRunGate deduplica una ejecución concurrente", async () => {
  const pending = deferred();
  let calls = 0;
  const gate = createRunGate(async () => { calls += 1; return pending.promise; });
  const first = gate.run("manual");
  const second = gate.run("interval");
  assert.equal(calls, 0, "la tarea se agenda en microtask");
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(gate.isActive(), true);
  pending.resolve("ok");
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual(a, b);
  assert.equal(a.status, "ok");
  assert.equal(gate.isActive(), false);
});

test("createRunGate convierte una excepción en resultado recuperable", async () => {
  const gate = createRunGate(async () => { throw new Error("network"); });
  const result = await gate.run("manual");
  assert.equal(result.status, "error");
  assert.match(result.error.message, /network/);
});

test("scheduler pausa en hidden, reanuda vencido y limpia listeners/timer", async () => {
  const listeners = new Map();
  const documentRef = {
    hidden: true,
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type, fn) { if (listeners.get(type) === fn) listeners.delete(type); },
  };
  let tick = null;
  let cleared = false;
  let now = 100;
  let calls = 0;
  let pauses = 0;
  let resumes = 0;
  const scheduler = createVisibilityScheduler({
    task: async () => { calls += 1; },
    intervalMs: 50,
    documentRef,
    windowRef: {},
    now: () => now,
    setTimer(fn) { tick = fn; return 7; },
    clearTimer(id) { assert.equal(id, 7); cleared = true; },
    onPause() { pauses += 1; },
    onResume() { resumes += 1; },
  });
  assert.equal((await scheduler.run("manual")).status, "paused");
  await tick();
  assert.equal(calls, 0);
  assert.equal(pauses, 1);
  documentRef.hidden = false;
  now = 200;
  await listeners.get("visibilitychange")();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(resumes, 1);
  assert.equal(calls, 1);
  scheduler.destroy();
  assert.equal(cleared, true);
  assert.equal(listeners.has("visibilitychange"), false);
});
