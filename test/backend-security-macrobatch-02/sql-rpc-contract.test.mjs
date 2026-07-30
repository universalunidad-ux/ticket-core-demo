import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  new URL("../../supabase/migrations/20260730082038_backend_security_macrobatch_02.sql", import.meta.url),
  "utf8",
);

test("01 migration is transaction bounded and static-only", () => {
  assert.match(sql, /\bbegin;\s*[\s\S]*\bcommit;\s*$/i);
  assert.match(sql, /PREPARED_NOT_APPLIED/);
  assert.match(sql, /STATIC_CONTRACT_ONLY/);
});

test("02 exact three-table object collision guard exists", () => {
  for (const table of ["app_error_events", "app_incidents", "mail_outbox"]) {
    assert.match(sql, new RegExp(`to_regclass\\('public\\.${table}'\\)`));
  }
});

test("03 error RPC exact signature is created once", () => {
  assert.equal((sql.match(/create function public\.record_client_error\(/g) || []).length, 1);
  assert.match(sql, /record_client_error\(\s*p_fingerprint text,[\s\S]*p_context jsonb\s*\)/);
});

test("04 error RPC validates fingerprint and request id", () => {
  assert.match(sql, /p_fingerprint !~ '\^\[a-f0-9\]\{64\}\$'/);
  assert.match(sql, /or p_request_id is null/);
});

test("05 incident upsert is fingerprint-idempotent", () => {
  assert.match(sql, /on conflict \(fingerprint\) do update/);
  assert.match(sql, /occurrence_count = public\.app_incidents\.occurrence_count \+ 1/);
});

test("06 critical notification outbox is idempotent", () => {
  assert.match(sql, /'incident-critical:' \|\| p_fingerprint/);
  assert.match(sql, /on conflict \(idempotency_key\) do nothing/);
});

test("07 audit event is written in the same RPC transaction", () => {
  assert.match(sql, /insert into public\.bitacora[\s\S]*'client_error_reported'/);
});

test("08 health RPC returns only aggregate fields", () => {
  assert.match(sql, /create function public\.system_health_snapshot\(\)/);
  for (const key of ["status", "open_incidents", "critical_incidents", "pending_outbox", "checked_at"]) {
    assert.match(sql, new RegExp(`'${key}'`));
  }
  assert.doesNotMatch(sql.match(/create function public\.system_health_snapshot\(\)[\s\S]*?\$system_health_snapshot\$;/)?.[0] || "", /select \*/i);
});

test("09 claim RPC uses SKIP LOCKED and bounded limit", () => {
  assert.match(sql, /create function public\.claim_mail_outbox\(/);
  assert.match(sql, /p_limit not between 1 and 100/);
  assert.match(sql, /for update skip locked/);
});

test("10 finish RPC enforces worker ownership", () => {
  assert.match(sql, /and locked_by = p_worker/);
  assert.match(sql, /TC_BSM02_OUTBOX_OWNERSHIP_MISMATCH/);
  assert.match(sql, /errcode = '42501'/);
});
