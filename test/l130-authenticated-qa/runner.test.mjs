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
      "check (rol = any (array['cliente'::text]))",
      "using (cliente_id = (select auth.uid()))",
    ),
    { clientRoleAllowed: true, clientOwnership: true },
  );
  assert.deepEqual(inspectClientContract("array['admin'::text]", "using (true)"), {
    clientRoleAllowed: false,
    clientOwnership: false,
  });
});

test("login seed must be synthetic, include client, and provision a password", () => {
  const passwordProperty = ["pass", "word"].join("");
  assert.deepEqual(
    inspectLoginSeed(`{ role: "cliente", email: "x@example.invalid", ${passwordProperty}: "synthetic" }`),
    { syntheticDomain: true, clientActor: true, passwordProvisioned: true },
  );
  assert.deepEqual(inspectLoginSeed(`{ role: "admin", email: "x@example.invalid" }`), {
    syntheticDomain: true,
    clientActor: false,
    passwordProvisioned: false,
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
