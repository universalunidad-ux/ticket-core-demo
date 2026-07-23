import { createClient } from "npm:@supabase/supabase-js@2";
import { parsePublicSupportDto, type PublicSupportDto } from "../_shared/support-contract.ts";
import { validateAttachmentBatch, type AttachmentInput, type ValidatedAttachment } from "../_shared/upload-contract.ts";
import { escapeHtml, sanitizeEmailSubject } from "../_shared/security-primitives.ts";
import {
  SUPPORT_TURNSTILE_ACTION,
  TURNSTILE_FETCH_TIMEOUT_MS,
  TURNSTILE_TOKEN_MAX_LENGTH,
  inspectSupportRequestHeaders,
  parseSupportMultipartBody,
  readBoundedRequestBody,
  validateTurnstileSiteverify,
  type ContractResult,
  type SupportRequestErrorCode,
} from "../_shared/support-request-contract.ts";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TURNSTILE_SECRET=Deno.env.get("TURNSTILE_SECRET")||"";
const PUBLIC_APP_URL=(Deno.env.get("PUBLIC_APP_URL")||"").replace(/\/+$/,"");
const RESEND_API_KEY=Deno.env.get("RESEND_API_KEY")||"";
const MAIL_FROM=Deno.env.get("MAIL_FROM")||"Expiriti <soporte@expiriti.com.mx>";
const sb=createClient(SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY);
// SECURITY U3: control de abuso del endpoint público
const ENVIRONMENT=(Deno.env.get("ENVIRONMENT")||"").toLowerCase();
// Dev debe ser EXPLÍCITO. La ausencia de ENVIRONMENT se asume PRODUCCIÓN (fail-closed),
// nunca abre el antiabuso por olvido de configuración.
const IS_DEV=["development","dev","local"].includes(ENVIRONMENT);
const IS_PROD=!IS_DEV;
const REQUIRE_TURNSTILE_EFFECTIVE=((Deno.env.get("REQUIRE_TURNSTILE")||(IS_PROD?"true":"false")).toLowerCase()==="true");
const MAX_BODY_BYTES=Number(Deno.env.get("MAX_BODY_BYTES")||(64*1024*1024));
const HANDLER_CONFIGURATION_VALID=Number.isSafeInteger(MAX_BODY_BYTES)&&MAX_BODY_BYTES>0;
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
const digits=(v:unknown)=>String(v??"").replace(/\D+/g,"");
const norm=(v:unknown)=>String(v||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim();
const domainOf=(mail:string)=>{const m=String(mail||"").trim().toLowerCase(),i=m.indexOf("@");return i>-1?m.slice(i+1):""};
const randToken=()=>crypto.randomUUID().replace(/-/g,"")+crypto.randomUUID().replace(/-/g,"");
const getNextFolio=async(prefix="EX")=>{const {data,error}=await sb.rpc("next_ticket_folio",{p_prefix:prefix});if(error)throw new Error(`FOLIO_RPC_ERROR: ${error.message}`);const folio=String(data||"").trim();if(!folio)throw new Error("FOLIO_EMPTY");return folio};
const slaPack=(prioridad:string)=>{const p=String(prioridad||"media").toLowerCase(),now=Date.now();if(p==="urgente")return{sla_policy:"urgent_2h_8h",sla_first_response_deadline:new Date(now+2*60*60*1000).toISOString(),sla_resolution_deadline:new Date(now+8*60*60*1000).toISOString()};if(p==="alta")return{sla_policy:"high_4h_24h",sla_first_response_deadline:new Date(now+4*60*60*1000).toISOString(),sla_resolution_deadline:new Date(now+24*60*60*1000).toISOString()};if(p==="media")return{sla_policy:"medium_8h_48h",sla_first_response_deadline:new Date(now+8*60*60*1000).toISOString(),sla_resolution_deadline:new Date(now+48*60*60*1000).toISOString()};return{sla_policy:"low_24h_72h",sla_first_response_deadline:new Date(now+24*60*60*1000).toISOString(),sla_resolution_deadline:new Date(now+72*60*60*1000).toISOString()}};
async function verifyTurnstile(
  token:string,
  ip:string,
  expected:{hostname:string;action:typeof SUPPORT_TURNSTILE_ACTION;nowMs:number},
):Promise<ContractResult<Readonly<{challengeTs:string;hostname:string;action:string}>>>{
  if(!token||token.length>TURNSTILE_TOKEN_MAX_LENGTH)return{ok:false,code:"TURNSTILE_TOKEN_INVALID"};
  const form=new FormData();
  form.append("secret",TURNSTILE_SECRET);
  form.append("response",token);
  if(ip&&ip!=="unknown")form.append("remoteip",ip);
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),TURNSTILE_FETCH_TIMEOUT_MS);
  try{
    const res=await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify",{method:"POST",body:form,signal:controller.signal});
    if(!res.ok)return{ok:false,code:"TURNSTILE_UNAVAILABLE"};
    let value:unknown;
    try{value=await res.json()}catch{return{ok:false,code:"TURNSTILE_UNAVAILABLE"}}
    return validateTurnstileSiteverify(value,expected);
  }catch{return{ok:false,code:"TURNSTILE_UNAVAILABLE"}}
  finally{clearTimeout(timeout)}
}
async function rateLimit(scope:string,key:string,limit:number,windowMinutes:number){const since=new Date(Date.now()-windowMinutes*60_000).toISOString();const {count,error}=await sb.from("rate_limit_events").select("*",{count:"exact",head:true}).eq("scope",scope).eq("key",key).gte("created_at",since);if(error)throw error;if((count||0)>=limit)return false;const ins=await sb.from("rate_limit_events").insert({scope,key});if(ins.error)throw ins.error;return true}
const LOG_BLOCK=new Set(["correo","email","telefono","phone","token","token_publico","idempotency_key","idemkey","payload","stack","message","nombre","descripcion"]);
async function logSecurity(accion:string,cliente_id:string|null,detalle:Record<string,unknown>){try{const safe:Record<string,unknown>={};for(const [k,v] of Object.entries(detalle||{})){const kl=k.toLowerCase();if(LOG_BLOCK.has(kl))continue;if(kl==="ip"){safe.ip_hash=await ipHashOf(String(v||""));continue;}safe[k]=v;}const {error}=await sb.from("bitacora").insert({accion,cliente_id,detalle:safe,visibilidad:"interna",tipo:"nota_interna"});if(error)console.error("LOG_SECURITY_DB_ERROR")}catch(_e){console.error("LOG_SECURITY_ERROR")}}
async function sendMail({to,subject,html}:{to:string;subject:string;html:string}){if(!RESEND_API_KEY||!to)return;const r=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${RESEND_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({from:MAIL_FROM,to:[to],subject,html})});if(!r.ok)throw new Error(`MAIL_ERROR_${r.status}`)}
async function addTicketEvento(ticket_id:string,autor_tipo:"cliente"|"soporte"|"sistema",visibilidad:"publica"|"interna",kind:"mensaje"|"estado"|"nota"|"archivo"|"sistema"|"asignacion"|"sla",texto:string,meta:Record<string,unknown>={}){const {error}=await sb.from("ticket_eventos").insert({ticket_id,autor_tipo,visibilidad,kind,texto,meta});if(error)throw new Error(`TICKET_EVENTO_ERROR: ${error.message}`)}
async function addArchivoTicket({ticket_id,solicitud_id,origen,visibilidad,nombre_archivo,storage_path,url_firma,mime_type,tamano_bytes,subido_por=null,meta={}}:{ticket_id:string;solicitud_id?:string|null;origen:"solicitud"|"ticket"|"portal"|"interno";visibilidad:"publica"|"interna";nombre_archivo:string;storage_path:string;url_firma?:string|null;mime_type?:string|null;tamano_bytes?:number|null;subido_por?:string|null;meta?:Record<string,unknown>}){const {error}=await sb.from("archivos_ticket").insert({ticket_id,solicitud_id:solicitud_id||null,origen,visibilidad,nombre_archivo,storage_path,url_firma:url_firma||null,mime_type:mime_type||null,tamano_bytes:tamano_bytes||null,subido_por,meta});if(error)throw new Error(`ARCHIVO_TICKET_ERROR: ${error.message}`)}

