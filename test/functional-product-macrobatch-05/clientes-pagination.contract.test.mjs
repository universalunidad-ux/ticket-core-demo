import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const js = read("app/clientes.js"), html = read("app/clientes.html"), css = read("app/clientes.css");

test("directorio usa doce clientes por página", () => assert.match(js, /const PAGE_SIZE = 12/));
test("selector visible refleja doce resultados", () => assert.match(html, /<option value="12" selected>12<\/option>/));
test("página solicitada se sanea antes de calcular el rango", () => {
  assert.match(js, /Number\.isFinite\(ST\.page\)/);
  assert.match(js, /ST\.page = Math\.min\(Math\.max\(1, requestedPage\), totalPages\)/);
});
test("tamaño inválido vuelve al tamaño canónico", () => assert.match(js, /Number\.isFinite\(ST\.size\).*PAGE_SIZE/));
test("el resumen no puede imprimir un rango NaN", () => assert.match(js, /const from = \(ST\.page - 1\) \* safeSize/));
test("los botones descartan páginas inválidas", () => assert.match(js, /!Number\.isFinite\(page\) \|\| page < 1/));
test("vacío admin usa texto neutral", () => assert.match(js, /No hay clientes registrados\./));
test("restricción AuthZ sólo se comunica a soporte", () => assert.match(js, /No hay clientes asignados dentro de su alcance autorizado\./));
test("fuente ya no describe productos como Sistemas", () => assert.doesNotMatch(js, /Sistemas se consultan/));
test("grid amplio es cuatro columnas", () => assert.match(css, /\.cl-cards\{[^}]*repeat\(4,minmax\(0,1fr\)\)/));
test("grid reduce progresivamente a tres columnas", () => assert.match(css, /max-width:1120px\)[^{]*\{\.cl-cards\{grid-template-columns:repeat\(3/));
test("grid reduce progresivamente a dos columnas", () => assert.match(css, /max-width:860px[\s\S]*\.cl-cards\{grid-template-columns:repeat\(2/));
test("grid móvil usa una columna", () => assert.match(css, /max-width:520px[\s\S]*\.cl-cards\{grid-template-columns:1fr/));
