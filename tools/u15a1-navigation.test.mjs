#!/usr/bin/env node
import { readFileSync as readWorkflowFileSync } from "node:fs";
/* TC-U15A-1 — pruebas de navegación canónica: los controles locales de volver/atrás
   fueron retirados de las páginas objetivo y no quedan referencias activas (HTML/CSS/JS).
   El header compartido (app-history) es el ÚNICO dueño de atrás/adelante. Cero red, cero DOM. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = path => readFileSync(join(root, path), "utf8");
let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`PASS ${name}`) } catch (error) { console.error(`FAIL ${name}: ${error.message}`); process.exitCode = 1 } };

const f = {
  ticketsHtml: read("app/tickets.html"), ticketsJs: read("app/tickets.js"), ticketsCss: read("app/tickets.css"),
  ticketHtml: read("app/ticket.html"), ticketJs: read("app/ticket.js"), ticketCss: read("app/ticket.css"),
  clienteHtml: read("app/cliente.html"), clienteJs: read("app/cliente.js"), clienteCss: read("app/cliente.css"),
  altaHtml: read("app/alta-cliente.html"), altaCss: read("app/alta-cliente.css"),
  consHtml: read("app/consolidacion-clientes.html"), consCss: read("app/consolidacion-clientes.css"),
  bitHtml: read("app/bitacora-admin.html"),
  globalJs: read("app/global.js"),
};

test("el header compartido conserva atrás/adelante (único dueño de navegación)", () => {
  assert.match(f.globalJs, /data-history="back"/, "botón atrás del header ausente");
  assert.match(f.globalJs, /data-history="forward"/, "botón adelante del header ausente");
});

test("tickets: retirado el volver local a Dashboard y sus referencias", () => {
  assert.doesNotMatch(f.ticketsHtml, /tkDashboardBack|tk-dashboard-back/, "control local sigue en HTML");
  assert.doesNotMatch(f.ticketsJs, /tkDashboardBack/, "referencia JS huérfana");
  assert.doesNotMatch(f.ticketsCss, /tk-dashboard-back/, "estilo huérfano");
  assert.doesNotMatch(f.ticketsCss, /grid-area:back|"back /, "columna/área de rejilla huérfana (hueco visual)");
  assert.match(f.ticketsHtml, /<h1>Tickets<\/h1>/, "título de la página debe permanecer");
});

test("ticket: retirada la flecha local a Tickets; se conserva el toggle de panel", () => {
  assert.doesNotMatch(f.ticketHtml, /tkBackToTickets|tk-back-arrow/, "flecha local sigue en HTML");
  assert.doesNotMatch(f.ticketJs, /syncTicketBackLink|tkBackToTickets/, "referencia JS huérfana");
  assert.doesNotMatch(f.ticketCss, /tkBackToTickets|tk-back-arrow/, "estilo huérfano");
  assert.match(f.ticketHtml, /id="tkSideToggle"/, "el toggle de panel (no navegación) debe permanecer");
});

test("cliente: retirado el volver local y sus referencias", () => {
  assert.doesNotMatch(f.clienteHtml, /cfBack|cf-back/, "control local sigue en HTML");
  assert.doesNotMatch(f.clienteJs, /cfBack/, "referencia JS huérfana");
  assert.doesNotMatch(f.clienteCss, /\.cf-back/, "estilo huérfano");
});

test("alta-cliente: retirado el volver local y el kicker 'Módulo interno'", () => {
  assert.doesNotMatch(f.altaHtml, /ac-back/, "control local sigue en HTML");
  assert.doesNotMatch(f.altaCss, /\.ac-back/, "estilo huérfano");
  assert.doesNotMatch(f.altaHtml, /Módulo interno/, "kicker 'Módulo interno' debe retirarse");
  assert.match(f.altaHtml, /<h1>Cliente nuevo<\/h1>/, "título debe permanecer");
});

test("consolidación: retirado el volver; kicker gris/mayúsculo y un único H1", () => {
  assert.doesNotMatch(f.consHtml, /cq-back/, "control local sigue en HTML");
  assert.doesNotMatch(f.consCss, /\.cq-back/, "estilo huérfano");
  assert.doesNotMatch(f.consHtml, /Módulo interno/, "kicker anterior debe retirarse");
  assert.match(f.consHtml, /section-kicker[^>]*>CONSOLIDACIÓN DE CLIENTES</, "kicker mayúsculo ausente");
  assert.equal((f.consHtml.match(/<h1[ >]/g) || []).length, 1, "debe existir exactamente un H1");
  assert.match(f.consHtml, /id="cqTotal"/, "el contador de la cabecera debe permanecer");
});

test("bitácora: retirado 'Volver a Dashboard'", () => {
  assert.doesNotMatch(f.bitHtml, /Volver a Dashboard/, "enlace de retorno debe retirarse");
  assert.match(f.bitHtml, /Actividad y auditoría del sistema/, "título debe permanecer");
});

test("no quedan textos de volver/atrás locales en las páginas objetivo", () => {
  for (const [name, html] of [["ticket", f.ticketHtml], ["cliente", f.clienteHtml], ["alta", f.altaHtml], ["consolidacion", f.consHtml], ["bitacora", f.bitHtml], ["tickets", f.ticketsHtml]]) {
    assert.doesNotMatch(html, /aria-label="Volver a[^"]*"|aria-label="Volver al[^"]*"/, `${name}: control 'Volver' local persiste`);
  }
});

if (!process.exitCode)
test("prueba TC-U15A-1 (navegación) registrada en CI", () => {
  const workflow = readWorkflowFileSync(
    new URL(
      "../.github/workflows/frontend-gates.yml",
      import.meta.url,
    ),
    "utf8",
  );
  assert.ok(
    workflow.includes(
      "node tools/u15a1-navigation.test.mjs",
    ),
  );
});

console.log(`U15A1_NAVIGATION_TESTS=PASS (${passed})`);
