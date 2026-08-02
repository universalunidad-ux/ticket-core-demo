#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";
import { buildArtifacts, loadSource, validateSource } from "./generate-requirement-traceability.mjs";

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
