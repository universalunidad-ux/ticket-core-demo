#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { installHooks } from "./install-git-hooks.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REMOTE = "https://github.com/example/ticket-core-demo.git";
const PRIVATE_CORE = "/Users/jaziel/Documents/EXPIRITI_REPOS/ticket-core";
const results = [];

function put(root, path, content = "") {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
}

function git(root, ...args) {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args[0]} failed`);
  return (result.stdout || "").trim();
}

function fixture() {
  const sandbox = mkdtempSync(join(tmpdir(), "preflight-test-"));
  const root = join(sandbox, "_WORKTREES", "ticket-core-demo", "future-fix");
  mkdirSync(root, { recursive: true });
  put(root, "app/index.html", '<link rel="stylesheet" href="main.css"><script src="main.js"></script>');
  put(root, "app/main.js", "export const ready = true;\n");
  put(root, "app/main.css", "body { color: #111; }\n");
  put(root, "tools/owner.mjs", "export const owner = true;\n");
  put(root, "tools/external-policy.mjs", 'export const allowedExternalAssets = new Set(["https://allowed.example/lib.js"]);\n');
  for (const path of [
    "tools/canonical-source-gate.mjs",
    "tools/preflight.mjs",
    "tools/secret-gate.sh",
    "tools/secret-gate-patterns.txt",
    "tools/secret-gate-scanner.py",
    ".githooks/pre-commit",
  ]) cpSync(join(REPO, path), join(root, path), { recursive: true });
  chmodSync(join(root, ".githooks/pre-commit"), 0o755);

  git(root, "init");
  git(root, "config", "user.name", "Preflight Test");
  git(root, "config", "user.email", "preflight@example.invalid");
  git(root, "checkout", "-b", "review/test");
  git(root, "remote", "add", "origin", REMOTE);
  git(root, "add", ".");
  git(root, "commit", "-m", "fixture base");
  const base = git(root, "rev-parse", "HEAD");
  const manifest = {
    gate_version: "automation-test",
    product: "ticket-core-demo",
    canonical_repo: root,
    expected_remote: REMOTE,
    approved_worktree: join(root, "previous-context"),
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
      { id: "gate", responsibility: "canonical-gate", path: "tools/canonical-source-gate.mjs" },
      { id: "preflight", responsibility: "preflight", path: "tools/preflight.mjs" },
      { id: "manifest", responsibility: "manifest", path: "tools/canonical-source.json" },
      { id: "policy", responsibility: "external-policy", path: "tools/external-policy.mjs" },
      { id: "hook", responsibility: "precommit-hook", path: ".githooks/pre-commit" },
    ],
    required_edge_owners: [],
    externalized_owners: [],
    historical_not_active_owners: [],
    active_entrypoints: [{ path: "app/index.html", surface: "fixture", reason: "active fixture" }],
    external_resource_policy_owner: { path: "tools/external-policy.mjs", symbol: "allowedExternalAssets" },
    specialized_gate_owners: ["tools/secret-gate.sh"],
    bootstrap_files: [],
  };
  put(root, "tools/canonical-source.json", JSON.stringify(manifest, null, 2) + "\n");
  git(root, "add", ".");
  git(root, "commit", "-m", "fixture manifest");
  return { sandbox, root };
}

function preflight(root, mode = "pre-commit") {
  return spawnSync(process.execPath, [join(root, "tools/preflight.mjs"), "--root", root, "--mode", mode], { cwd: root, encoding: "utf8" });
}

function record(name, category, expectedPass, action, expectedText = "") {
  const fx = fixture();
  try {
    const result = action(fx);
    assert.equal(result.status === 0, expectedPass, `${name}: ${result.stdout}\n${result.stderr}`);
    if (expectedText) assert.match(`${result.stdout}\n${result.stderr}`, new RegExp(expectedText));
    results.push({ name, category, pass: true });
  } finally {
    rmSync(fx.sandbox, { recursive: true, force: true });
  }
}

record("01 fast pre-edit limpio", "standard", true, ({ root }) => preflight(root, "fast"), "SAFE_TO_EDIT=YES");
record("02 candidato staged válido", "hook", true, ({ root }) => { put(root, "app/main.js", "export const ready = 2;\n"); git(root, "add", "app/main.js"); return preflight(root); }, "INDEX_CANDIDATE_VALID=YES");
record("03 staged usa analysis", "hook", false, ({ root }) => { put(root, "app/index.html", '<script src="../_ANALYSIS_OUTPUTS/generated.js"></script>'); put(root, "_ANALYSIS_OUTPUTS/generated.js", "void 0;\n"); git(root, "add", "."); return preflight(root); }, "ACTIVE_NONCANONICAL_SOURCE");
record("04 staged usa backup", "hook", false, ({ root }) => { put(root, "app/index.html", '<script src="backup.js.bak"></script>'); put(root, "app/backup.js.bak", "void 0;\n"); git(root, "add", "."); return preflight(root); }, "ACTIVE_NONCANONICAL_SOURCE");
record("05 staged referencia rota", "hook", false, ({ root }) => { put(root, "app/index.html", '<script src="missing.js"></script>'); git(root, "add", "app/index.html"); return preflight(root); }, "HTML_ACTIVE_REF_MISSING");
record("06 unstaged no sustituye candidato", "hook", true, ({ root }) => { put(root, "docs/valid.txt", "valid\n"); git(root, "add", "docs/valid.txt"); put(root, "app/index.html", '<script src="unstaged-missing.js"></script>'); return preflight(root); }, "INDEX_CANDIDATE_VALID=YES");
record("07 hook desde ruta _WORKTREES legítima", "hook", true, ({ root }) => { put(root, "app/main.js", "export const ready = 3;\n"); git(root, "add", "app/main.js"); return spawnSync(join(root, ".githooks/pre-commit"), [], { cwd: root, encoding: "utf8" }); }, "PRECOMMIT_INDEX_AWARE=YES");
record("08 producto incorrecto bloqueado", "hook", false, ({ root }) => { const path = join(root, "tools/canonical-source.json"); const manifest = JSON.parse(readFileSync(path, "utf8")); manifest.product = "ticket-core"; writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n"); git(root, "add", "tools/canonical-source.json"); return preflight(root); }, "PRODUCT_MISMATCH");
record("09 instalador seguro", "installer", true, ({ root }) => { installHooks(root); const value = git(root, "config", "--local", "--get", "core.hooksPath"); return { status: value === ".githooks" ? 0 : 1, stdout: value, stderr: "" }; });
record("10 instalador rechaza owner ajeno", "installer", false, ({ root }) => { git(root, "config", "--local", "core.hooksPath", "/tmp/foreign-hooks"); try { installHooks(root); return { status: 0, stdout: "", stderr: "" }; } catch (error) { return { status: 1, stdout: "", stderr: String(error.message) }; } }, "HOOKS_PATH_CONFLICT");

const workflow = readFileSync(join(REPO, ".github/workflows/frontend-gates.yml"), "utf8");
assert.match(workflow, /pull_request:/);
assert.match(workflow, /push:/);
assert.match(workflow, /actions\/checkout@v4/);
assert.match(workflow, /fetch-depth:\s*0/);
assert.match(workflow, /node tools\/preflight\.mjs --mode ci/);
assert.doesNotMatch(workflow, /\$\{\{\s*secrets\./);
assert.doesNotMatch(workflow, /\bsupabase\s+(?:db|functions|link|deploy)\b/i);
results.push({ name: "11 workflow CI estático", category: "ci", pass: true });

const hookTests = results.filter((result) => result.category === "hook").length;
console.log(`AUTOMATION_TESTS: PASS (${results.length}/${results.length})`);
console.log(`HOOK_TESTS_PASS=${hookTests}`);
console.log("CI_STATIC_VALIDATION_PASS=YES");
for (const result of results) console.log(`PASS\t${result.name}`);
