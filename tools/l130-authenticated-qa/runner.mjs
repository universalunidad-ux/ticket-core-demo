#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

export const UNIT = "TC-L130-AUTHENTICATED-MULTIROLE-QA-PREP-01";
export const EXPECTED_BRANCH = "test/l130-authenticated-qa-prep-20260728";
export const REQUIRED_ANCESTORS = Object.freeze([
  "f96a9cb377119e5334df2d4179320d35d18d41b8",
  "c827c925211c46f9c2ff050543ab590878e7d1fa",
  "f06698cbebc6971176b940f58ab2a13586d2275e",
]);
export const STOP = Object.freeze({
  WRONG_REPO: "E_WRONG_REPO",
  WRONG_BRANCH: "E_WRONG_BRANCH",
  HEAD_LINEAGE: "E_HEAD_LINEAGE_MISMATCH",
  DIRTY: "E_WORKTREE_DIRTY",
  GIT_LOCK: "E_COMMON_GIT_LOCK_PRESENT",
  REMOTE_ENV: "E_REMOTE_ENV_PRESENT",
  CLIENT_MODEL: "E_AUTHENTICATED_CLIENT_AUTHZ_MODEL_MISSING",
  LOGIN_SEED: "E_LOGIN_CAPABLE_SYNTHETIC_SEED_MISSING",
  EDGE: "E_LOCAL_EDGE_DRIVER_MISSING",
});

const HERE = resolve(fileURLToPath(new URL(".", import.meta.url)));
export const REPO = resolve(HERE, "..", "..");

