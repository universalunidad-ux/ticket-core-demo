import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = path => readFileSync(join(root, path), "utf8");
const ticketsHtml = read("app/tickets.html");
const ticketHtml = read("app/ticket.html");
const ticketsJs = read("app/tickets.js");
const ticketJs = read("app/ticket.js");
const globalJs = read("app/global.js");
const globalCss = read("app/global.css");
const ticketCss = read("app/ticket.css");
const sw = read("app/sw.js");

test("la superficie obsoleta de workspace ya no se renderiza ni se enlaza", () => {
  for (const source of [ticketsHtml, ticketsJs]) {
    assert.doesNotMatch(source, /tkWorkspace|Contexto de mesa|Prioridad inteligente|Preparando contexto|Guardar vista|Restaurar/);
  }
});

test("detalle no muestra retorno contextual ni guía de resolución", () => {
  for (const source of [ticketHtml, ticketJs]) {
    assert.doesNotMatch(source, /tkReturnContext|tkWorkspaceReturn|Volver a la mesa|Recuperando la vista anterior/);
    assert.doesNotMatch(source, /Guía de resolución|tkResolutionWorkbench|data-resolution-open|createResolutionWorkbench/);
  }
  assert.match(ticketHtml, /id="tkResolveBtn"[^>]*>Cierre<\/button>/);
  assert.match(ticketHtml, /id="modeReplyBtn"[^>]*>Respuesta<\/button>/);
  assert.match(ticketHtml, /id="modeNoteBtn"[^>]*>Nota interna<\/button>/);
});

test("header usa copy exacta, logo amplio y owners de no solapamiento", () => {
  assert.match(globalJs, /placeholder="Buscar cliente, folio o caso"/);
  assert.doesNotMatch(globalJs, /<strong>\s*JANOME\s*<\/strong>/i);
  assert.match(globalCss, /\.app-brand img\{[^}]*width:(?:7[2-9]|8[0-2])px[^}]*height:(?:5[0-4])px[^}]*object-fit:contain/s);
  assert.match(globalCss, /\.app-head-inner\{[^}]*grid-template-columns:[^}]*minmax\(0,1fr\)[^}]*minmax\(0,/s);
  assert.match(globalCss, /\.app-nav\{[^}]*overflow:hidden/s);
  assert.match(globalCss, /\.app-search\{[^}]*width:clamp\([^}]*\)/s);
});

test("layout de ticket descuenta el header fijo y el sidebar conserva scroll y safe area", () => {
  assert.match(ticketCss, /body\[data-page="ticket"\] \.ticket-page\{[^}]*height:calc\(100dvh - var\(--app-header-h\)\)/s);
  assert.match(ticketCss, /body\[data-page="ticket"\] \.ticket-side\{[^}]*max-height:calc\(100dvh - var\(--app-header-h\)[^}]*overflow-y:auto[^}]*safe-area-inset-bottom/s);
  assert.match(ticketCss, /overflow-x:hidden/);
});

test("release P0 versiona assets y retira sólo caches propios anteriores", () => {
  assert.match(sw, /const RELEASE="frontend-p0-20260811-01"/);
  assert.doesNotMatch(sw, /frontend-final-20260716-01|workspace-hotfix-20260810-01/);
  assert.match(sw, /OWN_CACHE\.test\(key\)&&!\[STATIC_CACHE,PAGE_CACHE\]\.includes\(key\)/);
  assert.match(sw, /map\(key=>caches\.delete\(key\)\)/);
  assert.match(sw, /url\.searchParams\.get\("v"\)===RELEASE/);
});
