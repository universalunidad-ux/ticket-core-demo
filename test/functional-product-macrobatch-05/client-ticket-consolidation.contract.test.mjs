import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const ui = read("app/cliente.ui.js"), js = read("app/cliente.js");

test("tickets se paginan de diez en diez", () => assert.match(js, /renderTickets\(d, \{ page: ST\.ticketPage, size: 10 \}\)/));
test("paginador calcula páginas exactas", () => assert.match(ui, /Math\.ceil\(tickets\.length \/ safeSize\)/));
test("paginador corta sin repetir ni omitir", () => assert.match(ui, /tickets\.slice\(start, start \+ safeSize\)/));
test("contador muestra página sobre total", () => assert.match(ui, /\$\{safePage\}\/\$\{pages\}/));
test("flechas tienen nombres accesibles", () => {
  assert.match(ui, /aria-label="Tickets anteriores"/);
  assert.match(ui, /aria-label="Más tickets"/);
});
test("el estado de página vive fuera del hash de pestaña", () => assert.match(js, /ticketPage: 1/));
test("la pestaña se conserva al paginar", () => assert.doesNotMatch(js, /data-client-ticket-page[\s\S]{0,300}history\./));
test("vacío explica coincidencia potencial y decisión humana", () => {
  assert.match(ui, /coincidencias potenciales/);
  assert.match(ui, /una persona debe revisar la evidencia/);
});
test("sugerencia no se presenta como identidad confirmada", () => assert.match(ui, /no es una identidad confirmada/));
test("consolidación automática queda prohibida", () => assert.match(ui, /no se consolida nada automáticamente/));
test("trazabilidad requiere backend auditable", () => assert.match(ui, /operación backend transaccional, revalidada y auditable/));
