import{supabase as s}from"./supabase.js";
export const qrTpl=(txt,t={})=>String(txt||"").replaceAll("{empresa}",t?.clientes?.nombre||t?.empresa_capturada||t?.nombre_capturado||"su empresa").replaceAll("{sistema}",t?.sistema||t?.sistema_detectado||"el producto").replaceAll("{folio}",t?.folio||"el ticket").replaceAll("{usuario}",t?.nombre_capturado||"cliente");
export const qrCanScope=(scope,t)=>scope==="global"||scope==="producto"||scope==="cliente"&&!!t?.cliente_id||scope==="contacto"&&!!t?.cliente_id&&!!t?.contacto_id;
export const qrScopeMsg=scope=>scope==="contacto"?"Este ticket no tiene contacto ligado.":scope==="cliente"?"Este ticket no tiene cliente ligado.":"";
export const quickClientName=t=>t?.empresa_capturada||t?.clientes?.nombre||"empresa";
export const quickContactName=t=>t?.nombre_capturado||"contacto";
export const qrDefaults=(modo="seguimiento")=>modo==="nota"?[
{titulo:"Validar evidencia",texto:"Pendiente validar evidencia del caso: modelo, foto/video, número de serie y comportamiento reportado."},
{titulo:"Escalar diagnóstico",texto:"Conviene escalar el caso con soporte técnico antes de confirmar refacción, garantía o intervención."},
{titulo:"Pendiente garantía",texto:"Pendiente validar comprobante, fecha de compra, número de serie y condiciones de garantía."}
]:modo==="solucion"?[
{titulo:"Solución aplicada",texto:"Se aplicó la solución correspondiente para {sistema}. Favor de validar operación con {empresa}."},
{titulo:"Caso resuelto",texto:"Caso resuelto para {sistema}. Queda a reserva de confirmación final por parte de {empresa}."},
{titulo:"Compatibilidad confirmada",texto:"Se confirmó compatibilidad de accesorio/refacción para {sistema}. Favor de validar modelo físico antes de compra o instalación."}
]:[
{titulo:"Pedir modelo",texto:"Para revisar {sistema} en {empresa}, por favor compártenos modelo exacto de la máquina y, si lo tienes, número de serie."},
{titulo:"Pedir foto/video",texto:"Por favor envía una foto clara y un video corto máximo de 20 segundos donde se vea {sistema}, el problema y la acción que estás realizando."},
{titulo:"Pedir garantía",texto:"Para validar garantía de {sistema}, por favor comparte comprobante de compra, fecha de compra, modelo y número de serie."},
{titulo:"Pedir muestra",texto:"Para revisar {sistema}, comparte una foto de la muestra de puntada, tipo de tela, hilo usado, aguja instalada y ajuste de tensión."},
{titulo:"Pedir horario",texto:"Compártenos por favor uno o dos horarios disponibles para revisar {sistema} en {empresa}, y el medio preferido de contacto para continuar."},
{titulo:"Confirmar solución",texto:"Se aplicó ajuste / validación operativa en {sistema}. Favor de confirmar si la máquina ya opera correctamente."},
{titulo:"Marcar resuelto",texto:"Se registró solución para {sistema}. El caso queda resuelto y puede reabrirse si el problema vuelve a presentarse."}
];
export const qrList=async({ticket,scope="global",modo="seguimiento",min=4,max=8}={})=>{let rows=[];try{if(scope==="producto")return qrDefaults(modo).slice(0,max);let q=s.from("ticket_respuestas_rapidas").select("*").eq("scope",scope).eq("modo",modo).order("orden",{ascending:true}).limit(max);if(scope==="cliente")q=q.eq("cliente_id",ticket?.cliente_id);if(scope==="contacto")q=q.eq("contacto_id",ticket?.contacto_id);const r=await q;if(r.error)throw r.error;rows=Array.isArray(r.data)?r.data:[]}catch{}if(rows.length<min)rows=qrDefaults(modo).slice(0,max).map((x,i)=>({...x,scope,modo,orden:i+1}));return rows};
export const qrSave=async({ticket,scope="global",modo="seguimiento",rows=[]}={})=>{if(scope==="producto")return {ok:true,local:true};const clean=(rows||[]).map((r,i)=>({scope,modo,orden:i+1,titulo:String(r.titulo||"").trim(),texto:String(r.texto||"").trim(),cliente_id:scope==="cliente"?ticket?.cliente_id:null,contacto_id:scope==="contacto"?ticket?.contacto_id:null})).filter(r=>r.titulo||r.texto).slice(0,10);const del=s.from("ticket_respuestas_rapidas").delete().eq("scope",scope).eq("modo",modo);if(scope==="cliente")del.eq("cliente_id",ticket?.cliente_id);if(scope==="contacto")del.eq("contacto_id",ticket?.contacto_id);const d=await del;if(d.error)throw d.error;if(clean.length){const ins=await s.from("ticket_respuestas_rapidas").insert(clean);if(ins.error)throw ins.error}return{ok:true,count:clean.length}};
