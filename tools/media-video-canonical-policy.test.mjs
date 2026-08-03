import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.argv[2] ?? ".";

const files = {
  policy:
    "supabase/functions/_shared/media-video-policy.ts",
  policyTest:
    "supabase/functions/_shared/media-video-policy.test.ts",
  migration: "supabase/migrations/20260803085127_media_video_policy_completion.sql",
};

for (const relative of Object.values(files)) {
  assert.ok(
    fs.existsSync(path.join(root, relative)),
    `${relative} must exist`,
  );
}

const policy = fs.readFileSync(
  path.join(root, files.policy),
  "utf8",
);

const migrationText = fs.readFileSync(
  path.join(root, files.migration),
  "utf8",
);

for (const marker of [
  "MEDIA_VIDEO_SHORT_LIMIT_MS = 15_000",
  "MEDIA_VIDEO_EXCEPTION_LIMIT_MS = 30_000",
  "segundo_video_15s",
  "excepcion_30s",
  "E_MEDIA_DURACION_EXCEDIDA",
  "E_MEDIA_AUTORIZACION_NO_DISPONIBLE",
]) {
  assert.ok(
    policy.includes(marker),
    `missing policy marker: ${marker}`,
  );
}

const sqlPatterns = [
  /create table if not exists public\.autorizaciones_video/i,
  /create table if not exists public\.media_video_registro/i,
  /create or replace function public\.tc_media_consumir_autorizacion/i,
  /create or replace function public\.tc_media_validar_duracion/i,
  /for update skip locked/i,
  /pg_advisory_xact_lock/i,
  /from public\.media_video_registro/i,
  /p_duracion_ms > 30000/i,
  /p_duracion_ms > 15000/i,
  /segundo_video_15s/i,
  /excepcion_30s/i,
  /E_MEDIA_AUTORIZACION_NO_DISPONIBLE/i,
  /E_MEDIA_DURACION_EXCEDIDA/i,
  /security definer/i,
  /set search_path = public, pg_temp/i,
];

for (const pattern of sqlPatterns) {
  assert.match(
    migrationText,
    pattern,
    `missing SQL pattern: ${pattern}`,
  );
}

const validatorStart = migrationText.indexOf(
  "create or replace function public.tc_media_validar_duracion",
);

const reject31Position = migrationText.indexOf(
  "p_duracion_ms > 30000",
  validatorStart,
);

const firstConsumptionPosition = migrationText.indexOf(
  "public.tc_media_consumir_autorizacion(",
  validatorStart,
);

assert.ok(validatorStart >= 0);
assert.ok(reject31Position >= 0);
assert.ok(firstConsumptionPosition >= 0);

assert.ok(
  reject31Position < firstConsumptionPosition,
  "31-second rejection must precede authorization consumption",
);

assert.match(
  migrationText,
  /insert into public\.media_video_registro[\s\S]*v_ordinal[\s\S]*p_duracion_ms/i,
);

assert.doesNotMatch(
  migrationText,
  /delete\s+from\s+storage\.objects/i,
);

console.log(JSON.stringify({
  rows: ["MEDIA-010", "MEDIA-011", "MEDIA-012"],
  files,
  sqlAssertions: sqlPatterns.length + 5,
  result: "PASS",
}));
