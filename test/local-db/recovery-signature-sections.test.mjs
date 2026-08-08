#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const RUNNER_PATH = "tools/local-db/run-recovery-v2.sh";
const runner = readFileSync(RUNNER_PATH, "utf8");
const arrayStart = runner.indexOf("RECOVERY_SIGNATURE_SECTIONS=(");
const arrayEnd = runner.indexOf("\n)", arrayStart);
const helperStart = runner.indexOf("set_signature_section_result() {");
const helperEnd = runner.indexOf('SIGNATURE_SECTION_FAILURES=""', helperStart);

assert.notEqual(arrayStart, -1, "falta RECOVERY_SIGNATURE_SECTIONS");
assert.notEqual(arrayEnd, -1, "falta cierre de RECOVERY_SIGNATURE_SECTIONS");
assert.notEqual(helperStart, -1, "faltan helpers de secciones");
assert.notEqual(helperEnd, -1, "falta cierre de helpers de secciones");

function bashFunction(name) {
  const start = runner.indexOf(`${name}() {`);
  const end = runner.indexOf("\n}", start);
  assert.notEqual(start, -1, `falta ${name}()`);
  assert.notEqual(end, -1, `falta cierre de ${name}()`);
  return runner.slice(start, end + 2);
}

const helperSource = [
  runner.slice(arrayStart, arrayEnd + 2),
  bashFunction("signature_section_markers_valid"),
  bashFunction("split_signature"),
  runner.slice(helperStart, helperEnd + 'SIGNATURE_SECTION_FAILURES=""'.length),
].join("\n");
const sections = [
  "STRUCTURE",
  "FUNCTIONS",
  "POLICIES",
  "ACL",
  "DATA",
  "LEDGER",
  "STORAGE",
  "OWNERSHIP",
];
const expectedOrder = sections.join(",");
const physicalProducerOrder = [
  "STRUCTURE",
  "FUNCTIONS",
  "POLICIES",
  "ACL",
  "OWNERSHIP",
  "DATA",
  "LEDGER",
  "STORAGE",
];

function signature(sectionOrder = physicalProducerOrder) {
  return [
    "RECOVERY_SIGNATURE_MODE=REPORT_ONLY",
    "RECOVERY_SIGNATURE_ALLOWLIST=public,app_private",
    ...sectionOrder.flatMap((section) => [`SECTION=${section}`, `${section}|hash-only`]),
    "SECTION=END",
    "RECOVERY_SIGNATURE_COMPLETE=YES",
    "",
  ].join("\n");
}

function validateSignature(content, after = ":") {
  const root = mkdtempSync(join(tmpdir(), "tc-recovery-signature-format-"));
  const signaturePath = join(root, "signature.txt");
  writeFileSync(signaturePath, content);
  const result = spawnSync("/bin/bash", ["-c", `
set -Eeuo pipefail
IFS=$'\\n\\t'
${helperSource}
set +e
signature_section_markers_valid "$SIGNATURE"
RC=$?
set -e
${after}
printf 'RC=%s\\n' "$RC"
`], {
    encoding: "utf8",
    env: { ...process.env, SIGNATURE: signaturePath, ROOT: root },
  });
  return { result, root, signaturePath };
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "tc-recovery-signatures-"));
  const src = join(root, "src");
  const dst = join(root, "dst");
  const diffs = join(root, "diffs");
  mkdirSync(src);
  mkdirSync(dst);
  mkdirSync(diffs);
  for (const section of sections) {
    const content = `${section}|hash-only\n`;
    writeFileSync(join(src, `${section}.txt`), content);
    writeFileSync(join(dst, `${section}.txt`), content);
  }
  return { root, src, dst, diffs };
}

