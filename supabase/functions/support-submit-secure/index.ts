import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TURNSTILE_SECRET=Deno.env.get("TURNSTILE_SECRET")||"";
const PUBLIC_APP_URL=(Deno.env.get("PUBLIC_APP_URL")||"").replace(/\/+$/,"");
const RESEND_API_KEY=Deno.env.get("RESEND_API_KEY")||"";
const MAIL_FROM=Deno.env.get("MAIL_FROM")||"Expiriti <soporte@expiriti.com.mx>";
const sb=createClient(SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY);
// SECURITY U3: control de abuso del endpoint público
const IS_PROD=(Deno.env.get("ENVIRONMENT")||"").toLowerCase()==="production";
const REQUIRE_TURNSTILE_EFFECTIVE=((Deno.env.get("REQUIRE_TURNSTILE")||(IS_PROD?"true":"false")).toLowerCase()==="true");
const MAX_BODY_BYTES=Number(Deno.env.get("MAX_BODY_BYTES")||(64*1024*1024));
const DEFAULT_ORIGINS=[PUBLIC_APP_URL,"https://universalunidad-ux.github.io"].filter(Boolean);
const ALLOWED_ORIGINS=new Set((Deno.env.get("CORS_ALLOWED_ORIGINS")||DEFAULT_ORIGINS.join(",")).split(",").map(o=>o.trim().replace(/\/+$/,"")).filter(Boolean));
const corsBase={"Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type, idempotency-key","Access-Control-Allow-Methods":"POST, OPTIONS","Vary":"Origin"};
const corsFor=(origin:string)=>({...corsBase,...(origin?{"Access-Control-Allow-Origin":origin}:{})});
const resolveOrigin=(req:Request)=>{const o=(req.headers.get("origin")||"").replace(/\/+$/,"");return o&&ALLOWED_ORIGINS.has(o)?o:"";};
const json=(body:Record<string,unknown>,status=200,origin="")=>new Response(JSON.stringify(body),{status,headers:{...corsFor(origin),"Content-Type":"application/json"}});
// IP real detrás del proxy de la plataforma (Supabase/Cloudflare fijan estas
// cabeceras). Se toma el primer hop de x-forwarded-for. CORS es un control de
// navegador, NO el antiabuso principal (por eso rate-limit + turnstile server-side).
const getIp=(req:Request)=>{const xff=(req.headers.get("x-forwarded-for")||"").split(",")[0].trim();return req.headers.get("cf-connecting-ip")||xff||req.headers.get("x-real-ip")||"unknown";};
const sha256hex=async(v:string)=>{const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));return Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,"0")).join("");};
const ipHashOf=async(ip:string)=>ip&&ip!=="unknown"?(await sha256hex(ip)).slice(0,16):"unknown";
// Contrato de límites coherente (aplica aunque falte Content-Length).
const MAX_FILES=10, MAX_FILE_BYTES=20*1024*1024, MAX_TOTAL_BYTES=60*1024*1024;
const sanitize=(v:unknown,max=3000)=>String(v??"").trim().replace(/\s+/g," ").slice(0,max);
const digits=(v:unknown)=>String(v??"").replace(/\D+/g,"");
const clean=(v:unknown)=>String(v??"").trim();
const validMail=(v:unknown)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v||"").trim());
const norm=(v:unknown)=>String(v||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim();
const domainOf=(mail:string)=>{const m=String(mail||"").trim().toLowerCase(),i=m.indexOf("@");return i>-1?m.slice(i+1):""};
const randToken=()=>crypto.randomUUID().replace(/-/g,"")+crypto.randomUUID().replace(/-/g,"");
const getNextFolio=async(prefix="EX")=>{const {data,error}=await sb.rpc("next_ticket_folio",{p_prefix:prefix});if(error)throw new Error(`FOLIO_RPC_ERROR: ${error.message}`);const folio=String(data||"").trim();if(!folio)throw new Error("FOLIO_EMPTY");return folio};
const slaPack=(prioridad:string)=>{const p=String(prioridad||"media").toLowerCase(),now=Date.now();if(p==="urgente")return{sla_policy:"urgent_2h_8h",sla_first_response_deadline:new Date(now+2*60*60*1000).toISOString(),sla_resolution_deadline:new Date(now+8*60*60*1000).toISOString()};if(p==="alta")return{sla_policy:"high_4h_24h",sla_first_response_deadline:new Date(now+4*60*60*1000).toISOString(),sla_resolution_deadline:new Date(now+24*60*60*1000).toISOString()};if(p==="media")return{sla_policy:"medium_8h_48h",sla_first_response_deadline:new Date(now+8*60*60*1000).toISOString(),sla_resolution_deadline:new Date(now+48*60*60*1000).toISOString()};return{sla_policy:"low_24h_72h",sla_first_response_deadline:new Date(now+24*60*60*1000).toISOString(),sla_resolution_deadline:new Date(now+72*60*60*1000).toISOString()}};
const allowedExt=new Set(["jpg","jpeg","png","webp","pdf","xml","xls","xlsx","csv","txt","zip"]);
const allowedMime=new Set(["image/jpeg","image/png","image/webp","application/pdf","text/xml","application/xml","application/vnd.ms-excel","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","text/csv","text/plain","application/zip","application/x-zip-compressed"]);

async function verifyTurnstile(token:string,ip:string){const form=new FormData();form.append("secret",TURNSTILE_SECRET);form.append("response",token);if(ip&&ip!=="unknown")form.append("remoteip",ip);const res=await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify",{method:"POST",body:form});return await res.json()}
async function rateLimit(scope:string,key:string,limit:number,windowMinutes:number){const since=new Date(Date.now()-windowMinutes*60_000).toISOString();const {count,error}=await sb.from("rate_limit_events").select("*",{count:"exact",head:true}).eq("scope",scope).eq("key",key).gte("created_at",since);if(error)throw error;if((count||0)>=limit)return false;const ins=await sb.from("rate_limit_events").insert({scope,key});if(ins.error)throw ins.error;return true}
const LOG_BLOCK=new Set(["correo","email","telefono","phone","token","token_publico","idempotency_key","idemkey","payload","stack","message","nombre","descripcion"]);
async function logSecurity(accion:string,cliente_id:string|null,detalle:Record<string,unknown>){try{const safe:Record<string,unknown>={};for(const [k,v] of Object.entries(detalle||{})){const kl=k.toLowerCase();if(LOG_BLOCK.has(kl))continue;if(kl==="ip"){safe.ip_hash=await ipHashOf(String(v||""));continue;}safe[k]=v;}const {error}=await sb.from("bitacora").insert({accion,cliente_id,detalle:safe,visibilidad:"interna",tipo:"nota_interna"});if(error)console.error("LOG_SECURITY_DB_ERROR")}catch(_e){console.error("LOG_SECURITY_ERROR")}}
async function sendMail({to,subject,html}:{to:string;subject:string;html:string}){if(!RESEND_API_KEY||!to)return;const r=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${RESEND_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({from:MAIL_FROM,to:[to],subject,html})});if(!r.ok)throw new Error(`MAIL_ERROR_${r.status}`)}
async function addTicketEvento(ticket_id:string,autor_tipo:"cliente"|"soporte"|"sistema",visibilidad:"publica"|"interna",kind:"mensaje"|"estado"|"nota"|"archivo"|"sistema"|"asignacion"|"sla",texto:string,meta:Record<string,unknown>={}){const {error}=await sb.from("ticket_eventos").insert({ticket_id,autor_tipo,visibilidad,kind,texto,meta});if(error)throw new Error(`TICKET_EVENTO_ERROR: ${error.message}`)}
async function addArchivoTicket({ticket_id,solicitud_id,origen,visibilidad,nombre_archivo,storage_path,url_firma,mime_type,tamano_bytes,subido_por=null,meta={}}:{ticket_id:string;solicitud_id?:string|null;origen:"solicitud"|"ticket"|"portal"|"interno";visibilidad:"publica"|"interna";nombre_archivo:string;storage_path:string;url_firma?:string|null;mime_type?:string|null;tamano_bytes?:number|null;subido_por?:string|null;meta?:Record<string,unknown>}){const {error}=await sb.from("archivos_ticket").insert({ticket_id,solicitud_id:solicitud_id||null,origen,visibilidad,nombre_archivo,storage_path,url_firma:url_firma||null,mime_type:mime_type||null,tamano_bytes:tamano_bytes||null,subido_por,meta});if(error)throw new Error(`ARCHIVO_TICKET_ERROR: ${error.message}`)}

type MatchResult={level:string;score:number;cliente_id:string|null;contacto_id:string|null;cliente_nombre:string|null;contacto_nombre:string|null;reasons:string[]};

async function matchCliente(empresa:string,correo:string,telefono:string):Promise<MatchResult>{
  const empresaNorm=norm(empresa),mail=String(correo||"").trim().toLowerCase(),phone=digits(telefono||""),mailDomain=domainOf(mail);
  const [clientesRes,aliasesRes]=await Promise.all([sb.from("clientes").select("id,nombre,correo,telefono").limit(250),sb.from("cliente_aliases").select("cliente_id,alias,alias_norm,activo").eq("activo",true).limit(800)]);
  if(clientesRes.error)throw new Error(clientesRes.error.message);
  if(aliasesRes.error)throw new Error(aliasesRes.error.message);
  const clientes=clientesRes.data||[],aliases=aliasesRes.data||[],aliasMap=new Map<string,string[]>();
for(const a of aliases){const arr=aliasMap.get(a.cliente_id)||[];arr.push(norm((a as any).alias_norm||a.alias));aliasMap.set(a.cliente_id,arr)}
  let best:{cliente_id:string;cliente_nombre:string;score:number;reasons:string[]}|null=null;
  for(const c of clientes){
    let score=0;const reasons:string[]=[];const nombreNorm=norm(c.nombre),correoCliente=String(c.correo||"").toLowerCase(),telCliente=digits(String(c.telefono||"")),al=aliasMap.get(c.id)||[];
    if(empresaNorm&&nombreNorm&&empresaNorm===nombreNorm){score+=70;reasons.push("empresa_exacta")}else if(empresaNorm&&nombreNorm&&(empresaNorm.includes(nombreNorm)||nombreNorm.includes(empresaNorm))){score+=35;reasons.push("empresa_parcial")}
    if(empresaNorm&&al.includes(empresaNorm)){score+=55;reasons.push("alias_exacto")}else if(empresaNorm&&al.some(x=>x.includes(empresaNorm)||empresaNorm.includes(x))){score+=25;reasons.push("alias_parcial")}
    if(mail&&correoCliente&&mail===correoCliente){score+=80;reasons.push("correo_cliente_exacto")}
    if(phone&&telCliente&&phone===telCliente){score+=65;reasons.push("telefono_cliente_exacto")}
    if(mail&&mailDomain&&correoCliente&&domainOf(correoCliente)===mailDomain){score+=20;reasons.push("dominio_correo_cliente")}
    if(score>0&&(!best||score>best.score))best={cliente_id:c.id,cliente_nombre:c.nombre,score,reasons};
  }
  if(!best)return{level:"ninguno",score:0,cliente_id:null,contacto_id:null,cliente_nombre:null,contacto_nombre:null,reasons:[]};
  let contacto_id:string|null=null,contacto_nombre:string|null=null;
  const contactosRes=await sb.from("clientes_contactos").select("id,nombre,correo,telefono,activo").eq("cliente_id",best.cliente_id).eq("activo",true).limit(40);
  if(!contactosRes.error){
    let top:any=null,topScore=0;
    for(const ct of contactosRes.data||[]){
      let cs=0;const cMail=String(ct.correo||"").toLowerCase(),cTel=digits(String(ct.telefono||""));
      if(mail&&cMail&&mail===cMail)cs+=100;
      if(phone&&cTel&&phone===cTel)cs+=90;
      if(mail&&mailDomain&&cMail&&domainOf(cMail)===mailDomain)cs+=15;
      if(cs>topScore){topScore=cs;top=ct}
    }
    if(top&&topScore>0){contacto_id=top.id;contacto_nombre=top.nombre||null;best.score+=Math.min(topScore,40);best.reasons.push("contacto_sugerido")}
  }
  const level=best.score>=90?"alto":best.score>=55?"medio":"bajo";
  return{level,score:best.score,cliente_id:best.cliente_id,contacto_id,cliente_nombre:best.cliente_nombre,contacto_nombre,reasons:best.reasons};
}

Deno.serve(async(req)=>{
  const reqOrigin=resolveOrigin(req);
  // Shadow por-request: aplica CORS por allowlist (fail-closed) a todas las respuestas.
  const json=(body:Record<string,unknown>,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsFor(reqOrigin),"Content-Type":"application/json"}});
  const originHeader=(req.headers.get("origin")||"").replace(/\/+$/,"");
  if(req.method==="OPTIONS"){
    if(originHeader&&!reqOrigin)return json({message:"Origin no permitido."},403);
    return json({ok:true},200);
  }
  if(req.method!=="POST")return json({message:"Method not allowed"},405);
  const ip=getIp(req);
  // Origin allowlist fail-closed (no se refleja un Origin arbitrario)
  if(originHeader&&!reqOrigin){await logSecurity("cors_origin_blocked",null,{ip});return json({message:"Origin no permitido."},403)}
  // Content-Type estricto
  const ctype=(req.headers.get("content-type")||"").toLowerCase();
  if(!ctype.includes("multipart/form-data"))return json({message:"Content-Type no soportado."},415);
  // Límite duro de cuerpo (defensa temprana por Content-Length)
  const clen=Number(req.headers.get("content-length")||"0");
  if(clen>MAX_BODY_BYTES)return json({message:"Solicitud demasiado grande."},413);
  const idemKey=String(req.headers.get("idempotency-key")||"").slice(0,120);
  try{
    const form=await req.formData();
    // Honeypot anti-bot: campos ocultos que un humano deja vacíos.
    const honeypot=String(form.get("website")||form.get("hp_field")||"").trim();
    if(honeypot){await logSecurity("honeypot_triggered",null,{ip});return json({ok:true,status:"received"},200)}
    const turnstileToken=String(form.get("turnstile_token")||"");
    const rawPayload=String(form.get("payload")||"{}");
    if(rawPayload.length>200000)return json({message:"Payload demasiado grande."},413);
    let payload:any={};
    try{payload=JSON.parse(rawPayload)}catch{return json({message:"Payload inválido."},400)}

    if(REQUIRE_TURNSTILE_EFFECTIVE){
      if(!TURNSTILE_SECRET){await logSecurity("turnstile_unconfigured",null,{ip});return json({message:"Validación de seguridad no disponible."},503)}
      if(!turnstileToken){await logSecurity("turnstile_missing",null,{ip});return json({message:"Falta validación de seguridad."},400)}
      const ts=await verifyTurnstile(turnstileToken,ip);
      if(!ts?.success){await logSecurity("turnstile_failed",null,{ip,errors:ts?.["error-codes"]||[]});return json({message:"No se pudo validar la solicitud."},400)}
    }

    const rlOk=await rateLimit("support_submit",ip,5,10);
if(!rlOk){await logSecurity("rate_limit_blocked",null,{ip,scope:"support_submit"});return json({message:"Ha enviado varias solicitudes en poco tiempo. Intente más tarde."},429)}
    // Límite global de respaldo: no depende de un header por-cliente spoofable.
    const rlGlobal=await rateLimit("support_submit_global","ALL",300,10);
    if(!rlGlobal){await logSecurity("rate_limit_blocked",null,{scope:"support_submit_global"});return json({message:"Servicio con alta demanda. Intente más tarde."},429)}
const nombre=sanitize(payload?.nombre,120),empresa=sanitize(payload?.empresa,160)||null,correo=sanitize(payload?.correo,160),telefono=digits(payload?.telefono),categoria=sanitize(payload?.categoria,40),sistema=sanitize(payload?.sistema,120),objetivo=sanitize(payload?.objetivo,300),titulo=sanitize(payload?.titulo,120),descripcion=sanitize(payload?.descripcion,3000),impacto=sanitize(payload?.impacto,20),prioridad=sanitize(payload?.prioridad,20)||((impacto==="alta")?"alta":(impacto==="media")?"media":"baja"),canal=sanitize(payload?.canal,20),desde_cuando=sanitize(payload?.desde_cuando,160),afecta_a=sanitize(payload?.afecta_a,40),ultimo_cambio=sanitize(payload?.cambio_previo||payload?.ultimo_cambio,60),horario_contacto=sanitize(payload?.horario_disponible||payload?.horario_contacto,160),horario_desde=sanitize(payload?.horario_desde,20),horario_hasta=sanitize(payload?.horario_hasta,20),horario_notas=sanitize(payload?.horario_notas||payload?.horario_disponible||payload?.horario_contacto,200),contexto_adicional=sanitize(payload?.contexto_extra||payload?.contexto_adicional,3000),anydesk=sanitize(payload?.anydesk,120),origen="soporte_publico";


    if(!nombre||!titulo||!descripcion||!sistema)return json({message:"Faltan campos obligatorios."},400);
 if(!correo)return json({message:"Falta el correo."},400);
if(!validMail(correo))return json({message:"El correo no parece válido."},400);
    const rlMail=await rateLimit("support_submit_mail",correo.toLowerCase(),5,60);
    if(!rlMail){await logSecurity("rate_limit_blocked",null,{ip,scope:"support_submit_mail"});return json({message:"Ha enviado varias solicitudes con este correo. Intente más tarde."},429)}
if(!telefono)return json({message:"Falta el teléfono."},400);
if(telefono.length<10)return json({message:"El teléfono parece incompleto."},400);


    const files=[...form.entries()].filter(([k])=>k.startsWith("file_")).map(([,v])=>v).filter(v=>v instanceof File) as File[];
    if(files.length>MAX_FILES)return json({message:"Máximo de archivos excedido."},400);

    let totalBytes=0;
    for(const file of files){
const safe=file.name.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g,"_").replace(/[^a-zA-Z0-9._()-]/g,"").slice(0,140)||"archivo",ext=(safe.split(".").pop()||"").toLowerCase(),mime=(file.type||"").toLowerCase(),size=Number(file.size||0);
      totalBytes+=size;
      if(!allowedExt.has(ext))return json({message:`Tipo no permitido: ${safe}`},400);
      if(mime&&!allowedMime.has(mime))return json({message:`MIME no permitido: ${safe}`},400);
  if(size<=0)return json({message:`Archivo vacío: ${safe||file.name}`},400);
if(size>MAX_FILE_BYTES)return json({message:`Archivo demasiado grande: ${safe}`},400);
      if(totalBytes>MAX_TOTAL_BYTES)return json({message:"El total de archivos excede el máximo permitido."},400);
    }

    const empresa_confirmada=!!payload?.empresa_confirmada,contacto_confirmado=!!payload?.contacto_confirmado,contacto_es_nuevo=!!payload?.contacto_es_nuevo,cliente_id_confirmado=clean(payload?.cliente_id_confirmado),contacto_id_confirmado=clean(payload?.contacto_id_confirmado);
    // Idempotencia ATÓMICA (reemplaza SELECT->INSERT). Ver support_idem_claim.
    let idemActive=false;
    if(idemKey){
      const fp=(await sha256hex(`${correo}|${titulo}|${descripcion}`)).slice(0,32);
      const claim=await sb.rpc("support_idem_claim",{p_key:idemKey,p_fingerprint:fp});
      if(claim.error){console.error("IDEM_CLAIM_ERROR")}
      else{const c=Array.isArray(claim.data)?claim.data[0]:claim.data;
        if(c&&c.claimed===false){
          if(c.status==="succeeded"&&c.response){await logSecurity("idempotent_replay_served",null,{ip});return json(c.response as Record<string,unknown>,200)}
          await logSecurity("idempotent_inflight",null,{ip});return json({message:"Solicitud en curso."},409);
        } else { idemActive=true; }
      }
    }
    const match=await matchCliente(empresa||"",correo,telefono);




let cliente_id:string|null=null,contacto_id:string|null=null,requiere_consolidacion=false;const empresaOk=match.reasons.includes("empresa_exacta")||match.reasons.includes("alias_exacto")||match.reasons.includes("razon_social_exacta")||match.reasons.includes("rfc_exacto");if(cliente_id_confirmado&&empresa_confirmada){cliente_id=cliente_id_confirmado;requiere_consolidacion=contacto_es_nuevo||!contacto_confirmado;if(contacto_id_confirmado&&contacto_confirmado&&!contacto_es_nuevo)contacto_id=contacto_id_confirmado}else if(match.level==="alto"&&empresaOk){cliente_id=match.cliente_id;if(match.contacto_id&&!contacto_es_nuevo)contacto_id=match.contacto_id;requiere_consolidacion=!contacto_id}else{cliente_id=null;contacto_id=null;requiere_consolidacion=true}const matchNivelEfectivo=requiere_consolidacion&&match.level==="alto"&&!empresaOk?"medio":match.level;



    const folio=await getNextFolio("EX"),token_publico=randToken(),token_publico_expira=new Date(Date.now()+1000*60*60*24*30).toISOString(),sla=slaPack(prioridad||"media");

    const {data:solicitud,error:errSolicitud}=await sb.from("solicitudes_soporte").insert({folio,nombre,empresa:empresa||null,correo:correo||null,telefono:telefono||null,categoria:categoria||null,sistema:sistema||null,objetivo:objetivo||null,titulo,descripcion,impacto:impacto||null,prioridad:prioridad||"media",canal:canal||null,desde_cuando:desde_cuando||null,afecta_a:afecta_a||null,ultimo_cambio:ultimo_cambio||null,horario_contacto:horario_contacto||null,horario_desde:horario_desde||null,horario_hasta:horario_hasta||null,horario_notas:horario_notas||null,contexto_adicional:`${contexto_adicional}${anydesk?`\n\nAnyDesk: ${anydesk}`:""}`||null,archivos_count:files.length,total_peso:totalBytes,cliente_id,contacto_id,origen,estatus:"nuevo",actualizado_en:new Date().toISOString(),empresa_capturada:empresa||null,nombre_capturado:nombre,correo_capturado:correo||null,telefono_capturado:telefono||null,cliente_id_sugerido:match.cliente_id,contacto_id_sugerido:match.contacto_id,match_nivel:matchNivelEfectivo,match_score:match.score,match_confirmado:empresa_confirmada,contacto_confirmado,contacto_es_nuevo,requiere_consolidacion}).select("id").single();
    if(errSolicitud)throw new Error(`Error creando solicitud: ${errSolicitud.message}`);

    const tipoTicket=["soporte","renovacion","facturacion","configuracion"].includes(categoria)?categoria:"soporte";
const timeline_inicial=[{kind:"mensaje",autor:"soporte",titulo:"Solicitud recibida",texto:"Su caso fue recibido correctamente y ya entró a nuestra mesa de soporte.",fecha:new Date().toISOString()}];
    const {data:ticket,error:errTicket}=await sb.from("tickets").insert({cliente_id,titulo,descripcion,prioridad:prioridad||"media",estado:"abierto",tipo:tipoTicket,origen:"soporte_publico",impacto:impacto||null,afecta_a:afecta_a||null,desde_cuando:desde_cuando||null,ultimo_cambio:ultimo_cambio||null,horario_contacto:horario_contacto||null,horario_desde:horario_desde||null,horario_hasta:horario_hasta||null,horario_notas:horario_notas||null,contexto_adicional:`${contexto_adicional}${anydesk?`\n\nAnyDesk: ${anydesk}`:""}`||null,canal:canal||null,solicitud_soporte_id:solicitud.id,correo_cliente:correo||null,nombre_cliente_contacto:nombre||null,contacto_id,folio,token_publico,token_publico_expira,timeline_publica:timeline_inicial,adjuntos:[],evidencia_count:0,empresa_capturada:empresa||null,nombre_capturado:nombre,correo_capturado:correo||null,telefono_capturado:telefono||null,cliente_id_sugerido:match.cliente_id,contacto_id_sugerido:match.contacto_id,match_nivel:matchNivelEfectivo,match_score:match.score,match_confirmado:empresa_confirmada,contacto_confirmado,contacto_es_nuevo,requiere_consolidacion,sla_policy:sla.sla_policy,sla_first_response_deadline:sla.sla_first_response_deadline,sla_resolution_deadline:sla.sla_resolution_deadline,sla_breached_first_response:false,sla_breached_resolution:false}).select("id,folio,token_publico").single();
    if(errTicket)throw new Error(`Error creando ticket: ${errTicket.message}`);

await addTicketEvento(ticket.id,"sistema","publica","sistema","Su caso fue recibido correctamente y ya entró a nuestra mesa de soporte.",{origen:"soporte_publico",folio});
if(requiere_consolidacion)await addTicketEvento(ticket.id,"sistema","interna","sistema","Pendiente de consolidar empresa o contacto capturado.",{requiere_consolidacion:true,empresa_capturada:empresa||null,nombre_capturado:nombre,cliente_id_sugerido:match.cliente_id,contacto_id_sugerido:match.contacto_id});
    await logSecurity("ticket_creado",cliente_id,{ticket_id:ticket.id,solicitud_id:solicitud.id,folio,origen:"soporte_publico"});
    if(match.level==="alto"&&empresa_confirmada)await logSecurity("cliente_confirmado",cliente_id,{ticket_id:ticket.id,folio,cliente_id,contacto_id});
    if(requiere_consolidacion)await logSecurity("contacto_consolidado",cliente_id,{ticket_id:ticket.id,folio,pendiente:true});

    const adjuntos:Array<Record<string,unknown>>=[];
    for(const file of files){
const safe=file.name.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g,"_").replace(/[^a-zA-Z0-9._()-]/g,"").slice(0,140)||"archivo",mime=(file.type||"").toLowerCase(),path=`${ticket.id}/${Date.now()}_${crypto.randomUUID()}_${safe}`,bytes=new Uint8Array(await file.arrayBuffer());
      const up=await sb.storage.from("soporte_adjuntos").upload(path,bytes,{contentType:mime||"application/octet-stream",upsert:false});
      if(up.error)throw new Error(`Error subiendo ${safe}: ${up.error.message}`);
      const arch=await sb.from("solicitud_archivos").insert({solicitud_id:solicitud.id,nombre_archivo:file.name,storage_path:path,mime_type:file.type||null,tamano_bytes:file.size,tipo_detectado:"soporte_publico"});
      if(arch.error)throw new Error(`Error guardando metadata de solicitud para ${safe}: ${arch.error.message}`);
const archTicket=await sb.from("ticket_archivos").insert({ticket_id:ticket.id,nombre_archivo:file.name,url_archivo:path,mime_type:file.type||null,tamano_bytes:file.size});
if(archTicket.error)console.error("LEGACY_TICKET_ARCHIVOS_ERROR",archTicket.error.message);

await addArchivoTicket({ticket_id:ticket.id,solicitud_id:solicitud.id,origen:"solicitud",visibilidad:"publica",nombre_archivo:file.name,storage_path:path,url_firma:null,mime_type:file.type||null,tamano_bytes:file.size,meta:{canal:"soporte_publico"}});
adjuntos.push({nombre:file.name,tipo:file.type||null,peso:file.size,storage_path:path,url:null,origen:"soporte_publico"});
}

