import{createClient}from"https://esm.sh/@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"GET, OPTIONS"};
const json=(d:unknown,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{...cors,"Content-Type":"application/json"}});
const env=(k:string)=>{const v=Deno.env.get(k);if(!v)throw new Error(`${k} required`);return v};
const clean=(v:string|null)=>String(v||"").trim();
const lower=(v:unknown)=>String(v||"").trim().toLowerCase();
Deno.serve(async req=>{if(req.method==="OPTIONS")return new Response("ok",{headers:cors});if(req.method!=="GET")return json({error:"Método no permitido"},405);try{
const sb=createClient(env("SUPABASE_URL"),env("SUPABASE_SERVICE_ROLE_KEY")),u=new URL(req.url),folio=clean(u.searchParams.get("folio")),token=clean(u.searchParams.get("token"));
if(!folio||!token)return json({error:"Faltan datos"},400);
const{data:t,error}=await sb.from("tickets").select("id,cliente_id,folio,titulo,estado,prioridad,tipo,impacto,fecha_creacion,fecha_actualizacion,timeline_publica,adjuntos,evidencia_count,token_publico,token_publico_expira,solicitud_soporte_id,contexto_adicional").eq("folio",folio).eq("token_publico",token).maybeSingle();
if(error)return json({error:error.message},500);if(!t)return json({error:"No encontrado"},404);
if(t.token_publico_expira&&new Date(String(t.token_publico_expira)).getTime()<Date.now())return json({error:"Enlace expirado"},410);
let producto_modelo="";
if(t.solicitud_soporte_id){const{data:solicitud}=await sb.from("solicitudes_soporte").select("sistema").eq("id",t.solicitud_soporte_id).maybeSingle();producto_modelo=clean(solicitud?.sistema||null)}
if(!producto_modelo){const match=String(t.contexto_adicional||"").match(/^Producto:\s*([^|\r\n]+)/im);producto_modelo=clean(match?.[1]||null)}
if(!producto_modelo)producto_modelo="Producto Janome no especificado";
const sign=async(path:unknown)=>{const p=String(path||"").trim();if(!p)return null;const{data,error}=await sb.storage.from("soporte_adjuntos").createSignedUrl(p,60*60*8);if(error)return null;return data?.signedUrl||null};
const hydrate=async(arr:unknown)=>Promise.all((Array.isArray(arr)?arr:[]).filter(Boolean).map(async(a:any)=>{const path=String(a?.storage_path||a?.url_archivo||"").trim(),fallback=String(a?.url||a?.signedUrl||a?.signed_url||a?.href||"").trim(),url=path?await sign(path):fallback||null;return{nombre:a?.nombre||a?.name||a?.nombre_archivo||"Archivo",tipo:a?.tipo||a?.mime_type||a?.type||null,peso:a?.peso||a?.tamano_bytes||a?.size||0,storage_path:path||null,url,origen:a?.origen||"solicitud",fecha:a?.fecha||a?.creado_en||a?.fecha_subida||null}}));
let timeline_publica:Array<Record<string,unknown>>=[];
const{data:eventos,error:eventErr}=await sb.from("ticket_eventos").select("id,autor_tipo,visibilidad,kind,texto,created_at,meta").eq("ticket_id",t.id).eq("visibilidad","publica").order("created_at",{ascending:true});
if(!eventErr&&Array.isArray(eventos)&&eventos.length){timeline_publica=await Promise.all(eventos.map(async(e:any)=>({id:e.id,autor:e.autor_tipo==="cliente"?"cliente":e.autor_tipo==="soporte"?"soporte":"sistema",kind:e.kind||"mensaje",titulo:e.kind==="archivo"?"Evidencia adjunta":e.kind==="estado"?"Actualización":e.kind==="sistema"?"Sistema":"Mensaje",texto:e.texto||"",fecha:e.created_at,adjuntos:await hydrate(Array.isArray(e?.meta?.adjuntos)?e.meta.adjuntos:[]),reply_to:e?.meta?.reply_to||null,reply_preview:e?.meta?.reply_preview||null,reply_author:e?.meta?.reply_author||null,reply_kind:e?.meta?.reply_kind||null})))}else timeline_publica=Array.isArray(t.timeline_publica)?await Promise.all(t.timeline_publica.map(async(x:any)=>({...x,adjuntos:await hydrate(Array.isArray(x?.adjuntos)?x.adjuntos:[])}))):[];
let adjuntos:Array<Record<string,unknown>>=[];
const{data:archivos,error:archErr}=await sb.from("archivos_ticket").select("id,nombre_archivo,storage_path,mime_type,tamano_bytes,origen,visibilidad,creado_en,meta").eq("ticket_id",t.id).eq("visibilidad","publica").order("creado_en",{ascending:true});
if(!archErr&&Array.isArray(archivos)&&archivos.length)adjuntos=await hydrate(archivos);
else{adjuntos=await hydrate(Array.isArray(t.adjuntos)?t.adjuntos:[]);if(!adjuntos.length){const{data:legacy,error:legacyErr}=await sb.from("ticket_archivos").select("nombre_archivo,url_archivo,mime_type,tamano_bytes,fecha_subida").eq("ticket_id",t.id).order("fecha_subida",{ascending:true});if(!legacyErr&&Array.isArray(legacy)&&legacy.length)adjuntos=await hydrate(legacy)}}
const seen=new Set<string>();adjuntos=adjuntos.filter((a:any)=>{const k=String(a.storage_path||a.url||a.nombre||"");if(!k||seen.has(k))return false;seen.add(k);return true});
timeline_publica=timeline_publica.map((ev:any)=>({...ev,adjuntos:Array.isArray(ev.adjuntos)?ev.adjuntos.filter((a:any)=>a?.url||a?.storage_path):[]}));
const hasArchivoEvent=timeline_publica.some((x:any)=>lower(x?.kind)==="archivo"||lower(x?.titulo)==="evidencia adjunta");
if(adjuntos.length&&!hasArchivoEvent)timeline_publica=[...timeline_publica,{id:`files_${t.id}`,autor:"sistema",kind:"archivo",titulo:"Evidencia adjunta",texto:`Se recibieron ${adjuntos.length} archivo(s) en este caso.`,fecha:t.fecha_actualizacion||t.fecha_creacion,adjuntos}];
try{const ip=(req.headers.get("cf-connecting-ip")||req.headers.get("x-forwarded-for")||req.headers.get("x-real-ip")||"unknown").split(",")[0].trim(),ua=req.headers.get("user-agent")||"",since=new Date(Date.now()-10*60*1000).toISOString(),{count}=await sb.from("ticket_portal_logs").select("id",{count:"exact",head:true}).eq("ticket_id",t.id).eq("evento","view").eq("ip",ip).gte("created_at",since);if(!count)await sb.from("ticket_portal_logs").insert({ticket_id:t.id,folio,evento:"view",ip,user_agent:ua,detalle:{via:"estado-ticket-ts",throttle_min:10}})}catch{}

try{const since=new Date(Date.now()-60*60*1000).toISOString(),{count}=await sb.from("bitacora").select("id",{count:"exact",head:true}).eq("accion","portal_abierto").eq("detalle->>ticket_id",t.id).gte("fecha",since);if(!count)await sb.from("bitacora").insert({accion:"portal_abierto",cliente_id:t.cliente_id||null,detalle:{ticket_id:t.id,folio,via:"estado-ticket-ts",throttle_min:60},visibilidad:"interna",tipo:"nota_interna"})}catch{}
return json({ok:true,ticket:{id:t.id,folio:t.folio,titulo:t.titulo,estado:t.estado,prioridad:t.prioridad,tipo:t.tipo,impacto:t.impacto,producto_modelo,fecha_creacion:t.fecha_creacion,fecha_actualizacion:t.fecha_actualizacion,timeline_publica,adjuntos,evidencia_count:Number(t.evidencia_count||adjuntos.length||0),read_only:["cerrado"].includes(lower(t.estado))}},200);
}catch(e){return json({error:e instanceof Error?e.message:"Error"},500)}});
