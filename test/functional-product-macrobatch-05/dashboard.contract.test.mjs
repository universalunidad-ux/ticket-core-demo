import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const html = read("app/dashboard.html"), js = read("app/dashboard.js"), css = read("app/dashboard.css");
const tagsById=id=>[...html.matchAll(new RegExp(`<[^>]+\\bid=["']${id}["'][^>]*>`,"g"))].map(match=>match[0]);
const attrs=tag=>Object.fromEntries([...tag.matchAll(/([:\w-]+)\s*=\s*(["'])(.*?)\2/g)].map(([,name,,value])=>[name,value]));
const hasClass=(tag,name)=>(attrs(tag).class||"").split(/\s+/).includes(name);

test("resumen por agente conserva owner único, ocultamiento inicial y frontera admin", () => {
  const owners=tagsById("dashAgents");
  assert.equal(owners.length,1,"#dashAgents debe tener un solo owner");
  assert.ok(hasClass(owners[0],"dash-admin-only"),"#dashAgents debe ser admin-only");
  assert.ok(hasClass(owners[0],"hidden"),"#dashAgents debe iniciar oculto");
  assert.match(js,/async function loadAgentSummary\(\)\{\s*if\(!CTX\.isAdmin\)return;/,"la carga debe fallar cerrada fuera de admin");
});
test("modal de agentes tiene nombre accesible, cierre y restauración de foco", () => {
  const owners=tagsById("dashAgentModal");
  assert.equal(owners.length,1,"#dashAgentModal debe tener un solo owner");
  const attributes=attrs(owners[0]);
  assert.equal(attributes.role,"dialog");
  assert.equal(attributes["aria-modal"],"true");
  assert.match(owners[0],/\bhidden\b/,"el diálogo debe iniciar oculto");
  assert.equal(tagsById(attributes["aria-labelledby"]).length,1,"aria-labelledby debe resolver a un owner único");
  assert.equal(tagsById("dashAgentClose").length,1,"el diálogo debe tener control de cierre único");
  assert.match(js,/openDialog\("#dashAgentModal",\{trigger,initialFocus:"#dashAgentClose",fallbackFocus:trigger,onCloseRequest:\(\)=>closeDialog\("#dashAgentModal"\)\}\)/,"el diálogo debe cerrar y restaurar el foco al disparador");
  assert.match(js,/\$\("#dashAgentClose"\)\?\.addEventListener\("click",\(\)=>closeDialog\(modal\)\)/,"el botón de cierre debe usar el lifecycle compartido");
});
test("loadAgentSummary queda conectado sólo para admin y no para soporte o cliente", () => {
  const init=js.slice(js.indexOf("async function init()"));
  assert.match(init,/CTX\.isAdmin\s*=\s*isAdminRole\(ctx\.rol\)/,"el rol debe resolverse con el helper canónico");
  assert.match(init,/CTX\.isAdmin\?loadAgentSummary\(\):Promise\.resolve\(\)/,"la carga inicial debe estar condicionada a admin");
  assert.match(init,/if\s*\(!CTX\.isAdmin\)[\s\S]*?querySelectorAll\("\.dash-admin-only"\)[\s\S]*?classList\.add\("hidden"\)/,"roles internos no admin deben conservar las superficies ocultas");
  assert.match(read("app/shared/nav-interna.js"),/if\(!\["admin","supervisor","ventas","soporte"\]\.includes\(rol\)\)\{location\.replace\("portal-cliente\.html"\);return null\}/,"cliente debe salir de la ruta interna antes de inicializar el dashboard");
});
test("CTA de bitácora tiene ruta exacta, owner único y host admin-only", () => {
  const links=[...js.matchAll(/<a\b[^>]*\bdata-admin-audit-link\b[^>]*>/g)].map(match=>match[0]);
  assert.equal(links.length,1,"la CTA de bitácora debe tener un solo owner");
  assert.equal(attrs(links[0]).href,"bitacora-admin.html","la CTA debe usar la ruta exacta");
  const host=tagsById("dashAdmin");
  assert.equal(host.length,1,"la superficie administrativa debe tener owner único");
  assert.ok(hasClass(host[0],"dash-admin-only")&&hasClass(host[0],"hidden"),"la CTA debe vivir en una superficie admin-only inicialmente oculta");
  assert.match(html,/id=["']dashAdmin["'][\s\S]*id=["']dashAdminActions["'][\s\S]*<\/section>/,"el host de la CTA debe estar dentro de #dashAdmin");
  assert.match(js,/function bindAdmin\(\)[\s\S]*?#dashAdminActions[\s\S]*?bitacora-admin\.html/,"la CTA debe montarse mediante el binding administrativo");
  assert.match(js,/if \(!CTX\.isAdmin\)[\s\S]*?querySelectorAll\("\.dash-admin-only"\)[\s\S]*?classList\.add\("hidden"\)/,"roles no administrativos no deben ver la CTA");
});
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
