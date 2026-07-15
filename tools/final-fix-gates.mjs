import fs from "node:fs";
import path from "node:path";
import {isInitialRequestReceivedEvent} from "../app/shared/status-event.js";

const ROOT=process.cwd(),APP=path.join(ROOT,"app"),RELEASE="frontend-final-20260715-01",fail=[];
const read=file=>fs.readFileSync(path.join(ROOT,file),"utf8");
const files=(dir,exts)=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(path.join(dir,entry.name),exts):exts.some(ext=>entry.name.endsWith(ext))?[path.join(dir,entry.name)]:[]);
const assert=(ok,msg)=>{if(!ok)fail.push(msg)};
const htmlFiles=files(APP,[".html"]),sourceFiles=files(APP,[".html",".js"]);
const html=htmlFiles.map(file=>[file,fs.readFileSync(file,"utf8")]);
const activeRefs=html.flatMap(([file,text])=>[...text.matchAll(/(?:href|src)="([^"]+\.(?:css|js)(?:\?[^"#]*)?)"/g)].map(match=>({file,ref:match[1]})));
activeRefs.forEach(({file,ref})=>assert(new URL(ref,"https://example.invalid/app/").searchParams.get("v")===RELEASE,`asset sin release única: ${path.relative(ROOT,file)} -> ${ref}`));
sourceFiles.forEach(file=>{const text=fs.readFileSync(file,"utf8");for(const match of text.matchAll(/\.(?:css|js)\?v=([^"'\s)>]+)/g))assert(match[1]===RELEASE,`query activa anterior: ${path.relative(ROOT,file)} -> ${match[1]}`)});
const globalCssRefs=activeRefs.filter(x=>/(?:^|\/)global\.css\?/.test(x.ref));
assert(globalCssRefs.length>=11,"faltan referencias global.css versionadas");
assert(sourceFiles.some(file=>fs.readFileSync(file,"utf8").includes(`global.js?v=${RELEASE}`)),"global.js no usa release final");

const sw=read("app/sw.js");
assert(sw.includes(`RELEASE="${RELEASE}"`),"SW release incorrecta");
assert(sw.includes("networkFirstPage")&&sw.includes("cacheFirstVersionedAsset"),"SW strategies incompletas");
assert(sw.includes("authorization")&&["auth","rest","functions","storage"].every(x=>sw.includes(x)),"SW no excluye Auth/API completos");
assert(sw.includes("OWN_CACHE.test(key)"),"SW cleanup no está limitado a caches propios");
assert(sw.includes("pageCacheKey")&&!sw.includes("caches.delete(k))"),"SW no normaliza HTML o usa cleanup amplio legacy");
for(const match of sw.matchAll(/"\.\/([^"?]+)(?:\?[^" ]*)?"/g))assert(fs.existsSync(path.join(APP,match[1])),`SW referencia asset ausente: app/${match[1]}`);

const assignment=read("app/ticket-assignment.js"),ticket=read("app/ticket.js"),tickets=read("app/tickets.js"),nav=read("app/shared/nav-interna.js"),global=read("app/global.js"),composer=read("app/ticket-composer-polish.js"),ticketCss=read("app/ticket.css");
assert(assignment.includes("canAssignTicket")&&assignment.indexOf("if(!canAssignTicket()) return")<assignment.indexOf('.from("perfiles")'),"assignment role guard tardío");
assert(assignment.indexOf("if(!canAssignTicket())")<assignment.indexOf('.from("tickets").update'),"assignment write sin guard previo");
assert(ticket.includes("canManageQuickReplies")&&["openQrModal","qrLoadEditor","qrSaveAll","qrSoftDelete","saveQuickReply","deleteQuickReply"].every(name=>ticket.includes(name)),"quick reply guard incompleto");
assert(global.includes("registerGlobalSearchProvider")&&global.includes("clearGlobalSearchProvider")&&global.includes("getGlobalSearchProvider"),"provider API incompleta");
const mountPages=["dashboard","clientes","cliente","consolidacion-clientes","alta-cliente"].filter(name=>read(`app/${name}.js`).includes("mountNav(")).length;
assert(mountPages===5&&ticket.includes("registerInternalSearchProvider")&&tickets.includes("registerInternalSearchProvider")&&nav.includes("internal-role-scoped"),"providers no cubren 7 páginas");
assert(composer.includes("${supPreviewHtml}${supComment?")&&ticketCss.includes(".tc-supervision-forward-preview")&&ticketCss.includes("font-weight:850!important"),"contenido de supervisión incompleto");

const mobile=read("app/tickets.css"),finalMarker=mobile.lastIndexOf("FRONTEND_FINAL: autoridad móvil final");
assert(finalMarker>mobile.lastIndexOf(".kanban-col .col-header{display:flex"),"override móvil no es la autoridad final");
assert(mobile.slice(finalMarker).includes("height:46px!important")&&mobile.slice(finalMarker).includes(".col-header")&&mobile.slice(finalMarker).includes("display:none!important"),"gate móvil incompleto");

const estado=read("app/estado.js"),estadoHtml=read("app/estado.html"),estadoCss=read("app/estado.css");
assert(estado.includes("isInitialRequestReceivedEvent")&&!estado.includes('x.id==="sys_created"?"is-system is-initial"'),"evento inicial aún depende del ID");
const semanticCases=[
  [{id:"sys_created",autor:"sistema"},true],
  [{id:"persisted",autor:"sistema",kind:"request_received"},true],
  [{id:"different",autor:"sistema",texto:"Su caso fue recibido correctamente."},true],
  [{id:"legacy",autor:"sistema",titulo:"Solicitud recibida"},true],
  [{id:"other",autor:"sistema",texto:"La solicitud requiere una actualización."},false],
  [{id:"support",autor:"soporte",kind:"request_received"},false]
];
assert(semanticCases.every(([event,expected])=>isInitialRequestReceivedEvent(event)===expected),"clasificación semántica del evento inicial falló");
assert(estado.includes("initialRichness")&&estadoCss.includes(".is-system.is-initial"),"dedupe/pill inicial incompleto");
assert(estado.includes("Imagen no disponible")&&estado.includes("data-thumb-retry")&&estado.includes("retries>=1")&&!estadoHtml.includes("onerror="),"fallback de miniaturas incompleto");
assert(estado.includes("if(rec.loadingPromise)return rec.loadingPromise")&&estado.includes("rec.objectUrl=URL.createObjectURL(blob)")&&estado.includes("queueMicrotask(loadVisibleThumbs)"),"owner/dedupe de requests de miniaturas incompleto");
assert(estado.includes("thumbId:rec.id")&&estado.includes("img.src=rec.objectUrl")&&estado.includes("loadThumb(rec).then"),"visor no reutiliza el owner/request de miniaturas");
const accept=estadoHtml.match(/id="stReplyFilesPop"[^>]*accept="([^"]*)"/)?.[1]||"";
assert(accept&&!/video|mp4|webm|mov/i.test(accept),"video sigue activo en accept");
assert(!/1 video|video de hasta|video listo/i.test(estadoHtml)&&estadoHtml.includes("Video: próximamente"),"copy de video no es honesta");
assert(estado.includes("if(stIsVid(f)){rejected++")&&!estado.includes("stVideoDuration"),"video aún puede llegar a estado listo");

if(fail.length){console.error(`FINAL_FIX_GATES: FAIL (${fail.length})`);fail.forEach(x=>console.error(`- ${x}`));process.exit(1)}
console.log(`FINAL_FIX_GATES: PASS`);
console.log(`RELEASE_ASSET_VERSION: ${RELEASE}`);
console.log(`GLOBAL_SEARCH_PAGES_WITH_PROVIDER: 7`);
console.log(`SW_HTML_STRATEGY: NETWORK_FIRST`);
console.log(`SW_VERSIONED_ASSET_STRATEGY: CACHE_FIRST`);
console.log(`STATUS_VIDEO_ACCEPT_ACTIVE: NO`);
