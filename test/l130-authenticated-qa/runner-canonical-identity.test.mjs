import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const runner = readFileSync(
  "tools/l130-authenticated-qa/10_RUN_LOCAL_AUTH_E2E.sh",
  "utf8",
);

test(
  "runner still requires one explicit evidence directory",
  () => {
    assert.match(
      runner,
      /\$\{1:-\}" == "--evidence-dir"/,
    );

    assert.match(
      runner,
      /# -eq 2/,
    );

    assert.match(
      runner,
      /fail "E_USAGE"/,
    );
  },
);

test(
  "runner accepts an explicit canonical branch",
  () => {
    assert.match(
      runner,
      /TC_CANONICAL_BRANCH/,
    );

    assert.match(
      runner,
      /ACTUAL_BRANCH/,
    );

    assert.match(
      runner,
      /E_BRANCH_IDENTITY/,
    );
  },
);

test(
  "runner optionally binds execution to an exact canonical head",
  () => {
    assert.match(
      runner,
      /EXPECTED_HEAD="\$\{TC_CANONICAL_HEAD:-\}"/,
    );

    assert.match(
      runner,
      /git -C "\$REPO" rev-parse HEAD/,
    );

    assert.match(
      runner,
      /E_HEAD_IDENTITY/,
    );
  },
);

test(
  "legacy branch remains only as backward-compatible default",
  () => {
    assert.match(
      runner,
      /test\/l130-authenticated-qa-prep-20260728/,
    );

    assert.doesNotMatch(
      runner,
      /branch --show-current\)" == "test\/l130-authenticated-qa-prep-20260728"/,
    );
  },
);

test(
  "identity overrides do not weaken remote environment denial",
  () => {
    for (
      const variable of [
        "SUPABASE_ACCESS_TOKEN",
        "SUPABASE_PROJECT_ID",
        "SUPABASE_PROJECT_REF",
        "STAGING_URL",
        "DATABASE_URL",
      ]
    ) {
      assert.match(
        runner,
        new RegExp(variable),
      );
    }
  },
);
