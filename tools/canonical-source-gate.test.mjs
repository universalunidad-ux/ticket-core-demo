#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { evaluateGate } from "./canonical-source-gate.mjs";

const EXPECTED_REMOTE = "https://github.com/example/ticket-core-demo.git";
const PRIVATE_CORE = "/Users/jaziel/Documents/EXPIRITI_REPOS/ticket-core";
const results = [];

function run(root, ...args) {
  return execFileSync(args.shift(), args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function put(root, path, content = "") {
  const target = join(root, path);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, content, "utf8");
}

function baseManifest(root, base) {
  return {
    gate_version: "test-1",
    product: "ticket-core-demo",
    canonical_repo: root,
    expected_remote: EXPECTED_REMOTE,
    approved_worktree: root,
    worktree_policy: { mode: "registered_worktree_of_canonical_common_git_dir", implementation_context_only: true },
    repository_policy: {
      common_git_dir: join(root, ".git"),
      ci_checkout_allowed: true,
      head: { mode: "descendant_of_base", expected_base_head: base },
      worktree: "clean",
    },
    ci_event_policy: {
      expected_repository: "example/ticket-core-demo",
      allowed_events: ["pull_request", "push"],
      allowed_push_branches: ["main"],
      require_github_ref_context: true,
    },
    allowed_branch: {
      policy: "prefix",
      implementation_branch: "review/test",
      allowed_prefixes: ["review/", "fix/", "feat/", "chore/", "sec/", "docs/", "test/"],
      main_direct_implementation_allowed: false,
    },
    known_pr_context: { number: 6, title: "fixture" },
    excluded_projects: ["panel-expiriti", "panel-expiriti-audit-bd", "NUEVAEXPIRITI", "SUBIDA"],
    private_product_roots: [PRIVATE_CORE],
    noncanonical_patterns: ["_CHECKPOINTS", "_ANALYSIS_OUTPUTS", "_DELIVERABLES", "_WORKTREES", "logs", "*.bak", "*.tmp", "*.zip"],
    required_owners: [
      { id: "entry", responsibility: "entrypoint", path: "app/index.html" },
      { id: "script", responsibility: "runtime-script", path: "app/main.js" },
      { id: "style", responsibility: "runtime-style", path: "app/main.css" },
      { id: "gate", responsibility: "gate-owner", path: "tools/owner.mjs" },
      { id: "external-policy", responsibility: "external-resource-policy", path: "tools/external-policy.mjs" },
    ],
    required_edge_owners: [],
    externalized_owners: [],
    historical_not_active_owners: [],
    active_entrypoints: [{ path: "app/index.html", surface: "fixture", reason: "synthetic active surface" }],
    external_resource_policy_owner: { path: "tools/external-policy.mjs", symbol: "allowedExternalAssets" },
    specialized_gate_owners: ["tools/owner.mjs"],
    bootstrap_files: [],
  };
}

function fixture(mutate = () => {}) {
  const sandbox = mkdtempSync(join(tmpdir(), "canonical-gate-"));
  const root = join(sandbox, "_WORKTREES", "ticket-core-demo", "future-review");
  mkdirSync(root, { recursive: true });
  put(root, "app/index.html", '<link rel="stylesheet" href="main.css"><script src="main.js"></script>');
  put(root, "app/main.js", "export const ready = true;\n");
  put(root, "app/main.css", "body { color: #111; }\n");
  put(root, "tools/owner.mjs", "export const owner = true;\n");
  put(root, "tools/external-policy.mjs", 'export const allowedExternalAssets = new Set(["https://allowed.example/lib.js"]);\n');
  put(root, "supabase/functions/present-edge/index.ts", "export const owner = true;\n");
  run(root, "git", "init");
  run(root, "git", "config", "user.name", "Gate Test");
  run(root, "git", "config", "user.email", "gate@example.invalid");
  run(root, "git", "checkout", "-b", "review/test");
  run(root, "git", "remote", "add", "origin", EXPECTED_REMOTE);
  run(root, "git", "add", ".");
  run(root, "git", "commit", "-m", "fixture base");
  const base = run(root, "git", "rev-parse", "HEAD");
  const manifest = baseManifest(root, base);
  let evaluationRoot = root, evaluationEnv = {}, afterCommit = () => {};
  mutate({
    root,
    manifest,
    put: (path, content) => put(root, path, content),
    setEvaluationRoot: (path) => { evaluationRoot = path; },
    setEvaluationEnv: (value) => { evaluationEnv = value; },
    setAfterCommit: (value) => { afterCommit = value; },
  });
  put(root, "tools/canonical-source.json", JSON.stringify(manifest, null, 2) + "\n");
  run(root, "git", "add", ".");
  run(root, "git", "commit", "-m", "fixture case");
  afterCommit({ root });
  return { sandbox, root, evaluationRoot, evaluationEnv, manifestPath: join(root, "tools/canonical-source.json") };
}

function test(name, expected, mutate, expectedCode = "") {
  const fx = fixture(mutate);
  try {
    const result = evaluateGate({ root: fx.evaluationRoot, manifestPath: fx.manifestPath, env: fx.evaluationEnv });
    assert.equal(result.ok, expected, `${name}: ${result.failures.map((x) => x.code).join(",")}`);
    if (!expected && expectedCode) assert.ok(result.failures.some((x) => x.code === expectedCode), `${name}: falta ${expectedCode}`);
    results.push({ name, kind: expected ? "positive" : "negative", pass: true });
  } finally {
    rmSync(fx.sandbox, { recursive: true, force: true });
  }
}

test("01 repo correcto", true);
test("02 repo incorrecto", false, ({ root, manifest }) => { manifest.canonical_repo = join(root, "wrong"); }, "CANONICAL_COMMON_GIT_DIR_MISMATCH");
test("03 remote incorrecto", false, ({ manifest }) => { manifest.expected_remote = "https://github.com/example/wrong.git"; }, "REMOTE_MISMATCH");
test("04 branch incorrecta", false, ({ manifest }) => { manifest.allowed_branch.allowed_prefixes = ["release/"]; }, "BRANCH_MISMATCH");
test("05 worktree incorrecto", false, ({ root, setEvaluationRoot }) => { setEvaluationRoot(join(root, "app")); }, "REPO_ROOT_MISMATCH");
test("06 HTML referencia ausente", false, ({ put }) => { put("app/index.html", '<script src="missing.js"></script>'); }, "HTML_ACTIVE_REF_MISSING");
test("07 recurso externo allowlisted", true, ({ put }) => { put("app/index.html", '<script src="https://allowed.example/lib.js"></script>'); });
test("08 recurso externo no permitido", false, ({ put }) => { put("app/index.html", '<script src="https://blocked.example/lib.js"></script>'); }, "EXTERNAL_RESOURCE_NOT_ALLOWED");
test("09 owner activo duplicado", false, ({ manifest, put }) => {
  put("app/index.html", '<script src="main.js"></script><script src="main-duplicate.js"></script>');
  put("app/main-duplicate.js", "export const duplicate = true;\n");
  manifest.required_owners.push({ id: "script-duplicate", responsibility: "runtime-script", path: "app/main-duplicate.js" });
}, "DUPLICATE_ACTIVE_OWNER");
test("10 backup como fuente activa", false, ({ put }) => { put("app/index.html", '<script src="backup.js.bak"></script>'); put("app/backup.js.bak", "void 0;\n"); }, "ACTIVE_NONCANONICAL_SOURCE");
test("11 Edge externalizada", true, ({ manifest, put }) => { put("app/main.js", 'client.functions.invoke("external-edge");\n'); manifest.externalized_owners.push({ name: "external-edge", type: "edge-function", classification: "EXTERNALIZED_EXPLICIT", caller: "app/main.js", contract_owner: "tools/canonical-source.json", status: "ACTIVE_EXTERNAL_DEPENDENCY", reason: "fixture allowlist" }); });
test("12 Edge activa ausente", false, ({ put }) => { put("app/main.js", 'client.functions.invoke("missing-edge");\n'); }, "EDGE_OWNER_MISSING");
test("13 producto privado usado como Demo", false, ({ put }) => { put("app/index.html", `<script src="file://${PRIVATE_CORE}/app/main.js"></script>`); }, "PRIVATE_PRODUCT_AS_DEMO");
test("14 analysis usado como fuente", false, ({ put }) => { put("app/index.html", '<script src="../_ANALYSIS_OUTPUTS/generated.js"></script>'); put("_ANALYSIS_OUTPUTS/generated.js", "void 0;\n"); }, "ACTIVE_NONCANONICAL_SOURCE");
test("15 configuración válida completa", true, ({ manifest, put }) => {
  put("app/index.html", '<link rel="stylesheet" href="main.css"><script src="main.js"></script><script src="https://allowed.example/lib.js"></script>');
  put("app/main.js", 'client.functions.invoke("present-edge"); client.functions.invoke("external-edge");\n');
  manifest.required_edge_owners.push({ name: "present-edge", classification: "REQUIRED_LOCAL", path: "supabase/functions/present-edge/index.ts", caller: "app/main.js" });
  manifest.externalized_owners.push({ name: "external-edge", type: "edge-function", classification: "EXTERNALIZED_EXPLICIT", caller: "app/main.js", contract_owner: "tools/canonical-source.json", status: "ACTIVE_EXTERNAL_DEPENDENCY", reason: "fixture allowlist" });
});

test("16 descendiente de base autorizado", true);
test("17 base incorrecta", false, ({ manifest }) => { manifest.repository_policy.head.expected_base_head = "0000000000000000000000000000000000000001"; }, "HEAD_NOT_DESCENDANT_OF_BASE");
test("18 worktree futuro no atado al path de implementación", true, ({ root, manifest }) => { manifest.approved_worktree = join(root, "previous-approved-context"); });

test("19 branch fix permitida", true, ({ setAfterCommit }) => { setAfterCommit(({ root }) => run(root, "git", "branch", "-m", "fix/test")); });
test("20 branch feat permitida", true, ({ setAfterCommit }) => { setAfterCommit(({ root }) => run(root, "git", "branch", "-m", "feat/test")); });
test("21 branch arbitraria rechazada", false, ({ setAfterCommit }) => { setAfterCommit(({ root }) => run(root, "git", "branch", "-m", "wip/test")); }, "BRANCH_MISMATCH");
test("22 main directa rechazada", false, ({ setAfterCommit }) => { setAfterCommit(({ root }) => run(root, "git", "branch", "-m", "main")); }, "BRANCH_MISMATCH");
test("23 branch permitida con ancestry inválida", false, ({ manifest, setAfterCommit }) => {
  manifest.repository_policy.head.expected_base_head = "0000000000000000000000000000000000000002";
  setAfterCommit(({ root }) => run(root, "git", "branch", "-m", "fix/test"));
}, "HEAD_NOT_DESCENDANT_OF_BASE");
test("24 detached local rechazado", false, ({ setAfterCommit }) => { setAfterCommit(({ root }) => run(root, "git", "checkout", "--detach")); }, "DETACHED_HEAD");

const validCi = {
  CI: "true",
  GITHUB_ACTIONS: "true",
  GITHUB_EVENT_NAME: "pull_request",
  GITHUB_REPOSITORY: "example/ticket-core-demo",
  GITHUB_HEAD_REF: "fix/test",
  GITHUB_REF: "refs/pull/6/merge",
};
test("25 CI detached descendiente válido", true, ({ setEvaluationEnv, setAfterCommit }) => {
  setEvaluationEnv(validCi);
  setAfterCommit(({ root }) => run(root, "git", "checkout", "--detach"));
});
test("26 CI detached ancestry inválida", false, ({ manifest, setEvaluationEnv, setAfterCommit }) => {
  manifest.repository_policy.head.expected_base_head = "0000000000000000000000000000000000000003";
  setEvaluationEnv(validCi);
  setAfterCommit(({ root }) => run(root, "git", "checkout", "--detach"));
}, "HEAD_NOT_DESCENDANT_OF_BASE");
test("27 CI detached remote incorrecto", false, ({ manifest, setEvaluationEnv, setAfterCommit }) => {
  manifest.expected_remote = "https://github.com/example/wrong.git";
  setEvaluationEnv(validCi);
  setAfterCommit(({ root }) => run(root, "git", "checkout", "--detach"));
}, "REMOTE_MISMATCH");
test("28 CI no omite owner ausente", false, ({ manifest, setEvaluationEnv, setAfterCommit }) => {
  manifest.required_owners[1].path = "app/missing-owner.js";
  setEvaluationEnv(validCi);
  setAfterCommit(({ root }) => run(root, "git", "checkout", "--detach"));
}, "OWNER_MISSING");

test("29 Edge dormida tracked no es runtime", true, ({ put }) => { put("app/dormant.js", 'client.functions.invoke("dormant-edge");\n'); });
test("30 Edge dormida enlazada exige clasificación", false, ({ put }) => {
  put("app/dormant.js", 'client.functions.invoke("dormant-edge");\n');
  put("app/index.html", '<script src="main.js"></script><script src="dormant.js"></script>');
}, "EDGE_OWNER_MISSING");
test("31 Edge externalizada alcanzable", true, ({ manifest, put }) => {
  put("app/dormant.js", 'client.functions.invoke("dormant-edge");\n');
  put("app/index.html", '<script src="main.js"></script><script src="dormant.js"></script>');
  manifest.externalized_owners.push({ name: "dormant-edge", type: "edge-function", classification: "EXTERNALIZED_EXPLICIT", caller: "app/dormant.js", contract_owner: "tools/canonical-source.json", status: "ACTIVE_EXTERNAL_DEPENDENCY", reason: "fixture runtime" });
});
test("32 owner histórico reactivado falla", false, ({ manifest, put }) => {
  put("app/dormant.js", 'client.functions.invoke("historical-edge");\n');
  put("app/index.html", '<script src="main.js"></script><script src="dormant.js"></script>');
  manifest.historical_not_active_owners.push({ name: "historical-edge", classification: "HISTORICAL_NOT_ACTIVE", reason: "fixture dormant contract" });
}, "HISTORICAL_OWNER_ACTIVE");
test("33 ruta física _WORKTREES legítima", true);
test("34 referencia runtime a _WORKTREES rechazada", false, ({ put }) => {
  put("app/index.html", '<script src="../../_WORKTREES/other/donor.js"></script>');
}, "ACTIVE_NONCANONICAL_SOURCE");

const negative = results.filter((result) => result.kind === "negative");
console.log(`CANONICAL_SOURCE_TESTS: PASS (${results.length}/${results.length})`);
console.log(`NEGATIVE_TESTS_PASS=${negative.length}`);
for (const result of results) console.log(`PASS\t${result.name}`);
