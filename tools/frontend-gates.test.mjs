import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const gate = join(here, "frontend-gates.mjs");

function fixture(files = {}) {
  const root = mkdtempSync(join(tmpdir(), "frontend-gates-contract-"));
  const required = {
    ".nojekyll": "",
    "app/index.html": "<!doctype html><title>Gate fixture</title>",
    "app/supabase.config.public.js": "export const config = {};",
    "app/sw.js": "export const cache = [];",
    ...files,
  };
  for (const [path, source] of Object.entries(required)) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, source);
  }
  return root;
}

function run(gatePath, root) {
  return spawnSync(process.execPath, [gatePath, root], { encoding: "utf8" });
}

function withFixture(files, fn) {
  const root = fixture(files);
  try { fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test("import productivo inexistente falla, incluido import() dinámico", () => {
  withFixture({ "app/main.js": 'export const load = () => import("./missing.js");' }, root => {
    const result = run(gate, root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /IMPORT_MISSING\tapp\/main\.js\t\.\/missing\.js/);
  });
});

test("imports productivos válidos pasan", () => {
  withFixture({
    "app/main.js": 'import "./dep.js"; export const load = () => import("./lazy.js");',
    "app/dep.js": "export const dep = true;",
    "app/lazy.js": "export const lazy = true;",
  }, root => {
    const result = run(gate, root);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /FRONTEND_GATES: PASS/);
  });
});

test("fixtures de prueba con imports ficticios no son dependencias productivas", () => {
  withFixture({
    "test/contracts/import-fixture.test.mjs": 'export const sample = `import "./not-real.js"; import("./also-not-real.js")`;',
  }, root => {
    const result = run(gate, root);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /IMPORT_MISSING/);
  });
});

test("mutación que vuelve a ampliar el escaneo a tests queda detectada", () => {
  withFixture({
    "test/contracts/import-fixture.test.mjs": 'export const sample = `import("./mutation-missing.js")`;',
  }, root => {
    const mutated = join(root, "mutated-frontend-gates.mjs");
    const source = readFileSync(gate, "utf8");
    const broadened = source.replace("if (isImportDependencySource(file)) {", "if (true) {");
    assert.notEqual(broadened, source, "la mutación debe modificar la frontera de escaneo");
    writeFileSync(mutated, broadened);
    const result = run(mutated, root);
    assert.equal(result.status, 1, "la mutación debe reintroducir el falso positivo y fallar");
    assert.match(result.stderr, /IMPORT_MISSING\ttest\/contracts\/import-fixture\.test\.mjs\t\.\/mutation-missing\.js/);
  });
});
