#!/usr/bin/env node
/* TC-U15A-1 — pruebas del contrato canónico de alcance (scope) de Tickets.
   Cubre: scope=all|mine|unassigned, normalización del rol soporte, defensa ante
   manipulación de URL y el filtro PostgREST aplicado EN la consulta. Cero red, cero DOM. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TICKET_SCOPES,
  DEFAULT_ADMIN_SCOPE,
  DEFAULT_SUPPORT_SCOPE,
  isAdminRole,
  resolveTicketScope,
  scopeAssignedFilter,
  ticketMatchesScope,
  scopeLabel,
} from "../app/shared/ticket-scope.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = path => readFileSync(join(root, path), "utf8");
let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`PASS ${name}`) } catch (error) { console.error(`FAIL ${name}: ${error.message}`); process.exitCode = 1 } };

const UID = "11111111-2222-3333-4444-555555555555";

/* Simula EXACTAMENTE la decisión de fetchTicketsRest: capacidad + URL => filtro asignado_a. */
const queryFilter = (requestedScope, { canAllScope, userId, assignee = "" }) => {
  const scope = resolveTicketScope(requestedScope, { isAdmin: !!canAllScope });
  const af = scopeAssignedFilter(scope, userId);
  if (af) return { scope, asignado_a: af };
  if (canAllScope && assignee) return { scope, asignado_a: `eq.${assignee}` };
  return { scope, asignado_a: null };
};

test("scope contract exposes exactly all|mine|unassigned", () => {
  assert.deepEqual(TICKET_SCOPES, ["all", "mine", "unassigned"]);
  assert.equal(DEFAULT_ADMIN_SCOPE, "all");
  assert.equal(DEFAULT_SUPPORT_SCOPE, "mine");
});

test("admin roles: admin, owner y administrador (case-insensitive, trim)", () => {
  for (const r of ["admin", "owner", "administrador", "ADMIN", "  Owner ", "Administrador"]) assert.equal(isAdminRole(r), true, r);
  for (const r of ["soporte", "support", "", null, undefined, "adminx", "ownerx"]) assert.equal(isAdminRole(r), false, String(r));
});

test("admin resolves all|mine|unassigned tal cual; default all", () => {
  const admin = { isAdmin: true };
  assert.equal(resolveTicketScope("all", admin), "all");
  assert.equal(resolveTicketScope("mine", admin), "mine");
  assert.equal(resolveTicketScope("unassigned", admin), "unassigned");
  assert.equal(resolveTicketScope("", admin), "all", "sin scope => all para admin");
  assert.equal(resolveTicketScope("basura", admin), "all", "valor inválido => all");
  assert.equal(resolveTicketScope("UNASSIGNED", admin), "unassigned", "case-insensitive");
});

test("soporte se normaliza SIEMPRE a mine (URL no puede forzar all/unassigned)", () => {
  const support = { isAdmin: false };
  for (const requested of ["all", "unassigned", "mine", "", "basura", "ALL", "Unassigned", null]) {
    assert.equal(resolveTicketScope(requested, support), "mine", `soporte pidió ${String(requested)}`);
  }
});

test("scopeAssignedFilter aplica el alcance en la consulta (asignado_a)", () => {
  assert.equal(scopeAssignedFilter("mine", UID), `eq.${UID}`);
  assert.equal(scopeAssignedFilter("unassigned", UID), "is.null");
  assert.equal(scopeAssignedFilter("all", UID), null);
});

test("consulta admin: all sin filtro, mine por usuario, unassigned IS NULL", () => {
  assert.deepEqual(queryFilter("all", { canAllScope: true, userId: UID }), { scope: "all", asignado_a: null });
  assert.deepEqual(queryFilter("mine", { canAllScope: true, userId: UID }), { scope: "mine", asignado_a: `eq.${UID}` });
  assert.deepEqual(queryFilter("unassigned", { canAllScope: true, userId: UID }), { scope: "unassigned", asignado_a: "is.null" });
});

