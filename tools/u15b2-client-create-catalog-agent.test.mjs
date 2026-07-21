import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const read = file =>
  fs.readFileSync(path.join(root, file), "utf8");

const html = read("app/alta-cliente.html");
const js = read("app/alta-cliente.js");
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

const occurrences = (pattern, text = js) =>
  (text.match(pattern) || []).length;

test("catálogo limitado a máquinas Janome", () => {
  assert.match(
    js,
    /\.filter\(group => String\(group\.grupo\)\.startsWith\("Máquinas — "\)\)/,
  );

  assert.match(
    js,
    /const MODEL_BY_ID = new Map\(MACHINE_MODELS/,
  );
});

test("combobox tiene contrato ARIA completo", () => {
  const input = html.match(
    /<input\b[^>]*\bid="acModelo"[^>]*>/,
  )?.[0];

  assert.ok(input);
  assert.match(input, /role="combobox"/);
  assert.match(input, /aria-controls="acModeloList"/);
  assert.match(input, /aria-expanded="false"/);
  assert.match(input, /aria-autocomplete="list"/);
  assert.match(input, /aria-haspopup="listbox"/);
});

test("captura libre no supera validación canónica", () => {
  assert.match(
    js,
    /MODEL_BY_ID\.get\(\$\("#acModeloCatalogId"\)\.value\)/,
  );

  assert.match(
    js,
    /Selecciona un modelo válido de las sugerencias/,
  );

  assert.match(
    js,
    /\$\("#acModeloCatalogId"\)\.value = "";/,
  );

  assert.match(
    js,
    /\$\("#acModeloCatalogId"\)\.value = model\.id;/,
  );
});

test("teclado y lista tienen owners únicos", () => {
  assert.equal(
    occurrences(
      /\$\("#acModelo"\)\.addEventListener\("keydown"/g,
    ),
    1,
  );

  assert.equal(
    occurrences(
      /\$\("#acModeloList"\)\.addEventListener\("click"/g,
    ),
    1,
  );

  assert.match(js, /"ArrowDown", "ArrowUp"/);
  assert.match(js, /event\.key === "Enter"/);
  assert.match(js, /event\.key === "Escape"/);
});

test("aria-activedescendant se limpia sin opción activa", () => {
  assert.match(
    js,
    /if \(ST\.modelIndex >= 0\)[\s\S]*?"aria-activedescendant"[\s\S]*?else \{[\s\S]*?removeAttribute\([\s\S]*?"aria-activedescendant"/,
  );
});

test("equipo e idempotencia conservan el contrato", () => {
  assert.match(
    js,
    /equipo: cleanText\(\$\("#acModelo"\)\.value\) \? \{ modelo:/,
  );

  assert.match(
    js,
    /serie: cleanText\(\$\("#acSerie"\)\.value\) \|\| null/,
  );

  assert.match(
    js,
    /idempotency_key: ST\.idempotencyKey/,
  );

  assert.match(
    js,
    /const newIdempotencyKey = \(\) =>/,
  );
});

test("duplicados conservan anti-stale y respuesta 409", () => {
  assert.match(js, /const seq = \+\+ST\.dupSeq/);

  assert.ok(
    occurrences(
      /if \(seq !== ST\.dupSeq\) return false;/g,
    ) >= 2,
  );

  assert.match(js, /response\.status === 409/);
  assert.match(js, /showServerDups/);
});

test("no existen escrituras multitabla directas", () => {
  assert.doesNotMatch(
    js,
    /\.from\("clientes"\)\.(?:insert|update|delete)/,
  );

  assert.doesNotMatch(
    js,
    /\.from\("cliente_contactos"\)\.(?:insert|update|delete)/,
  );

  assert.doesNotMatch(
    js,
    /\.from\("cliente_sistemas"\)\.(?:insert|update|delete)/,
  );

  assert.match(
    js,
    /\/functions\/v1\/\$\{EDGE\}/,
  );
});

test("roles usan helper canónico", () => {
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

test("asignación de agente no se simula", () => {
  assert.match(
    js,
    /const AGENT_ASSIGNMENT_DECISION = "OUT_OF_SCOPE_BACKEND_REQUIRED";/,
  );

  assert.match(
    html,
    /<select\b[^>]*\bid="acAgent"[^>]*\bdisabled\b[^>]*>/,
  );

  assert.doesNotMatch(
    js,
    /\$\("#acAgentBlock"\)\.classList\.remove\("hidden"\)/,
  );

  const start = js.indexOf("function payload()");
  const end = js.indexOf(
    "function showServerDups",
    start,
  );

  assert.ok(start >= 0 && end > start);

  const payloadOwner = js.slice(start, end);

  assert.doesNotMatch(
    payloadOwner,
    /\bacAgent\b|\bagente_id\b|\bagent_id\b|\basignado_a\b/,
  );
});

test("owners funcionales permanecen únicos", () => {
  assert.equal(
    occurrences(
      /document\.addEventListener\("DOMContentLoaded"/g,
    ),
    1,
  );

  assert.equal(
    occurrences(/const modelMatches = query =>/g),
    1,
  );

  assert.equal(
    occurrences(/function renderModelSuggestions\(\)/g),
    1,
  );

  assert.equal(
    occurrences(/function chooseModel\(id\)/g),
    1,
  );

  assert.equal(
    occurrences(/async function submit\(event\)/g),
    1,
  );

  assert.equal(
    occurrences(
      /\$\("#acForm"\)\.addEventListener\("submit", submit\)/g,
    ),
    1,
  );
});

test("estados recuperables permanecen", () => {
  assert.match(js, /Verificando el contrato de alta/);
  assert.match(js, /El alta aún no está habilitada/);
  assert.match(js, /No tienes permisos para crear clientes/);
  assert.match(js, /Cliente creado correctamente/);
  assert.match(js, /puedes corregirlos o reintentar/);
});

test("prueba U15B-2 registrada en CI", () => {
  assert.match(
    workflow,
    /node tools\/u15b2-client-create-catalog-agent\.test\.mjs/,
  );
});

console.log(
  `U15B2_CLIENT_CREATE_CATALOG_AGENT_TESTS=PASS (${passed})`,
);
