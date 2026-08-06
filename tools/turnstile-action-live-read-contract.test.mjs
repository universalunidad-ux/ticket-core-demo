import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(
  new URL(
    "../supabase/functions/support-submit-secure/index.ts",
    import.meta.url,
  ),
  "utf8",
);

test("Turnstile action is read for each request", () => {
  assert.match(
    source,
    /const\s+getTurnstileExpectedAction\s*=\s*\(\)\s*=>/,
  );

  assert.match(
    source,
    /Deno\.env\.get\(["']TURNSTILE_EXPECTED_ACTION["']\)/,
  );

  assert.match(
    source,
    /action\s*:\s*getTurnstileExpectedAction\(\)/,
  );

  assert.doesNotMatch(
    source,
    /const\s+TURNSTILE_EXPECTED_ACTION\s*=/,
  );
});

test("production fallback remains canonical", () => {
  assert.match(
    source,
    /Deno\.env\.get\(["']TURNSTILE_EXPECTED_ACTION["']\)[\s\S]{0,100}\|\|\s*SUPPORT_TURNSTILE_ACTION/,
  );
});
