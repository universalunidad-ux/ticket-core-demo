const normalize=value=>String(value||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g," ").trim();
export const INITIAL_REQUEST_RECEIVED_TEXT="Tu solicitud ya llegó a nuestra mesa de soporte.";

export const isInitialRequestReceivedEvent=event=>{
  if(!event||event.autor!=="sistema")return false;
  if(event.id==="sys_created")return true;
  const semantic=normalize(event.kind||event.code||event.tipo||event.meta?.kind||event.meta?.code).replace(/[\s-]+/g,"_");
  if(["solicitud_recibida","request_received","ticket_received","ticket_created","caso_recibido"].includes(semantic))return true;
  const candidates=[event.titulo,event.texto].map(normalize).filter(Boolean);
  return candidates.some(text=>/^(caso|solicitud) recibid[ao](?:\b|[.:])/.test(text)||/^su (?:caso|solicitud) fue recibid[ao](?:\b|[.:])/.test(text)||text===normalize(INITIAL_REQUEST_RECEIVED_TEXT));
};