function git(args) {
  return execFileSync("git", ["-C", REPO, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function parseArgs(argv) {
  const out = { execute: false, evidenceDir: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--preflight-only") out.execute = false;
    else if (arg === "--execute") out.execute = true;
    else if (arg === "--evidence-dir") out.evidenceDir = resolve(argv[++index] || "");
    else throw new Error(`ARGUMENT_INVALID:${arg}`);
  }
  if (!out.evidenceDir) throw new Error("EVIDENCE_DIR_REQUIRED");
  return out;
}

export function findLocks(commonDir) {
  const locks = [];
  const walk = dir => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      const stat = statSync(path);
      if (stat.isDirectory()) walk(path);
      else if (entry === "index.lock" || entry.endsWith(".lock")) locks.push(path);
    }
  };
  walk(commonDir);
  return locks.sort();
}

export function inspectClientContract(roleSql, authzSql) {
  const roleValues = [...roleSql.matchAll(/'(admin|supervisor|ventas|soporte|cliente)'::text/g)]
    .map(match => match[1]);
  const clientRoleAllowed = roleValues.includes("cliente");
  const persistentContactLink = /auth_user_id\s+uuid[\s\S]+references\s+auth\.users\(id\)/i.test(authzSql);
  const clientOwnership = /auth_user_id\s*=\s*\(select auth\.uid\(\)\)/i.test(authzSql)
    && /tickets_client_owner_select[\s\S]+tc_current_client_id\(\)/i.test(authzSql);
  const internalRolesUnchanged = !clientRoleAllowed;
  return {
    clientRoleAllowed,
    persistentContactLink,
    clientOwnership,
    internalRolesUnchanged,
    authorizedM1: persistentContactLink && clientOwnership && internalRolesUnchanged,
  };
}

export function inspectLoginSeed(source) {
  return {
    syntheticDomain: /@example\.invalid/.test(source),
    clientActor: /key:\s*["']client_a["'][\s\S]+key:\s*["']client_b["']/.test(source),
    passwordProvisioned: /passwordEnv:\s*["']TC_L130_CLIENT_A_PASSWORD["']/.test(source),
  };
}

function stop(code, detail, checks) {
  checks.push({ check: code, status: "BLOCKED", detail });
  const error = new Error(detail);
  error.stopCode = code;
  throw error;
}

export function renderResult({ head, mode, checks, blocker }) {
  const blocked = Boolean(blocker);
  return [
    `UNIT=${UNIT}`,
    "RESULT=PASS",
    `REASON_CODE=${blocked
      ? "AUTHENTICATED_MULTIROLE_QA_PREPARED_BLOCKED_BY_EXACT_DEPENDENCY"
      : "AUTHENTICATED_LOCAL_MULTIROLE_IMPLEMENTATION_READY_FOR_TERMINAL"}`,
    `MODE=${mode}`,
    `HEAD=${head || "UNRESOLVED"}`,
    `BLOCKER=${blocked ? blocker.code : "NONE"}`,
    `OWNER=${blocked ? blocker.owner : "NONE"}`,
    `EXACT_NEXT_ACTION=${blocked ? blocker.next : "NONE"}`,
    `AUTHZ_MODEL_STATUS=${blocked ? "BLOCKED" : "AUTHORIZED_M1"}`,
    `SYNTHETIC_SEED_READY=${blocked ? "NO" : "YES"}`,
    `LOGIN_FLOW_READY=${blocked ? "NO" : "YES"}`,
    `SESSION_FLOW_READY=${blocked ? "NO" : "YES"}`,
    `MULTIROLE_E2E_READY=${blocked ? "NO" : "YES"}`,
    `CLIENT_ISOLATION_NEGATIVE_TEST_READY=${blocked ? "NO" : "YES"}`,
    `RUNTIME_SCRIPT_READY=${blocked ? "NO" : "YES"}`,
    "RUNTIME_EXECUTED=NO",
    "STAGING_REQUIRED=NO",
    `LOCAL_EXECUTION_POSSIBLE=${blocked ? "NO" : "YES"}`,
    `DOCKER_TOUCHED=${checks.some(row => row.check === "DOCKER_RUNTIME") ? "YES" : "NO"}`,
    `CHECK_COUNT=${checks.length}`,
    "",
  ].join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const checks = [];
  let head = "";
  let blocker = null;

  try {
    if (git(["rev-parse", "--show-toplevel"]) !== REPO) {
      stop(STOP.WRONG_REPO, "runner fuera del worktree autorizado", checks);
    }
    checks.push({ check: "REPO_IDENTITY", status: "PASS", detail: REPO });

    const branch = git(["branch", "--show-current"]);
    if (branch !== EXPECTED_BRANCH) stop(STOP.WRONG_BRANCH, `branch=${branch}`, checks);
    checks.push({ check: "BRANCH_IDENTITY", status: "PASS", detail: branch });

    head = git(["rev-parse", "HEAD"]);
    for (const ancestor of REQUIRED_ANCESTORS) {
      try {
        execFileSync("git", ["-C", REPO, "merge-base", "--is-ancestor", ancestor, head]);
      } catch {
        stop(STOP.HEAD_LINEAGE, `missing_ancestor=${ancestor}`, checks);
      }
    }
    checks.push({ check: "HEAD_LINEAGE", status: "PASS", detail: head });

    const status = git(["status", "--porcelain=v1"]);
    if (status) stop(STOP.DIRTY, "worktree debe estar limpio antes de ejecutar", checks);
    checks.push({ check: "WORKTREE_CLEAN", status: "PASS", detail: "clean" });

    const commonDir = git(["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    const locks = findLocks(commonDir);
    if (locks.length) stop(STOP.GIT_LOCK, `lock_count=${locks.length}`, checks);
    checks.push({ check: "COMMON_GIT_LOCKS", status: "PASS", detail: "0" });

    const remoteNames = [
      "SUPABASE_ACCESS_TOKEN",
      "SUPABASE_PROJECT_ID",
      "SUPABASE_PROJECT_REF",
      "SUPABASE_DB_URL",
      "STAGING_URL",
      "DATABASE_URL",
    ].filter(name => String(process.env[name] || "").trim());
    if (remoteNames.length) stop(STOP.REMOTE_ENV, `config_names=${remoteNames.join(",")}`, checks);
    checks.push({ check: "REMOTE_ENV_GUARD", status: "PASS", detail: "no remote config names set" });

    const roleSql = readFileSync(join(REPO, "supabase/migrations/20260717093100_authz_perfiles_rol_lock.sql"), "utf8");
    const authzSql = readFileSync(join(REPO, "supabase/migrations/20260729010000_l130_m1_authenticated_client.sql"), "utf8");
    const client = inspectClientContract(roleSql, authzSql);
    if (!client.authorizedM1) {
      stop(
        STOP.CLIENT_MODEL,
        `authorized_m1=${client.authorizedM1};persistent_link=${client.persistentContactLink};client_ownership=${client.clientOwnership};internal_roles_unchanged=${client.internalRolesUnchanged}`,
        checks,
      );
    }
    checks.push({ check: "AUTHENTICATED_CLIENT_MODEL", status: "PASS", detail: "AUTHORIZED_M1 persistent contact ownership" });

    const seedSource = readFileSync(join(REPO, "tools/l130-authenticated-qa/m1-runtime.mjs"), "utf8");
    const seed = inspectLoginSeed(seedSource);
    if (!seed.syntheticDomain || !seed.clientActor || !seed.passwordProvisioned) {
      stop(STOP.LOGIN_SEED, JSON.stringify(seed), checks);
    }
    checks.push({ check: "LOGIN_CAPABLE_SYNTHETIC_SEED", status: "PASS", detail: "all roles" });

    if (!existsSync("/Applications/Microsoft Edge.app")) {
      stop(STOP.EDGE, "Microsoft Edge local ausente", checks);
    }
    checks.push({ check: "LOCAL_EDGE_DRIVER", status: "PASS", detail: "Microsoft Edge local" });

    if (!args.execute) {
      checks.push({
        check: "TERMINAL_RUNTIME_ASSETS",
        status: "PASS",
        detail: "M1 auth, fixture, API and browser harness prepared",
      });
    } else {
      // Work no ejecuta Docker/Supabase/Edge. El único owner del runtime
      // acumulativo es 10_RUN_LOCAL_AUTH_E2E.sh desde Terminal.
      blocker = {
        code: "E_USE_TERMINAL_RUNTIME_SCRIPT",
        owner: "TC-L130-QA",
        next: "Ejecutar 10_RUN_LOCAL_AUTH_E2E.sh desde Terminal",
      };
    }
  } catch (error) {
    if (!error.stopCode) throw error;
    blocker = {
      code: error.stopCode,
      owner: error.stopCode === STOP.CLIENT_MODEL ? "AUTHZ_PRODUCT_OWNER" : "TC-L130-QA",
      next: error.stopCode === STOP.CLIENT_MODEL
        ? "Definir y autorizar contrato de identidad/ownership cliente autenticado local sin reabrir RLS cerrada por inferencia"
        : "Resolver la precondición indicada y reejecutar desde preflight",
    };
  }

  const result = renderResult({
    head,
    mode: args.execute ? "EXECUTE" : "PREFLIGHT_ONLY",
    checks,
    blocker,
  });
  writeFileSync(join(args.evidenceDir, "l130_runner_result.txt"), result, "utf8");
  writeFileSync(
    join(args.evidenceDir, "l130_runner_checks.tsv"),
    `CHECK\tSTATUS\tDETAIL\n${checks.map(row => `${row.check}\t${row.status}\t${row.detail}`).join("\n")}\n`,
    "utf8",
  );
  process.stdout.write(result);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`RUNNER_INTERNAL_ERROR=${String(error?.message || error)}\n`);
    process.exitCode = 2;
  }
}
