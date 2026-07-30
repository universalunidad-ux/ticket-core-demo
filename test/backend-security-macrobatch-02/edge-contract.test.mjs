import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const report = readFileSync(
  new URL("../../supabase/functions/_shared/report-client-error-handler.ts", import.meta.url),
  "utf8",
);
const health = readFileSync(
  new URL("../../supabase/functions/_shared/system-health-handler.ts", import.meta.url),
  "utf8",
);
const shared = readFileSync(
  new URL("../../supabase/functions/_shared/observability-contract.ts", import.meta.url),
  "utf8",
);

test("21 report endpoint has exact method contract", () => {
  assert.match(report, /request\.method === "OPTIONS"/);
  assert.match(report, /request\.method !== "POST"/);
  assert.match(report, /METHOD_NOT_ALLOWED/);
});

test("22 report endpoint enforces declared and actual body limits", () => {
  assert.match(report, /MAX_BODY_BYTES = 16 \* 1024/);
  assert.match(report, /content-length/);
  assert.match(report, /new TextEncoder\(\)\.encode\(text\)\.byteLength > MAX_BODY_BYTES/);
});

test("23 report endpoint rate limits fail closed", () => {
  assert.match(report, /await rateLimit\(service, "report_client_error"/);
  assert.match(report, /RATE_LIMITED/);
});

test("24 report endpoint uses exact RPC parameter names", () => {
  for (const parameter of [
    "p_fingerprint", "p_source", "p_severity", "p_code",
    "p_route", "p_release", "p_request_id", "p_context",
  ]) {
    assert.match(report, new RegExp(`${parameter}:`));
  }
});

test("25 report endpoint returns generic persistence error", () => {
  assert.match(report, /EVENT_UNAVAILABLE/);
  assert.doesNotMatch(report, /error\.message/);
});

test("26 health endpoint requires bearer and active admin", () => {
  assert.match(health, /\^Bearer /);
  assert.match(health, /\.eq\("rol", "admin"\)/);
  assert.match(health, /\.eq\("activo", true\)/);
});

test("27 health endpoint uses server-only aggregate RPC", () => {
  assert.match(health, /service\.rpc\("system_health_snapshot"\)/);
  assert.doesNotMatch(health, /\.from\("app_error_events"\)/);
});

test("28 neither endpoint uses wildcard CORS", () => {
  assert.doesNotMatch(report + health, /Access-Control-Allow-Origin":\s*"\*"/);
  assert.equal((report + health).match(/resolveAllowedOrigin/g)?.length, 4);
});

test("29 logs are emitted only through safeStructuredLog", () => {
  for (const source of [report, health]) {
    for (const match of source.matchAll(/console\.(?:log|error)\(([^;]+)\);/g)) {
      assert.match(match[1], /JSON\.stringify\(safeStructuredLog\(/);
    }
  }
});

test("30 shared contract blocks PII and secret-shaped keys", () => {
  for (const key of ["authorization", "cookie", "email", "message", "password", "payload", "phone", "secret", "stack", "token"]) {
    assert.match(shared, new RegExp(key));
  }
});
