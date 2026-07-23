import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root=path.resolve(process.argv[2]||".");
const read=p=>fs.readFileSync(path.join(root,p),"utf8");
const html=read("app/soporte.html");
const js=read("app/soporte.js");
const edge=read("supabase/functions/support-submit-secure/index.ts");
const owner=read("supabase/functions/_shared/support-contract.ts");
const upstream=Buffer.from(read("supabase/functions/support-submit-secure/upstream-v57/index.ts.b64").replace(/\s+/g,""),"base64").toString("utf8");
const sourceMeta=JSON.parse(read("supabase/functions/support-submit-secure/source-v57.json"));
const sql=read("docs/TC_P0_SUPPORT_OPTIONAL_COMPANY_MIGRATION_DRAFT.sql");
const fail=m=>{console.error(`SUPPORT_COMPANY_GATE: FAIL — ${m}`);process.exit(1)};
const hash=s=>crypto.createHash("sha256").update(s).digest("hex");

const tag=html.match(/<input\b[^>]*\bid=["']spCompany["'][^>]*>/i)?.[0]||"";
if(!tag)fail("falta #spCompany");
if(/\srequired(?:\s|=|>)/i.test(tag)||/aria-required=["']true["']/i.test(tag))fail("Empresa sigue marcada como obligatoria en HTML");
if(!/placeholder=["']Opcional["']/i.test(tag))fail("Empresa no comunica que es opcional");
const validation=js.slice(js.indexOf("const validatePublicPayload"),js.indexOf("const IDENTITY_KEY",js.indexOf("const validatePublicPayload")));
if(!validation||/!p\.empresa|empresa\s*\.\s*trim\s*\(\)/.test(validation))fail("la validación frontend exige empresa");
if(!/empresa:trimVal\(["']spCompany["']\)\|\|null/.test(js))fail("el frontend no serializa Empresa ausente como null");
if(/empresa\s*:\s*["'](?:Sin empresa|No especificada|N\/A)["']/i.test(js))fail("se detectó un fallback artificial de empresa");

if(sourceMeta.version!==57||sourceMeta.slug!=="support-submit-secure")fail("la procedencia no identifica support-submit-secure v57");
if(sourceMeta.verify_jwt!==false)fail("la procedencia no refleja verify_jwt=false de v57");
if(hash(upstream)!=="ca6d03a4827644c1d8df53fb2c68d99b670fb69115a7b71d6a08369dd8dae9df")fail("el snapshot v57 decodificado no coincide con la fuente recuperada");
if(!/case "empresa": value\[field\] = textValue\(raw, field, issues, \{ max: 160, nullable: true \}\);/.test(owner))fail("el owner DTO no conserva Empresa nullable/max-160");
if(!/solicitudes_soporte["']\)\.insert\(\{folio,nombre,empresa:empresa\|\|null/.test(edge))fail("la inserción no serializa empresa || null");
if(!/alter\s+table\s+public\.solicitudes_soporte\s+alter\s+column\s+empresa\s+drop\s+not\s+null/i.test(sql))fail("el borrador SQL no elimina NOT NULL de solicitudes_soporte.empresa");
if(/\bupdate\s+public\.solicitudes_soporte\b/i.test(sql)||/set\s+default\s+["'](?:Sin empresa|N\/A)/i.test(sql))fail("el borrador SQL fabrica datos de Empresa");

const marker="// VALIDATION_BARRIER_REACHED";
const handlerStart=edge.indexOf("export const handler");
const markerIndex=edge.indexOf(marker,handlerStart);
const before=edge.slice(handlerStart,markerIndex);
const directCompany=/\b(?:payload|parsedPayload)\??\.empresa\b/u;
const manualCoercion=/sanitize\s*\(\s*(?:payload|parsedPayload)\??\.empresa/u;
const writePatterns=[
  /\brateLimit\s*\(/u,/\blogSecurity\s*\(/u,/\bsb\.rpc\s*\(/u,
  /\.insert\s*\(/u,/\.update\s*\(/u,/\.delete\s*\(/u,
  /\.upload\s*\(/u,/\.remove\s*\(/u,/\bgetNextFolio\s*\(/u,
  /\baddTicketEvento\s*\(/u,/\baddArchivoTicket\s*\(/u,
];

function companyWiringFailures(source){
  const failures=[];
  const start=source.indexOf("export const handler");
  const barrier=source.indexOf(marker,start);
  const pre=source.slice(start,barrier);
  const dtoParse=pre.indexOf("const dtoResult=parsePublicSupportDto(parsedPayload);");
  const dtoValue=pre.indexOf("const dto:PublicSupportDto=dtoResult.value;");
  const company=pre.indexOf("empresa=dto.empresa");
  if(start<0||barrier<0||source.split(marker).length-1!==1)failures.push("barrera ausente o duplicada");
  if(dtoParse<0||dtoValue<=dtoParse||company<=dtoValue)failures.push("wiring ejecutable dto.empresa ausente o fuera de orden");
  if(directCompany.test(source))failures.push("lectura directa de payload.empresa");
  if(manualCoercion.test(source))failures.push("coerción manual de payload.empresa");
  if(/empresa=dto\.empresa\s*(?:\|\||\?\?)/u.test(source))failures.push("fallback de empresa elude el DTO");
  if(writePatterns.some(pattern=>pattern.test(pre)))failures.push("write antes de VALIDATION_BARRIER_REACHED");
  return failures;
}

const failures=companyWiringFailures(edge);
if(failures.length)fail(failures.join("; "));
if(!/matchCliente\(empresa\|\|["']["'],correo,telefono\)/.test(edge))fail("el matching no protege la Empresa ausente");

const mutations=[
  edge.replace("empresa=dto.empresa","empresa=payload?.empresa"),
  edge.replace("empresa=dto.empresa","empresa=sanitize(payload?.empresa,160)||null"),
  edge.replace("empresa=dto.empresa","empresa=dto.empresa||\"Sin empresa\""),
  edge.replace("const dtoResult=parsePublicSupportDto(parsedPayload);","await rateLimit(\"mutant\",ip,1,1);const dtoResult=parsePublicSupportDto(parsedPayload);"),
];
for(const [index,mutant] of mutations.entries()){
  assert.ok(companyWiringFailures(mutant).length>0,`company mutant ${index+1} survived`);
}

console.log("SUPPORT_COMPANY_GATE: PASS (COMPANY_SOURCE=DTO_ONLY DIRECT_PAYLOAD_COMPANY_READS=0 HANDLER_COMPANY_SANITIZE_COERCIONS=0 COMPANY_MAX_LENGTH=160 COMPANY_NULLABLE=YES VALIDATION_BARRIER=22_TO_0)");