type MatchResult={level:string;score:number;cliente_id:string|null;contacto_id:string|null;cliente_nombre:string|null;contacto_nombre:string|null;reasons:string[]};
type ValidatedUpload=Readonly<{metadata:ValidatedAttachment;bytes:Uint8Array}>;
type PublicSuccessResponse=Readonly<{ok:true;folio:string;token_publico:string;status:"ticket_creado"}>;

const publicSuccessKeys=["folio","ok","status","token_publico"] as const;
const isPublicSuccessResponse=(value:unknown):value is PublicSuccessResponse=>{
  if(value===null||typeof value!=="object"||Array.isArray(value))return false;
  const response=value as Record<string,unknown>;
  return Object.keys(response).sort().join(",")===publicSuccessKeys.join(",")
    &&response.ok===true
    &&typeof response.folio==="string"&&response.folio.length>0
    &&typeof response.token_publico==="string"&&response.token_publico.length>0
    &&response.status==="ticket_creado";
};

const requestErrorStatus=(code:SupportRequestErrorCode):number=>{
  if(code==="BODY_TOO_LARGE"||code==="PAYLOAD_TOO_LARGE")return 413;
  if(code==="CONTENT_TYPE_REQUIRED"||code==="CONTENT_TYPE_UNSUPPORTED"||code==="CONTENT_ENCODING_UNSUPPORTED")return 415;
  if(code==="ORIGIN_REQUIRED"||code==="ORIGIN_NOT_ALLOWED")return 403;
  if(code==="TURNSTILE_UNAVAILABLE")return 503;
  return 400;
};
const requestErrorMessage=(code:SupportRequestErrorCode):string=>{
  if(code==="ORIGIN_REQUIRED")return"Origin requerido.";
  if(code==="ORIGIN_NOT_ALLOWED")return"Origin no permitido.";
  if(code==="CONTENT_TYPE_REQUIRED"||code==="CONTENT_TYPE_UNSUPPORTED")return"Content-Type no soportado.";
  if(code==="CONTENT_ENCODING_UNSUPPORTED")return"Content-Encoding no soportado.";
  if(code==="BODY_TOO_LARGE")return"Solicitud demasiado grande.";
  if(code==="PAYLOAD_TOO_LARGE")return"Payload demasiado grande.";
  if(code==="PAYLOAD_JSON_INVALID")return"Payload inválido.";
  if(code.startsWith("TURNSTILE_"))return code==="TURNSTILE_UNAVAILABLE"?"Validación de seguridad no disponible.":"No se pudo validar la solicitud.";
  return"Solicitud inválida.";
};

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

