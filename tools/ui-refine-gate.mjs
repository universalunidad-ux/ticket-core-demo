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

// ---- ESTADO (Commit B) ----
{
  const html=read("app/estado.html"),js=read("app/estado.js"),css=read("app/estado.css");
  // Producto: transformación central única "Categoría · modelo"
  has(js,/import\{formatProductoPublic\}from"\.\/shared\/producto\.js/,"estado: usa el módulo central de producto");
  has(js,/formatProductoPublic\(t\?\.producto_modelo\)/,"estado: producto se presenta con formatProductoPublic");
  not(js,/const visibleProduct=/,"estado: helper viejo visibleProduct retirado (sin capa duplicada)");
  // Hero retirado + pill al header
  not(html,/class="estado-hero"/,"estado: barra hero retirada");
  has(html,/id="stHeaderStatus"/,"estado: pill de estado movida al header");
  not(html,/Así va tu solicitud/,"estado: subtítulo redundante de progreso retirado");
  // Resumen grid
  has(css,/\.estado-summary-head\{display:grid/,"estado: Resumen en grid de dos columnas");
  // Progreso: solo el activo respira, con guard de reduced-motion
  has(css,/@media\(prefers-reduced-motion:no-preference\)\{\.tl-item\.active::before\{animation:tlActivePulse/,"estado: solo el punto activo anima (respeta reduced-motion)");
  // Cabecera del chat simplificada
  has(html,/chat-pop-kicker">Historial del caso/,"estado: cabecera del chat = Historial del caso");
  not(html,/chat-pop-title|id="stChatSub"/,"estado: cabecera del chat sin título/subtítulo redundantes");
  // Ayuda del compositor sin duplicar bajo el chat
  const vf=(html.match(/chat-video-future/g)||[]).length;
  vf===1?ok("estado: 'Video: próximamente' aparece una sola vez (en el popover)"):bad("estado: 'Video: próximamente' duplicado/ausente ("+vf+")");
  has(css,/\.chat-reply-help\{position:absolute/,"estado: ayuda del chat es popover flotante (no empuja el flujo)");
  // Notificaciones humanizadas
  has(js,/const fmtNotifTime=/,"estado: notificaciones con fecha/hora humanizada (Hoy/Ayer, sin segundos)");
}

if(fails){console.error(`UI_REFINE_GATE: FAIL — ${fails} comprobación(es)`);process.exit(1)}
console.log("UI_REFINE_GATE: PASS");
