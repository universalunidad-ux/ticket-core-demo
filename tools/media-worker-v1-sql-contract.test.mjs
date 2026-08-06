#!/usr/bin/env node
// TC-DEB8FDCC-MEDIA-WORKER-V1-LOCAL-IMPLEMENTATION-28 · Commit A
//
// Contrato estatico de la migracion del media worker. No requiere Docker ni
// PostgreSQL: valida el texto de la migracion contra las invariantes de
// seguridad y de maquina de estados que Terminal ejecutara despues contra una
// base viva mediante supabase/tests/media_worker_v1_state_machine.sql.

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = "supabase/migrations";
const MIGRATION_SUFFIX = "_media_worker_v1_atomic_contract.sql";

const migrationFile = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith(MIGRATION_SUFFIX))
  .sort()
  .pop();

assert.ok(migrationFile, "media worker migration not found");
assert.match(
  migrationFile,
  /^\d{14}_media_worker_v1_atomic_contract\.sql$/,
  "migration must keep the supabase CLI timestamp prefix",
);

const sql = readFileSync(join(MIGRATIONS_DIR, migrationFile), "utf8");

const WORKER_FUNCTIONS = [
  "public.tc_worker_claim_media_jobs(text, integer, integer)",
  "public.tc_worker_complete_media_job(uuid, uuid, jsonb)",
  "public.tc_worker_quarantine_media_job(uuid, uuid, text)",
  "public.tc_worker_fail_media_job(uuid, uuid, text)",
];

const QUARANTINE_REASONS = [
  "MEDIA_SOURCE_CHECKSUM_MISMATCH",
  "MEDIA_SIGNATURE_OR_MIME_REJECTED",
  "MEDIA_DECODE_FAILED",
  "MEDIA_OBJECT_MISSING",
  "MEDIA_SIZE_LIMIT_EXCEEDED",
  "MEDIA_DERIVATIVE_CHECKSUM_CONFLICT",
  "MEDIA_UNSUPPORTED_KIND_PDF",
  "MEDIA_UNSUPPORTED_KIND_VIDEO",
  "MEDIA_JOB_DEAD_LETTER",
];

/** Devuelve el cuerpo de una funcion `create or replace function <name>` */
function bodyOf(name) {
  const start = sql.indexOf(`create or replace function ${name}`);
  assert.notEqual(start, -1, `function ${name} not defined`);
  const end = sql.indexOf("$function$;", start);
  assert.notEqual(end, -1, `function ${name} not terminated`);
  return sql.slice(start, end);
}

// --- 01 transaccionalidad -----------------------------------------------
assert.match(sql, /^begin;/m, "migration must open a transaction");
assert.match(sql, /^commit;/m, "migration must commit");

// --- 02 guarda de dependencias fail-closed -------------------------------
const guard = sql.slice(
  sql.indexOf("do $media_worker_dependencies$"),
  sql.indexOf("$media_worker_dependencies$;"),
);
for (const dependency of [
  "public.adjuntos_ticket",
  "public.trabajos_adjuntos",
  "public.derivados_adjuntos",
  "public.retencion_adjuntos",
  "app_private.tc_claim_media_job(text,integer)",
  "app_private.tc_fail_media_job(uuid,uuid,text)",
  "public.tc_prepare_media_delete(uuid)",
]) {
  assert.ok(guard.includes(dependency), `dependency guard missing ${dependency}`);
}
assert.match(guard, /raise exception 'MEDIA_WORKER_DEPENDENCY_MISSING'/);