export const handler=async(req:Request):Promise<Response>=>{
  const reqOrigin=resolveOrigin(req);
  const json=(body:Record<string,unknown>,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsFor(reqOrigin),"Content-Type":"application/json"}});
  const originHeader=req.headers.get("origin")||"";
  if(!HANDLER_CONFIGURATION_VALID)return json({message:"Configuración no disponible.",code:"HANDLER_CONFIGURATION_INVALID"},503);
  if(req.method==="OPTIONS"){
    if(originHeader&&!reqOrigin)return json({message:"Origin no permitido.",code:"ORIGIN_NOT_ALLOWED"},403);
    return json({ok:true},200);
  }
  if(req.method!=="POST")return json({message:"Method not allowed",code:"METHOD_NOT_ALLOWED"},405);

  const headerResult=inspectSupportRequestHeaders(req.headers,ALLOWED_ORIGINS,MAX_BODY_BYTES);
  if(!headerResult.ok)return json({message:requestErrorMessage(headerResult.code),code:headerResult.code},requestErrorStatus(headerResult.code));
  const bodyResult=await readBoundedRequestBody(req.body,MAX_BODY_BYTES);
  if(!bodyResult.ok)return json({message:requestErrorMessage(bodyResult.code),code:bodyResult.code},requestErrorStatus(bodyResult.code));
  const multipartResult=await parseSupportMultipartBody(bodyResult.value,headerResult.value.contentType);
  if(!multipartResult.ok)return json({message:requestErrorMessage(multipartResult.code),code:multipartResult.code},requestErrorStatus(multipartResult.code));
  if(multipartResult.value.honeypot)return json({ok:true,status:"received"},200);

  const rawPayload=multipartResult.value.payload;
  if(rawPayload.length>200000)return json({message:requestErrorMessage("PAYLOAD_TOO_LARGE"),code:"PAYLOAD_TOO_LARGE"},413);
  let parsedPayload:unknown;
  try{parsedPayload=JSON.parse(rawPayload)}catch{return json({message:requestErrorMessage("PAYLOAD_JSON_INVALID"),code:"PAYLOAD_JSON_INVALID"},400)}
  const dtoResult=parsePublicSupportDto(parsedPayload);
  if(!dtoResult.ok)return json({message:"Los datos de soporte no son válidos.",code:"DTO_INVALID",issues:dtoResult.issues},400);
  const dto:PublicSupportDto=dtoResult.value;

  const attachmentInputs:AttachmentInput[]=[];
  for(const file of multipartResult.value.files){
    const bytes=new Uint8Array(await file.arrayBuffer());
    attachmentInputs.push(Object.freeze({name:file.name,mimeType:file.type,bytes}));
  }
  const attachmentResult=await validateAttachmentBatch(attachmentInputs);
  if(!attachmentResult.ok){
    const codes=new Set(attachmentResult.issues.map(issue=>issue.code));
    const status=codes.has("UPLOAD_FILE_TOO_LARGE")||codes.has("UPLOAD_TOTAL_TOO_LARGE")?413:
      [...codes].some(code=>code.includes("MIME")||code.includes("MAGIC")||code.includes("EXTENSION"))?415:400;
    return json({message:"Uno o más adjuntos no son válidos.",code:"UPLOAD_INVALID",issues:attachmentResult.issues},status);
  }
  const validatedUploads:readonly ValidatedUpload[]=Object.freeze(attachmentResult.value.map((metadata,index)=>Object.freeze({metadata,bytes:attachmentInputs[index].bytes})));

  const ip=getIp(req);
  if(REQUIRE_TURNSTILE_EFFECTIVE){
    if(!TURNSTILE_SECRET)return json({message:"Validación de seguridad no disponible.",code:"TURNSTILE_UNCONFIGURED"},503);
    const turnstileResult=await verifyTurnstile(multipartResult.value.turnstileToken,ip,{
      hostname:headerResult.value.hostname,
      action:SUPPORT_TURNSTILE_ACTION,
      nowMs:Date.now(),
    });
    if(!turnstileResult.ok)return json({message:requestErrorMessage(turnstileResult.code),code:turnstileResult.code},requestErrorStatus(turnstileResult.code));
  }

  const idemKey=String(req.headers.get("idempotency-key")||"").slice(0,120);
  const uploadedPaths:string[]=[];
  let validationBarrierReached=false;
  const nombre=dto.nombre,empresa=dto.empresa,correo=dto.correo,telefono=dto.telefono,categoria=dto.categoria,sistema=dto.sistema,objetivo=dto.objetivo,titulo=dto.titulo,descripcion=dto.descripcion,impacto=dto.impacto,prioridad=dto.impacto,canal=dto.canal,desde_cuando=dto.desde_cuando,afecta_a=dto.afecta_a,ultimo_cambio=dto.cambio_previo,horario_contacto=dto.horario_disponible,horario_desde=dto.horario_desde,horario_hasta=dto.horario_hasta,horario_notas=dto.horario_notas,contexto_adicional=dto.contexto_extra,anydesk=dto.remote_access,origen="soporte_publico";
  const totalBytes=validatedUploads.reduce((sum,upload)=>sum+upload.metadata.size,0);
  try{
    // VALIDATION_BARRIER_REACHED
    validationBarrierReached=true;
    const rlOk=await rateLimit("support_submit",ip,5,10);
    if(!rlOk){await logSecurity("rate_limit_blocked",null,{ip,scope:"support_submit"});return json({message:"Ha enviado varias solicitudes en poco tiempo. Intente más tarde.",code:"RATE_LIMIT_IP"},429)}
    const rlGlobal=await rateLimit("support_submit_global","ALL",300,10);
    if(!rlGlobal){await logSecurity("rate_limit_blocked",null,{scope:"support_submit_global"});return json({message:"Servicio con alta demanda. Intente más tarde.",code:"RATE_LIMIT_GLOBAL"},429)}
    const rlMail=await rateLimit("support_submit_mail",correo.toLowerCase(),5,60);
    if(!rlMail){await logSecurity("rate_limit_blocked",null,{ip,scope:"support_submit_mail"});return json({message:"Ha enviado varias solicitudes con este correo. Intente más tarde.",code:"RATE_LIMIT_EMAIL"},429)}

    let idemActive=false;
    if(idemKey){
      const fp=(await sha256hex(`${correo}|${titulo}|${descripcion}`)).slice(0,32);
      const claim=await sb.rpc("support_idem_claim",{p_key:idemKey,p_fingerprint:fp});
      if(claim.error){console.error("IDEM_CLAIM_ERROR")}
      else{const c=Array.isArray(claim.data)?claim.data[0]:claim.data;
        if(c&&c.claimed===false){
          if(c.status==="succeeded"&&isPublicSuccessResponse(c.response)){await logSecurity("idempotent_replay_served",null,{ip});return json(c.response,200)}
          await logSecurity("idempotent_inflight",null,{ip});return json({message:"Solicitud en curso.",code:"IDEMPOTENCY_IN_FLIGHT"},409);
        }else{idemActive=true}
      }
    }

    const match=await matchCliente(empresa||"",correo,telefono);
    const empresaOk=match.reasons.includes("empresa_exacta")||match.reasons.includes("alias_exacto")||match.reasons.includes("razon_social_exacta")||match.reasons.includes("rfc_exacto");
    const empresa_confirmada=match.level==="alto"&&empresaOk&&!!match.cliente_id;
    const cliente_id=empresa_confirmada?match.cliente_id:null;
    const contacto_confirmado=empresa_confirmada&&!!match.contacto_id;
    const contacto_es_nuevo=empresa_confirmada&&!match.contacto_id;
    const contacto_id=contacto_confirmado?match.contacto_id:null;
    const requiere_consolidacion=!empresa_confirmada||!contacto_confirmado;
    const matchNivelEfectivo=requiere_consolidacion&&match.level==="alto"&&!empresaOk?"medio":match.level;

    const folio=await getNextFolio("EX"),token_publico=randToken(),token_publico_expira=new Date(Date.now()+1000*60*60*24*30).toISOString(),sla=slaPack(prioridad);
    const contextoPersistido=`${contexto_adicional}${anydesk?`\n\nAnyDesk: ${anydesk}`:""}`||null;
    const {data:solicitud,error:errSolicitud}=await sb.from("solicitudes_soporte").insert({folio,nombre,empresa:empresa||null,correo,telefono,categoria,sistema,objetivo:objetivo||null,titulo,descripcion,impacto,prioridad,canal,desde_cuando:desde_cuando||null,afecta_a,ultimo_cambio:ultimo_cambio||null,horario_contacto:horario_contacto||null,horario_desde,horario_hasta,horario_notas,contexto_adicional:contextoPersistido,archivos_count:validatedUploads.length,total_peso:totalBytes,cliente_id,contacto_id,origen,estatus:"nuevo",actualizado_en:new Date().toISOString(),empresa_capturada:empresa||null,nombre_capturado:nombre,correo_capturado:correo,telefono_capturado:telefono,cliente_id_sugerido:match.cliente_id,contacto_id_sugerido:match.contacto_id,match_nivel:matchNivelEfectivo,match_score:match.score,match_confirmado:empresa_confirmada,contacto_confirmado,contacto_es_nuevo,requiere_consolidacion}).select("id").single();
    if(errSolicitud)throw new Error(`Error creando solicitud: ${errSolicitud.message}`);

    const tipoTicket=categoria;
    const timeline_inicial=[{kind:"mensaje",autor:"soporte",titulo:"Solicitud recibida",texto:"Su caso fue recibido correctamente y ya entró a nuestra mesa de soporte.",fecha:new Date().toISOString()}];
    const {data:ticket,error:errTicket}=await sb.from("tickets").insert({cliente_id,titulo,descripcion,prioridad,estado:"abierto",tipo:tipoTicket,origen:"soporte_publico",impacto,afecta_a,desde_cuando:desde_cuando||null,ultimo_cambio:ultimo_cambio||null,horario_contacto:horario_contacto||null,horario_desde,horario_hasta,horario_notas,contexto_adicional:contextoPersistido,canal,solicitud_soporte_id:solicitud.id,correo_cliente:correo,nombre_cliente_contacto:nombre,contacto_id,folio,token_publico,token_publico_expira,timeline_publica:timeline_inicial,adjuntos:[],evidencia_count:0,empresa_capturada:empresa||null,nombre_capturado:nombre,correo_capturado:correo,telefono_capturado:telefono,cliente_id_sugerido:match.cliente_id,contacto_id_sugerido:match.contacto_id,match_nivel:matchNivelEfectivo,match_score:match.score,match_confirmado:empresa_confirmada,contacto_confirmado,contacto_es_nuevo,requiere_consolidacion,sla_policy:sla.sla_policy,sla_first_response_deadline:sla.sla_first_response_deadline,sla_resolution_deadline:sla.sla_resolution_deadline,sla_breached_first_response:false,sla_breached_resolution:false}).select("id,folio,token_publico").single();
    if(errTicket)throw new Error(`Error creando ticket: ${errTicket.message}`);

    await addTicketEvento(ticket.id,"sistema","publica","sistema","Su caso fue recibido correctamente y ya entró a nuestra mesa de soporte.",{origen:"soporte_publico",folio});
    if(requiere_consolidacion)await addTicketEvento(ticket.id,"sistema","interna","sistema","Pendiente de consolidar empresa o contacto capturado.",{requiere_consolidacion:true,empresa_capturada:empresa||null,nombre_capturado:nombre,cliente_id_sugerido:match.cliente_id,contacto_id_sugerido:match.contacto_id});
    await logSecurity("ticket_creado",cliente_id,{ticket_id:ticket.id,solicitud_id:solicitud.id,folio,origen:"soporte_publico"});
    if(empresa_confirmada)await logSecurity("cliente_confirmado",cliente_id,{ticket_id:ticket.id,folio,cliente_id,contacto_id});
    if(requiere_consolidacion)await logSecurity("contacto_consolidado",cliente_id,{ticket_id:ticket.id,folio,pendiente:true});

    const adjuntos:Array<Record<string,unknown>>=[];
    for(const upload of validatedUploads){
      const {metadata,bytes}=upload;
      const path=`${ticket.id}/${Date.now()}_${crypto.randomUUID()}_${metadata.normalizedName}`;
      const up=await sb.storage.from("soporte_adjuntos").upload(path,bytes,{contentType:metadata.mimeType,upsert:false});
      if(up.error)throw new Error(`Error subiendo ${metadata.normalizedName}: ${up.error.message}`);
      uploadedPaths.push(path);
      const arch=await sb.from("solicitud_archivos").insert({solicitud_id:solicitud.id,nombre_archivo:metadata.normalizedName,storage_path:path,mime_type:metadata.mimeType,tamano_bytes:metadata.size,tipo_detectado:metadata.detectedType});
      if(arch.error)throw new Error(`Error guardando metadata de solicitud para ${metadata.normalizedName}: ${arch.error.message}`);
      const archTicket=await sb.from("ticket_archivos").insert({ticket_id:ticket.id,nombre_archivo:metadata.normalizedName,url_archivo:path,mime_type:metadata.mimeType,tamano_bytes:metadata.size});
      if(archTicket.error)console.error("LEGACY_TICKET_ARCHIVOS_ERROR",archTicket.error.message);
      await addArchivoTicket({ticket_id:ticket.id,solicitud_id:solicitud.id,origen:"solicitud",visibilidad:"publica",nombre_archivo:metadata.normalizedName,storage_path:path,url_firma:null,mime_type:metadata.mimeType,tamano_bytes:metadata.size,meta:{canal:"soporte_publico",detectedType:metadata.detectedType,contentSha256:metadata.contentSha256}});
      adjuntos.push({nombre:metadata.normalizedName,tipo:metadata.mimeType,peso:metadata.size,storage_path:path,url:null,origen:"soporte_publico"});
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
    const availableUntil=new Date(token_publico_expira).toLocaleString("es-MX");
    const consolidationCopy=requiere_consolidacion?"Estamos validando la asociación de empresa o contacto para registrar su caso correctamente.":"Si necesitamos XML, capturas o más información, podrás responder desde ese mismo enlace.";
    await sendMail({
      to:correo,
      subject:sanitizeEmailSubject(`Recibimos su solicitud ${folio}`),
      html:`<div style="font-family:Arial,sans-serif;line-height:1.55;color:#111"><h2 style="margin:0 0 12px">Recibimos su caso de soporte</h2><p style="margin:0 0 10px"><b>Folio:</b> ${escapeHtml(folio)}</p><p style="margin:0 0 10px"><b>Título:</b> ${escapeHtml(titulo)}</p><p style="margin:0 0 10px"><b>Sistema:</b> ${escapeHtml(sistema)}</p><p style="margin:0 0 10px">Su caso fue enviado y entró a nuestra mesa de soporte.</p><p style="margin:0 0 14px"><a href="${escapeHtml(magic_link)}" style="display:inline-block;padding:10px 14px;border-radius:10px;text-decoration:none;background:#111;color:#fff">Abrir seguimiento</a></p><p style="margin:0 0 10px">Disponible hasta: <b>${escapeHtml(availableUntil)}</b></p><p style="margin:0">${escapeHtml(consolidationCopy)}</p></div>`,
    }).catch(()=>null);

    const resp:PublicSuccessResponse={ok:true,folio,token_publico,status:"ticket_creado"};
    if(idemActive)try{await sb.rpc("support_idem_finish",{p_key:idemKey,p_status:"succeeded",p_response:resp})}catch(_e){console.error("IDEM_FINISH_ERROR")}
    return json(resp,200);
  }catch(_err:unknown){
    const reqId=crypto.randomUUID();
    console.error("SUPPORT_FATAL",reqId);
    if(validationBarrierReached){
      if(uploadedPaths.length)try{await sb.storage.from("soporte_adjuntos").remove(uploadedPaths)}catch(_e){console.error("COMPENSATION_REMOVE_ERROR")}
      if(idemKey)try{await sb.rpc("support_idem_finish",{p_key:idemKey,p_status:"failed",p_response:null})}catch(_e){/* noop */}
      try{await logSecurity("support_submit_error",null,{ip,request_id:reqId})}catch(_e){console.error("SUPPORT_LOG_ERROR")}
    }
    return json({message:"No se pudo procesar la solicitud.",code:"INTERNAL_ERROR",request_id:reqId},500);
  }
};
if(import.meta.main)Deno.serve(handler);
