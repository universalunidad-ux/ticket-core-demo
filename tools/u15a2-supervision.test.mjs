#!/usr/bin/env node
/* TC-U15A-2 — pruebas estáticas de integración: Supervisión compacta + resumen resiliente
   de agentes en el Dashboard. Verifican contrato de DOM, paginación, semántica de modal,
   redacción de evidencia, degradación parcial y AUTORIZACIÓN por rol. Cero red, cero DOM. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = path => readFileSync(join(root, path), "utf8");
let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`PASS ${name}`) } catch (error) { console.error(`FAIL ${name}: ${error.stack || error.message}`); process.exitCode = 1 } };

const js = read("app/dashboard.js");
const html = read("app/dashboard.html");
const css = read("app/dashboard.css");
const tagById = id => html.match(new RegExp(`<[^>]+id=["']${id}["'][^>]*>`))?.[0] || "";

/* ---------- Objetivo 1 · Supervisión ---------- */
test("supervisión: bandeja de 5 por página con contrato de paginación", () => {
  assert.match(js, /const SUP_PAGE_SIZE=5\b/, "el tamaño de página debe ser 5");
  for (const id of ["dashSupPrev", "dashSupNext", "dashSupDots", "dashSupTotal"]) assert.ok(tagById(id), `falta el control #${id}`);
  assert.match(js, /paginate\(\{total:rows\.length,page:SUP_PAGE,size:SUP_PAGE_SIZE\}\)/, "la paginación debe derivarse del contrato puro");
  assert.match(css, /\.dash-supervision-list\{[^}]*min-height:\d/, "altura estable ausente (min-height)");
});

test("supervisión: la tarjeta abre revisión rápida y NO navega de inmediato", () => {
  assert.match(js, /data-supervision-open="\$\{abs\}"/, "la tarjeta debe exponer el disparador de revisión");
  assert.match(js, /<button class="dash-supervision-card"/, "la tarjeta debe ser un botón activable por teclado");
  assert.match(js, /function openSupervisionCase\([^)]*\)\{\s*if\(!CTX\.isAdmin\)return;/, "abrir caso debe abrir modal, no navegar, y exigir admin");
  assert.match(js, /openDialog\("#dashSupervisionModal"/, "debe abrirse el modal de revisión rápida");
  assert.doesNotMatch(js, /data-supervision-open[^>]*<a [^>]*ticket\.html/, "la tarjeta no debe navegar directamente al ticket");
});

test("supervisión: el modal expone semántica de diálogo y nombre accesible", () => {
  const tag = tagById("dashSupervisionModal");
  assert.match(tag, /role="dialog"/);
  assert.match(tag, /aria-modal="true"/);
  assert.match(tag, /\bhidden\b/);
  const label = tag.match(/aria-labelledby="([^"]+)"/)?.[1];
  assert.ok(label && new RegExp(`id=["']${label}["']`).test(html), "aria-labelledby no resuelve");
  assert.match(js, /initialFocus:"#dashSupClose"/, "el modal debe gestionar el foco inicial");
});

test("supervisión: acciones sin backend quedan deshabilitadas y explicadas", () => {
  for (const id of ["dashSupReviewed", "dashSupAskAgent"]) {
    const tag = tagById(id);
    assert.match(tag, /\bdisabled\b/, `#${id} debe estar deshabilitado`);
    assert.match(tag, /aria-describedby="dashSupActionsNote"/, `#${id} debe explicar por qué`);
  }
  assert.match(html, /id="dashSupActionsNote"[^>]*>[^<]*No se simula/, "la nota debe declarar que no se simula ninguna escritura");
  assert.match(tagById("dashSupOpen"), /id="dashSupOpen"/, "debe existir 'Abrir ticket completo'");
  assert.match(js, /\$\("#dashSupOpen"\)\.href=`ticket\.html\?id=\$\{encodeURIComponent\(row\.id\)\}`/, "Abrir ticket completo debe conservar ticket.html?id=");
});

