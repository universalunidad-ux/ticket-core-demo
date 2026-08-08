import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const preflight = readFileSync(
  "supabase/tests/security_definer_preflight.sql",
  "utf8",
);

const recovery = readFileSync(
  "tools/local-db/recovery-signature.sql",
  "utf8",
);

const SAFE_PATH = "search_path=pg_catalog, public";
const EXISTING_PATH = "search_path=public";
const UNSAFE_PATH = "search_path=attacker, public";

function count(source, value) {
  return source.split(value).length - 1;
}

test(
  "preflight recognizes pg_catalog public in both projections",
  () => {
    assert.equal(count(preflight, SAFE_PATH), 2);
    assert.equal(count(preflight, EXISTING_PATH), 2);
  },
);

test(
  "recovery signature recognizes pg_catalog public in both checks",
  () => {
    assert.equal(count(recovery, SAFE_PATH), 2);
    assert.ok(count(recovery, EXISTING_PATH) >= 2);
  },
);

test(
  "allowlists remain exact",
  () => {
    assert.equal(count(preflight, UNSAFE_PATH), 0);
    assert.equal(count(recovery, UNSAFE_PATH), 0);

    assert.doesNotMatch(
      preflight,
      /proconfig\s+is\s+not\s+null/i,
    );

    assert.doesNotMatch(
      recovery,
      /proconfig\s+is\s+not\s+null/i,
    );
  },
);

test(
  "safe path is joined through explicit OR containment",
  () => {
    for (const source of [preflight, recovery]) {
      assert.match(
        source,
        /search_path=public[\s\S]{0,180}or[\s\S]{0,180}search_path=pg_catalog, public/,
      );
    }
  },
);