if(adjuntos.length)await addTicketEvento(ticket.id,"sistema","publica","archivo",`Se recibieron ${adjuntos.length} archivo(s) junto con la solicitud.`,{archivos_count:adjuntos.length,adjuntos});

    const timeline_publica=[...timeline_inicial,...(adjuntos.length?[{kind:"mensaje",autor:"soporte",titulo:"Evidencia adjunta",texto:`Se recibieron ${adjuntos.length} archivo(s) junto con la solicitud.`,fecha:new Date().toISOString(),adjuntos}]:[])];
    const upTicket=await sb.from("tickets").update({fecha_actualizacion:new Date().toISOString(),timeline_publica,adjuntos,evidencia_count:adjuntos.length}).eq("id",ticket.id);
    if(upTicket.error)throw new Error(`Error actualizando ticket con evidencia: ${upTicket.error.message}`);

    const upSolicitud=await sb.from("solicitudes_soporte").update({ticket_id:ticket.id,actualizado_en:new Date().toISOString(),estatus:"ticket_creado"}).eq("id",solicitud.id);
    if(upSolicitud.error)throw new Error(`Error vinculando solicitud y ticket: ${upSolicitud.error.message}`);

try{const {error}=await sb.from("bitacora").insert({accion:"ticket_creado_desde_soporte_publico",cliente_id,detalle:{ticket_id:ticket?.id||null,solicitud_soporte_id:solicitud.id,folio,sistema,categoria,impacto,afecta_a,desde_cuando,match_nivel:matchNivelEfectivo,match_score:match.score,cliente_id_sugerido:match.cliente_id,contacto_id_sugerido:match.contacto_id,match_confirmado:empresa_confirmada,contacto_confirmado,contacto_es_nuevo,requiere_consolidacion},visibilidad:"interna",tipo:"nota_interna"});if(error)console.error("BITACORA_TICKET_CREATED_DB_ERROR",error.message)}catch(e){console.error("BITACORA_TICKET_CREATED_ERROR",e)}

