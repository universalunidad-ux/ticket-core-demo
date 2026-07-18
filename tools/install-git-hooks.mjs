#!/usr/bin/env node
import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

function git(root, args, allowFailure = false) {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  if (!allowFailure && result.status !== 0) throw new Error(`GIT_FAILED:${args[0]}`);
  return { status: result.status, stdout: (result.stdout || "").trim() };
}

export function inspectHookState(rawRoot = ".") {
  const root = resolve(git(resolve(rawRoot), ["rev-parse", "--show-toplevel"]).stdout);
  const common = git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).stdout;
  const configured = git(root, ["config", "--local", "--get-all", "core.hooksPath"], true).stdout.split("\n").filter(Boolean);
  const hook = join(root, ".githooks/pre-commit");
  const defaultHooks = existsSync(join(common, "hooks"))
    ? readdirSync(join(common, "hooks")).filter((name) => !name.endsWith(".sample") && statSync(join(common, "hooks", name)).isFile())
    : [];
  return { root, common, configured, hook, defaultHooks };
}

export function installHooks(rawRoot = ".") {
  const state = inspectHookState(rawRoot);
  if (state.configured.some((value) => value !== ".githooks")) throw new Error(`HOOKS_PATH_CONFLICT:${state.configured.join(",")}`);
  if (!state.configured.length && state.defaultHooks.length) throw new Error(`EXISTING_HOOK_CONFLICT:${state.defaultHooks.join(",")}`);
  if (!existsSync(state.hook)) throw new Error("VERSIONED_PRECOMMIT_MISSING");
  if ((statSync(state.hook).mode & 0o111) === 0) throw new Error("VERSIONED_PRECOMMIT_NOT_EXECUTABLE");
  git(state.root, ["config", "--local", "core.hooksPath", ".githooks"]);
  const installed = inspectHookState(state.root);
  if (installed.configured.length !== 1 || installed.configured[0] !== ".githooks") throw new Error("HOOKS_PATH_INSTALL_FAILED");
  return installed;
}

function main() {
  try {
    const installed = installHooks(process.argv[2] || ".");
    console.log("GIT_HOOK_INSTALL=PASS");
    console.log("HOOKS_PATH=.githooks");
    console.log(`HOOK_OWNER=${installed.hook}`);
  } catch (error) {
    console.error("GIT_HOOK_INSTALL=FAIL");
    console.error(`STOP_REASON=${String(error?.message || "UNKNOWN")}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) main();
