// TC-GENERATED-SQL-TYPE-SAFETY-GATE-01
// Contrato estático. No ejecuta Docker, Supabase CLI, psql ni SQL.

import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  discoverSqlGenerators,
  validateTypedSql,
} from "../../tools/local-db/generated-sql-type-safety-gate.mjs";
import {
  renderAuthSeedSql,
} from "../../tools/local-db/lib/auth-seed.mjs";

const MANIFEST_PATH = "tools/local-db/generated-sql-generators.json";
const GATE_PATH = "tools/local-db/generated-sql-type-safety-gate.mjs";
const RUNNER_PATH = "tools/local-db/run-auth-seed-smoke.sh";
const ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
const authSeed = manifest.generators.find((item) => item.id === "auth-users-synthetic-seed");
const runner = readFileSync(RUNNER_PATH, "utf8");

test("el manifiesto cubre exhaustivamente los generadores SQL descubiertos", () => {
  assert.equal(manifest.unit, "TC-GENERATED-SQL-TYPE-SAFETY-GATE-01");
  assert.deepEqual(
    manifest.generators.map((item) => item.owner).sort(),
    discoverSqlGenerators(),
  );
  assert.deepEqual(
    manifest.generators.map((item) => item.id).sort(),
    ["auth-users-synthetic-seed", "authz-policy-baseline-reconciliation"],
  );
});

test("el gate estático acepta el SQL tipado y rechaza cada familia sin cast", () => {
  const sql = renderAuthSeedSql([ID]);
  assert.equal(validateTypedSql(sql, authSeed), true);

  for (const [typed, untyped] of [
    ["v.instance_id::uuid", "v.instance_id"],
    ["'2000-01-01 00:00:00+00'::timestamptz", "'2000-01-01 00:00:00+00'"],
    ["'{}'::jsonb", "'{}'"],
  ]) {
    assert.throws(
      () => validateTypedSql(sql.replaceAll(typed, untyped), authSeed),
      /GENERATED_SQL_TYPE_SAFETY/,
    );
  }
});

test("el modo smoke verifica uuid, timestamptz y jsonb antes de ROLLBACK", () => {
  const sql = renderAuthSeedSql(
    [ID],
    { transactionEnd: "rollback", verifyTypes: true },
  );
  assert.equal(validateTypedSql(sql, authSeed, { smoke: true }), true);
  assert.match(sql, /\bbegin;/i);
  assert.match(sql, /AUTH_SEED_TYPE_UUID=PASS/);
  assert.match(sql, /AUTH_SEED_TYPE_TIMESTAMPTZ=PASS/);
  assert.match(sql, /AUTH_SEED_TYPE_JSONB=PASS/);
  assert.match(sql, /\brollback;/i);
  assert.doesNotMatch(sql, /\bcommit;/i);
  assert.ok(sql.indexOf("AUTH_SEED_TYPE_JSONB=PASS") < sql.toLowerCase().indexOf("rollback;"));
});

test("opciones de transacción inválidas fallan cerrado", () => {
  assert.throws(() => renderAuthSeedSql([ID], { transactionEnd: "savepoint" }), /transactionEnd invalido/);
  assert.throws(() => renderAuthSeedSql([ID], { verifyTypes: true }), /exige transactionEnd=rollback/);
});

test("el runner es ejecutable, local-only, single-writer y sin keep-up", () => {
  assert.notEqual(statSync(RUNNER_PATH).mode & 0o111, 0, "runner no ejecutable");
  assert.match(runner, /EXPECTED_BRANCH="test\/recovery-v2-20260725"/);
  assert.match(runner, /git rev-parse --git-path index\.lock/);
  assert.match(runner, /mkdir "\$\{LOCK_DIR\}".*E_WRITER_LOCK_PRESENT/);
  assert.match(runner, /assert_remote_env_absent/);
  assert.match(runner, /case "\$\{HOST\}" in[\s\S]*localhost\|127\.0\.0\.1\|::1/);
  assert.doesNotMatch(runner, /--keep-up|supabase\s+(?:link|db push|migration up)/);
});

test("el runner exige ROLLBACK, teardown PASS y cero stacks residuales", () => {
  assert.match(runner, /auth-seed\.mjs --emit-sql --smoke/);
  assert.match(runner, /-v ON_ERROR_STOP=1/);
  assert.match(runner, /AUTH_SEED_TRANSACTION=ROLLBACK/);
  assert.match(runner, /POST_ROLLBACK_COUNT/);
  assert.match(runner, /stop_owned_stack/);
  assert.match(runner, /RESIDUAL_STACKS="ZERO"/);
  assert.match(runner, /TEARDOWN="PASS"/);
  assert.match(runner, /RESIDUAL_SUPABASE_STACKS=\$\{RESIDUAL_STACKS\}/);
});

test("el gate completo pasa sin herramientas de runtime", () => {
  const result = spawnSync(process.execPath, [GATE_PATH], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /GENERATED_SQL_TYPE_SAFETY_GATE=PASS/);
  assert.match(result.stdout, /SQL_GENERATORS_MANIFESTED=2/);
  assert.match(result.stdout, /SQL_TYPES_CHECKED=jsonb,timestamptz,uuid/);
  assert.match(result.stdout, /SQL_EXECUTED=NO/);
});
