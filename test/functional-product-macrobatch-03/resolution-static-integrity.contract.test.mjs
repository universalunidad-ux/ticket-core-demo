import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = path => readFileSync(join(root, path), "utf8");
const html = read("app/ticket.html");
const module = read("app/shared/ticket-resolution-workbench.js");
const css = read("app/ticket-resolution-workbench.css");

test("ids del HTML son únicos", () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual([...new Set(duplicates)], []);
});

test("aria-controls y aria-labelledby tienen destino", () => {
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
  const refs = [...html.matchAll(/\baria-(?:controls|labelledby)="([^"]+)"/g)]
    .flatMap(match => match[1].split(/\s+/));
  assert.deepEqual(refs.filter(ref => !ids.has(ref)), []);
});

test("workbench tiene un solo owner de listeners", () => {
  assert.equal((module.match(/export function createResolutionWorkbench/g) || []).length, 1);
  assert.equal((module.match(/const bind = \(\) =>/g) || []).length, 1);
  assert.match(module, /controller\?\.abort\(\)/);
});

test("no crea timers, fetches ni APIs de datos", () => {
  assert.doesNotMatch(module, /setInterval|setTimeout|fetch\(|supabase|\.from\(/);
});

test("selectores principales no se duplican", () => {
  assert.equal(css.split(".resolution-choices,.resolution-steps").length - 1, 1);
  assert.equal(css.split(".resolution-progress{").length - 1, 1);
  assert.equal(css.split(".resolution-layout{").length - 1, 2, "una regla base y un override móvil");
  assert.match(css, /@media \(max-width:760px\)[\s\S]*\.resolution-layout\{grid-template-columns:1fr\}/);
});

test("mutantes de cleanup y sanitización son detectables", () => {
  const validate = source => {
    assert.match(source, /controller\?\.abort\(\)/);
    assert.match(source, /sanitizeResolutionState/);
    assert.match(source, /storage\?\.setItem/);
  };
  validate(module);
  assert.throws(() => validate(module.replaceAll("controller?.abort()", "")));
  assert.throws(() => validate(module.replaceAll("sanitizeResolutionState", "unsafeState")));
});
