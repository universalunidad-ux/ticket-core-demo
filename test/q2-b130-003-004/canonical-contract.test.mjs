#!/usr/bin/env node

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("rate-limit implementations persist only full SHA-256 key_hash", () => {
  for (const path of [
    "supabase/functions/_shared/rate-limit.ts",
    "supabase/functions/support-submit-secure/index.ts",
  ]) {
    const source = read(path);
    assert.match(source, /SHA-256/);
    assert.match(source, /\.eq\("key_hash",/);
    assert.match(source, /\.insert\(\{[\s\S]{0,80}(?:scope,?\s*)?key_hash/s);
    assert.doesNotMatch(source, /\.eq\("key",|insert\(\{scope,key\}\)/);
  }
});

test("support handler uses canonical full fingerprint and fails closed around RPCs", () => {
  const source = read("supabase/functions/support-submit-secure/index.ts");
  assert.match(source, /fingerprintSupportSubmission\(dto,validatedUploads\.map/);
  assert.doesNotMatch(source, /fingerprintSupportSubmission[\s\S]{0,120}\.slice\(/);
  assert.match(source, /TC_IDEMPOTENCY_KEY_REUSED/);
  assert.match(source, /IDEMPOTENCY_UNAVAILABLE/);
  assert.match(source, /typeof c\.claimed!=="boolean"/);
  assert.match(source, /c\.status!=="processing"\|\|c\.response!==null/);
  assert.match(source, /if\(finish\.error\)[\s\S]{0,180}throw new Error\("IDEMPOTENCY_FINISH_FAILED"\)/);
  assert.match(source, /const resp:PublicSuccessResponse=\{ok:true,folio,token_publico,status:"ticket_creado"\}/);
});

test("support migration binds fingerprint before retry and locks ACL to service_role", () => {
  const source = read("supabase/migrations/20260730030000_q2_support_security_contract.sql");
  const mismatch = source.indexOf("existing.fingerprint <> p_fingerprint");
  const retry = source.indexOf("existing.status = 'failed'");
  assert.ok(mismatch > 0 && retry > mismatch, "fingerprint ownership must precede retry");
  assert.match(source, /raise exception 'TC_IDEMPOTENCY_KEY_REUSED'/);
  for (const signature of [
    "support_idem_claim",
    "support_idem_finish",
    "support_idem_cleanup",
  ]) {
    assert.match(source, new RegExp(`revoke execute on function public\\.${signature}`));
    assert.match(source, new RegExp(`grant execute on function public\\.${signature}`));
  }
  assert.match(source, /from public, anon, authenticated/);
  assert.match(source, /to service_role/);
  assert.match(source, /has_function_privilege/);
});

test("client response migration is SELECT-only, public, and server-owned", () => {
  const source = read("supabase/migrations/20260730030100_l130_m2_client_response_visibility.sql");
  assert.match(source, /create policy ticket_eventos_client_public_select/);
  assert.match(source, /for select\s+to authenticated/);
  assert.match(source, /visibilidad = 'publica'/);
  assert.match(source, /t\.cliente_id = public\.tc_current_client_id\(\)/);
  assert.match(source, /grant select on public\.ticket_eventos to authenticated/);
  assert.doesNotMatch(source, /create policy[\s\S]*for (?:insert|update|delete)/i);
  assert.match(source, /has_table_privilege/);
});

test("portal batches authorized IDs and renders event text as textContent", () => {
  const source = read("app/portal-cliente.js");
  assert.match(source, /const ticketIds = tickets\.map\(ticket => ticket\.id\)/);
  assert.match(source, /\.from\("ticket_eventos"\)/);
  assert.match(source, /\.in\("ticket_id", ticketIds\)/);
  assert.match(source, /\.eq\("visibilidad", "publica"\)/);
  assert.match(source, /\.order\("created_at", \{ ascending: true \}\)/);
  assert.match(source, /row\.textContent =/);
  assert.doesNotMatch(source, /cliente_id.*(?:localStorage|searchParams|dataset)/);
});

test("HTTP and visibility harnesses declare direct evidence cases without runtime PASS substitution", () => {
  const http = read("tools/l130-authenticated-qa/edge-contract-http.mjs");
  const visibility = read("tools/l130-authenticated-qa/m1-response-visibility.mjs");
  for (const marker of [
    "SUPPORT_IDEMPOTENCY_REPLAY",
    "SUPPORT_IDEMPOTENCY_CONFLICT",
    "SUPPORT_RPC_FAIL_CLOSED",
    "ESTADO_AUTHZ_TOKEN",
    "RESPONDER_MUTATION",
    "RESPONDER_RATE_LIMIT",
    "ESCALATION_AUTHN_AUTHZ",
  ]) assert.match(http, new RegExp(marker));
  for (const marker of [
    "CLIENT_A_PUBLIC_RESPONSE",
    "CLIENT_A_CANNOT_SEE_B",
    "CLIENT_B_CANNOT_SEE_A",
    "CLIENT_INTERNAL_EVENTS_DENIED",
  ]) assert.match(visibility, new RegExp(marker));
  assert.doesNotMatch(import.meta.url, /B130_003_EDGE_E2E=PASS|B130_004_EDGE_E2E=PASS/);
});
