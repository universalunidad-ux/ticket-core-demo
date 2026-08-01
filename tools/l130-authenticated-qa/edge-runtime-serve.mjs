#!/usr/bin/env node

import { spawn } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
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

// Minimal-closure materialisation of local modules imported from outside
// supabase/functions. The Edge runtime builds its module graph exclusively
// inside the temporary workdir, so every reachable local module must exist
// there at the exact same repository-relative path the import expects.
export const DEPENDENCY_SOURCE_EXTENSIONS = Object.freeze([
  ".ts",
  ".tsx",
  ".mts",
  ".js",
  ".mjs",
  ".json",
]);
export const MAX_EXTERNAL_DEPENDENCIES = 64;
const EXCLUDED_DEPENDENCY_PATH = /(^|\/)(\.git|node_modules|\.env)(\/|$)/i;
const EXCLUDED_DEPENDENCY_FILE = /\.(env|key|pem|p12|pfx|crt|pgpass|secret)$/i;

function stripSourceComments(source) {
  let out = "";
  let mode = "code";
  let quote = "";
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];
    if (mode === "code") {
      if (char === "/" && next === "*") { mode = "block"; i += 1; continue; }
      if (char === "/" && next === "/") { mode = "line"; i += 1; continue; }
      if (char === '"' || char === "'" || char === "`") { mode = "string"; quote = char; }
      out += char;
      continue;
    }
    if (mode === "string") {
      out += char;
      if (char === "\\") { out += next ?? ""; i += 1; continue; }
      if (char === quote) { mode = "code"; quote = ""; }
      continue;
    }
    if (mode === "line") {
      if (char === "\n") { mode = "code"; out += char; }
      continue;
    }
    if (mode === "block") {
      if (char === "*" && next === "/") { mode = "code"; i += 1; continue; }
      if (char === "\n") out += char;
    }
  }
  return out;
}

export function extractRelativeSpecifiers(source) {
  const code = stripSourceComments(source);
  const found = new Set();
  const patterns = [
    /\bfrom\s*(['"])(\.[^'"]*)\1/g,
    /\bimport\s*(['"])(\.[^'"]*)\1/g,
    /\bimport\s*\(\s*(['"])(\.[^'"]*)\1\s*\)/g,
    /\brequire\s*\(\s*(['"])(\.[^'"]*)\1\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) found.add(match[2]);
  }
  return [...found];
}

function insideDir(candidate, root) {
  return candidate === root || candidate.startsWith(root + sep);
}

function listSourceFiles(root) {
  const files = [];
  const visit = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (DEPENDENCY_SOURCE_EXTENSIONS.some(ext => entry.name.endsWith(ext))) files.push(path);
    }
  };
  visit(root);
  return files;
}

// Pure computation: repository-relative paths of every local module reachable
// from supabase/functions that lives outside supabase/functions.
export function collectExternalDependencyClosure(repoRoot = REPO) {
  const functionsRoot = join(repoRoot, "supabase", "functions");
  const queue = listSourceFiles(functionsRoot).map(path => ({ path, seed: true }));
  const externals = new Map();
  const seen = new Set(queue.map(item => item.path));

  while (queue.length > 0) {
    const { path } = queue.shift();
    const source = readFileSync(path, "utf8");
    for (const specifier of extractRelativeSpecifiers(source)) {
      const target = resolve(dirname(path), specifier);
      if (insideDir(target, functionsRoot)) continue;
      if (!insideDir(target, repoRoot)) {
        throw new Error(`E_RUNTIME_DEPENDENCY_ESCAPE:${specifier}`);
      }
      const rel = relative(repoRoot, target);
      if (EXCLUDED_DEPENDENCY_PATH.test(rel) || EXCLUDED_DEPENDENCY_FILE.test(rel)) {
        throw new Error(`E_RUNTIME_DEPENDENCY_FORBIDDEN:${rel}`);
      }
      if (!DEPENDENCY_SOURCE_EXTENSIONS.some(ext => rel.endsWith(ext))) {
        throw new Error(`E_RUNTIME_DEPENDENCY_EXTENSION:${rel}`);
      }
      if (!existsSync(target) || lstatSync(target).isSymbolicLink() || !statSync(target).isFile()) {
        throw new Error(`E_RUNTIME_DEPENDENCY_UNRESOLVED:${rel}`);
      }
      if (!externals.has(rel)) externals.set(rel, target);
      if (!seen.has(target)) { seen.add(target); queue.push({ path: target, seed: false }); }
    }
  }

  if (externals.size > MAX_EXTERNAL_DEPENDENCIES) {
    throw new Error(`E_RUNTIME_DEPENDENCY_FANOUT:${externals.size}`);
  }
  return [...externals.keys()].sort();
}

// Materialises the closure as regular files at identical relative paths.
export function stageLocalDependencyClosure(runtimeDir, repoRoot = REPO) {
  const staged = [];
  for (const rel of collectExternalDependencyClosure(repoRoot)) {
    const source = join(repoRoot, rel);
    const target = join(runtimeDir, rel);
    if (existsSync(target)) throw new Error(`E_RUNTIME_DEPENDENCY_PREEXISTS:${rel}`);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
    chmodSync(target, 0o600);
    if (lstatSync(target).isSymbolicLink() || !statSync(target).isFile()) {
      throw new Error(`E_RUNTIME_DEPENDENCY_NONREGULAR:${rel}`);
    }
    if (readFileSync(target, "utf8").includes(repoRoot)) {
      throw new Error(`E_RUNTIME_DEPENDENCY_ABSOLUTE_REFERENCE:${rel}`);
    }
    staged.push(rel);
  }
  return staged;
}

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

function assertRegularTree(root) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (lstatSync(path).isSymbolicLink()) throw new Error(`E_RUNTIME_FUNCTION_SYMLINK:${path}`);
    if (entry.isDirectory()) assertRegularTree(path);
    else if (!statSync(path).isFile()) throw new Error(`E_RUNTIME_FUNCTION_NONREGULAR:${path}`);
  }
}

export function stageExactFunctions(runtimeDir) {
  const targetDir = join(runtimeDir, "supabase", "functions");
  if (existsSync(targetDir)) throw new Error("E_RUNTIME_FUNCTION_DIR_PREEXISTS");
  mkdirSync(targetDir, { recursive: false });
  const names = ["_shared", ...CANONICAL_FUNCTIONS];
  for (const name of names) {
    const source = join(REPO, "supabase", "functions", name);
    if (!existsSync(source) || !lstatSync(source).isDirectory()) {
      throw new Error(`E_FUNCTION_SOURCE_MISSING:${name}`);
    }
    const target = join(targetDir, name);
    cpSync(source, target, {
      recursive: true,
      dereference: true,
      errorOnExist: true,
      force: false,
    });
    assertRegularTree(target);
    if (CANONICAL_FUNCTIONS.includes(name)) {
      const entrypoint = join(target, "index.ts");
      if (!existsSync(entrypoint) || !statSync(entrypoint).isFile()) {
        throw new Error(`E_FUNCTION_ENTRYPOINT_MISSING:${name}`);
      }
    }
  }
  stageLocalDependencyClosure(runtimeDir);
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
  stageExactFunctions(runtimeDir);

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

if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`EDGE_RUNTIME_READY=FAIL\nEDGE_RUNTIME_ERROR=${String(error?.message || error).replace(/[\r\n]/g, " ")}\n`);
    process.exitCode = 5;
  });
}
