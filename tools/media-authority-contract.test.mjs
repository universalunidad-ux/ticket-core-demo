#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../supabase/migrations/20260802075214_media_canonical_attachment_authority.sql", import.meta.url),
  "utf8",
);

assert.match(migration, /create table public\.adjuntos_ticket\s*\(/i);
for (const field of [
  "bucket_id", "storage_path", "mime_declarado", "mime_detectado",
  "checksum_sha256", "idempotency_key", "request_hash", "estado",
]) assert.match(migration, new RegExp(`\\b${field}\\b`, "i"));

assert.match(migration, /unique \(bucket_id, storage_path\)/i);
assert.match(migration, /unique \(ticket_id, idempotency_key\)/i);
assert.match(migration, /alter table public\.adjuntos_ticket enable row level security/i);
assert.match(migration, /revoke all on table public\.adjuntos_ticket from public, anon, authenticated/i);
assert.match(migration, /grant all on table public\.adjuntos_ticket to service_role/i);
assert.match(migration, /create view app_private\.archivos_ticket_compat/i);
assert.match(migration, /LEGACY_READ_COMPATIBILITY/);
assert.doesNotMatch(migration, /drop table\s+public\.(archivos_ticket|ticket_archivos|solicitud_archivos)/i);

console.log("MEDIA_AUTHORITY_CONTRACT=PASS");
console.log("MEDIA_LEGACY_PRESERVED=YES");
