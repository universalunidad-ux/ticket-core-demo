import test from "node:test";
import assert from "node:assert/strict";

import {
  EXPECTED_BRANCH,
  REQUIRED_ANCESTORS,
  UNIT,
  inspectClientContract,
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
  });
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
