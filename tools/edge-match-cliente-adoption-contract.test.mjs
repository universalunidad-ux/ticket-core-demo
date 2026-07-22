import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const slug = "match-cliente";
const sourcePath = `supabase/functions/${slug}/index.ts`;
const metadataPath = `supabase/functions/${slug}/source-current.json`;
const workflowPath = ".github/workflows/frontend-gates.yml";
const contractCommand = "node tools/edge-match-cliente-adoption-contract.test.mjs";
const expectedHash = "0590b1e683100e45733c5a3e31f253d97598894bb541eaafb1bb2829cdffb01b";
const allowedChanges = new Set([
  sourcePath,
  metadataPath,
  "tools/canonical-source.json",
  "docs/CANONICAL_SOURCE.md",
  "tools/edge-match-cliente-adoption-contract.test.mjs",
  workflowPath,
]);

const read = (path) => readFileSync(resolve(root, path), "utf8");
const gitLines = (...args) => execFileSync(
  "git",
  ["-c", "core.quotepath=false", ...args],
  { cwd: root, encoding: "utf8" },
).split("\n").map((line) => line.trim()).filter(Boolean);

const source = readFileSync(resolve(root, sourcePath));
const sourceText = source.toString("utf8");
const actualHash = createHash("sha256").update(source).digest("hex");
assert.equal(actualHash, expectedHash, "source must preserve the recovered bytes");

const metadataText = read(metadataPath);
const metadata = JSON.parse(metadataText);
assert.deepEqual(Object.keys(metadata).sort(), [
  "deployed_by_this_unit",
  "project_ref",
  "provenance",
  "recovered_at",
  "remote_version",
  "slug",
  "source_sha256",
  "status",
  "verify_jwt",
]);
assert.deepEqual(metadata, {
  slug,
  remote_version: 15,
  verify_jwt: true,
  source_sha256: expectedHash,
  recovered_at: "2026-07-21T20:16:51-06:00",
  project_ref: "ovfmqqqwezfdtgrtkjhf",
  status: "ACTIVE",
  provenance: "READ_ONLY_SUPABASE_CLI_DOWNLOAD",
  deployed_by_this_unit: false,
});
assert.equal(metadata.source_sha256, actualHash);

for (const marker of [
  'req.method!=="POST"',
  "await req.formData()",
  'form.get("empresa")',
  'form.get("correo")',
  'form.get("telefono")',
  'env("SUPABASE_SERVICE_ROLE_KEY")',
  'sb.from("clientes")',
  'sb.from("cliente_aliases")',
  'sb.from("clientes_contactos")',
  "suggested_cliente_id",
  "suggested_contacto_id",
  "candidates",
]) {
  assert.ok(sourceText.includes(marker), `missing preserved source marker: ${marker}`);
}

const manifest = JSON.parse(read("tools/canonical-source.json"));
const required = manifest.required_edge_owners ?? [];
const runtime = manifest.required_local_runtime_owners ?? [];
const externalized = manifest.externalized_owners ?? [];
const historical = manifest.historical_not_active_owners ?? [];
const runtimeMatches = runtime.filter((owner) => owner.name === slug);
assert.equal(runtimeMatches.length, 1, "match-cliente must have exactly one runtime owner");
assert.deepEqual(runtimeMatches[0], {
  name: slug,
  classification: "REQUIRED_LOCAL_RUNTIME",
  path: sourcePath,
  source_sha256: expectedHash,
  evidence: {
    kind: "REMOTE_READ_ONLY_METADATA",
    path: metadataPath,
  },
  runtime_status: "REMOTE_ACTIVE",
  remote_version: 15,
  verify_jwt: true,
});
assert.equal(Object.hasOwn(runtimeMatches[0], "caller"), false, "runtime owner must not declare a caller");
assert.equal(required.filter((owner) => owner.name === slug).length, 0);
assert.equal(externalized.filter((owner) => owner.name === slug).length, 0);
assert.equal(historical.filter((owner) => owner.name === slug).length, 0);

const activeAppText = gitLines("ls-files", "app").map(read).join("\n");
assert.equal(activeAppText.includes(slug), false, "no static frontend caller may be invented");

const docs = read("docs/CANONICAL_SOURCE.md");
assert.ok(docs.includes("`match-cliente` está clasificada `REQUIRED_LOCAL_RUNTIME`"));
assert.ok(docs.includes("sin caller estático declarado"));
assert.ok(docs.includes("no implica hardening, deploy ni cambios remotos"));

const workflow = read(workflowPath);
assert.equal(workflow.split(contractCommand).length - 1, 1, "contract command must appear exactly once in CI");

const changedFiles = new Set([
  ...gitLines("diff", "--name-only"),
  ...gitLines("diff", "--cached", "--name-only"),
  ...gitLines("ls-files", "--others", "--exclude-standard"),
]);
for (const changedFile of changedFiles) {
  assert.ok(allowedChanges.has(changedFile), `allowlist violation: ${changedFile}`);
  assert.ok(!changedFile.endsWith(".sql"), `SQL change is forbidden: ${changedFile}`);
  assert.ok(!changedFile.startsWith("supabase/migrations/"), `migration change is forbidden: ${changedFile}`);
  if (changedFile.startsWith("supabase/functions/") && changedFile.endsWith("/index.ts")) {
    assert.equal(changedFile, sourcePath, `another Edge Function changed: ${changedFile}`);
  }
}

console.log("EDGE_MATCH_CLIENTE_ADOPTION_CONTRACT: PASS");