test("consulta soporte: SIEMPRE eq.usuario, incluso pidiendo all/unassigned por URL", () => {
  for (const requested of ["all", "unassigned", "mine", ""]) {
    const r = queryFilter(requested, { canAllScope: false, userId: UID, assignee: "99999999-0000-0000-0000-000000000000" });
    assert.equal(r.scope, "mine", `soporte ${requested} => mine`);
    assert.equal(r.asignado_a, `eq.${UID}`, "soporte no puede desligarse de su usuario");
  }
});

test("assignee (deep-link) sólo aplica en all y sólo para administración", () => {
  const assignee = "abcdef01-0000-0000-0000-000000000000";
  assert.deepEqual(queryFilter("all", { canAllScope: true, userId: UID, assignee }), { scope: "all", asignado_a: `eq.${assignee}` });
  // soporte con assignee en URL: ignorado, queda en su propio usuario.
  assert.equal(queryFilter("all", { canAllScope: false, userId: UID, assignee }).asignado_a, `eq.${UID}`);
});

test("ticketMatchesScope es coherente con el filtro de consulta", () => {
  const mine = { asignado_a: UID }, other = { asignado_a: "otro" }, free = { asignado_a: null };
  assert.equal(ticketMatchesScope(mine, "mine", UID), true);
  assert.equal(ticketMatchesScope(other, "mine", UID), false);
  assert.equal(ticketMatchesScope(free, "unassigned", UID), true);
  assert.equal(ticketMatchesScope(mine, "unassigned", UID), false);
  assert.equal(ticketMatchesScope(other, "all", UID), true);
});

test("scopeLabel entrega texto visible sincronizado", () => {
  assert.equal(scopeLabel("all"), "Todos");
  assert.equal(scopeLabel("mine"), "Mis tickets");
  assert.equal(scopeLabel("unassigned"), "Sin asignar");
});

/* Guardas de integración sobre el código real: el alcance se aplica en la CONSULTA,
   no sólo tras descargar, y el selector delega en el contrato canónico. */
test("tickets.js aplica el scope EN la consulta REST y expone la API", () => {
  const src = read("app/tickets.js");
  assert.match(src, /from"\.\/shared\/ticket-scope\.js/, "import del contrato canónico ausente");
  assert.match(src, /resolveTicketScope\(qp\("scope"\),\{isAdmin:!!ctx\.canAllScope\}\)/, "scope no resuelto en fetchTicketsRest");
  assert.match(src, /scopeAssignedFilter\(scope,ctx\.userId\)/, "filtro de consulta por scope ausente");
  assert.match(src, /window\.__tkApplyScope=tkApplyScope/, "API de cambio de scope no expuesta");
  assert.match(src, /canAllScope:isAdminRole\(rol\)/, "capacidad all/unassigned no atada a admin/owner/administrador");
  // El cambio de scope reinicia paginación y recarga (con guarda LOAD_SEQ).
  assert.match(src, /tkApplyScope=requested=>\{[\s\S]*tkResetPages\(\);[\s\S]*return load\(\)/, "cambio de scope no reinicia paginación/recarga");
});

test("tickets-assignment.js delega el alcance y sincroniza aria-pressed", () => {
  const src = read("app/tickets-assignment.js");
  assert.match(src, /window\.__tkApplyScope/, "el selector no delega en el contrato canónico");
  assert.match(src, /setAttribute\("aria-pressed"/, "aria-pressed no sincronizado");
  assert.match(src, /data-scope="all"[\s\S]*data-scope="mine"[\s\S]*data-scope="unassigned"/, "pills canónicas ausentes");
  assert.doesNotMatch(src, /tc_assign_filter/, "estado local paralelo (localStorage) debe eliminarse");
  assert.doesNotMatch(src, /function applyFilter/, "filtro cosmético muerto debe eliminarse");
});

if (!process.exitCode) console.log(`TICKET_SCOPE_TESTS=PASS (${passed})`);
