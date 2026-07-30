import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const css = readFileSync(join(root, "app/ticket-resolution-workbench.css"), "utf8");

test("modal limita ancho y alto al viewport", () => {
  assert.match(css, /width:min\(920px,calc\(100vw - 28px\)\)/);
  assert.match(css, /max-height:min\(820px,calc\(100dvh - 28px\)\)/);
});

test("flujo móvil colapsa a una columna", () => {
  assert.match(css, /@media \(max-width:760px\)/);
  assert.match(css, /\.resolution-layout\{grid-template-columns:1fr\}/);
});

test("acciones móviles conservan targets amplios", () => {
  assert.match(css, /\.resolution-actions button\{width:100%\}/);
  assert.match(css, /min-height:42px/);
});

test("respeta reducción de movimiento", () => {
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)/);
  assert.match(css, /transition:none!important/);
});
