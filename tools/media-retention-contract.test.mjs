#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../supabase/migrations/20260802080431_media_retention_and_legal_hold_controls.sql", import.meta.url), "utf8");
const handler = readFileSync(new URL("../supabase/functions/support-submit-secure/index.ts", import.meta.url), "utf8");
const ticketUi = readFileSync(new URL("../app/ticket.js", import.meta.url), "utf8");

assert.match(migration, /create table public\.politicas_retencion_adjuntos/i);
assert.match(migration, /create table public\.retencion_adjuntos/i);
assert.match(migration, /MEDIA_DELETE_LEGAL_HOLD/);
assert.match(migration, /MEDIA_DELETE_RETENTION_ACTIVE/);
assert.match(migration, /MEDIA_RETENTION_POLICY_MUST_NOT_BE_ASSUMED/);
assert.doesNotMatch(migration, /insert into public\.politicas_retencion_adjuntos/i);
assert.match(migration, /referencia_aprobacion text not null/i);
assert.match(migration, /for update/);
assert.match(handler, /x-media-operation"\)===\"delete/);
assert.match(handler, /tc_prepare_media_delete/);
assert.match(handler, /tc_abort_media_delete/);
assert.match(handler, /tc_finalize_media_delete/);
assert.match(ticketUi, /x-media-operation":"upload/);
assert.match(ticketUi, /x-media-operation":"delete/);
assert.match(ticketUi, /crypto\.subtle\.digest\("SHA-256"/);
assert.doesNotMatch(ticketUi, /\.from\("ticket_archivos"\)\.insert/);
assert.doesNotMatch(ticketUi, /\.from\("archivos_ticket"\)\.insert/);
assert.doesNotMatch(ticketUi, /\.storage\.from\("soporte_adjuntos"\)\.upload/);
console.log("MEDIA_RETENTION_ENFORCEMENT_CONTRACT=PASS");
console.log("MEDIA_LEGAL_HOLD_ENFORCEMENT_CONTRACT=PASS");
console.log("MEDIA_INTERNAL_UI_WRITER_CUTOVER=PASS");
console.log("MEDIA_015=BLOCKED_PRODUCT_OR_LEGAL_DECISION");
