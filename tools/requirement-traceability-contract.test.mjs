#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";
import { buildArtifacts, loadSource, validateSource } from "./generate-requirement-traceability.mjs";
import {
  buildGovernanceEvidence,
  loadGovernanceContract,
  loadGovernanceEvidence,
  validateGovernanceContract,
  verifyRepositoryProvenance
} from "./generate-governance-trace-evidence.mjs";

test("canonical points-first source is complete and deterministic", () => {
  const source = loadSource();
  const validation = validateSource(source);
  assert.deepEqual(validation.failures, []);
  const first = buildArtifacts(source, source.base);
  const second = buildArtifacts(source, source.base);
  assert.deepEqual(first, second);
  assert.equal(first.traceability.rowsEvaluated, 16);
  assert.equal(first.traceability.rowsPromotable, 7);
  assert.equal(first.traceability.netDelta, 4.85);
});

test("duplicate credit keys fail closed if any duplicate becomes promotable", () => {
  const source = structuredClone(loadSource());
  source.rows.find((row) => row.id === "U0-A").decision = "PROMOTABLE_LOCAL";
  const validation = validateSource(source);
  assert.equal(validation.ok, false);
  assert.match(validation.failures.join("\n"), /DOUBLE_CREDIT_PROMOTABLE:U0-HISTORICAL-SCOPE/);
});

test("already-credited reference cannot create a delta", () => {
  const source = loadSource();
  const { traceability } = buildArtifacts(source, source.base);
  const row = traceability.rows.find((candidate) => candidate.id === "TC-U043");
  assert.equal(row.decision, "ALREADY_CREDITED_REFERENCE_ONLY");
  assert.equal(row.proposedDelta, 0);
});

test("mutant with a credit regression is rejected", () => {
  const source = structuredClone(loadSource());
  source.rows[0].localCeiling = source.rows[0].currentCredit - 0.01;
  assert.match(validateSource(source).failures.join("\n"), /ROW_CREDIT_REGRESSION/);
});

test("governance closure evidence ties the exact five rows to files, tests, and a reachable commit", () => {
  const contract = loadGovernanceContract();
  const evidence = loadGovernanceEvidence();
  assert.deepEqual(validateGovernanceContract(contract).failures, []);
  assert.deepEqual(evidence, buildGovernanceEvidence(contract, evidence.closureCommit));
  assert.deepEqual(verifyRepositoryProvenance(contract, evidence).failures, []);
  assert.deepEqual(evidence.rows.map((row) => row.requirement), ["GOV-G0-003", "GOV-TRACE-001", "PROD170-002", "TC-U005", "TC-U078"]);
  assert.deepEqual(evidence.rows.filter((row) => row.disposition === "PROMOTABLE_LOCAL").map((row) => row.requirement), ["GOV-G0-003", "PROD170-002", "TC-U078"]);
  assert.equal(evidence.rows.some((row) => /^U0-[A-D]$/.test(row.requirement)), false);
  assert.equal(evidence.logicalDelta, "PENDING_LEDGER_RECONCILIATION");
});