function runComparison(paths, after = ":") {
  const script = `
set -Eeuo pipefail
IFS=$'\\n\\t'
${helperSource}
set +e
compare_signature_sections "$SRC" "$DST" "$DIFFS"
COMPARE_RC=$?
set -e
${after}
printf 'COMPARE_RC=%s\\n' "$COMPARE_RC"
printf 'SECTIONS_EXECUTED=%s\\n' "$SECTIONS_EXECUTED"
printf 'DUPLICATE_SECTIONS=%s\\n' "$DUPLICATE_SECTIONS"
printf 'MISSING_SECTIONS=%s\\n' "$MISSING_SECTIONS"
printf 'STRUCTURE=%s\\n' "$STRUCTURE_RESTORE_RESULT"
printf 'FUNCTIONS=%s\\n' "$FUNCTIONS_RESTORE_RESULT"
printf 'POLICIES=%s\\n' "$POLICIES_RESTORE_RESULT"
printf 'RLS=%s\\n' "$RLS_RESTORE_RESULT"
printf 'ACL=%s\\n' "$ACL_RESTORE_RESULT"
printf 'DATA=%s\\n' "$DATA_RESTORE_RESULT"
printf 'LEDGER=%s\\n' "$LEDGER_RESTORE_RESULT"
printf 'STORAGE=%s\\n' "$STORAGE_RESTORE_RESULT"
printf 'OWNERSHIP=%s\\n' "$OWNERSHIP_RESTORE_RESULT"
`;
  return spawnSync("/bin/bash", ["-c", script], {
    encoding: "utf8",
    env: {
      ...process.env,
      SRC: paths.src,
      DST: paths.dst,
      DIFFS: paths.diffs,
    },
  });
}

function fields(stdout) {
  return Object.fromEntries(
    stdout.trim().split("\n").map((line) => {
      const at = line.indexOf("=");
      return [line.slice(0, at), line.slice(at + 1)];
    }),
  );
}