const appUrl=PUBLIC_APP_URL||"https://universalunidad-ux.github.io";
const magic_link=`${appUrl}/estado.html?folio=${encodeURIComponent(folio)}&token=${encodeURIComponent(token_publico)}`;
    if(correo&&magic_link)await sendMail({to:correo,subject:`Recibimos su solicitud ${folio}`,html:`<div style="font-family:Arial,sans-serif;line-height:1.55;color:#111"><h2 style="margin:0 0 12px">Recibimos su caso de soporte</h2><p style="margin:0 0 10px"><b>Folio:</b> ${folio}</p><p style="margin:0 0 10px"><b>Título:</b> ${titulo}</p><p style="margin:0 0 10px"><b>Sistema:</b> ${sistema}</p><p style="margin:0 0 10px">Su caso fue enviado y entró a nuestra mesa de soporte.</p><p style="margin:0 0 14px"><a href="${magic_link}" style="display:inline-block;padding:10px 14px;border-radius:10px;text-decoration:none;background:#111;color:#fff">Abrir seguimiento</a></p><p style="margin:0 0 10px">Disponible hasta: <b>${new Date(token_publico_expira).toLocaleString("es-MX")}</b></p><p style="margin:0">${requiere_consolidacion?"Estamos validando la asociación de empresa o contacto para registrar su caso correctamente.":"Si necesitamos XML, capturas o más información, podrás responder desde ese mismo enlace."}</p></div>`}).catch(()=>null);

    // SECURITY U1: respuesta pública mínima. NO exponer datos internos de CRM
    // (nombres/IDs de cliente, match_score, candidatos, solicitud_id, ticket_id).
    // soporte.js solo consume folio + token_publico; el enlace lo construye el cliente.
    const resp={ok:true,folio,token_publico,status:"ticket_creado"};
    if(idemActive)try{await sb.rpc("support_idem_finish",{p_key:idemKey,p_status:"succeeded",p_response:resp})}catch(_e){console.error("IDEM_FINISH_ERROR")}
    return json(resp,200);
}catch(err:any){const reqId=crypto.randomUUID();console.error("SUPPORT_FATAL",reqId);if(idemKey)try{await sb.rpc("support_idem_finish",{p_key:idemKey,p_status:"failed",p_response:null})}catch(_e){/* noop */}try{await logSecurity("support_submit_error",null,{ip,request_id:reqId})}catch(_e){console.error("SUPPORT_LOG_ERROR")}return json({message:"No se pudo procesar la solicitud.",request_id:reqId},500)}
});
