import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = path => readFileSync(join(root, path), "utf8");

test("referencias locales activas existen", () => {
  for (const htmlFile of ["app/tickets.html", "app/ticket.html"]) {
    for (const match of read(htmlFile).matchAll(/(?:href|src)="([^"]+)"/g)) {
      const ref = match[1].split(/[?#]/)[0];
      if (!ref || /^(?:https?:|#|data:)/.test(ref)) continue;
      assert.equal(existsSync(join(root, "app", ref)), true, `${htmlFile}: referencia inválida ${ref}`);
    }
  }
});

test("coordinador no inventa red y detecta cargas stale", () => {
  const source = read("app/shared/ticket-workspace.js");
  assert.doesNotMatch(source, /\bfetch\s*\(|service_role|rpc\s*\(/i);
  assert.match(source, /active\?\.abort\?\.\(\)/);
  assert.match(source, /token === sequence/);
});
