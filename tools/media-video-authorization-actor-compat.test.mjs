import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.argv[2] ?? ".";
const migrationDirectory = path.join(
  root,
  "supabase",
  "migrations",
);

const migrations = fs
  .readdirSync(migrationDirectory)
  .filter((name) =>
    name.endsWith(
      "_media_video_authorization_actor_compat.sql",
    ),
  );

assert.equal(
  migrations.length,
  1,
  "exactly one actor compatibility migration is required",
);

const relative =
  `supabase/migrations/${migrations[0]}`;

const sql = fs.readFileSync(
  path.join(root, relative),
  "utf8",
);

for (const marker of [
  "creada_por",
  "autorizado_por",
  "segundos_max",
  "max_duracion_segundos",
  "tc_media_sync_authorization_duration_columns",
  "tc_media_authorization_duration_compat",
  "security invoker",
  "set search_path = pg_catalog, public",
  "E_MEDIA_AUTORIZADOR_REQUERIDO",
  "E_MEDIA_AUTORIZADOR_INCONSISTENTE",
]) {
  assert.ok(
    sql.toLowerCase().includes(
      marker.toLowerCase(),
    ),
    `missing marker: ${marker}`,
  );
}

assert.match(
  sql,
  /new\.autorizado_por\s*:=\s*coalesce\([\s\S]*?new\.creada_por[\s\S]*?auth\.uid\(\)/i,
);

assert.match(
  sql,
  /new\.creada_por\s*:=\s*coalesce\([\s\S]*?new\.autorizado_por[\s\S]*?auth\.uid\(\)/i,
);

assert.match(
  sql,
  /before\s+insert\s+or\s+update\s+of[\s\S]*?creada_por[\s\S]*?autorizado_por/i,
);

assert.match(
  sql,
  /update\s+public\.autorizaciones_video\s+set\s+creada_por\s*=\s*autorizado_por\s+where\s+creada_por\s+is\s+null/i,
);

assert.doesNotMatch(
  sql,
  /create\s+or\s+replace\s+function\s+public\.tc_media_otorgar_autorizacion/i,
  "the authorization RPC must not be redefined",
);

assert.doesNotMatch(
  sql,
  /\b(git\s+push|supabase\s+link|supabase\s+db\s+push|supabase\s+functions\s+deploy)\b/i,
);

console.log(JSON.stringify({
  migration: relative,
  table: "public.autorizaciones_video",
  actorBridge: "creada_por<->autorizado_por",
  durationBridge:
    "segundos_max<->max_duracion_segundos",
  result: "PASS",
}));
