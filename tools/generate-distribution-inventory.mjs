#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = join(root, "governance/distribution-contract.json");

export function loadDistribution(path = sourcePath) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function localRefs(html) {
  return [...html.matchAll(/\b(?:src|href)=(?:"([^"]+)"|'([^']+)')/gi)]
    .map((match) => match[1] || match[2])
    .filter((ref) => !/^(?:[a-z]+:|\/\/|#|data:|blob:)/i.test(ref));
}

export function validateDistribution(source, sourceRoot = root, overrides = {}) {
  const failures = [];
  if (source.schemaVersion !== 1) failures.push("SCHEMA_VERSION_INVALID");
  const paths = [...(source.entrypoints || []), ...(source.requiredPublicAssets || []), source.releaseOwner, source.publicConfigOwner, source.readonlyOwner];
  for (const path of paths) if (!path || !existsSync(join(sourceRoot, path))) failures.push(`TRACKED_ASSET_MISSING:${path || "EMPTY"}`);
  const sw = overrides.sw ?? readFileSync(join(sourceRoot, source.releaseOwner), "utf8");
  const config = overrides.config ?? readFileSync(join(sourceRoot, source.publicConfigOwner), "utf8");
  const readonly = overrides.readonly ?? readFileSync(join(sourceRoot, source.readonlyOwner), "utf8");
  const release = sw.match(/const RELEASE="([^"]+)"/)?.[1] || null;
  if (!release) failures.push("RELEASE_VERSION_MISSING");
  if (!/request\.headers\.has\("authorization"\)/.test(sw)) failures.push("AUTHORIZATION_CACHE_BYPASS_MISSING");
  for (const route of source.sensitiveRoutePatterns || []) if (!new RegExp(`(?:${route}[|)]|[|(]${route})`).test(sw)) failures.push(`SENSITIVE_CACHE_BYPASS_MISSING:${route}`);
  if (!/fetch\(request,\{cache:"no-store"\}\)/.test(sw)) failures.push("NO_STORE_FALLBACK_MISSING");
  for (const pattern of source.forbiddenPublicConfigPatterns || []) if (new RegExp(pattern, "i").test(config)) failures.push(`PUBLIC_CONFIG_FORBIDDEN:${pattern}`);
  const configKeys = [...config.matchAll(/^\s*([A-Za-z][A-Za-z0-9_]*)\s*:/gm)].map((match) => match[1]).sort();
  if (JSON.stringify(configKeys) !== JSON.stringify([...source.publicConfigKeys].sort())) failures.push("PUBLIC_CONFIG_SCHEMA_INVALID");
  if (!readonly.includes("const DEV_READONLY") || !readonly.includes("localhost|127\\.0\\.0\\.1")) failures.push("READONLY_LOCAL_GUARD_MISSING");
  if (!/READONLY_REST_UNAVAILABLE_USING_DEMO/.test(readonly) || !/demoTickets\(\)/.test(readonly)) failures.push("READONLY_BACKEND_FALLBACK_MISSING");
  const references = [];
  for (const entrypoint of source.entrypoints || []) {
    const owner = join(sourceRoot, entrypoint);
    if (!existsSync(owner) || !entrypoint.endsWith(".html")) continue;
    const html = overrides.entrypoints?.[entrypoint] ?? readFileSync(owner, "utf8");
    for (const ref of localRefs(html)) {
      const clean = ref.split(/[?#]/, 1)[0];
      const target = resolve(dirname(owner), clean);
      references.push({ owner: entrypoint, ref, target: relative(sourceRoot, target).replaceAll("\\", "/") });
      if (!existsSync(target)) failures.push(`ENTRYPOINT_REFERENCE_MISSING:${entrypoint}:${ref}`);
      if (/\.(?:css|js|mjs)$/i.test(clean)) {
        const version = new URL(ref, "https://local.invalid/app/").searchParams.get("v");
        if (!version) failures.push(`ENTRYPOINT_REFERENCE_UNVERSIONED:${entrypoint}:${ref}`);
        else if (release && version !== release) failures.push(`ENTRYPOINT_RELEASE_MISMATCH:${entrypoint}:${ref}`);
      }
    }
  }
  return { ok: failures.length === 0, failures: [...new Set(failures)].sort(), references };
}

export function buildInventory(source, sourceRoot = root) {
  const validation = validateDistribution(source, sourceRoot);
  if (!validation.ok) throw new Error(validation.failures.join(","));
  return {
    schemaVersion: 1,
    entrypoints: source.entrypoints,
    requiredPublicAssets: source.requiredPublicAssets,
    localReferences: validation.references,
    runtimeRoutes: source.runtimeRoutes,
    cacheContract: { authorizationBypass: true, sensitiveRoutes: source.sensitiveRoutePatterns, defaultNoStore: true },
    release: readFileSync(join(sourceRoot, source.releaseOwner), "utf8").match(/const RELEASE="([^"]+)"/)?.[1],
    publicConfigKeys: source.publicConfigKeys,
    readonlyLocalFallback: true
  };
}

export function renderInventory(inventory) {
  const lines = [
    "# Local distribution inventory",
    "",
    "> Generated from `governance/distribution-contract.json` and tracked entrypoints by `tools/generate-distribution-inventory.mjs`; do not edit manually.",
    "",
    `Entrypoints: **${inventory.entrypoints.length}**`,
    `Resolved local references: **${inventory.localReferences.length}**`,
    "",
    "## Runtime probe routes",
    "",
    ...inventory.runtimeRoutes.map((route) => `- \`${route}\``),
    "",
    "## Safety contract",
    "",
    "- Authorization and Supabase API routes bypass caches.",
    "- Non-versioned requests use `cache: no-store`.",
    "- Public config exposes only URL and publishable key fields.",
    "- Readonly demo fallback is restricted to localhost.",
    ""
  ];
  return lines.join("\n");
}

function main(argv) {
  let outDir = join(root, "docs/generated");
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out-dir") outDir = resolve(argv[++i]);
    else throw new Error(`ARGUMENT_INVALID:${argv[i]}`);
  }
  const inventory = buildInventory(loadDistribution());
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "distribution-inventory.json"), `${JSON.stringify(inventory, null, 2)}\n`);
  writeFileSync(join(outDir, "LOCAL_DISTRIBUTION_INVENTORY.md"), renderInventory(inventory));
  console.log(`DISTRIBUTION_ENTRYPOINTS=${inventory.entrypoints.length}`);
  console.log(`DISTRIBUTION_LOCAL_REFERENCES=${inventory.localReferences.length}`);
  console.log("DISTRIBUTION_INVENTORY=PASS");
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) main(process.argv.slice(2));
