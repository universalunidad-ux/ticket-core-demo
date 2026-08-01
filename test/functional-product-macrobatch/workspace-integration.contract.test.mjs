import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = path => readFileSync(join(root, path), "utf8");

test("mesa conecta guardar, restaurar, orden y densidad", () => {
  const html = read("app/tickets.html");
  const js = read("app/tickets.js");
  for (const id of ["tkWorkspaceSort", "tkWorkspaceDensity", "tkWorkspaceSave", "tkWorkspaceRestore", "tkWorkspaceStatus"]) {
    assert.match(html, new RegExp(`id="${id}"`));
    assert.match(js, new RegExp(id));
  }
  assert.match(js, /TK_WORKSPACE_STORE\.write\(tkWorkspaceSnapshot\(\)\)/);
  assert.match(js, /tkApplyWorkspace\(TK_WORKSPACE_STORE\.read\(\)\)/);
  assert.match(js, /tkSyncListUrl\(\{column:safe\.column,page:safe\.page\}\)/);
});

test("carga cancela fetch anterior y conserva guardas anti-stale", () => {
  const source = read("app/tickets.js");
  assert.match(source, /TK_REQUESTS\.begin\(\)/);
  assert.match(source, /fetchTicketsRest\(request\.signal\)/);
  assert.match(source, /signal\}\)/);
  assert.match(source, /request\.isLatest\(\)/);
  assert.match(source, /LOAD_STALE_IGNORED/);
  assert.match(source, /AbortError/);
  assert.match(source, /pagehide/);
});

test("detalle usa retorno explícito o snapshot validado", () => {
  const source = read("app/ticket.js");
  assert.match(source, /QS\.has\("return"\)\?TICKET_LIST_RETURN:ticketWorkspaceReturnHref\(state\)/);
  assert.match(source, /syncTicketWorkspaceReturn\(\)/);
  assert.match(source, /tkConversationRetry/);
  assert.doesNotMatch(source, /onclick="location\.reload/);
});

test("mutantes de cancelación, persistencia y retorno son detectables", () => {
  const source = read("app/shared/ticket-workspace.js");
  const validate = value => {
    assert.match(value, /active\?\.abort\?\.\(\)/);
    assert.match(value, /token === sequence/);
    assert.match(value, /storage\?\.setItem/);
    assert.match(value, /new URLSearchParams/);
  };
  validate(source);
  assert.throws(() => validate(source.replaceAll("active?.abort?.()", "")));
  assert.throws(() => validate(source.replaceAll("token === sequence", "true")));
  assert.throws(() => validate(source.replace("storage?.setItem", "void")));
});
