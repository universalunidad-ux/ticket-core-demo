import assert from "node:assert/strict";
import test from "node:test";
import { isRecoverableTicketLoadError, isRecoverableTicketTimeout, resolveTicketLoad, waitingTicketRows } from "../../app/shared/ticket-load-orchestrator.js";

const timeoutHarness = outcomes => async promise => {
  const next = outcomes.shift();
  if (next instanceof Error) throw next;
  return next === "pending" ? promise : next;
};

test("respuesta rápida válida se conserva", async () => {
  const result = await resolveTicketLoad({ request:async()=>[1], withTimeout:timeoutHarness([[1]]) });
  assert.deepEqual(result.rows, [1]);
  assert.equal(result.source, "rest-fast");
});
test("timeout rápido es recuperable", () => assert.equal(isRecoverableTicketTimeout(new Error("tickets rest fast timeout")), true));
test("timeout, red y 5xx son recuperables; auth no lo es", () => {
  assert.equal(isRecoverableTicketLoadError(new Error("tickets rest fast timeout")), true);
  assert.equal(isRecoverableTicketLoadError(new TypeError("fetch failed")), true);
  assert.equal(isRecoverableTicketLoadError(Object.assign(new Error("Tickets HTTP 503"), { status: 503 })), true);
  assert.equal(isRecoverableTicketLoadError(Object.assign(new Error("Tickets HTTP 401"), { status: 401 })), false);
  assert.equal(isRecoverableTicketLoadError(new Error("Sesión no activa. Inicia sesión.")), false);
});
test("timeout rápido dispara una petición GET realmente nueva", async () => {
  let calls=0,recoveries=0;
  const result=await resolveTicketLoad({request:async()=>{calls++;return[2]},withTimeout:timeoutHarness([new Error("tickets rest fast timeout"),"pending"]),onRecovering:()=>recoveries++});
  assert.deepEqual(result.rows,[2]); assert.equal(calls,2); assert.equal(recoveries,1); assert.equal(result.recovered,true);
  assert.equal(result.source,"rest-fresh-recovery");
});
test("reintento automático queda acotado a dos peticiones", async () => {
  let calls=0;
  await assert.rejects(resolveTicketLoad({
    request:async()=>{calls++;throw Object.assign(new Error("Tickets HTTP 503"),{status:503})},
    withTimeout:timeoutHarness(["pending","pending"]),
  }),/503/);
  assert.equal(calls,2);
});
test("error de autenticación falla cerrado sin reintento", async () => {
  let calls=0;
  await assert.rejects(resolveTicketLoad({
    request:async()=>{calls++;throw Object.assign(new Error("Tickets HTTP 401"),{status:401})},
    withTimeout:timeoutHarness(["pending"]),
  }),/401/);
  assert.equal(calls,1);
});
test("cero tickets es un resultado válido y no reintenta", async () => {
  let calls=0;
  const result=await resolveTicketLoad({request:async()=>{calls++;return[]},withTimeout:timeoutHarness(["pending"])});
  assert.deepEqual(result.rows,[]);
  assert.equal(calls,1);
});
test("error definitivo se registra una sola vez", async () => {
  let logs=0,calls=0;
  await assert.rejects(resolveTicketLoad({request:async()=>{calls++;throw new Error("network")},withTimeout:timeoutHarness(["pending","pending"]),onTechnicalError:()=>logs++}));
  assert.equal(logs,1);
  assert.equal(calls,2);
});
test("resultado stale se aborta antes de pintar", async () => {
  await assert.rejects(resolveTicketLoad({request:async()=>[],withTimeout:timeoutHarness([new Error("tickets rest fast timeout")]),isLatest:()=>false}),{name:"AbortError"});
});
test("espera canónica excluye estados parecidos", () => {
  assert.deepEqual(waitingTicketRows([{id:1,estado:"esperando_cliente"},{id:2,estado:"espera_interna"},{id:3,estado:"en proceso"}]).map(x=>x.id),[1]);
});
test("espera tolera formato con espacio", () => assert.equal(waitingTicketRows([{estado:"esperando cliente"}]).length,1));
