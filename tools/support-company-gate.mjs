import fs from "node:fs";
import path from "node:path";

const root=path.resolve(process.argv[2]||".");
const read=p=>fs.readFileSync(path.join(root,p),"utf8");
const html=read("app/soporte.html"),js=read("app/soporte.js");
const edgePath=path.join(root,"supabase/functions/support-submit-secure/index.ts");
const edge=fs.existsSync(edgePath)?fs.readFileSync(edgePath,"utf8"):"";
const fail=m=>{console.error(`SUPPORT_COMPANY_GATE: FAIL — ${m}`);process.exit(1)};
const tag=html.match(/<input\b[^>]*\bid=["']spCompany["'][^>]*>/i)?.[0]||"";
if(!tag)fail("falta #spCompany");
if(/\srequired(?:\s|=|>)/i.test(tag)||/aria-required=["']true["']/i.test(tag))fail("Empresa sigue marcada como obligatoria en HTML");
if(!/placeholder=["']Opcional["']/i.test(tag))fail("Empresa no comunica que es opcional");
const validation=js.slice(js.indexOf("const validatePublicPayload"),js.indexOf("const IDENTITY_KEY",js.indexOf("const validatePublicPayload")));
if(!validation||/!p\.empresa|empresa\s*\.\s*trim\s*\(\)/.test(validation))fail("la validación frontend exige empresa");
if(!/empresa:trimVal\(["']spCompany["']\)/.test(js))fail("el payload no normaliza Empresa como string vacío");
if(/empresa\s*:\s*["'](?:Sin empresa|No especificada|N\/A)["']/i.test(js))fail("se detectó un fallback artificial de empresa");
if(edge){
  const required=edge.slice(edge.indexOf("const faltan"),edge.indexOf("if(!correo"));
  if(!required||/if\s*\(\s*!empresa\s*\)/.test(required))fail("la Edge local exige empresa");
  if(!/if\s*\(empresaNorm\)/.test(edge))fail("el matching local no protege la empresa vacía");
}
console.log(`SUPPORT_COMPANY_GATE: PASS (frontend${edge?" + Edge local":"; Edge no incluida"})`);
