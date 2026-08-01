import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const runner = readFileSync(
  "tools/l130-authenticated-qa/10_RUN_LOCAL_AUTH_E2E.sh",
  "utf8",
);

function exitBlock() {
  const start = runner.indexOf("on_exit() {");
  const end = runner.indexOf(
    "trap on_exit EXIT",
    start,
  );

  assert.ok(start >= 0);
  assert.ok(end > start);

  return runner.slice(start, end);
}

test(
  "bootstrap file already uses atomic creation with mode 600",
  () => {
    assert.match(
      runner,
      /install -m 600 \/dev\/null "\$BOOTSTRAP_FILE"/,
    );

    assert.doesNotMatch(
      runner,
      /chmod 600 "\$BOOTSTRAP_FILE"/,
    );
  },
);

test(
  "exit trap captures the original status under a unique name",
  () => {
    const block = exitBlock();

    assert.match(
      block,
      /local original_rc=\$\?/,
    );

    assert.doesNotMatch(
      block,
      /local rc=\$\?/,
    );
  },
);

test(
  "teardown cannot overwrite the original failure status",
  () => {
    const block = exitBlock();

    assert.match(
      block,
      /teardown \|\| true/,
    );

    assert.match(
      block,
      /exit "\$original_rc"/,
    );

    assert.doesNotMatch(
      block,
      /exit "\$rc"/,
    );
  },
);

test(
  "functional PASS markers remain mandatory",
  () => {
    assert.match(
      runner,
      /grep -qx 'B130_003_EDGE_E2E=PASS'/,
    );

    assert.match(
      runner,
      /grep -qx 'B130_004_EDGE_E2E=PASS'/,
    );

    assert.match(
      runner,
      /grep -qx 'Q2_B130_003_004_EDGE_E2E=PASS'/,
    );
  },
);

test(
  "canonical identity and remote-denial guards remain present",
  () => {
    assert.match(
      runner,
      /TC_CANONICAL_BRANCH/,
    );

    assert.match(
      runner,
      /TC_CANONICAL_HEAD/,
    );

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
