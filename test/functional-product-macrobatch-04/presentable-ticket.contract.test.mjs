import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
const read=p=>readFileSync(new URL(`../../${p}`,import.meta.url),"utf8");
const globalJs=read("app/global.js"),globalCss=read("app/global.css"),html=read("app/ticket.html"),css=read("app/ticket.css");
const attrs=tag=>Object.fromEntries([...tag.matchAll(/([:\w-]+)\s*=\s*(["'])(.*?)\2/g)].map(([,name,,value])=>[name,value]));

test("header ya no renderiza texto JANOME",()=>assert.doesNotMatch(globalJs,/<strong>JANOME<\/strong>/));
test("contexto de página conserva owner único, semántica accesible y sincronización",()=>{
  const owners=[...globalJs.matchAll(/<span\b[^>]*\bid=["']appPageContext["'][^>]*>/g)].map(match=>match[0]);
  assert.equal(owners.length,1,"#appPageContext debe tener un solo owner");
  const attributes=attrs(owners[0]);
  assert.ok((attributes.class||"").split(/\s+/).includes("sr-only"),"el contexto inicial debe ser sólo para lectores de pantalla");
  assert.equal(attributes.title,"${esc(context)}","el título inicial debe escapar el contexto");
  assert.match(globalJs,new RegExp(`${owners[0].replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}\\$\\{esc\\(context\\)\\}<\\/span>`),"el contexto inicial debe tener texto accesible");
  assert.match(globalJs,/el\.textContent=label;el\.title=label;el\.setAttribute\("aria-label",label\)/,"texto, título y nombre accesible deben permanecer sincronizados");
});
test("marca conserva enlace accesible al inicio",()=>assert.match(globalJs,/class="app-brand" href="dashboard\.html" aria-label="Inicio"/));
test("header reduce altura de forma explícita",()=>assert.match(globalCss,/\.app-header,.app-head-inner\{min-height:54px\}/));
test("configuración no depende de placeholder tardío",()=>assert.match(html,/id="tkEnterSends"> <span>Enter envía<\/span>/));
test("detalle descuenta el header del viewport",()=>assert.match(css,/height:calc\(100dvh - 54px\)!important/));
test("sidebar móvil comienza debajo del header",()=>assert.match(css,/top:58px!important/));
test("sidebar conserva scroll propio y safe area",()=>{assert.match(css,/overscroll-behavior-y:contain/);assert.match(css,/safe-area-inset-bottom/)});
test("HTML conserva un solo H1",()=>assert.equal((html.match(/<h1\b/g)||[]).length,1));
test("no hay IDs duplicados",()=>{const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);assert.equal(new Set(ids).size,ids.length)});
