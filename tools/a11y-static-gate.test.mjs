#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { A11Y_STATIC_SUITES } from "./a11y-static-gate.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GATE = join(REPO, "tools/a11y-static-gate.mjs");
const EXPECTED_SUITES = [
  "tools/a11y-u3-u4.test.mjs",
  "tools/client-tabs-a11y.test.mjs",
  "tools/ticket-composer-a11y.test.mjs",
  "tools/dialog-accessibility.test.mjs",
];
const results = [];

function pass(name) { results.push(name); }

function sandbox(suites) {
  const root = mkdtempSync(join(tmpdir(), "a11y-static-gate-test-"));
  mkdirSync(join(root, "tools"), { recursive: true });
  cpSync(GATE, join(root, "tools/a11y-static-gate.mjs"));
  for (const [suite, exitCode] of suites) {
    writeFileSync(join(root, suite), `console.log("STUB=${suite}");\nprocess.exit(${exitCode});\n`, "utf8");
  }
  return root;
}

function runGate(root) {
  return spawnSync(process.execPath, [join(root, "tools/a11y-static-gate.mjs")], { cwd: root, encoding: "utf8" });
}

// 01 manifiesto exacto y ordenado
assert.deepEqual(A11Y_STATIC_SUITES, EXPECTED_SUITES, "MANIFEST_MISMATCH");
assert.equal(A11Y_STATIC_SUITES.length, 4, "MANIFEST_COUNT_MISMATCH");
pass("01 el manifiesto contiene exactamente las cuatro suites esperadas en orden determinista");

// 02 sin duplicados
assert.equal(new Set(A11Y_STATIC_SUITES).size, A11Y_STATIC_SUITES.length, "MANIFEST_DUPLICATE");
pass("02 el manifiesto no contiene duplicados");

// 03 cada suite declarada existe en el repositorio
for (const suite of A11Y_STATIC_SUITES) assert.ok(existsSync(join(REPO, suite)), `SUITE_MISSING:${suite}`);
pass("03 las cuatro suites declaradas existen en el repositorio");

// 04 el workflow ejecuta el gate exactamente una vez
const workflow = readFileSync(join(REPO, ".github/workflows/frontend-gates.yml"), "utf8");
const workflowExecutions = (workflow.match(/node\s+tools\/a11y-static-gate\.mjs/g) || []).length;
assert.equal(workflowExecutions, 1, `WORKFLOW_EXECUTION_COUNT:${workflowExecutions}`);
pass("04 el workflow ejecuta a11y-static-gate.mjs exactamente una vez");

