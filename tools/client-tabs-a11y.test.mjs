#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "app/cliente.html"), "utf8");
const js = readFileSync(join(root, "app/cliente.js"), "utf8");
const results = [];
const test = (name, fn) => {
  try {
    fn();
    results.push(["PASS", name]);
  } catch (error) {
    results.push(["FAIL", name]);
    console.error(`FAIL\t${name}\n${error.stack || error}`);
    process.exitCode = 1;
  }
};
const attr = (tag, name) => tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`, "i"))?.[1] ?? null;
const tagById = (source, id) => source.match(new RegExp(`<[^>]+\\bid=["']${id}["'][^>]*>`, "i"))?.[0] ?? "";
const count = (source, pattern) => (source.match(pattern) || []).length;
const sourceBetween = (source, startMarker, endMarker) => {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `No se pudo aislar ${startMarker}`);
  return source.slice(start, end);
};

const tablistTag = tagById(html, "cfTabs");
const tablistHtml = html.match(/<nav\b[^>]*\bid=["']cfTabs["'][^>]*>[\s\S]*?<\/nav>/i)?.[0] ?? "";
const tabTags = [...tablistHtml.matchAll(/<button\b[^>]*>/gi)].map(match => match[0]);
const expectedTabs = [
  ["resumen", "cfTabResumen"],
  ["contactos", "cfTabContactos"],
  ["equipos", "cfTabEquipos"],
  ["tickets", "cfTabTickets"],
  ["adjuntos", "cfTabAdjuntos"],
  ["bitacora", "cfTabBitacora"],
  ["consolidacion", "cfTabConsolidacion"],
];

test("01 #cfTabs conserva role=tablist", () => {
  assert.equal(attr(tablistTag, "role"), "tablist");
  assert.equal(attr(tablistTag, "aria-label"), "Secciones del cliente");
});

test("02 existen exactamente siete tabs con IDs deterministas", () => {
  assert.equal(tabTags.length, 7);
  assert.deepEqual(tabTags.map(tag => [attr(tag, "data-tab"), attr(tag, "id")]), expectedTabs);
  assert.equal(new Set(tabTags.map(tag => attr(tag, "id"))).size, 7);
});

test("03 cada tab expone el contrato ARIA completo", () => {
  for (const tag of tabTags) {
    assert.equal(attr(tag, "role"), "tab");
    assert.equal(attr(tag, "aria-controls"), "cfBody");
    assert.ok(["true", "false"].includes(attr(tag, "aria-selected")));
  }
});

test("04 el tabindex inicial es roving 1+6", () => {
  assert.equal(tabTags.filter(tag => attr(tag, "tabindex") === "0").length, 1);
  assert.equal(tabTags.filter(tag => attr(tag, "tabindex") === "-1").length, 6);
  assert.equal(attr(tabTags[0], "aria-selected"), "true");
  assert.equal(attr(tabTags[0], "tabindex"), "0");
});

test("05 existe un solo panel reutilizado y está etiquetado por una tab válida", () => {
  const panel = tagById(html, "cfBody");
  assert.equal(count(html, /\bid=["']cfBody["']/g), 1);
  assert.equal(count(html, /\brole=["']tabpanel["']/g), 1);
  assert.equal(attr(panel, "role"), "tabpanel");
  assert.ok(tabTags.some(tag => attr(tag, "id") === attr(panel, "aria-labelledby")));
});

const makeTab = ([name, id]) => {
  const attributes = new Map();
  const tab = {
    dataset: { tab: name },
    id,
    tabIndex: -1,
    selectedClass: false,
    scrolled: false,
    setAttribute: (name, value) => attributes.set(name, String(value)),
    getAttribute: name => attributes.get(name),
    scrollIntoView() { this.scrolled = true; },
    focus() {},
    closest(selector) { return selector.startsWith(".chat-tab") ? this : null; },
  };
  tab.classList = { toggle: (_name, on) => { tab.selectedClass = on; } };
  return tab;
};

test("06 markActive sincroniza selección, tabindex y aria-labelledby", () => {
  const tabs = expectedTabs.map(makeTab);
  const panelAttributes = new Map();
  const panel = { setAttribute: (name, value) => panelAttributes.set(name, value) };
  const context = {
    ST: { tab: "equipos" },
    document: { querySelectorAll: selector => selector === "#cfTabs .chat-tab" ? tabs : [] },
    $: selector => selector === "#cfBody" ? panel : null,
  };
  vm.createContext(context);
  const markActiveSource = sourceBetween(js, "const markActive =", "\n\nconst syncCounts")
    .replace("const markActive =", "globalThis.markActive =");
  vm.runInContext(markActiveSource, context);
  context.markActive();
  const active = tabs[2];
  assert.equal(tabs.filter(tab => tab.getAttribute("aria-selected") === "true").length, 1);
  assert.equal(tabs.filter(tab => tab.tabIndex === 0).length, 1);
  assert.equal(active.getAttribute("aria-selected"), "true");
  assert.equal(active.tabIndex, 0);
  assert.equal(panelAttributes.get("aria-labelledby"), "cfTabEquipos");
  assert.equal(active.scrolled, true);
});

test("07 el owner de teclado es único e idempotente", () => {
  const bindSource = sourceBetween(js, "const bindClientTabs =", "\n\ndocument.addEventListener(\"DOMContentLoaded\"");
  assert.equal(count(bindSource, /addEventListener\(["']keydown["']/g), 1);
  assert.match(bindSource, /dataset\.clientTabsBound === ["']1["']/);
  assert.match(bindSource, /dataset\.clientTabsBound = ["']1["']/);

  const tabs = expectedTabs.map(makeTab);
  const listeners = { click: [], keydown: [] };
  const tablist = {
    dataset: {},
    addEventListener: (type, listener) => listeners[type].push(listener),
    contains: tab => tabs.includes(tab),
    querySelectorAll: () => tabs,
  };
  const context = { $: () => tablist, openTab: () => {} };
  vm.createContext(context);
  vm.runInContext(bindSource.replace("const bindClientTabs =", "globalThis.bindClientTabs ="), context);
  context.bindClientTabs();
  context.bindClientTabs();
  assert.equal(listeners.click.length, 1);
  assert.equal(listeners.keydown.length, 1);
});

test("08 ArrowLeft/ArrowRight/Home/End activan una vez y navegan circularmente", () => {
  const tabs = expectedTabs.map(makeTab);
  const listeners = {};
  const calls = [];
  let focused = null;
  for (const tab of tabs) tab.focus = () => { focused = tab; };
  const tablist = {
    dataset: {},
    addEventListener: (type, listener) => { listeners[type] = listener; },
    contains: tab => tabs.includes(tab),
    querySelectorAll: () => tabs,
  };
  const context = { $: () => tablist, openTab: tab => calls.push(tab) };
  const bindSource = sourceBetween(js, "const bindClientTabs =", "\n\ndocument.addEventListener(\"DOMContentLoaded\"");
  vm.createContext(context);
  vm.runInContext(bindSource.replace("const bindClientTabs =", "globalThis.bindClientTabs ="), context);
  context.bindClientTabs();
  const run = (key, from, expected) => {
    calls.length = 0;
    focused = null;
    let prevented = false;
    listeners.keydown({ key, target: tabs[from], preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true, `${key} debe cancelar el scroll nativo`);
    assert.equal(focused, tabs[expected], `${key} debe mover el foco`);
    assert.deepEqual(calls, [tabs[expected].dataset.tab], `${key} debe usar openTab una sola vez`);
  };
  run("ArrowRight", 6, 0);
  run("ArrowLeft", 0, 6);
  run("Home", 4, 0);
  run("End", 1, 6);
});

test("09 el teclado delega en openTab sin replicar carga o historial", () => {
  const bindSource = sourceBetween(js, "const bindClientTabs =", "\n\ndocument.addEventListener(\"DOMContentLoaded\"");
  const keyboardSource = bindSource.slice(bindSource.indexOf("addEventListener(\"keydown\""));
  assert.equal(count(keyboardSource, /\bopenTab\(/g), 1);
  assert.doesNotMatch(keyboardSource, /history\.|LOADERS|RENDER|innerHTML|ST\./);
});

test("10 clic, hash, replaceState, caché y anti-stale permanecen", () => {
  assert.match(js, /addEventListener\("click"[\s\S]*?openTab\(tab\.dataset\.tab\)/);
  assert.match(js, /history\.replaceState\([^\n]+#tab=\$\{tab\}/);
  assert.match(js, /addEventListener\("hashchange"/);
  assert.match(js, /openTab\(h, false\)/);
  assert.match(js, /ST\.cache\[tab\]/);
  assert.match(js, /seq !== ST\.seq\[tab\]/);
  assert.match(js, /UI\.skeletonHtml\(\)/);
});

test("11 cliente.html no contiene IDs estáticos duplicados", () => {
  const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  assert.deepEqual(duplicates, []);
});

test("12 el owner no intercepta teclado dentro de #cfBody", () => {
  const bindSource = sourceBetween(js, "const bindClientTabs =", "\n\ndocument.addEventListener(\"DOMContentLoaded\"");
  assert.match(bindSource, /e\.target\.closest\?\.\("\.chat-tab\[role='tab'\]"\)/);
  assert.match(bindSource, /!tablist\.contains\(current\)/);
  assert.doesNotMatch(bindSource, /#cfBody/);
});

results.forEach(([status, name]) => console.log(`${status}\t${name}`));
if (!process.exitCode) {
  console.log(`CLIENT_TABS_A11Y_TESTS=PASS (${results.length}/${results.length})`);
  console.log("CLIENT_TAB_COUNT=7");
  console.log("CIRCULAR_NAVIGATION_PASS=YES");
}
