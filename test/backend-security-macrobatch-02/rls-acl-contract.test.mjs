import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  new URL("../../supabase/migrations/20260730082038_backend_security_macrobatch_02.sql", import.meta.url),
  "utf8",
);

test("11 all observability tables enable RLS", () => {
  assert.equal((sql.match(/enable row level security/g) || []).length, 3);
});

test("12 no policy is created for service-only tables", () => {
  assert.doesNotMatch(sql, /\bcreate policy\b/i);
  assert.match(sql, /TC_BSM02_UNEXPECTED_POLICY/);
});

test("13 PUBLIC anon and authenticated table grants are revoked", () => {
  for (const table of ["app_incidents", "app_error_events", "mail_outbox"]) {
    assert.match(sql, new RegExp(`revoke all on table public\\.${table}[\\s\\S]{0,60}from public, anon, authenticated`));
  }
});

test("14 service role receives explicit table grants", () => {
  assert.equal((sql.match(/grant (?:select|select, insert|select, insert, update)[\s\S]{0,100}\bto service_role;/g) || []).length, 3);
});

test("15 four RPCs are SECURITY DEFINER and all five functions pin empty search_path", () => {
  assert.equal((sql.match(/\bsecurity definer\b/g) || []).length, 4);
  assert.equal((sql.match(/set search_path = ''/g) || []).length, 5);
});

test("16 all four RPCs revoke direct public roles", () => {
  assert.equal((sql.match(/revoke all on function public\./g) || []).length, 4);
});

test("17 all four RPCs grant service-only execution", () => {
  assert.equal((sql.match(/grant execute on function public\./g) || []).length, 4);
  for (const name of [
    "record_client_error",
    "system_health_snapshot",
    "claim_mail_outbox",
    "finish_mail_outbox",
  ]) {
    assert.match(
      sql,
      new RegExp(`grant execute on function public\\.${name}\\([^;]*\\)\\s+to service_role;`),
    );
  }
});

test("18 postcondition verifies RLS and zero policies", () => {
  assert.match(sql, /and c\.relrowsecurity/);
  assert.match(sql, /TC_BSM02_RLS_DISABLED/);
  assert.match(sql, /TC_BSM02_UNEXPECTED_POLICY/);
});

test("19 postcondition checks exact regprocedure signatures", () => {
  for (const signature of [
    "record_client_error\\(text,text,text,text,text,text,uuid,jsonb\\)",
    "system_health_snapshot\\(\\)",
    "claim_mail_outbox\\(uuid,integer\\)",
    "finish_mail_outbox\\(uuid,uuid,text,text\\)",
  ]) {
    assert.match(sql, new RegExp(signature));
  }
});

test("20 migration never disables RLS or grants application roles", () => {
  assert.doesNotMatch(sql, /disable row level security/i);
  assert.doesNotMatch(sql, /\bgrant\b[\s\S]{0,120}\bto (?:public|anon|authenticated)\s*;/i);
});
