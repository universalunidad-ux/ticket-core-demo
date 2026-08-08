#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const RUNNER_PATH = "tools/local-db/run-recovery-v2.sh";
const SYNTHETIC_PATH = "tools/local-db/run-recovery-v2-synthetic.sh";
const source = readFileSync(RUNNER_PATH, "utf8");
const synthetic = readFileSync(SYNTHETIC_PATH, "utf8");
const executable = source
  .split("\n")
  .map((line) => (/^\s*#/.test(line) ? "" : line))
  .join("\n");
const syntheticExecutable = synthetic
  .split("\n")
  .map((line) => (/^\s*#/.test(line) ? "" : line))
  .join("\n");

function bashFunction(text, name) {
  const start = text.indexOf(`${name}() {`);
  assert.notEqual(start, -1, `falta ${name}()`);
  const end = text.indexOf("\n}", start);
  assert.notEqual(end, -1, `${name}() no cierra en columna cero`);
  return text.slice(start, end + 2);
}

const restoreStart = executable.indexOf('if ! docker exec -i "${CID}" pg_restore');
const restoreEnd = executable.indexOf('\n  RESTORE_RESULT="PASS"', restoreStart);
assert.notEqual(restoreStart, -1, "falta restore final con pg_restore del destino");
assert.notEqual(restoreEnd, -1, "falta cierre del restore final");
const restoreFlow = executable.slice(
  executable.lastIndexOf('assert_regular_local_file "--dump"', restoreStart),
  restoreEnd,
);

test("restore final usa pg_restore del destino por stdin y conserva flags", () => {
  assert.match(restoreFlow, /docker exec -i "\$\{CID\}" pg_restore/);
  assert.match(restoreFlow, /--dbname=postgres/);
  for (const flag of [
    "--data-only",
    "--single-transaction",
    "--exit-on-error",
    "--schema=public",
    "--schema=app_private",
  ]) {
    assert.ok(restoreFlow.includes(flag), `falta ${flag}`);
  }
  assert.match(restoreFlow, /<"\$\{DUMP_FILE\}"/);
  assert.doesNotMatch(
    executable.slice(restoreStart, restoreEnd),
    /PG_RESTORE_BIN|--dbname="\$\{DB_URL\}"/,
  );
});

test("dump sintético sale del pg_dump fuente y permanece como artefacto host", () => {
  assert.match(
    syntheticExecutable,
    /docker exec "\$\{SOURCE_CID\}" pg_dump -U postgres -d postgres[\s\S]*>"\$\{SOURCE_DUMP\}"/,
  );
  assert.match(restoreFlow, /assert_regular_local_file "--dump" "\$\{DUMP_FILE\}"/);
  assert.doesNotMatch(source, /\bdocker cp\b/);
  assert.doesNotMatch(synthetic, /\bdocker cp\b/);
  assert.doesNotMatch(source, /\/tmp\/app\.dump/);
});

test("TOC, escaneo y seed usan pg_restore del destino leyendo stdin", () => {
  assert.match(
    executable,
    /docker exec -i "\$\{CID\}" pg_restore -l[\s\\]*<"\$\{DUMP_FILE\}"/,
  );
  assert.match(
    executable,
    /docker exec -i "\$\{CID\}" pg_restore --data-only -f -[\s\\]*<"\$\{DUMP_FILE\}"/,
  );
  assert.match(
    executable,
    /docker exec -i "\$\{CID\}" pg_restore --data-only --table=perfiles -f -[\s\\]*<"\$\{DUMP_FILE\}"/,
  );
});

test("majors cliente servidor se prueban antes del restore", () => {
  const destination = bashFunction(executable, "assert_destination_toolchain");
  const dumpMetadata = bashFunction(executable, "read_dump_toolchain_metadata");
  const sourceToolchain = bashFunction(syntheticExecutable, "read_source_toolchain");

  assert.match(destination, /read_container_server_major/);
  assert.match(destination, /read_container_tool_major "\$\{CID\}" pg_restore/);
  assert.match(destination, /DESTINATION_CLIENT_SERVER_MAJOR_MISMATCH/);
  assert.match(dumpMetadata, /SOURCE_CLIENT_SERVER_MAJOR_MISMATCH/);
  assert.match(dumpMetadata, /SOURCE_DESTINATION_MAJOR_MISMATCH/);
  assert.match(sourceToolchain, /docker exec "\$\{SOURCE_CID\}" pg_dump --version/);
  assert.match(sourceToolchain, /SOURCE_CLIENT_SERVER_MAJOR_MISMATCH/);
  assert.ok(
    executable.indexOf("read_dump_toolchain_metadata") < restoreStart,
    "la incompatibilidad debe abortar antes del restore",
  );
});

test("DB_URL no se imprime ni participa del restore", () => {
  assert.doesNotMatch(executable.slice(restoreStart, restoreEnd), /DB_URL/);
  assert.doesNotMatch(executable, /(?:echo|printf)[^\n]*\$\{DB_URL\}/);
  assert.doesNotMatch(executable, /\bset\s+-x\b/);
});

test("fallo de pg_restore permanece FAIL, no scorable y con teardown", () => {
  assert.match(restoreFlow, /RESTORE_OK="no"/);
  assert.match(
    restoreFlow,
    /if ! restore_integrity; then[\s\S]*RESTORE_RESULT="FAIL"[\s\S]*abort "RESTORE"/,
  );
  assert.match(
    restoreFlow,
    /RESTORE_OK\}" != "yes"[\s\S]*RESTORE_RESULT="FAIL"[\s\S]*abort "RESTORE"/,
  );

  const abort = bashFunction(executable, "abort");
  assert.match(abort, /RESULT="FAIL"/);
  assert.match(abort, /SCORABLE="NO"/);
  assert.match(abort, /restore_integrity/);
  assert.match(abort, /teardown_stack/);
});
