#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { validateAuthoritativeMedia } from "../supabase/functions/_shared/media-policy.ts";

const migration = readFileSync(new URL("../supabase/migrations/20260802080002_media_server_upload_policies.sql", import.meta.url), "utf8");
const supportHandler = readFileSync(new URL("../supabase/functions/support-submit-secure/index.ts", import.meta.url), "utf8");

const mp4 = (seconds) => {
  const bytes = new Uint8Array(64);
  bytes.set(new TextEncoder().encode("ftypisom"), 4);
  bytes.set(new TextEncoder().encode("mvhd"), 20);
  const view = new DataView(bytes.buffer);
  view.setUint32(36, 1000);
  view.setUint32(40, seconds * 1000);
  return bytes;
};
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

const short = mp4(15);
const accepted = await validateAuthoritativeMedia({ name: "evidence.mp4", mimeType: "video/mp4", bytes: short }, digest(short));
assert.equal(accepted.ok, true);
if (accepted.ok) assert.equal(accepted.value.durationSeconds, 15);

const tooLong = mp4(31);
assert.deepEqual(
  await validateAuthoritativeMedia({ name: "long.mp4", mimeType: "video/mp4", bytes: tooLong }, digest(tooLong)),
  { ok: false, code: "MEDIA_VIDEO_DURATION_REJECTED" },
);
assert.deepEqual(
  await validateAuthoritativeMedia({ name: "evidence.mp4", mimeType: "video/mp4", bytes: short }, "0".repeat(64)),
  { ok: false, code: "MEDIA_CHECKSUM_MISMATCH" },
);
assert.deepEqual(
  await validateAuthoritativeMedia({ name: "fake.mp4", mimeType: "video/mp4", bytes: new Uint8Array([1, 2, 3]) }, digest(new Uint8Array([1, 2, 3]))),
  { ok: false, code: "MEDIA_SIGNATURE_OR_MIME_REJECTED" },
);

assert.match(migration, /pg_advisory_xact_lock/);
assert.match(migration, /for update skip locked/);
assert.match(migration, /MEDIA_VIDEO_AUTHORIZATION_REQUIRED/);
assert.match(migration, /TC_IDEMPOTENCY_KEY_REUSED/);
assert.match(migration, /max_duracion_segundos[^\n]+<= 30/);
assert.match(migration, /permite_segundo_video/);
assert.match(migration, /consumido_por_adjunto/);
assert.match(migration, /tc_abort_media_upload/);
assert.match(supportHandler, /x-media-operation/);
assert.match(supportHandler, /validateAuthoritativeMedia/);
assert.match(supportHandler, /tc_claim_media_upload/);
assert.match(supportHandler, /tc_abort_media_upload/);
assert.match(supportHandler, /tc_finalize_media_upload/);
assert.doesNotMatch(supportHandler, /\.from\("solicitud_archivos"\)\.insert/);
assert.doesNotMatch(supportHandler, /\.from\("ticket_archivos"\)\.insert/);
assert.doesNotMatch(supportHandler, /\.from\("archivos_ticket"\)\.insert/);
console.log("MEDIA_UPLOAD_NEGATIVE_POLICY=PASS");
console.log("MEDIA_SECOND_VIDEO_ATOMIC_POLICY=PASS");
console.log("MEDIA_SUPPORT_WRITER_CUTOVER=PASS");