// --- 03 sin SQL dinamico -------------------------------------------------
assert.doesNotMatch(sql, /\bexecute\s+format\s*\(/i, "dynamic SQL is forbidden");
assert.doesNotMatch(sql, /\bexecute\s+'/i, "dynamic SQL is forbidden");
assert.doesNotMatch(sql, /\bexecute\s+quote_/i, "dynamic SQL is forbidden");

// --- 04 security definer y search_path fijo ------------------------------
for (const signature of WORKER_FUNCTIONS) {
  const body = bodyOf(signature.replace(/\(.*$/, "("));
  assert.match(body, /security definer/, `${signature} must be security definer`);
  assert.match(
    body,
    /set search_path = pg_catalog, public(, app_private)?\b/,
    `${signature} must pin search_path`,
  );
}

// --- 05 ACL: revocado de public/anon/authenticated, concedido a service_role
for (const signature of WORKER_FUNCTIONS) {
  const revoke = new RegExp(
    `revoke execute on function ${signature.replace(/[().]/g, (c) => `\\${c}`)}\\s*\\n?\\s*from public, anon, authenticated;`,
  );
  const grant = new RegExp(
    `grant execute on function ${signature.replace(/[().]/g, (c) => `\\${c}`)} to service_role;`,
  );
  assert.match(sql, revoke, `${signature} missing revoke from public/anon/authenticated`);
  assert.match(sql, grant, `${signature} missing grant to service_role`);
}
assert.doesNotMatch(
  sql,
  /grant execute on function public\.tc_worker_[a-z_]+\([^)]*\) to (anon|authenticated|public)\b/,
  "worker RPC must never be granted to anon/authenticated/public",
);

// --- 06 verificacion fail-closed embebida en la migracion ----------------
const verify = sql.slice(
  sql.indexOf("do $media_worker_verify$"),
  sql.indexOf("$media_worker_verify$;"),
);
assert.match(verify, /MEDIA_WORKER_RPC_MISSING/);
assert.match(verify, /MEDIA_WORKER_RPC_OVEREXPOSED/);
assert.match(verify, /MEDIA_WORKER_RPC_NOT_GRANTED/);
assert.match(verify, /has_function_privilege/);

// --- 07 claim: tope duro de 5 jobs y lease acotado -----------------------
const claim = bodyOf("public.tc_worker_claim_media_jobs(");
assert.match(claim, /p_lease_seconds integer default 120/, "lease default must be 120s");
assert.match(claim, /p_limit integer default 5/, "batch default must be 5");
assert.match(
  claim,
  /p_limit not between 1 and 5[\s\S]*?MEDIA_CLAIM_LIMIT_INVALID/,
  "batch size must be hard-capped at 5",
);
assert.match(
  claim,
  /p_lease_seconds not between 15 and 900[\s\S]*?MEDIA_LEASE_SECONDS_INVALID/,
  "lease seconds must be bounded",
);
assert.match(
  claim,
  /from app_private\.tc_claim_media_job\(p_worker_id, p_lease_seconds\)/,
  "claim wrapper must delegate to the existing app_private contract",
);

// --- 08 complete: identidad derivada del job, nunca del llamante ---------
const complete = bodyOf("public.tc_worker_complete_media_job(");
assert.doesNotMatch(
  complete,
  /p_adjunto_id|p_estado|p_storage_path/,
  "complete must not accept attachment id, state or path from the caller",
);
assert.match(
  complete,
  /where id = p_job_id and estado = 'ejecutando' and lease_token = p_lease_token\s*\n\s*for update/,
  "complete must lock the job by id + state + lease",
);
assert.match(complete, /MEDIA_JOB_LEASE_MISMATCH/, "complete must reject a wrong lease");
assert.match(complete, /MEDIA_JOB_LEASE_EXPIRED/, "complete must reject an expired lease");
assert.match(
  complete,
  /where id = v_job\.adjunto_id\s*\n\s*for update/,
  "complete must resolve the attachment from the leased job",
);
assert.match(
  complete,
  /v_adjunto\.estado <> 'procesando'[\s\S]*?MEDIA_ATTACHMENT_STATE_INVALID/,
  "complete must require the attachment to be in 'procesando'",
);
assert.match(
  complete,
  /v_adjunto\.checksum_sha256 is distinct from v_job\.source_checksum_sha256[\s\S]*?MEDIA_SOURCE_CHECKSUM_MISMATCH/,
  "complete must cross-check the attachment checksum against the job",
);
assert.match(
  complete,
  /v_adjunto\.delete_token is not null[\s\S]*?MEDIA_ATTACHMENT_DELETE_IN_FLIGHT/,
  "complete must refuse to race an in-flight delete",
);

// --- 09 invariante central: no hay 'listo' sin derivados reales ----------
assert.match(
  complete,
  /jsonb_array_length\(p_derivados\) = 0[\s\S]*?MEDIA_DERIVATIVES_REQUIRED/,
  "complete must reject an empty derivative set",
);
assert.match(
  complete,
  /MEDIA_DERIVATIVES_NOT_PERSISTED/,
  "complete must re-verify persistence before promoting",
);
const promotionIndex = complete.indexOf("set estado = 'listo'");
const persistenceIndex = complete.indexOf("MEDIA_DERIVATIVES_NOT_PERSISTED");
assert.ok(promotionIndex > -1, "complete must promote the attachment");
assert.ok(
  persistenceIndex > -1 && persistenceIndex < promotionIndex,
  "derivative persistence must be verified BEFORE promoting to 'listo'",
);
assert.match(
  complete,
  /set estado = 'listo',\s*\n\s*motivo_cuarentena = null/,
  "promotion must clear motivo_cuarentena",
);
assert.match(
  complete,
  /checksum_sha256', ''\) !~ '\^\[0-9a-f\]\{64\}\$'/,
  "each derivative checksum must be validated",
);
assert.match(
  complete,
  /MEDIA_DERIVATIVE_CHECKSUM_CONFLICT/,
  "re-processing with a different checksum must conflict, not overwrite",
);
assert.match(
  complete,
  /on conflict \(adjunto_id, tipo, version, source_checksum_sha256\)/,
  "derivative insert must be idempotent on the logical tuple",
);
assert.match(complete, /MEDIA_DERIVATIVE_TYPE_INVALID/, "derivative type must be enumerated");
assert.match(complete, /MEDIA_DERIVATIVE_PATH_INVALID/, "derivative path must be validated");

// --- 10 cuarentena: motivo enumerado y cierre del job --------------------
const reasonCatalog = sql.slice(
  sql.indexOf("create or replace function app_private.tc_media_quarantine_reason_is_valid"),
  sql.indexOf("comment on function app_private.tc_media_quarantine_reason_is_valid"),
);
for (const reason of QUARANTINE_REASONS) {
  assert.ok(reasonCatalog.includes(`'${reason}'`), `quarantine catalog missing ${reason}`);
}
assert.match(reasonCatalog, /immutable/, "reason catalog must be immutable");

const quarantine = bodyOf("public.tc_worker_quarantine_media_job(");
assert.match(
  quarantine,
  /not app_private\.tc_media_quarantine_reason_is_valid\(p_motivo_codigo\)[\s\S]*?MEDIA_QUARANTINE_REASON_INVALID/,
  "quarantine must only accept catalogued reasons",
);
assert.match(
  quarantine,
  /set estado = 'cuarentena',\s*\n\s*motivo_cuarentena = p_motivo_codigo/,
  "quarantine must record the reason",
);
assert.match(
  quarantine,
  /set estado = 'completado'/,
  "a deterministic rejection closes the job instead of requeueing it",
);
assert.doesNotMatch(
  quarantine,
  /tc_fail_media_job/,
  "a deterministic rejection must not consume retries",
);

// --- 11 fallo transitorio y dead-letter atomico --------------------------
const fail = bodyOf("public.tc_worker_fail_media_job(");
assert.match(
  fail,
  /perform app_private\.tc_fail_media_job\(p_job_id, p_lease_token, p_error_code\)/,
  "transient failure must delegate backoff to the existing contract",
);
assert.match(
  fail,
  /v_dead := v_job\.intentos >= v_job\.max_intentos/,
  "dead-letter must be evaluated from the leased job row",
);
assert.match(
  fail,
  /if v_dead then[\s\S]*?set estado = 'cuarentena',\s*\n\s*motivo_cuarentena = 'MEDIA_JOB_DEAD_LETTER'/,
  "exhausting retries must quarantine the attachment in the same transaction",
);
assert.match(
  fail,
  /p_error_code, ''\) !~ '\^\[A-Z0-9_\]\{3,80\}\$'/,
  "error codes must be constrained; no free text, no payloads",
);

// --- 12 borrado: listo y cuarentena si, el resto no ----------------------
const prepare = bodyOf("public.tc_prepare_media_delete(");
assert.match(
  prepare,
  /v_attachment\.estado not in \('listo', 'cuarentena'\)[\s\S]*?MEDIA_DELETE_STATE_INVALID/,
  "prepare must accept exactly 'listo' and 'cuarentena'",
);
// La lista permitida es exhaustiva: cualquier otro estado cae en el raise.
const allowedDeleteStates = prepare
  .match(/estado not in \(([^)]*)\)/)[1]
  .split(",")
  .map((s) => s.trim().replace(/'/g, ""));
assert.deepEqual(
  allowedDeleteStates.sort(),
  ["cuarentena", "listo"],
  "prepare must allow exactly 'listo' and 'cuarentena'",
);
for (const forbidden of ["pendiente", "procesando", "eliminado"]) {
  assert.ok(
    !allowedDeleteStates.includes(forbidden),
    `prepare must keep rejecting '${forbidden}'`,
  );
}
assert.match(
  prepare,
  /v_retention\.legal_hold then raise exception 'MEDIA_DELETE_LEGAL_HOLD'/,
  "legal hold validation must be preserved verbatim",
);
assert.match(
  prepare,
  /v_retention\.retener_hasta > now\(\)[\s\S]*?MEDIA_DELETE_RETENTION_ACTIVE/,
  "retention validation must be preserved verbatim",
);
assert.match(
  prepare,
  /estado_pre_borrado = v_attachment\.estado/,
  "prepare must persist the pre-delete state",
);

// --- 13 abort no blanquea cuarentena a 'listo' ---------------------------
const abort = sql.slice(
  sql.indexOf("create or replace function public.tc_abort_media_delete"),
  sql.indexOf("-- 8. ACL"),
);
assert.match(
  abort,
  /set estado = coalesce\(estado_pre_borrado, 'listo'\)/,
  "abort must restore the exact pre-delete state",
);
assert.match(
  abort,
  /motivo_cuarentena = motivo_cuarentena_pre_borrado/,
  "abort must restore the quarantine reason",
);
assert.doesNotMatch(
  abort,
  /set estado = 'listo',/,
  "abort must never hardcode a promotion to 'listo'",
);

// --- 14 compatibilidad: no se destruye el contrato existente -------------
assert.doesNotMatch(
  sql,
  /drop function[^;]*tc_complete_media_job/i,
  "app_private.tc_complete_media_job(uuid,uuid) must be preserved",
);
assert.doesNotMatch(
  sql,
  /drop function[^;]*tc_claim_media_job/i,
  "app_private.tc_claim_media_job must be preserved",
);
assert.doesNotMatch(
  sql,
  /drop function[^;]*tc_fail_media_job/i,
  "app_private.tc_fail_media_job must be preserved",
);
assert.match(verify, /MEDIA_WORKER_LEGACY_RPC_REMOVED/);

// --- 15 sin operaciones destructivas -------------------------------------
assert.doesNotMatch(sql, /\bdrop table\b/i, "migration must not drop tables");
assert.doesNotMatch(sql, /\btruncate\b/i, "migration must not truncate");
assert.doesNotMatch(sql, /\bdelete from\b/i, "migration must not delete rows");
assert.doesNotMatch(sql, /\bdrop column\b/i, "migration must not drop columns");

const checks = [
  "migration is a single transaction",
  "fail-closed dependency guard",
  "no dynamic SQL",
  "security definer with pinned search_path",
  "ACL revoked from public/anon/authenticated, granted to service_role",
  "embedded fail-closed ACL verification",
  "claim capped at 5 jobs and a bounded 120s lease",
  "completion identity derived from the leased job",
  "no promotion to 'listo' without persisted derivatives",
  "quarantine reasons are a closed catalogue",
  "deterministic rejection does not consume retries",
  "dead-letter quarantines atomically",
  "delete accepts only 'listo' and 'cuarentena'",
  "legal hold and retention preserved verbatim",
  "abort restores the exact pre-delete state",
  "existing app_private contract preserved",
  "no destructive operations",
];
for (const check of checks) console.log(`PASS\t${check}`);
console.log(`MEDIA_WORKER_V1_SQL_CONTRACT: PASS (${checks.length}/${checks.length})`);
