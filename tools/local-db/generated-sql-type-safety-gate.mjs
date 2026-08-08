#!/usr/bin/env node
// TC-GENERATED-SQL-TYPE-SAFETY-GATE-01
// Gate puramente estático: no abre conexiones, no invoca Docker/Supabase/psql
// y no ejecuta SQL. El manifiesto es la allowlist exhaustiva de generadores.

import assert from "node:assert/strict";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(SCRIPT_DIR, "..", "..");
export const MANIFEST_PATH = join(SCRIPT_DIR, "generated-sql-generators.json");
const REQUIRED_TYPE_FAMILIES = new Set(["uuid", "timestamptz", "jsonb"]);

function fail(message) {
  throw new Error(`GENERATED_SQL_TYPE_SAFETY: ${message}`);
}

function occurrences(haystack, needle) {
  return String(haystack).split(String(needle)).length - 1;
}

export function validateTypedSql(sql, generator, { smoke = false } = {}) {
  if (generator.kind !== "dynamic-dml") fail(`${generator.id}: no es dynamic-dml`);
  const bindings = Array.isArray(generator.bindings) ? generator.bindings : [];
  if (bindings.length === 0) fail(`${generator.id}: bindings vacio`);

  const families = new Set();
  for (const binding of bindings) {
    const { column, expression, sqlType, minimumOccurrences = 1 } = binding;
    if (!column || !expression || !REQUIRED_TYPE_FAMILIES.has(sqlType)) {
      fail(`${generator.id}: binding invalido para ${String(column)}`);
    }
    if (!Number.isInteger(minimumOccurrences) || minimumOccurrences < 1) {
      fail(`${generator.id}: minimumOccurrences invalido para ${column}`);
    }
    const typedExpression = `${expression}::${sqlType}`;
    const actual = occurrences(sql, typedExpression);
    if (actual < minimumOccurrences) {
      fail(
        `${generator.id}: ${column} exige ${typedExpression} `
        + `(esperado>=${minimumOccurrences}, actual=${actual})`,
      );
    }
    families.add(sqlType);
  }

  for (const type of REQUIRED_TYPE_FAMILIES) {
    if (!families.has(type)) fail(`${generator.id}: familia tipada ausente: ${type}`);
  }
  if (!/\bbegin;\s/i.test(sql)) fail(`${generator.id}: falta BEGIN`);

  if (smoke) {
    if (!/\brollback;\s/i.test(sql) || /\bcommit;\s/i.test(sql)) {
      fail(`${generator.id}: smoke debe terminar exclusivamente con ROLLBACK`);
    }
    for (const [type, marker] of [
      ["uuid", "AUTH_SEED_TYPE_UUID=PASS"],
      ["timestamptz", "AUTH_SEED_TYPE_TIMESTAMPTZ=PASS"],
      ["jsonb", "AUTH_SEED_TYPE_JSONB=PASS"],
    ]) {
      if (!sql.includes(marker) || !sql.includes(`'${type === "timestamptz" ? "timestamp with time zone" : type}'::regtype`)) {
        fail(`${generator.id}: probe runtime incompleto para ${type}`);
      }
    }
    if (!sql.includes("AUTH_SEED_TRANSACTION=ROLLBACK")) {
      fail(`${generator.id}: marcador de rollback ausente`);
    }
  } else {
    if (!/\bcommit;\s/i.test(sql) || /\brollback;\s/i.test(sql)) {
      fail(`${generator.id}: salida productiva debe terminar exclusivamente con COMMIT`);
    }
  }
  return true;
}

function walkSourceFiles(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const abs = join(root, entry.name);
    if (entry.isDirectory()) files.push(...walkSourceFiles(abs));
    else if (/\.(?:mjs|js)$/.test(entry.name) && !/test\./.test(entry.name)) files.push(abs);
  }
  return files;
}

export function discoverSqlGenerators(repoRoot = REPO_ROOT) {
  const toolsRoot = join(repoRoot, "tools");
  return walkSourceFiles(toolsRoot)
    .filter((path) => {
      if (resolve(path) === resolve(fileURLToPath(import.meta.url))) return false;
      const source = readFileSync(path, "utf8");
      const streamsSql = source.includes("--emit-sql") && source.includes("process.stdout.write(sql");
      const writesSqlFile = source.includes("writeFileSync") && source.includes("-- GENERATED FILE");
      return streamsSql || writesSqlFile;
    })
    .map((path) => relative(repoRoot, path))
    .sort();
}

export async function runGate() {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  assert.equal(manifest.schemaVersion, 1, "schemaVersion no soportado");
  assert.equal(manifest.unit, "TC-GENERATED-SQL-TYPE-SAFETY-GATE-01");
  assert.ok(Array.isArray(manifest.generators) && manifest.generators.length > 0);

  const ids = manifest.generators.map((generator) => generator.id);
  assert.equal(new Set(ids).size, ids.length, "ids de generador duplicados");

  const declaredOwners = manifest.generators.map((generator) => generator.owner).sort();
  assert.deepEqual(
    declaredOwners,
    discoverSqlGenerators(),
    "el manifiesto no coincide con el inventario estático de generadores SQL",
  );

  const checkedTypes = new Set();
  for (const generator of manifest.generators) {
    const owner = join(REPO_ROOT, generator.owner);
    if (!existsSync(owner) || !lstatSync(owner).isFile() || lstatSync(owner).isSymbolicLink()) {
      fail(`${generator.id}: owner ausente, no regular o symlink`);
    }

    if (generator.kind === "dynamic-dml") {
      if (!generator.smokeRunner || !existsSync(join(REPO_ROOT, generator.smokeRunner))) {
        fail(`${generator.id}: smokeRunner ausente`);
      }
      const module = await import(pathToFileURL(owner));
      const renderer = module[generator.rendererExport];
      if (typeof renderer !== "function") fail(`${generator.id}: rendererExport invalido`);

      const productionSql = renderer(generator.sampleIds);
      const smokeSql = renderer(
        generator.sampleIds,
        { transactionEnd: "rollback", verifyTypes: true },
      );
      validateTypedSql(productionSql, generator);
      validateTypedSql(smokeSql, generator, { smoke: true });
      for (const binding of generator.bindings) checkedTypes.add(binding.sqlType);
      continue;
    }

    if (generator.kind === "versioned-ddl") {
      const output = join(REPO_ROOT, generator.output || "");
      if (!existsSync(output) || !lstatSync(output).isFile() || lstatSync(output).isSymbolicLink()) {
        fail(`${generator.id}: output versionado ausente, no regular o symlink`);
      }
      const check = spawnSync(process.execPath, [owner, ...generator.checkArgs], {
        cwd: REPO_ROOT,
        encoding: "utf8",
      });
      if (check.status !== 0) fail(`${generator.id}: drift del output versionado`);
      continue;
    }

    fail(`${generator.id}: kind no soportado`);
  }

  process.stdout.write([
    "GENERATED_SQL_TYPE_SAFETY_GATE=PASS",
    `SQL_GENERATORS_MANIFESTED=${manifest.generators.length}`,
    `SQL_TYPES_CHECKED=${[...checkedTypes].sort().join(",")}`,
    "SQL_EXECUTED=NO",
    "",
  ].join("\n"));
}

function isMain() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMain()) {
  runGate().catch((error) => {
    process.stderr.write(`GENERATED_SQL_TYPE_SAFETY_GATE=FAIL\nDETAIL=${error.message}\n`);
    process.exit(1);
  });
}