test("supervisión: la evidencia se sanea; la URL firmada nunca se imprime", () => {
  assert.match(js, /import\s*\{[^}]*\bevidenceView\b[^}]*\bevidenceStoragePath\b[^}]*\binternalMessagePreview\b[^}]*\}\s*from\s*"\.\/shared\/dashboard-resilience\.js/, "debe consumir el saneo del módulo puro");
  /* La URL firmada sólo alimenta img.src; jamás se interpola en innerHTML/textContent. */
  assert.match(js, /img\.src=signed\.signedUrl/, "la miniatura debe usar img.src");
  assert.doesNotMatch(js, /innerHTML[^;]*signedUrl/, "la URL firmada no debe ir a innerHTML");
  assert.doesNotMatch(js, /textContent[^;]*signedUrl/, "la URL firmada no debe ir a textContent");
  assert.doesNotMatch(js, /\$\{[^}]*signedUrl[^}]*\}/, "la URL firmada no debe interpolarse en plantillas");
  assert.doesNotMatch(js, /data-supervision-thumb/, "la tarjeta compacta no debe volcar miniaturas firmadas por lote");
});

/* ---------- Objetivo 2 · Agentes ---------- */
test("agentes: perfiles y tickets se cargan por separado y toleran falla parcial", () => {
  assert.match(js, /from\("perfiles"\)\.select\("id,nombre,rol"\)/, "consulta de perfiles independiente");
  assert.match(js, /prof\.ok/, "el resultado de perfiles se evalúa aparte");
  assert.match(js, /ticketsOk=false;ticketsKind=classifyLoadError\(error\)/, "la falla de tickets se clasifica sin tumbar perfiles");
  assert.match(js, /keepLastValid\(AGENT_STATE/, "debe conservar el último resultado válido");
  assert.match(js, /agentSeq\.isCurrent\(token\)/, "guarda anti-stale en la recarga de agentes");
});

test("agentes: sin datos de tickets muestra '—' (no inventa ceros) y deshabilita la métrica", () => {
  assert.match(js, /const known=Array\.isArray\(row\?\.tickets\)/, "distingue métricas conocidas de desconocidas");
  assert.match(js, /known\?count:"—"/, "métrica desconocida se muestra como —, no como 0");
  assert.match(js, /\$\{known\?"":" disabled"\}/, "métrica desconocida se deshabilita");
});

test("agentes: reintento sin duplicar listeners y modal de 10 por página intacto", () => {
  assert.match(js, /data-agent-retry/, "debe ofrecer reintentar");
  assert.match(js, /querySelector\("\[data-agent-retry\]"\)\?\.addEventListener\("click",loadAgentSummary,\{once:true\}\)/, "el retry se enlaza a un elemento nuevo (sin duplicar)");
  assert.match(js, /const AGENT_PAGE_SIZE=10/, "el modal de métrica conserva 10 por página");
});

/* ---------- Roles · sólo admin/owner/administrador ---------- */
test("roles: soporte no ve supervisión ni agentes globales (DOM oculto por defecto)", () => {
  for (const id of ["dashSupervision", "dashAgents"]) {
    const tag = tagById(id);
    assert.match(tag, /class="[^"]*dash-admin-only[^"]*"/, `#${id} debe ser admin-only`);
    assert.match(tag, /\bhidden\b/, `#${id} debe iniciar oculto`);
  }
  assert.match(js, /document\.querySelectorAll\("\.dash-admin-only"\)\.forEach\(el => el\.classList\.add\("hidden"\)\)/, "soporte debe ocultar todas las superficies admin-only");
});

test("roles: manipular DOM/URL no amplía permisos (guardas de capacidad en cada carga)", () => {
  for (const guard of [
    /async function loadSupervision\(\)\{\s*if\(!CTX\.isAdmin\)\{/,
    /async function loadAgentSummary\(\)\{\s*if\(!CTX\.isAdmin\)return;/,
    /function openSupervisionCase\([^)]*\)\{\s*if\(!CTX\.isAdmin\)return;/,
    /function openAgentMetric\([^)]*\)\{\s*if\(!CTX\.isAdmin\)return;/,
  ]) assert.match(js, guard, "falta la guarda de rol en una superficie global");
  /* La bandeja de supervisión NO se filtra por asignado_a: es una vista administrativa global,
     y la frontera real es RLS (no el ocultamiento del cliente). */
  assert.doesNotMatch(js, /requiere_supervision",true\)[^;]*\.eq\("asignado_a"/, "supervisión global no debe autolimitarse por asignado_a");
});

if (!process.exitCode) console.log(`U15A2_SUPERVISION_TESTS=PASS (${passed})`);
