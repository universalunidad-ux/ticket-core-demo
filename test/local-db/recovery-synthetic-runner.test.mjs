#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const RUNNER_PATH = "tools/local-db/run-recovery-v2-synthetic.sh";
const runner = readFileSync(RUNNER_PATH, "utf8");
const functionsStart = runner.indexOf("parse_postgres_tool_version() {");
const functionsEnd = runner.indexOf("read_source_toolchain() {");

assert.notEqual(functionsStart, -1, "falta parse_postgres_tool_version()");
assert.notEqual(functionsEnd, -1, "falta read_source_toolchain()");
assert.ok(functionsEnd > functionsStart, "orden inesperado de funciones PostgreSQL");

const pureFunctions = runner.slice(functionsStart, functionsEnd);

function runBash(body, env = {}) {
  return spawnSync("/bin/bash", ["-c", `${pureFunctions}\n${body}`], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

function parsedVersion(tool, raw) {
  const result = runBash('parse_postgres_tool_version "$TOOL" "$RAW"', {
    TOOL: tool,
    RAW: raw,
  });
  return {
    status: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr,
  };
}

test("extrae versiones PostgreSQL válidas sin fijar el major host", () => {
  for (const [tool, raw, expected] of [
    ["psql", "psql (PostgreSQL) 18.4\n", "18.4"],
    ["pg_dump", "pg_dump (PostgreSQL) 15.8", "15.8"],
    ["pg_restore", "pg_restore (PostgreSQL) 17.6.1", "17.6.1"],
    ["psql", " \tpsql   (PostgreSQL)   18.4   (Homebrew) \r\n", "18.4"],
  ]) {
    const result = parsedVersion(tool, raw);
    assert.equal(result.status, 0, `${tool}: ${result.stderr}`);
    assert.equal(result.stdout, expected);
  }
});

test("rechaza salidas vacías o ilegibles", () => {
  for (const raw of ["", "psql version unknown", "PostgreSQL 15.8"]) {
    assert.notEqual(parsedVersion("psql", raw).status, 0);
  }
});

test("version_major obtiene el major y falla cerrado", () => {
  for (const [version, expected] of [["15.8", "15"], ["18.4", "18"], ["17", "17"]]) {
    const result = runBash('version_major "$VERSION"', { VERSION: version });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), expected);
  }
  assert.notEqual(runBash('version_major "$VERSION"', { VERSION: "x15.8" }).status, 0);
});

test("el runner usa el pg_dump fuente, artefacto host y toolchain alineado", () => {
  assert.match(runner, /read_source_toolchain/);
  assert.match(runner, /SOURCE_CLIENT_SERVER_MAJOR_MISMATCH/);
  assert.match(runner, /docker exec "\$\{SOURCE_CID\}" pg_dump --version/);
  assert.match(
    runner,
    /docker exec "\$\{SOURCE_CID\}" pg_dump -U postgres -d postgres[\s\S]*>"\$\{SOURCE_DUMP\}"/,
  );
  assert.doesNotMatch(runner, /PG_DUMP_BIN|PG_RESTORE_BIN|EXPECTED_POSTGRES_VERSION/);
  assert.doesNotMatch(runner, /\bdocker cp\b/);
});
