import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const runner = readFileSync(
  "tools/l130-authenticated-qa/10_RUN_LOCAL_AUTH_E2E.sh",
  "utf8",
);

test(
  "canonical branch expansion is runtime-safe and single-line",
  () => {
    assert.match(
      runner,
      /EXPECTED_BRANCH="\$\{TC_CANONICAL_BRANCH:-test\/l130-authenticated-qa-prep-20260728\}"/,
    );

    assert.doesNotMatch(
      runner,
      /EXPECTED_BRANCH="\$\{\s/,
    );
  },
);

test(
  "fail terminates the runner directly",
  () => {
    const start = runner.indexOf("fail() {");
    const end = runner.indexOf("\n}", start);

    assert.ok(start >= 0);
    assert.ok(end > start);

    const block = runner.slice(start, end + 2);

    assert.match(block, /exit 1/);
    assert.doesNotMatch(block, /return 1/);
  },
);

test(
  "incomplete execution cannot return success",
  () => {
    const start = runner.indexOf("on_exit() {");
    const end = runner.indexOf(
      "trap on_exit EXIT",
      start,
    );

    assert.ok(start >= 0);
    assert.ok(end > start);

    const block = runner.slice(start, end);

    assert.match(
      block,
      /if \[\[ "\$final_rc" -eq 0 \]\]/,
    );

    assert.match(
      block,
      /final_rc=1/,
    );

    assert.match(
      block,
      /exit "\$final_rc"/,
    );
  },
);

test(
  "runner creates evidence before bootstrap",
  () => {
    const started = runner.indexOf(
      "00-runner-started.env",
    );

    const phase = runner.indexOf(
      "00-phase.env",
    );

    const runtime = runner.indexOf(
      'RUNTIME_DIR="$(mktemp',
    );

    assert.ok(started >= 0);
    assert.ok(phase >= 0);
    assert.ok(runtime >= 0);

    assert.ok(started < runtime);
    assert.ok(phase < runtime);
  },
);

test(
  "all runtime phases are persisted",
  () => {
    for (
      const phase of [
        "IDENTITY",
        "BOOTSTRAP",
        "AUTH_FIXTURES",
        "EDGE_RUNTIME",
        "B130_003",
        "B130_004",
        "TEARDOWN",
        "COMPLETE",
      ]
    ) {
      assert.match(
        runner,
        new RegExp(
          `write_phase "${phase}"`,
        ),
      );
    }
  },
);

test(
  "failure evidence contains semantic state",
  () => {
    assert.match(
      runner,
      /00-final-failure\.env/,
    );

    for (
      const field of [
        "ORIGINAL_EXIT_CODE",
        "FINAL_EXIT_CODE",
        "CURRENT_PHASE",
        "B130_003",
        "B130_004",
        "TEARDOWN_STATUS",
        "FINALIZED",
      ]
    ) {
      assert.match(
        runner,
        new RegExp(field),
      );
    }
  },
);

test(
  "PASS markers remain mandatory",
  () => {
    for (
      const marker of [
        "B130_003_EDGE_E2E=PASS",
        "B130_004_EDGE_E2E=PASS",
        "Q2_B130_003_004_EDGE_E2E=PASS",
      ]
    ) {
      assert.match(
        runner,
        new RegExp(marker),
      );
    }
  },
);

test(
  "remote environment denial remains present",
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
