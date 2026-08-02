#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../supabase/migrations/20260802075500_media_derived_assets_and_jobs.sql", import.meta.url), "utf8");
const worker = readFileSync(new URL("./media-worker.py", import.meta.url), "utf8");

assert.match(migration, /create table public\.derivados_adjuntos/i);
assert.match(migration, /create table public\.trabajos_adjuntos/i);
assert.match(migration, /unique \(adjunto_id, tipo, version, source_checksum_sha256\)/i);
assert.match(migration, /for update skip locked/i);
assert.match(migration, /MEDIA_JOB_LEASE_MISMATCH/);
assert.match(migration, /estado = case when intentos >= max_intentos then 'muerto' else 'fallido' end/i);
assert.match(worker, /MEDIA_SOURCE_CHECKSUM_MISMATCH/);
assert.match(worker, /os\.replace\(temporary, path\)/);
assert.match(worker, /review_webp/);
assert.match(worker, /thumbnail_webp/);
assert.match(worker, /pdf_poster_webp/);
assert.match(worker, /video_proxy_720p/);
assert.match(worker, /video_contact_sheet_webp/);
assert.match(worker, /MEDIA_VIDEO_TOOLCHAIN_UNAVAILABLE/);
console.log("MEDIA_JOB_IDEMPOTENCY_CONTRACT=PASS");
console.log("MEDIA_DERIVATIVE_CONTRACT=PASS");
