import assert from "node:assert/strict";
import test from "node:test";
import { isRecoverableTicketTimeout, resolveTicketLoad, waitingTicketRows } from "../../app/shared/ticket-load-orchestrator.js";

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
test("error HTTP no se trata como timeout", () => assert.equal(isRecoverableTicketTimeout(new Error("Tickets HTTP 500")), false));
test("respuesta tardía válida gana sin segunda petición", async () => {
  let calls=0,recoveries=0;
  const result=await resolveTicketLoad({request:async()=>{calls++;return[2]},withTimeout:timeoutHarness([new Error("tickets rest fast timeout"),"pending"]),onRecovering:()=>recoveries++});
  assert.deepEqual(result.rows,[2]); assert.equal(calls,1); assert.equal(recoveries,1); assert.equal(result.recovered,true);
});
test("error definitivo se registra una sola vez", async () => {
  let logs=0;
  await assert.rejects(resolveTicketLoad({request:async()=>{throw new Error("network")},withTimeout:timeoutHarness(["pending"]),onTechnicalError:()=>logs++}));
  assert.equal(logs,1);
});
test("resultado stale se aborta antes de pintar", async () => {
  await assert.rejects(resolveTicketLoad({request:async()=>[],withTimeout:timeoutHarness([new Error("tickets rest fast timeout")]),isLatest:()=>false}),{name:"AbortError"});
});
test("espera canónica excluye estados parecidos", () => {
  assert.deepEqual(waitingTicketRows([{id:1,estado:"esperando_cliente"},{id:2,estado:"espera_interna"},{id:3,estado:"en proceso"}]).map(x=>x.id),[1]);
});
test("espera tolera formato con espacio", () => assert.equal(waitingTicketRows([{estado:"esperando cliente"}]).length,1));
