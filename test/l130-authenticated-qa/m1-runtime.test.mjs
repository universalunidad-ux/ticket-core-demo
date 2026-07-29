import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  ACTORS, IDS, MARKER, assertLocalApiUrl, redact,
} from "../../tools/l130-authenticated-qa/m1-runtime.mjs";

const ROOT = resolve(import.meta.dirname, "..", "..");

test("M1 actors are deterministic, synthetic, and distinct", () => {
  assert.equal(MARKER, "TC_L130_M1_SYNTHETIC_V1");
  assert.deepEqual(ACTORS.map(actor => actor.key), ["client_a", "client_b", "support", "admin"]);
  assert.equal(new Set(ACTORS.map(actor => actor.email)).size, 4);
  assert.ok(ACTORS.every(actor => actor.email.endsWith("@example.invalid")));
  assert.equal(new Set(Object.values(IDS)).size, 8);
});

test("local API guard rejects remote, credentials, and TLS targets", () => {
  assert.equal(assertLocalApiUrl("http://127.0.0.1:54321").hostname, "127.0.0.1");
  assert.equal(assertLocalApiUrl("http://localhost:54321").hostname, "localhost");
  assert.throws(() => assertLocalApiUrl("https://project.supabase.co"), /E_REMOTE_SUPABASE_DENIED/);
  assert.throws(() => assertLocalApiUrl("http://user:pass@localhost:54321"), /E_REMOTE_SUPABASE_DENIED/);
  assert.throws(() => assertLocalApiUrl("https://localhost:54321"), /E_REMOTE_SUPABASE_DENIED/);
});

test("runtime redaction removes bearer, apikey, password, and JWT values", () => {
  const input = "Bearer abc.def.ghi apikey=secret password=hunter2 eyJabcdef.ghijkl.mnopqr";
  const output = redact(input);
  assert.doesNotMatch(output, /secret|hunter2|eyJabcdef/);
});

test("seed and teardown are local, marker-scoped, and cover two clients", () => {
  const seed = readFileSync(resolve(ROOT, "supabase/tests/l130_m1_synthetic_seed.sql"), "utf8");
  const teardown = readFileSync(resolve(ROOT, "supabase/tests/l130_m1_synthetic_teardown.sql"), "utf8");
  assert.match(seed, /M1_SEED_CLIENTS=2/);
  assert.match(seed, /M1_SEED_TICKETS=4/);
  assert.match(seed, /auth_user_id/);
  assert.match(seed, /@example\.invalid/g);
  assert.match(teardown, /M1_RESIDUAL_ROWS=0/);
  assert.doesNotMatch(`${seed}\n${teardown}`, /staging|supabase\.co/i);
});

test("browser harness covers login, reload, internal denial, logout, and post-logout denial", () => {
  const source = readFileSync(resolve(ROOT, "tools/l130-authenticated-qa/m1-browser-e2e.mjs"), "utf8");
  for (const marker of [
    "BROWSER_CLIENT_LOGIN=PASS",
    "BROWSER_SESSION_RELOAD=PASS",
    "BROWSER_INTERNAL_ROUTE_DENIAL=PASS",
    "BROWSER_LOGOUT=PASS",
    "BROWSER_POST_LOGOUT_DENIAL=PASS",
  ]) assert.match(source, new RegExp(marker));
  assert.doesNotMatch(source, /service[_-]?role/i);
});
