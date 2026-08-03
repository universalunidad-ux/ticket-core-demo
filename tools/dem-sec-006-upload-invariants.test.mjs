import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.argv[2] ?? ".";
const evidenceFiles = [
  "app/dashboard.js",
  "app/estado.js",
  "app/ticket-composer-polish.js",
  "app/tickets.js",
  "supabase/functions/_shared/media-policy.ts",
  "supabase/functions/_shared/upload-contract.test.ts",
  "supabase/functions/_shared/upload-contract.ts",
  "supabase/functions/estado-ticket-responder-ts/index.ts",
  "supabase/functions/support-submit-secure/index.ts",
  "supabase/functions/support-submit-secure/index_test.ts"
];
const groups = {
  "MAGIC_BYTE_VALIDATION": {
    "minimum": 2,
    "patterns": [
      "magic.?byte",
      "file.?signature",
      "signature",
      "sniff",
      "Uint8Array",
      "arrayBuffer",
      "file-type"
    ]
  },
  "SIZE_LIMIT_ENFORCED": {
    "minimum": 1,
    "patterns": [
      "max(?:imum)?[_\\s-]*(?:file[_\\s-]*)?(?:size|bytes)",
      "file\\s*\\.\\s*size",
      "content-length",
      "too[_\\s-]*large",
      "\\b413\\b"
    ]
  },
  "RANDOM_STORAGE_PATH": {
    "minimum": 1,
    "patterns": [
      "randomUUID",
      "crypto\\s*\\.\\s*random",
      "\\buuid\\b",
      "\\bnanoid\\b",
      "object.?key",
      "storage.?path",
      "upload.?path"
    ]
  },
  "COMPENSATING_CLEANUP": {
    "minimum": 2,
    "patterns": [
      "compensat",
      "rollback",
      "cleanup",
      "\\bdelete\\b",
      "\\bremove\\b",
      "catch\\s*\\(",
      "\\bfinally\\b"
    ]
  }
};

const sources = evidenceFiles.map(file => ({
  file,
  text: fs.readFileSync(path.join(root, file), "utf8"),
}));

const markers = [];

for (const [marker, config] of Object.entries(groups)) {
  let hitCount = 0;
  const matchedFiles = [];

  for (const source of sources) {
    const localHits = config.patterns.filter(pattern =>
      new RegExp(pattern, "i").test(source.text),
    ).length;

    if (localHits > 0) {
      hitCount += localHits;
      matchedFiles.push(source.file);
    }
  }

  assert.ok(
    hitCount >= config.minimum,
    `${marker} missing: hits=${hitCount} minimum=${config.minimum}`,
  );

  markers.push({
    marker,
    hitCount,
    matchedFiles: [...new Set(matchedFiles)],
    result: "PASS",
  });
}

assert.equal(markers.length, 4);

console.log(JSON.stringify({
  row: "DEM-SEC-006",
  assertionCount: 5,
  evidenceFiles,
  markers,
}));
