import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../supabase/migrations/20260730081307_backend_security_macrobatch_01.sql", import.meta.url),
  "utf8",
);

test("01 migration is transaction bounded", () => {
  assert.match(migration, /\bbegin;\s*[\s\S]*\bcommit;\s*$/i);
});

test("02 migration is explicitly non-runtime evidence", () => {
  assert.match(migration, /PREPARED_NOT_APPLIED/);
  assert.match(migration, /STATIC_CONTRACT_ONLY/);
});

test("03 identity guard requires exact M1 RPC", () => {
  assert.match(migration, /to_regprocedure\('public\.tc_current_client_id\(\)'\)/);
  assert.match(migration, /TC_BSM01_REQUIRED_AUTHZ_FUNCTION_MISSING/);
});

test("04 identity guard requires all protected tables", () => {
  for (const table of ["perfiles", "archivos_ticket", "ticket_archivos", "tickets"]) {
    assert.match(migration, new RegExp(`to_regclass\\('public\\.${table}'\\)`));
  }
});

test("05 legacy function search path is fixed without inventing signatures", () => {
  assert.match(migration, /p\.proname in \('norm_match', 'set_updated_at'\)/);
  assert.match(migration, /alter function %s set search_path to pg_catalog, public/);
  assert.doesNotMatch(migration, /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?(?:norm_match|set_updated_at)/i);
});

test("06 profile table-level update is removed", () => {
  assert.match(migration, /revoke insert, update, delete on table public\.perfiles from authenticated/);
  assert.match(migration, /grant update \(nombre, tema, preferencias\) on table public\.perfiles/);
});

test("07 authz grants use exact signatures", () => {
  assert.match(migration, /grant execute on function public\.tc_can_access_ticket\(uuid\)/);
  assert.match(migration, /grant execute on function public\.tc_current_client_id\(\)/);
});

test("08 trigger function stays direct-call denied", () => {
  assert.match(migration, /revoke execute on function public\.tc_prevent_rol_escalation\(\)[\s\S]*from public, anon, authenticated/);
});

test("09 postconditions validate PUBLIC security-definer ACL", () => {
  assert.match(migration, /pg_catalog\.aclexplode/);
  assert.match(migration, /a\.grantee = 0/);
  assert.match(migration, /TC_BSM01_PUBLIC_SECURITY_DEFINER/);
});

test("10 migration has no destructive schema operation", () => {
  assert.doesNotMatch(migration, /\b(?:drop\s+table|drop\s+schema|truncate|alter\s+table[\s\S]{0,80}disable\s+row\s+level\s+security)\b/i);
});
