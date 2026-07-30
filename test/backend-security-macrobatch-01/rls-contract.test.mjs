import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  new URL("../../supabase/migrations/20260730081307_backend_security_macrobatch_01.sql", import.meta.url),
  "utf8",
);

test("11 RLS remains enabled on profiles", () => {
  assert.match(sql, /alter table public\.perfiles enable row level security/);
});

test("12 profile SELECT is self or cached admin", () => {
  assert.match(sql, /create policy perfiles_select_self[\s\S]*id = \(select auth\.uid\(\)\)[\s\S]*\(select public\.tc_is_admin\(\)\)/);
});

test("13 profile UPDATE has USING and WITH CHECK", () => {
  const block = sql.match(/create policy perfiles_update_self[\s\S]*?;/)?.[0] || "";
  assert.match(block, /\busing\s*\(/i);
  assert.match(block, /\bwith check\s*\(/i);
});

test("14 canonical attachment RLS is enabled", () => {
  assert.match(sql, /alter table public\.archivos_ticket enable row level security/);
});

test("15 legacy attachment RLS is enabled", () => {
  assert.match(sql, /alter table public\.ticket_archivos enable row level security/);
});

test("16 canonical attachment client ownership is server-derived", () => {
  const block = sql.match(/create policy archivos_ticket_client_owner_select[\s\S]*?;\n/)?.[0] || "";
  assert.match(block, /t\.cliente_id = \(select public\.tc_current_client_id\(\)\)/);
  assert.doesNotMatch(block, /auth\.jwt\(\).*cliente/i);
});

test("17 legacy attachment client ownership is server-derived", () => {
  const block = sql.match(/create policy ticket_archivos_client_owner_select[\s\S]*?;\n/)?.[0] || "";
  assert.match(block, /t\.cliente_id = \(select public\.tc_current_client_id\(\)\)/);
});

test("18 attachment staff policies use the canonical ticket predicate", () => {
  assert.equal(
    (sql.match(/\(select public\.tc_can_access_ticket\(ticket_id\)\)/g) || []).length,
    2,
  );
});

test("19 anonymous table access is explicitly revoked", () => {
  for (const table of ["perfiles", "archivos_ticket", "ticket_archivos"]) {
    assert.match(sql, new RegExp(`revoke all on table public\\.${table} from public, anon`));
  }
});

test("20 no client attachment write policy is introduced", () => {
  assert.doesNotMatch(sql, /create policy \w*client\w*[\s\S]{0,160}for (?:insert|update|delete|all)/i);
});
