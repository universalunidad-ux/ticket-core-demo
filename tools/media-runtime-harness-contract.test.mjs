#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const runner = readFileSync(new URL("./local-db/run-media-pipeline-runtime.sh", import.meta.url), "utf8");
const sql = readFileSync(new URL("../supabase/tests/media_pipeline_runtime.sql", import.meta.url), "utf8");
const handler = readFileSync(new URL("../supabase/functions/support-submit-secure/index.ts", import.meta.url), "utf8");

assert.match(runner, /SUPABASE_STACK_ALREADY_ACTIVE/);
assert.match(runner, /supabase db reset --workdir/);
assert.match(runner, /tc_claim_media_job/);
assert.match(runner, /storage\/v1\/object\/sign/);
assert.match(runner, /storage\/v1\/object\/list/);
assert.match(runner, /RESIDUAL_ROWS=0/);
assert.match(runner, /RESIDUAL_OBJECTS=0/);
assert.match(runner, /--stop --remove-runtime/);
assert.doesNotMatch(runner, /supabase\s+(link|db push|functions deploy)/);
assert.match(sql, /TC_IDEMPOTENCY_KEY_REUSED/);
assert.match(sql, /MEDIA_VIDEO_AUTHORIZATION_REQUIRED/);
assert.match(sql, /consumido exactamente|consumed exactly|consumido_por_adjunto/i);
assert.match(sql, /MEDIA_DELETE_LEGAL_HOLD/);
assert.match(sql, /MEDIA_DELETE_RETENTION_ACTIVE/);
assert.match(sql, /residual rows zero/);
assert.match(handler, /\.from\("derivados_adjuntos"\)\.select\("storage_path"\)/);
console.log("MEDIA_RUNTIME_HARNESS_CONTRACT=PASS");
console.log("MEDIA_RUNTIME_SINGLE_STACK=YES");
