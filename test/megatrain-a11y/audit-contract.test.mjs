import assert from "node:assert/strict";
import test from "node:test";
import { CANONICAL_A11Y_PAGES, auditHtml } from "../../tools/megatrain-a11y-audit.mjs";

const good = `<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width"><title>Fixture</title></head><body><main><h1>Fixture</h1><label for="q">Buscar</label><input id="q"><button type="button" aria-controls="panel">Abrir</button><section id="panel"><img alt="" src="x"></section><div role="dialog" aria-label="Detalle"></div></main></body></html>`;

test("canonical inventory is exact and contains no invented page", () => {
  assert.equal(CANONICAL_A11Y_PAGES.length, 14);
  assert.equal(new Set(CANONICAL_A11Y_PAGES).size, 14);
  assert.ok(CANONICAL_A11Y_PAGES.includes("index.html"));
  assert.ok(CANONICAL_A11Y_PAGES.includes("app/bitacora-admin.html"));
  assert.ok(!CANONICAL_A11Y_PAGES.includes("app/seguimiento.html"));
});

const mutations = [
  ["single-h1", html => html.replace("<h1>Fixture</h1>", "")],
  ["main-landmark", html => html.replace(/<\/?main>/g, match => match.includes("/") ? "</div>" : "<div>")],
  ["unique-id", html => html.replace("<section id=\"panel\">", "<section id=\"panel\"><i id=\"panel\"></i>")],
  ["aria-reference", html => html.replace("aria-controls=\"panel\"", "aria-controls=\"missing\"")],
  ["form-control-name", html => html.replace("<label for=\"q\">Buscar</label>", "")],
  ["button-type", html => html.replace(" type=\"button\"", "")],
  ["control-name", html => html.replace(" aria-controls=\"panel\">Abrir", ">").replace(" type=\"button\"", " type=\"button\"")],
  ["image-alternative", html => html.replace(" alt=\"\"", "")],
  ["positive-tabindex", html => html.replace("<input id=\"q\">", "<input id=\"q\" tabindex=\"2\">")],
  ["dialog-name", html => html.replace(" aria-label=\"Detalle\"", "")],
  ["document-language", html => html.replace(" lang=\"es\"", "")],
  ["document-title", html => html.replace("<title>Fixture</title>", "<title></title>")],
  ["mobile-viewport", html => html.replace(/<meta name="viewport"[^>]*>/, "")],
];

test("positive fixture passes every automated rule", () => assert.deepEqual(auditHtml(good).findings, []));
for (const [rule, mutate] of mutations) {
  test(`negative mutation fails ${rule}`, () => {
    const report = auditHtml(mutate(good));
    assert.ok(report.findings.some(finding => finding.rule === rule), JSON.stringify(report.findings));
  });
}
