import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflowPath = ".github/workflows/frontend-gates.yml";
const contractCommand = "node tools/edge-public-adoption-contract.test.mjs";
const allowedChanges = new Set([
  workflowPath,
  "supabase/functions/estado-ticket-responder-ts/index.ts",
  "supabase/functions/estado-ticket-responder-ts/source-current.json",
  "supabase/functions/estado-ticket-ts/index.ts",
  "supabase/functions/estado-ticket-ts/source-current.json",
  "tools/canonical-source.json",
  "tools/edge-public-adoption-contract.test.mjs",
]);

const specs = [
  {
    slug: "estado-ticket-ts",
    remoteVersion: 37,
    sourceSha256: "a2f5de22f6fce3722bc4d0272cf48010bee387b20a733dad583a49c3c240e009",
    recoveredAt: "2026-07-21T20:16:50-06:00",
  },
  {
    slug: "estado-ticket-responder-ts",
    remoteVersion: 39,
    sourceSha256: "a91eb85f0910b9becd74f5203b5099e8c7d397832efd553f1d013e4f2991bac6",
    localSourceSha256: "4b39404103e3ff300775bd740b5c58febf01c0febea6ce5ad6cc9f7318b843dc",
    hardeningCommit: "39ac85d36464367959816230cbee5620a2ba7fa3",
    recoveredAt: "2026-07-21T20:16:51-06:00",
  },
];

const read = (relativePath) => readFileSync(resolve(root, relativePath), "utf8");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const gitLines = (...args) => {
  const output = execFileSync("git", ["-c", "core.quotepath=false", ...args], {
    cwd: root,
    encoding: "utf8",
  });
  return output.split("\n").map((line) => line.trim()).filter(Boolean);
};

const metadataKeys = [
  "deployed_by_this_unit",
  "project_ref",
  "provenance",
  "recovered_at",
  "remote_version",
  "slug",
  "source_sha256",
  "status",
  "verify_jwt",
];

