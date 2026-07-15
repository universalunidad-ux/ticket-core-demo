import fs from "node:fs";
import path from "node:path";

const root=path.resolve(process.argv[2]||".");
const src=fs.readFileSync(path.join(root,"app/tickets.js"),"utf8");
const fail=m=>{console.error(`STORED_XSS_GATE: FAIL — ${m}`);process.exit(1)};
for(const helper of ["const htmlText=","const htmlAttr=","const ticketDomId="])if(!src.includes(helper))fail(`falta ${helper}`);
if(!/\^\[A-Za-z0-9_-\]\{1,128\}\$/.test(src))fail("el allowlist de IDs no está presente");
const segment=(start,end)=>{const a=src.indexOf(start),b=src.indexOf(end,a+start.length);if(a<0||b<0)fail(`no se encontró el segmento ${start}`);return src.slice(a,b)};
const renderers=[
  ["tkColModalRow","const tkColModalRow=","const mobileStateSet="],
  ["closedRow","const closedRow=","const renderClosed="],
  ["card","const card=","const compactRow="],
  ["compactRow","const compactRow=","const renderCompact="]
];
for(const [name,start,end] of renderers){
  const s=segment(start,end);
  if(!s.includes("htmlText(")||!s.includes("ticketDomId(t.id)"))fail(`${name} no aplica escape de texto e ID`);
  if(!s.includes("htmlAttr(id)"))fail(`${name} no aplica escape de atributos`);
  for(const raw of ["${t.id}","${t.titulo}","${t.descripcion}","${t.empresa_capturada}","${t.folio}"])if(s.includes(raw))fail(`${name} interpola ${raw} sin protección`);
}
for(const payload of ["<img src=x onerror=alert(1)>","<script>alert(1)</script>","<svg onload=alert(1)>","javascript:alert(1)"])if(!src.includes(payload))fail(`falta payload sintético ${payload}`);
if(!src.includes("DEV_XSS_FIXTURE")||!src.includes("xssFixtureTickets"))fail("falta fixture local sin red");
console.log(`STORED_XSS_GATE: PASS (${renderers.length} renderers; fixture sintética incluida)`);
