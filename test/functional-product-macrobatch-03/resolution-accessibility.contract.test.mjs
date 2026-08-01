import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = path => readFileSync(join(root, path), "utf8");
const html = read("app/ticket.html");
const module = read("app/shared/ticket-resolution-workbench.js");

test("mantiene un único h1 en la página", () => {
  assert.equal((html.match(/<h1\b/g) || []).length, 1);
});

test("diálogo tiene nombre y descripción válidos", () => {
  assert.match(html, /aria-labelledby="tkResolutionTitle"/);
  assert.match(html, /id="tkResolutionTitle"/);
  assert.match(html, /aria-describedby="tkResolutionIntro"/);
  assert.match(html, /id="tkResolutionIntro"/);
});

test("controles de texto y progreso tienen nombre", () => {
  assert.match(html, /<label class="lbl" for="tkResolutionFinding">/);
  assert.match(html, /id="tkResolutionFinding"/);
  assert.match(html, /data-resolution-meter aria-label="Avance del playbook"/);
});

test("estado de avance se anuncia sin interrumpir", () => {
  assert.match(html, /data-resolution-summary role="status" aria-live="polite"/);
  assert.match(module, /aria-valuetext/);
});

test("foco y Escape se delegan al owner global", () => {
  assert.match(module, /openDialogOwner\(root/);
  assert.match(module, /onCloseRequest:\s*close/);
  assert.match(module, /closeDialogOwner\(root\)/);
  assert.doesNotMatch(module, /document\.addEventListener\("keydown"/);
});

test("no introduce tabindex positivo ni controles sin tipo", () => {
  assert.doesNotMatch(html, /tabindex="[1-9]/);
  const workbenchHtml = html.slice(html.indexOf('id="tkResolutionWorkbench"'));
  assert.equal((workbenchHtml.match(/<button\b/g) || []).length, (workbenchHtml.match(/<button[^>]+type="button"/g) || []).length);
});
