// TC-LOCAL-DB-RLS-HARNESS-01
// Pruebas del propio harness: utilidades puras de harness.mjs.
// Importar NO debe ejecutar main() ni tocar Docker.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs, redact, detectFailedMigration, INTERNAL_TABLES } from "../../tools/local-db/harness.mjs";

test("parseArgs por defecto: fail-closed, sin dry-run", () => {
  const a = parseArgs([]);
  assert.equal(a.dryRun, false);
  assert.equal(a.keepUp, false);
  assert.equal(typeof a.dbPort, "number");
});

test("parseArgs reconoce flags", () => {
  const a = parseArgs(["--dry-run", "--keep-up", "--db-port", "54399"]);
  assert.equal(a.dryRun, true);
  assert.equal(a.keepUp, true);
  assert.equal(a.dbPort, 54399);
});

test("redact oculta password, JWT y token", () => {
  const s = [
    "postgresql://postgres:",
    "s3cr3t@127.0.0.1:54322/postgres ",
    "password",
    "=abc123 ",
    "eyJhbGciOi",
    ".payloadpart.sigpart",
  ].join("");
  const r = redact(s);
  assert.ok(!r.includes("s3cr3t"), "password de URL no debe filtrarse");
  assert.ok(!r.includes("abc123"), "password= no debe filtrarse");
  assert.ok(!r.includes("payloadpart"), "JWT no debe filtrarse");
  assert.ok(r.includes("127.0.0.1"), "el host local sí puede mostrarse");
});

test("detectFailedMigration extrae la última migración aplicada", () => {
  const log = [
    "Applying migration 20260717093000_authz_functions.sql...",
    "Applying migration 20260721082313_tc_sec_rls_match.sql...",
    "ERROR: policy already exists",
  ].join("\n");
  assert.equal(detectFailedMigration(log), "20260721082313_tc_sec_rls_match.sql");
});

test("detectFailedMigration devuelve null sin coincidencias", () => {
  assert.equal(detectFailedMigration("sin migraciones"), null);
});

test("INTERNAL_TABLES cubre tablas sensibles clave", () => {
  for (const t of ["perfiles", "tickets", "bitacora", "ticket_match_decisiones", "rate_limit_events"]) {
    assert.ok(INTERNAL_TABLES.includes(t), `falta tabla interna: ${t}`);
  }
});