test("IFS sin espacio no afecta el orden ni concatena las ocho secciones", () => {
  const paths = fixture();
  try {
    const result = runComparison(paths);
    assert.equal(result.status, 0, result.stderr);
    const got = fields(result.stdout);
    assert.equal(got.COMPARE_RC, "0");
    assert.equal(got.SECTIONS_EXECUTED, expectedOrder);
    assert.equal(got.DUPLICATE_SECTIONS, "NONE");
    assert.equal(got.MISSING_SECTIONS, "NONE");
    for (const section of sections) assert.equal(got[section], "PASS", section);
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test("una diferencia artificial produce DIFF_FOUND sin fallback RLS o ACL", () => {
  const paths = fixture();
  try {
    writeFileSync(join(paths.dst, "POLICIES.txt"), "artificial-difference\n");
    writeFileSync(join(paths.dst, "ACL.txt"), "another-artificial-difference\n");
    const result = runComparison(paths);
    assert.equal(result.status, 0, result.stderr);
    const got = fields(result.stdout);
    assert.equal(got.COMPARE_RC, "1");
    assert.equal(got.POLICIES, "DIFF_FOUND");
    assert.equal(got.RLS, "DIFF_FOUND");
    assert.equal(got.ACL, "DIFF_FOUND");
    assert.equal(got.STRUCTURE, "PASS");
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test("una firma ausente produce FAIL cerrado y SCORABLE queda prohibido", () => {
  const paths = fixture();
  try {
    unlinkSync(join(paths.src, "STORAGE.txt"));
    const result = runComparison(
      paths,
      'set +e; signature_sections_all_pass; SCORABLE_RC=$?; set -e; printf "SCORABLE_RC=%s\\n" "$SCORABLE_RC"',
    );
    assert.equal(result.status, 0, result.stderr);
    const got = fields(result.stdout);
    assert.equal(got.COMPARE_RC, "1");
    assert.equal(got.STORAGE, "FAIL");
    assert.equal(got.MISSING_SECTIONS, "STORAGE");
    assert.equal(got.SCORABLE_RC, "1");
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test("orden fisico real del productor y otra permutacion valida pasan", () => {
  for (const [label, content] of [
    ["producer", signature()],
    ["permutation", signature([...physicalProducerOrder].reverse())],
  ]) {
    const { result, root } = validateSignature(content);
    try {
      assert.equal(result.status, 0, `${label}: ${result.stderr}`);
      assert.equal(fields(result.stdout).RC, "0", label);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("SECTION=END es terminador y no crea una novena seccion comparable", () => {
  const { result, root } = validateSignature(
    signature(),
    'mkdir "$ROOT/split"; split_signature "$SIGNATURE" "$ROOT/split"; printf "SPLIT_COUNT=%s\\n" "$(find "$ROOT/split" -type f | wc -l | tr -d "[:space:]")"; if [[ -e "$ROOT/split/END.txt" ]]; then echo END_FILE=YES; else echo END_FILE=NO; fi',
  );
  try {
    assert.equal(result.status, 0, result.stderr);
    const got = fields(result.stdout);
    assert.equal(got.RC, "0");
    assert.equal(got.SPLIT_COUNT, "8");
    assert.equal(got.END_FILE, "NO");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("firmas corruptas fallan cerrado sin depender del orden fisico", () => {
  const valid = signature();
  for (const [label, content] of [
    ["end-missing", valid.replace("SECTION=END\n", "")],
    ["end-duplicate", valid.replace("SECTION=END\n", "SECTION=END\nSECTION=END\n")],
    ["section-duplicate", valid.replace("SECTION=ACL\n", "SECTION=ACL\nSECTION=ACL\n")],
    ["section-missing", valid.replace("SECTION=DATA\nDATA|hash-only\n", "")],
    ["section-unknown", valid.replace("SECTION=DATA\n", "SECTION=UNKNOWN\n")],
    ["complete-missing", valid.replace("RECOVERY_SIGNATURE_COMPLETE=YES\n", "")],
    ["complete-duplicate", valid.replace(
      "RECOVERY_SIGNATURE_COMPLETE=YES\n",
      "RECOVERY_SIGNATURE_COMPLETE=YES\nRECOVERY_SIGNATURE_COMPLETE=YES\n",
    )],
    ["ifs-concatenated-name", valid.replace(
      "SECTION=STRUCTURE\nSTRUCTURE|hash-only\nSECTION=FUNCTIONS",
      "SECTION=STRUCTUREFUNCTIONS",
    )],
    ["section-after-end", valid.replace(
      "SECTION=END\n",
      "SECTION=END\nSECTION=STRUCTURE\n",
    )],
    ["content-after-complete", `${valid}unexpected\n`],
  ]) {
    const { result, root } = validateSignature(content);
    try {
      assert.equal(result.status, 0, `${label}: ${result.stderr}`);
      assert.equal(fields(result.stdout).RC, "1", label);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("ocho PASS permiten el gate de secciones y no filtran valores sensibles", () => {
  const paths = fixture();
  const sensitive = "postgresql://secret-token@example.invalid/private";
  try {
    writeFileSync(join(paths.src, "DATA.txt"), `${sensitive}\n`);
    writeFileSync(join(paths.dst, "DATA.txt"), `${sensitive}\n`);
    const result = runComparison(
      paths,
      'set +e; signature_sections_all_pass; SCORABLE_RC=$?; set -e; printf "SCORABLE_RC=%s\\n" "$SCORABLE_RC"',
    );
    assert.equal(result.status, 0, result.stderr);
    const got = fields(result.stdout);
    assert.equal(got.SCORABLE_RC, "0");
    assert.doesNotMatch(result.stdout, /secret-token|postgresql:\/\//);
    assert.doesNotMatch(result.stderr, /secret-token|postgresql:\/\//);
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test("teardown sigue siendo obligatorio en abort y señales", () => {
  for (const functionName of ["abort", "on_signal"]) {
    const start = runner.indexOf(`${functionName}() {`);
    const end = runner.indexOf("\n}", start);
    assert.notEqual(start, -1, `falta ${functionName}`);
    assert.notEqual(end, -1, `cierre de ${functionName}`);
    const body = runner.slice(start, end);
    assert.match(body, /teardown_stack/, `${functionName} debe ejecutar teardown`);
    assert.match(body, /SCORABLE="NO"/, `${functionName} debe impedir SCORABLE`);
  }
});
