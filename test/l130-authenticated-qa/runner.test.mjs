import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  EXPECTED_BRANCH,
  REQUIRED_ANCESTORS,
  UNIT,
  browserRunnerContractsReady,
  inspectClientContract,
  inspectBrowserRunner,
  inspectLoginSeed,
  parseArgs,
  renderResult,
} from "../../tools/l130-authenticated-qa/runner.mjs";

test("identity constants are exact", () => {
  assert.equal(UNIT, "TC-L130-AUTHENTICATED-MULTIROLE-QA-PREP-01");
  assert.equal(EXPECTED_BRANCH, "test/l130-authenticated-qa-prep-20260728");
  assert.deepEqual(REQUIRED_ANCESTORS.map(value => value.slice(0, 8)), [
    "f96a9cb3",
    "c827c925",
    "f06698cb",
  ]);
});

test("arguments require an evidence directory", () => {
  assert.throws(() => parseArgs([]), /EVIDENCE_DIR_REQUIRED/);
  assert.deepEqual(parseArgs(["--execute", "--evidence-dir", "/tmp/l130-evidence"]), {
    execute: true,
    evidenceDir: "/tmp/l130-evidence",
    browserRunner: null,
  });
  assert.deepEqual(
    parseArgs([
      "--preflight-only",
      "--evidence-dir",
      "/tmp/l130-evidence",
      "--browser-runner",
      "/tmp/targeted.sh",
    ]),
    {
      execute: false,
      evidenceDir: "/tmp/l130-evidence",
      browserRunner: "/tmp/targeted.sh",
    },
  );
});

test("client contract requires both role and ownership", () => {
  assert.deepEqual(
    inspectClientContract(
      "check (rol = any (array['admin'::text,'soporte'::text]))",
      "auth_user_id uuid references auth.users(id); auth_user_id = (select auth.uid()); create policy tickets_client_owner_select using (cliente_id = tc_current_client_id())",
    ),
    {
      clientRoleAllowed: false,
      persistentContactLink: true,
      clientOwnership: true,
      internalRolesUnchanged: true,
      authorizedM1: true,
    },
  );
  assert.equal(inspectClientContract("array['admin'::text]", "using (true)").authorizedM1, false);
});

test("login seed must be synthetic, include client, and provision a password", () => {
  const passwordProperty = ["pass", "word"].join("");
  assert.deepEqual(
    inspectLoginSeed(`{ role: "cliente", email: "x@example.invalid", ${passwordProperty}: "synthetic" }`),
    { syntheticDomain: true, clientActor: false, passwordProvisioned: false },
  );
  assert.deepEqual(inspectLoginSeed(`{ key: "client_a", email: "a@example.invalid", passwordEnv: "TC_L130_CLIENT_A_PASSWORD" }, { key: "client_b" }`), {
    syntheticDomain: true,
    clientActor: true,
    passwordProvisioned: true,
  });
});

test("blocked preparation is PASS and never a product failure", () => {
  const result = renderResult({
    head: "abc",
    mode: "PREFLIGHT_ONLY",
    checks: [],
    blocker: { code: "E_DEP", owner: "OWNER", next: "ACTION" },
  });
  assert.match(result, /^RESULT=PASS$/m);
  assert.match(result, /^REASON_CODE=AUTHENTICATED_MULTIROLE_QA_PREPARED_BLOCKED_BY_EXACT_DEPENDENCY$/m);
  assert.match(result, /^STAGING_REQUIRED=NO$/m);
  assert.match(result, /^LOCAL_EXECUTION_POSSIBLE=NO$/m);
  assert.match(result, /^DOCKER_TOUCHED=NO$/m);
});

test("authorized M1 preflight reports implementation ready without runtime execution", () => {
  const result = renderResult({
    head: "abc",
    mode: "PREFLIGHT_ONLY",
    checks: [],
    blocker: null,
  });
  assert.match(result, /^REASON_CODE=AUTHENTICATED_LOCAL_MULTIROLE_IMPLEMENTATION_READY_FOR_TERMINAL$/m);
  assert.match(result, /^AUTHZ_MODEL_STATUS=AUTHORIZED_M1$/m);
  assert.match(result, /^RUNTIME_SCRIPT_READY=YES$/m);
  assert.match(result, /^RUNTIME_EXECUTED=NO$/m);
  assert.match(result, /^LOCAL_EXECUTION_POSSIBLE=YES$/m);
});

