import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const handler = fs.readFileSync(
  new URL(
    "../supabase/functions/support-submit-secure/index.ts",
    import.meta.url,
  ),
  "utf8",
);

const shared = fs.readFileSync(
  new URL(
    "../supabase/functions/_shared/support-request-contract.ts",
    import.meta.url,
  ),
  "utf8",
);

test("missing action requires explicit staging sentinel", () => {
  assert.match(
    handler,
    /TURNSTILE_MISSING_ACTION_TEST_SENTINEL/,
  );

  assert.ok(
    handler.includes("__CLOUDFLARE_DUMMY_MISSING_ACTION__"),
  );

  assert.match(
    handler,
    /configured\s*===\s*TURNSTILE_MISSING_ACTION_TEST_SENTINEL[\s\S]*?return\s*["']["']/,
  );
});

test("production action fallback remains strict", () => {
  assert.match(
    handler,
    /configured\s*\|\|\s*SUPPORT_TURNSTILE_ACTION/,
  );
});

test("action is optional only when expected action is empty", () => {
  assert.match(
    shared,
    /expected\.action\s*!==\s*["']["'][\s\S]*?typeof\s+response\.action\s*!==\s*["']string["']/,
  );

  assert.match(
    shared,
    /response\.action\s*!==\s*expected\.action/,
  );

  assert.match(
    shared,
    /TURNSTILE_ACTION_MISMATCH/,
  );
});
