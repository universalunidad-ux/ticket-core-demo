import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile(new URL("../app/tickets.css", import.meta.url), "utf8");
const marker = css.indexOf("TC-Q1-A11Y-REFLOW-RESPONSIVE-L100-01");
assert(marker >= 0, "missing governed reflow fix marker");
const fix = css.slice(marker);

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