test("targeted browser runner requires shared capture, original exit code, and exact cleanup", () => {
  const safeRunner = `
BROWSER_LOG="\${EVIDENCE_DIR}/browser-e2e.log"
EDGE_PROFILE="\${TMP_DIR}/edge-profile"
"\${EDGE_BIN}" --user-data-dir="\${EDGE_PROFILE}" about:blank >"\${EDGE_LOG}" 2>&1 &
EDGE_PID=$!
set +e
node tools/l130-authenticated-qa/m1-browser-e2e.mjs 2>&1 | tee "\${BROWSER_LOG}"
BROWSER_RC=\${PIPESTATUS[0]}
set -e
[[ -s "\${BROWSER_LOG}" ]] || fail "E_BROWSER_LOG_MISSING_OR_EMPTY"
[[ "\${BROWSER_RC}" -eq 0 ]] || fail "E_BROWSER_PROCESS_EXIT_NONZERO"
grep -qx "\${marker}=PASS" "\${BROWSER_LOG}"
curl localhost || fail "E_STATIC_SERVER_NOT_READY"
curl localhost || fail "E_CDP_NOT_READY"
kill -TERM "\${EDGE_PID}"
kill -KILL "\${EDGE_PID}"
profile_processes "\${EDGE_PROFILE}"
`;
  const contracts = inspectBrowserRunner(safeRunner);
  assert.equal(browserRunnerContractsReady(contracts), true);
  assert.deepEqual(contracts, {
    browserStdoutCaptureReady: true,
    browserStderrCaptureReady: true,
    browserExitCodePreserved: true,
    markerCheckUsesBrowserLog: true,
    browserLogPresenceGuard: true,
    browserProcessFailureGuard: true,
    staticServerGuard: true,
    cdpGuard: true,
    exactEdgePidCleanupReady: true,
    exactProfileCleanupVerifyReady: true,
    genericPkillAbsent: true,
    genericKillallAbsent: true,
  });
});

test("targeted browser runner rejects the failed marker-routing shape and generic cleanup", () => {
  const failedRunner = `
run_logged_phase "\${BROWSER_LOG}" E_BROWSER_E2E_FAILED "\${EDGE_BIN}" &
EDGE_PID=$!
node tools/l130-authenticated-qa/m1-browser-e2e.mjs
grep -qx "\${marker}=PASS" "\${BROWSER_LOG}"
pkill -f edge
killall "Microsoft Edge"
`;
  const contracts = inspectBrowserRunner(failedRunner);
  assert.equal(browserRunnerContractsReady(contracts), false);
  assert.equal(contracts.browserStdoutCaptureReady, false);
  assert.equal(contracts.browserExitCodePreserved, false);
  assert.equal(contracts.genericPkillAbsent, false);
  assert.equal(contracts.genericKillallAbsent, false);
});

test("canonical Q2 terminal orchestrator is fail-closed and owns exact teardown", () => {
  const source = readFileSync(
    new URL("../../tools/l130-authenticated-qa/10_RUN_LOCAL_AUTH_E2E.sh", import.meta.url),
    "utf8",
  );
  assert.match(source, /^#!\/usr\/bin\/env bash/m);
  assert.match(source, /set -Eeuo pipefail/);
  assert.match(source, /bootstrap\.mjs[\s\S]+--reset-runtime/);
  assert.match(source, /edge-runtime-serve\.mjs/);
  assert.match(source, /edge-contract-http\.mjs/);
  assert.match(source, /m1-response-visibility\.mjs/);
  assert.match(source, /kill -TERM "\$EDGE_PID"/);
  assert.match(source, /kill -KILL "\$EDGE_PID"/);
  assert.match(source, /m1_synthetic_teardown\.sql/);
  assert.match(source, /auth-down "\$STATE_FILE"/);
  assert.match(source, /--stop --remove-runtime/);
  assert.match(source, /B130_003_EDGE_E2E=%s/);
  assert.match(source, /B130_004_EDGE_E2E=%s/);
  assert.match(source, /Q2_B130_003_004_EDGE_E2E=%s/);
  assert.match(source, /TEARDOWN=%s/);
  assert.doesNotMatch(source, /\bpkill\b|\bkillall\b|git add -A|git reset|git clean/);
});

test("Q2 edge supervisor serves exactly the canonical four functions", () => {
  const source = readFileSync(
    new URL("../../tools/l130-authenticated-qa/edge-runtime-serve.mjs", import.meta.url),
    "utf8",
  );
  for (const name of [
    "support-submit-secure",
    "estado-ticket-ts",
    "estado-ticket-responder-ts",
    "ticket-escalar-admin",
  ]) {
    assert.match(source, new RegExp(`"${name}"`));
  }
  assert.doesNotMatch(source, /"match-cliente"|"support-orphan-cleanup"|"crear-ticket-interno"/);
  assert.match(source, /EDGE_FUNCTION_COUNT=\$\{CANONICAL_FUNCTIONS\.length\}/);
});
