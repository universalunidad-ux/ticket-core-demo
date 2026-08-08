/* OBS-17 — «Avisos del sitio» abierto por defecto para admin, sin consulta incondicional.
   Mezcla contrato estático (convención del repositorio) y ejecución real de las
   guardas extraídas literalmente de app/dashboard.js, para contar peticiones. */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = p => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const js = read("app/dashboard.js"), html = read("app/dashboard.html");

/* ---------- extracción literal de las guardas embarcadas ---------- */
const pick = (start, end) => {
  const i = js.indexOf(start);
  assert.notEqual(i, -1, `no se encontró el inicio: ${start}`);
  const j = js.indexOf(end, i);
  assert.notEqual(j, -1, `no se encontró el fin: ${end}`);
  return js.slice(i, j + end.length);
};
const GUARD_SRC = pick("const admSurfaceReady =", '$("#admPanel")?.isConnected);');
const ONCE_SRC = pick("let AV_FETCHED = null;", "return avRefrescar();\n}");

/* Escenario ejecutable: DOM mínimo + contador real de peticiones. */
function scenario({ roleResolved = true, isAdmin = true, rol = "admin", dashAdmin = true, admTabs = true, panelConnected = true, listaConnected = true, lista = true } = {}) {
  const calls = { n: 0 };
  let listaNode = lista ? { isConnected: listaConnected } : null;
  const nodes = () => ({
    "#dashAdmin": dashAdmin ? {} : null,
    "#admTabs": admTabs ? {} : null,
    "#admPanel": { isConnected: panelConnected },
    "#avLista": listaNode,
  });
  const $ = q => nodes()[q] ?? null;
  const CTX = { rol, isAdmin, roleResolved };
  const avRefrescar = () => { calls.n += 1; };
  const api = new Function("CTX", "$", "avRefrescar",
    `${GUARD_SRC}\n${ONCE_SRC}\nreturn { admSurfaceReady, avRequestOnce };`)(CTX, $, avRefrescar);
  return { ...api, calls, remount: () => { listaNode = { isConnected: true }; }, unmount: () => { if (listaNode) listaNode.isConnected = false; } };
}

/* ---------- comportamiento observable ---------- */
test("admin autorizado provoca exactamente una carga de Avisos", () => {
  const s = scenario();
  s.avRequestOnce();
  assert.equal(s.calls.n, 1);
});

test("un segundo render no repite la consulta", () => {
  const s = scenario();
  s.avRequestOnce(); s.avRequestOnce(); s.avRequestOnce();
  assert.equal(s.calls.n, 1);
});

test("una instancia nueva del panel vuelve a consultar una sola vez", () => {
  const s = scenario();
  s.avRequestOnce();
  s.remount();
  s.avRequestOnce(); s.avRequestOnce();
  assert.equal(s.calls.n, 2);
});

test("soporte normal no consulta Avisos", () => {
  const s = scenario({ rol: "soporte", isAdmin: false });
  s.avRequestOnce();
  assert.equal(s.calls.n, 0);
});

test("cliente no consulta Avisos", () => {
  const s = scenario({ rol: "cliente", isAdmin: false });
  s.avRequestOnce();
  assert.equal(s.calls.n, 0);
});

test("rol sin resolver no consulta anticipadamente", () => {
  const s = scenario({ roleResolved: false });
  s.avRequestOnce();
  assert.equal(s.calls.n, 0);
});

test("página sin módulo de Administración no consulta", () => {
  const s = scenario({ dashAdmin: false });
  s.avRequestOnce();
  assert.equal(s.calls.n, 0);
});

test("ausencia de la barra de tabs administrativa no consulta", () => {
  const s = scenario({ admTabs: false });
  s.avRequestOnce();
  assert.equal(s.calls.n, 0);
});

test("panel administrativo no montado no consulta", () => {
  const s = scenario({ panelConnected: false });
  s.avRequestOnce();
  assert.equal(s.calls.n, 0);
});

test("ausencia del contenedor de Avisos no consulta ni rompe el dashboard", () => {
  const s = scenario({ lista: false });
  assert.doesNotThrow(() => s.avRequestOnce());
  assert.equal(s.calls.n, 0);
});

test("desmontaje o cambio de página no dispara consulta", () => {
  const s = scenario();
  s.unmount();
  s.avRequestOnce();
  assert.equal(s.calls.n, 0);
});

test("admSurfaceReady exige rol resuelto, admin, módulo y panel montado", () => {
  assert.equal(scenario().admSurfaceReady(), true);
  assert.equal(scenario({ roleResolved: false }).admSurfaceReady(), false);
  assert.equal(scenario({ isAdmin: false }).admSurfaceReady(), false);
  assert.equal(scenario({ dashAdmin: false }).admSurfaceReady(), false);
  assert.equal(scenario({ admTabs: false }).admSurfaceReady(), false);
  assert.equal(scenario({ panelConnected: false }).admSurfaceReady(), false);
});

/* ---------- contrato estático sobre el código embarcado ---------- */
test("Avisos sigue abierto por defecto para el administrador", () => {
  assert.match(js, /openAdmin\(m\?\.\[1\] \|\| "avisos", false\)/);
  assert.match(html, /id="admPanel"[^>]*>\s*<div class="mut">Cargando Avisos del sitio…/);
});

test("openAdmin está protegido por la guarda semántica", () =>
  assert.match(js, /function openAdmin\(tab, push = true\) \{\s*\n\s*if \(!admSurfaceReady\(\)\) return;/));

test("bindAdmin no enlaza ni abre sin superficie administrativa", () =>
  assert.match(js, /function bindAdmin\(\) \{\s*\n\s*if \(!admSurfaceReady\(\)\) return;/));

test("la guarda es semántica, no un timeout ni una condición cosmética", () => {
  const region = js.slice(js.indexOf("const admSurfaceReady ="), js.indexOf("function bindAdmin()"));
  assert.doesNotMatch(region, /setTimeout|setInterval|requestAnimationFrame/);
  assert.match(js, /CTX\.roleResolved = true;/);
});

test("mountAvisos ya no consulta de forma incondicional", () => {
  const region = js.slice(js.indexOf("function mountAvisos(host)"));
  assert.match(region.slice(0, region.indexOf("\n}")), /avRequestOnce\(\)/);
  assert.doesNotMatch(region.slice(0, region.indexOf("\n}")), /^\s*avRefrescar\(\);$/m);
});

test("avRefrescar exige contenedor conectado", () =>
  assert.match(js, /const cont = \$\("#avLista"\); if \(!cont\?\.isConnected\) return;/));

test("el estado montado se marca sólo tras montar realmente", () => {
  const region = js.slice(js.indexOf("if (!ADM.mounted[tab]) {"), js.indexOf("function bindAdmin()"));
  assert.match(region, /if \(!panel\) return;/);
  assert.match(region, /panel\.appendChild\(host\);\s*\n\s*ADM\.mounted\[tab\] = true;/);
});

test("listeners administrativos siguen siendo singleton", () => {
  assert.match(js, /dataset\.adminTabsBound === "1"\) return;/);
  assert.equal((js.match(/dataset\.adminTabsBound = "1";/g) || []).length, 1);
});

test("el rol se marca resuelto antes de cualquier enlace administrativo", () => {
  const init = js.slice(js.indexOf("async function init()"));
  assert.ok(init.indexOf("CTX.roleResolved = true;") < init.indexOf("bindAdmin();"));
});
