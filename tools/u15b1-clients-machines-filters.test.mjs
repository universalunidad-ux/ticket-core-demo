import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const read = file =>
  fs.readFileSync(path.join(root, file), "utf8");

const html = read("app/clientes.html");
const js = read("app/clientes.js");
const workflow = read(
  ".github/workflows/frontend-gates.yml",
);

let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test("filtros permanecen dentro del popup", () => {
  assert.match(
    html,
    /id="clFiltersPanel"[^>]*role="dialog"/,
  );

  assert.match(
    html,
    /id="clFiltersBtn"[^>]*aria-expanded="false"/,
  );
});

test("existe el filtro Sólo clientes con máquinas", () => {
  assert.match(
    html,
    /value="machines"[^>]*data-client-filter[^>]*data-requires-equipment/,
  );

  assert.ok(js.includes('"machines"'));

  assert.match(
    js,
    /ST\.filters\.has\("machines"\)[\s\S]*?row\.machineCount > 0/,
  );
});

test("accesorios y refacciones quedan excluidos", () => {
  assert.match(
    js,
    /const machineSystemsFor = systems =>/,
  );

  assert.match(
    js,
    /\["accesorio", "refaccion"\]\.includes/,
  );

  assert.match(
    js,
    /machineCount: machineSystemsFor\(systems\)\.length/,
  );
});

test("paginación queda fijada en diez", () => {
  assert.ok(js.includes("const PAGE_SIZE = 10;"));
  assert.ok(js.includes("size: PAGE_SIZE"));
  assert.ok(js.includes("ST.size = PAGE_SIZE"));
  const fixedPageSizeControl = html.match(
    /<select[^>]*id="clFilterPageSize"[^>]*>[\s\S]*?<\/select>/,
  )?.[0];

  assert.ok(
    fixedPageSizeControl,
    "Falta el selector accesible fijo de clientes",
  );

  assert.match(
    fixedPageSizeControl,
    /aria-label="Clientes por página"/,
  );

  assert.match(
    fixedPageSizeControl,
    /\sdisabled(?:\s|>)/,
  );

  assert.deepEqual(
    [...fixedPageSizeControl.matchAll(
      /<option value="(\d+)"[^>]*>/g,
    )].map(match => match[1]),
    ["10"],
  );

  assert.doesNotMatch(js, /PAGE_SIZES/);
  assert.doesNotMatch(js, /clFilterPageSize/);
  assert.doesNotMatch(html, /<option value="20">/);
  assert.doesNotMatch(html, /<option value="40">/);
});

test("URL conserva filtros y descarta size antiguo", () => {
  assert.match(
    js,
    /filters: \[\.\.\.ST\.filters\]\.sort\(\)\.join\(","\)/,
  );

  assert.ok(js.includes('size: ""'));
  assert.doesNotMatch(js, /query\.size/);
});

test("aplicar filtros reinicia la página", () => {
  assert.match(
    js,
    /ST\.size = PAGE_SIZE;[\s\S]*?ST\.page = 1;/,
  );

  assert.match(
    js,
    /refresh\(\{ resetPage: true \}\)/,
  );
});

test("protección anti-stale permanece", () => {
  const guards =
    js.match(/if \(seq !== ST\.reqSeq\) return;/g) || [];

  assert.ok(
    guards.length >= 3,
    `Guardas encontradas: ${guards.length}`,
  );
});

test("loading, error, retry y vacío permanecen", () => {
  assert.ok(js.includes("Cargando clientes…"));
  assert.ok(js.includes("No se pudo cargar Clientes."));
  assert.ok(js.includes('id="clRetry"'));
  assert.ok(js.includes("Sin resultados"));
  assert.ok(js.includes('id="clEmptyClear"'));
});

test("falla de sistemas desactiva filtro machines", () => {
  assert.ok(js.includes("ST.equipmentAvailable = false"));
  assert.ok(js.includes('ST.filters.delete("machines")'));
  assert.ok(
    js.includes('ST.draftFilters.delete("machines")'),
  );
});

test("administración usa helper canónico", () => {
  assert.match(
    js,
    /import \{ isAdminRole \} from "\.\/shared\/ticket-scope\.js[^"]*"/,
  );

  assert.ok(
    js.includes("ST.isAdmin = isAdminRole(ST.rol)"),
  );

  assert.doesNotMatch(js, /ST\.rol === "admin"/);
});

test("prueba U15B-1 queda registrada en CI", () => {
  assert.match(
    workflow,
    /node tools\/u15b1-clients-machines-filters\.test\.mjs/,
  );
});

console.log(
  `U15B1_CLIENTS_MACHINES_FILTERS_TESTS=PASS (${passed})`,
);
