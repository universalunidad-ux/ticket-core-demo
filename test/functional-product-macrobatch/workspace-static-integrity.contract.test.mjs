import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = path => readFileSync(join(root, path), "utf8");

test("referencias locales nuevas existen", () => {
  for (const htmlFile of ["app/tickets.html", "app/ticket.html"]) {
    const html = read(htmlFile);
    for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const ref = match[1].split(/[?#]/)[0];
      if (!ref || /^(?:https?:|#|data:)/.test(ref)) continue;
      assert.equal(existsSync(join(root, "app", ref)), true, `${htmlFile}: referencia inválida ${ref}`);
    }
  }
});

test("módulo no inventa APIs ni dependencias remotas", () => {
  const source = read("app/shared/ticket-workspace.js");
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /supabase|service_role|rpc\s*\(/i);
  assert.doesNotMatch(source, /https?:\/\//);
});

test("binding de workspace es idempotente y tiene cleanup", () => {
  const source = read("app/tickets.js");
  assert.match(source, /dataset\.tkWorkspaceBound/);
  assert.match(source, /TK_REQUESTS\.destroy\(\)/);
  assert.match(source, /\{once:true\}/);
  assert.equal((source.match(/const tkBindWorkspace=/g) || []).length, 1);
});
