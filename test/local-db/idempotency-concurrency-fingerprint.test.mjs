import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  "supabase/tests/idempotency_concurrency.sql",
  "utf8",
);

const claimPattern =
  /public\.support_idem_claim\s*\(\s*'k-concurrency-1'\s*,\s*'([0-9a-f]{64})'\s*\)/gi;

const fingerprints = [
  ...sql.matchAll(claimPattern),
].map((match) => match[1]);

test(
  "concurrency fixture uses four canonical SHA-256 fingerprints",
  () => {
    assert.equal(fingerprints.length, 4);
    assert.equal(new Set(fingerprints).size, 1);
  },
);

test(
  "legacy short fingerprint is absent",
  () => {
    assert.doesNotMatch(
      sql,
      /support_idem_claim\s*\([^)]*'fp1'/i,
    );
  },
);

test(
  "fingerprint remains deterministic across retry states",
  () => {
    assert.equal(
      fingerprints.every(
        (value) =>
          /^[0-9a-f]{64}$/.test(value),
      ),
      true,
    );
  },
);

test(
  "test still covers initial, duplicate, succeeded and failed claims",
  () => {
    assert.match(
      sql,
      /primer reclamo debería ganar/i,
    );

    assert.match(
      sql,
      /segundo reclamo NO debería ganar/i,
    );

    assert.match(
      sql,
      /reusa respuesta succeeded/i,
    );

    assert.match(
      sql,
      /failed permite reintento/i,
    );
  },
);
