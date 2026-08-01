import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = path => readFileSync(join(root, path), "utf8");
const pages = ["dashboard", "tickets", "ticket", "clientes", "cliente"];

const validateJourneySource = source => {
  assert.match(source, /createRunGate/);
  assert.match(source, /if \(active\) return active/);
  assert.match(source, /documentRef\.hidden/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /removeEventListener\("visibilitychange"/);
  assert.match(source, /pagehide/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /aria-busy/);
  assert.match(source, /sessionStorage/);
  assert.match(source, /url\.origin !== location\.origin/);
};

test("las cinco superficies montan el mismo recorrido operativo", () => {
  for (const page of pages) {
    const js = read(`app/${page}.js`);
    assert.match(js, /operations-journey\.js/, `${page}: import común ausente`);
    assert.match(js, new RegExp(`page:\\s*[\"']${page}[\"']`), `${page}: montaje ausente`);
  }
});

test("el recorrido implementa deduplicación, lifecycle y contexto fail-closed", () => {
  validateJourneySource(read("app/shared/operations-journey.js"));
});

test("mutantes de lifecycle y deduplicación son rechazados", () => {
  const source = read("app/shared/operations-journey.js");
  assert.throws(() => validateJourneySource(source.replace("if (active) return active;", "")));
  assert.throws(() => validateJourneySource(source.replaceAll("documentRef.hidden", "false")));
  assert.throws(() => validateJourneySource(source.replace('documentRef.removeEventListener("visibilitychange", visibility);', "")));
});

test("tickets sustituye el polling de red crudo por el scheduler común", () => {
  const source = read("app/tickets.js");
  const boot = source.slice(source.indexOf("const refreshTicketsJourney"), source.indexOf("window.addEventListener(\"error\""));
  assert.doesNotMatch(boot, /setInterval/);
  assert.match(boot, /intervalMs:60000/);
  assert.match(source, /LOAD_STALE_IGNORED/);
});

test("detalle conserva retorno a resultados y enlaza la ficha del cliente", () => {
  const source = read("app/ticket.js");
  assert.match(source, /TICKET_LIST_RETURN/);
  assert.match(source, /ticketJourney\?\.setClient/);
  assert.match(source, /intervalMs:20000/);
});

test("dashboard, directorio y ficha exponen reintento sin listeners duplicados", () => {
  assert.match(read("app/dashboard.js"), /refreshDashboardJourney/);
  const clients = read("app/clientes.js");
  assert.match(clients, /onRefresh:\s*async \(\) =>/);
  assert.match(clients, /await loadDirectory\(\)/);
  assert.match(clients, /CLIENTS_REFRESH_FAILED/);
  const client = read("app/cliente.js");
  assert.match(client, /ST\.cache = \{\}/);
  assert.match(client, /await openTab\(ST\.tab, false\)/);
  assert.match(client, /dataset\.clientTabsBound/);
});

test("búsqueda, filtros combinables y query state siguen conectados", () => {
  const tickets = read("app/tickets.js");
  assert.match(tickets, /tkSyncListUrl/);
  assert.match(tickets, /applyUrlFilters/);
  assert.match(tickets, /const filtered=\(\)=>TK\.filter/);
  assert.match(tickets, /LOAD_STALE_IGNORED/);
  const clients = read("app/clientes.js");
  assert.match(clients, /readQS/);
  assert.match(clients, /writeQS/);
  assert.match(clients, /ST\.reqSeq/);
  assert.match(clients, /if \(seq !== ST\.reqSeq\) return/);
});

test("loading, error, empty state y DOM IDs conservan contratos verificables", () => {
  for (const page of pages) {
    const html = read(`app/${page}.html`);
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
    assert.equal(new Set(ids).size, ids.length, `${page}: IDs duplicados`);
  }
  assert.match(read("app/tickets.js"), /ticketsLoading/);
  assert.match(read("app/tickets.js"), /ticketsError/);
  assert.match(read("app/clientes.js"), /ST\.loading/);
  assert.match(read("app/clientes.js"), /ST\.error/);
  assert.match(read("app/cliente.js"), /UI\.errorHtml/);
  assert.match(read("app/shared/operations-journey.js"), /No se pudo actualizar · Reintentar/);
});
