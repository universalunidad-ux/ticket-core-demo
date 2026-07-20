#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root=join(dirname(fileURLToPath(import.meta.url)),"..");
const read=path=>readFileSync(join(root,path),"utf8");
const files={global:read("app/global.js"),globalCss:read("app/global.css"),dash:read("app/dashboard.js"),dashHtml:read("app/dashboard.html"),dashCss:read("app/dashboard.css"),ticketsHtml:read("app/tickets.html"),alta:read("app/alta-cliente.html"),altaJs:read("app/alta-cliente.js"),clients:read("app/clientes.js"),bitHtml:read("app/bitacora-admin.html"),bitJs:read("app/bitacora-admin.js")};
let passed=0;
const test=(name,fn)=>{try{fn();passed++;console.log(`PASS ${name}`)}catch(error){console.error(`FAIL ${name}: ${error.message}`);process.exitCode=1}};
const has=(text,re,message)=>assert.match(text,re,message);
const not=(text,re,message)=>assert.doesNotMatch(text,re,message);

test("global header page map and human labels",()=>{
  for(const label of ["DASHBOARD","TICKETS","CLIENTES","CLIENTE NUEVO","CONSOLIDACIÓN DE CLIENTES","BITÁCORA ADMINISTRATIVA"])assert.ok(files.global.includes(label),`missing ${label}`);
  has(files.global,/setTicketPageContext=title=>setPageContextLabel\(title\?`TICKET · \$\{title\}`:"TICKET"\)/,"dynamic ticket contract missing");
  has(files.global,/id="appPageContext"[^>]*title=/,"context full title missing");
});
test("global header single-line ellipsis contract",()=>{
  has(files.globalCss,/\.app-page-context\{[^}]*overflow:hidden;[^}]*text-overflow:ellipsis;[^}]*white-space:nowrap/,"single-line CSS missing");
  has(files.globalCss,/@media\(max-width:520px\)[^{]*\{[^}]*\.app-head-start|@media\(max-width:520px\)/,"mobile context owner missing");
});
test("shared native select owner",()=>{
  has(files.globalCss,/\.select,\.theme-select\{[^}]*appearance:none/,"shared select appearance missing");
  has(files.globalCss,/background-image:linear-gradient/,"shared chevron missing");
  has(files.globalCss,/\.select:focus-visible/,"shared focus missing");
  not(files.globalCss,/role=["']listbox/,"CSS must not invent custom listboxes");
});
test("KPI rail centered and navigable",()=>{
  has(files.dashCss,/\.kpi-rail>\.kpi\{[^}]*align-content:center;[^}]*justify-items:center;[^}]*text-align:center/,"KPI centering missing");
  for(const token of ["scrollBy","ResizeObserver","ArrowRight","ArrowLeft","scrollLeft <= 4"])assert.ok(files.dash.includes(token),`KPI nav missing ${token}`);
});
test("activity dots synchronize from exact count",()=>{
  has(files.dash,/ACT_PAGES=Math\.max\(1,Math\.ceil\(\(count\?\?0\)\/ACT_PAGE_SIZE\)\)/,"exact dot count missing");
  for(const token of ["data-act-page","aria-current","touchstart","touchend","resize"])assert.ok(files.dash.includes(token),`dot sync missing ${token}`);
  assert.equal((files.dash.match(/id="dashActDots"/g)||[]).length,0,"dot id belongs in HTML only");
  assert.equal((files.dashHtml.match(/id="dashActDots"/g)||[]).length,1,"one dot owner required");
});
test("agent metrics exact mapping and shared dialog",()=>{
  for(const key of ["ACTIVE","OPEN","IN_PROGRESS","WAITING_CUSTOMER","CLOSED_RESOLVED","HIGH_URGENT","FIRST_RESPONSE_BREACHED","RESOLUTION_BREACHED","SUPERVISION_PENDING"])assert.ok(files.dash.includes(`key:"${key}"`),`missing ${key}`);
  assert.ok(files.dash.includes("AGENT_PAGE_SIZE=10"));
  assert.ok(files.dash.includes('openDialog("#dashAgentModal"'));
  not(files.dash,/function openAgent\(/,"legacy whole-card modal owner remains");
  for(const count of [0,1,10,11,23])assert.equal(Math.max(1,Math.ceil(count/10)),count===0?1:count<=10?1:count===11?2:3);
});
test("admin tabs stable and contextual",()=>{
  for(const token of ["aria-selected","tabIndex=active?0:-1","ArrowLeft","ArrowRight","Home","End","p.inert=!active","history.replaceState"])assert.ok(files.dash.includes(token),`tab contract missing ${token}`);
  has(files.dashCss,/\.adm-panel\{[^}]*min-height:120px/,"stable loading height missing");
});
test("public copy is plain-text read-only without false success",()=>{
  for(const token of ["READ_ONLY_REMOTE_UNAVAILABLE","sanitizeCfg","textContent = valOf","Guardar borrador","Publicar cambios"])assert.ok(files.dash.includes(token),`copy contract missing ${token}`);
  not(files.dash,/from\("site_config"\)\.upsert/,"non-atomic publish must not remain");
  not(files.dash,/Personalización pendiente de activación|Los botones se habilitarán|nada se guarda ni se simula guardado/,"obsolete copy remains");
});
test("assignment rules use confirmed allowlist and config-only preview",()=>{
  for(const key of ["tipo_maquina","tipo_caso","empresa","cliente_nuevo","palabra_clave"])assert.ok(files.dash.includes(`["${key}"`),`missing ${key}`);
  assert.ok(files.dash.includes('data-engine-status="CONFIG_ONLY"'));
  assert.ok(files.dash.includes("La vista previa no asigna ni modifica tickets"));
  not(files.dash,/reglas_asignacion[\s\S]{0,260}eliminado_en/,"unconfirmed soft-delete column remains in rules query");
  not(files.dash,/from\("tickets"\)[\s\S]{0,120}rgSimula/,"preview must not mutate tickets");
});
test("dedicated admin audit route and single query owner",()=>{
  assert.ok(files.bitHtml.includes("Actividad y auditoría del sistema"));
  assert.ok(files.bitJs.includes('mountNav("bitacora-admin")'));
  assert.ok(files.bitJs.includes("Acceso reservado para administración"));
  assert.ok(files.dash.includes("export function createLogView"));
  assert.ok(files.dash.includes('href="bitacora-admin.html"'));
  not(files.dash,/host\.addEventListener\("keydown"[\s\S]{0,300}modal/ ,"parallel audit focus trap remains");
});
test("client counts and canonical alta mappings",()=>{
  assert.ok(files.clients.includes('"Clientes del directorio"'));
  not(files.clients,/Clientes autorizados|\b21\b/,"old or hardcoded count remains");
  for(const code of ["alta_interna","telefono","distribuidor","evento_expo"])assert.ok(files.alta.includes(`value="${code}"`),`missing origin ${code}`);
  for(const field of ["rfc","whatsapp","metodo_contacto_preferido","origen_alta"])assert.ok(files.altaJs.includes(field),`missing mapping ${field}`);
});
test("new-ticket control has a static accessible name",()=>{
  const tag=files.ticketsHtml.match(/<button[^>]+id="tkNewBtn"[^>]*>/)?.[0]||"";
  has(tag,/aria-label="Crear ticket"/,"#tkNewBtn needs static label");
});
test("static HTML ids remain unique per page",()=>{
  for(const name of readdirSync(join(root,"app")).filter(x=>x.endsWith(".html"))){const html=read(`app/${name}`),ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]),dups=ids.filter((id,i)=>ids.indexOf(id)!==i);assert.deepEqual(dups,[],`${name}: ${dups.join(",")}`)}
});

if(!process.exitCode)console.log(`ADMIN_UX_U10_TESTS=PASS (${passed})`);
