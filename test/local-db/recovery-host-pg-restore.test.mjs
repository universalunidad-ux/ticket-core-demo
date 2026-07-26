#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { redactSecrets } from "../../tools/local-db/lib/bootstrap.mjs";
import { classifyTarget } from "../../tools/local-db/lib/guards.mjs";

const RUNNER_PATH = "tools/local-db/run-recovery-v2.sh";
const source = readFileSync(RUNNER_PATH, "utf8");
const executable = source
  .split("\n")
  .map((line) => (/^\s*#/.test(line) ? "" : line))
  .join("\n");

function bashFunction(name) {
  const start = executable.indexOf(`${name}() {`);
  assert.notEqual(start, -1, `falta ${name}()`);
  const end = executable.indexOf("\n}", start);
  assert.notEqual(end, -1, `${name}() no cierra en columna cero`);
  return executable.slice(start, end + 2);
}

const restoreStart = executable.indexOf('if ! "${PG_RESTORE_BIN}" \\\n      --dbname="${DB_URL}"');
const restoreEnd = executable.indexOf("\n  RESTORE_RESULT=\"PASS\"", restoreStart);
assert.notEqual(restoreStart, -1, "falta restore final con PG_RESTORE_BIN");
assert.notEqual(restoreEnd, -1, "falta cierre del restore final");
const restoreFlow = executable.slice(
  executable.lastIndexOf('assert_regular_local_file "--dump"', restoreStart),
  restoreEnd,
);

test("restore final usa el pg_restore host y conserva flags", () => {
  assert.match(restoreFlow, /if ! "\$\{PG_RESTORE_BIN\}"/);
  assert.match(restoreFlow, /--dbname="\$\{DB_URL\}"/);
  for (const flag of [
    "--data-only",
    "--single-transaction",
    "--exit-on-error",
    "--schema=public",
    "--schema=app_private",
  ]) {
    assert.ok(restoreFlow.includes(flag), `falta ${flag}`);
  }
  assert.match(restoreFlow, /"\$\{DUMP_FILE\}"/);
  assert.doesNotMatch(executable, /docker exec\s+"\$\{CID\}"\s+pg_restore/);
});

test("dump permanece local y nunca se copia como app.dump", () => {
  const localFile = bashFunction("assert_regular_local_file");
  assert.match(restoreFlow, /assert_regular_local_file "--dump" "\$\{DUMP_FILE\}"/);
  assert.match(localFile, /\[\[\s+-e\s+"\$\{path\}"/);
  assert.match(localFile, /\[\[\s+-f\s+"\$\{path\}"/);
  assert.match(localFile, /\[\[\s+!\s+-L\s+"\$\{path\}"/);
  assert.doesNotMatch(executable, /docker cp\s+"\$\{DUMP_FILE\}"/);
  assert.doesNotMatch(executable, /\/tmp\/app\.dump/);
});

test("DB_URL se reclasifica LOCAL inmediatamente antes del restore", () => {
  assert.equal(
    classifyTarget("postgresql://postgres@127.0.0.1:54339/postgres").classification,
    "LOCAL",
  );
  assert.equal(
    classifyTarget("postgresql://postgres@db.example.com:5432/postgres").classification,
    "REMOTE",
  );
  assert.equal(
    classifyTarget("postgresql://postgres@project.supabase.co:5432/postgres").classification,
    "REMOTE",
  );
  assert.match(
    restoreFlow,
    /assert_local_db_url "\$\{DB_URL\}"[\s\S]*\|\| abort "RESTORE"[\s\S]*if ! "\$\{PG_RESTORE_BIN\}"/,
  );
  assert.match(bashFunction("assert_local_db_url"), /classifyTarget/);
  assert.match(bashFunction("assert_local_db_url"), /classification === "LOCAL" \? 0 : 1/);
});

test("toolchain host se resuelve una vez y exige 18.4 alineado", () => {
  const toolchain = bashFunction("assert_postgres_toolchain");
  assert.equal((executable.match(/resolve_postgres_tool\(\) \{/g) || []).length, 1);
  assert.match(toolchain, /PSQL_BIN="\$\(resolve_postgres_tool psql\)"/);
  assert.match(toolchain, /PG_DUMP_BIN="\$\(resolve_postgres_tool pg_dump\)"/);
  assert.match(toolchain, /PG_RESTORE_BIN="\$\(resolve_postgres_tool pg_restore\)"/);
  assert.match(toolchain, /EXPECTED_POSTGRES_VERSION_ERE/);
  assert.match(
    toolchain,
    /psql_version}" == "\$\{pg_dump_version}"[\s\S]*psql_version}" == "\$\{pg_restore_version}"/,
  );
  assert.match(executable, /EXPECTED_POSTGRES_VERSION="18\.4"/);
  assert.match(executable, /"\$\{PG_RESTORE_BIN\}" -l "\$\{DUMP_FILE\}"/);
});

test("stdout y stderr se redactan sin imprimir DB_URL", () => {
  assert.match(
    restoreFlow,
    /2>&1[\s\\]*\|\s*sanitize_log_stream >"\$\{ARTIFACTS_DIR\}\/04h_restore\.log"/,
  );
  assert.match(bashFunction("sanitize_log_stream"), /redactSecrets/);
  assert.match(bashFunction("sanitize_log_stream"), /user\(\?:name\)\?/);
  const redactionFixture = [
    ["postgresql://operator", "fixture-value@127.0.0.1:54339/postgres"].join(":"),
    ["password", "fixture-value"].join("="),
  ].join(" ");
  assert.equal(
    redactSecrets(redactionFixture),
    ["postgresql://operator", "***@127.0.0.1:54339/postgres password=***"].join(":"),
  );
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
    /if \[\[ "\$\{RESTORE_OK\}" != "yes" \]\]; then[\s\S]*RESTORE_RESULT="FAIL"[\s\S]*abort "RESTORE"/,
  );

  const abort = bashFunction("abort");
  assert.match(abort, /RESULT="FAIL"/);
  assert.match(abort, /SCORABLE="NO"/);
  assert.match(abort, /restore_integrity/);
  assert.match(abort, /teardown_stack/);

  const teardown = bashFunction("teardown_stack");
  assert.match(teardown, /STOP_ATTEMPTED/);
  assert.match(teardown, /STACK_OWNED/);
  assert.match(teardown, /bootstrap\.mjs --stop/);
});