// 05 preflight declara un owner unico y lo ejecuta solo en la ruta pre-commit
const preflightSrc = readFileSync(join(REPO, "tools/preflight.mjs"), "utf8");
const ownerDefinitions = (preflightSrc.match(/function runA11yStaticGate\s*\(/g) || []).length;
assert.equal(ownerDefinitions, 1, `PREFLIGHT_OWNER_DEFINITIONS:${ownerDefinitions}`);
const gatePathLiterals = (preflightSrc.match(/tools\/a11y-static-gate\.mjs/g) || []).length;
assert.equal(gatePathLiterals, 1, `PREFLIGHT_GATE_PATH_LITERALS:${gatePathLiterals}`);

const validateStart = preflightSrc.indexOf("function validateIndexCandidate(");
const executeStart = preflightSrc.indexOf("export function executePreflight");
assert.ok(validateStart >= 0 && executeStart > validateStart, "PREFLIGHT_STRUCTURE_UNEXPECTED");
const validateBody = preflightSrc.slice(validateStart, executeStart);
const executeBody = preflightSrc.slice(executeStart);
const precommitOwnerCount = (validateBody.match(/runA11yStaticGate\s*\(/g) || []).length;
assert.equal(precommitOwnerCount, 1, `PRECOMMIT_OWNER_COUNT:${precommitOwnerCount}`);
// Debe evaluarse el candidato materializado por checkout-index, nunca el worktree original.
assert.match(validateBody, /runA11yStaticGate\(candidate\)/, "PRECOMMIT_GATE_NOT_INDEX_AWARE");
assert.doesNotMatch(validateBody, /existsSync\([^)]*a11y-static-gate/, "PRECOMMIT_GATE_SILENT_SKIP");
pass("05 preflight declara un owner unico y lo ejecuta exactamente una vez sobre el candidato staged");

// 06 la ruta pre-commit es la unica que alcanza el gate; ci, fast, test y full no son owners
const branchStart = executeBody.indexOf('if (mode === "pre-commit") {');
assert.ok(branchStart >= 0, "PREFLIGHT_PRECOMMIT_BRANCH_MISSING");
const branchEnd = executeBody.indexOf("} else {", branchStart);
assert.ok(branchEnd > branchStart, "PREFLIGHT_ELSE_BRANCH_MISSING");
const precommitBranch = executeBody.slice(branchStart, branchEnd);
const nonPrecommitBranch = executeBody.slice(branchEnd);
const precommitEntryCount = (precommitBranch.match(/validateIndexCandidate\s*\(/g) || []).length;
assert.equal(precommitEntryCount, 1, `PRECOMMIT_ENTRY_COUNT:${precommitEntryCount}`);
const nonPrecommitRefs = nonPrecommitBranch.match(/runA11yStaticGate\s*\(|validateIndexCandidate\s*\(|a11y-static-gate/g) || [];
const ciPreflightOwnerCount = nonPrecommitRefs.length;
const fastOwnerCount = ciPreflightOwnerCount;
const ciDuplicateCount = ciPreflightOwnerCount;
assert.equal(ciPreflightOwnerCount, 0, `CI_PREFLIGHT_OWNER_COUNT:${ciPreflightOwnerCount}`);
pass("06 ci, fast, test y full no ejecutan el gate; el workflow conserva la propiedad unica en CI");

// 07 fail-closed ante suite faltante
{
  const root = sandbox(EXPECTED_SUITES.slice(0, 3).map((suite) => [suite, 0]));
  try {
    const result = runGate(root);
    assert.notEqual(result.status, 0, "MISSING_SUITE_NOT_FAIL_CLOSED");
    assert.match(`${result.stdout}\n${result.stderr}`, /A11Y_SUITE_MISSING:tools\/dialog-accessibility\.test\.mjs/);
    assert.doesNotMatch(result.stdout, /A11Y_STATIC_GATE=PASS/);
  } finally { rmSync(root, { recursive: true, force: true }); }
}
pass("07 el gate falla si una suite falta");

// 08 propagacion del fallo de una suite
{
  const root = sandbox(EXPECTED_SUITES.map((suite, index) => [suite, index === 1 ? 3 : 0]));
  try {
    const result = runGate(root);
    assert.notEqual(result.status, 0, "SUITE_FAILURE_NOT_PROPAGATED");
    const output = `${result.stdout}\n${result.stderr}`;
    assert.match(output, /A11Y_SUITE=tools\/client-tabs-a11y\.test\.mjs RESULT=FAIL/);
    assert.match(output, /A11Y_SUITE_FAILED:tools\/client-tabs-a11y\.test\.mjs:3/);
    // fail-closed: se detiene y no ejecuta las suites posteriores
    assert.doesNotMatch(output, /A11Y_SUITE=tools\/ticket-composer-a11y\.test\.mjs/);
    assert.doesNotMatch(output, /A11Y_STATIC_GATE=PASS/);
  } finally { rmSync(root, { recursive: true, force: true }); }
}
pass("08 el gate propaga el fallo de una suite y se detiene fail-closed");

// 09 el gate real pasa con las cuatro suites actuales
{
  const result = spawnSync(process.execPath, [GATE], { cwd: REPO, encoding: "utf8" });
  assert.equal(result.status, 0, `REAL_GATE_FAILED:${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /A11Y_STATIC_GATE=PASS/);
  assert.match(result.stdout, /A11Y_STATIC_SUITE_COUNT=4/);
  for (const suite of EXPECTED_SUITES) {
    assert.ok(result.stdout.includes(`A11Y_SUITE=${suite} RESULT=PASS`), `SUITE_NOT_REPORTED:${suite}`);
  }
}
pass("09 el gate real pasa con las cuatro suites actuales");

// 10 el manifiesto canonico declara el gate productivo exactamente una vez
const manifest = JSON.parse(readFileSync(join(REPO, "tools/canonical-source.json"), "utf8"));
const manifestOwnerCount = manifest.specialized_gate_owners.filter((owner) => owner === "tools/a11y-static-gate.mjs").length;
assert.equal(manifestOwnerCount, 1, `CANONICAL_MANIFEST_OWNER_COUNT:${manifestOwnerCount}`);
assert.ok(
  !JSON.stringify(manifest).includes("tools/a11y-static-gate.test.mjs"),
  "TEST_DECLARED_AS_PRODUCTION_GATE",
);
pass("10 el manifiesto canonico declara a11y-static-gate.mjs una sola vez y no declara su test");

console.log(`A11Y_STATIC_GATE_TESTS=PASS (${results.length}/${results.length})`);
console.log(`A11Y_STATIC_SUITE_COUNT=${A11Y_STATIC_SUITES.length}`);
console.log(`WORKFLOW_OWNER_COUNT=${workflowExecutions}`);
console.log(`PRECOMMIT_OWNER_COUNT=${precommitOwnerCount}`);
console.log(`FAST_OWNER_COUNT=${fastOwnerCount}`);
console.log(`CI_PREFLIGHT_OWNER_COUNT=${ciPreflightOwnerCount}`);
console.log(`CI_DUPLICATE_EXECUTION_COUNT=${ciDuplicateCount}`);
console.log(`CANONICAL_MANIFEST_OWNER_COUNT=${manifestOwnerCount}`);
for (const name of results) console.log(`PASS\t${name}`);
