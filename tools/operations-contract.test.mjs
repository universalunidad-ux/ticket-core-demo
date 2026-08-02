#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";
import { loadOperations, renderOperations, sanitizeEvent, validateOperations } from "./generate-operations-inventory.mjs";

const HEAD = "a".repeat(40);

test("runbook inventory is complete and generated deterministically", () => {
  const source = loadOperations();
  assert.deepEqual(validateOperations(source).failures, []);
  assert.equal(renderOperations(source), renderOperations(source));
  assert.match(renderOperations(source), /Do not publish, push, deploy/);
  assert.match(renderOperations(source), /zero listener\/process residue/);
});

test("structured event preserves only allowlisted operational fields", () => {
  const source = loadOperations();
  const event = sanitizeEvent(source, { timestamp: "2026-08-02T00:00:00Z", unit: "TC", phase: "A", scenario: "targeted", step: "contracts", result: "PASS", code: "OK", head: HEAD });
  assert.deepEqual(Object.keys(event), source.logContract.allowedFields);
});

test("PII and secret-shaped log fields fail closed", () => {
  const source = loadOperations();
  for (const key of ["email", "accessToken", "password", "requestBody"]) {
    assert.throws(() => sanitizeEvent(source, { result: "PASS", head: HEAD, [key]: "mutant" }), /FORBIDDEN_LOG_FIELD/);
  }
});

test("missing recovery steps are rejected", () => {
  const source = structuredClone(loadOperations());
  source.runbooks[0].recover = [];
  assert.match(validateOperations(source).failures.join("\n"), /RUNBOOK_SECTION_INCOMPLETE/);
});

test("unknown fields and invalid results are rejected", () => {
  const source = loadOperations();
  assert.throws(() => sanitizeEvent(source, { result: "PASS", head: HEAD, debug: true }), /UNKNOWN_LOG_FIELD/);
  assert.throws(() => sanitizeEvent(source, { result: "MAYBE", head: HEAD }), /LOG_RESULT_INVALID/);
});
