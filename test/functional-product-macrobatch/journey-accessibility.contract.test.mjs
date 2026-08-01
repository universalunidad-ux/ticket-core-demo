import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = path => readFileSync(join(root, path), "utf8");

test("todas las superficies cargan el estilo operativo común", () => {
  for (const page of ["dashboard", "tickets", "ticket", "clientes", "cliente"]) {
    assert.match(read(`app/${page}.html`), /operations-journey\.css\?v=functional-product-macrobatch-01/);
  }
});

test("barra operativa tiene landmarks, estado vivo y controles etiquetados", () => {
  const source = read("app/shared/operations-journey.js");
  assert.match(source, /aria-label", "Recorrido operativo"/);
  assert.match(source, /aria-label="Navegación operativa"/);
  assert.match(source, /role="status" aria-live="polite"/);
  assert.match(source, /aria-describedby="tcOperationsHint"/);
  assert.match(source, /aria-current="page"/);
});

test("targets móviles, foco, error y movimiento reducido tienen contrato CSS", () => {
  const css = read("app/operations-journey.css");
  assert.match(css, /:focus-visible/);
  assert.match(css, /min-height:44px/);
  assert.match(css, /data-sync-state="error"/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(css, /overflow-x:auto/);
});

test("miniaturas de evidencia usan carga diferida y decodificación asíncrona", () => {
  const source = read("app/ticket.js");
  assert.ok((source.match(/loading="lazy" decoding="async"/g) || []).length >= 3);
  assert.match(source, /img\.loading="lazy";img\.decoding="async"/);
});
