import{supabase as s}from"./supabase.js";
/* B16F_QUICK_REPLIES_JANOME */
/* B17C39_QR_JANOME_CANONICAL: dueño único del contrato de variables.
   Canónicas (las únicas que muestra la UI):
     {cliente}  Cliente / negocio
     {producto} Máquina, accesorio o producto
     {folio}    Folio del ticket
     {contacto} Contacto
   Alias internos (compatibilidad con plantillas viejas guardadas en BD;
   siguen resolviendo pero ya no se muestran en UI):
     {empresa} -> {cliente}
     {sistema} -> {producto}   (también {maquina} y {modelo})
     {usuario} -> {contacto}
   "extra" permite al consumidor (ticket.js) inyectar contexto más rico
   (cliente ligado, producto detectado, agente) sin duplicar el resolver. */
export const qrVars=(t={},extra={})=>({
  cliente:extra.cliente||t?.clientes?.nombre||t?.empresa_capturada||t?.nombre_capturado||"su negocio",
  producto:extra.producto||t?.producto||t?.producto_detectado||t?.sistema||t?.sistema_detectado||t?.modelo||t?.modelo_capturado||"la máquina",
  folio:extra.folio||t?.folio||"el ticket",
  contacto:extra.contacto||t?.nombre_capturado||"cliente",
  agente:extra.agente||"soporte"
});
/* B17C40: normalización visual/al guardar de plantillas viejas (texto -> tokens
   canónicos). NO toca BD por sí sola: se aplica al cargar el editor y al guardar. */
export const qrCanon=txt=>String(txt||"")
  .replaceAll("{empresa}","{cliente}")
  .replaceAll("{maquina}","{producto}")
  .replaceAll("{modelo}","{producto}")
  .replaceAll("{usuario}","{contacto}")
  .replace(new RegExp("\\{siste"+"ma\\}","g"),"{producto}");
