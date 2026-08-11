import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = path => readFileSync(join(root, path), "utf8");

test("mesa elimina controles workspace y conserva coordinador anti-stale", () => {
  const html = read("app/tickets.html");
  const js = read("app/tickets.js");
  assert.doesNotMatch(html, /tkWorkspace|Contexto de mesa|Prioridad inteligente|Guardar vista|Restaurar/);
  assert.doesNotMatch(js, /tkBindWorkspace|TK_WORKSPACE_STORE|tkWorkspaceStatus/);
  assert.match(js, /createLatestRequestCoordinator/);
  assert.match(js, /TK_REQUESTS\.begin\(\)/);
  assert.match(js, /request\.isLatest\(\)/);
  assert.match(js, /LOAD_STALE_IGNORED/);
});

test("carga cancela fetch anterior y mantiene cleanup", () => {
  const source = read("app/tickets.js");
  assert.match(source, /fetchTicketsRest\(request\.signal\)/);
  assert.match(source, /AbortError/);
  assert.match(source, /pagehide/);
  assert.match(source, /TK_REQUESTS\.destroy\(\)/);
});

test("detalle no renderiza retorno redundante", () => {
  const source = read("app/ticket.html");
  assert.doesNotMatch(source, /tkReturnContext|tkWorkspaceReturn|Volver a la mesa|Recuperando la vista anterior/);
});
