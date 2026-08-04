import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.argv[2] ?? ".";
const migrationDir = path.join(root, "supabase", "migrations");

const matches = fs
  .readdirSync(migrationDir)
  .filter(name =>
    name.endsWith(
      "_media_video_authorization_legacy_compat.sql",
    ),
  );

assert.equal(
  matches.length,
  1,
  "exactly one compatibility migration is required",
);

const relative = `supabase/migrations/${matches[0]}`;
const sql = fs.readFileSync(
  path.join(root, relative),
  "utf8",
);

for (const marker of [
  "max_duracion_segundos",
  "segundos_max",
  "tc_media_sync_authorization_duration_columns",
  "tc_media_authorization_duration_compat",
  "before insert or update",
  "security invoker",
  "set search_path = pg_catalog, public",
  "E_MEDIA_DURACION_AUTORIZADA_REQUERIDA",
  "E_MEDIA_DURACION_AUTORIZADA_INVALIDA",
  "E_MEDIA_DURACION_AUTORIZADA_INCONSISTENTE",
]) {
  assert.ok(
    sql.toLowerCase().includes(marker.toLowerCase()),
    `missing compatibility marker: ${marker}`,
  );
}

assert.match(
  sql,
  /new\.segundos_max\s*:=\s*coalesce\([\s\S]*?new\.max_duracion_segundos/i,
);

assert.match(
  sql,
  /new\.max_duracion_segundos\s*:=\s*coalesce\([\s\S]*?new\.segundos_max/i,
);

assert.match(
  sql,
  /new\.segundos_max\s*<>\s*new\.max_duracion_segundos/i,
);

assert.doesNotMatch(
  sql,
  /create\s+or\s+replace\s+function\s+public\.tc_media_otorgar_autorizacion/i,
  "compatibility migration must not redefine the authorization RPC",
);

assert.doesNotMatch(
  sql,
  /\bsupabase\s+(link|db\s+push|functions\s+deploy)\b/i,
);

console.log(JSON.stringify({
  migration: relative,
  table: "public.autorizaciones_video",
  legacyColumn: "max_duracion_segundos",
  canonicalColumn: "segundos_max",
  triggerTiming: "BEFORE INSERT OR UPDATE",
  result: "PASS",
}));
