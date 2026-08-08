import assert from "node:assert/strict";
import test from "node:test";
import {
  errorFingerprint,
  parseClientErrorEvent,
  resolveAllowedOrigin,
  safeStructuredLog,
} from "../../supabase/functions/_shared/observability-contract.ts";

const valid = {
  code: "TICKET_LOAD_FAILED",
  severity: "error",
  route: "/app/tickets.html",
  release: "backend-security-02",
  requestId: "123e4567-e89b-42d3-a456-426614174000",
  context: {
    component: "tickets",
    operation: "load",
    http_status: 503,
    online: true,
    retryable: true,
    viewport_bucket: "desktop",
  },
};

test("41 positive event is normalized and frozen", () => {
  const result = parseClientErrorEvent(valid);
  assert.equal(result.ok, true);
  assert.equal(result.value.source, "browser");
  assert.equal(Object.isFrozen(result.value), true);
  assert.equal(Object.isFrozen(result.value.context), true);
});

test("42 unknown top-level key is rejected", () => {
  const result = parseClientErrorEvent({ ...valid, message: "raw exception" });
  assert.deepEqual(result, { ok: false, code: "EVENT_KEY_FORBIDDEN" });
});

test("43 PII-shaped context key is rejected", () => {
  const result = parseClientErrorEvent({
    ...valid,
    context: { ...valid.context, email: "person@example.invalid" },
  });
  assert.deepEqual(result, { ok: false, code: "EVENT_CONTEXT_KEY_FORBIDDEN" });
});

test("44 invalid request id is rejected", () => {
  const result = parseClientErrorEvent({ ...valid, requestId: "not-a-uuid" });
  assert.deepEqual(result, { ok: false, code: "EVENT_REQUEST_ID_INVALID" });
});

test("45 fingerprint is deterministic and full SHA-256", async () => {
  const parsed = parseClientErrorEvent(valid);
  assert.equal(parsed.ok, true);
  const first = await errorFingerprint(parsed.value);
  const second = await errorFingerprint(parsed.value);
  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
});

test("46 fingerprint changes with the stable error code", async () => {
  const first = parseClientErrorEvent(valid);
  const second = parseClientErrorEvent({ ...valid, code: "TICKET_SAVE_FAILED" });
  assert.equal(first.ok && second.ok, true);
  assert.notEqual(
    await errorFingerprint(first.value),
    await errorFingerprint(second.value),
  );
});

test("47 structured log excludes arbitrary fields and validates identity", () => {
  const output = safeStructuredLog({
    event: "client_error_recorded",
    level: "info",
    code: "TICKET_LOAD_FAILED",
    requestId: valid.requestId,
    status: 202,
    durationMs: 12.7,
  });
  assert.deepEqual(Object.keys(output).sort(), [
    "code", "duration_ms", "event", "level", "request_id", "status",
  ]);
  assert.throws(
    () => safeStructuredLog({
      event: "x",
      level: "error",
      requestId: valid.requestId,
    }),
    /LOG_EVENT_INVALID/,
  );
});

test("48 origin allowlist is exact and fail-closed", () => {
  const allowlist = "https://app.example.test,https://admin.example.test";
  assert.equal(
    resolveAllowedOrigin("https://app.example.test/", allowlist),
    "https://app.example.test",
  );
  assert.equal(
    resolveAllowedOrigin("https://evil.example.test", allowlist),
    "",
  );
  assert.equal(resolveAllowedOrigin(null, allowlist), "");
});
