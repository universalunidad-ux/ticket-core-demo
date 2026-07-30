#!/usr/bin/env node

import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CANONICAL_FUNCTIONS = Object.freeze([
  "support-submit-secure",
  "estado-ticket-ts",
  "estado-ticket-responder-ts",
  "ticket-escalar-admin",
]);

const HERE = resolve(fileURLToPath(new URL(".", import.meta.url)));
const REPO = resolve(HERE, "..", "..");
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

function required(name) {
  const value = String(process.env[name] || "");
  if (!value) throw new Error(`E_ENV_REQUIRED_${name}`);
  return value;
}

function localUrl(value) {
  const url = new URL(value);
  if (
    url.protocol !== "http:"
    || url.username
    || url.password
    || !LOCAL_HOSTS.has(url.hostname.replace(/^\[|\]$/g, ""))
  ) throw new Error("E_REMOTE_SUPABASE_DENIED");
  return url.href.replace(/\/+$/, "");
}

export function parseArgs(argv) {
  const args = { runtimeDir: "", evidenceDir: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--runtime-dir") args.runtimeDir = resolve(argv[++index] || "");
    else if (value === "--evidence-dir") args.evidenceDir = resolve(argv[++index] || "");
    else throw new Error(`E_ARGUMENT_INVALID:${value}`);
  }
  if (!args.runtimeDir || !args.evidenceDir) throw new Error("E_ARGUMENT_REQUIRED");
  const runtimePrefix = resolve(REPO, "tools/local-db") + "/";
  if (!args.runtimeDir.startsWith(runtimePrefix)) throw new Error("E_RUNTIME_SCOPE");
  return args;
}

function linkExactFunctions(runtimeDir) {
  const targetDir = join(runtimeDir, "supabase", "functions");
  if (existsSync(targetDir)) throw new Error("E_RUNTIME_FUNCTION_DIR_PREEXISTS");
  mkdirSync(targetDir, { recursive: false });
  const names = ["_shared", ...CANONICAL_FUNCTIONS];
  for (const name of names) {
    const source = join(REPO, "supabase", "functions", name);
    if (!existsSync(source)) throw new Error(`E_FUNCTION_SOURCE_MISSING:${name}`);
    const target = join(targetDir, name);
    symlinkSync(source, target, "dir");
    if (!lstatSync(target).isSymbolicLink() || resolve(targetDir, readlinkSync(target)) !== source) {
      throw new Error(`E_FUNCTION_LINK_MISMATCH:${name}`);
    }
  }
  return targetDir;
}

async function waitReady(apiUrl, anonKey, child) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`E_EDGE_EXITED:${child.exitCode}`);
    let ready = 0;
    for (const name of CANONICAL_FUNCTIONS) {
      try {
        const response = await fetch(`${apiUrl}/functions/v1/${name}`, {
          headers: { apikey: anonKey },
          signal: AbortSignal.timeout(2_000),
        });
        if (response.status !== 404 && response.status < 500) ready += 1;
      } catch {
        // Bounded retry while the owned child starts.
      }
    }
    if (ready === CANONICAL_FUNCTIONS.length) return;
    await new Promise(resolvePromise => setTimeout(resolvePromise, 500));
  }
  throw new Error("E_EDGE_READINESS_TIMEOUT");
}

async function main() {
  const { runtimeDir, evidenceDir } = parseArgs(process.argv.slice(2));
  const apiUrl = localUrl(required("LOCAL_SUPABASE_URL"));
  const anonKey = required("LOCAL_SUPABASE_ANON_KEY");
  const serviceRole = required("LOCAL_SUPABASE_SERVICE_ROLE_KEY");
  mkdirSync(evidenceDir, { recursive: true });
  linkExactFunctions(runtimeDir);

  const envPath = join(runtimeDir, "q2-edge.env");
  writeFileSync(
    envPath,
    [
      `SUPABASE_URL=${apiUrl}`,
      `SUPABASE_ANON_KEY=${anonKey}`,
      `SUPABASE_SERVICE_ROLE_KEY=${serviceRole}`,
      `CORS_ALLOWED_ORIGINS=${apiUrl}`,
      "ENVIRONMENT=local",
      "REQUIRE_TURNSTILE=false",
      "",
    ].join("\n"),
    { encoding: "utf8", mode: 0o600 },
  );
  chmodSync(envPath, 0o600);

  const logPath = join(evidenceDir, "edge-runtime.log");
  const logHandle = await import("node:fs").then(fs =>
    fs.openSync(logPath, "a", 0o600)
  );
  const child = spawn(
    "supabase",
    [
      "functions",
      "serve",
      "--workdir",
      runtimeDir,
      "--env-file",
      envPath,
      "--no-verify-jwt",
    ],
    { cwd: REPO, env: process.env, stdio: ["ignore", logHandle, logHandle] },
  );
  const exitPromise = new Promise(resolvePromise => {
    child.once("exit", (code, signal) => resolvePromise(code ?? (signal ? 128 : 1)));
  });

  let stopping = false;
  const stop = signal => {
    if (stopping) return;
    stopping = true;
    if (child.exitCode === null) child.kill(signal);
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));

  writeFileSync(join(evidenceDir, "edge-runtime.pid"), `${child.pid}\n`, "utf8");
  await waitReady(apiUrl, anonKey, child);
  process.stdout.write(`EDGE_RUNTIME_READY=PASS\nEDGE_FUNCTION_COUNT=${CANONICAL_FUNCTIONS.length}\nEDGE_RUNTIME_PID=${child.pid}\n`);

  const exitCode = await exitPromise;
  if (!stopping && exitCode !== 0) throw new Error(`E_EDGE_RUNTIME_EXIT:${exitCode}`);
}

main().catch(error => {
  process.stderr.write(`EDGE_RUNTIME_READY=FAIL\nEDGE_RUNTIME_ERROR=${String(error?.message || error).replace(/[\r\n]/g, " ")}\n`);
  process.exitCode = 5;
});
