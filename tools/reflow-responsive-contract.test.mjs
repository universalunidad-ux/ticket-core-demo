import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./reflow-responsive-cdp.mjs", import.meta.url), "utf8");

test("contract: exact canonical page set and five required widths", () => {
  const pages = [
    "app/alta-cliente.html",
    "app/aviso-privacidad.html",
    "app/bitacora-admin.html",
    "app/cliente.html",
    "app/clientes.html",
    "app/consolidacion-clientes.html",
    "app/dashboard.html",
    "app/estado.html",
    "app/index.html",
    "app/soporte.html",
    "app/terminos.html",
    "app/ticket.html",
    "app/tickets.html",
  ];
  for (const page of pages) assert.match(source, new RegExp(`"${page.replaceAll(".", "\\.")}"`));
  for (const width of [320, 375, 390, 768, 1280]) assert.match(source, new RegExp(`width: ${width}\\b`));
  assert.match(source, /CANONICAL_PAGES/);
  assert.match(source, /PAGES\.length \* VIEWPORTS\.length/);
});

test("contract: reflow signals and adjudication classes remain explicit", () => {
  for (const signal of [
    "scrollWidth", "clientWidth", "VISIBLE_OUTSIDE_VIEWPORT", "FALSE_POSITIVE_INVISIBLE",
    "CONTENT_HIDDEN_BY_BREAKPOINT_OR_RUNTIME_STATE", "INTENTIONAL_TABLE_SCROLL",
    "TARGET_BELOW_24", "PRIMARY_TARGET_BELOW_44", "INTERACTIVE_OVERLAP",
    "INTENTIONAL_COMPOSITE_CONTROL", "TEXT_CLIPPED",
  ]) assert.match(source, new RegExp(signal));
});

test("contract: local-only CDP, deterministic cleanup, and required artifacts", () => {
  assert.match(source, /execFileSync\("git", \["-C", ROOT, "rev-parse", "HEAD"\]/);
  assert.match(source, /EXACT_HEAD=/);
  assert.doesNotMatch(source, /BASE_COMMIT\s*=\s*"[0-9a-f]{40}"/);
  assert.match(source, /LOCALHOST_ONLY_CDP_FETCH_ABORT/);
  assert.match(source, /Fetch\.failRequest/);
  assert.match(source, /await stopChild\(edge\)/);
  assert.match(source, /server\.close/);
  assert.match(source, /await rm\(profile, \{ recursive: true, force: true \}\)/);
  for (const artifact of [
    "00_FINAL_RESULT.txt", "00_terminal.log", "01_PAGE_VIEWPORT_MATRIX.tsv",
    "02_OVERFLOW_FINDINGS.tsv", "03_CONTROL_SIZE_FINDINGS.tsv", "04_CLIPPING_FINDINGS.tsv",
    "05_ADJUDICATION.tsv", "06_DECISION.md", "07_PROVENANCE.txt", "99_CLIPBOARD_SUMMARY.txt",
  ]) assert.match(source, new RegExp(artifact.replaceAll(".", "\\.")));
});

test("contract: scope excludes general AX and contrast execution", () => {
  assert.doesNotMatch(source, /axe-core|pa11y|lighthouse/i);
  assert.doesNotMatch(source, /contrastRatio|getContrast|color-contrast/i);
  assert.doesNotMatch(source, /\.jn-wa-pill\s*\{/);
  assert.doesNotMatch(source, /logText\s*\.(?:textContent|innerHTML|value)\s*=/);
});