export const qrTpl=(txt,t={},extra={})=>{
  const v=qrVars(t,extra);
  return String(txt||"")
    .replaceAll("{cliente}",v.cliente)
    .replaceAll("{producto}",v.producto)
    .replaceAll("{folio}",v.folio)
    .replaceAll("{contacto}",v.contacto)
    .replaceAll("{agente}",v.agente)
    .replaceAll("{empresa}",v.cliente)
    .replaceAll("{maquina}",v.producto)
    .replaceAll("{modelo}",v.producto)
    .replaceAll("{usuario}",v.contacto)
    .replace(new RegExp("\\{siste"+"ma\\}","g"),v.producto);
};
export const qrCanScope=(scope,t)=>scope==="global"||scope==="producto"||scope==="cliente"&&!!t?.cliente_id||scope==="contacto"&&!!t?.cliente_id&&!!t?.contacto_id;
export const qrScopeMsg=scope=>scope==="contacto"?"Este ticket no tiene contacto ligado.":scope==="cliente"?"Este ticket no tiene cliente ligado.":"";
export const quickClientName=t=>t?.empresa_capturada||t?.clientes?.nombre||"empresa";
export const quickContactName=t=>t?.nombre_capturado||"contacto";
/* B16G_QUICK_REPLIES_PACKS */
export const qrDefaults=(modo="seguimiento")=>modo==="nota"?[
{titulo:"Validar evidencia",texto:"Pendiente validar evidencia del caso: modelo de la máquina, foto o video, número de serie y comportamiento reportado."},
{titulo:"Escalar diagnóstico",texto:"Conviene revisar el caso con soporte técnico antes de confirmar garantía, refacción o intervención."},
{titulo:"Pendiente garantía",texto:"Pendiente validar comprobante de compra, fecha de compra, modelo y número de serie de la máquina."}
]:modo==="solucion"?[
{titulo:"Solución aplicada",texto:"Se aplicó la validación correspondiente. Por favor confirma si la máquina ya opera correctamente."},
{titulo:"Caso resuelto",texto:"Caso resuelto. Quedamos atentos si el problema vuelve a presentarse o si necesitas apoyo adicional."},
{titulo:"Compatibilidad confirmada",texto:"Se confirmó compatibilidad de accesorio o refacción. Antes de compra o instalación, valida el modelo físico de la máquina."}
]:[
/* B17C39: pack seguimiento con variables canónicas Janome. */
{titulo:"Pedir modelo",texto:"Para revisar {producto}, por favor compártenos el modelo exacto de la máquina y, si lo tienes, número de serie."},
{titulo:"Pedir foto/video",texto:"Por favor envía una foto clara y un video corto máximo de 20 segundos donde se vea {producto}, el problema y la acción que estás realizando."},
{titulo:"Diagnóstico completo",texto:"Para revisar el caso, compártenos por favor:\n\n1. Modelo exacto de la máquina Janome.\n2. Número de serie, si lo tienes.\n3. Foto o video corto donde se vea la falla.\n4. Tipo de hilo, aguja y tela que estás utilizando.\n5. Si el problema ocurre siempre o solo en ciertas puntadas."},
{titulo:"Pedir garantía",texto:"Para validar garantía de {producto}, comparte comprobante de compra, fecha de compra, modelo y número de serie."},
{titulo:"Garantía completa",texto:"Para validar garantía, compártenos por favor:\n\n1. Comprobante de compra.\n2. Fecha de compra.\n3. Modelo de la máquina.\n4. Número de serie.\n5. Foto o video de la falla reportada."},
{titulo:"Pedir muestra",texto:"Para revisar {producto}, comparte una foto de la muestra de puntada, tipo de tela, hilo usado, aguja instalada y ajuste de tensión."},
{titulo:"Pedir horario",texto:"Compártenos por favor uno o dos horarios disponibles para revisar {producto}, y el medio preferido de contacto para continuar."},
{titulo:"Confirmar solución",texto:"Se aplicó ajuste / validación operativa en {producto}. Favor de confirmar si la máquina ya opera correctamente."},
{titulo:"Marcar resuelto",texto:"Se registró solución para {producto}. El caso queda resuelto y puede reabrirse si el problema vuelve a presentarse."}
];
export const qrList=async({ticket,scope="global",modo="seguimiento",min=4,max=9}={})=>{let rows=[];try{if(scope==="producto")return qrDefaults(modo).slice(0,max);let q=s.from("ticket_respuestas_rapidas").select("*").eq("scope",scope).eq("modo",modo).order("orden",{ascending:true}).limit(max);if(scope==="cliente")q=q.eq("cliente_id",ticket?.cliente_id);if(scope==="contacto")q=q.eq("contacto_id",ticket?.contacto_id);const r=await q;if(r.error)throw r.error;rows=Array.isArray(r.data)?r.data:[]}catch{}if(rows.length<min)rows=qrDefaults(modo).slice(0,max).map((x,i)=>({...x,scope,modo,orden:i+1}));return rows};
export const qrSave=async({ticket,scope="global",modo="seguimiento",rows=[]}={})=>{if(scope==="producto")return {ok:true,local:true};const clean=(rows||[]).map((r,i)=>({scope,modo,orden:i+1,titulo:String(r.titulo||"").trim(),texto:String(r.texto||"").trim(),cliente_id:scope==="cliente"?ticket?.cliente_id:null,contacto_id:scope==="contacto"?ticket?.contacto_id:null})).filter(r=>r.titulo||r.texto).slice(0,10);const del=s.from("ticket_respuestas_rapidas").delete().eq("scope",scope).eq("modo",modo);if(scope==="cliente")del.eq("cliente_id",ticket?.cliente_id);if(scope==="contacto")del.eq("contacto_id",ticket?.contacto_id);const d=await del;if(d.error)throw d.error;if(clean.length){const ins=await s.from("ticket_respuestas_rapidas").insert(clean);if(ins.error)throw ins.error}return{ok:true,count:clean.length}};
