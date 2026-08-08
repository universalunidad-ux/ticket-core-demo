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

test("production Turnstile action remains support_submit", () => {
  assert.match(
    shared,
    /SUPPORT_TURNSTILE_ACTION[^\n=]*=\s*["']support_submit["']/,
  );
});

test("handler permits an environment-specific Turnstile action", () => {
  assert.match(
    handler,
    /Deno\.env\.get\(["']TURNSTILE_EXPECTED_ACTION["']\)/,
  );

  assert.match(
    handler,
    /TURNSTILE_EXPECTED_ACTION[\s\S]{0,220}\|\|\s*SUPPORT_TURNSTILE_ACTION/,
  );

  assert.match(
    handler,
    /action\s*:\s*TURNSTILE_EXPECTED_ACTION/,
  );
});

test("handler no longer fixes the validator call to production action", () => {
  assert.doesNotMatch(
    handler,
    /action\s*:\s*SUPPORT_TURNSTILE_ACTION\s*[,}]/,
  );
});
