import{createClient}from"https://esm.sh/@supabase/supabase-js@2";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,"Content-Type":"application/json"}});
const env=(k:string)=>{const v=Deno.env.get(k);if(!v)throw new Error(`${k} required`);return v};
const clean=(v:FormDataEntryValue|null)=>String(v||"").trim();
const digits=(v:string)=>String(v||"").replace(/\D+/g,"");
const norm=(v:unknown)=>String(v||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim();
const domainOf=(mail:string)=>{const m=String(mail||"").trim().toLowerCase(),i=m.indexOf("@");return i>-1?m.slice(i+1):""};
type Candidate={cliente_id:string;cliente_nombre:string;score:number;level:string;reasons:string[];empresa_fuerte:boolean;contacto_sugerido?:{id:string;nombre:string|null;correo:string|null;telefono:string|null}|null};

Deno.serve(async req=>{
if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
if(req.method!=="POST")return json({error:"Método no permitido"},405);
try{
const sb=createClient(env("SUPABASE_URL"),env("SUPABASE_SERVICE_ROLE_KEY"));
const form=await req.formData();
const empresa=clean(form.get("empresa")),correo=clean(form.get("correo")).toLowerCase(),telefono=digits(clean(form.get("telefono")));
if(!empresa&&!correo&&!telefono)return json({error:"Falta empresa, correo o teléfono"},400);
const empresaNorm=norm(empresa),mailDomain=domainOf(correo);
const [clientesRes,aliasesRes]=await Promise.all([sb.from("clientes").select("id,nombre,correo,telefono").limit(250),sb.from("cliente_aliases").select("cliente_id,alias,alias_norm,activo").eq("activo",true).limit(800)]);
if(clientesRes.error)return json({error:clientesRes.error.message},500);
if(aliasesRes.error)return json({error:aliasesRes.error.message},500);
const clientes=clientesRes.data||[],aliases=aliasesRes.data||[],aliasMap=new Map<string,string[]>();
for(const a of aliases){const arr=aliasMap.get(a.cliente_id)||[];arr.push(norm((a as any).alias_norm||a.alias));aliasMap.set(a.cliente_id,arr)}
const candidates:Candidate[]=[];
for(const c of clientes){
let score=0;const reasons:string[]=[];const nombreNorm=norm(c.nombre),correoCliente=String(c.correo||"").toLowerCase(),telCliente=digits(String(c.telefono||"")),al=aliasMap.get(c.id)||[];
if(empresaNorm&&nombreNorm&&empresaNorm===nombreNorm){score+=70;reasons.push("empresa_exacta")}else if(empresaNorm&&nombreNorm&&(empresaNorm.includes(nombreNorm)||nombreNorm.includes(empresaNorm))){score+=35;reasons.push("empresa_parcial")}
if(empresaNorm&&al.includes(empresaNorm)){score+=55;reasons.push("alias_exacto")}else if(empresaNorm&&al.some(x=>x.includes(empresaNorm)||empresaNorm.includes(x))){score+=25;reasons.push("alias_parcial")}
if(correo&&correoCliente&&correo===correoCliente){score+=80;reasons.push("correo_cliente_exacto")}
if(telefono&&telCliente&&telefono===telCliente){score+=65;reasons.push("telefono_cliente_exacto")}
if(correo&&mailDomain&&correoCliente&&domainOf(correoCliente)===mailDomain){score+=20;reasons.push("dominio_correo_cliente")}
if(score<=0)continue;
const contactosRes=await sb.from("clientes_contactos").select("id,nombre,correo,telefono,activo").eq("cliente_id",c.id).eq("activo",true).limit(30);
let contacto_sugerido:null|{id:string;nombre:string|null;correo:string|null;telefono:string|null}=null;
if(!contactosRes.error){let bestContact:any=null,bestContactScore=-1;for(const ct of contactosRes.data||[]){let cs=0;const cMail=String(ct.correo||"").toLowerCase(),cTel=digits(String(ct.telefono||""));if(correo&&cMail&&correo===cMail)cs+=100;if(telefono&&cTel&&telefono===cTel)cs+=90;if(correo&&mailDomain&&cMail&&domainOf(cMail)===mailDomain)cs+=15;if(cs>bestContactScore){bestContactScore=cs;bestContact=ct}}if(bestContact&&bestContactScore>0){contacto_sugerido={id:bestContact.id,nombre:bestContact.nombre||null,correo:bestContact.correo||null,telefono:bestContact.telefono||null};score+=Math.min(bestContactScore,40);reasons.push("contacto_sugerido")}}
const empresa_fuerte=reasons.includes("empresa_exacta")||reasons.includes("alias_exacto");
const level=empresa_fuerte&&score>=90?"alto":score>=55?"medio":"bajo";
candidates.push({cliente_id:c.id,cliente_nombre:c.nombre,score,level,reasons,empresa_fuerte,contacto_sugerido});
}
candidates.sort((a,b)=>Number(b.empresa_fuerte)-Number(a.empresa_fuerte)||b.score-a.score);
const best=candidates[0]||null;
return json({ok:true,match_level:best?.level||"ninguno",suggested_cliente_id:best?.cliente_id||null,suggested_contacto_id:best?.contacto_sugerido?.id||null,candidates:candidates.slice(0,5)});
}catch(e){return json({error:e instanceof Error?e.message:"Error inesperado"},500)}
});