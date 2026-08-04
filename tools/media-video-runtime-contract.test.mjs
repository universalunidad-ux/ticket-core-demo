import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.argv[2] ?? ".";

const files = {
  matrix:
    "supabase/tests/media_video_runtime_matrix.sql",
  setup:
    "supabase/tests/media_video_concurrency_setup.sql",
  consume:
    "supabase/tests/media_video_concurrency_consume.sql",
  verify:
    "supabase/tests/media_video_concurrency_verify.sql",
  teardown:
    "supabase/tests/media_video_concurrency_teardown.sql",
  runner:
    "tools/local-db/run-media-video-docker-runtime.sh",
};

for (const relative of Object.values(files)) {
  assert.ok(
    fs.existsSync(path.join(root, relative)),
    `${relative} must exist`,
  );
}

const matrix = fs.readFileSync(
  path.join(root, files.matrix),
  "utf8",
);

const setup = fs.readFileSync(
  path.join(root, files.setup),
  "utf8",
);

const consume = fs.readFileSync(
  path.join(root, files.consume),
  "utf8",
);

const verify = fs.readFileSync(
  path.join(root, files.verify),
  "utf8",
);

const runner = fs.readFileSync(
  path.join(root, files.runner),
  "utf8",
);

for (
  let caseNumber = 1;
  caseNumber <= 9;
  caseNumber += 1
) {
  assert.ok(
    matrix.includes(
      `PASS MEDIA-VIDEO-MATRIX case=${caseNumber}`,
    ),
    `matrix case ${caseNumber} missing`,
  );
}

for (const marker of [
  "E_MEDIA_DURACION_EXCEDIDA",
  "E_MEDIA_AUTORIZACION_NO_DISPONIBLE",
  "segundo_video_15s",
  "excepcion_30s",
  "consumida_en is null",
  "media_video_registro",
]) {
  assert.ok(
    matrix.includes(marker),
    `matrix marker missing: ${marker}`,
  );
}

assert.match(
  setup,
  /tc_media_otorgar_autorizacion/i,
);

assert.match(
  consume,
  /tc_media_consumir_autorizacion/i,
);

assert.match(
  verify,
  /consumida_en is not null/i,
);

for (const marker of [
  "run-local-db-harness.sh",
  "--keep-up",
  "--db-port",
  "docker exec -i",
  "psql",
  "MEDIA_VIDEO_MATRIX_CASES=9",
  "CONCURRENCY_SUCCESS_COUNT",
  "CONCURRENCY_FAILURE_COUNT",
  "HOST_PSQL_USED=NO",
  "DOCKER_PSQL_USED=YES",
  "REMOTE_OPERATIONS=NO",
]) {
  assert.ok(
    runner.includes(marker),
    `runner marker missing: ${marker}`,
  );
}

assert.doesNotMatch(
  runner,
  /command -v psql/,
  "host psql must not be required",
);

for (const forbidden of [
  /\bsupabase\s+link\b/i,
  /\bsupabase\s+db\s+push\b/i,
  /\bsupabase\s+functions\s+deploy\b/i,
  /\bgit\s+push\b/i,
]) {
  assert.doesNotMatch(
    runner,
    forbidden,
    `forbidden operation: ${forbidden}`,
  );
}


for (const marker of [
  "SESSION_COUNT=10",
  "CONCURRENCY_SESSION_COUNT=$SESSION_COUNT",
  "CONCURRENCY_FAILURE_COUNT=$FAILURE_COUNT",
  "CONCURRENCY_LOSER_REASON_COUNT=$LOSER_REASON_COUNT",
  "CONCURRENCY_START_AT=$START_AT",
  "04_CONCURRENCY_SLOT_${SLOT}.log",
  "-v start_at=\"$START_AT\"",
]) {
  assert.ok(
    runner.includes(marker),
    `exact10 runner marker missing: ${marker}`,
  );
}

assert.match(
  consume,
  /pg_sleep[\s\S]*?:'start_at'::timestamptz/i,
  "consume SQL must use the shared start barrier",
);

for (let suffix = 0xa1; suffix <= 0xaa; suffix += 1) {
  const adjuntoId =
    `20000000-0000-0000-0000-0000000000${suffix.toString(16)}`;

  assert.ok(
    verify.includes(adjuntoId),
    `verify consumer missing: ${adjuntoId}`,
  );
}

assert.equal(
  (
    verify.match(
      /20000000-0000-0000-0000-0000000000a[1-9a]/g,
    ) ?? []
  ).length,
  10,
  "verify must enumerate exactly 10 consumer IDs",
);

console.log(JSON.stringify({
  rows: ["MEDIA-010", "MEDIA-011", "MEDIA-012"],
  matrixCases: 9,
  concurrencySessions: 10,
  hostPsqlRequired: false,
  dockerPsql: true,
  files,
  result: "PASS",
}));
