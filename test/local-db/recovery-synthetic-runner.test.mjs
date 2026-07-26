#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const RUNNER_PATH = "tools/local-db/run-recovery-v2-synthetic.sh";
const runner = readFileSync(RUNNER_PATH, "utf8");
const functionsStart = runner.indexOf("resolve_postgres_tool() {");
const functionsEnd = runner.indexOf("read_postgres_tool_version() {");

assert.notEqual(functionsStart, -1, "falta resolve_postgres_tool()");
assert.notEqual(functionsEnd, -1, "falta read_postgres_tool_version()");
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

test("extrae 18.4 de salidas válidas sin comparar la línea completa", () => {
  for (const [tool, raw] of [
    ["psql", "psql (PostgreSQL) 18.4\n"],
    ["psql", "psql (PostgreSQL) 18.4 (Homebrew)\n"],
    ["pg_dump", "pg_dump (PostgreSQL) 18.4"],
    ["pg_restore", "pg_restore (PostgreSQL) 18.4"],
    ["psql", " \tpsql   (PostgreSQL)   18.4   (Homebrew) \r\n"],
  ]) {
    const result = parsedVersion(tool, raw);
    assert.equal(result.status, 0, `${tool}: ${result.stderr}`);
    assert.equal(result.stdout, "18.4");
  }
});

test("rechaza versiones distintas de 18.4, vacías o ilegibles", () => {
  for (const raw of [
    "",
    "psql version unknown",
    "psql (PostgreSQL) 18.3",
    "psql (PostgreSQL) 18.5",
    "psql (PostgreSQL) 19.0",
  ]) {
    const parsed = parsedVersion("psql", raw);
    const accepted = parsed.status === 0 && parsed.stdout === "18.4";
    assert.equal(accepted, false, `salida aceptada indebidamente: ${JSON.stringify(raw)}`);
  }
});

test("rechaza herramientas con versiones desalineadas", () => {
  const aligned = runBash("postgres_tool_versions_aligned 18.4 18.4 18.4");
  assert.equal(aligned.status, 0);

  for (const versions of [
    "18.4 18.3 18.4",
    "18.4 18.4 18.5",
    "18.4 18.4 19.0",
    "18.4 '' 18.4",
  ]) {
    const result = runBash(`postgres_tool_versions_aligned ${versions}`);
    assert.notEqual(result.status, 0, `versiones aceptadas indebidamente: ${versions}`);
  }
});

test("resuelve las tres herramientas desde brew --prefix libpq sin ejecutarlas", () => {
  const root = mkdtempSync(join(tmpdir(), "tc-recovery tools "));
  try {
    const fakePath = join(root, "fake path");
    const libpqPrefix = join(root, "Homebrew libpq");
    const libpqBin = join(libpqPrefix, "bin");
    const marker = join(root, "postgres-tool-was-executed");
    mkdirSync(fakePath, { recursive: true });
    mkdirSync(libpqBin, { recursive: true });

    const brew = join(fakePath, "brew");
    writeFileSync(
      brew,
      '#!/usr/bin/env bash\n[[ "$1" == "--prefix" && "$2" == "libpq" ]] || exit 2\nprintf \'%s\\n\' "$FAKE_BREW_PREFIX"\n',
    );
    chmodSync(brew, 0o755);

    for (const tool of ["psql", "pg_dump", "pg_restore"]) {
      const fakeTool = join(libpqBin, tool);
      writeFileSync(fakeTool, `#!/usr/bin/env bash\ntouch '${marker}'\nexit 99\n`);
      chmodSync(fakeTool, 0o755);

      const result = runBash(`resolve_postgres_tool ${tool}`, {
        PATH: `${fakePath}${delimiter}/usr/bin${delimiter}/bin`,
        FAKE_BREW_PREFIX: libpqPrefix,
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout.trim(), fakeTool);
    }

    assert.equal(existsSync(marker), false, "el test ejecutó una herramienta PostgreSQL");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("el runner valida las tres herramientas y conserva 18.4 como contrato", () => {
  assert.match(runner, /EXPECTED_POSTGRES_VERSION="18\.4"/);
  assert.match(runner, /resolve_postgres_tool psql/);
  assert.match(runner, /resolve_postgres_tool pg_dump/);
  assert.match(runner, /resolve_postgres_tool pg_restore/);
  assert.match(runner, /postgres_tool_versions_aligned/);
  assert.doesNotMatch(runner, /--version\s*\|\s*grep/);
});
