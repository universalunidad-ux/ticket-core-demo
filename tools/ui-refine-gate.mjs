/* UI-REFINE 20260715 — pruebas específicas de esta unidad.
   No duplica lógica de la app; verifica que las correcciones estén presentes
   y que no reaparezcan las capas conflictivas retiradas. */
import fs from "node:fs";
import path from "node:path";
const root=path.resolve(process.argv[2]||".");
const read=p=>fs.readFileSync(path.join(root,p),"utf8");
let fails=0;
const ok=m=>console.log("  ok  "+m);
const bad=m=>{console.error("  FAIL "+m);fails++};
const has=(s,re,m)=>re.test(s)?ok(m):bad(m);
const not=(s,re,m)=>re.test(s)?bad(m):ok(m);

// ---- SOPORTE (Commit A) ----
{
  const html=read("app/soporte.html"),js=read("app/soporte.js"),css=read("app/soporte.css");
  // Empresa opcional y contractual (null, no "" ni fallback falso)
  has(js,/empresa:trimVal\(["']spCompany["']\)\|\|null/,"soporte: empresa ausente se envía como null");
  not(js,/empresa\s*:\s*["'](?:N\/A|Sin empresa|No especificad[ao])["']/i,"soporte: sin fallback artificial de empresa");
  not(read("app/soporte.html"),/id=["']spCompany["'][^>]*\brequired\b/i,"soporte: Empresa no es required en HTML");
  // Scroll natural: hijack de rueda retirado y sin app-shell lock
  not(js,/bindSupportFormWheel/,"soporte: hijack de rueda (bindSupportFormWheel) retirado");
  not(css,/min-height:640px/,"soporte: app-shell scroll-lock (min-height:640px) retirado");
  not(css,/main\.soporte-page\{[^}]*overflow:hidden/,"soporte: main sin overflow:hidden fijo");
  // Hero: título + slot de aviso a la derecha (owner reubicado, sin duplicar)
  has(html,/id=["']supportNoticeSlot["']/,"soporte: hero tiene slot de aviso");
  const n=(html.match(/id=["']supportGlobalNotice["']/g)||[]).length;
  n===1?ok("soporte: un solo #supportGlobalNotice (sin duplicado)"):bad("soporte: #supportGlobalNotice duplicado o ausente ("+n+")");
  has(js,/\$\(["']#supportNoticeSlot["']\)/,"soporte: renderNotice apunta al slot del hero");
}

if(fails){console.error(`UI_REFINE_GATE: FAIL — ${fails} comprobación(es)`);process.exit(1)}
console.log("UI_REFINE_GATE: PASS");
