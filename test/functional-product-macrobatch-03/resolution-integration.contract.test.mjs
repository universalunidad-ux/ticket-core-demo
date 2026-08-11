import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = path => readFileSync(join(root, path), "utf8");
const html = read("app/ticket.html");
const ticket = read("app/ticket.js");

// UI-LOAD-P0 intentionally removes the standalone resolution workbench as
// product bloat. Ordinary reply, note, resolution, and close controls remain.
test("detalle no entrega ni monta la guía de resolución obsoleta", () => {
  assert.doesNotMatch(html, /ticket-resolution-workbench\.css|tkResolutionWorkbench|data-resolution-open|Guía de resolución/);
  assert.doesNotMatch(ticket, /ticket-resolution-workbench\.js|createResolutionWorkbench|mountResolutionWorkbench/);
});

test("respuesta, nota y cierre normales permanecen disponibles", () => {
  assert.match(html, /id="modeReplyBtn"[^>]*>Respuesta<\/button>/);
  assert.match(html, /id="modeNoteBtn"[^>]*>Nota interna<\/button>/);
  assert.match(html, /id="tkResolveBtn"[^>]*>Cierre<\/button>/);
  assert.match(html, /id="tkCloseCaseBtn"[^>]*>Cerrar caso<\/button>/);
  assert.match(ticket, /setComposerMode/);
  assert.match(ticket, /closeTicket/);
});
