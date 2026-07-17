import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root=path.resolve(process.argv[2]||".");
const read=p=>fs.readFileSync(path.join(root,p),"utf8");
const html=read("app/soporte.html");
const js=read("app/soporte.js");
const edge=read("supabase/functions/support-submit-secure/index.ts");
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
if(!/empresa=sanitize\(payload\?\.empresa,160\)\|\|null/.test(edge))fail("la Edge no normaliza Empresa ausente a null");
const required=edge.slice(edge.indexOf("const nombre="),edge.indexOf("if(!correo"));
if(!required||/!empresa/.test(required))fail("la Edge local todavía exige Empresa");
if(!/matchCliente\(empresa\|\|["']["'],correo,telefono\)/.test(edge))fail("el matching no protege la Empresa ausente");
if(!/solicitudes_soporte["']\)\.insert\(\{folio,nombre,empresa:empresa\|\|null/.test(edge))fail("la inserción no serializa empresa || null");
if(!/alter\s+table\s+public\.solicitudes_soporte\s+alter\s+column\s+empresa\s+drop\s+not\s+null/i.test(sql))fail("el borrador SQL no elimina NOT NULL de solicitudes_soporte.empresa");
if(/\bupdate\s+public\.solicitudes_soporte\b/i.test(sql)||/set\s+default\s+["'](?:Sin empresa|N\/A)/i.test(sql))fail("el borrador SQL fabrica datos de Empresa");

console.log("SUPPORT_COMPANY_GATE: PASS (frontend + Edge v57 + SQL draft)");
