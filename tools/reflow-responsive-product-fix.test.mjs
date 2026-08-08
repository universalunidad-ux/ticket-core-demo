import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile(new URL("../app/tickets.css", import.meta.url), "utf8");
const ticketCss = await readFile(new URL("../app/ticket.css", import.meta.url), "utf8");
const marker = css.indexOf("TC-Q1-A11Y-REFLOW-RESPONSIVE-L100-01");
assert(marker >= 0, "missing governed reflow fix marker");
const fix = css.slice(marker);
const ticketMarker = ticketCss.indexOf("TC-E04D555-A11Y360-TICKET-REFLOW");
assert(ticketMarker >= 0, "missing exact-head ticket reflow fix marker");
const ticketFix = ticketCss.slice(ticketMarker);

test("tablet header removes secondary metrics before actions clip", () => {
  assert.match(fix, /@media\(min-width:721px\) and \(max-width:900px\)/);
  assert.match(fix, /#tkMetricsStrip\s*\{\s*display:none!important;/);
  assert.match(fix, /\.hero-tools\s*\{[^}]*min-width:0!important;[^}]*flex:1 1 320px!important;/s);
  assert.match(fix, /\.hero-actions\s*\{[^}]*flex:0 0 auto!important;/s);
});

test("primary create-ticket target remains 44 by 44", () => {
  assert.match(fix, /#tkNewBtn\s*\{[^}]*width:44px!important;[^}]*min-width:44px!important;[^}]*height:44px!important;[^}]*min-height:44px!important;/s);
  assert.match(fix, /grid-template-columns:minmax\(0,1fr\) 34px 34px 44px!important;/);
});

test("ticket detail keeps its 320px thread inside the viewport", () => {
  assert.match(ticketFix, /@media\(max-width:340px\)/);
  assert.match(ticketFix, /\.ticket-thread > \*\s*\{[^}]*min-width:0!important;[^}]*max-width:100%!important;/s);
  assert.match(ticketFix, /\.thread-topbar\s*\{[^}]*grid-template-columns:34px minmax\(0,1fr\) minmax\(0,213px\)!important;/s);
  assert.match(ticketFix, /\.thread-actions\s*\{[^}]*min-width:0!important;[^}]*gap:4px!important;/s);
  assert.match(ticketFix, /\.resolution-launch\s*\{[^}]*max-width:108px!important;[^}]*text-overflow:ellipsis!important;/s);
});

test("ticket detail exposes the required pointer target sizes", () => {
  assert.match(ticketFix, /#tkWorkspaceReturn\s*\{[^}]*min-height:24px!important;[^}]*display:inline-flex!important;/s);
  assert.match(ticketFix, /\.composer-input-wrap\s*\{[^}]*min-height:48px!important;/s);
  assert.match(ticketFix, /#saveLogBtn\s*\{[^}]*width:44px!important;[^}]*min-width:44px!important;[^}]*height:44px!important;[^}]*min-height:44px!important;/s);
});
