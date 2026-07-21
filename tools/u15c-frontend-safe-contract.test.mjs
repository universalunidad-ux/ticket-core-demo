import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const read = file =>
  fs.readFileSync(path.join(root, file), "utf8");

const html = read("app/consolidacion-clientes.html");
const js = read("app/consolidacion-clientes.js");
const clientUi = read("app/cliente.ui.js");
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

const count = (pattern, text = js) =>
  (text.match(pattern) || []).length;

test("la arquitectura declara backend ausente", () => {
  assert.match(
    js,
    /const CONSOLIDATION_BACKEND_DECISION = "BACKEND_NOT_PRESENT";/,
  );

  assert.match(
    js,
    /const CONSOLIDATION_EXECUTION_ENABLED = false;/,
  );

  assert.match(
    html,
    /data-backend-decision="BACKEND_NOT_PRESENT"/,
  );
});

test("el producto no afirma que Edge ya existe", () => {
  assert.doesNotMatch(
    clientUi,
    /consolidar-cliente-ticket/,
  );

  assert.doesNotMatch(
    clientUi,
    /acción transaccional vía Edge/,
  );

  assert.match(
    clientUi,
    /requiere una operación backend versionada/,
  );

  assert.match(
    clientUi,
    /ejecución permanece deshabilitada/i,
  );
});

test("la vista conserva comparación real y score honesto", () => {
  assert.match(
    js,
    /function comparisonHtml\(ticket\)/,
  );

  assert.match(
    js,
    /function scoreHtml\(ticket, rows\)/,
  );

  assert.match(
    js,
    /el matcher sólo expone score y nivel; no expone ponderaciones/,
  );

  assert.match(
    js,
    /function impactHtml\(ticket\)/,
  );
});

test("fecha_actualizacion queda como versión esperada futura", () => {
  assert.match(
    js,
    /const EXPECTED_VERSION_FIELD = "fecha_actualizacion";/,
  );

  assert.match(
    js,
    /const expectedVersionFor = ticket =>/,
  );

  assert.match(
    js,
    /\.select\("[^"]*fecha_actualizacion[^"]*"\)/,
  );

  assert.match(
    js,
    /data-expected-version="\$\{esc\(expectedVersionFor\(ticket\)\)\}"/,
  );
});

test("las cuatro acciones permanecen deshabilitadas", () => {
  for (const action of [
    "associate",
    "create",
    "discard",
    "postpone",
  ]) {
    assert.match(
      js,
      new RegExp(
        `data-consolidation-action="${action}"` +
        `[\\s\\S]{0,100}?disabled aria-disabled="true"`,
      ),
    );
  }

  assert.equal(
    count(/data-consolidation-action="/g),
    4,
  );
});

test("no existe ejecución backend desde el navegador", () => {
  assert.doesNotMatch(js, /\bfetch\(/);
  assert.doesNotMatch(js, /\.rpc\(/);
  assert.doesNotMatch(js, /functions\/v1/);
  assert.doesNotMatch(js, /functions\.invoke/);
});

test("no existen escrituras CRM directas", () => {
  for (const table of [
    "clientes",
    "cliente_contactos",
    "cliente_sistemas",
    "tickets",
  ]) {
    assert.doesNotMatch(
      js,
      new RegExp(
        `\\.from\\("${table}"\\)` +
        `\\.(?:insert|update|upsert|delete)`,
      ),
    );
  }
});

test("administración usa helper canónico", () => {
  assert.match(
    js,
    /import \{ isAdminRole \} from "\.\/shared\/ticket-scope\.js[^"]*"/,
  );

  assert.match(
    js,
    /ST\.isAdmin = isAdminRole\(ctx\.rol\)/,
  );

  assert.doesNotMatch(
    js,
    /String\(ctx\.rol \|\| ""\)\.toLowerCase\(\) === "admin"/,
  );
});

test("owners principales permanecen únicos", () => {
  assert.equal(
    count(
      /document\.addEventListener\("DOMContentLoaded"/g,
    ),
    1,
  );

  assert.equal(
    count(/function actionHtml\(ticket\)/g),
    1,
  );

  assert.equal(
    count(/function cardHtml\(ticket, open = false\)/g),
    1,
  );

  assert.equal(
    count(/async function load\(\)/g),
    1,
  );

  assert.equal(
    count(
      /\$\("#cqList"\)\.addEventListener\("change"/g,
    ),
    1,
  );

  assert.equal(
    count(
      /\$\("#cqPagination"\)\.addEventListener\("click"/g,
    ),
    1,
  );
});

test("protección anti-stale permanece", () => {
  assert.match(js, /const seq = \+\+ST\.reqSeq/);

  assert.ok(
    count(/if \(seq !== ST\.reqSeq\) return;/g)
      >= 2,
  );
});

test("paginación continúa fija en diez", () => {
  assert.match(
    js,
    /const PAGE_SIZE = 10/,
  );

  assert.match(
    js,
    /rows\.slice\(start, start \+ PAGE_SIZE\)/,
  );
});

test("HTML no contiene IDs duplicados", () => {
  const ids = [
    ...html.matchAll(/\bid="([^"]+)"/g),
  ].map(match => match[1]);

  const duplicates = ids.filter(
    (id, index) => ids.indexOf(id) !== index,
  );

  assert.deepEqual(duplicates, []);
});

test("prueba U15C-A registrada en CI", () => {
  assert.match(
    workflow,
    /node tools\/u15c-frontend-safe-contract\.test\.mjs/,
  );
});

console.log(
  `U15C_FRONTEND_SAFE_CONTRACT_TESTS=PASS (${passed})`,
);
