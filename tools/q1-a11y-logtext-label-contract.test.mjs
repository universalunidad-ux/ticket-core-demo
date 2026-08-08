import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const ticketHtmlPath = resolve(repoRoot, "app", "ticket.html");

function visibleText(fragment) {
  return fragment
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

test("ticket composer message textarea has one explicit label", () => {
  const html = readFileSync(ticketHtmlPath, "utf8");

  const textareaMatches = [
    ...html.matchAll(
      /<textarea\b[^>]*\bid=(["'])logText\1[^>]*><\/textarea>/gi,
    ),
  ];

  assert.equal(
    textareaMatches.length,
    1,
    "Expected exactly one textarea#logText",
  );

  const labelMatches = [
    ...html.matchAll(
      /<label\b[^>]*\bfor=(["'])logText\1[^>]*>([\s\S]*?)<\/label>/gi,
    ),
  ];

  assert.equal(
    labelMatches.length,
    1,
    "textarea#logText must have exactly one explicit <label for>",
  );

  assert.ok(
    visibleText(labelMatches[0][2]).length > 0,
    "The explicit label must contain accessible text",
  );

  assert.ok(
    labelMatches[0].index < textareaMatches[0].index,
    "The label must precede textarea#logText in the composer",
  );

  assert.match(
    textareaMatches[0][0],
    /\bplaceholder=(["'])Escribe una respuesta\.\1/i,
    "The existing user-facing placeholder must be preserved",
  );
});
