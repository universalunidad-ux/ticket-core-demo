#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../supabase/migrations/20260802080002_media_server_upload_policies.sql", import.meta.url), "utf8");
const targeted = readFileSync(new URL("../supabase/tests/media_claim_upload_targeted.sql", import.meta.url), "utf8");
const runner = readFileSync(new URL("./local-db/run-media-pipeline-runtime.sh", import.meta.url), "utf8");

assert.match(migration, /insert into public\.trabajos_adjuntos as queued_job/);
assert.match(
  migration,
  /on conflict on constraint trabajos_adjuntos_adjunto_id_tipo_version_source_checksum_s_key do nothing/,
);
assert.doesNotMatch(
  migration,
  /on conflict\s*\(adjunto_id,\s*tipo,\s*version,\s*source_checksum_sha256\)/,
);
assert.match(targeted, /from public\.tc_claim_media_upload\(/g);
assert.match(targeted, /v_attachment_count <> 1 or v_job_count <> 1/);
assert.match(targeted, /create function pg_temp\.tc_claim_media_upload_conflict_mutant/);
assert.match(targeted, /when ambiguous_column then/);
assert.match(targeted, /MEDIA_CLAIM_UPLOAD_AMBIGUITY_MUTANT_KILLED=YES/);
assert.match(runner, /supabase\/tests\/media_claim_upload_targeted\.sql/);
assert.match(runner, /CLAIM_TARGETED_FAILED/);

console.log("MEDIA_CLAIM_UPLOAD_CONFLICT_CONTRACT=PASS");
console.log("MEDIA_CLAIM_UPLOAD_POSTGRES_WIRING=PASS");
console.log("MEDIA_CLAIM_UPLOAD_AMBIGUITY_MUTANT=ARMED");
