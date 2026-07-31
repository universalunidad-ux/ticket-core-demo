import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  describeSystemEvent,
  mergeTicketEventHistory,
  publicTimelineSystemEvents,
} from "../../app/shared/ticket-event-timeline.js";

const legacy = (overrides = {}) => ({ accion: "ticket_seguimiento", fecha: "2026-07-30T10:00:00Z", detalle: { texto: "Seguimiento", autor: "soporte", origen: "ticket" }, ...overrides });
const normalized = (overrides = {}) => ({ kind: "mensaje", autor_tipo: "soporte", created_at: "2026-07-30T11:00:00Z", texto: "Respuesta", meta: { origen: "ticket" }, ...overrides });

test("conserva historial sólo legacy", () => assert.equal(mergeTicketEventHistory({ legacy: [legacy()] }).length, 1));
test("conserva historial sólo normalizado", () => assert.equal(mergeTicketEventHistory({ normalized: [normalized()] }).length, 1));
test("une ambas fuentes", () => assert.equal(mergeTicketEventHistory({ legacy: [legacy()], normalized: [normalized()] }).length, 2));
test("deduplica un duplicado semántico exacto sin ID", () => {
  const a = normalized({ kind: "seguimiento", created_at: "2026-07-30T10:00:00Z", texto: "  MISMO   texto ", meta: { origen: "ticket" } });
  const b = legacy({ accion: "seguimiento", detalle: { texto: "mismo texto", autor: "soporte", origen: "ticket" } });
  assert.equal(mergeTicketEventHistory({ normalized: [a], legacy: [b] }).length, 1);
});
test("dos IDs persistentes distintos conservan eventos semánticamente iguales", () => {
  const a = normalized({ id: "evt-a" });
  const b = normalized({ id: "evt-b" });
  assert.equal(mergeTicketEventHistory({ normalized: [a, b] }).length, 2);
});
test("el mismo ID persistente se conserva una sola vez", () => {
  assert.equal(mergeTicketEventHistory({ normalized: [normalized({ id: "evt-a" }), normalized({ id: "evt-a" })] }).length, 1);
});
test("eventos parecidos pero diferentes no se colapsan", () => {
  assert.equal(mergeTicketEventHistory({ normalized: [normalized({ texto: "Respuesta A" }), normalized({ texto: "Respuesta B" })] }).length, 2);
});
test("timestamp y actor iguales no bastan para deduplicar", () => {
  assert.equal(mergeTicketEventHistory({ normalized: [normalized({ texto: "Uno" }), normalized({ texto: "Dos" })] }).length, 2);
});
test("ordena cronológicamente en ascendente", () => {
  const rows = mergeTicketEventHistory({ normalized: [normalized({ id: "late", created_at: "2026-07-30T12:00:00Z" }), normalized({ id: "early", created_at: "2026-07-30T09:00:00Z" })] });
  assert.deepEqual(rows.map(row => row.id), ["early", "late"]);
});
test("timestamps iguales preservan un orden estable", () => {
  const rows = mergeTicketEventHistory({ normalized: [normalized({ id: "a" }), normalized({ id: "b" })], legacy: [legacy({ id: "c", fecha: "2026-07-30T11:00:00Z" })] });
  assert.deepEqual(rows.map(row => row.id), ["a", "b", "c"]);
});
test("datos incompletos se conservan al final", () => {
  const rows = mergeTicketEventHistory({ legacy: [legacy({ id: "missing", fecha: null, detalle: {} })], normalized: [normalized({ id: "complete" })] });
  assert.deepEqual(rows.map(row => row.id), ["complete", "missing"]);
});
test("cero pérdida histórica para ocho eventos distintos", () => {
  const rows = Array.from({ length: 8 }, (_, index) => normalized({ id: `event-${index}`, texto: `Evento ${index}` }));
  assert.equal(mergeTicketEventHistory({ normalized: rows }).length, 8);
});

for (const [name, row, type] of [
  ["ticket creado", { autor_tipo: "sistema", kind: "sistema", texto: "Ticket creado.", meta: { accion: "ticket_creado" } }, "created"],
  ["cambio de estado", { autor_tipo: "sistema", kind: "estado", meta: { estado: "esperando_cliente" } }, "status"],
  ["cierre", { autor_tipo: "soporte", kind: "estado", meta: { accion: "ticket_cierre" } }, "closed"],
  ["reapertura", { autor_tipo: "sistema", kind: "estado", meta: { accion: "ticket_reabierto" } }, "reopened"],
  ["asignación", { autor_tipo: "sistema", kind: "asignacion", texto: "Ticket asignado." }, "assignment"],
  ["prioridad", { autor_tipo: "sistema", kind: "sistema", meta: { prioridad_nueva: "alta" } }, "priority"],
  ["desconocido seguro", { autor_tipo: "sistema", kind: "sistema" }, "unknown"],
]) test(`representa ${name} como evento de sistema`, () => assert.equal(describeSystemEvent(row)?.type, type));

test("una nota interna no entra al timeline público", () => {
  const rows = publicTimelineSystemEvents([{ autor_tipo: "sistema", kind: "estado", visibilidad: "interna", meta: { nota: "secreto interno" } }]);
  assert.deepEqual(rows, []);
});
test("el texto público nunca se toma de meta.nota", () => {
  const event = describeSystemEvent({ autor_tipo: "sistema", kind: "estado", visibilidad: "publica", meta: { nota: "secreto interno", estado: "abierto" } }, { publicTimeline: true });
  assert.doesNotMatch(event.text, /secreto interno/);
});
test("ticket.js escapa título, texto y atributos de eventos de sistema", () => {
  const source = readFileSync(new URL("../../app/ticket.js", import.meta.url), "utf8");
  assert.match(source, /esc\(isSystem\?x\.title:logSenderName\(x\)\)/);
  assert.match(source, /<div class="log-text">\$\{esc\(x\.text\)\}/);
  assert.match(source, /data-system-event-type="\$\{esc\(x\.systemType\|\|"unknown"\)\}"/);
  assert.doesNotMatch(source, /if\(x\.side==="sys"\) return/);
});
test("ticket.js mezcla legacy y normalizados en vez de escoger una sola fuente", () => {
  const source = readFileSync(new URL("../../app/ticket.js", import.meta.url), "utf8");
  assert.match(source, /mergeTicketEventHistory\(\{legacy,normalized:evNorm\}\)/);
  assert.doesNotMatch(source, /LOGS=evNorm\.length\?evNorm:legacy/);
});
test("la asignación canónica se produce en la función autorizada", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/20260715023827_functions_triggers_and_indexes.sql", import.meta.url), "utf8");
  assert.match(sql, /create function public\.manage_ticket_assignment/);
  assert.match(sql, /insert into public\.ticket_eventos[\s\S]*'asignacion'/);
  assert.match(sql, /grant execute on function public\.manage_ticket_assignment[\s\S]*to authenticated, service_role/);
});
