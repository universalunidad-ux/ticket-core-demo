import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const migrationDir = new URL("../../supabase/migrations/", import.meta.url);
const target = "20260730082038_backend_security_macrobatch_02.sql";
const sql = readFileSync(new URL(target, migrationDir), "utf8");
const shared = readFileSync(
  new URL("../../supabase/functions/_shared/observability-contract.ts", import.meta.url),
  "utf8",
);

function passes(candidate) {
  return /STATIC_CONTRACT_ONLY/.test(candidate)
    && (candidate.match(/enable row level security/g) || []).length === 3
    && (candidate.match(/security definer/g) || []).length === 4
    && (candidate.match(/set search_path = ''/g) || []).length === 5
    && /for update skip locked/.test(candidate)
    && /TC_BSM02_OUTBOX_OWNERSHIP_MISMATCH/.test(candidate)
    && !/create policy/i.test(candidate);
}

test("31 canonical source satisfies mutation oracle", () => {
  assert.equal(passes(sql), true);
});

test("32 mutation: missing static-only marker fails", () => {
  assert.equal(passes(sql.replace("STATIC_CONTRACT_ONLY", "RUNTIME_PASS")), false);
});

test("33 mutation: disabled RLS fails", () => {
  assert.equal(passes(sql.replace("enable row level security", "disable row level security")), false);
});

test("34 mutation: SECURITY INVOKER replacement fails", () => {
  assert.equal(passes(sql.replace("security definer", "security invoker")), false);
});

test("35 mutation: mutable search path fails", () => {
  assert.equal(passes(sql.replace("set search_path = ''", "set search_path = public")), false);
});

test("36 mutation: non-locking outbox claim fails", () => {
  assert.equal(passes(sql.replace("for update skip locked", "for update")), false);
});

test("37 mutation: missing worker ownership verifier fails", () => {
  assert.equal(passes(sql.replace("TC_BSM02_OUTBOX_OWNERSHIP_MISMATCH", "REMOVED")), false);
});

test("38 migration timestamp and target are unique and last", () => {
  const files = readdirSync(migrationDir).filter((name) => name.endsWith(".sql")).sort();
  assert.equal(files.at(-1), target);
  assert.equal(files.filter((name) => name.startsWith("20260730082038_")).length, 1);
});

test("39 functions and tables have a single CREATE owner", () => {
  for (const name of [
    "app_incidents", "app_error_events", "mail_outbox",
    "record_client_error", "system_health_snapshot",
    "claim_mail_outbox", "finish_mail_outbox",
  ]) {
    const pattern = name.startsWith("app_") || name === "mail_outbox"
      ? new RegExp(`create table public\\.${name}\\b`, "g")
      : new RegExp(`create function public\\.${name}\\b`, "g");
    assert.equal((sql.match(pattern) || []).length, 1);
  }
});

test("40 shared contract has exact event and context key owners", () => {
  assert.equal((shared.match(/const EVENT_KEYS = new Set/g) || []).length, 1);
  assert.equal((shared.match(/const CONTEXT_KEYS = new Set/g) || []).length, 1);
  assert.doesNotMatch(shared, /\.\.\.value|\.\.\.rawContext/);
});
