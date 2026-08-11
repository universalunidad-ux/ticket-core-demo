import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = path => readFileSync(join(root, path), "utf8");

test("superficies obsoletas no dejan controles ocultos enfocables", () => {
  assert.doesNotMatch(read("app/tickets.html"), /tkWorkspace|tkWorkspaceSort|tkWorkspaceDensity/);
  assert.doesNotMatch(read("app/ticket.html"), /tkReturnContext|tkWorkspaceReturn|data-ticket-workspace-summary/);
});

test("IDs permanecen únicos en ambas superficies", () => {
  for (const file of ["app/tickets.html", "app/ticket.html"]) {
    const ids = [...read(file).matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
    assert.equal(new Set(ids).size, ids.length, `${file}: IDs duplicados`);
  }
});