for (const spec of specs) {
  const sourcePath = `supabase/functions/${spec.slug}/index.ts`;
  const metadataPath = `supabase/functions/${spec.slug}/source-current.json`;
  const source = read(sourcePath);
  assert.ok(source.length > 0, `${sourcePath} must not be empty`);
  const expectedLocalSha256 =
    spec.localSourceSha256 ?? spec.sourceSha256;
  assert.equal(
    sha256(source),
    expectedLocalSha256,
    `${sourcePath} must match the governed local source`,
  );

  const metadataText = read(metadataPath);
  const metadata = JSON.parse(metadataText);
  assert.deepEqual(Object.keys(metadata).sort(), metadataKeys, `${metadataPath} has unexpected fields`);
  assert.equal(metadata.slug, spec.slug);
  assert.equal(metadata.remote_version, spec.remoteVersion);
  assert.equal(metadata.verify_jwt, false);
  assert.equal(metadata.source_sha256, spec.sourceSha256);
  assert.equal(metadata.recovered_at, spec.recoveredAt);
  assert.equal(metadata.project_ref, "ovfmqqqwezfdtgrtkjhf");
  assert.equal(metadata.status, "ACTIVE");
  assert.equal(metadata.provenance, "READ_ONLY_SUPABASE_CLI_DOWNLOAD");
  assert.equal(metadata.deployed_by_this_unit, false);
  if (spec.localSourceSha256) {
    assert.equal(
      spec.slug,
      "estado-ticket-responder-ts",
      "only the responder may be a locally hardened derivative",
    );
    assert.equal(
      metadata.source_sha256,
      spec.sourceSha256,
      `${metadataPath} must retain the recovered remote hash`,
    );
    assert.notEqual(
      metadata.source_sha256,
      sha256(source),
      `${sourcePath} must not be misrepresented as byte-identical to remote`,
    );

    const recoveredSource = execFileSync(
      "git",
      ["show", `${spec.hardeningCommit}^:${sourcePath}`],
      { cwd: root },
    );
    const hardenedSource = execFileSync(
      "git",
      ["show", `${spec.hardeningCommit}:${sourcePath}`],
      { cwd: root },
    );

    assert.equal(
      sha256(recoveredSource),
      spec.sourceSha256,
      `${spec.hardeningCommit} parent must match the recovered remote source`,
    );
    assert.equal(
      sha256(hardenedSource),
      spec.localSourceSha256,
      `${spec.hardeningCommit} must produce the governed hardened source`,
    );

    execFileSync(
      "git",
      ["merge-base", "--is-ancestor", spec.hardeningCommit, "HEAD"],
      { cwd: root },
    );
  } else {
    assert.equal(
      metadata.source_sha256,
      sha256(source),
      `${metadataPath} hash must match its recovered source`,
    );
  }

  assert.doesNotMatch(metadataText, /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/);
  assert.doesNotMatch(metadataText, /(?:sb_secret_|service[_-]?role|anon[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key)/i);
  assert.doesNotMatch(metadataText, /https?:\/\/[^\s"]*[?&](?:token|key|secret)=/i);

  assert.match(source, /\.eq\("folio",folio\)\.eq\("token_publico",token\)/);
  assert.match(source, /token_publico_expira/);
  assert.match(source, /getTime\(\)<Date\.now\(\)/);
}

const estado = read("supabase/functions/estado-ticket-ts/index.ts");
assert.match(estado, /u\.searchParams\.get\("folio"\)/);
assert.match(estado, /u\.searchParams\.get\("token"\)/);

const responder = read("supabase/functions/estado-ticket-responder-ts/index.ts");
assert.match(responder, /form\.get\("folio"\)/);
assert.match(responder, /form\.get\("token"\)/);
assert.match(responder, /new Set\(\["jpg","jpeg","png","webp","pdf","xml","xls","xlsx","csv","txt","zip"\]\)/);
for (const mime of [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "text/xml",
  "application/xml",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/plain",
  "application/zip",
  "application/x-zip-compressed",
]) {
  assert.ok(responder.includes(`"${mime}"`), `missing preserved MIME ${mime}`);
}
assert.match(responder, /files\.length>10/);
assert.match(responder, /size>20\*1024\*1024/);
assert.match(responder, /totalBytes>60\*1024\*1024/);

const canonicalManifest = JSON.parse(read("tools/canonical-source.json"));
const requiredOwners = canonicalManifest.required_edge_owners ?? [];
const externalizedOwners = canonicalManifest.externalized_owners ?? [];
const historicalOwners = canonicalManifest.historical_not_active_owners ?? [];

for (const owners of [requiredOwners, externalizedOwners, historicalOwners]) {
  assert.equal(
    new Set(owners.map((owner) => owner.name)).size,
    owners.length,
    "canonical Edge classification contains a duplicate name",
  );
}

for (const spec of specs) {
  const requiredMatches = requiredOwners.filter((owner) => owner.name === spec.slug);
  assert.equal(requiredMatches.length, 1, `${spec.slug} must have exactly one required local owner`);
  assert.deepEqual(requiredMatches[0], {
    name: spec.slug,
    classification: "REQUIRED_LOCAL",
    path: `supabase/functions/${spec.slug}/index.ts`,
    caller: "app/estado.js",
  });
  assert.equal(externalizedOwners.filter((owner) => owner.name === spec.slug).length, 0);
  assert.equal(historicalOwners.filter((owner) => owner.name === spec.slug).length, 0);
}

assert.deepEqual(
  requiredOwners.filter((owner) => owner.name === "support-submit-secure"),
  [{
    name: "support-submit-secure",
    classification: "REQUIRED_LOCAL",
    path: "supabase/functions/support-submit-secure/index.ts",
    caller: "app/soporte.js",
  }],
);

for (const name of ["crear-cliente-janome", "crear-ticket-interno"]) {
  const matches = externalizedOwners.filter((owner) => owner.name === name);
  assert.equal(matches.length, 1, `${name} must remain externalized exactly once`);
  assert.equal(matches[0].type, "edge-function");
  assert.equal(matches[0].classification, "EXTERNALIZED_EXPLICIT");
  assert.equal(requiredOwners.filter((owner) => owner.name === name).length, 0);
  assert.equal(historicalOwners.filter((owner) => owner.name === name).length, 0);
}

const classifiedNames = new Set([
  ...requiredOwners.map((owner) => owner.name),
  ...externalizedOwners.map((owner) => owner.name),
  ...historicalOwners.map((owner) => owner.name),
]);
for (const name of classifiedNames) {
  const categoryCount = Number(requiredOwners.some((owner) => owner.name === name)) +
    Number(externalizedOwners.some((owner) => owner.name === name)) +
    Number(historicalOwners.some((owner) => owner.name === name));
  assert.equal(categoryCount, 1, `canonical Edge classification collision: ${name}`);
}

const changedFiles = new Set([
  ...gitLines("diff", "--name-only"),
  ...gitLines("diff", "--cached", "--name-only"),
  ...gitLines("ls-files", "--others", "--exclude-standard"),
]);
for (const changedFile of changedFiles) {
  assert.ok(allowedChanges.has(changedFile), `allowlist violation: ${changedFile}`);
  assert.ok(!changedFile.endsWith(".sql"), `SQL change is forbidden: ${changedFile}`);
  assert.notEqual(changedFile, "supabase/functions/support-submit-secure/index.ts");
  if (changedFile.startsWith("supabase/functions/") && changedFile.endsWith("/index.ts")) {
    assert.ok(
      changedFile === "supabase/functions/estado-ticket-ts/index.ts" ||
        changedFile === "supabase/functions/estado-ticket-responder-ts/index.ts",
      `another Edge Function changed: ${changedFile}`,
    );
  }
}

const workflow = read(workflowPath);
assert.equal(workflow.split(contractCommand).length - 1, 1, "contract command must appear exactly once in CI");

console.log("EDGE_PUBLIC_ADOPTION_CONTRACT: PASS");
