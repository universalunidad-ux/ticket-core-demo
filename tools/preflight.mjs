#!/usr/bin/env node
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { evaluateGate } from "./canonical-source-gate.mjs";

const MODES = new Set(["fast", "test", "full", "pre-commit", "ci"]);

function run(executable, args, { cwd, forward = true, allowFailure = false } = {}) {
  const result = spawnSync(executable, args, { cwd, encoding: "utf8" });
  if (forward) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }
  if (!allowFailure && result.status !== 0) throw new Error(`COMMAND_FAILED:${executable}:${args[0] || ""}`);
  return result;
}

function gitRoot(start) {
  const result = run("git", ["-C", resolve(start || "."), "rev-parse", "--show-toplevel"], { forward: false, allowFailure: true });
  if (result.status !== 0) throw new Error("NOT_A_GIT_REPOSITORY");
  return resolve(result.stdout.trim());
}

function assertGate(options) {
  const result = evaluateGate(options);
  if (!result.ok) {
    const codes = [...new Set(result.failures.map((failure) => failure.code))].join(",");
    throw new Error(`CANONICAL_GATE:${codes || "UNKNOWN"}`);
  }
  console.log(`CANONICAL_SOURCE_GATE=PASS`);
  console.log(`CANONICAL_HEAD=${result.metadata.head}`);
  console.log(`CANONICAL_BRANCH=${result.metadata.branch}`);
  console.log(`ACTIVE_RUNTIME_FILES=${result.metadata.activeRuntimeFiles}`);
  return result;
}

function runCanonicalTests(root) {
  run(process.execPath, [join(root, "tools/canonical-source-gate.test.mjs")], { cwd: root });
}

function runAutomationTests(root) {
  run(process.execPath, [join(root, "tools/preflight.test.mjs")], { cwd: root });
}

function runSpecializedGates(root) {
  const commands = [
    [process.execPath, [join(root, "tools/frontend-gates.mjs"), root]],
    [process.execPath, [join(root, "tools/final-fix-gates.mjs")]],
    [process.execPath, [join(root, "tools/turnstile-deploy-gate.mjs"), root]],
    ["bash", [join(root, "tools/secret-gate.sh"), root]],
  ];
  for (const [executable, args] of commands) run(executable, args, { cwd: root });
}

function validateIndexCandidate(root, env) {
  const candidate = mkdtempSync(join(tmpdir(), "canonical-index-"));
  try {
    const checkout = run("git", ["-C", root, "checkout-index", "--all", `--prefix=${candidate}/`], { forward: false, allowFailure: true });
    if (checkout.status !== 0) throw new Error("INDEX_MATERIALIZATION_FAILED");
    const manifestPath = join(candidate, "tools/canonical-source.json");
    if (!existsSync(manifestPath)) throw new Error("INDEX_MANIFEST_MISSING");
    assertGate({ root, sourceRoot: candidate, manifestPath, mode: "pre-commit", env });

    const diffCheck = run("git", ["-C", root, "diff", "--cached", "--check"], { forward: true, allowFailure: true });
    if (diffCheck.status !== 0) throw new Error("CACHED_DIFF_CHECK_FAILED");

    const secretGate = join(candidate, "tools/secret-gate.sh");
    if (!existsSync(secretGate)) throw new Error("INDEX_SECRET_GATE_MISSING");
    run("bash", [secretGate, candidate], { cwd: candidate });
    console.log("PRECOMMIT_INDEX_AWARE=YES");
    console.log("INDEX_CANDIDATE_VALID=YES");
  } finally {
    rmSync(candidate, { recursive: true, force: true });
  }
}

export function executePreflight({ root: rawRoot = ".", mode = "fast", env = process.env } = {}) {
  if (!MODES.has(mode)) throw new Error(`MODE_INVALID:${mode}`);
  const root = gitRoot(rawRoot);
  if (mode === "pre-commit") {
    validateIndexCandidate(root, env);
  } else {
    assertGate({ root, mode: mode === "ci" ? "ci" : "normal", env });
    if (mode === "test" || mode === "full" || mode === "ci") runCanonicalTests(root);
    if (mode === "test" || mode === "ci") runAutomationTests(root);
    if (mode === "full") {
      runAutomationTests(root);
      runSpecializedGates(root);
      const diffCheck = run("git", ["-C", root, "diff", "--check"], { allowFailure: true });
      if (diffCheck.status !== 0) throw new Error("DIFF_CHECK_FAILED");
    }
  }
  console.log(`PREFLIGHT_MODE=${mode}`);
  console.log("PREFLIGHT=PASS");
  console.log("SAFE_TO_EDIT=YES");
  return true;
}

function parseArgs(argv) {
  const args = { root: ".", mode: "fast" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") args.root = argv[++i];
    else if (argv[i] === "--mode") args.mode = argv[++i];
    else throw new Error(`ARGUMENT_INVALID:${argv[i]}`);
  }
  return args;
}

function main() {
  try {
    executePreflight(parseArgs(process.argv.slice(2)));
  } catch (error) {
    const reason = String(error?.message || "UNKNOWN").replace(/[\r\n\t]+/g, " ");
    console.error("PREFLIGHT=FAIL");
    console.error("SAFE_TO_EDIT=NO");
    console.error(`STOP_REASON=${reason}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) main();
