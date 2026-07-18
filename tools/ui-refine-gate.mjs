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
  // B17C46: contrato de publicación — un aviso inactivo/vencido/futuro no se renderiza
  has(js,/const isPublishableNotice=/,"soporte: contrato isPublishableNotice para avisos");
  has(js,/renderNotice\(isPublishableNotice\(data\)/,"soporte: renderNotice aplica el contrato de publicación");
  has(js,/if\(n\.activo!==true\)return false/,"soporte: un aviso desactivado nunca es publicable");
  // B17C46: subtítulo de marca
  has(html,/jn-brand-sub">SERVICIO AL CLIENTE</,"soporte: subtítulo SERVICIO AL CLIENTE");
  not(html,/jn-brand-sub">(?:MESA DE ATENCIÓN|ATENCIÓN AL CLIENTE)</,"soporte: subtítulos anteriores retirados");
  // B17C46 addendum: scroll natural del documento conservado (sin app-shell)
  not(css,/html,\s*body,\s*main\{[^}]*overflow:hidden/,"soporte: sin overflow:hidden en html/body/main");
  // B17C48: escritorio — la ZONA PRINCIPAL (ambas columnas) es el contenedor
  // desplazable; rueda funciona en cualquier lado; vista previa sticky.
  has(css,/@media\(min-width:1024px\)\{[\s\S]*?\.support-layout\{[^}]*overflow-y:auto/,"soporte: zona principal es el contenedor desplazable (rueda en cualquier lado)");
  has(css,/@media\(min-width:1024px\)\{[\s\S]*?\.support-layout\{[^}]*scrollbar-gutter:stable/,"soporte: gutter estable en la zona desplazable");
  has(css,/@media\(min-width:1024px\)\{[\s\S]*?body\[data-surface="client"\]\{[^}]*height:100dvh/,"soporte: desktop usa altura de viewport (no altura mágica)");
  has(css,/@media\(min-width:1024px\)\{[\s\S]*?\.support-side\{[^}]*position:sticky/,"soporte: vista previa sticky (inmóvil) en desktop");
  has(css,/html\{scrollbar-gutter:stable\}/,"soporte: html con gutter estable (móvil sin salto de ancho)");
  not(js,/addEventListener\(\s*["']wheel["']/,"soporte: sin listener de wheel (JS)");
  not(css,/\.(?:soporte-page|support-layout|support-form|support-side|hero-support)[^{]*\{[^}]*100vw/,"soporte: contenedores de layout sin 100vw");
  // móvil/tablet conserva scroll natural del documento
  has(css,/@media \(max-width:1023px\)\{[\s\S]*?main\.soporte-page\{[^}]*overflow:visible/,"soporte: móvil/tablet conserva scroll natural del documento");
  // B17C48: texto humano de recuperación de borrador
  has(js,/Recuperamos tus datos\. Si habías adjuntado un archivo/,"soporte: copy humano de recuperación de borrador");
  not(js,/Restauramos tu borrador\. Por seguridad/,"soporte: copy técnico anterior de borrador retirado");
  // botón Enviar DENTRO del contenedor desplazable (#supportForm)
  has(html,/id="supportForm"[\s\S]*id="spSendBtn"[\s\S]*<\/form>/,"soporte: botón Enviar dentro del formulario desplazable");
  // honeypot fuera de vista, no enfocable, función intacta
  has(html,/class="sp-hp"[^>]*clip:rect/,"soporte: honeypot oculto por clip (sin overflow)");
  has(html,/id="spWebsite"[^>]*tabindex="-1"/,"soporte: honeypot no enfocable (tabindex -1)");
  // textos de evidencia
  not(html,/<h3>Sube tu evidencia<\/h3>/,"soporte: encabezado h3 redundante 'Sube tu evidencia' retirado");
  not(html,/<h3>Envía tu caso de soporte<\/h3>/,"soporte: encabezado 'Envía tu caso de soporte' retirado");
  has(html,/for="spFiles">Sube tu evidencia</,"soporte: etiqueta del cargador = 'Sube tu evidencia'");
  has(html,/Imagen \(máx\. 3\), vídeo \(máx\. 1 m 30s\) o PDF\./,"soporte: hint de evidencia actualizado");
  not(html,/Escribe tu modelo o el tipo \(ej/,"soporte: hint redundante del combo de producto retirado");
}

// ---- ESTADO (Commit B) ----
{
  const html=read("app/estado.html"),js=read("app/estado.js"),css=read("app/estado.css");
  // Producto: transformación central única "Categoría · modelo"
  has(js,/import\{formatProductoPublic\}from"\.\/shared\/producto\.js/,"estado: usa el módulo central de producto");
  has(js,/formatProductoPublic\(t\?\.producto_modelo\)/,"estado: producto se presenta con formatProductoPublic");
  not(js,/const visibleProduct=/,"estado: helper viejo visibleProduct retirado (sin capa duplicada)");
  // B17C46: pill dinámica del header ELIMINADA (HTML/JS/CSS)
  not(html,/class="estado-hero"/,"estado: barra hero retirada");
  not(html,/id="stHeaderStatus"/,"estado: pill dinámica del header eliminada del HTML");
  not(js,/stHeaderStatus/,"estado: sin referencias JS a la pill del header");
  not(css,/\.estado-header-status\b/,"estado: estilos de la pill del header retirados");
  not(js,/Estamos revisando tu caso y te avisaremos/,"estado: texto dinámico de la pill eliminado");
  not(html,/Así va tu solicitud/,"estado: subtítulo redundante de progreso retirado");
  // B17C46: subtítulo de marca
  has(html,/jn-brand-sub">SERVICIO AL CLIENTE</,"estado: subtítulo SERVICIO AL CLIENTE");
  not(html,/jn-brand-sub">(?:MESA DE ATENCIÓN|ATENCIÓN AL CLIENTE)</,"estado: subtítulos anteriores retirados");
  // Resumen grid
  has(css,/\.estado-summary-head\{display:grid/,"estado: Resumen en grid de dos columnas");
  // B17C46: título + badge en flujo inline (sin fila propia, sin absolute)
  has(css,/\.estado-summary-title h2\{display:inline/,"estado: h2 del título en display:inline");
  has(css,/\.estado-summary-title \.estado-status-pill\{[^}]*vertical-align/,"estado: badge inline continúa tras el título");
  // Progreso: solo el activo respira, con guard de reduced-motion
  has(css,/@media\(prefers-reduced-motion:no-preference\)\{\.tl-item\.active::before\{animation:tlActivePulse/,"estado: solo el punto activo anima (respeta reduced-motion)");
  // Cabecera del chat simplificada
  has(html,/chat-pop-kicker">Historial del caso/,"estado: cabecera del chat = Historial del caso");
  not(html,/chat-pop-title|id="stChatSub"/,"estado: cabecera del chat sin título/subtítulo redundantes");
  // B17C46: ayuda del chat — orden correcto, sin duplicar, con clic fuera
  has(html,/id="stChatReplyHelp"[\s\S]{0,400}?Puedes escribir aquí[\s\S]{0,400}?Hasta 3 fotos y 1 PDF[\s\S]{0,200}?chat-video-future/,"estado: ayuda del chat en el orden correcto");
  not(html,/id="stReplyFilesMetaPop"/,"estado: nota duplicada bajo el compositor eliminada");
  const h3f=(html.match(/Hasta 3 fotos y 1 PDF/g)||[]).length;
  h3f===1?ok("estado: 'Hasta 3 fotos y 1 PDF' aparece una sola vez"):bad("estado: ayuda de archivos duplicada/ausente ("+h3f+")");
  has(js,/#stChatReplyHelp,#stChatHelpToggle/,"estado: ayuda del chat cierra por clic fuera (y no al hacer clic dentro)");
  const vf=(html.match(/chat-video-future/g)||[]).length;
  vf===1?ok("estado: 'Video: próximamente' aparece una sola vez (en el popover)"):bad("estado: 'Video: próximamente' duplicado/ausente ("+vf+")");
  has(css,/\.chat-reply-help\{position:absolute/,"estado: ayuda del chat es popover flotante (no empuja el flujo)");
  // B17C46: compositor compacto integrado (paridad ticket.html), sin botón verde ancho
  has(html,/composer-input-wrap chat-compose-wrap/,"estado: compositor en cápsula única");
  not(html,/class="chat-compose-row"/,"estado: fila con botón verde ancho retirada");
  has(html,/id="stReplySendPop"[^>]*aria-label="Enviar respuesta"/,"estado: botón enviar conserva aria-label");
  has(css,/\.chat-compose-wrap \.chat-send-btn\{[^}]*enviar\.png/,"estado: botón enviar usa IMG/enviar.png (paridad ticket)");
  // B17C47: attach + textarea + send DENTRO de la misma cápsula, en orden
  has(html,/chat-compose-wrap"[\s\S]{0,400}?id="stAttachBtn"[\s\S]{0,400}?id="stReplyTextPop"[\s\S]{0,400}?id="stReplySendPop"/,"estado: adjuntar, textarea y enviar en la misma cápsula");
  fs.existsSync(path.join(root,"IMG/enviar.png"))?ok("estado: IMG/enviar.png existe"):bad("estado: IMG/enviar.png ausente");
  // B17C47: sin ayuda larga permanente bajo el compositor (solo estado breve)
  has(js,/\$\("#stReplyStatusPop"\)&&\(\$\("#stReplyStatusPop"\)\.textContent=shortMsg\)/,"estado: bajo el compositor solo estado breve (no ayuda larga)");
  const helpLong=(html.match(/Puedes escribir aquí si tienes un dato nuevo/g)||[]).length;
  helpLong===1?ok("estado: la ayuda larga aparece una sola vez (en el popover)"):bad("estado: ayuda larga duplicada/ausente ("+helpLong+")");
  // B17C47: miniatura del archivo seleccionado en el chip
  has(js,/chat-pick-thumb/,"estado: miniatura del archivo seleccionado en el chip");
  // B17C47: guardas runtime — sin .textContent a nodo obligatorio sin verificar
  not(js,/\$\("#stLastSupportText"\)\.textContent/,"estado: setLastSupport no accede a .textContent sin guard");
  not(js,/stReplyFilesMetaPop/,"estado: sin referencias al nodo eliminado stReplyFilesMetaPop");
  // B17C47: IDs requeridos por estado.js presentes en estado.html
  for(const id of ["stChatCompose","stReplyTextPop","stAttachBtn","stReplySendPop","stReplyFilesPop","stFileChips","stReplyStatusPop","stChatReplyHelp","stChatHelpToggle","stHelpPop","stHelpBtn","stNotifyPanel","stLastSupportCard","stLastSupportText","stLastSupportMeta","stOpenChatBtn2"])
    (new RegExp(`id="${id}"`).test(html))?ok(`estado: ID requerido presente #${id}`):bad(`estado: falta ID requerido por JS #${id}`);
  // B17C47: versión de assets incrementada (rompe caché mezclada)
  has(html,/estado\.js\?v=frontend-final-20260716-01/,"estado: versión de assets incrementada (20260716-01)");
  // B17C46: límite de mensajes — copy breve, encabezado redundante fuera
  has(html,/Puedes enviar hasta 2 mensajes seguidos/,"estado: copy de límite presente");
  not(html,/Envía lo que te pedimos para avanzar/,"estado: encabezado redundante retirado");
  // B17C46 addendum: 'Último mensaje del equipo' RESTAURADO — owner único, datos reales
  has(html,/id="stLastSupportCard"/,"estado: bloque 'Último mensaje del equipo' presente");
  has(html,/section-kicker">Último mensaje del equipo</,"estado: encabezado 'Último mensaje del equipo' presente");
  has(js,/const setLastSupport=/,"estado: owner setLastSupport presente");
  ((js.match(/const setLastSupport=/g)||[]).length===1)?ok("estado: setLastSupport es owner único (sin duplicar)"):bad("estado: setLastSupport duplicado");
  has(js,/renderLoadedTicket=t=>[\s\S]*?setLastSupport\(t\)/,"estado: setLastSupport se invoca en el render");
  has(js,/find\(x=>x\.autor==="soporte"\)/,"estado: último mensaje usa el último de soporte (no cliente)");
  has(js,/stOpenChatBtn2"\)\?\.addEventListener\("click",openChat\)/,"estado: 'Abrir conversación' reutiliza openChat (sin listener nuevo)");
  ((js.match(/stOpenChatBtn2"\)\?\.addEventListener/g)||[]).length===1)?ok("estado: sin listener duplicado en stOpenChatBtn2"):bad("estado: listener duplicado en stOpenChatBtn2");
  // B17C46: interpretación rápida sin lista HTML básica
  not(html,/id="stHelpPop"[\s\S]{0,300}?<ul class="mini-list"/,"estado: interpretación rápida sin <ul class=mini-list>");
  has(html,/class="help-states"/,"estado: interpretación rápida en filas compactas");
  // B17C46: panel de notificaciones — título único, sin parpadeo
  has(html,/st-notify-title" id="stNotifyTitle">Notificaciones</,"estado: panel de notificaciones con título único");
  has(js,/if\(!ST\.seenFirstLoad\)renderNotificationPanel\("loading"\)/,"estado: notificaciones no se limpian en polls silenciosos");
  has(js,/ST\.notifyRenderSig/,"estado: notificaciones con guard de firma (sin parpadeo)");
  // Idempotencia de binds (sin listeners duplicados)
  has(js,/dataset\.estadoNotifyBound/,"estado: bind principal con guard de idempotencia");
  has(js,/dataset\.stReplyHelpBound/,"estado: ayuda del chat con guard de idempotencia");
  // Notificaciones humanizadas
  has(js,/const fmtNotifTime=/,"estado: notificaciones con fecha/hora humanizada (Hoy/Ayer, sin segundos)");
  // B17C48: metadata del mensaje — hora al extremo derecho, botón responder antes
  has(js,/<div class="chat-msg-time">\$\{canReply/,"estado: botón responder va ANTES de la hora (no la empuja)");
  has(js,/<span class="chat-msg-time-t">\$\{fmtT\(x\.fecha\)\}<\/span>/,"estado: la hora es el último elemento (pegada al borde)");
  has(css,/\.chat-msg-time\{[^}]*margin-inline-start:auto/,"estado: la hora se alinea al extremo derecho (margin-inline-start:auto)");
  not(css,/\.estado-(?:grid|page|summary-head|kpis|main|side)[^{]*\{[^}]*100vw/,"estado: contenedores de layout sin 100vw (overlays fixed exentos)");
}

// ---- SHELL PÚBLICO (estado + soporte, data-surface=client) ----
{
  const gcss=read("app/global.css"),ecss=read("app/estado.css"),scss=read("app/soporte.css");
  const estadoHtml=read("app/estado.html"),soporteHtml=read("app/soporte.html");
  has(gcss,/--public-shell-width:min\(80vw,1680px\)/,"shell: variable --public-shell-width definida (~80%)");
  has(gcss,/body\[data-surface=client\] \.wrap,[\s\S]{0,120}?\.jn-topbar-inner\{[^}]*width:var\(--public-shell-width\)/,"shell: .wrap y topbar interior usan el shell (owner compartido)");
  has(gcss,/@media\(min-width:1280px\)/,"shell: se centra a ~80% desde escritorio amplio");
  not(gcss,/body\[data-surface=client\][^{]*\{[^}]*width:100vw/,"shell: sin width:100vw en el shell público");
  // PUBLIC-MOBILE-HEADER-20260717: owner compartido y layout determinista.
  has(gcss,/PUBLIC-MOBILE-HEADER-20260717[\s\S]*?body\[data-surface=client\] \.jn-topbar-inner\{[\s\S]*?display:grid;[\s\S]*?grid-template-columns:auto minmax\(0,1fr\) auto/,"header público: owner Grid compartido y determinista");
  has(gcss,/\.jn-topbar-inner\{[^}]*min-width:0/,"header público: inner permite encogimiento controlado");
  has(gcss,/\.jn-brand\{[^}]*min-width:0/,"header público: identidad aplica min-width:0");
  has(gcss,/\.jn-brand-sub\{[^}]*white-space:nowrap/,"header público: subtítulo nunca se fragmenta");
  has(gcss,/\.jn-top-actions\{[^}]*flex-wrap:nowrap/,"header público: acciones no dependen de flex-wrap accidental");
  has(gcss,/safe-area-inset-left/,"header público: respeta safe area izquierda");
  has(gcss,/safe-area-inset-right/,"header público: respeta safe area derecha");
  has(gcss,/body\[data-surface=client\] \.jn-topbar\{[^}]*padding-top:env\(safe-area-inset-top,0px\)/,"header público: owner sticky respeta safe area superior una sola vez");
  has(gcss,/\.jn-top-actions \.mini,[\s\S]{0,100}?\.st-notify-btn\{[^}]*min-width:44px;[^}]*min-height:44px/,"header público: controles táctiles de al menos 44px");
  has(gcss,/\.jn-top-actions \.jn-theme-btn\{[^}]*width:96px;[^}]*min-width:96px/,"header público: selector de tema reserva ancho estable");
  has(gcss,/@media\(max-width:430px\)\{[\s\S]*?\.jn-brand\{[^}]*display:grid/,"header público: identidad apilada de forma controlada hasta 430px");
  has(gcss,/@media\(max-width:430px\)\{[\s\S]*?\.jn-brand-sub\{[^}]*white-space:nowrap/,"header público: subtítulo móvil permanece en una sola línea");
  has(gcss,/@media\(max-width:430px\)\{[\s\S]*?\.jn-theme-btn\{[^}]*width:44px;[\s\S]*?\[data-theme-label\]\{[^}]*clip-path:inset\(50%\)/,"header público: tema compacto estable conserva nombre accesible en 320–430px");
  has(scss,/\.hero-support-aside \.support-global-notice\{[^}]*max-height:none;[^}]*overflow:visible\}/,"soporte: aviso crece completo en móvil/tablet");
  has(scss,/@media\(min-width:1024px\)\{\s*\.hero-support-aside \.support-global-notice\{[^}]*max-height:132px;[^}]*overflow:auto\}/,"soporte: límite compacto de aviso pertenece solo a escritorio");
  not(scss,/@media\s*\(max-width:[^)]+\)[^{]*\{[\s\S]{0,500}?\.hero-support-aside \.support-global-notice\{[^}]*max-height:132px/,"soporte: ningún owner móvil/tablet reimpone 132px");
  not(`${ecss}\n${scss}`,/(?:^|\n)\.jn-(?:topbar|topbar-inner|brand|brand-img|brand-sub|top-actions|wa-pill)(?:\{|:)/,"header público: sin owners base duplicados por página");
  not(`${gcss}\n${ecss}\n${scss}`,/\.jn-brand-sub[^,{]*\{[^}]*display\s*:\s*none/,"header público: subtítulo nunca se elimina con display:none");
  not(gcss,/\.jn-topbar-inner\{[^}]*width:100vw/,"header público: inner sin width:100vw");
  ((gcss.match(/PUBLIC-MOBILE-HEADER-20260717/g)||[]).length===1)?ok("header público: owner compartido único"):bad("header público: owner compartido ausente o duplicado");
  for(const [page,html] of [["estado",estadoHtml],["soporte",soporteHtml]])
    has(html,/class="jn-wa-pill"[^>]*aria-label="WhatsApp 55 6843 7918"/,`${page}: WhatsApp conserva nombre accesible al ocultar el teléfono visual`);
  for(const [page,html] of [["estado",estadoHtml],["soporte",soporteHtml]])
    has(html,/global\.css\?r=public-responsive-20260717-03&v=frontend-final-20260716-01/,`${page}: carga la versión corregida del owner compartido dentro de la release canónica`);
}

// ---- TICKETS (Commit C) ----
{
  const css=read("app/tickets.css");
  has(css,/\.tk-quick-db-pills \.mini\.btn-brand,\n[^\n]*\.tk-quick-chips \.mini\.btn-brand\{[\s\S]*?color:#fff!important/,"tickets: quick reply seleccionada usa texto blanco sobre relleno de marca (contraste)");
  has(css,/\.tk-quick-db-pills \.mini\.btn-brand::before[\s\S]*?content:"\u2713"/,"tickets: selección marcada con ✓ (no depende solo del color)");
  has(css,/\.tk-quick-chips \.mini:focus-visible[\s\S]*?outline:3px/,"tickets: quick reply tiene foco visible por teclado");
  has(css,/\.tk-quick-chips \.mini:disabled\{opacity:\.55!important;cursor:not-allowed/,"tickets: estado disabled definido");
}

if(fails){console.error(`UI_REFINE_GATE: FAIL — ${fails} comprobación(es)`);process.exit(1)}
console.log("UI_REFINE_GATE: PASS");
