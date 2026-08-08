import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  adjudicateKeys,
  buildAtomicRestoreSql,
  buildBaselineValidationSql,
  buildMainRestoreList,
  formatAdjudication,
  parseSiteConfigCopy,
  readPolicy,
} from "../../tools/local-db/lib/site-config-ownership.mjs";

const policy = readPolicy();
const migration = readFileSync(policy.baseline_owner, "utf8");
const runner = readFileSync("tools/local-db/run-recovery-v2.sh", "utf8");
const signature = readFileSync("tools/local-db/recovery-signature.sql", "utf8");

function copySql(keys = policy.source_owned_keys) {
  const rows = keys.map((key, index) =>
    `${key}\tprivate-value-${index}\tpage\ttexto\tt\tf\t\\N\t2026-01-01 00:00:00+00`);
  return [
    "-- generated fixture",
    "COPY public.site_config (clave, valor, pagina, tipo, activo, publico, actualizado_por, actualizado_en) FROM stdin;",
    ...rows,
    "\\.",
  ].join("\n");
}

test("clasifica site_config como SOURCE_DATA_OWNED con allowlist exacta", () => {
  assert.equal(policy.classification, "SOURCE_DATA_OWNED");
  assert.equal(policy.restore_policy, "ATOMIC_DELETE_COPY_VALIDATE_COMMIT");
  assert.equal(policy.signature_policy, "FULL_PARITY");
  assert.deepEqual(policy.environment_owned_keys, []);
  assert.equal(policy.source_owned_keys.length, 6);
});

test("la allowlist coincide con las seis claves de la migración owner", () => {
  const insert = migration.match(
    /insert\s+into\s+public\.site_config\s*\(\s*clave[\s\S]*?values\s*([\s\S]*?);/i,
  );
  assert.ok(insert, "falta el seed canónico de site_config");
  const migrationKeys = [...insert[1].matchAll(/\(\s*'((?:''|[^'])*)'/g)]
    .map(match => match[1].replaceAll("''", "'"));
  assert.deepEqual(new Set(migrationKeys), new Set(policy.source_owned_keys));
});

test("acepta solape completo y cuenta seis claves sin exponer valores", () => {
  const parsed = parseSiteConfigCopy(copySql());
  const result = adjudicateKeys(parsed.keys, policy);
  assert.equal(result.ok, true);
  assert.equal(result.migrationKeyCount, 6);
  assert.equal(result.dumpKeyCount, 6);
  assert.equal(result.overlapKeyCount, 6);
  assert.equal(result.unknownKeyCount, 0);
  const diagnostics = formatAdjudication(result);
  assert.doesNotMatch(diagnostics, /private-value/);
  for (const key of policy.source_owned_keys) assert.doesNotMatch(diagnostics, new RegExp(key));
});

test("rechaza claves desconocidas, faltantes y duplicadas", () => {
  const unknown = adjudicateKeys([...policy.source_owned_keys.slice(0, 5), "unknown.key"], policy);
  assert.equal(unknown.ok, false);
  assert.equal(unknown.unknownKeyCount, 1);
  assert.equal(unknown.missingKeyCount, 1);

  const missing = adjudicateKeys(policy.source_owned_keys.slice(0, 5), policy);
  assert.equal(missing.ok, false);
  assert.equal(missing.missingKeyCount, 1);

  const duplicated = adjudicateKeys([...policy.source_owned_keys, policy.source_owned_keys[0]], policy);
  assert.equal(duplicated.ok, false);
  assert.equal(duplicated.duplicateKeyCount, 1);
  assert.throws(
    () => buildAtomicRestoreSql(
      copySql([...policy.source_owned_keys.slice(0, 5), "unknown.key"]),
      policy,
    ),
    /SITE_CONFIG_SOURCE_KEYS_REJECTED/,
  );
});

test("reproduce RESTORE_SITE_CONFIG_DUPLICATE_KEY y lo resuelve por sustitución", () => {
  const destinationSeed = new Set(policy.source_owned_keys);
  const legacyDirectCopy = () => {
    for (const key of parseSiteConfigCopy(copySql()).keys) {
      if (destinationSeed.has(key)) {
        throw new Error(`${policy.duplicate_constraint}: duplicate key`);
      }
      destinationSeed.add(key);
    }
  };
  assert.throws(legacyDirectCopy, /site_config_pkey: duplicate key/);

  const replacement = buildAtomicRestoreSql(copySql(), policy);
  assert.equal(replacement.adjudication.ok, true);
  assert.match(replacement.sql, /begin;\ndelete from public\.site_config;/);
});

test("la lista principal excluye sólo TABLE DATA public.site_config", () => {
  const toc = [
    "; archive",
    "1; 0 10 TABLE DATA public perfiles postgres",
    "2; 0 11 TABLE DATA public site_config postgres",
    "3; 0 12 TABLE DATA public tickets postgres",
  ].join("\n");
  const built = buildMainRestoreList(toc);
  assert.equal(built.excluded, 1);
  assert.match(built.text, /^1; 0 10 TABLE DATA public perfiles postgres$/m);
  assert.match(built.text, /^3; 0 12 TABLE DATA public tickets postgres$/m);
  assert.match(built.text, /^; SOURCE_DATA_OWNED_ATOMIC_RESTORE 2;/m);
  assert.equal((built.text.match(/SOURCE_DATA_OWNED_ATOMIC_RESTORE/g) || []).length, 1);
});

test("la sustitución es atómica, validada y no debilita integridad", () => {
  const built = buildAtomicRestoreSql(copySql(), policy);
  assert.match(built.sql, /begin;\ndelete from public\.site_config;/);
  assert.match(built.sql, /COPY public\.site_config/);
  assert.match(built.sql, /SITE_CONFIG_SOURCE_UNKNOWN_KEY/);
  assert.match(built.sql, /SITE_CONFIG_SOURCE_MISSING_KEY/);
  assert.match(built.sql, /commit;\n\\echo SITE_CONFIG_ATOMIC_RESTORE=PASS/);
  assert.doesNotMatch(built.sql, /\btruncate\b/i);
  assert.doesNotMatch(built.sql, /disable\s+trigger/i);
  assert.doesNotMatch(built.sql, /\bon\s+conflict\b/i);
});

test("el baseline del destino exige exactamente la allowlist antes del restore", () => {
  const sql = buildBaselineValidationSql(policy);
  assert.match(sql, /SITE_CONFIG_BASELINE_COUNT_INVALID/);
  assert.match(sql, /SITE_CONFIG_BASELINE_UNKNOWN_KEY/);
  assert.match(sql, /SITE_CONFIG_BASELINE_MISSING_KEY/);
  assert.match(sql, /SITE_CONFIG_BASELINE_VALIDATED=PASS/);
});

test("restore fallido conserva RESULT=FAIL, SCORABLE=NO y teardown", () => {
  const abort = runner.slice(
    runner.indexOf("abort() {"),
    runner.indexOf("on_signal() {"),
  );
  assert.match(abort, /RESULT="FAIL"/);
  assert.match(abort, /SCORABLE="NO"/);
  assert.match(abort, /restore_integrity/);
  assert.match(abort, /teardown_stack/);
});

test("site_config permanece en firma de paridad completa", () => {
  assert.match(signature, /from public\.site_config t/);
  assert.equal(policy.signature_policy, "FULL_PARITY");
});
