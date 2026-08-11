#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildInventory, loadDistribution, validateDistribution } from "./generate-distribution-inventory.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = loadDistribution();
const sw = readFileSync(join(root, source.releaseOwner), "utf8");
const config = readFileSync(join(root, source.publicConfigOwner), "utf8");
const readonly = readFileSync(join(root, source.readonlyOwner), "utf8");

test("tracked distribution graph is complete and local", () => {
  const result = validateDistribution(source);
  assert.deepEqual(result.failures, []);
  const inventory = buildInventory(source);
  assert.equal(inventory.entrypoints.length, 15);
  assert.ok(inventory.localReferences.length > 50);
  assert.ok(inventory.localReferences.every((ref) => !ref.target.startsWith("..")));
});

test("service worker rejects authorization and every sensitive API family", () => {
  const mutant = sw
    .replace('request.headers.has("authorization")||', "")
    .replace("auth|rest|functions|storage", "public");
  const failures = validateDistribution(source, root, { sw: mutant }).failures.join("\n");
  assert.match(failures, /AUTHORIZATION_CACHE_BYPASS_MISSING/);
  for (const route of source.sensitiveRoutePatterns) assert.match(failures, new RegExp(`SENSITIVE_CACHE_BYPASS_MISSING:${route}`));
});

test("public configuration fails closed on privileged or unknown fields", () => {
  const mutant = config.replace("supabasePublishableKey:", "service_role:");
  const failures = validateDistribution(source, root, { config: mutant }).failures.join("\n");
  assert.match(failures, /PUBLIC_CONFIG_FORBIDDEN:service_role/);
  assert.match(failures, /PUBLIC_CONFIG_SCHEMA_INVALID/);
});

test("readonly fallback must remain local and explicit", () => {
  const mutant = readonly.replace('/^(localhost|127\\.0\\.0\\.1)$/', '/.*/').replace("READONLY_REST_UNAVAILABLE_USING_DEMO", "BACKEND_FAILED");
  const failures = validateDistribution(source, root, { readonly: mutant }).failures.join("\n");
  assert.match(failures, /READONLY_LOCAL_GUARD_MISSING/);
  assert.match(failures, /READONLY_BACKEND_FALLBACK_MISSING/);
});

test("release version and no-store fallback are mandatory", () => {
  const mutant = sw.replace('const RELEASE="frontend-p0-20260811-01";', "const RELEASE=null;").replaceAll('fetch(request,{cache:"no-store"})', "fetch(request)");
  const failures = validateDistribution(source, root, { sw: mutant }).failures.join("\n");
  assert.match(failures, /RELEASE_VERSION_MISSING/);
  assert.match(failures, /NO_STORE_FALLBACK_MISSING/);
});

test("every active CSS and JS reference uses the service-worker release", () => {
  const dashboard = readFileSync(join(root, "app/dashboard.html"), "utf8");
  const mutant = dashboard.replace("operations-journey.css?v=frontend-p0-20260811-01", "operations-journey.css?v=stale-release");
  const failures = validateDistribution(source, root, { entrypoints: { "app/dashboard.html": mutant } }).failures.join("\n");
  assert.match(failures, /ENTRYPOINT_RELEASE_MISMATCH:app\/dashboard\.html/);
});
