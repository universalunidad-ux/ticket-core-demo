#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const DEFAULT_MANIFEST = "tools/canonical-source.json";

function git(root, args, allowFailure = false) {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`git ${args[0]} failed`);
  }
  return { status: result.status, stdout: (result.stdout || "").trim(), stderr: (result.stderr || "").trim() };
}

function samePath(a, b) {
  try { return realpathSync(a) === realpathSync(b); }
  catch { return resolve(a) === resolve(b); }
}

function inside(root, candidate) {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function normalizeRef(value) {
  return String(value || "").trim().split(/[?#]/, 1)[0].replaceAll("\\", "/");
}

function isNoncanonical(value, patterns) {
  const clean = normalizeRef(value);
  const parts = clean.split("/").filter(Boolean);
  return patterns.some((pattern) => {
    if (pattern.startsWith("*.")) return clean.toLowerCase().endsWith(pattern.slice(1).toLowerCase());
    return parts.some((part) => part.toLowerCase() === pattern.toLowerCase());
  });
}

function isTracked(root, path) {
  return git(root, ["ls-files", "--error-unmatch", "--", path], true).status === 0;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, required, allowed) {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return required.every((key) => Object.hasOwn(value, key)) && keys.every((key) => allowed.includes(key));
}

function changedPaths(root) {
  const values = new Set();
  for (const args of [
    ["diff", "--name-only"],
    ["diff", "--cached", "--name-only"],
    ["ls-files", "--others", "--exclude-standard"],
  ]) {
    const output = git(root, args, true).stdout;
    for (const line of output.split("\n")) if (line) values.add(line.replaceAll("\\", "/"));
  }
  return [...values].sort();
}

function htmlActiveRefs(source) {
  const refs = [];
  for (const match of source.matchAll(/<(script|link)\b[^>]*>/gi)) {
    const tag = match[1].toLowerCase();
    const text = match[0];
    const attr = (name) => text.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i"))?.[2] || "";
    if (tag === "script") {
      const src = attr("src");
      if (src) refs.push(src);
    } else {
      const rel = attr("rel").toLowerCase().split(/\s+/);
      const href = attr("href");
      if (href && (rel.includes("stylesheet") || rel.includes("modulepreload"))) refs.push(href);
    }
  }
  return refs;
}

function jsLocalRefs(source) {
  const refs = [];
  const pattern = /(?:import\s+(?:[^'";]+?\s+from\s+)?|export\s+[^'";]+?\s+from\s+|import\s*\()(["'])(\.{1,2}\/[^"']+)\1/g;
  for (const match of source.matchAll(pattern)) refs.push(match[2]);
  return refs;
}

function canonicalExternal(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return `${url.origin}${url.pathname}`;
  } catch { return null; }
}

function canonicalRemote(value) {
  return String(value || "").trim().replace(/\/+$/, "").replace(/\.git$/i, "");
}

function allowedImplementationBranch(manifest, branch) {
  if (!branch || branch === "main") return false;
  return (manifest.allowed_branch?.allowed_prefixes || []).some((prefix) => branch.startsWith(prefix));
}

function ciBranchContext(manifest, env, fail) {
  const event = env.GITHUB_EVENT_NAME || "";
  const policy = manifest.ci_event_policy || {};
  if (!policy.expected_repository || env.GITHUB_REPOSITORY !== policy.expected_repository)
    fail("CI_REPOSITORY_MISMATCH", env.GITHUB_REPOSITORY || "missing");
  if (!(policy.allowed_events || []).includes(event)) {
    fail("CI_EVENT_NOT_ALLOWED", event || "missing");
    return "";
  }
  if (event === "pull_request") {
    const headRef = env.GITHUB_HEAD_REF || "";
    if (!headRef || !allowedImplementationBranch(manifest, headRef)) fail("CI_REF_NOT_ALLOWED", headRef || "missing");
    if (policy.require_github_ref_context && !/^refs\/pull\/\d+\/(?:merge|head)$/.test(env.GITHUB_REF || ""))
      fail("CI_REF_CONTEXT_INVALID", env.GITHUB_REF || "missing");
    return headRef;
  }
  const refName = env.GITHUB_REF_NAME || String(env.GITHUB_REF || "").replace(/^refs\/heads\//, "");
  if (!(policy.allowed_push_branches || []).includes(refName)) fail("CI_PUSH_REF_NOT_ALLOWED", refName || "missing");
  if (policy.require_github_ref_context && env.GITHUB_REF !== `refs/heads/${refName}`) fail("CI_REF_CONTEXT_INVALID", env.GITHUB_REF || "missing");
  return refName;
}

function resolveLocalRef(root, owner, value) {
  const clean = normalizeRef(value);
  if (/^(?:https?:)?\/\//i.test(clean) || /^[a-z]+:/i.test(clean)) return null;
  if (clean.startsWith("/")) {
    return resolve(root, clean.replace(/^\/(?:ticket-core-demo\/)?/, ""));
  }
  return resolve(dirname(owner), decodeURIComponent(clean));
}

function staticEdgeNames(source) {
  const names = new Set();
  for (const match of source.matchAll(/\.functions\.invoke\(\s*["'`]([a-z0-9_-]+)["'`]/gi)) names.add(match[1]);
  for (const match of source.matchAll(/\/functions\/v1\/([a-z0-9_-]+)/gi)) names.add(match[1]);
  for (const match of source.matchAll(/\/functions\/v1\/\$\{([A-Za-z_$][\w$]*)\}/g)) {
    const variable = match[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const declaration = source.match(new RegExp(`\\b(?:const|let)\\s+${variable}\\s*=\\s*["'\`]([a-z0-9_-]+)["'\`]`, "i"));
    if (declaration) names.add(declaration[1]);
  }
  for (const match of source.matchAll(/\bconst\s+\w*ENDPOINT\s*=\s*`[^`]*\/([a-z0-9_-]+)`/gi)) names.add(match[1]);
  return names;
}

function activeEntrypointPath(entrypoint) {
  return typeof entrypoint === "string" ? entrypoint : entrypoint?.path;
}

function externalPolicy(sourceRoot, gitRoot, manifest, fail) {
  const owner = manifest.external_resource_policy_owner;
  if (!owner?.path || !owner?.symbol) { fail("EXTERNAL_POLICY_OWNER_INVALID", "path/symbol required"); return new Set(); }
  const file = resolve(sourceRoot, owner.path);
  if (!inside(sourceRoot, file) || !existsSync(file) || !isTracked(gitRoot, owner.path)) {
    fail("EXTERNAL_POLICY_OWNER_MISSING", owner.path);
    return new Set();
  }
  const source = readFileSync(file, "utf8");
  const symbol = owner.symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const block = source.match(new RegExp(`\\b(?:const|let)\\s+${symbol}\\s*=\\s*new Set\\(\\[([\\s\\S]*?)\\]\\)`))?.[1];
  if (!block) { fail("EXTERNAL_POLICY_SYMBOL_MISSING", owner.symbol); return new Set(); }
  const values = new Set();
  for (const match of block.matchAll(/["'](https:\/\/[^"']+)["']/g)) values.add(match[1]);
  if (!values.size) fail("EXTERNAL_POLICY_EMPTY", owner.symbol);
  return values;
}

function validateManifestShape(manifest, fail) {
  const strings = ["gate_version", "product", "canonical_repo", "expected_remote", "approved_worktree"];
  for (const key of strings) if (!manifest[key] || typeof manifest[key] !== "string") fail("MANIFEST_FIELD", key);
  for (const key of ["excluded_projects", "noncanonical_patterns", "required_owners", "required_edge_owners", "externalized_owners", "historical_not_active_owners", "active_entrypoints", "specialized_gate_owners"])
    if (!Array.isArray(manifest[key])) fail("MANIFEST_FIELD", key);
  if (Object.hasOwn(manifest, "required_local_runtime_owners") && !Array.isArray(manifest.required_local_runtime_owners))
    fail("MANIFEST_FIELD", "required_local_runtime_owners");
  if (manifest.product !== "ticket-core-demo") fail("PRODUCT_MISMATCH", manifest.product || "missing");
  if (manifest.allowed_branch?.policy !== "prefix" || !manifest.allowed_branch?.implementation_branch || !manifest.allowed_branch?.allowed_prefixes?.length)
    fail("BRANCH_POLICY", "prefix policy and implementation branch required");
  if (manifest.allowed_branch?.main_direct_implementation_allowed !== false || manifest.allowed_branch?.allowed_prefixes?.includes("main"))
    fail("MAIN_BRANCH_POLICY", "main direct implementation must remain disabled");
  if (!manifest.ci_event_policy?.allowed_events?.length || !manifest.ci_event_policy?.allowed_push_branches?.length)
    fail("CI_EVENT_POLICY", "allowed events and push branches required");
  if (manifest.worktree_policy?.mode !== "registered_worktree_of_canonical_common_git_dir")
    fail("WORKTREE_POLICY", "canonical common git dir membership required");
  if (manifest.repository_policy?.head?.mode !== "descendant_of_base" || !manifest.repository_policy?.head?.expected_base_head)
    fail("HEAD_POLICY", "descendant_of_base required");
  const secretKeys = [];
  const visit = (value, trail = "") => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      const next = trail ? `${trail}.${key}` : key;
      if (/(?:service_role|jwt_secret|turnstile_secret|access_token|refresh_token)/i.test(key)) secretKeys.push(next);
      visit(child, next);
    }
  };
  visit(manifest);
  for (const key of secretKeys) fail("SECRET_FIELD_FORBIDDEN", key);
}

export function evaluateGate({ root: rawRoot, sourceRoot: rawSourceRoot, manifestPath: rawManifestPath, mode = "normal", allowBootstrap = false, env = process.env }) {
  const failures = [];
  const checks = [];
  const fail = (code, detail) => failures.push({ code, detail: String(detail) });
  const pass = (code) => checks.push(code);
  const root = resolve(rawRoot || ".");
  const sourceRoot = resolve(rawSourceRoot || root);
  const manifestPath = resolve(rawManifestPath || join(sourceRoot, DEFAULT_MANIFEST));

  if (!["normal", "pre-commit", "ci"].includes(mode))
    return { ok: false, failures: [{ code: "MODE_INVALID", detail: mode }], checks };

  if (!existsSync(manifestPath)) return { ok: false, failures: [{ code: "MANIFEST_MISSING", detail: manifestPath }], checks };
  let manifest;
  try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")); }
  catch { return { ok: false, failures: [{ code: "MANIFEST_INVALID_JSON", detail: manifestPath }], checks }; }
  validateManifestShape(manifest, fail);

  if (!inside(sourceRoot, manifestPath)) fail("MANIFEST_OUTSIDE_REPO", manifestPath);
  if (isNoncanonical(relative(sourceRoot, manifestPath), manifest.noncanonical_patterns || [])) fail("MANIFEST_NONCANONICAL", manifestPath);
  for (const privateRoot of manifest.private_product_roots || []) {
    if (samePath(root, privateRoot) || samePath(manifest.canonical_repo, privateRoot)) fail("PRIVATE_PRODUCT_AS_DEMO", privateRoot);
  }

  const inCi = env.CI === "true" && env.GITHUB_ACTIONS === "true";
  const ciAllowed = manifest.repository_policy?.ci_checkout_allowed === true;
  if (inCi && !ciAllowed) fail("CI_CHECKOUT_NOT_ALLOWED", "repository policy");
  let top = "", common = "", gitDir = "", head = "", branch = "", remote = "";
  try {
    top = git(root, ["rev-parse", "--show-toplevel"]).stdout;
    common = git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).stdout;
    gitDir = git(root, ["rev-parse", "--path-format=absolute", "--git-dir"]).stdout;
    head = git(root, ["rev-parse", "HEAD"]).stdout;
    branch = git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"], true).stdout;
    remote = git(root, ["remote", "get-url", "origin"]).stdout;
  } catch {
    fail("NOT_A_GIT_REPOSITORY", root);
  }

  if (top && !samePath(top, root)) fail("REPO_ROOT_MISMATCH", top);
  if (remote && canonicalRemote(remote) !== canonicalRemote(manifest.expected_remote)) fail("REMOTE_MISMATCH", remote);
  let effectiveBranch = branch;
  if (inCi && ciAllowed) effectiveBranch = ciBranchContext(manifest, env, fail);
  else if (!branch) fail("DETACHED_HEAD", head || "unknown");
  else if (!allowedImplementationBranch(manifest, branch)) fail("BRANCH_MISMATCH", branch);
  const canonicalCommon = join(manifest.canonical_repo || "", ".git");
  if (!inCi && manifest.repository_policy?.common_git_dir && !samePath(manifest.repository_policy.common_git_dir, canonicalCommon))
    fail("CANONICAL_COMMON_GIT_DIR_MISMATCH", manifest.repository_policy.common_git_dir);
  const expectedCommon = inCi && ciAllowed ? join(root, ".git") : canonicalCommon;
  if (common && expectedCommon && !samePath(common, expectedCommon)) fail("COMMON_GIT_DIR_MISMATCH", common);
  if (top && common) {
    const registered = git(root, ["worktree", "list", "--porcelain"], true).stdout
      .split("\n").filter((line) => line.startsWith("worktree ")).map((line) => line.slice(9));
    if (!registered.some((path) => samePath(path, root))) fail("WORKTREE_NOT_REGISTERED", root);
  }
  const base = manifest.repository_policy?.head?.expected_base_head;
  if (head && base && git(root, ["merge-base", "--is-ancestor", base, head], true).status !== 0) fail("HEAD_NOT_DESCENDANT_OF_BASE", head);

  for (const path of [join(gitDir, "index.lock"), join(common, "index.lock")]) if (path && existsSync(path)) fail("INDEX_LOCK_PRESENT", path);
  for (const marker of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "BISECT_LOG", "rebase-merge", "rebase-apply"]) {
    if ((gitDir && existsSync(join(gitDir, marker))) || (common && existsSync(join(common, marker)))) fail("GIT_OPERATION_IN_PROGRESS", marker);
  }

  const dirty = head ? changedPaths(root) : [];
  if (dirty.length) {
    if (mode === "pre-commit") pass("INDEX_CANDIDATE_MODE");
    else {
      const bootstrap = new Set(manifest.bootstrap_files || []);
      const staged = new Set(git(root, ["diff", "--cached", "--name-only"], true).stdout.split("\n").filter(Boolean));
      const unstaged = git(root, ["diff", "--name-only"], true).stdout.split("\n").filter(Boolean);
      const onlyBootstrap = dirty.every((path) => bootstrap.has(path));
      const allBootstrapStaged = [...bootstrap].every((path) => staged.has(path));
      if (!(allowBootstrap && head === base && onlyBootstrap && allBootstrapStaged && unstaged.length === 0))
        fail("WORKTREE_DIRTY", dirty.join(","));
      else pass("BOOTSTRAP_CHANGES_ISOLATED");
    }
  }

  const ownerIds = new Set(), ownerPaths = new Set();
  for (const owner of manifest.required_owners || []) {
    if (!owner?.id || !owner?.responsibility || !owner?.path) { fail("OWNER_INVALID", "id/responsibility/path required"); continue; }
    if (ownerIds.has(owner.id)) fail("DUPLICATE_OWNER_ID", owner.id);
    if (ownerPaths.has(owner.path)) fail("DUPLICATE_OWNER_PATH", owner.path);
    ownerIds.add(owner.id); ownerPaths.add(owner.path);
    const target = resolve(sourceRoot, owner.path);
    if (!inside(sourceRoot, target) || isNoncanonical(owner.path, manifest.noncanonical_patterns || [])) fail("OWNER_NONCANONICAL", owner.path);
    else if (!existsSync(target)) fail("OWNER_MISSING", owner.path);
    else if (!isTracked(root, owner.path)) fail("OWNER_UNTRACKED", owner.path);
  }

  for (const path of manifest.specialized_gate_owners || []) {
    if (!existsSync(resolve(sourceRoot, path)) || !isTracked(root, path)) fail("SPECIALIZED_GATE_OWNER_MISSING", path);
  }

  const allowedExternal = externalPolicy(sourceRoot, root, manifest, fail);
  const activeRuntime = new Set();
  const runtimeQueue = [];
  for (const entrypointRecord of manifest.active_entrypoints || []) {
    const entrypoint = activeEntrypointPath(entrypointRecord);
    if (!entrypoint || (typeof entrypointRecord === "object" && (!entrypointRecord.surface || !entrypointRecord.reason))) {
      fail("ENTRYPOINT_INVALID", entrypoint || "missing");
      continue;
    }
    const file = resolve(sourceRoot, entrypoint);
    if (!inside(sourceRoot, file) || isNoncanonical(entrypoint, manifest.noncanonical_patterns || [])) { fail("ENTRYPOINT_NONCANONICAL", entrypoint); continue; }
    if (!existsSync(file)) { fail("ENTRYPOINT_MISSING", entrypoint); continue; }
    if (!isTracked(root, entrypoint)) fail("ENTRYPOINT_UNTRACKED", entrypoint);
    activeRuntime.add(entrypoint); runtimeQueue.push(file);
    const source = readFileSync(file, "utf8");
    for (const raw of htmlActiveRefs(source)) {
      if ((manifest.private_product_roots || []).some((privateRoot) => raw.includes(privateRoot))) { fail("PRIVATE_PRODUCT_AS_DEMO", `${entrypoint}:${raw}`); continue; }
      if (isNoncanonical(raw, manifest.noncanonical_patterns || [])) { fail("ACTIVE_NONCANONICAL_SOURCE", `${entrypoint}:${raw}`); continue; }
      if (/^(?:https?:)?\/\//i.test(raw) || /^[a-z]+:/i.test(raw)) {
        const canonical = canonicalExternal(raw);
        if (!canonical || !allowedExternal.has(canonical)) fail("EXTERNAL_RESOURCE_NOT_ALLOWED", `${entrypoint}:${raw}`);
        continue;
      }
      const target = resolveLocalRef(sourceRoot, file, raw);
      if (!target || !inside(sourceRoot, target) || !existsSync(target)) fail("HTML_ACTIVE_REF_MISSING", `${entrypoint}:${raw}`);
      else {
        const rel = relative(sourceRoot, target).replaceAll("\\", "/");
        activeRuntime.add(rel);
        if (/\.(?:js|mjs)$/.test(rel)) runtimeQueue.push(target);
      }
    }
  }

  const visitedRuntime = new Set();
  while (runtimeQueue.length) {
    const file = runtimeQueue.shift();
    if (!file || visitedRuntime.has(file) || !existsSync(file)) continue;
    visitedRuntime.add(file);
    if (!/\.(?:js|mjs)$/.test(file)) continue;
    for (const raw of jsLocalRefs(readFileSync(file, "utf8"))) {
      const owner = relative(sourceRoot, file).replaceAll("\\", "/");
      if ((manifest.private_product_roots || []).some((privateRoot) => raw.includes(privateRoot))) { fail("PRIVATE_PRODUCT_AS_DEMO", `${owner}:${raw}`); continue; }
      if (isNoncanonical(raw, manifest.noncanonical_patterns || [])) { fail("ACTIVE_NONCANONICAL_SOURCE", `${owner}:${raw}`); continue; }
      const target = resolveLocalRef(sourceRoot, file, raw);
      if (!target || !inside(sourceRoot, target) || !existsSync(target)) { fail("ACTIVE_IMPORT_MISSING", `${owner}:${raw}`); continue; }
      const rel = relative(sourceRoot, target).replaceAll("\\", "/");
      activeRuntime.add(rel); runtimeQueue.push(target);
    }
  }
  const activeByResponsibility = new Map();
  for (const owner of manifest.required_owners || []) {
    if (!activeRuntime.has(owner.path)) continue;
    const paths = activeByResponsibility.get(owner.responsibility) || [];
    paths.push(owner.path); activeByResponsibility.set(owner.responsibility, paths);
  }
  for (const [responsibility, paths] of activeByResponsibility) {
    if (new Set(paths).size > 1) fail("DUPLICATE_ACTIVE_OWNER", `${responsibility}:${paths.join(",")}`);
  }

  const tracked = head ? git(root, ["ls-files"]).stdout.split("\n").filter(Boolean) : [];
  const classificationByName = new Map();
  const noteClassification = (name, category) => {
    if (typeof name !== "string" || !name) return;
    const categories = classificationByName.get(name) || [];
    categories.push(category);
    classificationByName.set(name, categories);
  };
  const localPathRecords = new Map();
  const noteLocalPath = (path, category, name) => {
    if (typeof path !== "string" || !path) return;
    const records = localPathRecords.get(path) || [];
    records.push({ category, name });
    localPathRecords.set(path, records);
  };

  const externalized = new Map();
  for (const owner of manifest.externalized_owners || []) {
    noteClassification(owner?.name, "externalized_owners");
    if (!owner?.name || owner.type !== "edge-function" || owner.classification !== "EXTERNALIZED_EXPLICIT" || !owner.reason || !owner.caller || !owner.contract_owner || !owner.status) {
      fail("EXTERNAL_OWNER_INVALID", owner?.name || "missing"); continue;
    }
    if (externalized.has(owner.name)) fail("DUPLICATE_EXTERNAL_OWNER", owner.name);
    if (!activeRuntime.has(owner.caller)) fail("EXTERNAL_OWNER_CALLER_NOT_ACTIVE", `${owner.name}:${owner.caller}`);
    if (!existsSync(resolve(sourceRoot, owner.contract_owner)) || !isTracked(root, owner.contract_owner))
      fail("EXTERNAL_OWNER_CONTRACT_MISSING", `${owner.name}:${owner.contract_owner}`);
    externalized.set(owner.name, owner);
  }
  const requiredLocal = new Map();
  for (const owner of manifest.required_edge_owners || []) {
    noteClassification(owner?.name, "required_edge_owners");
    noteLocalPath(owner?.path, "required_edge_owners", owner?.name);
    if (!owner?.name || owner.classification !== "REQUIRED_LOCAL" || !owner.path || !owner.caller) { fail("REQUIRED_EDGE_OWNER_INVALID", owner?.name || "missing"); continue; }
    if (requiredLocal.has(owner.name)) fail("DUPLICATE_REQUIRED_EDGE_OWNER", owner.name);
    const expectedPath = new RegExp(`^supabase/functions/${owner.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/index\\.(?:ts|js|mjs)$`);
    if (!expectedPath.test(owner.path)) fail("REQUIRED_EDGE_OWNER_INVALID", `${owner.name}:${owner.path}`);
    if (!activeRuntime.has(owner.caller)) fail("REQUIRED_EDGE_CALLER_NOT_ACTIVE", `${owner.name}:${owner.caller}`);
    const target = resolve(sourceRoot, owner.path);
    if (!inside(sourceRoot, target) || !existsSync(target) || !statSync(target).isFile() || !isTracked(root, owner.path)) fail("EDGE_OWNER_MISSING", owner.name);
    requiredLocal.set(owner.name, owner);
  }
  const historical = new Map();
  for (const owner of manifest.historical_not_active_owners || []) {
    noteClassification(owner?.name, "historical_not_active_owners");
    if (!owner?.name || owner.classification !== "HISTORICAL_NOT_ACTIVE" || !owner.reason) { fail("HISTORICAL_OWNER_INVALID", owner?.name || "missing"); continue; }
    if (historical.has(owner.name)) fail("DUPLICATE_HISTORICAL_OWNER", owner.name);
    historical.set(owner.name, owner);
  }

  const runtimeLocal = new Map();
  const runtimeOwnerRecords = Array.isArray(manifest.required_local_runtime_owners) ? manifest.required_local_runtime_owners : [];
  const runtimeRequired = ["name", "classification", "path", "source_sha256", "evidence", "runtime_status"];
  const runtimeAllowed = [...runtimeRequired, "remote_version", "verify_jwt"];
  const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  const hashPattern = /^[0-9a-f]{64}$/;
  const runtimePathPattern = /^supabase\/functions\/[a-z0-9]+(?:-[a-z0-9]+)*\/index\.(?:ts|js|mjs)$/;
  const remoteEvidencePathPattern = /^supabase\/functions\/[a-z0-9]+(?:-[a-z0-9]+)*\/source-current\.json$/;
  for (const owner of runtimeOwnerRecords) {
    noteClassification(owner?.name, "required_local_runtime_owners");
    noteLocalPath(owner?.path, "required_local_runtime_owners", owner?.name);
    const label = owner?.name || "missing";
    if (!hasExactKeys(owner, runtimeRequired, runtimeAllowed)) fail("RUNTIME_EDGE_OWNER_INVALID", label);
    if (!slugPattern.test(owner?.name || "") || owner?.classification !== "REQUIRED_LOCAL_RUNTIME" || !["REMOTE_ACTIVE", "LOCAL_ONLY_NOT_DEPLOYED"].includes(owner?.runtime_status))
      fail("RUNTIME_EDGE_OWNER_INVALID", label);
    if (runtimeLocal.has(owner?.name)) fail("DUPLICATE_RUNTIME_EDGE_OWNER", label);
    const expectedSourcePath = typeof owner?.name === "string" ? new RegExp(`^supabase/functions/${owner.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/index\\.(?:ts|js|mjs)$`) : null;
    if (typeof owner?.path !== "string" || !runtimePathPattern.test(owner.path) || !expectedSourcePath?.test(owner.path))
      fail("RUNTIME_EDGE_PATH_INVALID", `${label}:${owner?.path || "missing"}`);
    if (!hashPattern.test(owner?.source_sha256 || "")) fail("RUNTIME_EDGE_HASH_INVALID", label);

    const source = typeof owner?.path === "string" ? resolve(sourceRoot, owner.path) : sourceRoot;
    let sourceReady = false;
    if (typeof owner?.path !== "string" || !inside(sourceRoot, source) || !existsSync(source) || !statSync(source).isFile() || !isTracked(root, owner.path)) {
      fail("RUNTIME_EDGE_OWNER_MISSING", label);
    } else if (statSync(source).size === 0) {
      fail("RUNTIME_EDGE_OWNER_EMPTY", label);
    } else {
      sourceReady = true;
      if (hashPattern.test(owner?.source_sha256 || "") && sha256(source) !== owner.source_sha256)
        fail("RUNTIME_EDGE_HASH_MISMATCH", label);
    }

    if (owner?.runtime_status === "REMOTE_ACTIVE") {
      if (!Number.isInteger(owner.remote_version) || owner.remote_version < 1 || typeof owner.verify_jwt !== "boolean")
        fail("RUNTIME_EDGE_REMOTE_FIELDS_INVALID", label);
      const evidence = owner.evidence;
      const evidenceShape = hasExactKeys(evidence, ["kind", "path"], ["kind", "path"])
        && evidence.kind === "REMOTE_READ_ONLY_METADATA"
        && remoteEvidencePathPattern.test(evidence.path || "");
      if (!evidenceShape) {
        fail("RUNTIME_EDGE_EVIDENCE_INVALID", label);
      } else {
        const evidenceFile = resolve(sourceRoot, evidence.path);
        if (!inside(sourceRoot, evidenceFile) || !existsSync(evidenceFile) || !statSync(evidenceFile).isFile() || !isTracked(root, evidence.path)) {
          fail("RUNTIME_EDGE_EVIDENCE_MISSING", `${label}:${evidence.path}`);
        } else {
          let metadata;
          try { metadata = JSON.parse(readFileSync(evidenceFile, "utf8")); }
          catch { metadata = null; }
          const expectedEvidencePath = `supabase/functions/${owner.name}/source-current.json`;
          if (evidence.path !== expectedEvidencePath || !isRecord(metadata)
            || metadata.slug !== owner.name || metadata.status !== "ACTIVE"
            || metadata.remote_version !== owner.remote_version || metadata.verify_jwt !== owner.verify_jwt
            || metadata.source_sha256 !== owner.source_sha256
            || typeof metadata.provenance !== "string" || !metadata.provenance.trim()
            || metadata.deployed_by_this_unit !== false)
            fail("RUNTIME_EDGE_EVIDENCE_MISMATCH", label);
        }
      }
    } else if (owner?.runtime_status === "LOCAL_ONLY_NOT_DEPLOYED") {
      if (Object.hasOwn(owner, "remote_version") || Object.hasOwn(owner, "verify_jwt"))
        fail("RUNTIME_EDGE_LOCAL_ONLY_REMOTE_FIELDS", label);
      const evidence = owner.evidence;
      const evidenceShape = hasExactKeys(evidence, ["kind", "path", "marker"], ["kind", "path", "marker"])
        && evidence.kind === "TRACKED_SOURCE_MARKER"
        && runtimePathPattern.test(evidence.path || "")
        && evidence.marker === "PREPARED_NOT_APPLIED";
      if (!evidenceShape) {
        fail("RUNTIME_EDGE_EVIDENCE_INVALID", label);
      } else if (evidence.path !== owner.path || !sourceReady || !readFileSync(source, "utf8").includes(evidence.marker)) {
        fail("RUNTIME_EDGE_EVIDENCE_MISMATCH", label);
      }
    }
    if (typeof owner?.name === "string" && !runtimeLocal.has(owner.name)) runtimeLocal.set(owner.name, owner);
  }

  for (const [name, categories] of classificationByName) {
    if (categories.length > 1) fail("EDGE_CLASSIFICATION_COLLISION", `${name}:${categories.join(",")}`);
  }
  for (const [path, records] of localPathRecords) {
    if (records.length > 1) fail("DUPLICATE_LOCAL_EDGE_PATH", `${path}:${records.map((record) => record.name).join(",")}`);
  }

  const trackedEdgeEntrypoints = tracked.filter((path) => /^supabase\/functions\/[^/]+\/index\.(?:ts|js|mjs)$/.test(path));
  const trackedEntrypointsByName = new Map();
  for (const path of trackedEdgeEntrypoints) {
    const name = path.split("/")[2];
    const paths = trackedEntrypointsByName.get(name) || [];
    paths.push(path);
    trackedEntrypointsByName.set(name, paths);
  }
  for (const [name, paths] of trackedEntrypointsByName) {
    if (paths.length > 1) fail("MULTIPLE_TRACKED_EDGE_ENTRYPOINTS", `${name}:${paths.join(",")}`);
    for (const path of paths) {
      const records = localPathRecords.get(path) || [];
      if (externalized.has(name) || historical.has(name)) fail("NONLOCAL_EDGE_OWNER_TRACKED", `${name}:${path}`);
      else if (records.length === 0) fail("UNREGISTERED_TRACKED_EDGE_OWNER", path);
    }
  }

  const sourceFiles = [...activeRuntime].filter((path) => /^app\/.*\.(?:html|js|mjs)$/.test(path) && !isNoncanonical(path, manifest.noncanonical_patterns || []));
  const edgeNames = new Set();
  for (const path of sourceFiles) for (const name of staticEdgeNames(readFileSync(join(sourceRoot, path), "utf8"))) edgeNames.add(name);
  for (const name of edgeNames) {
    const ownerDir = join(sourceRoot, "supabase/functions", name);
    const localOwner = existsSync(ownerDir) && statSync(ownerDir).isDirectory() && ["index.ts", "index.js", "index.mjs"].some((file) => isTracked(root, `supabase/functions/${name}/${file}`));
    if (runtimeLocal.has(name)) fail("RUNTIME_EDGE_STATIC_CALLER", name);
    else if (historical.has(name)) fail("HISTORICAL_OWNER_ACTIVE", name);
    else if (requiredLocal.has(name)) {
      const declared = requiredLocal.get(name);
      if (!localOwner || !isTracked(root, declared.path)) fail("EDGE_OWNER_MISSING", name);
    } else if (externalized.has(name)) {
      if (localOwner) fail("DUPLICATE_EDGE_OWNER", name);
    } else fail("EDGE_OWNER_MISSING", name);
  }
  for (const name of requiredLocal.keys()) if (!edgeNames.has(name)) fail("REQUIRED_EDGE_NOT_ACTIVE", name);
  for (const name of externalized.keys()) if (!edgeNames.has(name)) fail("EXTERNALIZED_EDGE_NOT_ACTIVE", name);

  const migrationIds = new Map();
  for (const path of tracked.filter((path) => /^supabase\/migrations\/[^/]+\.sql$/.test(path))) {
    const id = basename(path).match(/^(\d+)_/)?.[1];
    if (!id) continue;
    if (migrationIds.has(id)) fail("DUPLICATE_MIGRATION_ID", `${id}:${migrationIds.get(id)},${path}`);
    else migrationIds.set(id, path);
  }

  if (!failures.length) {
    pass("IDENTITY"); pass("GIT_STATE"); pass("ACTIVE_FILES"); pass("NONCANONICAL_SOURCES"); pass("EDGE_AND_MIGRATIONS"); pass("PRODUCT_BOUNDARY");
  }
  return { ok: failures.length === 0, failures, checks, metadata: { head, branch: effectiveBranch, edgeOwnersChecked: edgeNames.size, entrypointsChecked: (manifest.active_entrypoints || []).length, activeRuntimeFiles: activeRuntime.size, trackedEdgeEntrypoints: trackedEdgeEntrypoints.length, runtimeEdgeOwners: runtimeLocal.size } };
}

function parseArgs(argv) {
  const args = { root: ".", sourceRoot: "", manifestPath: "", mode: "normal", allowBootstrap: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") args.root = argv[++i];
    else if (argv[i] === "--source-root") args.sourceRoot = argv[++i];
    else if (argv[i] === "--manifest") args.manifestPath = argv[++i];
    else if (argv[i] === "--mode") args.mode = argv[++i];
    else if (argv[i] === "--allow-bootstrap") args.allowBootstrap = true;
    else throw new Error(`argumento no reconocido: ${argv[i]}`);
  }
  args.root = resolve(args.root);
  args.sourceRoot = resolve(args.sourceRoot || args.root);
  args.manifestPath = resolve(args.manifestPath || join(args.sourceRoot, DEFAULT_MANIFEST));
  return args;
}

function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); }
  catch (error) { console.error(`CANONICAL_SOURCE_GATE: FAIL\nARGUMENT_ERROR\t${error.message}`); process.exit(1); }
  const result = evaluateGate(args);
  if (!result.ok) {
    for (const failure of result.failures) console.error(`${failure.code}\t${failure.detail}`);
    console.error(`CANONICAL_SOURCE_GATE: FAIL (${result.failures.length})`);
    process.exit(1);
  }
  console.log(`CANONICAL_SOURCE_GATE: PASS (entrypoints=${result.metadata.entrypointsChecked}; edge_owners=${result.metadata.edgeOwnersChecked})`);
  console.log(`CANONICAL_HEAD=${result.metadata.head}`);
  console.log(`CANONICAL_BRANCH=${result.metadata.branch}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) main();
