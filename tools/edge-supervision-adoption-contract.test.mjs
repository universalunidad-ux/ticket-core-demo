import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

const slug = "ticket-escalar-admin";
const sourcePath =
  "supabase/functions/ticket-escalar-admin/index.ts";
const metadataPath =
  "supabase/functions/ticket-escalar-admin/source-current.json";
const callerPath = "app/ticket-composer-polish.js";
const expectedHash =
  "eb324b7b3f78b65d38d1d845e870a2b7724fd65a703e4e9fd4e6b71e421600c9";

const source = fs.readFileSync(sourcePath);
const metadata = JSON.parse(
  fs.readFileSync(metadataPath, "utf8"),
);
const manifest = JSON.parse(
  fs.readFileSync("tools/canonical-source.json", "utf8"),
);
const caller = fs.readFileSync(callerPath, "utf8");
const docs = fs.readFileSync(
  "docs/CANONICAL_SOURCE.md",
  "utf8",
);
const workflow = fs.readFileSync(
  ".github/workflows/frontend-gates.yml",
  "utf8",
);

const actualHash = crypto
  .createHash("sha256")
  .update(source)
  .digest("hex");

assert.equal(actualHash, expectedHash);
assert.equal(metadata.slug, slug);
assert.equal(metadata.remote_version, 5);
assert.equal(metadata.verify_jwt, true);
assert.equal(metadata.source_sha256, expectedHash);
assert.equal(metadata.project_ref, "ovfmqqqwezfdtgrtkjhf");
assert.equal(metadata.status, "ACTIVE");
assert.equal(
  metadata.provenance,
  "READ_ONLY_SUPABASE_CLI_DOWNLOAD",
);
assert.equal(metadata.deployed_by_this_unit, false);
assert.equal(
  typeof metadata.recovered_at === "string" &&
    metadata.recovered_at.length > 0,
  true,
);

const required = manifest.required_edge_owners || [];
const externalized = manifest.externalized_owners || [];
const historical =
  manifest.historical_not_active_owners || [];

const localMatches = required.filter(
  (owner) => owner.name === slug,
);
const externalMatches = externalized.filter(
  (owner) => owner.name === slug,
);
const historicalMatches = historical.filter(
  (owner) => owner.name === slug,
);

assert.equal(localMatches.length, 1);
assert.equal(externalMatches.length, 0);
assert.equal(historicalMatches.length, 0);

assert.equal(
  localMatches[0].classification,
  "REQUIRED_LOCAL",
);
assert.equal(localMatches[0].path, sourcePath);
assert.equal(localMatches[0].caller, callerPath);

assert.equal(caller.includes(slug), true);

assert.equal(
  docs.includes(
    "`ticket-escalar-admin` está clasificada `REQUIRED_LOCAL`.",
  ),
  true,
);
assert.equal(
  docs.includes(
    "`crear-cliente-janome` y `crear-ticket-interno` continúan",
  ),
  true,
);
assert.equal(
  docs.includes(
    "`crear-cliente-janome`, `ticket-escalar-admin` y `crear-ticket-interno`",
  ),
  false,
);

for (const preserved of [
  "crear-cliente-janome",
  "crear-ticket-interno",
]) {
  assert.equal(
    externalized.filter(
      (owner) => owner.name === preserved,
    ).length,
    1,
  );
}

for (const preserved of [
  "estado-ticket-ts",
  "estado-ticket-responder-ts",
  "support-submit-secure",
]) {
  assert.equal(
    required.filter(
      (owner) => owner.name === preserved,
    ).length,
    1,
  );
}

assert.equal(
  workflow.match(
    /node tools\/edge-supervision-adoption-contract\.test\.mjs/g,
  )?.length ?? 0,
  1,
);

console.log("EDGE_SUPERVISION_ADOPTION_CONTRACT: PASS");
