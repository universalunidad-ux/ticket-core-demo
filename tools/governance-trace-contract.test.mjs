#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";
import { buildGovernanceEvidence, loadGovernanceContract, validateGovernanceContract } from "./generate-governance-trace-evidence.mjs";

test("governance closure scope is exact and executable", () => {
  const contract = loadGovernanceContract();
  assert.deepEqual(validateGovernanceContract(contract).failures, []);
  assert.deepEqual(contract.requirements.map((row) => row.id), ["GOV-G0-003", "GOV-TRACE-001", "PROD170-002", "TC-U005", "TC-U078"]);
  assert.equal(contract.requirements.some((row) => /^U0-[A-D]$/.test(row.id)), false);
});

test("governance evidence is deterministic and preserves no-credit dispositions", () => {
  const contract = loadGovernanceContract();
  const commit = "a".repeat(40);
  const first = buildGovernanceEvidence(contract, commit);
  const second = buildGovernanceEvidence(contract, commit);
  assert.deepEqual(first, second);
  assert.equal(first.rows.length, 5);
  assert.deepEqual(first.rows.filter((row) => row.disposition === "PROMOTABLE_LOCAL").map((row) => row.requirement), ["GOV-G0-003", "PROD170-002", "TC-U078"]);
  assert.equal(first.rows.find((row) => row.requirement === "GOV-TRACE-001").proposedDelta, 0);
  assert.equal(first.rows.find((row) => row.requirement === "TC-U005").proposedDelta, 0);
  assert.equal(first.logicalDelta, "PENDING_LEDGER_RECONCILIATION");
  assert.equal(first.u0RowsClaimed, false);
});

test("mutants cannot broaden scope, move test ownership, or award pending credit", () => {
  const scopeMutant = structuredClone(loadGovernanceContract());
  scopeMutant.requirements.push({ ...scopeMutant.requirements[0], id: "U0-A" });
  assert.match(validateGovernanceContract(scopeMutant).failures.join("\n"), /TARGET_SCOPE_INVALID|U0_ROW_CLAIMED/);

  const ownerMutant = structuredClone(loadGovernanceContract());
  ownerMutant.requirements[0].test = "tools/operations-contract.test.mjs";
  assert.match(validateGovernanceContract(ownerMutant).failures.join("\n"), /TEST_OWNER_DRIFT:GOV-G0-003/);

  const creditMutant = structuredClone(loadGovernanceContract());
  creditMutant.requirements.find((row) => row.id === "TC-U005").expectedDelta = 0.01;
  assert.match(validateGovernanceContract(creditMutant).failures.join("\n"), /DELTA_DRIFT:TC-U005|NON_PROMOTABLE_DELTA:TC-U005/);
});
