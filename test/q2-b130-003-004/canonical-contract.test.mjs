#!/usr/bin/env node

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const supportMigrationPath = "supabase/migrations/20260730030000_q2_support_security_contract.sql";
const supportMigration = read(supportMigrationPath);
const supportSignatures = [
  "public.support_idem_claim(text,text)",
  "public.support_idem_finish(text,text,jsonb)",
  "public.support_idem_cleanup()",
];

function compactSql(source) {
  return source.replace(/\s+/gu, " ").trim().toLowerCase();
}

function supportDefinitionIdentities(source) {
  return [...compactSql(source).matchAll(
    /create or replace function (public\.support_idem_(?:claim|finish|cleanup))\(([^)]*)\)/gu,
  )].map(([, name, args]) => {
    const types = args === ""
      ? []
      : args.split(",").map(arg => arg.trim().split(/\s+/u).at(-1));
    return `${name}(${types.join(",")})`;
  });
}

function assertStaticSupportAcl(source) {
  const sql = compactSql(source);
  for (const signature of supportSignatures) {
    const revoke = `revoke execute on function ${signature} from public, anon, authenticated;`;
    const grant = `grant execute on function ${signature} to service_role;`;
    assert.ok(sql.includes(revoke), `missing exact revoke: ${signature}`);
    assert.ok(sql.includes(grant), `missing exact service_role grant: ${signature}`);
    assert.ok(sql.indexOf(revoke) < sql.indexOf(grant), `grant precedes revoke: ${signature}`);
  }
  assert.match(sql, /where rolname = 'service_role'/u);
  assert.match(sql, /function_oid := pg_catalog\.to_regprocedure\(signature\)::oid/u);
  assert.match(sql, /has_function_privilege\( service_role_oid, function_oid, 'execute' \)/u);
  assert.match(sql, /acl\.grantee = service_role_oid and acl\.privilege_type = 'execute'/u);
}

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
  const source = supportMigration;
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

test("failed runtime signature is the first canonical ACL identity", () => {
  const verify = compactSql(supportMigration.slice(supportMigration.indexOf("do $verify_q2_support_acl$")));
  assert.ok(
    verify.indexOf(`'${supportSignatures[0]}'`) < verify.indexOf(`'${supportSignatures[1]}'`),
  );
  assert.equal(supportSignatures[0], "public.support_idem_claim(text,text)");
});

test("all support functions exist in migration history before the Q2 grants", () => {
  const migrationNames = readdirSync(new URL("../../supabase/migrations", import.meta.url))
    .filter(name => name.endsWith(".sql"))
    .sort();
  const q2Index = migrationNames.indexOf("20260730030000_q2_support_security_contract.sql");
  assert.ok(q2Index > 0);
  const priorCorpus = migrationNames.slice(0, q2Index).map(name => read(`supabase/migrations/${name}`)).join("\n");
  const priorIdentities = new Set(supportDefinitionIdentities(priorCorpus));
  for (const signature of supportSignatures) {
    assert.ok(priorIdentities.has(signature), `missing prior definition: ${signature}`);
  }
});

test("support identities use exact schema, names, and argument types", () => {
  const sql = compactSql(supportMigration);
  for (const signature of supportSignatures) {
    assert.match(sql, new RegExp(`'${signature.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}'`));
  }
  assert.doesNotMatch(sql, /support_idem_(?:claim|finish|cleanup)\((?:varchar|character varying|uuid)/u);
});

test("support migration history has no competing overloads", () => {
  const corpus = readdirSync(new URL("../../supabase/migrations", import.meta.url))
    .filter(name => name.endsWith(".sql"))
    .sort()
    .map(name => compactSql(read(`supabase/migrations/${name}`)))
    .join("\n");
  const identities = supportDefinitionIdentities(corpus);
  assert.deepEqual(new Set(identities), new Set(supportSignatures));
});

test("Q2 ACL order is create, revoke, grant, then verification", () => {
  const sql = compactSql(supportMigration);
  const create = sql.indexOf("create or replace function public.support_idem_claim(p_key text, p_fingerprint text)");
  const revoke = sql.indexOf("revoke execute on function public.support_idem_claim(text,text)");
  const grant = sql.indexOf("grant execute on function public.support_idem_claim(text,text)");
  const verify = sql.indexOf("do $verify_q2_support_acl$");
  assert.ok(create >= 0 && create < revoke && revoke < grant && grant < verify);
});

test("verification requires the local service_role catalog identity", () => {
  const sql = compactSql(supportMigration);
  assert.match(sql, /from pg_catalog\.pg_roles where rolname = 'service_role'/u);
  assert.match(sql, /q2_support_acl_role_missing:service_role/u);
});

test("every text signature resolves to a canonical regprocedure OID", () => {
  const sql = compactSql(supportMigration);
  assert.match(sql, /function_oid := pg_catalog\.to_regprocedure\(signature\)::oid/u);
  assert.match(sql, /if function_oid is null then raise exception 'q2_support_acl_function_missing:%'/u);
});

test("has_function_privilege consumes resolved role and function OIDs", () => {
  const sql = compactSql(supportMigration);
  assert.match(sql, /has_function_privilege\( role_oid, function_oid, 'execute' \)/u);
  assert.match(sql, /has_function_privilege\( service_role_oid, function_oid, 'execute' \)/u);
  assert.doesNotMatch(sql, /has_function_privilege\([^)]*signature/u);
});

test("static ACL validation fails when the service_role grant is absent", () => {
  const mutant = supportMigration.replace(
    /grant execute on function public\.support_idem_claim\(text,text\)\s+to service_role;/iu,
    "",
  );
  assert.throws(
    () => assertStaticSupportAcl(mutant),
    /missing exact service_role grant: public\.support_idem_claim\(text,text\)/u,
  );
});

test("static ACL validation passes with exact service_role grants", () => {
  assert.doesNotThrow(() => assertStaticSupportAcl(supportMigration));
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
