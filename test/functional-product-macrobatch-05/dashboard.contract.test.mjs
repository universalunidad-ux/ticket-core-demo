import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const html = read("app/dashboard.html"), js = read("app/dashboard.js"), css = read("app/dashboard.css");

test("bloque técnico de agentes se retiró del dashboard", () => assert.doesNotMatch(html, /id="dashAgents"/));
test("modal técnico de agentes también se retiró", () => assert.doesNotMatch(html, /id="dashAgentModal"/));
test("dashboard ya no carga el resumen retirado", () => assert.doesNotMatch(js.slice(js.indexOf("async function init()")), /loadAgentSummary\(\)/));
test("dashboard principal no enlaza bitácora admin", () => assert.doesNotMatch(html + js, /bitacora-admin\.html/));
test("Administración conserva Avisos", () => assert.match(html, /data-adm="avisos"/));
test("Administración conserva Personalización", () => assert.match(html, /data-adm="personalizacion"/));
test("Administración conserva Reglas", () => assert.match(html, /data-adm="reglas"/));
test("Administración ya no ofrece tab Bitácora", () => assert.doesNotMatch(html, /data-adm="bitacora"/));
test("Avisos abre inicialmente sin interacción", () => assert.match(js, /openAdmin\(m\?\.\[1\] \|\| "avisos", false\)/));
test("badge de rol se inserta junto al kicker", () => assert.match(js, /kicker\?\.appendChild\(b\)/));
test("badge ya no se inserta en el lead", () => assert.doesNotMatch(js, /l1\.appendChild\(b\)/));
test("rol no admin mantiene superficies administrativas ocultas", () => assert.match(js, /querySelectorAll\("\.dash-admin-only"\).*classList\.add\("hidden"\)/));
test("Personalización conserva tratamiento visual destacado", () => {
  assert.match(css, /\.sc-group\{[^}]*linear-gradient/);
  assert.match(css, /\.sc-preview\{[^}]*box-shadow:var\(--shadow-sm\)/);
});
