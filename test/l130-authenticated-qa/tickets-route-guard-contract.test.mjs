import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(
  new URL("../../app/tickets.html", import.meta.url),
  "utf8",
);

const source = fs.readFileSync(
  new URL("../../app/tickets.js", import.meta.url),
  "utf8",
);

const nav = fs.readFileSync(
  new URL("../../app/shared/nav-interna.js", import.meta.url),
  "utf8",
);

assert.match(
  html,
  /<script[^>]+type=["']module["'][^>]+src=["'][^"']*tickets\.js/i,
  "tickets.html must load tickets.js as a module.",
);

assert.match(
  nav,
  /\bexport\s+(?:async\s+)?function\s+mountNav\b|\bexport\s+const\s+mountNav\b/,
  "nav-interna.js must export mountNav.",
);

const importMatches = [
  ...source.matchAll(
    /import\s*\{[^}]*\bmountNav\b[^}]*\}\s*from\s*["']\.\/shared\/nav-interna\.js["']/gs,
  ),
];

assert.equal(
  importMatches.length,
  1,
  "tickets.js must import mountNav exactly once.",
);

const callMatches = [
  ...source.matchAll(
    /\bmountNav\s*\(\s*["']tickets["']\s*\)/g,
  ),
];

assert.equal(
  callMatches.length,
  1,
  'tickets.js must call mountNav("tickets") exactly once.',
);

const firstExecutablePrefix =
  'import { mountNav } from "./shared/nav-interna.js";\n' +
  'await mountNav("tickets");\n';

assert.ok(
  source.startsWith(firstExecutablePrefix),
  "The route guard must execute before all existing tickets.js behavior.",
);

for (const pattern of [
  /\?\?\s*["']soporte["']/g,
  /\|\|\s*["']soporte["']/g,
]) {
  for (const match of source.matchAll(pattern)) {
    assert.ok(
      callMatches[0].index < match.index,
      "The route guard must run before a missing-profile fallback to soporte.",
    );
  }
}

console.log("PASS tickets route guard executes before existing ticket logic");
