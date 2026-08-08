import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = path => readFileSync(join(root, path), "utf8");

test("controles tienen nombres, estado vivo y semántica de toggle", () => {
  const tickets = read("app/tickets.html");
  assert.match(tickets, /aria-labelledby="tkWorkspaceTitle"/);
  assert.match(tickets, /for="tkWorkspaceSort"/);
  assert.match(tickets, /id="tkWorkspaceStatus" role="status" aria-live="polite"/);
  assert.match(tickets, /id="tkWorkspaceDensity"[^>]+aria-pressed="false"/);
  const ticket = read("app/ticket.html");
  assert.match(ticket, /id="tkReturnContext" aria-label="Contexto de regreso"/);
  assert.match(ticket, /data-ticket-workspace-summary role="status" aria-live="polite"/);
});

test("layout responde en móvil y respeta reducción de movimiento", () => {
  const css = read("app/ticket-workspace.css");
  assert.match(css, /@media \(max-width: 720px\)/);
  assert.match(css, /grid-template-columns: 1fr 1fr/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /grid-column: 1 \/ -1/);
});

test("IDs permanecen únicos en ambas superficies", () => {
  for (const file of ["app/tickets.html", "app/ticket.html"]) {
    const ids = [...read(file).matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
    assert.equal(new Set(ids).size, ids.length, `${file}: IDs duplicados`);
  }
});
