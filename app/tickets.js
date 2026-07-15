import{supabase as s,guardSession,msg}from"./supabase.js";
import{$,$$,toast,debounce,show,hide,bindModal,norm,ensureAppShell,setAppRole,setRailOpenCount,setGlobalSearchData,setBreadcrumb,daysSince,ticketStateKey as baseTicketStateKey,ticketStateLabel,ticketPriorityCls}from"./global.js?v=frontend-stabilization-03b";
import{registerInternalSearchProvider}from"./shared/nav-interna.js?v=frontend-stabilization-03b";

window.s=s;
let QR_SHARED_OK=false;
let qrDefaults=modo=>modo==="solucion"?[
{titulo:"Solución aplicada",texto:"Se aplicó la solución correspondiente para {producto}. Favor de validar operación con {cliente}."},
{titulo:"Caso resuelto",texto:"Caso resuelto para {producto}. Queda a reserva de confirmación final por parte de {cliente}."},
{titulo:"Compatibilidad confirmada",texto:"Se confirmó compatibilidad de accesorio/refacción para {producto}. Favor de validar modelo físico antes de compra o instalación."}
]:modo==="nota"?[
{titulo:"Validar evidencia",texto:"Pendiente validar evidencia del caso: modelo, foto/video, número de serie y comportamiento reportado."},
{titulo:"Escalar diagnóstico",texto:"Conviene escalar el caso con soporte técnico antes de confirmar refacción, garantía o intervención."},
{titulo:"Pendiente garantía",texto:"Pendiente validar comprobante, fecha de compra, número de serie y condiciones de garantía."}
]:[
{titulo:"Pedir modelo",texto:"Para revisar {producto}, por favor compártenos el modelo exacto de la máquina y, si lo tienes, número de serie."},
{titulo:"Pedir foto/video",texto:"Por favor envía una foto clara y un video corto máximo de 20 segundos donde se vea {producto}, el problema y la acción que estás realizando."},
{titulo:"Pedir garantía",texto:"Para validar garantía de {producto}, comparte comprobante de compra, fecha de compra, modelo y número de serie."},
{titulo:"Pedir muestra",texto:"Para revisar {producto}, comparte una foto de la muestra de puntada, tipo de tela, hilo usado, aguja instalada y ajuste de tensión."},
{titulo:"Pedir horario",texto:"Compártenos por favor uno o dos horarios disponibles para revisar {producto}, y el medio preferido de contacto para continuar."},
{titulo:"Confirmar solución",texto:"Se aplicó ajuste / validación operativa en {producto}. Favor de confirmar si la máquina ya opera correctamente."},
{titulo:"Marcar resuelto",texto:"Se registró solución para {producto}. El caso queda resuelto y puede reabrirse si el problema vuelve a presentarse."}
];
/* B17C39: fallback local con contrato canónico + alias (el shared es el dueño real). */
let qrTpl=(txt,t={})=>{const cliente=t?.clientes?.nombre||t?.empresa_capturada||t?.nombre_capturado||"su negocio",producto=t?.producto||t?.producto_detectado||t?.sistema||t?.sistema_detectado||"la máquina",folio=t?.folio||"el ticket",contacto=t?.nombre_capturado||"cliente";return String(txt||"").replaceAll("{cliente}",cliente).replaceAll("{producto}",producto).replaceAll("{folio}",folio).replaceAll("{contacto}",contacto).replaceAll("{empre"+"sa}",cliente).replaceAll("{siste"+"ma}",producto).replaceAll("{maquina}",producto).replaceAll("{modelo}",producto).replaceAll("{usua"+"rio}",contacto)};
let qrCanScope=(scope,t)=>scope==="global"||scope==="producto"||scope==="cliente"&&!!t?.cliente_id||scope==="contacto"&&!!t?.cliente_id&&!!t?.contacto_id;
let qrScopeMsg=scope=>scope==="contacto"?"Este ticket no tiene contacto ligado.":scope==="cliente"?"Este ticket no tiene cliente ligado.":"";
let qrList=async({ticket,modo="seguimiento",limit=10}={})=>qrDefaults(modo).map((x,i)=>({...x,id:"",scope:"global",modo,orden:i+1})).slice(0,limit);
let qrLoadScope=async({ticket,scope="global",modo="seguimiento",min=7,max=10}={})=>{const rows=qrDefaults(modo).map((x,i)=>({...x,id:"",scope,modo,orden:i+1}));while(rows.length<min)rows.push({id:"",scope,modo,titulo:`Respuesta ${rows.length+1}`,texto:"",orden:rows.length+1});return rows.slice(0,max)};
let qrSaveScope=async()=>{throw new Error("No se cargó quick-replies.shared.js. Revisa que exista en PANEL/ y no tenga errores.")};
let qrCanon=txt=>String(txt||"").replaceAll("{empre"+"sa}","{cliente}").replaceAll("{maquina}","{producto}").replaceAll("{modelo}","{producto}").replaceAll("{usua"+"rio}","{contacto}").replace(new RegExp("\\{siste"+"ma\\}","g"),"{producto}");/* B17C40 fallback */
import("./quick-replies.shared.js").then(m=>{qrList=m.qrList||qrList;qrLoadScope=m.qrList||m.qrLoadScope||qrLoadScope;qrSaveScope=m.qrSave||m.qrSaveScope||qrSaveScope;qrCanScope=m.qrCanScope||qrCanScope;qrScopeMsg=m.qrScopeMsg||qrScopeMsg;qrTpl=m.qrTpl||qrTpl;qrDefaults=m.qrDefaults||qrDefaults;qrCanon=m.qrCanon||qrCanon;QR_SHARED_OK=true;console.info("QR_SHARED_OK")}).catch(e=>{QR_SHARED_OK=false;console.warn("QR_SHARED_ERROR",e)});
window.__qrSharedStatus=()=>({ok:QR_SHARED_OK,loaded:QR_SHARED_OK});
const tkEsc=v=>String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
const tkAttr=v=>tkEsc(v).replace(/\n/g,"&#10;");
let LOAD_SEQ=0;
let TK=[],FILTER={q:"",priority:"",state:"",type:"",client:"",clienteId:"",noEvidence:false,impactHigh:false,urgentStale:false,noClientLinked:false,matchMedium:false,frBreach:false,rsBreach:false,slaSoon:false},CLOSED={mode:"all",range:"30d",q:"",page:0,pageSize:20},MOBILE_STATE=["abierto","en_proceso","resuelto"].includes(localStorage.getItem("tc_tickets_mobile_state"))?localStorage.getItem("tc_tickets_mobile_state"):"abierto",VIEW=localStorage.getItem("tc_tickets_view")||"kanban",SELECTED_ID="",EDIT_MODE=false,DRAG_COL=null,BOARD_NOTIF=JSON.parse(localStorage.getItem("tc_tickets_notif")||'{"visual":true,"sound":true,"strongOnly":false,"volume":0.5,"muted":false}'),COL_PAGE={abierto:0,en_proceso:0,esperando_cliente:0,resuelto:0},COL_PAGE_SIZE=10,COMPACT_GROUP=localStorage.getItem("tc_tickets_compact_group")||"abierto",COMPACT_PAGE=Number(localStorage.getItem("tc_tickets_compact_page")||0)||0,COMPACT_PAGE_SIZE=10,QUICK={lastCopied:"",lastAction:"",open:false},SAVE_BUSY=false;window.TK=TK; if(Array.isArray(TK)&&TK.length){document.body.dataset.ticketsReady="1"}/* B2_3_TICKETS_READY_AFTER_LOAD */;
if(!["abierto","en_proceso","resuelto"].includes(MOBILE_STATE)){MOBILE_STATE="abierto";localStorage.setItem("tc_tickets_mobile_state","abierto")}
const MOBILE_QUERY_STATE=new URLSearchParams(location.search).get("column");
if(["abierto","en_proceso","resuelto"].includes(MOBILE_QUERY_STATE))MOBILE_STATE=MOBILE_QUERY_STATE;

const saveBoardNotif=()=>{localStorage.setItem("tc_tickets_notif",JSON.stringify(BOARD_NOTIF));syncBoardNotifUI()};
const mountNotifSoundPicker=()=>{const r=$("#tkNotifVolume");if(!r||$("#tkNotifSoundType"))return;const box=r.closest("label")||r.parentElement;box?.insertAdjacentHTML("afterend",`<div class="thread-opt range-opt tk-sound-row"><span>Sonido</span><select class="select" id="tkNotifSoundType" aria-label="Sonido de alerta"><option value="ding">Ding</option><option value="pop">Pop</option><option value="chime">Chime</option><option value="doble">Doble</option><option value="urgente">Urgente</option></select><button class="mini btn-ghost gear-icon-btn" id="tkTestSoundBtn" type="button" aria-label="Probar sonido" title="Probar sonido"><img src="../IMG/sonido.webp" alt=""></button></div>`)};
const syncBoardNotifUI=()=>{mountNotifSoundPicker();BOARD_NOTIF.soundType=BOARD_NOTIF.soundType||"ding";$("#tkNotifVisual")&&($("#tkNotifVisual").checked=!!BOARD_NOTIF.visual);$("#tkNotifSound")&&($("#tkNotifSound").checked=!!BOARD_NOTIF.sound);$("#tkNotifStrongOnly")&&($("#tkNotifStrongOnly").checked=!!BOARD_NOTIF.strongOnly);$("#tkNotifVolume")&&($("#tkNotifVolume").value=String(Number(BOARD_NOTIF.volume??0.5)));$("#tkNotifSoundType")&&($("#tkNotifSoundType").value=BOARD_NOTIF.soundType||"ding");const b=$("#tkMuteBoardBtn");if(b){const on=!!BOARD_NOTIF.muted,txt=on?"Reactivar mesa":"Silenciar mesa";b.innerHTML=`<img src="../IMG/${on?"subirvolumen.webp":"undonotificacion.webp"}" alt="">`;b.setAttribute("aria-label",txt);b.setAttribute("title",txt)}};
const syncNotifyHint=()=>{const mail=$("#tkCorreo")?.value?.trim()||"",chk=$("#tkNotificar");if(!chk)return;if(!mail){chk.checked=false;chk.closest("label")?.classList.add("is-muted")}else chk.closest("label")?.classList.remove("is-muted")};
const isMobileTickets=()=>matchMedia("(max-width:720px)").matches;
const rawState=t=>t?.estado||t?.estatus||t?.status||"abierto";
const ticketStateKey=v=>{const x=norm(v||"abierto").replace(/[\s-]+/g,"_").replace(/^_+|_+$/g,"");if(x==="esperando_cliente"||x==="espera_cliente"||x==="pendiente_cliente"||x.includes("esperando")||x.includes("pendiente_cliente"))return"esperando_cliente";if(x==="en_proceso"||x==="proceso"||x==="revision"||x.includes("proceso")||x.includes("revision"))return"en_proceso";if(x==="resuelto"||x.includes("resuelt"))return"resuelto";if(x==="cerrado"||x.includes("cerrad"))return"cerrado";if(x==="abierto"||x.includes("abiert"))return"abierto";return baseTicketStateKey?.(v)||"abierto"};
const staleCls=t=>daysSince(t.fecha_actualizacion||t.fecha_creacion)>=1&&!["resuelto","cerrado"].includes(ticketStateKey(rawState(t)))?"is-stale":"";
const isCritical=t=>norm(t.prioridad)==="urgente"||daysSince(t.fecha_actualizacion||t.fecha_creacion)>=3&&!["resuelto","cerrado"].includes(ticketStateKey(rawState(t)));
const evidenceCount=t=>Array.isArray(t?.adjuntos)?t.adjuntos.length:Number(t?.evidencia_count||t?.attachments_count||t?.files_count||0)||0;
const impactKey=t=>{const x=norm(t?.impacto||t?.impact||"");return x==="alta"?"alta":x==="media"?"media":x==="baja"?"baja":x==="preventiva"?"preventiva":""};
const normTipo=v=>{const x=norm(v||"");return x==="renovacion"?"renovacion":"soporte"};

const noClientLinked=t=>!t?.cliente_id;
const hasLinkedContact=t=>!!t?.cliente_id&&!!t?.contacto_id;
const noLinkedContact=t=>!!t?.cliente_id&&!t?.contacto_id;
const existingClientPending=t=>!!t?.cliente_id&&!!t?.requiere_consolidacion;
const matchLevel=t=>norm(t?.match_nivel||"");
const consolidated=t=>!!t?.cliente_id&&!t?.requiere_consolidacion;

const nextAction=t=>{const s=ticketStateKey(rawState(t)),d=norm(`${t?.titulo||""} ${t?.descripcion||""}`);if(s==="esperando_cliente")return"Esperar respuesta o archivo";if(s==="resuelto")return"Listo para cierre";if(d.includes("foto")||d.includes("video")||d.includes("imagen")||d.includes("captura"))return"Revisar evidencia";if(d.includes("hilo")||d.includes("tension")||d.includes("aguja")||d.includes("puntada")||d.includes("cose"))return"Diagnóstico técnico";if(d.includes("garantia"))return"Validar garantía";if(s==="abierto")return"Primera revisión";return"Dar seguimiento"};
const readyToClose=t=>ticketStateKey(rawState(t))==="resuelto"; const slaPack=p=>{const x=norm(p||"media");if(x==="urgente")return{policy:"urgent_2h_8h",fr:2,res:8};if(x==="alta")return{policy:"high_4h_24h",fr:4,res:24};if(x==="media")return{policy:"medium_8h_48h",fr:8,res:48};return{policy:"low_24h_72h",fr:24,res:72}};
const healthTag=t=>{const s=ticketStateKey(rawState(t)),stale=daysSince(t.fecha_actualizacion||t.fecha_creacion),ev=evidenceCount(t),impact=impactKey(t);if(readyToClose(t))return{txt:"Para cierre",cls:"ok"};if(s==="esperando_cliente")return{txt:"Esperando respuesta",cls:"warn"};if(norm(t.prioridad)==="urgente"||impact==="alta"||stale>=3)return{txt:"Atención prioritaria",cls:"bad"};if(!ev)return{txt:"Falta información",cls:"warn"};return{txt:"En buen curso",cls:"info"}};
const slaMeta=t=>{const state=ticketStateKey(rawState(t)),created=new Date(t?.fecha_creacion||Date.now()).getTime(),p=norm(t?.prioridad),txt=norm(`${t?.titulo||""} ${t?.descripcion||""}`),frMins=p==="urgente"?10:p==="alta"?60:480,rsHours=p==="urgente"?8:p==="alta"?24:p==="media"?48:72,frDeadline=created+frMins*6e4,rsDeadline=created+rsHours*36e5,frDone=!!t?.primera_respuesta_en||["en_proceso","esperando_cliente","resuelto","cerrado"].includes(state),now=Date.now(),frLeft=frDeadline-now,rsLeft=rsDeadline-now;if(!frDone&&frLeft<=0)return{cls:"bad",txt:"1ra resp. vencida"};if(!frDone&&frLeft<=72e5)return{cls:"warn",txt:`1ra resp. ${Math.max(1,Math.round(frLeft/36e5))}h`};if(!["resuelto","cerrado"].includes(state)&&rsLeft<=0)return{cls:"bad",txt:"Resolución vencida"};if(!["resuelto","cerrado"].includes(state)&&rsLeft<=144e5)return{cls:"warn",txt:`Resol. ${Math.max(1,Math.round(rsLeft/36e5))}h`};return["resuelto","cerrado"].includes(state)?{cls:"ok",txt:"Para cierre"}:{cls:"ok",txt:"SLA OK"}};
const slaFrBreached=t=>{
  if(t?.primera_respuesta_en)return false;
  if(t?.sla_breached_first_response)return true;
  const created=createdMs(t);
  if(!created)return false;
  const p=norm(t?.prioridad||"media");
  const mins=p==="urgente"?10:p==="alta"?60:480;
  return Date.now()>created+mins*60000;
};
const slaRsBreached=t=>ticketStateKey(rawState(t))!=="resuelto"&&ticketStateKey(rawState(t))!=="cerrado"&&!!t?.sla_breached_resolution;
const urgentStale=t=>{const d=new Date(t?.fecha_actualizacion||t?.fecha_creacion||0),start=new Date();start.setHours(0,0,0,0);return["urgente","alta"].includes(norm(t?.prioridad))&&!["resuelto","cerrado"].includes(ticketStateKey(rawState(t)))&&Number.isFinite(d.getTime())&&d.getTime()<start.getTime()};
const slaSoon=t=>{const state=ticketStateKey(rawState(t)),created=new Date(t?.fecha_creacion||Date.now()).getTime(),p=norm(t?.prioridad),frMins=p==="urgente"?10:p==="alta"?60:480,rsHours=p==="urgente"?8:p==="alta"?24:p==="media"?48:72,frDeadline=created+frMins*60000,rsDeadline=created+rsHours*3600000,frDone=!!t?.primera_respuesta_en||["en_proceso","esperando_cliente","resuelto","cerrado"].includes(state),now=Date.now(),frLeft=frDeadline-now,rsLeft=rsDeadline-now;if(!frDone&&frLeft>0&&frLeft<=2*3600000)return true;if(!["resuelto","cerrado"].includes(state)&&rsLeft>0&&rsLeft<=4*3600000)return true;return false};
const triageScore=t=>{const s=ticketStateKey(rawState(t)),p=norm(t?.prioridad),impact=impactKey(t),stale=daysSince(t?.fecha_actualizacion||t?.fecha_creacion),ev=evidenceCount(t),now=Date.now(),fr=t?.sla_first_response_deadline?new Date(t.sla_first_response_deadline).getTime()-now:null,rs=t?.sla_resolution_deadline?new Date(t.sla_resolution_deadline).getTime()-now:null,frDone=!!t?.primera_respuesta_en;let n=0;if(s==="abierto")n+=40;if(s==="en_proceso")n+=28;if(s==="esperando_cliente")n+=14;if(s==="resuelto")n+=4;if(p==="urgente")n+=40;else if(p==="alta")n+=26;else if(p==="media")n+=12;else n+=4;if(impact==="alta")n+=24;else if(impact==="media")n+=10;else if(impact==="baja")n+=4;if(stale>=3)n+=26;else if(stale>=1)n+=12;if(ev===0)n+=10;else if(ev>=1)n-=2;if(!frDone&&t?.sla_breached_first_response)n+=34;else if(!frDone&&fr!==null&&fr<=2*36e5)n+=20;if(t?.sla_breached_resolution)n+=30;else if(rs!==null&&rs<=4*36e5&&s!=="resuelto"&&s!=="cerrado")n+=18;if(s==="cerrado")n=-999;return n};
const createdMs=t=>new Date(t?.fecha_creacion||t?.created_at||t?.fecha_actualizacion||0).getTime()||0;
const updatedMs=t=>new Date(t?.fecha_actualizacion||t?.fecha_creacion||t?.created_at||0).getTime()||0;
const isNewTicket=t=>Date.now()-createdMs(t)<36e5;
const randToken=()=>crypto.randomUUID().replace(/-/g,"")+crypto.randomUUID().replace(/-/g,"");
const nextFolioSimple=async()=>{const d=new Date(),yy=String(d.getFullYear()).slice(-2),mm=String(d.getMonth()+1).padStart(2,"0"),dd=String(d.getDate()).padStart(2,"0"),rnd=Math.random().toString(36).slice(2,6).toUpperCase();return`SP-${yy}${mm}${dd}-${rnd}`};
const qp=k=>new URLSearchParams(location.search).get(k)||"";
const resetFilters=()=>FILTER={q:"",priority:"",state:"",type:"",client:"",clienteId:"",noEvidence:false,impactHigh:false,urgentStale:false,noClientLinked:false,matchMedium:false,frBreach:false,rsBreach:false,slaSoon:false};

const tkSyncFilterActiveUi=()=>{
  try{
    const f=typeof FILTER!=="undefined"?FILTER:{};

    const activeMap={
      metricUrgent:f.priority==="urgente",
      metricWait:f.state==="esperando_cliente",
      metricStale:!!f.urgentStale,
      metricSolved:f.state==="resuelto",
      tkUrgentStale:!!f.urgentStale,
      tkFrBreach:!!f.frBreach,
      tkReadyClose:!!f.readyClose,
      tkToggleClosed:f.state==="cerrado"||!!CLOSED?.open
    };

    Object.entries(activeMap).forEach(([id,on])=>{
      const el=$("#"+id);
      if(!el)return;
      el.classList.toggle("is-active",!!on);
      el.setAttribute("aria-pressed",on?"true":"false");
    });

    const clear=$("#tkClearFilters");
    if(clear){
      const any=Object.values(activeMap).some(Boolean)||!!f.q||!!f.priority||!!f.state||!!f.type;
      clear.classList.toggle("is-idle",!any);
      clear.classList.toggle("is-active",any);
    }
  }catch(e){
    console.warn("TK_FILTER_ACTIVE_SYNC_FALLBACK",e);
  }
};

const tkWireFilterActiveFallback=()=>{
  if(document.documentElement.dataset.tkFilterActiveBound)return;
  document.documentElement.dataset.tkFilterActiveBound="1";

  document.addEventListener("click",e=>{
    const b=e.target?.closest?.("#metricUrgent,#metricWait,#metricStale,#metricSolved,#tkUrgentStale,#tkFrBreach,#tkReadyClose,#tkToggleClosed,#tkClearFilters");
    if(!b)return;
    setTimeout(()=>tkSyncFilterActiveUi?.(),80);
  },true);
};

const syncFilterUI=()=>{$("#tkSearch")&&($("#tkSearch").value=FILTER.q||"");$("#tkFilterPriority")&&($("#tkFilterPriority").value=FILTER.priority||"");$("#tkFilterState")&&($("#tkFilterState").value=FILTER.state||"");$("#tkFilterType")&&($("#tkFilterType").value=FILTER.type||"");$("#tkFilterClient")&&($("#tkFilterClient").value=FILTER.client||"");["tkNoEvidence","tkImpactHigh","tkUrgentStale","tkNoClientLinked","tkMatchMedium","tkFrBreach","tkRsBreach","tkSlaSoon"].forEach(id=>$("#"+id)?.classList.toggle("btn-brand",id==="tkNoEvidence"?FILTER.noEvidence:id==="tkReadyClose"?FILTER.readyClose:id==="tkImpactHigh"?FILTER.impactHigh:id==="tkUrgentStale"?FILTER.urgentStale:id==="tkNoClientLinked"?FILTER.noClientLinked:id==="tkMatchMedium"?FILTER.matchMedium:id==="tkFrBreach"?FILTER.frBreach:id==="tkRsBreach"?FILTER.rsBreach:FILTER.slaSoon));$("#metricUrgent")?.classList.toggle("is-active",FILTER.priority==="urgente");$("#tkOnlyUrgent")?.classList.toggle("btn-brand",FILTER.priority==="urgente");$("#metricWait")?.classList.toggle("is-active",FILTER.state==="esperando_cliente");$("#metricStale")?.classList.toggle("is-active",FILTER.urgentStale===true);$("#metricSolved")?.classList.toggle("is-active",FILTER.state==="resuelto");$("#metricNoClient")?.classList.toggle("is-active",FILTER.noClientLinked===true);$("#metricFrBreach")?.classList.toggle("is-active",FILTER.frBreach===true);$("#metricRsBreach")?.classList.toggle("is-active",FILTER.rsBreach===true);$("#metricSlaSoon")?.classList.toggle("is-active",FILTER.slaSoon===true)};
const applyUrlFilters=()=>{resetFilters();const view=qp("view"),state=qp("state"),priority=qp("priority"),clienteId=qp("cliente_id"),type=qp("type"),q=qp("q"),noClient=qp("noClient"),match=qp("match"),kpi=qp("kpi");if(q)FILTER.q=q;if(view==="open")FILTER.state="";if(view==="waiting_client")FILTER.state="esperando_cliente";if(view==="urgent")FILTER.priority="urgente";if(state)FILTER.state=state;if(priority)FILTER.priority=priority;if(type)FILTER.type=type;if(clienteId){FILTER.clienteId=String(clienteId);const t=TK.find(x=>String(x?.cliente_id)===String(clienteId));FILTER.client=t?.clientes?.nombre||""}if(noClient==="1")FILTER.noClientLinked=true;if(match==="medio")FILTER.matchMedium=true;if(kpi==="urgent")FILTER.priority="urgente";if(kpi==="waiting")FILTER.state="esperando_cliente";if(kpi==="urgent_stale")FILTER.urgentStale=true;if(kpi==="resolved")FILTER.state="resuelto";if(kpi==="first_response_overdue")FILTER.frBreach=true;if(kpi==="sla_overdue")FILTER.rsBreach=true;syncFilterUI()};
const activeFilterLabel=()=>{if(FILTER.urgentStale)return"Urgentes sin tocar";if(FILTER.frBreach)return"Respuesta vencida";if(FILTER.rsBreach)return"SLA vencido";if(FILTER.slaSoon)return"SLA próximo";if(FILTER.priority==="urgente")return"Urgentes";if(FILTER.state==="esperando_cliente")return"En espera";if(FILTER.state==="resuelto")return"Resueltos";if(FILTER.q)return`Búsqueda: ${FILTER.q}`;if(FILTER.priority)return`Prioridad: ${FILTER.priority}`;if(FILTER.state)return`Estado: ${FILTER.state}`;return""};
const syncActiveFilterLabel=()=>{const el=$("#tkActiveFilter");if(!el)return;const label=activeFilterLabel();el.textContent=label?`Filtro activo · ${label}`:"";el.classList.toggle("hidden",!label)};
const tkClearFastFilters=()=>{FILTER.urgentStale=false;FILTER.frBreach=false;FILTER.rsBreach=false;FILTER.slaSoon=false};
const flipFilter=k=>{
  const fast=["urgentStale","frBreach","rsBreach","slaSoon"];
  const next=!FILTER[k];
  if(fast.includes(k)){
    tkClearFastFilters();
    FILTER.priority="";
    FILTER.state="";
    FILTER[k]=next;
  }else{
    FILTER[k]=next;
  }
  syncFilterUI();
  ensureSelectedVisible?.();
  renderAll();
  syncSelected?.();
  syncHeaderClearBtns?.();
  tkSyncFilterActiveUi?.();
};
const ticketBlob=t=>norm([t.titulo,t.descripcion,t.tipo,t.prioridad,t.estado,t.sistema,t.sistema_detectado,t.clientes?.nombre,t.empresa_capturada,t.nombre_capturado,t.correo_capturado,t.telefono_capturado,t.folio,t.token_publico,t.cliente_id,t.contacto_id].join(" | "));
const filtered=()=>TK.filter(t=>(!FILTER.q||ticketBlob(t).includes(norm(FILTER.q)))&&(!FILTER.priority||norm(t.prioridad)===norm(FILTER.priority))&&(!FILTER.state||ticketStateKey(rawState(t))===ticketStateKey(FILTER.state))&&(!FILTER.type||normTipo(t.tipo)===norm(FILTER.type))&&(!FILTER.clienteId||String(t?.cliente_id)===String(FILTER.clienteId))&&(!FILTER.client||norm(t.clientes?.nombre||t.empresa_capturada||"").includes(norm(FILTER.client)))&&(!FILTER.noEvidence||evidenceCount(t)===0)&&(!FILTER.impactHigh||impactKey(t)==="alta")&&(!FILTER.urgentStale||urgentStale(t))&&(!FILTER.noClientLinked||noClientLinked(t))&&(!FILTER.matchMedium||matchLevel(t)==="medio")&&(!FILTER.frBreach||slaFrBreached(t))&&(!FILTER.rsBreach||slaRsBreached(t))&&(!FILTER.slaSoon||slaSoon(t)));
const byId=id=>TK.find(x=>String(x.id)===String(id));
const board=()=>$("#tkBoard");
const openTicketDetail=(id,qk="")=>location.href=`ticket.html?id=${encodeURIComponent(id)}${qk?`&qk=${encodeURIComponent(qk)}`:""}`;
const syncSelected=()=>document.querySelectorAll(".k-card,.compact-row").forEach(x=>x.classList.toggle("is-selected",String(x.dataset.id)===String(SELECTED_ID)));
const visibleOpenRows=()=>filtered().filter(t=>ticketStateKey(rawState(t))!=="cerrado");
const ensureSelectedVisible=()=>{const rows=visibleOpenRows();if(!rows.length){SELECTED_ID="";return}if(!rows.some(x=>String(x.id)===String(SELECTED_ID)))SELECTED_ID=String(rows[0].id)};
const selectedTicket=()=>SELECTED_ID?byId(SELECTED_ID):null;
const quickActionText=(t,k)=>{
  const cliente=t?.empresa_capturada||t?.clientes?.nombre||"su negocio";/* B17C40: rename para ${cliente} */
  const sis=t?.sistema||t?.sistema_detectado||"el producto";
  if(k==="modelo")return`Para revisar ${sis} en ${cliente}, ¿podría compartir el modelo exacto de la máquina y, si lo tiene, el número de serie?`;
  if(k==="evidencia")return`Por favor comparta una foto clara y un video corto máximo de 20 segundos donde se vea ${sis}, el problema y la acción que está realizando.`;
  if(k==="garantia")return`Para validar garantía de ${sis}, por favor comparta comprobante de compra, fecha de compra, modelo y número de serie.`;
  if(k==="muestra")return`Para revisar ${sis}, por favor comparta foto de la muestra de puntada, tipo de tela, hilo usado, aguja instalada y ajuste de tensión.`;
  if(k==="horario")return`¿Podría compartir uno o dos horarios disponibles para revisar ${sis} en ${cliente}, así como el medio preferido de contacto?`;
  if(k==="solucion")return`Se aplicó ajuste / validación operativa en ${sis}. Favor de confirmar si la máquina ya opera correctamente.`;
  return"";
};
const copyText=async txt=>{try{await navigator.clipboard.writeText(txt);return true}catch{return false}};
const runQuickCopy=async(id,k)=>{const t=byId(id),txt=t?quickActionText(t,k):"";if(!txt)return toast("No se pudo preparar el texto.","bad");SELECTED_ID=String(id);syncSelected();QUICK.lastCopied=txt;QUICK.lastAction=k;fillQuickPanel(k);const ok=await copyText(txt);toast(ok?"Texto copiado.":"No se pudo copiar.","ok")};
const runQuickOpen=async(id,k)=>{const t=byId(id);if(!t)return;SELECTED_ID=String(id);syncSelected();const txt=quickActionText(t,k);QUICK.lastCopied=txt;QUICK.lastAction=k;fillQuickPanel(k);await renderBoardQuickDb(t);toast("Se preparó una acción rápida para este ticket.","ok")};
const quickPanelHtml=()=>`<div class="tk-quick-backdrop hidden" id="tkQuickBackdrop"></div><section class="tk-quick-panel hidden" id="tkQuickPanel" role="dialog" aria-modal="true" aria-labelledby="tkQuickTitle"><div class="tk-quick-head"><div><div class="tk-quick-titleline"><h3 id="tkQuickTitle">Respuesta rápida</h3><button class="tk-quick-edit" id="tkQuickEditBtn" type="button" title="Editar respuestas"><img src="../IMG/lapiz.webp" alt=""></button></div><p class="mut tk-quick-meta" id="tkQuickMeta">Seleccione un ticket para preparar la respuesta.</p></div><button class="icon-btn" type="button" id="tkQuickClose" aria-label="Cerrar">✕</button></div><div class="tk-quick-chips" id="tkQuickBtns"><button class="mini btn-ghost" type="button" data-qk="modelo">Pedir modelo</button><button class="mini btn-ghost" type="button" data-qk="evidencia">Pedir foto/video</button><button class="mini btn-ghost" type="button" data-qk="garantia">Pedir garantía</button><button class="mini btn-ghost" type="button" data-qk="muestra">Pedir muestra</button><button class="mini btn-ghost" type="button" data-qk="horario">Pedir horario</button><button class="mini btn-ghost" type="button" data-qk="solucion">Confirmar solución</button></div><div class="tk-quick-compose"><button class="tk-quick-clip" type="button" disabled aria-label="Adjuntar"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg></button><textarea class="tk-quick-input" id="tkQuickText" rows="3" placeholder="Escriba una respuesta rápida"></textarea><button class="tk-quick-send" id="tkQuickSendBtn" type="button" aria-label="Enviar"><img src="../IMG/enviar.png" alt="Enviar" onerror="this.style.display='none';this.parentNode.textContent='Enviar'"></button></div><p class="mut tk-quick-note" id="tkQuickStatus">Respuesta pública al cliente. Se guardará en el historial del ticket.</p></section>`;
const mountQuickPanel=()=>{if($("#tkQuickPanel"))return;document.body.insertAdjacentHTML("beforeend",quickPanelHtml())};

const setQuickPanelOpen=v=>{mountQuickPanel();const ta=$("#tkQuickText"),id=String(SELECTED_ID||"");if(!v&&ta){QUICK.draft=ta.value;QUICK.draftTicketId=id}QUICK.open=!!v;if(v&&ta&&QUICK.draft&&QUICK.draftTicketId===id&&!ta.value.trim())ta.value=QUICK.draft;$("#tkQuickPanel")?.classList.toggle("hidden",!QUICK.open);$("#tkQuickBackdrop")?.classList.toggle("hidden",!QUICK.open);document.body.classList.toggle("tk-quick-open",QUICK.open)};
const fillQuickPanel=(k="")=>{mountQuickPanel();const t=selectedTicket(),txt=t&&k?quickActionText(t,k):QUICK.lastCopied||"";if(!t){$("#tkQuickMeta")&&($("#tkQuickMeta").textContent="Selecciona un ticket para preparar una acción.");$("#tkQuickText")&&($("#tkQuickText").value="");$("#tkQuickDbBtns")&&($("#tkQuickDbBtns").innerHTML="");document.querySelectorAll("#tkQuickBtns [data-qk]").forEach(b=>b.classList.toggle("btn-brand",false));return setQuickPanelOpen(true)}if(k)QUICK.lastAction=k;if(txt)QUICK.lastCopied=txt;const cliente=t.clientes?.nombre||t.empresa_capturada||"Sin registro",folio=t.folio?`${t.folio} · `:"";$("#tkQuickMeta")&&($("#tkQuickMeta").textContent=`${folio}${cliente} · ${t.titulo||"Sin título"}`);$("#tkQuickText")&&($("#tkQuickText").value=txt||"");document.querySelectorAll("#tkQuickBtns [data-qk]").forEach(b=>b.classList.toggle("btn-brand",b.dataset.qk===QUICK.lastAction));setQuickPanelOpen(true);renderBoardQuickDb?.(t).catch?.(e=>console.warn("QR_FILL_DB_ERROR",e))};
const copyQuickPanelText=async()=>{const txt=$("#tkQuickText")?.value?.trim()||"";if(!txt)return toast("No hay texto para copiar.","warn");const ok=await copyText(txt);if(ok)QUICK.lastCopied=txt;toast(ok?"Texto copiado.":"No se pudo copiar.","ok")};
const quickReplyAction=()=>["modelo","evidencia","garantia","muestra","horario","solucion"].includes(QUICK.lastAction)?QUICK.lastAction:"modelo";

const quickContactName=t=>t?.nombre_capturado||"contacto";
const quickClientName=t=>t?.empresa_capturada||t?.clientes?.nombre||"empresa";
const QRB={mode:"seguimiento",scope:"global",rows:[]};let QRB_DEL_IDX=-1;
const tkProductKey=t=>String(t?.sistema||t?.sistema_detectado||"producto").toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"").slice(0,60)||"producto";
const tkProductStoreKey=t=>`tc_qr_producto_${tkProductKey(t)}`;
const tkProductDefaults=t=>[
  {titulo:"Pedir modelo",texto:"Para revisar {producto} en {cliente}, por favor compártenos modelo exacto de la máquina y número de serie si lo tienes."},
  {titulo:"Pedir foto/video",texto:"Por favor envía una foto clara y un video corto máximo de 20 segundos donde se vea {producto}, el problema y la acción que estás realizando."},
  {titulo:"Pedir muestra",texto:"Comparte una foto de la muestra de puntada, tipo de tela, hilo usado, aguja instalada y ajuste de tensión."},
  {titulo:"Pedir garantía",texto:"Para validar garantía de {producto}, comparte comprobante de compra, fecha de compra, modelo y número de serie."},
  {titulo:"Confirmar solución",texto:"Se aplicó ajuste / validación operativa en {producto}. Favor de confirmar si la máquina ya opera correctamente."}
];
const tkProductRows=t=>{try{const saved=JSON.parse(localStorage.getItem(tkProductStoreKey(t))||"[]");if(Array.isArray(saved)&&saved.length)return saved}catch{}return tkProductDefaults(t)};
const tkProductSave=(t,rows)=>localStorage.setItem(tkProductStoreKey(t),JSON.stringify((rows||[]).slice(0,10)));
const tkQrDelPend=idx=>{QRB_DEL_IDX=idx;const c=$("#tkQrConfirmModal");if(c)c.classList.remove("hidden")};
const tkQrDelCancel=()=>{QRB_DEL_IDX=-1;const c=$("#tkQrConfirmModal");if(c)c.classList.add("hidden")};
const tkQrDelConfirm=()=>{if(QRB_DEL_IDX<0)return;qrBoardCollect?.();QRB.rows.splice(QRB_DEL_IDX,1);QRB_DEL_IDX=-1;const c=$("#tkQrConfirmModal");if(c)c.classList.add("hidden");qrBoardPaint?.();tkFixQrText?.()};
const quickEditorHtml=()=>`<div class="tk-qr-editor hidden" id="tkQrEditor"><div class="tk-qr-box"><div class="tk-qr-head"><strong>Respuestas rápidas</strong><div class="tk-qr-tabs" role="tablist" aria-label="Tipo de respuestas"><button class="mini btn-ghost" type="button" data-board-qrscope="global">Globales</button><button class="mini btn-ghost" type="button" data-board-qrscope="producto">Producto</button></div><div class="tk-qr-head-end"><div class="tk-qr-vars-wrap"><button class="mini btn-ghost tk-qr-vars-btn" type="button" id="tkQrVarsBtn" aria-label="Variables disponibles" aria-expanded="false">{…}</button><div class="tk-qr-vars-pop hidden" id="tkQrVarsPop" role="tooltip"><strong class="tk-qr-vars-title">Variables disponibles</strong><div class="tk-qr-vars-row"><code>{cliente}</code><span>Cliente / negocio</span></div><div class="tk-qr-vars-row"><code>{producto}</code><span>Máquina, accesorio o producto</span></div><div class="tk-qr-vars-row"><code>{folio}</code><span>Folio del ticket</span></div><div class="tk-qr-vars-row"><code>{contacto}</code><span>Contacto</span></div></div></div><button class="icon-btn" id="tkQrClose" type="button" aria-label="Cerrar">✕</button></div></div><div class="tk-qr-columns-head" aria-hidden="true"><span>Título / intención</span><span>Mensaje de respuesta</span><span></span></div><div class="tk-qr-rows" id="tkQrBoardRows"></div><div class="tk-qr-foot"><button class="mini btn-ghost" type="button" id="tkQrBoardAdd">+ Agregar</button><button class="mini btn-brand" type="button" id="tkQrBoardSave">Guardar</button></div><p class="mut" id="tkQrBoardHint">Globales para todos los tickets. Producto para respuestas por máquina o accesorio.</p></div><div class="tk-qr-confirm-modal hidden" id="tkQrConfirmModal"><div class="tk-qr-confirm-dialog"><strong class="tk-qr-confirm-title">Borrar respuesta rápida</strong><p class="tk-qr-confirm-msg">¿Está seguro de borrar esta respuesta rápida?</p><div class="tk-qr-confirm-btns"><button class="mini btn-ghost" type="button" id="tkQrConfirmCancel">Cancelar</button><button class="mini btn-danger" type="button" id="tkQrConfirmOk">Borrar respuesta</button></div></div></div></div>`;
const mountQuickEditor=()=>{if(!$("#tkQrEditor"))document.body.insertAdjacentHTML("beforeend",quickEditorHtml());const ed=$("#tkQrEditor");if(ed&&!ed.dataset.qrEditorBound){ed.dataset.qrEditorBound="1";ed.addEventListener("click",e=>{if(e.target===ed)closeQuickEditor?.();else if(e.target===$("#tkQrConfirmModal"))tkQrDelCancel()})}};
const closeQuickEditor=()=>{tkQrDelCancel();const el=$("#tkQrEditor");if(el)el.classList.add("hidden")};
const qrBoardCollect=()=>{document.querySelectorAll("#tkQrBoardRows .tk-qr-row").forEach((row,i)=>{QRB.rows[i]={...(QRB.rows[i]||{}),titulo:row.querySelector("[data-k='titulo']")?.value?.trim()||`Respuesta ${i+1}`,texto:qrCanon(row.querySelector("[data-k='texto']")?.value?.trim()||""),orden:i+1}})};
const qrBoardPaint=()=>{QRB.rows=Array.isArray(QRB.rows)?QRB.rows.slice(0,10):[];document.querySelectorAll("[data-board-qrscope]").forEach(b=>b.classList.toggle("is-on",b.dataset.boardQrscope===QRB.scope));const box=$("#tkQrBoardRows");if(box)box.innerHTML=QRB.rows.map((r,i)=>`<div class="tk-qr-row" data-i="${i}"><input class="input" data-k="titulo" value="${tkAttr(r?.titulo||`Respuesta ${i+1}`)}" placeholder="Título" maxlength="80" autocomplete="off"><textarea class="area" data-k="texto" placeholder="Texto de respuesta" maxlength="1200">${tkEsc(r?.texto||"")}</textarea><button class="mini btn-ghost danger" type="button" data-board-qrdel="${i}" aria-label="Borrar" title="Borrar"><img src="../IMG/borrar.webp" alt=""></button></div>`).join("");queueMicrotask(()=>tkFixQrText?.())};
const withTimeout=(p,ms,label)=>Promise.race([p,new Promise((_,rej)=>setTimeout(()=>rej(new Error(label+" timeout")),ms))]);

let TK_ACTIVE_TOKEN="";
let TK_AUTH_CTX=null;
const tkAuthContext=async()=>{
  if(TK_AUTH_CTX)return TK_AUTH_CTX;
  const user=(await s.auth.getUser().catch(()=>({data:{user:null}})))?.data?.user;
  if(!user?.id)throw new Error("Sesión no activa. Inicia sesión.");
  const {data,error}=await s.from("perfiles").select("id,rol").eq("id",user.id).maybeSingle();
  if(error)throw new Error(`No se pudo determinar el rol: ${error.message||error.code||"error de perfiles"}`);
  const rol=norm(data?.rol||"soporte");
  TK_AUTH_CTX={userId:user.id,rol,isAdmin:rol==="admin"};
  registerInternalSearchProvider({sb:s,user,rol});
  window.__TC_ACCESS_CONTEXT=Object.freeze({...TK_AUTH_CTX});
  document.body.dataset.accessRole=TK_AUTH_CTX.isAdmin?"admin":"soporte";
  setAppRole(TK_AUTH_CTX.rol);
  const edit=$("#tkQuickEditBtn");
  if(edit)edit.hidden=!TK_AUTH_CTX.isAdmin;
  return TK_AUTH_CTX;
};
const tkSafeSession=async(ms=4500)=>withTimeout(s.auth.getSession(),ms,"getSession").catch(e=>({data:{session:null},error:e}));
const tkAuthKey=()=>Object.keys(localStorage).find(x=>/^sb-.+-auth-token$/.test(x))||"";
const tkStoredAuth=()=>{try{return JSON.parse(localStorage.getItem(tkAuthKey())||"{}")}catch{return{}}};
const tkSaveStoredAuth=o=>{const k=tkAuthKey();if(k)localStorage.setItem(k,JSON.stringify(o||{}))};
const tkJwtExp=t=>{try{return JSON.parse(atob(String(t).split(".")[1].replace(/-/g,"+").replace(/_/g,"/"))).exp||0}catch{return 0}};
const tkTokenFresh=t=>!!t&&tkJwtExp(t)>Math.floor(Date.now()/1000)+90;
const tkStoredToken=()=>{const o=tkStoredAuth();return o?.access_token||o?.currentSession?.access_token||o?.session?.access_token||""};
const tkStoredRefresh=()=>{const o=tkStoredAuth();return o?.refresh_token||o?.currentSession?.refresh_token||o?.session?.refresh_token||""};
const tkRefreshTokenDirect=async()=>{const refresh_token=tkStoredRefresh();if(!refresh_token)return"";try{const r=await fetch(`${s.supabaseUrl}/auth/v1/token?grant_type=refresh_token`,{method:"POST",headers:{apikey:s.supabaseKey,"Content-Type":"application/json"},body:JSON.stringify({refresh_token})}),txt=await r.text();if(!r.ok){console.warn("AUTH_REFRESH_DIRECT_ERROR",txt);return""}const j=JSON.parse(txt||"{}");if(!j?.access_token)return"";const merged={...tkStoredAuth(),...j,expires_at:Math.floor(Date.now()/1000)+Number(j.expires_in||3600)};tkSaveStoredAuth(merged);s.auth.setSession({access_token:j.access_token,refresh_token:j.refresh_token||refresh_token}).catch?.(()=>{});console.info("AUTH_TOKEN_REFRESHED_DIRECT");return j.access_token}catch(e){console.warn("AUTH_REFRESH_DIRECT_THROW",e);return""}};
const tkSessionToken=async(ms=1200)=>{if(tkTokenFresh(TK_ACTIVE_TOKEN))return TK_ACTIVE_TOKEN;const ss=await tkSafeSession(ms),a=ss?.data?.session?.access_token;if(tkTokenFresh(a))return TK_ACTIVE_TOKEN=a;const l=tkStoredToken();if(tkTokenFresh(l))return TK_ACTIVE_TOKEN=l;const r=await tkRefreshTokenDirect();return TK_ACTIVE_TOKEN=r||""};

const qrBoardLoad=async(scope="global")=>{const t=selectedTicket();if(!t)return toast("Selecciona un ticket.","warn");QRB.scope=scope==="producto"?"producto":"global";QRB.mode="seguimiento";try{if(QRB.scope==="producto"){QRB.rows=tkProductRows(t).map((x,i)=>({...x,texto:qrCanon(x?.texto||""),scope:"producto",modo:QRB.mode,orden:i+1}));while(QRB.rows.length<5)QRB.rows.push({id:"",scope:"producto",modo:QRB.mode,titulo:`Respuesta ${QRB.rows.length+1}`,texto:"",orden:QRB.rows.length+1});qrBoardPaint();$("#tkQrBoardHint")&&($("#tkQrBoardHint").textContent=`Producto: ${t?.sistema||t?.sistema_detectado||"producto"}. Estas respuestas se guardan localmente por ahora.`);return}QRB.rows=(await qrLoadScope({ticket:t,scope:"global",modo:QRB.mode,min:7,max:10})).map(x=>({...x,texto:qrCanon(x?.texto||"")}));qrBoardPaint();$("#tkQrBoardHint")&&($("#tkQrBoardHint").textContent="Globales para todos los tickets.")}catch(e){toast(msg(e),"bad")}};
const openQuickEditor=async()=>{if(!TK_AUTH_CTX?.isAdmin)return toast("Las respuestas Globales y de Producto son administradas por Administrador.","warn");mountQuickEditor();$("#tkQrEditor")?.classList.remove("hidden");await qrBoardLoad(QRB.scope||"global")};
const qrBoardSave=async()=>{if(!TK_AUTH_CTX?.isAdmin)return toast("Soporte no puede editar respuestas Globales ni de Producto.","warn");const t=selectedTicket();if(!t)return toast("Selecciona un ticket.","warn");qrBoardCollect();try{if(QRB.scope==="producto"){tkQuickProductSaveFinal?.(t,QRB.rows);toast("Respuestas de producto guardadas localmente.","ok");await renderBoardQuickDb(t);closeQuickEditor?.();return}await qrSaveScope({ticket:t,scope:"global",modo:QRB.mode,rows:QRB.rows});toast("Respuestas guardadas.","ok");await renderBoardQuickDb(t);closeQuickEditor?.()}catch(e){toast(msg(e),"bad")}};

const tkQuickScope=()=>QUICK.replyScope==="producto"?"producto":"global";
const tkQuickGlobalFallback=()=>[
  {titulo:"Pedir modelo",texto:"Hola, {contacto}. Para revisar {producto} en {cliente}, por favor compártenos el modelo exacto de la máquina y, si lo tienes, el número de serie."},
  {titulo:"Pedir foto/video",texto:"Hola, {contacto}. Por favor envía una foto clara y un video corto máximo de 20 segundos donde se vea {producto}, el problema y la acción que estás realizando."},
  {titulo:"Pedir garantía",texto:"Hola, {contacto}. Para validar garantía de {producto}, comparte comprobante de compra, fecha de compra, modelo y número de serie."},
  {titulo:"Pedir muestra",texto:"Hola, {contacto}. Para revisar {producto}, comparte una foto de la muestra de puntada, tipo de tela, hilo usado, aguja instalada y ajuste de tensión."},
  {titulo:"Pedir horario",texto:"Hola, {contacto}. Compártenos por favor uno o dos horarios disponibles para revisar {producto}, y el medio preferido de contacto para continuar."},
  {titulo:"Confirmar solución",texto:"Hola, {contacto}. Se aplicó ajuste / validación operativa en {producto}. Favor de confirmar si la máquina ya opera correctamente."},
  {titulo:"Marcar resuelto",texto:"Hola, {contacto}. Se registró solución para {producto}. El caso queda resuelto y puede reabrirse si el problema vuelve a presentarse."}
];
const tkQuickProductFallback=t=>[
  {titulo:"Puntada irregular",texto:"Hola, {contacto}. Para revisar la puntada en {producto}, comparte foto de la muestra, tipo de tela, hilo usado, aguja instalada y ajuste de tensión."},
  {titulo:"No cose / no avanza",texto:"Hola, {contacto}. Para revisar {producto}, confirma si la aguja sube y baja, si los dientes de arrastre se mueven y si el prensatelas está abajo."},
  {titulo:"Enhebrado / tensión",texto:"Hola, {contacto}. Por favor vuelve a enhebrar {producto} con el prensatelas arriba y comparte foto del recorrido del hilo y del ajuste de tensión."},
  {titulo:"Aguja e hilo",texto:"Hola, {contacto}. Confirma por favor calibre y tipo de aguja, tipo de hilo, tela utilizada y si la aguja es nueva o ya estaba instalada."},
  {titulo:"Accesorio compatible",texto:"Hola, {contacto}. Para validar compatibilidad, comparte modelo exacto de {producto}, foto del accesorio/refacción y, si aplica, número de parte."},
  {titulo:"Garantía Janome",texto:"Hola, {contacto}. Para validar garantía de {producto}, comparte comprobante de compra, fecha de compra, modelo, número de serie y video corto del comportamiento."},
  {titulo:"Mantenimiento",texto:"Hola, {contacto}. Para revisar mantenimiento de {producto}, indica cuándo fue el último servicio y qué síntoma aparece: ruido, atorón, tensión, puntada o avance."}
];
/* B17C40: una sola derivación de clave (tkProductKey). Antes había dos y el board guardaba con una clave y releía con otra. */
const tkQuickProductKey=t=>tkProductKey(t);
const tkQuickProductStored=t=>{
  try{
    const raw=localStorage.getItem("tc_qr_producto_"+tkQuickProductKey(t));
    const rows=raw?JSON.parse(raw):null;
    return Array.isArray(rows)&&rows.length?rows:null;
  }catch{return null}
};
const tkQuickProductSaveFinal=(t,rows)=>{
  try{
    localStorage.setItem("tc_qr_producto_"+tkQuickProductKey(t),JSON.stringify((rows||[]).slice(0,10)));
  }catch(e){console.warn("TK_PRODUCT_QR_SAVE_LOCAL_WARN",e)}
};
const tkEnsureQuickScopeUi=()=>{
  mountQuickPanel?.();
  const panel=$("#tkQuickPanel"),chips=$("#tkQuickBtns");
  if(!panel||!chips)return;
  chips.classList.add("tk-quick-native-hidden");
  if(!$("#tkQuickScopeTabs")){
    chips.insertAdjacentHTML("beforebegin",`<div class="tk-quick-scope-tabs" id="tkQuickScopeTabs" role="tablist" aria-label="Tipo de respuesta rápida"><button class="mini btn-ghost" type="button" data-quick-scope="global">Globales</button><button class="mini btn-ghost" type="button" data-quick-scope="producto">Producto</button></div>`);
  }
  if(!$("#tkQuickDbBtns")){
    chips.insertAdjacentHTML("afterend",`<div class="tk-pillbar tk-quick-db-pills" id="tkQuickDbBtns" aria-label="Respuestas disponibles"></div>`);
  }
  tkRelayoutQuickPanelFinal?.();
  const scope=tkQuickScope();
  document.querySelectorAll("[data-quick-scope]").forEach(b=>{
    const on=(b.dataset.quickScope||"global")===scope;
    b.classList.toggle("btn-brand",on);
    b.classList.toggle("is-active",on);
    b.setAttribute("aria-selected",on?"true":"false");
  });
};
const renderBoardQuickDb=async(ticket=null)=>{
  QUICK.dbRows=[];
  tkEnsureQuickScopeUi();
  const box=$("#tkQuickDbBtns"),t=ticket||selectedTicket?.();
  if(!box)return;
  if(!t){
    box.innerHTML=`<span class="mut tk-quick-empty">Selecciona un ticket.</span>`;
    return;
  }
  const scope=tkQuickScope();
  let rows=[];
  try{
    if(scope==="producto"){
      rows=tkQuickProductStored(t)||tkQuickProductFallback(t);
    }else{
      rows=await qrLoadScope({ticket:t,scope:"global",modo:"seguimiento",min:7,max:10});
      if(!Array.isArray(rows)||!rows.length)rows=tkQuickGlobalFallback();
    }
  }catch(e){
    console.warn("TK_QUICK_ROWS_FALLBACK",e);
    rows=scope==="producto"?tkQuickProductFallback(t):tkQuickGlobalFallback();
  }
  QUICK.dbRows=(rows||[]).filter(x=>String(x?.titulo||x?.texto||"").trim()).slice(0,10);
  box.innerHTML=QUICK.dbRows.length
    ? QUICK.dbRows.map((r,i)=>`<button class="mini btn-ghost" type="button" data-board-qri="${i}" data-board-qrtext="${tkAttr(r.texto||"")}" title="${tkAttr(r.texto||"")}">${tkEsc(r.titulo||`Respuesta ${i+1}`)}</button>`).join("")
    : `<span class="mut tk-quick-empty">Sin respuestas ${scope==="producto"?"de producto":"globales"}.</span>`;
  $("#tkQuickStatus")&&($("#tkQuickStatus").textContent=scope==="producto"?"Respuestas del producto seleccionado. Se guardan localmente por máquina/producto.":"Respuestas globales para el equipo. Se guardarán en el historial al enviar.");
  tkEnsureQuickScopeUi();
};
const tkWireQuickScopeTabsV2=()=>{
  if(document.documentElement.dataset.tkQuickScopeTabsV2)return;
  document.documentElement.dataset.tkQuickScopeTabsV2="1";
  document.addEventListener("click",e=>{
    const b=e.target?.closest?.("[data-quick-scope]");
    if(!b)return;
    e.preventDefault();
    e.stopPropagation();
    QUICK.replyScope=b.dataset.quickScope==="producto"?"producto":"global";
    renderBoardQuickDb(selectedTicket?.()).then(()=>{
      const first=$("#tkQuickDbBtns [data-board-qri]");
      if(first)first.click();
    }).catch(err=>console.warn("TK_QUICK_SCOPE_RENDER_ERROR",err));
  },true);
};
tkWireQuickScopeTabsV2();


/* QR_BOARD_PICK_HANDLER_2G */
document.addEventListener("click",e=>{
  const b=e.target?.closest?.("[data-board-qri]");
  if(!b)return;
  const i=Number(b.dataset.boardQri||0);
  const row=QUICK.dbRows?.[i];
  const t=selectedTicket();
  if(!row||!t)return;
  const txt=qrTpl(row.texto||"",t);
  QUICK.lastCopied=txt;
  const ta=$("#tkQuickText");
  if(ta)ta.value=txt;
  document.querySelectorAll("[data-board-qri]").forEach(x=>x.classList.toggle("btn-brand",x===b));
},true);

const TK_ORDER_KEY="tc_tickets_order_mode";
const tkOrderMode=()=>localStorage.getItem(TK_ORDER_KEY)||"chrono";
const tkChronoSort=(a,b)=>createdMs(b)-createdMs(a)||updatedMs(b)-updatedMs(a);
const tkSmartSort=(a,b)=>(isNewTicket(b)-isNewTicket(a))||triageScore(b)-triageScore(a)||updatedMs(b)-updatedMs(a)||createdMs(b)-createdMs(a);
const tkSortRows=a=>(a||[]).sort(tkOrderMode()==="smart"?tkSmartSort:tkChronoSort);
const tkSyncOrderControls=()=>{document.body.dataset.ticketOrder=tkOrderMode();document.querySelectorAll("[data-tk-order]").forEach(b=>b.classList.toggle("is-on",b.dataset.tkOrder===tkOrderMode()))};

const qrBoardRestRows=async(t,modo="seguimiento",limit=10)=>{const sessionToken=await tkSessionToken();if(!sessionToken)throw new Error("Sesión expirada. Vuelve a iniciar sesión.");const h={apikey:s.supabaseKey,Authorization:`Bearer ${sessionToken}`,"Content-Type":"application/json"},base=`${s.supabaseUrl}/rest/v1/ticket_respuestas_rapidas`,common={select:"id,scope,modo,titulo,texto,orden,activo,cliente_id,contacto_id",activo:"eq.true",modo:`eq.${modo}`,order:"orden.asc",limit:String(limit)},get=async extra=>{const u=new URL(base);Object.entries({...common,...extra}).forEach(([k,v])=>u.searchParams.set(k,v));const r=await fetch(u,{headers:h}),txt=await r.text();if(!r.ok)throw new Error(txt);return JSON.parse(txt||"[]")};let rows=await get({scope:"eq.global",cliente_id:"is.null",contacto_id:"is.null"});if(t?.cliente_id)rows=rows.concat(await get({scope:"eq.cliente",cliente_id:`eq.${t.cliente_id}`,contacto_id:"is.null"}));if(t?.cliente_id&&t?.contacto_id)rows=rows.concat(await get({scope:"eq.contacto",cliente_id:`eq.${t.cliente_id}`,contacto_id:`eq.${t.contacto_id}`}));const o={global:1,cliente:2,contacto:3};return rows.sort((a,b)=>(o[a.scope]||9)-(o[b.scope]||9)||(a.orden||0)-(b.orden||0)).slice(0,limit)};
/* P0 stored-XSS: los datos persistidos nunca entran crudos a templates HTML.
   Texto y atributos conservan helpers separados para no confundir contratos. */
const htmlText=v=>String(v??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[ch]);
const htmlAttr=v=>String(v??"").replace(/[\u0000-\u001f\u007f]/g,"").replace(/[&<>"'`]/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;","`":"&#96;"})[ch]);
const ticketDomId=v=>{const id=String(v??"").trim();return/^[A-Za-z0-9_-]{1,128}$/.test(id)?id:""};
const ticketActionFallback='<span class="mut">ID no disponible</span>';
const TK_COL_LABEL={abierto:"Abiertos",en_proceso:"En proceso",resuelto:"Resueltos"},TK_COL_MODAL={key:"abierto",page:0,size:10,q:""};
const tkColRows=()=>{const rows=filtered().filter(t=>ticketStateKey(rawState(t))!=="cerrado"),cols={abierto:[],en_proceso:[],resuelto:[]};rows.forEach(t=>{const k=ticketStateKey(rawState(t));if(k==="resuelto")cols.resuelto.push(t);else if(k==="en_proceso"||k==="esperando_cliente")cols.en_proceso.push(t);else cols.abierto.push(t)});Object.keys(cols).forEach(k=>tkSortRows(cols[k]));return cols};
const tkColHeader=(k,n)=>{const h=$("#col-"+k)?.closest(".kanban-col")?.querySelector(".col-header");if(!h)return;h.innerHTML=`<button class="tk-col-total" type="button" data-col-modal="${k}" title="Ver todos"><span>${TK_COL_LABEL[k]||k}</span><b id="count-${k}">${n||0}</b></button>`};
const tkColModalHtml=()=>`<div class="overlay tk-col-overlay" id="tkColModal" hidden><div class="modal tk-col-modal"><div class="tk-col-modal-top"><div class="tk-col-modal-copy"><h3 id="tkColModalTitle">Tickets</h3></div><div class="searchbox tk-col-modal-search"><span>🔎</span><input id="tkColModalSearch" type="search" placeholder="Buscar en esta categoría" autocomplete="off" autocorrect="off" spellcheck="false"></div><button class="icon-btn tk-col-modal-close" id="tkColModalClose" type="button" aria-label="Cerrar">✕</button></div><div class="tk-col-modal-results"><div class="tk-col-modal-rows" id="tkColModalRows"></div></div><div class="tk-col-modal-foot"><div class="tk-closed-total" id="tkColModalTotal">Total: 0 tickets</div><div class="tk-closed-pager"><button class="tk-closed-pagebtn" id="tkColModalPrev" type="button">‹</button><span class="tk-closed-pageinfo" id="tkColModalPage">0/0</span><button class="tk-closed-pagebtn" id="tkColModalNext" type="button">›</button></div></div></div></div>`;
const tkMountColModal=()=>{if(!$("#tkColModal"))document.body.insertAdjacentHTML("beforeend",tkColModalHtml())};
const tkOpenColModal=k=>{tkMountColModal();TK_COL_MODAL.key=["abierto","en_proceso","resuelto"].includes(k)?k:"abierto";TK_COL_MODAL.page=0;TK_COL_MODAL.q="";const s=$("#tkColModalSearch");if(s)s.value="";const m=$("#tkColModal");if(m){m.hidden=false;m.classList.add("open")}document.body.classList.add("modal-open");tkRenderColModal()};
const tkCloseColModal=()=>{const m=$("#tkColModal");if(m){m.hidden=true;m.classList.remove("open")}document.body.classList.remove("modal-open")};
const tkRenderColModal=()=>{const all=tkColRows()[TK_COL_MODAL.key]||[],q=(TK_COL_MODAL.q||"").toLowerCase().trim(),rows=q?all.filter(t=>[t.empresa_capturada,t.clientes?.nombre,t.folio,t.titulo,t.descripcion,t.prioridad,rawState(t)].some(v=>String(v||"").toLowerCase().includes(q))):all,pages=Math.max(1,Math.ceil(rows.length/TK_COL_MODAL.size));TK_COL_MODAL.page=Math.max(0,Math.min(TK_COL_MODAL.page,pages-1));const start=TK_COL_MODAL.page*TK_COL_MODAL.size,shown=rows.slice(start,start+TK_COL_MODAL.size);$("#tkColModalTitle")&&($("#tkColModalTitle").textContent=`${TK_COL_LABEL[TK_COL_MODAL.key]} · ${rows.length}`);$("#tkColModalRows")&&($("#tkColModalRows").innerHTML=shown.length?shown.map(tkColModalRow).join(""):`<div class="empty-state">Sin tickets.</div>`);$("#tkColModalTotal")&&($("#tkColModalTotal").textContent=`Total: ${rows.length} ticket${rows.length===1?"":"s"}`);$("#tkColModalPage")&&($("#tkColModalPage").textContent=rows.length?`${TK_COL_MODAL.page+1}/${pages}`:"0/0");$("#tkColModalPrev")&&($("#tkColModalPrev").disabled=TK_COL_MODAL.page<=0);$("#tkColModalNext")&&($("#tkColModalNext").disabled=!rows.length||TK_COL_MODAL.page>=pages-1);syncSelected()};
const tkColModalRow=t=>{
  const ev=evidenceCount(t),
    id=ticketDomId(t.id),
    state=ticketStateKey(rawState(t)),
    cliente=htmlText(fmtCardText(t.empresa_capturada||t.clientes?.nombre||"Sin registro")),
    folio=htmlText(t.folio||"—"),
    cre=closedMiniDate(t.fecha_creacion||t.created_at),
    upd=closedMiniDate(t.fecha_actualizacion||t.updated_at||t.fecha_creacion||t.created_at),
    titulo=htmlText(fmtCardText(t.titulo||"Sin título")),
    desc=htmlText(fmtCardText((t.descripcion||"Sin descripción").slice(0,118))),
    acts=!id?ticketActionFallback:state==="abierto"
      ?`<button class="mini btn-ghost is-disabled" type="button" disabled>←</button><button class="mini btn-ghost" type="button" data-ticket-state="${htmlAttr(id)}|en_proceso">→</button>`
      :state==="en_proceso"||state==="esperando_cliente"
        ?`<button class="mini btn-ghost" type="button" data-ticket-state="${htmlAttr(id)}|abierto">←</button><button class="mini btn-ghost" type="button" data-ticket-state="${htmlAttr(id)}|resuelto">→</button>`
        :state==="resuelto"
          ?`<button class="mini btn-ghost" type="button" data-ticket-state="${htmlAttr(id)}|en_proceso">←</button><button class="mini btn-ok" type="button" data-ticket-close="${htmlAttr(id)}">✓</button>`
          :`<button class="mini btn-ghost" type="button" data-ticket-state="${htmlAttr(id)}|en_proceso">↺</button>`;
  return`<div class="tk-col-modal-row${id&&id===String(SELECTED_ID)?" is-selected":""}" data-id="${htmlAttr(id)}" data-open-ticket="${htmlAttr(id)}">
    <div class="closed-priority"><span class="tag ${ticketPriorityCls(t.prioridad)}">${htmlText(t.prioridad||"media")}</span></div>
    <div class="closed-client"><strong>${cliente}</strong><span>${folio}</span></div>
    <div class="closed-case"><strong>${titulo}${ev?` <span class="closed-clip">📎</span>`:""}</strong><span>${desc}</span></div>
    <div class="closed-dates tk-col-dates-pair">
      <div class="closed-datebox"><small>Creado</small><strong>${htmlText(cre.day)}</strong><span>${htmlText(cre.mon)}</span></div>
      <div class="closed-datebox"><small>Actualizado</small><strong>${htmlText(upd.day)}</strong><span>${htmlText(upd.mon)}</span></div>
    </div>
    <div class="tk-col-modal-acts"><div class="tk-col-arrows">${acts}</div>${id?`<button class="mini btn-ghost k-action-bolt" type="button" data-quick-panel="${htmlAttr(id)}|modelo" title="Acciones rápidas">⚡</button>`:""}</div>
  </div>`;
};

const mobileStateSet=(k,{historyMode="push"}={})=>{
  const next=["abierto","en_proceso","resuelto"].includes(k)?k:"abierto";
  MOBILE_STATE=next;
  localStorage.setItem("tc_tickets_mobile_state",next);
  if(document.body)document.body.dataset.mobileState=next;
  const url=new URL(location.href);
  url.searchParams.set("column",next);
  const state={...(history.state||{}),mobileState:next};
  if(historyMode==="replace")history.replaceState(state,"",url);
  else if(url.href!==location.href)history.pushState(state,"",url);
  renderAll?.();
};

const bindMobileHistory=()=>{if(document.documentElement.dataset.tkMobileHistoryBound)return;document.documentElement.dataset.tkMobileHistoryBound="1";history.replaceState({...(history.state||{}),mobileState:MOBILE_STATE},"",location.href);window.addEventListener("popstate",e=>{const q=new URLSearchParams(location.search).get("column"),next=["abierto","en_proceso","resuelto"].includes(e.state?.mobileState)?e.state.mobileState:["abierto","en_proceso","resuelto"].includes(q)?q:"abierto";MOBILE_STATE=next;localStorage.setItem("tc_tickets_mobile_state",next);if(document.body)document.body.dataset.mobileState=next;renderAll?.()})};

const bindMobileTabKeyboard=()=>{if(document.documentElement.dataset.tkMobileTabsKeyboardBound)return;document.documentElement.dataset.tkMobileTabsKeyboardBound="1";document.addEventListener("keydown",e=>{const btn=e.target?.closest?.("#tkMobileStatebar [data-mobile-state]");if(!btn)return;const keys={ArrowRight:1,ArrowDown:1,ArrowLeft:-1,ArrowUp:-1};let next="";if(e.key in keys){const i=mobileStateBuckets.indexOf(btn.dataset.mobileState);next=mobileStateBuckets[(i+keys[e.key]+mobileStateBuckets.length)%mobileStateBuckets.length]}else if(e.key==="Home")next=mobileStateBuckets[0];else if(e.key==="End")next=mobileStateBuckets.at(-1);else return;e.preventDefault();e.stopPropagation();mobileStateSet(next);requestAnimationFrame(()=>document.querySelector(`#tkMobileStatebar [data-mobile-state="${next}"]`)?.focus())},true)};

const bindMobileSwipe=()=>{if(document.documentElement.dataset.tkSwipeBound)return;document.documentElement.dataset.tkSwipeBound="1";let sx=0,sy=0,st=0;document.addEventListener("touchstart",e=>{const t=e.target;if(!isMobileTickets()||tkSurfaceOpen?.()||t.closest("button,a,input,select,textarea,label,.tk-filter-pop,.tickets-gear-menu,.tk-quick-panel,.tk-qr-editor,#tkModal,#tkClosedModal"))return;const p=e.touches?.[0];if(!p)return;sx=p.clientX;sy=p.clientY;st=Date.now()},{passive:true,capture:true});document.addEventListener("touchend",e=>{if(!isMobileTickets()||tkSurfaceOpen?.()||!sx)return;const p=e.changedTouches?.[0];if(!p)return;const dx=p.clientX-sx,dy=p.clientY-sy,fast=Date.now()-st<650;sx=sy=st=0;if(!fast||Math.abs(dx)<54||Math.abs(dx)<Math.abs(dy)*1.25)return;e.preventDefault?.();e.stopImmediatePropagation?.();mobileStateStep(dx<0?1:-1)},{passive:false,capture:true})};



const mobileStateBuckets=["abierto","en_proceso","resuelto"];

const mobileStateStep=dir=>{
  const i=Math.max(0,mobileStateBuckets.indexOf(MOBILE_STATE));
  const next=mobileStateBuckets[Math.max(0,Math.min(mobileStateBuckets.length-1,i+(dir||0)))]||"abierto";
  mobileStateSet(next);
};

const mountMobileStateTabs=()=>{
  const existing=document.querySelector("#tkMobileStatebar");

  if(!isMobileTickets()){
    existing?.remove?.();
    return;
  }

  const target=document.querySelector(".board-layout")||document.querySelector("#tkBoard")?.parentElement;
  if(!target)return;

  if(!existing){
    target.insertAdjacentHTML("beforebegin",`<div class="tk-mobile-statebar" id="tkMobileStatebar" role="tablist" aria-label="Estados de tickets">
      <button class="seg" type="button" data-mobile-state="abierto"><span>Abiertos</span><b id="tkMobCount-abierto">0</b></button>
      <button class="seg" type="button" data-mobile-state="en_proceso"><span>En proceso</span><b id="tkMobCount-en_proceso">0</b></button>
      <button class="seg" type="button" data-mobile-state="resuelto"><span>Resueltos</span><b id="tkMobCount-resuelto">0</b></button>
    </div>`);
  }

  const rows=filtered().filter(t=>ticketStateKey(rawState(t))!=="cerrado");
  const counts={
    abierto:rows.filter(t=>ticketStateKey(rawState(t))==="abierto").length,
    en_proceso:rows.filter(t=>["en_proceso","esperando_cliente"].includes(ticketStateKey(rawState(t)))).length,
    resuelto:rows.filter(t=>ticketStateKey(rawState(t))==="resuelto").length
  };

  Object.entries(counts).forEach(([k,v])=>{
    const el=document.querySelector(`#tkMobCount-${k}`);
    if(el)el.textContent=String(v);
  });

  document.querySelectorAll("#tkMobileStatebar [data-mobile-state]").forEach(btn=>{
    btn.classList.toggle("is-active",btn.dataset.mobileState===MOBILE_STATE);
    btn.setAttribute("role","tab");
    btn.setAttribute("aria-selected",btn.dataset.mobileState===MOBILE_STATE?"true":"false");
    btn.tabIndex=btn.dataset.mobileState===MOBILE_STATE?0:-1;
  });
};


const syncMobileStateTabs=cols=>{
  if(!["abierto","en_proceso","resuelto"].includes(MOBILE_STATE)){
    MOBILE_STATE="abierto";
    try{localStorage.setItem("tc_tickets_mobile_state","abierto")}catch{}
  }

  if(document.body)document.body.dataset.mobileState=MOBILE_STATE;

  document.querySelectorAll("#tkMobileStatebar [data-mobile-state]").forEach(btn=>{
    btn.classList.toggle("is-active",btn.dataset.mobileState===MOBILE_STATE);
    btn.setAttribute("aria-selected",btn.dataset.mobileState===MOBILE_STATE?"true":"false");
    btn.tabIndex=btn.dataset.mobileState===MOBILE_STATE?0:-1;
  });

  const count=(k)=>Array.isArray(cols?.[k])?cols[k].length:0;
  ["abierto","en_proceso","resuelto"].forEach(k=>{
    const n=String(count(k));
    const a=document.querySelector(`#tkMobCount-${k}`);
    const b=document.querySelector(`#mobCount-${k}`);
    if(a)a.textContent=n;
    if(b)b.textContent=n;
  });
};

const applyBoardOrder=()=>{localStorage.removeItem("tc_tickets_col_order")};

const KPI_EXPANDED=()=>(localStorage.getItem("tc_tickets_kpi_more"))==="1";
const setKpiExpanded=v=>{localStorage.setItem("tc_tickets_kpi_more",v?"1":"0")};
const pageSlice=(arr,key)=>{const p=COL_PAGE[key]||0;return(arr||[]).slice(p*COL_PAGE_SIZE,(p+1)*COL_PAGE_SIZE)};
const pageCount=arr=>Math.max(1,Math.ceil((arr?.length||0)/COL_PAGE_SIZE));
const clampPage=(key,total)=>{const max=Math.max(0,pageCount(total)-1);if((COL_PAGE[key]||0)>max)COL_PAGE[key]=max};
const renderPager=(key,total)=>{$("#info-"+key)&&($("#info-"+key).textContent=`${(COL_PAGE[key]||0)+1}/${pageCount(total)}`);$("#prev-"+key)&&($("#prev-"+key).disabled=(COL_PAGE[key]||0)<=0);$("#next-"+key)&&($("#next-"+key).disabled=(COL_PAGE[key]||0)>=pageCount(total)-1);const _pc=pageCount(total);const _pg=$("#pager-"+key);if(_pg)_pg.classList.toggle("hidden",_pc<=1)};
const setCompactGroup=g=>{COMPACT_GROUP=["abierto","en_proceso","resuelto"].includes(g)?g:"abierto";COMPACT_PAGE=0;localStorage.setItem("tc_tickets_compact_group",COMPACT_GROUP);localStorage.setItem("tc_tickets_compact_page","0")};
const compactRowsBase=()=>filtered().filter(t=>ticketStateKey(rawState(t))!=="cerrado");
const compactGroups=()=>{const rows=compactRowsBase();return{abierto:tkSortRows(rows.filter(t=>ticketStateKey(rawState(t))==="abierto")),en_proceso:tkSortRows(rows.filter(t=>["en_proceso","esperando_cliente"].includes(ticketStateKey(rawState(t))))),resuelto:tkSortRows(rows.filter(t=>ticketStateKey(rawState(t))==="resuelto"))}};
const compactModeTabsHtml=()=>`<div class="tk-compact-switch" id="tkCompactSwitch"><button class="seg" type="button" data-compact-group="abierto"><span>Abiertos</span><b id="tkCompactCount-abierto">0</b></button><button class="seg" type="button" data-compact-group="en_proceso"><span>En proceso</span><b id="tkCompactCount-en_proceso">0</b></button><button class="seg" type="button" data-compact-group="resuelto"><span>Resueltos</span><b id="tkCompactCount-resuelto">0</b></button></div>`;
const mountCompactModeTabs=()=>{const box=$("#tkCompact");if(!box)return;if(!$("#tkCompactSwitch"))box.insertAdjacentHTML("afterbegin",compactModeTabsHtml());document.querySelectorAll("#tkCompactSwitch [data-compact-group]").forEach(b=>{b.onclick=e=>{e.preventDefault();e.stopImmediatePropagation?.();setCompactGroup(b.dataset.compactGroup||"abierto");renderCompact();bindCompactUi?.()}});if(!$("#tkCompactPager"))box.insertAdjacentHTML("beforeend",`<div class="tk-compact-pager" id="tkCompactPager"></div>`)};
const compactPageCount=rows=>Math.max(1,Math.ceil((rows?.length||0)/COMPACT_PAGE_SIZE));
const compactPageRows=rows=>{const total=compactPageCount(rows),safe=Math.max(0,Math.min(COMPACT_PAGE||0,total-1));COMPACT_PAGE=safe;localStorage.setItem("tc_tickets_compact_page",String(safe));const start=safe*COMPACT_PAGE_SIZE;return rows.slice(start,start+COMPACT_PAGE_SIZE)};
const syncCompactTabs=groups=>{["abierto","en_proceso","resuelto"].forEach(k=>{$("#tkCompactCount-"+k)&&($("#tkCompactCount-"+k).textContent=String(groups?.[k]?.length||0))});document.querySelectorAll("#tkCompactSwitch [data-compact-group]").forEach(b=>b.classList.toggle("is-active",b.dataset.compactGroup===COMPACT_GROUP))};
const renderCompactPager=rows=>{const pages=compactPageCount(rows),page=(COMPACT_PAGE||0)+1;$("#tkCompactPager")&&($("#tkCompactPager").innerHTML=`<div class="cp-total">Total: ${rows.length} ticket${rows.length===1?"":"s"}</div><div class="cp-nav"><button class="cp-btn" id="tkCompactPrev" type="button" ${(COMPACT_PAGE||0)<=0?"disabled":""}>‹</button><div class="cp-page">${rows.length?page:0}/${rows.length?pages:0}</div><button class="cp-btn" id="tkCompactNext" type="button" ${!rows.length||(COMPACT_PAGE||0)>=pages-1?"disabled":""}>›</button></div>`)};
const markTicketsToolbar=()=>{$("#tkSearch")&&($("#tkSearch").placeholder="Busca por empresa, caso");$("#tkNewBtn")?.classList.remove("btn-brand");ensureMobileClearBtn?.()};

const closedSince=()=>{const d=new Date(),r=CLOSED.range;if(r==="all")return null;if(r==="30d"){const x=new Date(d);x.setDate(x.getDate()-30);return x.getTime()}const m=r==="3m"?3:r==="6m"?6:12,x=new Date(d);x.setMonth(x.getMonth()-m);return x.getTime()};
const closedDate=t=>new Date(t?.fecha_cierre||t?.fecha_actualizacion||t?.fecha_creacion||0).getTime()||0;
const closedBlob=t=>norm([t?.empresa_capturada,t?.clientes?.nombre,t?.nombre_capturado,t?.correo_capturado,t?.folio,t?.titulo,t?.descripcion].join(" | "));
const closedFiltered=()=>{const since=closedSince(),q=norm(CLOSED.q||"");return TK.filter(t=>ticketStateKey(rawState(t))==="cerrado").filter(t=>!since||closedDate(t)>=since).filter(t=>!q||closedBlob(t).includes(q)).sort((a,b)=>closedDate(b)-closedDate(a))};
const closedTotalPages=rows=>Math.max(1,Math.ceil((rows?.length||0)/(CLOSED.pageSize||20)));
const closedPaged=rows=>{const total=closedTotalPages(rows);CLOSED.page=Math.max(0,Math.min(CLOSED.page||0,total-1));const start=(CLOSED.page||0)*(CLOSED.pageSize||20);return rows.slice(start,start+(CLOSED.pageSize||20))};
const syncClosedUI=()=>{document.querySelectorAll("[data-closed-range]").forEach(b=>b.classList.toggle("is-active",b.dataset.closedRange===CLOSED.range));$("#tkClosedQ")&&($("#tkClosedQ").value=CLOSED.q||"")};
const closedMiniDate=v=>{const d=v?new Date(v):null;if(!d||Number.isNaN(d.getTime()))return{day:"—",mon:"—"};return{day:String(d.getDate()).padStart(2,"0"),mon:d.toLocaleDateString("es-MX",{month:"short"}).replace(".","").toUpperCase()}};
const closedRow=t=>{const ev=evidenceCount(t),id=ticketDomId(t.id),cliente=htmlText(fmtCardText(t.empresa_capturada||t.clientes?.nombre||"Sin registro")),folio=htmlText(t.folio||"—"),cre=closedMiniDate(t.fecha_creacion||t.created_at),cer=closedMiniDate(t.fecha_cierre||t.fecha_actualizacion),desde=String(t.desde_cuando||"").trim(),cambio=String(t.ultimo_cambio||""),dias=daysSince(t.fecha_actualizacion||t.fecha_creacion),ctx=[desde?`Desde: ${desde}`:"",cambio&&cambio!=="sin_cambio"&&cambio!=="no_se"?"Cambio previo":"",dias===0?"Hoy":`Sin avance ${dias}d`].filter(Boolean);return`<div class="closed-row" data-id="${htmlAttr(id)}"><div class="closed-priority"><span class="tag ${ticketPriorityCls(t.prioridad)}">${htmlText(t.prioridad||"media")}</span></div><div class="closed-client"><strong>${cliente}</strong><span>${folio}</span></div><div class="closed-case"><strong>${htmlText(t.titulo||"Sin título")}${ev?` <span class="closed-clip">📎</span>`:""}</strong><span>${htmlText(String(t.descripcion||"Sin descripción").slice(0,120))}</span></div><div class="closed-context">${ctx.map(x=>`<span>${htmlText(x)}</span>`).join("")}</div><div class="closed-dates"><div class="closed-datebox"><small>Creado</small><strong>${htmlText(cre.day)}</strong><span>${htmlText(cre.mon)}</span></div><div class="closed-datebox is-close"><small>Cerrado</small><strong>${htmlText(cer.day)}</strong><span>${htmlText(cer.mon)}</span></div></div></div>`};
const renderClosed=()=>{const rows=closedFiltered(),pageRows=closedPaged(rows),pages=closedTotalPages(rows),info=rows.length?`${(CLOSED.page||0)+1}/${pages}`:"0/0";syncClosedUI();$("#tkClosedRows")&&($("#tkClosedRows").innerHTML=pageRows.length?pageRows.map(closedRow).join(""):`<div class="empty-state">Sin tickets cerrados para este filtro.</div>`);$("#tkClosedTotal")&&($("#tkClosedTotal").textContent=`Total: ${rows.length} ticket${rows.length===1?"":"s"}`);$("#tkClosedPageInfo")&&($("#tkClosedPageInfo").textContent=info);$("#tkClosedPrev")&&($("#tkClosedPrev").disabled=(CLOSED.page||0)<=0);$("#tkClosedNext")&&($("#tkClosedNext").disabled=!rows.length||(CLOSED.page||0)>=pages-1)};

const openClosedModal=()=>{closeTicketFloaters?.();document.body.classList.remove("tk-toolbar-popup-open");$("#tkToolbarPopupBackdrop")?.classList.remove("open");$("#tkToggleClosed")?.setAttribute("aria-expanded","true");/* B2.7-O: abrir Cerrados debe cerrar backdrop toolbar */const m=$("#tkClosedModal");if(!m)return toast("Falta #tkClosedModal en tickets.html.","bad");m.hidden=false;document.body.classList.add("modal-open");renderClosed()};
const closeClosedModal=()=>{$("#tkClosedModal")&&(($("#tkClosedModal").hidden=true),document.body.classList.remove("modal-open"))};



const openCount=arr=>(arr||[]).filter(t=>ticketStateKey(rawState(t))!=="cerrado").length;
const notifyTone=(hz=880,ms=120,delay=0,type="sine")=>setTimeout(()=>{try{const A=window.AudioContext||window.webkitAudioContext;if(!A)return;const a=new A(),o=a.createOscillator(),g=a.createGain();o.type=type;o.frequency.value=hz;g.gain.value=Math.max(.025,Number(BOARD_NOTIF.volume||.5)*.11);o.connect(g);g.connect(a.destination);o.start();setTimeout(()=>{try{o.stop();a.close?.()}catch(e){}},ms)}catch(e){console.warn("notifyTone blocked",e)}},delay);
const notifyBeep=()=>{const k=BOARD_NOTIF.soundType||"ding",p={ding:[[880,150,0,"sine"]],pop:[[520,90,0,"triangle"]],chime:[[660,90,0,"sine"],[990,140,110,"sine"]],doble:[[740,80,0,"triangle"],[740,100,130,"triangle"]],urgente:[[880,70,0,"square"],[660,70,90,"square"],[880,110,180,"square"]]};(p[k]||p.ding).forEach(x=>notifyTone(...x));return true};
const notifyNewTickets=rows=>{rows=(rows||[]).filter(Boolean);if(BOARD_NOTIF.strongOnly)rows=rows.filter(t=>isCritical(t)||slaFrBreached(t)||slaRsBreached(t)||slaSoon(t));if(!rows.length||BOARD_NOTIF.muted)return;const n=rows.length,t=rows[0],cliente=t?.empresa_capturada||t?.clientes?.nombre||"Nuevo ticket";if(BOARD_NOTIF.visual)toast(`${n} ticket${n===1?"":"s"} nuevo${n===1?"":"s"} · ${cliente}`,"ok");if(BOARD_NOTIF.sound)notifyBeep()};
window.__tkNotifyBeep=notifyBeep;window.__tkNotifyNewTickets=notifyNewTickets;
const DEV_READONLY=()=>/^(localhost|127\.0\.0\.1)$/.test(location.hostname)&&new URLSearchParams(location.search).get("readonly")==="1";
const DEV_XSS_FIXTURE=()=>DEV_READONLY()&&new URLSearchParams(location.search).get("xss_fixture")==="1";
const DEMO_NOW=()=>new Date().toISOString();
const DEMO_PRODUCTS=[
  "MC550E LE","MC500E","MC100E","MB-7","HD3000BE","HD1000BE","3022HD","423S","3128","1600PQC",
  "CoverPro 2000CPX","3000P","7034D","HD4BE","454D","M7 Continental","Skyline S5 Edición Aniversario",
  "Pie para cierre E","Pie dobladillador 4mm","Pie ultradeslizante","Aditamento para bies","Carrete de plástico"
];
const DEMO_COMPANIES=[
  "Casa de Costura Demo","Taller Textil Demo","Academia de Costura Demo","Mercería Demo","Confecciones del Valle",
  "Boutique de Arreglos Demo","Escuela de Moda Demo","Costuras Janome Demo","Uniformes Demo","Bordados Demo"
];
const DEMO_CASES=[
  ["La bordadora no reconoce el bastidor","Cliente reporta que la máquina no detecta correctamente el bastidor después de cambiar diseño."],
  ["Puntada irregular en tela gruesa","Se revisa tensión, aguja, hilo y tipo de tela para corregir puntada irregular."],
  ["Falta video de enhebrado","Se pidió evidencia para validar si el problema viene de enhebrado o ajuste de tensión."],
  ["Compatibilidad de accesorio confirmada","Se confirmó compatibilidad del accesorio con el modelo indicado."],
  ["La máquina no avanza la tela","Posible ajuste de prensatelas, dientes de arrastre o selección de puntada."],
  ["Ruido al coser en velocidad alta","Se solicita video corto para diferenciar uso normal, mantenimiento o falla mecánica."],
  ["Consulta de refacción compatible","Cliente pide validar refacción/accesorio por modelo de máquina."],
  ["Problema con tensión de hilo","Se revisa tensión superior, bobina, aguja y ruta de enhebrado."],
  ["Error al cargar diseño de bordado","Se revisa formato de archivo, tamaño de diseño y compatibilidad del equipo."],
  ["Aguja se rompe con frecuencia","Se valida calibre de aguja, tipo de tela, placa y técnica de uso."],
  ["No corta correctamente en overlock","Se revisa cuchilla, tensión, limpieza y ajuste de guía."],
  ["Collaretera salta puntadas","Se pide muestra de costura, hilo usado y configuración del equipo."],
  ["Pedal responde de forma intermitente","Se revisa conexión, cable, pedal y comportamiento eléctrico."],
  ["Consulta de mantenimiento preventivo","Cliente solicita recomendaciones de limpieza, lubricación y revisión."],
  ["Duda de garantía por falla de motor","Se requiere número de serie, fecha de compra y evidencia del comportamiento."]
];
const demoDate=(n)=>new Date(Date.now()-n*3600*1000).toISOString();
const demoTicket=(i,estado)=>{
  const caseData=DEMO_CASES[i%DEMO_CASES.length];
  const prioridad=i%5===0?"alta":i%3===0?"baja":"media";
  const producto=DEMO_PRODUCTS[i%DEMO_PRODUCTS.length];
  const empresa=DEMO_COMPANIES[i%DEMO_COMPANIES.length];
  const esperando=estado==="en_proceso"&&i%4===0;
  const finalState=esperando?"esperando_cliente":estado;
  return {
    id:`demo-${String(i+1).padStart(3,"0")}`,
    folio:`JAN-${String(i+1).padStart(4,"0")}`,
    estado:finalState,
    prioridad,
    tipo:"soporte",
    sistema:producto,
    titulo:caseData[0],
    descripcion:caseData[1],
    empresa_capturada:empresa,
    nombre_capturado:`Cliente Demo ${i+1}`,
    correo_capturado:`cliente${i+1}@example.com`,
    telefono_capturado:`55${String(10000000+i).slice(-8)}`,
    canal:i%3===0?"whatsapp":"correo",
    fecha_creacion:demoDate(80+i),
    fecha_actualizacion:demoDate(i+1),
    primera_respuesta_en:estado==="abierto"?null:demoDate(i),
    fecha_cierre:estado==="resuelto"?demoDate(i):null,
    timeline_publica:finalState==="esperando_cliente"
      ? [{autor:"soporte",titulo:"Solicitud de evidencia",texto:"Favor de enviar foto, video corto o datos del modelo para continuar.",fecha:demoDate(i)}]
      : estado==="resuelto"
        ? [{autor:"soporte",titulo:"Caso resuelto",texto:"Se registró la solución y queda para confirmación del cliente.",fecha:demoDate(i)}]
        : [],
    clientes:null
  };
};
const demoTickets=()=>{
  const rows=[];
  for(let i=0;i<15;i++)rows.push(demoTicket(i,"abierto"));
  for(let i=15;i<30;i++)rows.push(demoTicket(i,"en_proceso"));
  for(let i=30;i<45;i++)rows.push(demoTicket(i,"resuelto"));
  return rows;
};
const xssFixtureTickets=()=>{
  document.documentElement.dataset.xssFixture="1";
  const now=new Date().toISOString(),base={tipo:"soporte",sistema:"QA local",nombre_capturado:"QA",correo_capturado:"qa@example.invalid",telefono_capturado:"",canal:"correo",fecha_creacion:now,fecha_actualizacion:now,primera_respuesta_en:null,timeline_publica:[],clientes:null};
  return[
    {...base,id:"xss-open",estado:"abierto",titulo:'<img src=x onerror=alert(1)>',empresa_capturada:'\"><img src=x onerror=alert(1)>',descripcion:"<script>alert(1)</script>",prioridad:"javascript:alert(1)",folio:"<svg onload=alert(1)>"},
    {...base,id:"xss-process",estado:"en_proceso",titulo:"<svg onload=alert(1)>",empresa_capturada:"<script>alert(1)</script>",descripcion:'\"><img src=x onerror=alert(1)>',prioridad:"alta",folio:"javascript:alert(1)"},
    {...base,id:"xss-resolved",estado:"resuelto",titulo:"javascript:alert(1)",empresa_capturada:"<svg onload=alert(1)>",descripcion:"<script>alert(1)</script>",prioridad:"media",folio:'\"><img src=x onerror=alert(1)>'},
    {...base,id:"xss-closed",estado:"cerrado",titulo:"<script>alert(1)</script>",empresa_capturada:'\"><img src=x onerror=alert(1)>',descripcion:"<svg onload=alert(1)>",prioridad:"baja",folio:"javascript:alert(1)",fecha_cierre:now},
    {...base,id:'\"><svg onload=alert(1)>',estado:"abierto",titulo:"ID persistido inválido",empresa_capturada:"QA",descripcion:"Debe mostrarse sin acciones ejecutables",prioridad:"media",folio:"QA-XSS-ID"}
  ];
};
const demoPatchTicket=async(id,patch={})=>{
  const rows=Array.isArray(window.TK)?window.TK:[];
  const t=rows.find(x=>String(x.id)===String(id));
  if(t)Object.assign(t,patch);
  return t||null;
};

const restHeaders=async()=>{const key=s.supabaseKey,token=TK_ACTIVE_TOKEN||await tkSessionToken(1200);if(!token&&!DEV_READONLY())throw new Error("Sesión no activa. Inicia sesión.");return{apikey:key,Authorization:`Bearer ${token||key}`,"Content-Type":"application/json"}};
const fetchTicketsRest=async()=>{const url=s.supabaseUrl,h=await restHeaders(),ctx=DEV_READONLY()?{isAdmin:true,userId:""}:await tkAuthContext(),q=new URLSearchParams({select:"*",order:"fecha_actualizacion.desc"});if(!ctx.isAdmin)q.set("asignado_a",`eq.${ctx.userId}`);else if(qp("assignee"))q.set("asignado_a",`eq.${qp("assignee")}`);const endpoint=`${url}/rest/v1/tickets?${q}`;console.info("TICKETS_REQUEST",{endpoint:new URL(endpoint).pathname+new URL(endpoint).search,scope:ctx.isAdmin?"admin_all":"support_own"});const r=await fetch(endpoint,{headers:h});if(!r.ok){const body=await r.text();const e=new Error(`Tickets HTTP ${r.status}: ${body}`);e.status=r.status;e.endpoint=endpoint;throw e}const rows=await r.json(),ids=[...new Set(rows.map(x=>x.cliente_id).filter(Boolean))];if(!ids.length){rows.forEach(t=>t.clientes=null);return rows}const clientEndpoint=`${url}/rest/v1/clientes?select=id,nombre&id=in.(${ids.join(",")})`;const cr=await fetch(clientEndpoint,{headers:h});if(!cr.ok){const body=await cr.text();const e=new Error(`Clientes de tickets HTTP ${cr.status}: ${body}`);e.status=cr.status;e.endpoint=clientEndpoint;throw e}const clientes=await cr.json(),map=Object.fromEntries(clientes.map(x=>[x.id,x]));rows.forEach(t=>t.clientes=map[t.cliente_id]||null);return rows};
const updateTicketRest=async(id,payload)=>{if(!id)throw new Error("Falta id de ticket");const h=await restHeaders(),r=await fetch(`${s.supabaseUrl}/rest/v1/tickets?id=eq.${encodeURIComponent(id)}`,{method:"PATCH",headers:{...h,Prefer:"return=representation"},body:JSON.stringify(payload)});const txt=await r.text();if(!r.ok)throw new Error(txt);return JSON.parse(txt||"[]")};

window.__fetchTicketsRest=fetchTicketsRest;
window.__updateTicketRest=updateTicketRest;


const setEditMode=v=>{
  const on=!!v;
  try{EDIT_MODE=on}catch{}
  try{localStorage.setItem("tc_tickets_edit_mode",on?"1":"0")}catch{}
  document.documentElement.dataset.tkEditMode=on?"1":"0";
  document.body?.classList?.toggle("is-edit-mode",on);
  document.querySelectorAll(".k-card").forEach(el=>{
    try{el.setAttribute("draggable",on?"true":"false")}catch{}
  });
  const chk=document.querySelector("#tkEditModeChk");
  if(chk)chk.checked=on;
};


const tkJanomeSeedEnabled=()=>{
  try{
    const q=new URLSearchParams(location.search||"");
    return q.has("janome_seed")||q.get("seed")==="janome"||localStorage.getItem("tc_janome_visual_seed")==="1";
  }catch{return false}
};

const tkJanomeSeedState=v=>{
  const x=String(v||"").toLowerCase().trim();
  if(["nuevo","new","open","abierto"].includes(x))return"abierto";
  if(["en_revision","revision","en revisión","en_proceso","proceso","in_progress"].includes(x))return"en_proceso";
  if(["esperando_cliente","waiting_customer","espera_cliente"].includes(x))return"esperando_cliente";
  if(["resuelto","resolved","solved"].includes(x))return"resuelto";
  if(["cerrado","closed","close"].includes(x))return"cerrado";
  return"abierto";
};

const tkJanomeSeedPriority=v=>{
  const x=String(v||"media").toLowerCase().trim();
  if(["alta","high","urgente","urgent"].includes(x))return"alta";
  if(["baja","low"].includes(x))return"baja";
  return"media";
};

const tkJanomeSeedDate=x=>x?.fecha_actualizacion||x?.updated_at||x?.updatedAt||x?.created_at||x?.createdAt||new Date().toISOString();

const tkNormalizeJanomeSeedTicket=(x,i=0)=>{
  const n=String(i+1).padStart(3,"0");
  const nombre=x?.nombre||x?.name||x?.cliente||x?.customer_name||x?.clientName||"Cliente Janome";
  const titulo=x?.titulo||x?.title||x?.subject||x?.asunto||"Ticket de prueba Janome";
  const descripcion=x?.descripcion||x?.description||x?.body||x?.mensaje||"Descripción de prueba Janome.";
  const sistema=x?.sistema||x?.sistema_detectado||[x?.producto,x?.modelo].filter(Boolean).join(" · ")||"Producto Janome";
  const fecha=tkJanomeSeedDate(x);
  const mensajes=Array.isArray(x?.mensajes)?x.mensajes:Array.isArray(x?.messages)?x.messages:Array.isArray(x?.comments)?x.comments:[];
  const historial=Array.isArray(x?.historial)?x.historial:mensajes.map((m,idx)=>({
    kind:"mensaje",
    autor:m?.autor||m?.author||"cliente",
    titulo:m?.titulo||m?.title||(idx?"Respuesta":"Mensaje inicial"),
    texto:m?.texto||m?.text||m?.body||descripcion,
    fecha:m?.fecha||m?.created_at||m?.createdAt||fecha,
    adjuntos:[]
  }));
  const adjuntos=Array.isArray(x?.adjuntos)?x.adjuntos:Array.isArray(x?.archivos)?x.archivos:Array.isArray(x?.attachments)?x.attachments:Array.isArray(x?.files)?x.files:[];
  return {
    ...x,
    id:String(x?.id||`janome-test-${n}`),
    folio:x?.folio||`JAN-TEST-${n}`,
    is_test:true,
    isTest:true,
    source:"janome_visual_seed",

    empresa_capturada:x?.empresa_capturada||x?.empresa||nombre,
    nombre,
    usuario:nombre,
    contacto:nombre,
    correo:x?.correo||x?.email||"",
    telefono:x?.telefono||x?.phone||"",
    whatsapp:!!x?.whatsapp,

    sistema,
    sistema_detectado:sistema,
    producto:x?.producto||sistema,
    modelo:x?.modelo||"",

    titulo,
    descripcion,
    prioridad:tkJanomeSeedPriority(x?.prioridad||x?.priority),
    estado:tkJanomeSeedState(x?.estado||x?.status),

    tipo:x?.tipo||x?.categoria||x?.canal||"soporte",
    canal:x?.canal||"web",

    fecha_creacion:x?.fecha_creacion||x?.created_at||x?.createdAt||fecha,
    fecha_actualizacion:fecha,
    created_at:x?.created_at||x?.createdAt||fecha,
    updated_at:x?.updated_at||x?.updatedAt||fecha,

    adjuntos,
    archivos:adjuntos,
    historial,
    mensajes,

    clientes:x?.clientes||{id:"janome-test-client",nombre:x?.empresa_capturada||x?.empresa||nombre}
  };
};

const tkLoadJanomeSeedRows=async()=>{
  if(!tkJanomeSeedEnabled())return[];
  let rows=[];
  const keys=["janome_test_tickets","tickets","ticketCoreTickets","ticket_core_tickets","janomeTickets","janome_tickets","supportTickets","soporte_tickets","app_tickets","tc_tickets","tickets_data","ticketData"];
  for(const k of keys){
    try{
      const raw=localStorage.getItem(k);
      if(!raw)continue;
      const parsed=JSON.parse(raw);
      if(Array.isArray(parsed))rows=rows.concat(parsed);
      else if(Array.isArray(parsed?.tickets))rows=rows.concat(parsed.tickets);
    }catch{}
  }
  try{
    const r=await fetch("janome-test-tickets.json?v="+Date.now(),{cache:"no-store"});
    if(r.ok){
      const j=await r.json();
      if(Array.isArray(j))rows=rows.concat(j);
      else if(Array.isArray(j?.tickets))rows=rows.concat(j.tickets);
    }
  }catch(e){
    console.warn("JANOME_SEED_JSON_UNAVAILABLE",e);
  }
  const seen=new Set();
  return rows.map(tkNormalizeJanomeSeedTicket).filter(t=>{
    const k=String(t.id||t.folio||"");
    if(!k||seen.has(k))return false;
    seen.add(k);
    return true;
  });
};

const tkMergeJanomeVisualSeed=async(base=[])=>{
  const clean=Array.isArray(base)?base:[];
  if(!tkJanomeSeedEnabled())return clean;
  const seed=await tkLoadJanomeSeedRows();
  if(!seed.length){
    console.warn("JANOME_VISUAL_SEED_ENABLED_BUT_EMPTY");
    return clean;
  }
  const realKeys=new Set(clean.map(t=>String(t.id||t.folio||"")));
  const add=seed.filter(t=>!realKeys.has(String(t.id||t.folio||"")));
  console.info("JANOME_VISUAL_SEED_MERGED",{real:clean.length,seed:add.length,total:clean.length+add.length});
  return add.concat(clean);
};

const load=async()=>{if(!Array.isArray(TK)||!TK.length){document.body.dataset.ticketsLoading="1"}else{delete document.body.dataset.ticketsLoading}/* B2_2_LOADING_ONLY_EMPTY */;const seq=++LOAD_SEQ,t0=performance.now();console.info(DEV_READONLY()?"load start DEV_READONLY":"load start AUTH_FAST");let profile={rol:"soporte"},authFallback=false;document.body.dataset.authFallback="0";document.body.dataset.ticketsError="0";ensureAppShell({page:"tickets",role:profile.rol||"soporte",title:"Tickets",kicker:"Ticket Core · mesa operativa",actionsHtml:`<a class="mini btn-ghost" href="dashboard.html">Dashboard</a><button class="mini" data-theme-toggle>🌓 <span data-theme-label>Claro</span></button>`});setAppRole(profile.rol||"soporte");if(!DEV_READONLY()){const token=await tkSessionToken(1800);if(!token){console.warn("AUTH_NO_TOKEN_FAST");location.replace("index.html?next=tickets.html");return}console.info("AUTH_TOKEN_OK_FAST");setTimeout(async()=>{try{const p=(await withTimeout(s.from("perfiles").select("*").limit(1).maybeSingle(),500,"perfil bg")).data;if(p?.rol)setAppRole(p.rol)}catch{}},0)}const oldIds=new Set(TK.map(x=>String(x.id))),hadRows=TK.length>0;let data=[],error=null;if(DEV_READONLY()){if(DEV_XSS_FIXTURE()){data=xssFixtureTickets()}else try{data=s.supabaseUrl&&s.supabaseKey?await fetchTicketsRest():demoTickets()}catch(e){console.warn("READONLY_REST_UNAVAILABLE_USING_DEMO",e);data=demoTickets();error=null}}else{try{authFallback=true;document.body.dataset.authFallback="fast-rest";data=await withTimeout(fetchTicketsRest(),4500,"tickets rest fast")}catch(e){const m=e?.message||String(e);console.warn("TICKETS_REST_FAST_ERROR",e);if(/JWT expired|PGRST303|Invalid Refresh Token|Refresh Token|Sesión no activa|session_not_found|Unauthorized|401/i.test(m)){TK_ACTIVE_TOKEN="";localStorage.removeItem("tc_tickets_last_ok");location.replace("index.html?next=tickets.html");return}error=e}}if(seq!==LOAD_SEQ)return console.warn("LOAD_STALE_IGNORED",seq,LOAD_SEQ);console.info("tickets loaded source",DEV_XSS_FIXTURE()?"XSS_FIXTURE":DEV_READONLY()?"REST_READONLY":authFallback?"REST_AUTH_FAST":"AUTH_RETRY",data?.length,error,Math.round(performance.now()-t0)+"ms");if(error){window.TK=TK;delete document.body.dataset.ticketsLoading;document.body.dataset.ticketsError="1";return toast(msg(error),"bad")}TK=DEV_XSS_FIXTURE()?data:await tkMergeJanomeVisualSeed(Array.isArray(data)?data:[]);const newRows=hadRows?TK.filter(x=>!oldIds.has(String(x.id))):[];if(newRows.length)COL_PAGE={abierto:0,en_proceso:0,esperando_cliente:0,resuelto:0};["abierto","en_proceso","resuelto"].forEach(k=>COL_PAGE[k]=Number(COL_PAGE[k]||0));window.TK=TK;if(Array.isArray(TK)&&TK.length){document.body.dataset.ticketsReady="1"}/* B2_4_TICKETS_READY_AFTER_REAL_LOAD */;if(newRows.length)notifyNewTickets(newRows);setGlobalSearchData({tickets:TK,clientes:TK.map(t=>t.clientes).filter(Boolean)});setBreadcrumb([{label:"Panel",href:"dashboard.html"},{label:"Tickets"}]);setRailOpenCount(openCount(TK));applyBoardOrder();setEditMode(EDIT_MODE);VIEW=isMobileTickets()?"kanban":VIEW==="compact"?"compact":"kanban";if(isMobileTickets())localStorage.setItem("tc_tickets_view","kanban");$("#tkBoard")?.classList.toggle("hidden",VIEW==="compact");$("#tkCompact")?.classList.toggle("hidden",VIEW!=="compact");document.querySelector(".board-layout")?.classList.remove("hidden");mountMobileStateTabs();const _prevQ=FILTER.q;applyUrlFilters();if(!qp("q")&&_prevQ){FILTER.q=_prevQ;const _qs=$("#tkSearch");if(_qs&&document.activeElement!==_qs)_qs.value=_prevQ}if(!filtered().length&&TK.length&&!FILTER.q){resetFilters();history.replaceState(null,"",location.pathname);syncFilterUI()}ensureSelectedVisible();renderAll();syncSelected();syncHeaderIconButtons();syncMobileClearIcon();syncHeaderClearBtns();tkSyncFilterActiveUi?.();delete document.body.dataset.ticketsLoading};
window.__tkLoad=load;
const setTxt=(id,v)=>{$("#"+id)&&($("#"+id).textContent=String(v))};



const tkHasActiveFilter=()=>{
  const f=FILTER||{};
  return !!(f.q||f.priority||f.state||f.type||f.client||f.clienteId||f.noEvidence||f.impactHigh||f.urgentStale||f.noClientLinked||f.matchMedium||f.frBreach||f.rsBreach||f.slaSoon);
};
const tkMetricRows=()=>tkHasActiveFilter()?filtered():TK;
const renderMetrics=()=>{
  const rows=tkMetricRows();
  setTxt("mUrgent",rows.filter(x=>norm(x.prioridad)==="urgente"&&!["resuelto","cerrado"].includes(ticketStateKey(rawState(x)))).length);
  setTxt("mWait",rows.filter(x=>ticketStateKey(rawState(x))==="esperando_cliente").length);
  setTxt("mStale",rows.filter(urgentStale).length);
  setTxt("mSolved",rows.filter(x=>ticketStateKey(rawState(x))==="resuelto").length);
  setTxt("mNoClient",rows.filter(noClientLinked).length);
  setTxt("mFrBreach",rows.filter(slaFrBreached).length);
  setTxt("mRsBreach",rows.filter(slaRsBreached).length);
  setTxt("mSlaSoon",rows.filter(slaSoon).length);
  if(typeof syncHeroMetrics==="function")syncHeroMetrics();
  window.__tkFilterDiag=()=>({FILTER:{...FILTER},activeFilter:tkHasActiveFilter(),total:TK.length,filtered:filtered().length,metricRows:rows.length,states:["abierto","en_proceso","esperando_cliente","resuelto","cerrado"].reduce((a,k)=>(a[k]=filtered().filter(t=>ticketStateKey(rawState(t))===k).length,a),{})});
};
const prettyCambio=v=>{const x=String(v||"").trim();if(!x||["sin_cambio","no_se"].includes(norm(x)))return"";return x.replace(/_/g," ").replace(/\b\w/g,m=>m.toUpperCase())};
const ticketMainPill=t=>{const s=ticketStateKey(rawState(t)),sla=slaMeta(t),h=healthTag(t);if(s==="resuelto")return{txt:"Para cierre",cls:"ok"};if(sla.cls==="bad")return{txt:sla.txt.replace("1ra resp. vencida","Respuesta vencida"),cls:"bad"};if(h.cls==="bad")return{txt:"Prioritario",cls:"bad"};if(s==="esperando_cliente")return{txt:"Esperando cliente",cls:"warn"};if(!evidenceCount(t))return{txt:"Falta información",cls:"warn"};return{txt:"En curso",cls:"info"}};
const ticketMeta=t=>{const desde=(t.desde_cuando||"").trim(),afecta=t.afecta_a||"",cambio=prettyCambio(t.ultimo_cambio||"");return[isNewTicket(t)?"Nuevo":"",desde?`Cuándo: ${desde}`:"",afecta==="todos"?"Afecta a todos":afecta==="varios"?"Afecta a varios":"",cambio?`Cambio: ${cambio}`:""].filter(Boolean)};
const fmtCardText=v=>{const s=String(v||"").replace(/\s+/g," ").trim();if(!s)return"";const x=s.toLocaleLowerCase("es-MX");return x.charAt(0).toLocaleUpperCase("es-MX")+x.slice(1)};
const ticketActions=(id,state)=>!id?ticketActionFallback:state==="abierto"?`<button class="mini btn-ghost is-disabled" type="button" disabled title="Sin estado anterior">←</button><button class="mini btn-ghost" type="button" data-ticket-state="${htmlAttr(id)}|en_proceso" title="Mover a en proceso">→</button>`:state==="en_proceso"?`<button class="mini btn-ghost" type="button" data-ticket-state="${htmlAttr(id)}|abierto" title="Regresar a abierto">←</button><button class="mini btn-ghost" type="button" data-ticket-state="${htmlAttr(id)}|resuelto" title="Marcar como resuelto">→</button>`:state==="esperando_cliente"?`<button class="mini btn-ghost" type="button" data-ticket-state="${htmlAttr(id)}|en_proceso" title="Regresar a en proceso">←</button><button class="mini btn-ghost" type="button" data-ticket-state="${htmlAttr(id)}|resuelto" title="Marcar como resuelto">→</button>`:state==="resuelto"?`<button class="mini btn-ghost" type="button" data-ticket-state="${htmlAttr(id)}|en_proceso" title="Reabrir">←</button><button class="mini btn-ok" type="button" data-ticket-close="${htmlAttr(id)}" title="Doble clic para cerrar">✓</button>`:`<button class="mini btn-ghost" type="button" data-ticket-state="${htmlAttr(id)}|en_proceso" title="Reabrir">↺</button>`;

const card=t=>{const crit=isCritical(t),ev=evidenceCount(t),id=ticketDomId(t.id),cliente=htmlText(fmtCardText(t.empresa_capturada||t.clientes?.nombre||"Sin registro")),state=ticketStateKey(rawState(t)),meta=ticketMeta(t),titulo=htmlText(fmtCardText(t.titulo||"Sin título")),desc=htmlText(fmtCardText(t.descripcion||"Sin descripción")),cls=`k-card ${crit?"is-critical":""} ${staleCls(t)} ${id&&id===String(SELECTED_ID)?"is-selected":""}`.trim(),acts=ticketActions(id,state);return`<article class="${cls}" draggable="${EDIT_MODE?"true":"false"}" data-id="${htmlAttr(id)}"><div class="k-head"><div class="k-title-row"><div class="k-title-main"><div class="k-title-line"><div class="k-title">${titulo}</div><span class="tag ${ticketPriorityCls(t.prioridad)}">${htmlText(t.prioridad||"media")}</span></div><div class="k-company-line"><span class="k-company">${cliente}</span></div></div>${ev?`<span class="k-clip" title="${ev} adjunto${ev>1?"s":""}" aria-label="${ev} adjunto${ev>1?"s":""}">📎</span>`:""}</div></div><div class="k-desc">${desc.length>128?desc.slice(0,128).trim()+"…":desc}</div>${meta.length?`<div class="k-submeta">${meta.slice(0,3).map(x=>`<span class="mini-meta">${htmlText(x)}</span>`).join("")}</div>`:""}<div class="actions quick-inline k-card-actions">${acts}${id?`<button class="mini btn-ghost k-action-bolt" type="button" data-quick-panel="${htmlAttr(id)}|modelo" title="Acciones rápidas">⚡</button>`:""}</div></article>`};


const renderBoard=()=>{const all=filtered(),rows=all.filter(t=>ticketStateKey(rawState(t))!=="cerrado"),cols={abierto:[],en_proceso:[],resuelto:[]},raw=TK.reduce((a,t)=>{const s=String(rawState(t)||"SIN_ESTADO"),k=ticketStateKey(rawState(t));a.raw[s]=(a.raw[s]||0)+1;a.key[k]=(a.key[k]||0)+1;return a},{raw:{},key:{}}),mob=isMobileTickets();rows.forEach(t=>{const k=ticketStateKey(rawState(t));if(k==="resuelto")cols.resuelto.push(t);else if(k==="en_proceso"||k==="esperando_cliente")cols.en_proceso.push(t);else cols.abierto.push(t)});Object.keys(cols).forEach(k=>tkSortRows(cols[k]));["abierto","en_proceso","resuelto"].forEach(k=>{clampPage(k,cols[k]);const el=$("#col-"+k),show=!mob||k===MOBILE_STATE;if(el)el.innerHTML=show?(pageSlice(cols[k],k).map(card).join("")||`<div class="empty-state">Sin tickets :)</div>`):"";tkColHeader(k,cols[k].length);renderPager(k,cols[k])});syncMobileStateTabs(cols);window._TK_COLS={total:rows.length,abierto:cols.abierto.length,en_proceso:cols.en_proceso.length,resuelto:cols.resuelto.length,esperando_cliente:raw.key.esperando_cliente||0,raw:raw.raw,key:raw.key}};
const compactUpdated=t=>{const raw=t?.fecha_actualizacion||t?.updated_at||t?.fecha_creacion||t?.created_at;if(!raw)return"Sin fecha";const d=new Date(raw);return Number.isFinite(d.getTime())?d.toLocaleString("es-MX",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}):"Sin fecha"};
const compactRow=t=>{const crit=isCritical(t),ev=evidenceCount(t),id=ticketDomId(t.id),state=ticketStateKey(rawState(t)),cliente=htmlText(fmtCardText(t.empresa_capturada||t.clientes?.nombre||"Sin registro")),meta=ticketMeta(t),tituloRaw=fmtCardText(t.titulo||"Sin título"),descRaw=fmtCardText(t.descripcion||"Sin descripción"),titulo=htmlText(tituloRaw),desc=htmlText(descRaw),acts=ticketActions(id,state),folio=htmlText(t.folio||"Sin folio"),producto=htmlText(t.sistema||t.sistema_detectado||t.producto_modelo||t.producto||"Producto sin identificar"),agente=htmlText(t.agente_nombre||t.asignado_a_nombre||t.agente?.nombre||t.perfiles?.nombre||"Sin asignar"),estado=htmlText(ticketStateLabel?.(state)||state.replaceAll("_"," ")),sla=slaMeta(t),context=[`Producto: ${producto}`,`Estado: ${estado}`,`Agente: ${agente}`,`Último: ${compactUpdated(t)}`,`SLA: ${sla.txt}`,...meta].slice(0,7);return`<div class="compact-row ${crit?"is-critical":""} ${id&&id===String(SELECTED_ID)?"is-selected":""}" data-id="${htmlAttr(id)}"><div class="compact-case"><div class="compact-topline"><strong class="compact-client">${cliente}</strong><span class="tag ${ticketPriorityCls(t.prioridad)}">${htmlText(t.prioridad||"media")}</span>${ev?`<span class="compact-clip" title="${ev} adjunto${ev>1?"s":""}" aria-label="${ev} adjunto${ev>1?"s":""}">📎</span>`:""}</div><div class="compact-title"><span class="compact-folio">${folio}</span> · ${titulo}</div>${norm(descRaw)!==norm(tituloRaw)?`<span class="compact-desc">${desc.length>118?desc.slice(0,118).trim()+"…":desc}</span>`:""}</div><div class="compact-context">${context.map(x=>`<span>${htmlText(x)}</span>`).join("")}</div><div class="compact-actions">${acts}${id?`<button class="mini btn-ghost k-action-bolt" type="button" data-quick-panel="${htmlAttr(id)}|modelo" title="Acciones rápidas">⚡</button>`:""}</div></div>`};
const renderCompact=()=>{if(isMobileTickets())return;mountCompactModeTabs();$("#tkCompact .compact-head")&&($("#tkCompact .compact-head").innerHTML=`<div></div><div>Contexto</div><div>Acciones</div>`);const groups=compactGroups(),rows=groups[COMPACT_GROUP]||[],pageRows=compactPageRows(rows);syncCompactTabs(groups);$("#tkCompactRows")&&($("#tkCompactRows").innerHTML=pageRows.length?pageRows.map(compactRow).join(""):`<div class="empty-state">Sin tickets :)</div>`);renderCompactPager(rows)};

const applyFilters=()=>{FILTER.q=$("#tkSearch")?.value||"";FILTER.priority=$("#tkFilterPriority")?.value||"";if(FILTER.priority){FILTER.urgentStale=false;FILTER.frBreach=false;FILTER.rsBreach=false;FILTER.slaSoon=false;}FILTER.state=$("#tkFilterState")?.value||"";FILTER.type=$("#tkFilterType")?.value||"";FILTER.client=$("#tkFilterClient")?.value||"";if(FILTER.clienteId&&FILTER.client&&!norm(FILTER.client).includes(norm(TK.find(x=>String(x?.cliente_id)===String(FILTER.clienteId))?.clientes?.nombre||"")))FILTER.clienteId="";syncFilterUI();ensureSelectedVisible();renderAll();syncSelected();syncHeaderClearBtns();tkSyncFilterActiveUi?.()};
const syncMobileClearIcon=()=>{const b=$("#tkClearFilters");if(!b)return;const src=HDR_ICONS?.clear||"../IMG/borrar.webp",alt="Limpiar filtros";b.innerHTML=`<img src="${src}" alt="${alt}">`;b.setAttribute("aria-label",alt);b.setAttribute("title",alt);b.dataset.iconOnly="1"};
const hasActiveHeaderFilters=()=>!!(FILTER.q||FILTER.priority||FILTER.state||FILTER.type||FILTER.client||FILTER.clienteId||FILTER.noEvidence||FILTER.readyClose||FILTER.impactHigh||FILTER.urgentStale||FILTER.noClientLinked||FILTER.matchMedium||FILTER.frBreach||FILTER.rsBreach||FILTER.slaSoon);
const syncHeaderClearBtns=()=>{const idle=!hasActiveHeaderFilters();$("#tkClearFilters")?.classList.toggle("is-idle",idle)};


const closeTicketFloaters=()=>{const f=$("#tkAdvancedFilters"),g=$("#tkGearMenu")||document.querySelector(".tickets-gear-menu");f&&(f.classList.add("hidden"),f.hidden=true,f.setAttribute("hidden","hidden"));$("#tkMoreFiltersBtn")?.setAttribute("aria-expanded","false");g&&(g.classList.add("hidden"),g.hidden=true,g.setAttribute("hidden","hidden"));$("#tkGearBtn")?.setAttribute("aria-expanded","false");document.body.classList.remove("tk-toolbar-popup-open");const bd=$("#tkToolbarPopupBackdrop");bd&&bd.classList.remove("open")};
const closeTicketMenus=()=>closeTicketFloaters();

const tkElOpen=sel=>{const x=$(sel);return !!x&&!x.hidden&&!x.classList.contains("hidden")&&getComputedStyle(x).display!=="none"};
const tkSurfaceOpen=()=>!!QUICK?.open||tkElOpen("#tkModal")||tkElOpen("#tkClosedModal")||tkElOpen("#tkGearMenu")||tkElOpen("#tkAdvancedFilters")||tkElOpen("#tkQrEditor");
const tkCloseSurfaces=()=>{closeTicketFloaters();if(!$("#tkModal")?.hidden)forceCloseNewTicketModal?.();if(!$("#tkClosedModal")?.hidden){$("#tkToggleClosed")?.setAttribute("aria-expanded","false");closeClosedModal?.()}if(QUICK?.open)setQuickPanelOpen?.(false);closeQuickEditor?.()};
const toggleFilterMenu=e=>{e?.preventDefault?.();e?.stopPropagation?.();const adv=$("#tkAdvancedFilters"),open=adv?.classList.contains("hidden")||adv?.hidden;closeTicketFloaters();if(open&&adv){adv.classList.remove("hidden");adv.hidden=false;adv.removeAttribute("hidden");$("#tkMoreFiltersBtn")?.setAttribute("aria-expanded","true")}};
const openGearMenuHard=()=>{
  const menu=$("#tkGearMenu")||document.querySelector(".tickets-gear-menu"),btn=$("#tkGearBtn");
  if(!menu)return false;
  try{
    tkMountBgControls?.();
    tkMountOrderControls?.();
    tkGearTab?.("notif");
    syncBoardNotifUI?.();
    tkSyncOrderControls?.();
    setTimeout(()=>tkCompactGearSettings?.(),0);
  }catch(e){
    console.warn("TK_GEAR_PREP_WARN",e);
  }
  menu.classList.remove("hidden");
  menu.hidden=false;
  menu.removeAttribute("hidden");
  menu.style.setProperty("display","grid","important");
  menu.style.setProperty("visibility","visible","important");
  menu.style.setProperty("opacity","1","important");
  menu.style.setProperty("pointer-events","auto","important");
  btn?.setAttribute("aria-expanded","true");
  return true;
};
const closeGearMenuHard=()=>{
  const menu=$("#tkGearMenu")||document.querySelector(".tickets-gear-menu"),btn=$("#tkGearBtn");
  if(menu){
    menu.classList.add("hidden");
    menu.hidden=true;
    menu.setAttribute("hidden","hidden");
    menu.style.removeProperty("display");
    menu.style.removeProperty("visibility");
    menu.style.removeProperty("opacity");
    menu.style.removeProperty("pointer-events");
  }
  btn?.setAttribute("aria-expanded","false");
};
const toggleGearMenu=e=>{
  e?.preventDefault?.();
  e?.stopPropagation?.();
  const menu=$("#tkGearMenu")||document.querySelector(".tickets-gear-menu");
  const willOpen=!menu||menu.hidden||menu.classList.contains("hidden")||getComputedStyle(menu).display==="none";
  closeTicketFloaters?.();
  if(willOpen){
    openGearMenuHard();
    setTimeout(()=>openGearMenuHard(),40);
  }else{
    closeGearMenuHard();
  }
};
window.__tkGearOpen=()=>openGearMenuHard();
window.__tkGearClose=()=>closeGearMenuHard();

const setFieldLabel=(id,txt)=>{const l=document.querySelector(`label[for="${id}"]`);if(l)l.textContent=txt};
const hideFieldWrap=id=>{const el=$("#"+id);if(!el)return;const w=el.closest(".field,.stack-sm,.grid-2>div,.grid>div,label")||el.parentElement;if(w)w.style.display="none"};
const skinNewTicketActions=()=>{const foot=$("#tkModal .actions")||$("#tkModal .modal .actions");if(!foot)return;[...foot.querySelectorAll("button")].forEach(b=>{if(b.id==="tkSave"){b.innerHTML=`<img src="../IMG/enviar.png" alt="Enviar">`;b.setAttribute("aria-label","Enviar");b.setAttribute("title","Enviar");b.classList.add("tk-send-only")}else b.style.display="none"})};
const setNotifyLabel=txt=>{const el=$("#tkNotificar");const box=el?.closest("label,.tk-notify-opt,.field,.stack-sm");if(!box)return;const t=box.querySelector("span,.mut,small,b")||box;t.textContent=txt};
const closeNewTicketModal=()=>{if(typeof hide==="function")hide("#tkModal");else{$("#tkModal")?.classList.add("hidden");$("#tkModal")?.setAttribute("hidden","hidden")}document.body.classList.remove("modal-open");document.documentElement.classList.remove("modal-open");closeTicketFloaters?.()};
const mountNewTicketSendInsideDesc=()=>{const save=$("#tkSave"),desc=$("#tkDesc")||$("#tkDescripcion")||document.querySelector('#tkModal textarea[name="descripcion"],#tkModal textarea');if(!save||!desc)return;const wrap=desc.closest(".field,.stack-sm,.grid>div,.grid-2>div")||desc.parentElement,foot=$("#tkModal .actions")||$("#tkModal .modal .actions");if(!wrap)return;wrap.classList.add("tk-desc-wrap");save.innerHTML=`<img src="../IMG/enviar.png" alt="Enviar" onerror="this.style.display='none';this.parentNode.textContent='Enviar'">`;save.setAttribute("aria-label","Enviar");save.setAttribute("title","Enviar");save.className="btn tk-send-fab";save.type="button";wrap.appendChild(save);foot&&[...foot.querySelectorAll("button")].forEach(b=>{if(b!==save)b.style.display="none"})};
const forceCloseNewTicketModal=()=>{const m=$("#tkModal");if(m){m.hidden=true;m.classList.add("hidden");m.style.display=""}document.body.classList.remove("modal-open");document.documentElement.classList.remove("modal-open");closeTicketFloaters?.()};
const bindNewTicketOutsideClose=()=>{const r=document.documentElement;if(r.__tkNewOutsideCloseV2)document.removeEventListener("click",r.__tkNewOutsideCloseV2,true);r.__tkNewOutsideCloseV2=e=>{const m=$("#tkModal");if(!m||m.hidden||m.classList.contains("hidden")||getComputedStyle(m).display==="none")return;const inside=e.target?.closest?.("#tkModal .modal,#tkModal .tk-new-modal,.modal,.tk-new-modal");if(m.contains(e.target)&&!inside){e.preventDefault();e.stopImmediatePropagation?.();if(typeof forceCloseNewTicketModal==="function")forceCloseNewTicketModal();else closeNewTicketModal?.()}};document.addEventListener("click",r.__tkNewOutsideCloseV2,true);r.dataset.tkNewOutsideBound="v2"};

const bindNewTicketClose=()=>{const m=$("#tkModal");if(!m)return;bindNewTicketOutsideClose();bindNewTicketOutsideClose();["tkModalCloseX","tkClose","tkCancel"].forEach(id=>$("#"+id)&&($("#"+id).onclick=e=>{e.preventDefault();e.stopImmediatePropagation?.();forceCloseNewTicketModal()}));m.onclick=null;if(m.__tkOutsideClose)m.removeEventListener("click",m.__tkOutsideClose,true);m.__tkOutsideClose=e=>{const inside=e.target?.closest?.("#tkModal .modal,#tkModal .tk-new-modal,.modal,.tk-new-modal");if(e.target===m||!inside){e.preventDefault();e.stopImmediatePropagation?.();forceCloseNewTicketModal()}};m.addEventListener("click",m.__tkOutsideClose,true);if(!document.documentElement.dataset.tkNewEscBound){document.documentElement.dataset.tkNewEscBound="1";document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!$("#tkModal")?.hidden)forceCloseNewTicketModal()},true)}};


const prepareNewTicketModal=()=>{setFieldLabel("tkCliente","Empresa");setFieldLabel("tkNombre","Usuario");$("#tkCliente")&&($("#tkCliente").placeholder="Empresa");$("#tkNombre")&&($("#tkNombre").placeholder="Usuario");$("#tkCorreo")&&($("#tkCorreo").value="");$("#tkTelefono")&&($("#tkTelefono").value="");$("#tkTipo")&&($("#tkTipo").value="soporte");$("#tkNotificar")&&($("#tkNotificar").checked=false);["tkTelefono","tkTipo","tkCorreo"].forEach(hideFieldWrap);$("#tkNotificar")?.closest("label,.tk-notify-opt,.field,.stack-sm")?.classList.add("hidden");$("#tkStatus")&&($("#tkStatus").textContent="");const h=$("#tkModal .section-head");if(h)h.innerHTML=`<div class="tk-new-title"><span class="tk-modal-plus">+</span><h3>Nuevo ticket</h3></div><button class="icon-btn" id="tkClose" type="button" aria-label="Cerrar">✕</button>`;const box=$("#tkModal .modal");if(box){box.style.maxHeight="min(88dvh,820px)";box.style.overflow="auto";box.style.borderRadius="28px"}const foot=$("#tkModal .actions"),save=$("#tkSave"),wrap=$("#tkDesc")?.closest(".tk-desc-wrap")||$("#tkDesc")?.parentElement;if(save){save.disabled=false;save.className="btn btn-brand tk-save-main";save.type="button";save.style.display="grid";save.innerHTML=`<img src="../IMG/enviar.png" alt=""> <span>Enviar</span>`;save.setAttribute("aria-label","Enviar");save.setAttribute("title","Enviar")}if(isMobileTickets()&&wrap&&save&&!wrap.contains(save))wrap.appendChild(save);else if(foot&&save&&!foot.contains(save))foot.appendChild(save);["tkCliente","tkNombre","tkSistema","tkTitulo","tkDesc"].forEach(id=>{const x=$("#"+id);if(x){x.setAttribute("autocomplete","off");x.setAttribute("autocorrect","off");x.setAttribute("autocapitalize","off");x.setAttribute("spellcheck","false")}});bindNewTicketClose()};
const openNewTicketModal=()=>{closeTicketFloaters?.();const m=$("#tkModal");if(m){m.hidden=false;m.classList.remove("hidden");m.style.display="grid"}document.body.classList.add("modal-open");document.documentElement.classList.add("modal-open");prepareNewTicketModal?.();bindNewTicketClose?.();setTimeout(()=>{$("#tkTitulo")?.focus();mountNewTicketSendInsideDesc?.()},0)};

const ensureMobileClearBtn=()=>{};
const bindCompactUi=()=>{$("#tkCompactPrev")&&($("#tkCompactPrev").onclick=e=>{e.preventDefault();e.stopPropagation();COMPACT_PAGE=Math.max(0,(COMPACT_PAGE||0)-1);localStorage.setItem("tc_tickets_compact_page",String(COMPACT_PAGE));renderCompact();bindCompactUi()});$("#tkCompactNext")&&($("#tkCompactNext").onclick=e=>{e.preventDefault();e.stopPropagation();COMPACT_PAGE=(COMPACT_PAGE||0)+1;localStorage.setItem("tc_tickets_compact_page",String(COMPACT_PAGE));renderCompact();bindCompactUi()});$("#tkClearFiltersMobile")&&($("#tkClearFiltersMobile").onclick=e=>{e.preventDefault();e.stopPropagation();clearAllFilters?.()})};

const syncViewSurface=()=>{document.body.dataset.view=VIEW==="compact"?"compact":"kanban"};
const renderAll=()=>{if(isMobileTickets()){VIEW="kanban";localStorage.setItem("tc_tickets_view","kanban");$("#tkBoard")?.classList.remove("hidden");$("#tkCompact")?.classList.add("hidden");$("#tkCompactRows")&&($("#tkCompactRows").innerHTML="")}ensureSelectedVisible();syncViewSurface();syncHeaderIconButtons();markTicketsToolbar?.();renderMetrics();renderBoard();if(!isMobileTickets()&&VIEW==="compact")renderCompact();else{$("#tkCompact")?.classList.add("hidden");$("#tkCompactRows")&&($("#tkCompactRows").innerHTML="")}renderClosed();syncSelected();syncMobileClearIcon?.();syncHeaderClearBtns?.();syncActiveFilterLabel?.();if(QUICK.open){setQuickPanelOpen(true);syncSelected()}bindDynamic();if(!isMobileTickets()&&VIEW==="compact")bindCompactUi?.()};
window.__tkDiag=()=>({TK:TK.length,filtered:filtered().length,view:VIEW,body:document.body.dataset.view,cards:[...document.querySelectorAll(".k-card")].length,compactRows:[...document.querySelectorAll(".compact-row")].length,cols:window._TK_COLS,quick:{open:QUICK.open,panel:!!$("#tkQuickPanel"),editor:!!$("#tkQrEditor"),qr:window.__qrSharedStatus?.()}});
const clientIdFromInput=async raw=>{const x=(raw||"").trim();if(!x)return null;if(/^[0-9a-f-]{8,}$/i.test(x))return x;const {data,error}=await s.from("clientes").select("id,nombre").ilike("nombre",`%${x}%`).limit(1);if(error||!data?.length)return null;return data[0].id};
const saveTicket=async()=>{if(SAVE_BUSY)return;const clienteRaw=$("#tkCliente")?.value?.trim()||"",nombre=$("#tkNombre")?.value?.trim()||"",correo=$("#tkCorreo")?.value?.trim()||"",telefono=$("#tkTelefono")?.value?.trim()||"",sistema=$("#tkSistema")?.value?.trim()||"",titulo=$("#tkTitulo")?.value?.trim()||"",desc=$("#tkDesc")?.value?.trim()||"",tipo=normTipo($("#tkTipo")?.value||"soporte"),prioridad=$("#tkPrioridad")?.value||"media",notificar=!!$("#tkNotificar")?.checked,cliente_id=/^[0-9a-f-]{8,}$/i.test(clienteRaw)?clienteRaw:null,empresa=cliente_id?"":clienteRaw;if(!titulo)return $("#tkStatus").textContent="El título es obligatorio.";if(titulo.length<6)return $("#tkStatus").textContent="El título es demasiado corto.";if(!desc||desc.length<8)return $("#tkStatus").textContent="Describe un poco más el caso.";if(false&&notificar&&!correo)return $("#tkStatus").textContent="Agrega un correo o desactiva el aviso al cliente.";SAVE_BUSY=true;$("#tkSave")&&($("#tkSave").disabled=true);$("#tkStatus").textContent="Creando ticket...";try{const payload={cliente_id,empresa,nombre,correo:"",telefono:"",sistema,titulo,descripcion:desc,tipo:"soporte",prioridad,notificar:false};const{data,error}=await s.functions.invoke("crear-ticket-interno",{body:payload});if(error){console.error("crear-ticket-interno error",error);throw new Error(error.message||"Error en Edge Function")}console.log("crear-ticket-interno data",data);if(!data?.ok)throw new Error(data?.error||data?.details||data?.hint||"No se pudo crear el ticket");$("#tkStatus").textContent=data.mail_sent?"Ticket creado y aviso enviado.":"Ticket creado.";hide("#tkModal");["tkCliente","tkNombre","tkCorreo","tkTelefono","tkSistema","tkTitulo","tkDesc"].forEach(id=>{$("#"+id)&&($("#"+id).value="")});$("#tkTipo")&&($("#tkTipo").value="soporte");$("#tkPrioridad")&&($("#tkPrioridad").value="media");$("#tkNotificar")&&($("#tkNotificar").checked=false);toast(data.mail_sent?`Ticket ${data.folio} creado · aviso enviado`:`Ticket ${data.folio} creado${data.mail_error?` · sin correo`:``}`,"ok");await load();if(data?.ticket_id){SELECTED_ID=String(data.ticket_id);renderAll();syncSelected()}}catch(e){const m=e?.message||String(e||"Error");$("#tkStatus")&&($("#tkStatus").textContent=m);toast(m,"bad")}finally{SAVE_BUSY=false;$("#tkSave")&&($("#tkSave").disabled=false)}};
const mobileBucket=s=>s==="resuelto"?"resuelto":s==="en_proceso"||s==="esperando_cliente"?"en_proceso":"abierto";
const setMobileStateSmart=want=>{if(!isMobileTickets())return;const rows=filtered().filter(t=>ticketStateKey(rawState(t))!=="cerrado"),c={abierto:0,en_proceso:0,resuelto:0};rows.forEach(t=>c[mobileBucket(ticketStateKey(rawState(t)))]++);let k=["abierto","en_proceso","resuelto"].includes(want)?want:MOBILE_STATE;if(!c[k])k=c.abierto?"abierto":c.en_proceso?"en_proceso":c.resuelto?"resuelto":"abierto";MOBILE_STATE=k;localStorage.setItem("tc_tickets_mobile_state",k);document.body.dataset.mobileState=k};
const setCompactGroupSmart=want=>{if(isMobileTickets()||VIEW!=="compact")return;const groups=compactGroups();let k=["abierto","en_proceso","resuelto"].includes(want)?want:COMPACT_GROUP;if(!groups[k]?.length)k=groups.abierto?.length?"abierto":groups.en_proceso?.length?"en_proceso":groups.resuelto?.length?"resuelto":"abierto";COMPACT_GROUP=k;COMPACT_PAGE=0;localStorage.setItem("tc_tickets_compact_group",k);localStorage.setItem("tc_tickets_compact_page","0")};
const isUuid=v=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v||""));
const moveTicket=async(id,next)=>{
  const estado=ticketStateKey(next),now=new Date().toISOString(),t=byId(id),patch={estado,fecha_actualizacion:now};

  // B2.7-N: compatibilidad con check tickets_asignado_en_requires_asignado_a_chk.
  // Si no hay asignado_a, no puede quedar asignado_en con fecha.
  if(!t?.asignado_a) patch.asignado_en=null;

  if(estado==="en_proceso"&&!t?.primera_respuesta_en)patch.primera_respuesta_en=now;

  try{
    if(!isUuid(id)){}
    else if(DEV_READONLY?.()){
      if(s.supabaseUrl&&s.supabaseKey)await window.__updateTicketRest(id,patch);
      else await demoPatchTicket(id,patch);
    }else{
      const {error}=await s.from("tickets").update(patch).eq("id",id);
      if(error)throw error;
    }
  }catch(e){
    return toast(msg(e),"bad");
  }

  if(t){
    t.estado=estado;
    t.fecha_actualizacion=now;
    if(!t.asignado_a)t.asignado_en=null;
    if(patch.primera_respuesta_en)t.primera_respuesta_en=patch.primera_respuesta_en;
  }

  SELECTED_ID=String(id);
  setMobileStateSmart(mobileBucket(estado));
  setCompactGroupSmart(mobileBucket(estado));
  toast("Estado actualizado","ok");
  setRailOpenCount(openCount(TK));
  renderAll();
  if(!$("#tkColModal")?.hidden)tkRenderColModal();
};
const CLOSE_ARMED={id:"",ts:0};
const armClose=id=>{const now=Date.now(),same=String(CLOSE_ARMED.id)===String(id)&&now-CLOSE_ARMED.ts<1600;CLOSE_ARMED.id=String(id);CLOSE_ARMED.ts=now;return same};
const closeTicket=async id=>{
  const now=new Date().toISOString(),t=byId(id),patch={estado:"cerrado",fecha_actualizacion:now,fecha_cierre:now};

  // B2.7-N: compatibilidad con check tickets_asignado_en_requires_asignado_a_chk.
  // Cerrar un ticket no debe fallar por un asignado_en huérfano.
  if(!t?.asignado_a) patch.asignado_en=null;

  try{
    if(!isUuid(id)){}
    else if(DEV_READONLY?.()){
      if(s.supabaseUrl&&s.supabaseKey)await window.__updateTicketRest(id,patch);
      else await demoPatchTicket(id,patch);
    }else{
      const{error}=await s.from("tickets").update(patch).eq("id",id);
      if(error)throw error;
    }
  }catch(e){
    return toast(msg(e),"bad");
  }

  if(t){
    t.estado="cerrado";
    t.fecha_actualizacion=now;
    t.fecha_cierre=now;
    if(!t.asignado_a)t.asignado_en=null;
  }

  const el=document.querySelector(`.k-card[data-id="${id}"],.compact-row[data-id="${id}"]`);
  el&&el.classList.add("is-closing");
  if(String(SELECTED_ID)===String(id))SELECTED_ID="";
  setMobileStateSmart("");
  setRailOpenCount(openCount(TK));
  syncSelected();
  toast("Ticket cerrado","ok");
  setTimeout(()=>{renderAll();if(!$("#tkColModal")?.hidden)tkRenderColModal()},220);
};
const onDynamicDragStart=e=>{e?.preventDefault?.();return false};const onDynamicDragEnd=()=>{};const bindBoardColumnDnD=()=>{};const bindBoardCardDnD=()=>{};

const sendQuickReply=async()=>{
  /* TK_SEND_CONFIRM_V5 */
  const sendBtn=$("#tkQuickSendBtn");
  const nowArm=Date.now();
  const armedUntil=Number(sendBtn?.dataset?.armedUntil||0);
  if(sendBtn&&nowArm>armedUntil){
    sendBtn.dataset.armedUntil=String(nowArm+2600);
    sendBtn.classList.add("is-armed");
    $("#tkQuickStatus")&&($("#tkQuickStatus").textContent="Toca enviar otra vez para confirmar la respuesta.");
    toast?.("Confirma tocando enviar otra vez.","warn");
    setTimeout(()=>{if(Number(sendBtn.dataset.armedUntil||0)<=Date.now()){sendBtn.classList.remove("is-armed");delete sendBtn.dataset.armedUntil}},2700);
    return;
  }
  if(sendBtn){sendBtn.classList.remove("is-armed");delete sendBtn.dataset.armedUntil}

  const t=selectedTicket?.();
  const txt=($("#tkQuickText")?.value||"").replace(/\n{3,}/g,"\n\n").trim();
  if(!t)return toast?.("Selecciona un ticket.","warn");
  if(!txt)return toast?.("Escribe o elige una respuesta.","warn");
  const btn=$("#tkQuickSendBtn");
  if(btn)btn.disabled=true;
  $("#tkQuickStatus")&&($("#tkQuickStatus").textContent="Guardando respuesta...");
  const sentAt=new Date().toISOString();
  const state=ticketStateKey(rawState(t));
  const entry={kind:"mensaje",autor:"soporte",titulo:"Respuesta de soporte",texto:txt,fecha:sentAt,adjuntos:[],meta:{source:"tickets_quick_reply",folio:t?.folio||null}};
  const timeline=Array.isArray(t?.timeline_publica)?t.timeline_publica:[];
  const patch={fecha_actualizacion:sentAt,timeline_publica:[...timeline,entry]};
  if(!t?.primera_respuesta_en)patch.primera_respuesta_en=sentAt;
  if(state==="abierto")patch.estado="en_proceso";
  try{
    if(DEV_READONLY?.()){
      if(s.supabaseUrl&&s.supabaseKey&&window.__updateTicketRest)await window.__updateTicketRest(t.id,patch);
      else await demoPatchTicket(t.id,patch);
    }else{
      const ev=await s.from("ticket_eventos").insert({
        ticket_id:t.id,
        autor_tipo:"soporte",
        visibilidad:"publica",
        kind:"mensaje",
        texto:txt,
        meta:{source:"tickets_quick_reply",folio:t?.folio||null}
      });
      if(ev.error)throw new Error(ev.error.message||"No se pudo registrar el evento de respuesta rápida.");
      const up=await s.from("tickets").update(patch).eq("id",t.id);
      if(up.error)throw up.error;
    }
    Object.assign(t,patch);
    if(patch.estado)t.estado=patch.estado;
    QUICK.lastCopied=txt;
    QUICK.draft="";
    QUICK.draftTicketId="";
    $("#tkQuickStatus")&&($("#tkQuickStatus").textContent="Respuesta enviada y guardada en el historial.");
    toast?.("Respuesta enviada.","ok");
    setQuickPanelOpen?.(false);
    renderAll?.();
    syncSelected?.();
    if(!$("#tkColModal")?.hidden)tkRenderColModal?.();
  }catch(e){
    console.error("TK_QUICK_SEND_ERROR",e);
    $("#tkQuickStatus")&&($("#tkQuickStatus").textContent=msg(e));
    toast?.(msg(e),"bad");
  }finally{
    if(btn)btn.disabled=false;
  }
};

const tkRelayoutQuickPanelFinal=()=>{
  const panel=$("#tkQuickPanel");
  if(!panel)return;
  panel.classList.add("tk-quick-final");
  const titleline=panel.querySelector(".tk-quick-titleline");
  const h=panel.querySelector("#tkQuickTitle");
  const tabs=$("#tkQuickScopeTabs");
  const edit=$("#tkQuickEditBtn");
  if(titleline){
    titleline.classList.add("tk-quick-titleline-final");
    if(tabs&&h&&tabs.parentElement!==titleline)h.insertAdjacentElement("afterend",tabs);
    if(edit&&edit.parentElement!==titleline)titleline.appendChild(edit);
  }
};
const tkFixQrEditorHeadFinal=()=>{
  const head=$("#tkQrEditor .tk-qr-columns-head");
  if(head&&!head.dataset.finalHead){
    head.innerHTML="<span>Título / intención</span><span>Mensaje de respuesta</span><span></span>";
    head.dataset.finalHead="1";
  }
};
const tkWireFinalUiLoop=()=>{
  if(document.documentElement.dataset.tkFinalUiLoop)return;
  document.documentElement.dataset.tkFinalUiLoop="1";
  setInterval(()=>{
    if(QUICK?.open)tkRelayoutQuickPanelFinal();
    if(!$("#tkQrEditor")?.classList.contains("hidden"))tkFixQrEditorHeadFinal();
  },250);
};
tkWireFinalUiLoop();
const openQuickFromButton=btn=>{mountQuickPanel();const raw=String(btn?.getAttribute("data-quick-panel")||btn?.dataset?.quickPanel||""),parts=raw.split("|"),card=btn?.closest(".k-card,.compact-row,.closed-row"),id=parts[0]||card?.dataset?.id||"",k=parts[1]||"modelo",t=byId(id),draftOk=QUICK.draft&&QUICK.draftTicketId===String(id);if(id){SELECTED_ID=String(id);syncSelected()}QUICK.lastAction=k;$("#tkQuickMeta")&&($("#tkQuickMeta").textContent=t?`${t.folio?`${t.folio} · `:""}${t.empresa_capturada||t.clientes?.nombre||"Sin registro"} · ${t.titulo||"Sin título"}`:"Ticket seleccionado");$("#tkQuickText")&&($("#tkQuickText").value=t?(draftOk?QUICK.draft:quickActionText(t,k)):"");document.querySelectorAll("#tkQuickBtns [data-qk]").forEach(b=>b.classList.toggle("btn-brand",b.dataset.qk===k));setQuickPanelOpen(true);tkRelayoutQuickPanelFinal?.();renderBoardQuickDb(t).then(()=>tkRelayoutQuickPanelFinal?.()).catch?.(()=>{});return true};
const moveFromButton=async btn=>{const raw=String(btn?.getAttribute("data-ticket-state")||btn?.dataset?.ticketState||""),parts=raw.split("|"),card=btn?.closest(".k-card,.compact-row"),id=parts[0]||card?.dataset?.id||"",next=parts[1]||"";if(id&&next)return await moveTicket(id,next);toast("No se pudo identificar el cambio de estado.","bad")};
const closeFromButton=async btn=>{const id=btn?.dataset?.ticketClose||btn?.closest(".k-card,.compact-row")?.dataset?.id||"";if(!id)return toast("No se pudo identificar el ticket.","bad");if(!armClose(id)){const prev=btn.textContent;btn.classList.add("is-armed");btn.textContent="Doble clic";setTimeout(()=>{btn.classList.remove("is-armed");btn.textContent=prev||"✓"},1500);return}return await closeTicket(id)};

const toggleView=()=>{if(isMobileTickets()){VIEW="kanban";localStorage.setItem("tc_tickets_view","kanban");$("#tkBoard")?.classList.remove("hidden");$("#tkCompact")?.classList.add("hidden");renderAll();return}VIEW=VIEW==="kanban"?"compact":"kanban";$("#tkBoard")?.classList.toggle("hidden",VIEW==="compact");$("#tkCompact")?.classList.toggle("hidden",VIEW!=="compact");document.querySelector(".board-layout")?.classList.remove("hidden");localStorage.setItem("tc_tickets_view",VIEW);syncHeaderIconButtons();renderAll();syncSelected();if(QUICK.open)fillQuickPanel(QUICK.lastAction||"modelo")};
const bindKeyboard=()=>{if(document.documentElement.dataset.ticketsKeyboardBound)return;document.documentElement.dataset.ticketsKeyboardBound="1";document.addEventListener("keydown",async e=>{const tag=(e.target?.tagName||"").toLowerCase(),t=selectedTicket();if(tag==="input"||tag==="textarea"||tag==="select"||e.metaKey||e.ctrlKey||e.altKey||!t)return;if(e.key==="Enter"){e.preventDefault();return openTicketDetail(t.id,QUICK.open?(QUICK.lastAction||""):"")}if(e.key==="e"||e.key==="E"){e.preventDefault();return await moveTicket(t.id,"en_proceso")}if(e.key==="w"||e.key==="W"){e.preventDefault();return await moveTicket(t.id,"esperando_cliente")}if(e.key==="r"||e.key==="R"){e.preventDefault();return await moveTicket(t.id,"resuelto")}if(e.key==="q"||e.key==="Q"){e.preventDefault();QUICK.lastAction=QUICK.lastAction||"modelo";return fillQuickPanel(QUICK.lastAction)}if(e.key==="x"||e.key==="X"){e.preventDefault();return await runQuickCopy(t.id,"modelo")}if(e.key==="p"||e.key==="P"){e.preventDefault();return await runQuickCopy(t.id,"evidencia")}if((e.key==="c"||e.key==="C")&&ticketStateKey(rawState(t))==="resuelto"){e.preventDefault();return await closeTicket(t.id)}})};
const HDR_ICONS={filter:"../IMG/filtro.png",clear:"../IMG/borrar.webp",list:"../IMG/listaa.webp",kanban:"../IMG/kanban.webp",gear:"../IMG/configuracion.webp",new:"../IMG/nuevo.webp"};
const setHeaderBtnIcon=(sel,src,label)=>{const b=$(sel);if(!b)return;b.dataset.iconOnly="1";b.setAttribute("aria-label",label);b.setAttribute("title",label);b.innerHTML=`<img class="hdr-btn-icon" src="${src}" alt="${label}" loading="eager" decoding="async">`};
const syncHeaderIconButtons=()=>{setHeaderBtnIcon("#tkMoreFiltersBtn",HDR_ICONS.filter,"Filtros");setHeaderBtnIcon("#tkClearFilters",HDR_ICONS.clear,"Limpiar filtros");setHeaderBtnIcon("#tkViewBtn",VIEW==="kanban"?HDR_ICONS.list:HDR_ICONS.kanban,VIEW==="kanban"?"Ver lista":"Ver kanban");setHeaderBtnIcon("#tkGearBtn",HDR_ICONS.gear,"Opciones");$("#tkNewBtn")&&($("#tkNewBtn").innerHTML="",$("#tkNewBtn").setAttribute("aria-label","Nuevo ticket"),$("#tkNewBtn").setAttribute("title","Nuevo ticket"))};
const clearAllFilters=()=>{resetFilters();const url=new URL(location.href);url.searchParams.delete("kpi");history.replaceState(history.state,"",url);syncFilterUI();ensureSelectedVisible();renderAll();syncSelected();syncHeaderClearBtns();closeTicketMenus()};

const setSelectVal=(id,v)=>{const el=$("#"+id);if(el)el.value=v||""};
const syncKpiUrl=(kind,active)=>{const key={urgent:"urgent",wait:"waiting",stale:"urgent_stale",solved:"resolved",fr:"first_response_overdue",rs:"sla_overdue"}[kind],url=new URL(location.href);if(key&&active)url.searchParams.set("kpi",key);else url.searchParams.delete("kpi");history.pushState(history.state,"",url)};
const metricFilter=kind=>{if(kind==="urgent"){const active=FILTER.priority!=="urgente";FILTER.state="";FILTER.urgentStale=false;setSelectVal("tkFilterState","");setSelectVal("tkFilterPriority",active?"urgente":"");syncKpiUrl(kind,active);return applyFilters()}if(kind==="wait"){const active=FILTER.state!=="esperando_cliente";FILTER.priority="";FILTER.urgentStale=false;setSelectVal("tkFilterPriority","");setSelectVal("tkFilterState",active?"esperando_cliente":"");syncKpiUrl(kind,active);return applyFilters()}if(kind==="stale"){FILTER.state="";FILTER.priority="";setSelectVal("tkFilterState","");setSelectVal("tkFilterPriority","");FILTER.urgentStale=!FILTER.urgentStale;syncKpiUrl(kind,FILTER.urgentStale);syncFilterUI();ensureSelectedVisible();return renderAll()}if(kind==="solved"){const active=FILTER.state!=="resuelto";FILTER.priority="";FILTER.urgentStale=false;setSelectVal("tkFilterPriority","");setSelectVal("tkFilterState",active?"resuelto":"");syncKpiUrl(kind,active);return applyFilters()}if(kind==="noClient"){FILTER.noClientLinked=!FILTER.noClientLinked;syncFilterUI();ensureSelectedVisible();return renderAll()}if(kind==="fr"){FILTER.frBreach=!FILTER.frBreach;syncKpiUrl(kind,FILTER.frBreach);syncFilterUI();ensureSelectedVisible();return renderAll()}if(kind==="rs"){FILTER.rsBreach=!FILTER.rsBreach;syncKpiUrl(kind,FILTER.rsBreach);syncFilterUI();ensureSelectedVisible();return renderAll()}if(kind==="soon"){FILTER.slaSoon=!FILTER.slaSoon;syncFilterUI();ensureSelectedVisible();return renderAll()}};
const colPageClick=(id)=>{const m=String(id||"").match(/^(prev|next)-(.+)$/);if(!m)return false;const dir=m[1],key=m[2];if(!Object.prototype.hasOwnProperty.call(COL_PAGE,key))return false;COL_PAGE[key]=dir==="prev"?Math.max(0,(COL_PAGE[key]||0)-1):(COL_PAGE[key]||0)+1;renderAll();return true};
const closedClick=(target)=>{if(target.closest("#tkToggleClosed")){$("#tkAdvancedFilters")?.classList.add("hidden");$("#tkMoreFiltersBtn")?.setAttribute("aria-expanded","false");$("#tkToggleClosed")?.setAttribute("aria-expanded","true");openClosedModal();return true}if(target.closest("#tkClosedClose")){$("#tkToggleClosed")?.setAttribute("aria-expanded","false");closeClosedModal();return true}if(target.closest("#tkClosedPrev")){if((CLOSED.page||0)>0){CLOSED.page--;renderClosed()}return true}if(target.closest("#tkClosedNext")){const total=closedTotalPages(closedFiltered());if((CLOSED.page||0)<total-1){CLOSED.page++;renderClosed()}return true}const range=target.closest("[data-closed-range]");if(range){CLOSED.range=range.dataset.closedRange||"30d";CLOSED.page=0;renderClosed();return true}return false};

const toggleThemeLocal=()=>{const h=document.documentElement,cur=h.dataset.theme||localStorage.getItem("tc_theme")||"light",next=cur==="dark"?"light":"dark";h.dataset.theme=next;localStorage.setItem("tc_theme",next);document.querySelectorAll("[data-theme-label]").forEach(x=>x.textContent=next==="dark"?"Oscuro":"Claro");toast(next==="dark"?"Modo oscuro":"Modo claro","ok")};

const ticketClickRouter=async e=>{const t=e.target;if(!t?.closest)return;const hit=s=>t.closest(s);if(hit("#tkNewBtn")){e.preventDefault();e.stopPropagation();return openNewTicketModal()}if(hit("#tkViewBtn")){e.preventDefault();e.stopPropagation();toggleView();if(!isMobileTickets()&&VIEW==="compact"){mountCompactModeTabs();renderCompact();bindCompactUi?.()}return}if(hit("#tkGearBtn")){e.preventDefault();e.stopPropagation();return toggleGearMenu(e)}if(hit("[data-theme-toggle]")){e.preventDefault();e.stopPropagation();return toggleThemeLocal()}if(hit("#tkMoreFiltersBtn")){e.preventDefault();e.stopPropagation();return toggleFilterMenu(e)}if(hit("#tkClearFilters,#tkClearFiltersMobile")){e.preventDefault();e.stopPropagation();return clearAllFilters()}if(hit("#tkRefresh")){e.preventDefault();e.stopPropagation();const keep=SELECTED_ID;return load().then(()=>{if(keep&&byId(keep)){SELECTED_ID=String(keep);renderAll();syncSelected()}}).catch(err=>toast(msg(err),"bad")).finally(()=>closeTicketMenus())}if(hit("#tkQuickOpenInline")){e.preventDefault();e.stopPropagation();QUICK.lastAction=QUICK.lastAction||"modelo";return fillQuickPanel(QUICK.lastAction)}if(hit("#tkMetricsLessBtn")){e.preventDefault();e.stopPropagation();setKpiExpanded(false);if(typeof syncHeroMetrics==="function")syncHeroMetrics();return}const compactGroup=hit("[data-compact-group]");if(compactGroup){e.preventDefault();e.stopImmediatePropagation?.();const g=compactGroup.getAttribute("data-compact-group")||"abierto";COMPACT_GROUP=["abierto","en_proceso","resuelto"].includes(g)?g:"abierto";COMPACT_PAGE=0;localStorage.setItem("tc_tickets_compact_group",COMPACT_GROUP);localStorage.setItem("tc_tickets_compact_page","0");renderCompact();bindCompactUi?.();return}if(hit("#tkCompactPrev")){e.preventDefault();e.stopPropagation();COMPACT_PAGE=Math.max(0,(COMPACT_PAGE||0)-1);localStorage.setItem("tc_tickets_compact_page",String(COMPACT_PAGE));renderCompact();bindCompactUi?.();return}if(hit("#tkCompactNext")){e.preventDefault();e.stopPropagation();COMPACT_PAGE=(COMPACT_PAGE||0)+1;localStorage.setItem("tc_tickets_compact_page",String(COMPACT_PAGE));renderCompact();bindCompactUi?.();return}const pager=hit("[id^='prev-'],[id^='next-']");if(pager){e.preventDefault();e.stopPropagation();return colPageClick(pager.id)}const metric=hit("#metricUrgent,#metricWait,#metricStale,#metricSolved,#metricNoClient,#metricFrBreach,#metricRsBreach,#metricSlaSoon,#tkOnlyUrgent");if(metric){e.preventDefault();e.stopPropagation();const map={metricUrgent:"urgent",tkOnlyUrgent:"urgent",metricWait:"wait",metricStale:"stale",metricSolved:"solved",metricNoClient:"noClient",metricFrBreach:"fr",metricRsBreach:"rs",metricSlaSoon:"soon"};return metricFilter(map[metric.id])}const pill=hit("#tkNoEvidence,#tkImpactHigh,#tkUrgentStale,#tkNoClientLinked,#tkMatchMedium,#tkFrBreach,#tkRsBreach,#tkSlaSoon");if(pill){e.preventDefault();e.stopPropagation();const map={tkNoEvidence:"noEvidence",tkImpactHigh:"impactHigh",tkUrgentStale:"urgentStale",tkNoClientLinked:"noClientLinked",tkMatchMedium:"matchMedium",tkFrBreach:"frBreach",tkRsBreach:"rsBreach",tkSlaSoon:"slaSoon"};return flipFilter(map[pill.id])}if(hit("#tkQuickEditBtn")){e.preventDefault();e.stopPropagation();return openQuickEditor()}
if(hit("#tkQrClose")){e.preventDefault();e.stopPropagation();return closeQuickEditor()}
const scopeBtn=hit("[data-board-qrscope]");if(scopeBtn){e.preventDefault();e.stopPropagation();qrBoardCollect();return qrBoardLoad(scopeBtn.dataset.boardQrscope||"global")}
if(hit("#tkQrBoardAdd")){e.preventDefault();e.stopPropagation();qrBoardCollect();if(QRB.rows.length>=10)return toast("Máximo 10 respuestas.","warn");QRB.rows.push({titulo:`Respuesta ${QRB.rows.length+1}`,texto:""});return qrBoardPaint()}
if(hit("#tkQrBoardSave")){e.preventDefault();e.stopPropagation();return qrBoardSave()}
const delQr=hit("[data-board-qrdel]");if(delQr){e.preventDefault();e.stopPropagation();return tkQrDelPend(Number(delQr.dataset.boardQrdel))}
const dbQr=hit("[data-board-qrtext]");if(dbQr){e.preventDefault();e.stopPropagation();const tk=selectedTicket();const txt=qrTpl(dbQr.dataset.boardQrtext||"",tk||{});$("#tkQuickText")&&($("#tkQuickText").value=txt);return}
const qk=hit("#tkQuickBtns [data-qk]");if(qk){e.preventDefault();e.stopPropagation();const tk=selectedTicket();if(!tk)return toast("Primero selecciona un ticket.","warn");const k=qk.dataset.qk||"modelo";QUICK.lastAction=k;QUICK.lastCopied=quickActionText(tk,k);$("#tkQuickText")&&($("#tkQuickText").value=QUICK.lastCopied);document.querySelectorAll("#tkQuickBtns [data-qk]").forEach(b=>b.classList.toggle("btn-brand",b.dataset.qk===k));return setQuickPanelOpen(true)}if(hit("#tkQuickSendBtn")){e.preventDefault();e.stopPropagation();return await sendQuickReply()}if(hit("#tkQuickClose,#tkQuickBackdrop")){e.preventDefault();e.stopPropagation();return setQuickPanelOpen(false)}const cm=hit("[data-col-modal]");if(cm){e.preventDefault();e.stopPropagation();return tkOpenColModal(cm.dataset.colModal)}if(hit("#tkColModalClose")){e.preventDefault();e.stopPropagation();return tkCloseColModal()}if(e.target?.id==="tkColModal"){e.preventDefault();e.stopPropagation();return tkCloseColModal()}if(hit("#tkColModalPrev")){e.preventDefault();e.stopPropagation();TK_COL_MODAL.page=Math.max(0,TK_COL_MODAL.page-1);return tkRenderColModal()}if(hit("#tkColModalNext")){e.preventDefault();e.stopPropagation();TK_COL_MODAL.page++;return tkRenderColModal()}const quick=hit("[data-quick-panel]");if(quick){e.preventDefault();e.stopPropagation();return openQuickFromButton(quick)}const move=hit("[data-ticket-state]");if(move){e.preventDefault();e.stopPropagation();return await moveFromButton(move)}const close=hit("[data-ticket-close]");if(close){e.preventDefault();e.stopPropagation();return await closeFromButton(close)}const open=hit("[data-open-ticket]");if(open){e.preventDefault();e.stopPropagation();return openTicketDetail(open.dataset.openTicket)}if(closedClick(t)){e.preventDefault();e.stopPropagation();return}
const card=hit(".k-card,.compact-row,.closed-row");if(card&&!hit("a,button,input,select,textarea,label,[data-ticket-state],[data-ticket-close],[data-quick-panel],[data-compact-group],#tkCompactPrev,#tkCompactNext")){e.preventDefault();e.stopPropagation();SELECTED_ID=String(card.dataset.id||"");syncSelected();return openTicketDetail(card.dataset.id)}};

const metricNum=id=>Number(($("#"+id)?.textContent||"0").replace(/\D+/g,""))||0;
const syncHeroMetrics=()=>{const defs=[["metricUrgent","mUrgent"],["metricWait","mWait"],["metricStale","mStale"],["metricSolved","mSolved"],["metricNoClient","mNoClient"],["metricFrBreach","mFrBreach"],["metricRsBreach","mRsBreach"],["metricSlaSoon","mSlaSoon"]],box=$("#tkMetricsStrip")||document.querySelector(".hero-metrics");let shown=0;defs.forEach(([id,countId])=>{const el=$("#"+id);if(!el)return;const n=metricNum(countId);const hide=!(n>0);el.classList.toggle("is-empty",hide);el.hidden=hide;if(!hide)shown++});if(box){box.classList.toggle("is-empty",shown===0);box.hidden=shown===0}const mu=$("#metricUrgent"),ms=$("#metricStale");if(mu)mu.classList.toggle("metric-pill-bad",metricNum("mUrgent")>0);if(ms)ms.classList.toggle("metric-pill-warn",metricNum("mStale")>0)};
const normalizeFilterPopup=()=>{const a=$("#tkAdvancedFilters .tk-filter-actions");if(!a)return;a.innerHTML=`<button class="btn btn-ghost" id="tkUrgentStale" type="button">Urgentes y sin tocar</button><button class="btn btn-ghost" id="tkFrBreach" type="button">Respuesta vencida</button>`;$("#tkReadyClose")?.remove();["tkUrgentStale","tkFrBreach","tkRsBreach","tkSlaSoon"].forEach(id=>[...document.querySelectorAll("#"+id)].slice(1).forEach(x=>x.remove()))};const bindStatic=()=>{mountQuickPanel();if(document.documentElement.dataset.ticketsBound)return;document.documentElement.dataset.ticketsBound="1";bindModal("#tkModal");closeNewTicketModal();$("#tkClose")&&($("#tkClose").onclick=e=>{e.preventDefault();e.stopPropagation();closeNewTicketModal()});$("#tkCancel")&&($("#tkCancel").onclick=e=>{e.preventDefault();e.stopPropagation();closeNewTicketModal()});$("#tkModal")&&($("#tkModal").onclick=e=>{if(e.target?.id==="tkModal")closeNewTicketModal()});syncBoardNotifUI();setKpiExpanded(KPI_EXPANDED());if(!document.documentElement.dataset.heroMetricsBound){document.documentElement.dataset.heroMetricsBound="1";setTimeout(syncHeroMetrics,0);const m=$("#tkMetricsStrip");m&&new MutationObserver(syncHeroMetrics).observe(m,{subtree:true,childList:true,characterData:true})}$("#tkClosedClose")&&($("#tkClosedClose").onclick=()=>{$("#tkToggleClosed")?.setAttribute("aria-expanded","false");closeClosedModal()});$("#tkClosedModal")&&($("#tkClosedModal").onclick=e=>{if(e.target?.id==="tkClosedModal"){$("#tkToggleClosed")?.setAttribute("aria-expanded","false");closeClosedModal()}});document.querySelectorAll("[data-closed-range]").forEach(b=>b.onclick=()=>{CLOSED.range=b.dataset.closedRange||"30d";CLOSED.page=0;renderClosed()});document.addEventListener("input",debounce(e=>{if(e.target?.matches?.("#tkClosedQ")){CLOSED.q=e.target.value||"";CLOSED.page=0;renderClosed()}},140),true);$("#tkClosedPrev")&&($("#tkClosedPrev").onclick=()=>{if((CLOSED.page||0)>0){CLOSED.page--;renderClosed()}});$("#tkClosedNext")&&($("#tkClosedNext").onclick=()=>{const total=closedTotalPages(closedFiltered());if((CLOSED.page||0)<total-1){CLOSED.page++;renderClosed()}});document.addEventListener("keydown",e=>{if(e.key!=="Escape")return;if(QRB_DEL_IDX>=0){tkQrDelCancel();return}if(!$("#tkQrEditor")?.classList.contains("hidden")){closeQuickEditor();return}if(QUICK.open)setQuickPanelOpen(false);if(!$("#tkColModal")?.hidden)tkCloseColModal();if(!$("#tkModal")?.hidden)closeNewTicketModal();if(!$("#tkClosedModal")?.hidden){$("#tkToggleClosed")?.setAttribute("aria-expanded","false");closeClosedModal()}closeTicketMenus()});document.addEventListener("input",debounce(e=>{if(e.target?.matches?.("#tkColModalSearch")){TK_COL_MODAL.q=e.target.value||"";TK_COL_MODAL.page=0;tkRenderColModal()}},120),true);$("#prev-abierto")?.addEventListener("click",()=>{COL_PAGE.abierto=Math.max(0,(COL_PAGE.abierto||0)-1);renderAll()});$("#next-abierto")?.addEventListener("click",()=>{COL_PAGE.abierto=(COL_PAGE.abierto||0)+1;renderAll()});$("#prev-en_proceso")?.addEventListener("click",()=>{COL_PAGE.en_proceso=Math.max(0,(COL_PAGE.en_proceso||0)-1);renderAll()});$("#next-en_proceso")?.addEventListener("click",()=>{COL_PAGE.en_proceso=(COL_PAGE.en_proceso||0)+1;renderAll()});$("#prev-esperando_cliente")?.addEventListener("click",()=>{COL_PAGE.esperando_cliente=Math.max(0,(COL_PAGE.esperando_cliente||0)-1);renderAll()});$("#next-esperando_cliente")?.addEventListener("click",()=>{COL_PAGE.esperando_cliente=(COL_PAGE.esperando_cliente||0)+1;renderAll()});$("#prev-resuelto")?.addEventListener("click",()=>{COL_PAGE.resuelto=Math.max(0,(COL_PAGE.resuelto||0)-1);renderAll()});$("#next-resuelto")?.addEventListener("click",()=>{COL_PAGE.resuelto=(COL_PAGE.resuelto||0)+1;renderAll()});$("#tkRefresh")?.addEventListener("click",()=>{const keep=SELECTED_ID;load().then(()=>{if(keep&&byId(keep)){SELECTED_ID=String(keep);renderAll()}}).catch(err=>toast(msg(err),"bad"));closeTicketMenus()});$("#tkQuickOpenInline")?.addEventListener("click",()=>{QUICK.lastAction=QUICK.lastAction||"modelo";fillQuickPanel(QUICK.lastAction)});$("#tkSave")?.addEventListener("click",saveTicket);$("#tkCorreo")?.addEventListener("input",syncNotifyHint);$("#tkMetricsLessBtn")?.addEventListener("click",()=>setKpiExpanded(false));$("#tkEditModeChk")?.remove();$("#tkNotifVisual")?.addEventListener("change",e=>{BOARD_NOTIF.visual=!!e.target.checked;saveBoardNotif()});$("#tkNotifSound")?.addEventListener("change",e=>{BOARD_NOTIF.sound=!!e.target.checked;saveBoardNotif()});$("#tkNotifStrongOnly")?.addEventListener("change",e=>{BOARD_NOTIF.strongOnly=!!e.target.checked;saveBoardNotif()});$("#tkNotifVolume")?.addEventListener("input",e=>{BOARD_NOTIF.volume=Number(e.target.value||0.5);saveBoardNotif()});$("#tkSearch")?.addEventListener("input",debounce(applyFilters,180));document.addEventListener("change",e=>{if(e.target?.matches?.("#tkFilterPriority,#tkFilterState,#tkFilterType"))applyFilters()},true);document.addEventListener("change",e=>{const x=e.target;if(!x?.matches)return;if(x.matches("#tkEditModeChk"))return setEditMode(!!x.checked);if(x.matches("#tkNotifVisual")){BOARD_NOTIF.visual=!!x.checked;return saveBoardNotif()}if(x.matches("#tkNotifSound")){BOARD_NOTIF.sound=!!x.checked;return saveBoardNotif()}if(x.matches("#tkNotifStrongOnly")){BOARD_NOTIF.strongOnly=!!x.checked;return saveBoardNotif()}if(x.matches("#tkNotifVolume")){BOARD_NOTIF.volume=Number(x.value||0.5);return saveBoardNotif()}},true);document.addEventListener("input",debounce(e=>{if(e.target?.matches?.("#tkFilterClient"))applyFilters()},180),true);document.addEventListener("click",e=>{const b=e.target?.closest?.("#tkCompactSwitch [data-compact-group]");if(!b)return;e.preventDefault();e.stopImmediatePropagation?.();const g=b.dataset.compactGroup||"abierto";COMPACT_GROUP=["abierto","en_proceso","resuelto"].includes(g)?g:"abierto";COMPACT_PAGE=0;localStorage.setItem("tc_tickets_compact_group",COMPACT_GROUP);localStorage.setItem("tc_tickets_compact_page","0");renderCompact();bindCompactUi?.()},true);document.addEventListener("click",async e=>{const t=e.target;if(!t?.closest)return;const hit=s=>t.closest(s);const colBtn=hit("[data-col-modal]");if(colBtn){e.preventDefault();e.stopImmediatePropagation?.();return tkOpenColModal(colBtn.dataset.colModal||"abierto")}const colClose=hit("#tkColModalClose");if(colClose){e.preventDefault();e.stopImmediatePropagation?.();return tkCloseColModal()}const colOverlay=hit("#tkColModal");if(colOverlay&&e.target===colOverlay){e.preventDefault();e.stopImmediatePropagation?.();return tkCloseColModal()}const colPrev=hit("#tkColModalPrev");if(colPrev){e.preventDefault();e.stopImmediatePropagation?.();TK_COL_MODAL.page=Math.max(0,TK_COL_MODAL.page-1);return tkRenderColModal()}const colNext=hit("#tkColModalNext");if(colNext){e.preventDefault();e.stopImmediatePropagation?.();TK_COL_MODAL.page++;return tkRenderColModal()}const pager=hit(".col-pager [id^='prev-'],.col-pager [id^='next-']");if(pager){e.preventDefault();e.stopImmediatePropagation?.();return colPageClick(pager.id)}const move=hit("[data-ticket-state]"),quick=hit("[data-quick-panel]"),close=hit("[data-ticket-close]");if(move||quick||close){e.preventDefault();e.stopImmediatePropagation?.();if(move)return await moveFromButton(move);if(quick)return openQuickFromButton(quick);if(close)return await closeFromButton(close)}const metric=hit("#metricUrgent,#metricWait,#metricStale,#metricSolved,#metricNoClient,#metricFrBreach,#metricRsBreach,#metricSlaSoon,#tkOnlyUrgent");if(metric){e.preventDefault();e.stopImmediatePropagation?.();const map={metricUrgent:"urgent",tkOnlyUrgent:"urgent",metricWait:"wait",metricStale:"stale",metricSolved:"solved",metricNoClient:"noClient",metricFrBreach:"fr",metricRsBreach:"rs",metricSlaSoon:"soon"};return metricFilter(map[metric.id])}const pill=hit("#tkUrgentStale,#tkFrBreach,#tkRsBreach,#tkSlaSoon,#tkNoEvidence,#tkImpactHigh,#tkNoClientLinked,#tkMatchMedium");if(pill){e.preventDefault();e.stopImmediatePropagation?.();const map={tkUrgentStale:"urgentStale",tkFrBreach:"frBreach",tkRsBreach:"rsBreach",tkSlaSoon:"slaSoon",tkNoEvidence:"noEvidence",tkImpactHigh:"impactHigh",tkNoClientLinked:"noClientLinked",tkMatchMedium:"matchMedium"};return flipFilter(map[pill.id])}const qk=hit("#tkQuickBtns [data-qk]");if(qk){e.preventDefault();e.stopImmediatePropagation?.();const tk=selectedTicket();if(!tk)return toast("Primero selecciona un ticket.","warn");const k=qk.dataset.qk||"modelo";QUICK.lastAction=k;QUICK.lastCopied=quickActionText(tk,k);$("#tkQuickText")&&($("#tkQuickText").value=QUICK.lastCopied);document.querySelectorAll("#tkQuickBtns [data-qk]").forEach(b=>b.classList.toggle("btn-brand",b.dataset.qk===k));return setQuickPanelOpen(true)}if(hit("#tkQuickSendBtn")){e.preventDefault();e.stopImmediatePropagation?.();return await sendQuickReply()}if(hit("#tkQuickClose,#tkQuickBackdrop")){e.preventDefault();e.stopImmediatePropagation?.();return setQuickPanelOpen(false)}if(hit("#tkRefresh")){e.preventDefault();e.stopImmediatePropagation?.();const keep=SELECTED_ID;return load().then(()=>{if(keep&&byId(keep)){SELECTED_ID=String(keep);renderAll();syncSelected()}}).catch(err=>toast(msg(err),"bad")).finally(()=>closeTicketMenus())}},true);document.addEventListener("click",e=>{const card=e.target?.closest?.(".k-card,.compact-row,.closed-row");if(!card)return;if(e.target.closest("a,button,input,select,textarea,label,[data-ticket-state],[data-ticket-close],[data-quick-panel],[data-compact-group],#tkCompactPrev,#tkCompactNext"))return;e.preventDefault();e.stopImmediatePropagation?.();SELECTED_ID=String(card.dataset.id||"");syncSelected?.();if(card.dataset.id)openTicketDetail(card.dataset.id)},true);document.addEventListener("click",e=>{const t=e.target;if(!tkSurfaceOpen())return;if(t.closest("#tkMobileStatebar,#tkMoreFiltersBtn,#tkAdvancedFilters,.tk-filter-pop,#tkGearBtn,#tkGearMenu,.tickets-gear-menu,#tkNewBtn,#tkModal,.tk-new-modal,#tkToggleClosed,#tkClosedModal,.tk-closed-modal,#tkQuickPanel,#tkQuickBackdrop,.tk-quick-panel,#tkQrEditor,.tk-qr-editor"))return;e.preventDefault();e.stopImmediatePropagation?.();tkCloseSurfaces()},true);$("#tkHeroMinBtn")&&($("#tkHeroMinBtn").onclick=e=>{e.preventDefault();e.stopPropagation();$(".tickets-hero")?.classList.toggle("is-collapsed")});if(typeof normalizeFilterPopup==="function")normalizeFilterPopup();syncHeaderIconButtons();tkWireFilterActiveFallback?.();tkSyncFilterActiveUi?.();tkWireNotif2K?.();tkGearNormalize2K?.();if(typeof bindKeyboard==="function")bindKeyboard()};

let TK_TEST_AUDIO_CTX=null;
const tkStopTestSound2K=()=>{
  try{TK_TEST_AUDIO_CTX?.close?.()}catch{}
  TK_TEST_AUDIO_CTX=null;
};

const tkPlayTestSound2K=()=>{
  // B2.7-K: sonido de prueba controlado; nunca queda sonando.
  try{
    tkStopTestSound2K();

    const C=window.AudioContext||window.webkitAudioContext;
    if(!C)return window.__tkNotifyBeep?.();

    const ctx=new C();
    TK_TEST_AUDIO_CTX=ctx;

    const type=BOARD_NOTIF?.soundType||"chime";
    const vol=Math.max(.03,Math.min(1,Number(BOARD_NOTIF?.volume??.5)));

    const packs={
      ding:[[880,0,.12,"sine"]],
      pop:[[520,0,.09,"triangle"]],
      chime:[[660,0,.09,"sine"],[990,.12,.13,"sine"]],
      doble:[[740,0,.08,"triangle"],[740,.13,.10,"triangle"]],
      urgente:[[880,0,.07,"square"],[660,.09,.07,"square"],[880,.18,.10,"square"]]
    };

    const tones=packs[type]||packs.chime;
    const now=ctx.currentTime;

    tones.forEach(([freq,delay,dur,wave])=>{
      const osc=ctx.createOscillator();
      const gain=ctx.createGain();

      osc.type=wave||"sine";
      osc.frequency.setValueAtTime(freq,now+delay);

      gain.gain.setValueAtTime(0,now+delay);
      gain.gain.linearRampToValueAtTime(vol*.18,now+delay+.012);
      gain.gain.exponentialRampToValueAtTime(.001,now+delay+dur);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now+delay);
      osc.stop(now+delay+dur+.035);
    });

    const total=Math.max(...tones.map(t=>t[1]+t[2]))+.12;
    setTimeout(()=>{
      if(TK_TEST_AUDIO_CTX===ctx)tkStopTestSound2K();
    },Math.ceil(total*1000));
  }catch(e){
    console.warn("TK_SOUND_2K_ERROR",e);
    tkStopTestSound2K();
  }
};

const tkNotifSync2K=()=>{
  try{
    [
      ["tkNotifVisual","visual"],
      ["tkNotifSound","sound"],
      ["tkNotifStrongOnly","strongOnly"]
    ].forEach(([id,key])=>{
      const x=$("#"+id);
      if(!x)return;
      x.checked=!!BOARD_NOTIF[key];
      x.closest("label")?.classList.toggle("is-on",!!x.checked);
    });

    $("#tkNotifVolume")&&($("#tkNotifVolume").value=String(Number(BOARD_NOTIF.volume??.5)));
    $("#tkNotifSoundType")&&($("#tkNotifSoundType").value=BOARD_NOTIF.soundType||"chime");
  }catch(e){
    console.warn("TK_NOTIF_SYNC_WARN",e);
  }
};

const tkGearNormalize2K=()=>{
  const root=$("#tkGearMenu");
  if(!root)return;

  root.querySelectorAll('[data-gear-tab],.tickets-gear-tabs,.tickets-gear-tabbar,.gear-tabbar,.gear-tabs,[data-tk-bg],#tkBgUrl,#tkBgUrlBtn,#tkBgUpload,#tkBgIntensity').forEach(el=>{
    const box=el.closest(".tickets-gear-section,label,.thread-opt,.field,.stack-sm,.tk-bg-row,div")||el;
    box.style.display="none";
  });

  root.querySelectorAll(".tickets-gear-title-icon").forEach(el=>el.style.display="none");

  let order=$("#tkNotifOrderBox");
  if(!order){
    order=document.createElement("div");
    order.id="tkNotifOrderBox";
    order.className="tickets-gear-section tk-notif-order-box";
    order.innerHTML=`<div class="tickets-gear-title">Orden de tickets</div>
      <div class="tk-order-grid">
        <button class="mini btn-ghost" type="button" data-tk-order="chrono">Cronológica</button>
        <button class="mini btn-ghost" type="button" data-tk-order="smart">Inteligente</button>
      </div>
      <p class="mut">Cronológica es la vista normal. Inteligente prioriza urgentes, vencidos y sin tocar.</p>`;
  }

  order.classList.remove("tk-b26-hidden");

  const head=root.querySelector(".tk-popup-head-canonical");
  if(head && head.nextElementSibling!==order){
    head.insertAdjacentElement("afterend",order);
  }else if(!head && root.firstElementChild!==order){
    root.prepend(order);
  }

  const touched=localStorage.getItem("tc_tickets_order_touched")==="1";
  const mode=touched?(localStorage.getItem(TK_ORDER_KEY)||""):"";

  root.querySelectorAll("[data-tk-order]").forEach(btn=>{
    const on=touched && btn.dataset.tkOrder===mode;
    btn.classList.toggle("is-on",on);
    btn.classList.toggle("is-active",on);
    btn.classList.toggle("btn-brand",on);
    btn.setAttribute("aria-pressed",on?"true":"false");

    if(!btn.dataset.tkOrderBoundB27J){
      btn.dataset.tkOrderBoundB27J="1";
      btn.addEventListener("click",e=>{
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();

        const next=btn.dataset.tkOrder||"chrono";
        localStorage.setItem("tc_tickets_order_touched","1");
        localStorage.setItem(TK_ORDER_KEY,next);
        localStorage.removeItem("tc_tickets_order");

        tkSyncOrderControls?.();
        tkGearNormalize2K();
        window.__tkB26NormalizePopups?.();
        renderAll?.();

        return toast?.(next==="smart"?"Orden inteligente activo":"Orden cronológico activo","ok");
      },true);
    }
  });

  tkNotifSync2K();
};

const tkApplyNotifControl=x=>{
  if(!x?.id)return false;

  if(x.id==="tkNotifVisual")BOARD_NOTIF.visual=!!x.checked;
  else if(x.id==="tkNotifSound")BOARD_NOTIF.sound=!!x.checked;
  else if(x.id==="tkNotifStrongOnly")BOARD_NOTIF.strongOnly=!!x.checked;
  else if(x.id==="tkNotifSoundType")BOARD_NOTIF.soundType=x.value||"chime";
  else return false;

  saveBoardNotif?.();
  tkNotifSync2K?.();
  return true;
};

const tkNotifToast2K=(id,on)=>{
  const map={
    tkNotifVisual:["Alertas visuales activas","Alertas visuales desactivadas"],
    tkNotifSound:["Alertas con sonido activas","Alertas con sonido desactivadas"],
    tkNotifStrongOnly:["Solo cambios importantes activo","Solo cambios importantes desactivado"]
  };
  const m=map[id];
  if(m)toast?.(on?m[0]:m[1],"ok");
};

const tkWireNotif2K=()=>{
  if(document.documentElement.dataset.tkNotif2kBound)return;
  document.documentElement.dataset.tkNotif2kBound="1";

  document.addEventListener("click",e=>{
    const input =
      e.target?.closest?.("#tkNotifVisual,#tkNotifSound,#tkNotifStrongOnly") ||
      e.target?.closest?.("#tkGearMenu label.thread-opt")?.querySelector?.("#tkNotifVisual,#tkNotifSound,#tkNotifStrongOnly");

    if(input){
      // B2.7-P: una sola ruta para checkboxes; sin rebote de label/input/change.
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation?.();

      input.checked=!input.checked;
      tkApplyNotifControl(input);
      tkNotifSync2K?.();
      tkNotifToast2K(input.id,input.checked);

      return;
    }

    const test=e.target?.closest?.("#tkTestSoundBtn,#tkNotifTestSound,#tkSoundPreviewBtn");
    if(test){
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation?.();

      BOARD_NOTIF.sound=true;
      BOARD_NOTIF.muted=false;
      saveBoardNotif?.();
      tkNotifSync2K?.();
      tkPlayTestSound2K?.();

      toast?.("Sonido probado","ok");
      return;
    }

    if(e.target?.closest?.("#tkGearBtn,#tkGearMenu")){
      setTimeout(()=>{tkGearNormalize2K?.();window.__tkB26NormalizePopups?.();tkNotifSync2K?.();},0);
    }
  },true);

  document.addEventListener("change",e=>{
    const x=e.target;

    if(x?.id==="tkNotifSoundType"){
      e.stopPropagation();
      tkApplyNotifControl(x);
      return;
    }

    if(x?.matches?.("#tkNotifVisual,#tkNotifSound,#tkNotifStrongOnly")){
      // Si teclado/accesibilidad dispara change, respetar estado real y avisar.
      e.stopPropagation();
      tkApplyNotifControl(x);
      tkNotifSync2K?.();
      tkNotifToast2K(x.id,x.checked);
      return;
    }
  },true);

  document.addEventListener("input",e=>{
    const x=e.target;
    if(x?.id==="tkNotifVolume"){
      BOARD_NOTIF.volume=Number(x.value||.5);
      saveBoardNotif?.();
      tkNotifSync2K?.();
      e.stopPropagation();
    }
  },true);
};

const bindNotifControls=()=>{tkWireNotif2K?.();tkNotifSync2K?.()};

const TK_BG_KEY="tc_tickets_board_bg",TK_BG_URL="tc_tickets_board_bg_url",TK_BG_IMG="tc_tickets_board_bg_img",TK_BG_INT="tc_tickets_board_bg_intensity",TK_FILTER_KEY="tc_tickets_filter_ui";
const tkStop=e=>{e?.preventDefault?.();e?.stopPropagation?.();e?.stopImmediatePropagation?.()};
const tkSetTheme=()=>{const h=document.documentElement,cur=h.dataset.theme||localStorage.getItem("tc_theme")||"light",next=cur==="dark"?"light":"dark";h.dataset.theme=next;localStorage.setItem("tc_theme",next);toast?.(next==="dark"?"Modo oscuro":"Modo claro","ok")};
const tkApplyBg=()=>{const b=localStorage.getItem(TK_BG_KEY)||"soft",i=Number(localStorage.getItem(TK_BG_INT)||38),url=localStorage.getItem(TK_BG_URL)||"",img=localStorage.getItem(TK_BG_IMG)||"";document.body.dataset.boardBg=b;document.body.style.setProperty("--tk-bg-intensity",String(Math.max(0,Math.min(100,i))/100));document.body.style.setProperty("--tk-custom-bg",b==="url"&&url?`url("${url.replaceAll('"',"%22")}")`:b==="upload"&&img?`url("${img}")`:"none");$("#tkBgIntensity")&&($("#tkBgIntensity").value=String(i));$("#tkBgUrl")&&($("#tkBgUrl").value=url);$("#tkBgWarn")&&($("#tkBgWarn").textContent=i>70?"Intensidad alta: puede afectar legibilidad.":"")};
const tkSetBg=v=>{localStorage.setItem(TK_BG_KEY,v);tkApplyBg();document.querySelectorAll("[data-tk-bg]").forEach(x=>x.classList.toggle("is-on",x.dataset.tkBg===v))};
const tkMountBgControls=()=>{const menu=$("#tkGearMenu");if(!menu||$("#tkGearTabs"))return;const notif=$("#tkNotifVisual")?.closest(".tickets-gear-section");notif?.classList.add("tk-gear-notif-section");menu.dataset.gearTab=menu.dataset.gearTab||"notif";menu.insertAdjacentHTML("afterbegin",`<div class="tk-gear-tabs" id="tkGearTabs"><button class="mini btn-ghost is-on" type="button" data-gear-tab="notif">Notificaciones</button><button class="mini btn-ghost" type="button" data-gear-tab="bg">Fondo del tablero</button></div>`);notif?.insertAdjacentHTML("afterend",`<div class="tickets-gear-section tk-board-bg-section"><div class="tickets-gear-title">Fondo del tablero</div><div class="tk-bg-pills"><button class="mini btn-ghost" type="button" data-tk-bg="soft">Suave</button><button class="mini btn-ghost" type="button" data-tk-bg="aurora">Aurora</button><button class="mini btn-ghost" type="button" data-tk-bg="azul">Azul</button><button class="mini btn-ghost" type="button" data-tk-bg="none">Ninguno</button></div><div class="tk-bg-urlrow"><input class="input" id="tkBgUrl" placeholder="Pegar URL de imagen" autocomplete="off"><button class="mini btn-ghost" id="tkBgUrlBtn" type="button">OK</button></div><label class="tk-bg-upload mini btn-ghost"><input id="tkBgUpload" type="file" accept="image/*" hidden>Subir foto</label><label class="thread-opt range-opt tk-bg-intensity"><span>Intensidad</span><input id="tkBgIntensity" type="range" min="0" max="100" step="5"></label><div class="mut" id="tkBgWarn"></div><button class="mini btn-ghost" id="tkThemeLocalBtn" type="button">Cambiar claro/oscuro</button></div>`);tkApplyBg();document.querySelectorAll("[data-tk-bg]").forEach(x=>x.classList.toggle("is-on",x.dataset.tkBg===(localStorage.getItem(TK_BG_KEY)||"soft")))};
const tkMountOrderControls=()=>{const sec=$("#tkGearMenu .tk-board-bg-section");if(!sec||$("#tkOrderMode"))return;sec.insertAdjacentHTML("beforeend",`<div class="tk-order-box" id="tkOrderMode"><div class="tickets-gear-title">Orden de tickets</div><div class="tk-order-pills"><button class="mini btn-ghost" type="button" data-tk-order="chrono">Cronológica</button><button class="mini btn-ghost" type="button" data-tk-order="smart">Inteligente</button></div><div class="mut tk-order-help">Cronológica es la vista normal. Inteligente prioriza urgentes, vencidos y sin tocar.</div></div>`);tkSyncOrderControls()};
const tkGearTab=t=>{const m=$("#tkGearMenu");if(!m)return;m.dataset.gearTab=t||"notif";document.querySelectorAll("[data-gear-tab]").forEach(b=>b.classList.toggle("is-on",b.dataset.gearTab===m.dataset.gearTab))};
const tkNormalizeFiltersHard=()=>{const a=$("#tkAdvancedFilters .tk-filter-actions");if(!a)return;a.innerHTML=`<button class="btn btn-ghost" id="tkUrgentStale" type="button">Urgentes y sin tocar</button><button class="btn btn-ghost" id="tkFrBreach" type="button">Respuesta vencida</button>`;["tkReadyClose","tkImpactHigh","tkNoEvidence","tkNoClientLinked","tkMatchMedium","tkRsBreach","tkSlaSoon","tkOnlyUrgent"].forEach(id=>document.querySelectorAll("#"+id).forEach(x=>x.remove()))};
const tkSaveFilterUi=()=>localStorage.setItem(TK_FILTER_KEY,JSON.stringify({q:$("#tkSearch")?.value||"",p:$("#tkFilterPriority")?.value||"",s:$("#tkFilterState")?.value||"",t:$("#tkFilterType")?.value||""}));
const tkRestoreFilterUi=()=>{try{const o=JSON.parse(localStorage.getItem(TK_FILTER_KEY)||"{}");$("#tkSearch")&&($("#tkSearch").value=o.q||"");$("#tkFilterPriority")&&($("#tkFilterPriority").value=o.p||"");$("#tkFilterState")&&($("#tkFilterState").value=o.s||"");$("#tkFilterType")&&($("#tkFilterType").value=o.t||"")}catch{}};
const tkHasFilterUi=()=>!!(($("#tkSearch")?.value||"").trim()||$("#tkFilterPriority")?.value||$("#tkFilterState")?.value||$("#tkFilterType")?.value);
const tkClearFiltersHard=()=>{["tkSearch","tkFilterPriority","tkFilterState","tkFilterType"].forEach(id=>{const x=$("#"+id);if(x)x.value=""});localStorage.removeItem(TK_FILTER_KEY);clearAllFilters?.();renderAll?.();syncSelected?.()};
const tkGuardEmptyFilter=()=>setTimeout(()=>{if(!tkHasFilterUi())return;const n=document.querySelectorAll(".k-card,.compact-row").length;if(n)return;toast?.("Sin resultados :) Se quitó el filtro.","warn");tkClearFiltersHard();setTimeout(()=>{renderAll?.();syncSelected?.();syncHeaderClearBtns?.()},60)},180);
const tkSetMobileState=mobileStateSet;
const tkFixQrText=()=>{const save=$("#tkQrBoardSave");if(save)save.textContent="Guardar";document.querySelectorAll("[data-board-qrdel]").forEach(b=>{b.innerHTML="✕";b.setAttribute("aria-label","Borrar");b.setAttribute("title","Borrar")})};

const tkPlayTestSound=()=>{
  try{
    const C=window.AudioContext||window.webkitAudioContext;
    if(!C)return window.__tkNotifyBeep?.();
    const ctx=new C();
    const osc=ctx.createOscillator();
    const gain=ctx.createGain();
    const type=BOARD_NOTIF?.soundType||"chime";
    const vol=Math.max(.03,Math.min(1,Number(BOARD_NOTIF?.volume??.35)));
    const freq=type==="urgente"?880:type==="pop"?520:type==="ding"?660:type==="doble"?740:620;
    osc.type="sine";
    osc.frequency.value=freq;
    gain.gain.value=vol*.22;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    setTimeout(()=>{
      try{osc.stop();ctx.close()}catch{}
    },type==="urgente"?260:180);
    if(type==="doble"){
      setTimeout(()=>tkPlayTestSound(),260);
    }
  }catch(e){
    console.warn("TK_TEST_SOUND_FALLBACK",e);
    try{window.__tkNotifyBeep?.()}catch{}
  }
};

const tkCompactGearSettings=()=>{
  const root=$("#tkGearMenu")||$("#tkGearPanel")||document.querySelector(".tk-gear,.gear-menu,[data-gear-menu]");
  if(!root)return;

  root.querySelectorAll('[data-gear-tab="bg"]').forEach(x=>x.style.display="none");
  root.querySelectorAll('[data-tk-bg],#tkBgUrl,#tkBgUrlBtn,#tkBgUpload,#tkBgIntensity').forEach(x=>{
    const box=x.closest("label,.thread-opt,.field,.stack-sm,.tk-bg-row,div")||x;
    box.style.display="none";
  });

  if(!$("#tkNotifOrderBox")){
    root.insertAdjacentHTML("beforeend",`<div id="tkNotifOrderBox" class="tk-notif-order-box">
      <div class="section-kicker">Orden de tickets</div>
      <div class="tk-order-grid">
        <button class="mini btn-ghost" type="button" data-tk-order="chrono">Cronológica</button>
        <button class="mini btn-ghost" type="button" data-tk-order="smart">Inteligente</button>
      </div>
      <p class="mut">Cronológica es la vista normal. Inteligente prioriza urgentes, vencidos y sin tocar.</p>
    </div>`);
  }

  tkSyncOrderControls?.();
};

const tkBindCriticalControls=()=>{if(document.documentElement.dataset.tkCriticalBoundV3)return;document.documentElement.dataset.tkCriticalBoundV3="1";tkMountBgControls();tkNormalizeFiltersHard();tkRestoreFilterUi();["tkClosedQ","tkClosedSearch","tkSearch","tkBgUrl"].forEach(id=>{const x=$("#"+id);if(x){x.setAttribute("autocomplete","off");x.setAttribute("autocorrect","off");x.setAttribute("autocapitalize","off");x.setAttribute("spellcheck","false")}});document.addEventListener("click",e=>{const t=e.target,b=t?.closest?.("button,[data-closed-range],[data-tk-bg],[data-gear-tab]");if(!b)return;if(b.matches("[data-gear-tab]")){tkStop(e);return tkGearTab(b.dataset.gearTab)}if(b.matches("[data-tk-bg]")){tkStop(e);return tkSetBg(b.dataset.tkBg)}if(b.matches("[data-tk-order]")){tkStop(e);localStorage.setItem("tc_tickets_order_touched","1");localStorage.setItem(TK_ORDER_KEY,b.dataset.tkOrder||"chrono");localStorage.removeItem("tc_tickets_order");tkSyncOrderControls();window.__tkB26NormalizePopups?.();renderAll?.();return toast?.(tkOrderMode()==="smart"?"Orden inteligente activo":"Orden cronológico activo","ok")}if(b.id==="tkBgUrlBtn"){tkStop(e);const v=($("#tkBgUrl")?.value||"").trim();if(!v)return toast?.("Pega una URL de imagen.","warn");localStorage.setItem(TK_BG_URL,v);return tkSetBg("url")}if(b.id==="tkThemeLocalBtn"||b.matches("[data-theme-toggle]")){tkStop(e);return tkSetTheme()}if(b.id==="tkNewBtn"){tkStop(e);return openNewTicketModal?.()}if(b.id==="tkViewBtn"){tkStop(e);toggleView?.();if(!isMobileTickets()&&VIEW==="compact"){mountCompactModeTabs?.();renderCompact?.();bindCompactUi?.()}return}if(b.id==="tkGearBtn"){tkStop(e);toggleGearMenu?.(e);setTimeout(()=>window.__tkB26NormalizePopups?.(),0);setTimeout(()=>window.__tkB26NormalizePopups?.(),90);return}if(b.id==="tkMoreFiltersBtn"){tkStop(e);tkNormalizeFiltersHard();toggleFilterMenu?.(e);setTimeout(()=>window.__tkB26NormalizePopups?.(),0);setTimeout(()=>window.__tkB26NormalizePopups?.(),90);return}if(b.id==="tkClearFilters"||b.id==="tkClearFiltersMobile"){tkStop(e);return tkClearFiltersHard()}if(b.id==="tkSave"){tkStop(e);return saveTicket?.()}if(b.id==="tkClose"||b.id==="tkCancel"||b.id==="tkModalCloseX"){tkStop(e);return forceCloseNewTicketModal?.()}if(b.id==="tkTestSoundBtn"){tkStop(e);BOARD_NOTIF.sound=true;BOARD_NOTIF.muted=false;saveBoardNotif?.();syncBoardNotifUI?.();tkNotifSync2K?.();tkPlayTestSound2K?.();return toast?.("Sonido probado","ok")}if(b.id==="tkMuteBoardBtn"){tkStop(e);BOARD_NOTIF.muted=!BOARD_NOTIF.muted;saveBoardNotif?.();syncBoardNotifUI?.();return toast?.(BOARD_NOTIF.muted?"Mesa silenciada":"Mesa reactivada","ok")}if(b.id==="tkToggleClosed"){tkStop(e);$("#tkAdvancedFilters")?.classList.add("hidden");$("#tkMoreFiltersBtn")?.setAttribute("aria-expanded","false");$("#tkToggleClosed")?.setAttribute("aria-expanded","true");return openClosedModal?.()}if(b.id==="tkClosedClose"){tkStop(e);$("#tkToggleClosed")?.setAttribute("aria-expanded","false");return closeClosedModal?.()}if(b.id==="tkClosedPrev"){tkStop(e);if((CLOSED.page||0)>0){CLOSED.page--;renderClosed?.()}return}if(b.id==="tkClosedNext"){tkStop(e);const total=closedTotalPages(closedFiltered());if((CLOSED.page||0)<total-1){CLOSED.page++;renderClosed?.()}return}if(b.matches("[data-closed-range]")){tkStop(e);CLOSED.range=b.dataset.closedRange||"30d";CLOSED.page=0;return renderClosed?.()}if(b.matches("[data-mobile-state]")){tkStop(e);return tkSetMobileState(b.dataset.mobileState)}if(b.id==="tkQuickEditBtn"){tkStop(e);tkFixQrText();return openQuickEditor?.()}if(b.id==="tkQrVarsBtn"){tkStop(e);const p=$("#tkQrVarsPop");if(p){const open=!p.classList.contains("hidden");p.classList.toggle("hidden",open);b.setAttribute("aria-expanded",String(!open))}return}if(b.id==="tkQrClose"){tkStop(e);return closeQuickEditor?.()}if(b.id==="tkQrBoardSave"){tkStop(e);return qrBoardSave?.()}if(b.id==="tkQrBoardAdd"){tkStop(e);qrBoardCollect?.();if(QRB.rows.length>=10)return toast?.("Máximo 10 respuestas.","warn");QRB.rows.push({titulo:`Respuesta ${QRB.rows.length+1}`,texto:""});qrBoardPaint?.();return tkFixQrText()}if(b.matches("[data-board-qrdel]")){tkStop(e);return tkQrDelPend(Number(b.dataset.boardQrdel))}if(b.id==="tkQrConfirmOk"){tkStop(e);return tkQrDelConfirm()}if(b.id==="tkQrConfirmCancel"){tkStop(e);return tkQrDelCancel()}if(b.matches("[data-board-qrscope]")){tkStop(e);qrBoardCollect?.();const sc=b.dataset.boardQrscope||"global",tkt=selectedTicket?.();if(sc==="cliente"&&!tkt?.cliente_id)return toast?.("Este ticket no tiene empresa ligada en BD.","warn");if(sc==="contacto"&&!tkt?.contacto_id)return toast?.("Este ticket no tiene usuario ligado en BD.","warn");return qrBoardLoad?.(sc)}if(b.id==="tkQuickSendBtn"){tkStop(e);return sendQuickReply?.()}if(b.id==="tkQuickClose"||b.id==="tkQuickBackdrop"){tkStop(e);return setQuickPanelOpen?.(false)}if(b.matches("#tkQuickBtns [data-qk]")){tkStop(e);const tk=selectedTicket();if(!tk)return toast?.("Primero selecciona un ticket.","warn");const k=b.dataset.qk||"modelo";QUICK.lastAction=k;QUICK.lastCopied=quickActionText(tk,k);$("#tkQuickText")&&($("#tkQuickText").value=QUICK.lastCopied);document.querySelectorAll("#tkQuickBtns [data-qk]").forEach(x=>x.classList.toggle("btn-brand",x.dataset.qk===k));return setQuickPanelOpen?.(true)}if(b.matches("[data-board-qri],[data-board-qrtext]")){tkStop(e);const tk=selectedTicket(),i=Number(b.dataset.boardQri),raw=Number.isFinite(i)&&QUICK.dbRows?.[i]?QUICK.dbRows[i].texto:b.dataset.boardQrtext||"",txt=qrTpl(raw,tk||{});if(!String(txt||"").trim())return toast?.("Respuesta vacía.","warn");QUICK.lastAction="guardada";QUICK.lastCopied=txt;$("#tkQuickText")&&($("#tkQuickText").value=txt);document.querySelectorAll("#tkQuickDbBtns [data-board-qri],#tkQuickDbBtns [data-board-qrtext]").forEach(x=>x.classList.toggle("btn-brand",x===b));return setQuickPanelOpen?.(true)}if(b.id==="tkRefresh"){tkStop(e);const keep=SELECTED_ID;return load().then(()=>{if(keep&&byId(keep)){SELECTED_ID=String(keep);renderAll?.();syncSelected?.()}}).catch(err=>toast?.(msg(err),"bad")).finally(()=>closeTicketMenus?.())}},true);document.addEventListener("click",e=>{const t=e.target;if(t?.id==="tkModal"&&!t.closest?.("#tkModal .modal,#tkModal .tk-new-modal,.modal,.tk-new-modal")){tkStop(e);forceCloseNewTicketModal?.()}if(t?.id==="tkClosedModal"||t?.classList?.contains("tk-closed-overlay")){tkStop(e);$("#tkToggleClosed")?.setAttribute("aria-expanded","false");closeClosedModal?.()}},true);document.addEventListener("change",e=>{const x=e.target;if(!x?.id)return;if(["tkNotifVisual","tkNotifSound","tkNotifStrongOnly","tkNotifSoundType"].includes(x.id)){e.stopPropagation();if(x.id==="tkNotifVisual")BOARD_NOTIF.visual=!!x.checked;if(x.id==="tkNotifSound")BOARD_NOTIF.sound=!!x.checked;if(x.id==="tkNotifStrongOnly")BOARD_NOTIF.strongOnly=!!x.checked;if(x.id==="tkNotifSoundType")BOARD_NOTIF.soundType=x.value||"ding";saveBoardNotif?.();syncBoardNotifUI?.();return}if(["tkFilterPriority","tkFilterState","tkFilterType"].includes(x.id)){e.stopPropagation();if(typeof applyFilters==="function")applyFilters();else{renderAll?.();syncSelected?.();syncHeaderClearBtns?.()}tkSaveFilterUi();return}if(x.id==="tkBgUpload"){const f=x.files?.[0];if(!f)return;if(f.size>900000)return toast?.("Imagen muy pesada. Usa una menor a 900 KB.","warn");const r=new FileReader();r.onload=()=>{localStorage.setItem(TK_BG_IMG,String(r.result||""));tkSetBg("upload")};r.readAsDataURL(f)}},true);document.addEventListener("input",e=>{const x=e.target;if(x?.id==="tkNotifVolume"){BOARD_NOTIF.volume=Number(x.value||.5);return saveBoardNotif?.()}if(x?.id==="tkSearch"){if(typeof applyFilters==="function")applyFilters();else{renderAll?.();syncSelected?.();syncHeaderClearBtns?.()}tkSaveFilterUi();return}if(x?.id==="tkClosedQ"){CLOSED.q=x.value||"";CLOSED.page=0;return renderClosed?.()}if(x?.id==="tkBgIntensity"){localStorage.setItem(TK_BG_INT,x.value||"38");return tkApplyBg()}},true);tkFixQrText();tkApplyBg();tkCompactGearSettings?.()};

const bindDynamic=()=>{window.__tkOpenQuick=()=>openQuickFromButton(document.querySelector("[data-quick-panel]"));bindNewTicketOutsideClose?.();tkBindCriticalControls();bindMobileHistory();bindMobileTabKeyboard();if(!isMobileTickets()&&VIEW==="compact"){mountCompactModeTabs();renderCompact();bindCompactUi?.()}else{$("#tkCompactSwitch")?.remove();$("#tkCompactPager")?.remove()}if(!document.documentElement.dataset.ticketsDynamicBound){window.__ticketsClickHandler=ticketClickRouter;document.addEventListener("click",window.__ticketsClickHandler,true);document.documentElement.dataset.ticketsDynamicBound="1"}document.documentElement.dataset.ticketsDragBound="disabled";bindNotifControls();bindMobileSwipe();tkApplyBg();tkMountOrderControls?.();tkSyncOrderControls?.()};
const bootTickets=()=>{if(document.documentElement.dataset.tkBooted)return;document.documentElement.dataset.tkBooted="1";console.info("tickets boot");try{bindStatic()}catch(e){console.error("bindStatic error",e)}try{bindDynamic()}catch(e){console.error("bindDynamic error",e)}load().then(()=>{console.info("tickets loaded",TK.length);try{bindDynamic()}catch(e){console.error("bindDynamic after load error",e)}if(typeof syncHeroMetrics==="function")syncHeroMetrics()}).catch(err=>{console.error("load error",err);toast(msg(err),"bad")});setTimeout(()=>{try{bindDynamic()}catch(e){console.error("bindDynamic timeout 600 error",e)}},600);setTimeout(()=>{try{bindDynamic()}catch(e){console.error("bindDynamic timeout 1600 error",e)}},1600);setInterval(()=>{if(QUICK.open||!$("#tkModal")?.hidden||!$("#tkClosedModal")?.hidden||!$("#tkGearMenu")?.hidden||!$("#tkAdvancedFilters")?.hidden)return;load().then(()=>{try{bindDynamic()}catch(e){console.error("bindDynamic interval error",e)}if(typeof syncHeroMetrics==="function")syncHeroMetrics()}).catch(e=>console.warn("poll load error",e))},60000)};
document.readyState==="loading"?document.addEventListener("DOMContentLoaded",bootTickets,{once:true}):bootTickets();


window.addEventListener("error",()=>{try{delete document.body.dataset.ticketsLoading}catch{}});

/* B2_6_CANONICAL_TOOLBAR_POPUPS */
(()=>{
  if(window.__tkB26CanonicalPopupsReady) return;
  window.__tkB26CanonicalPopupsReady = true;

  const qs = (q, ctx=document) => ctx.querySelector(q);
  const qsa = (q, ctx=document) => [...ctx.querySelectorAll(q)];

  const visible = el => !!el && !el.hidden && !el.classList.contains("hidden") && getComputedStyle(el).display !== "none";

  const ensureBackdrop = () => {
    let b = qs("#tkToolbarPopupBackdrop");
    if(!b){
      b = document.createElement("div");
      b.id = "tkToolbarPopupBackdrop";
      b.setAttribute("aria-hidden", "true");
      b.addEventListener("click", closeAll);
      document.body.appendChild(b);
    }
    return b;
  };

  const closeEl = el => {
    if(!el) return;
    el.classList.add("hidden");
    el.classList.remove("open","is-open","show","active");
    el.hidden = true;
    el.setAttribute("hidden", "hidden");
    el.setAttribute("aria-hidden", "true");
    el.style.removeProperty("display");
    el.style.removeProperty("pointer-events");
  };

  const closeAll = () => {
    closeEl(qs("#tkAdvancedFilters"));
    closeEl(qs("#tkGearMenu"));
    qs("#tkMoreFiltersBtn")?.setAttribute("aria-expanded","false");
    qs("#tkGearBtn")?.setAttribute("aria-expanded","false");
    document.body.classList.remove("tk-toolbar-popup-open");
    qs("#tkToolbarPopupBackdrop")?.classList.remove("open");
  };

  const syncBackdrop = () => {
    const any = visible(qs("#tkAdvancedFilters")) || visible(qs("#tkGearMenu"));
    ensureBackdrop().classList.toggle("open", any);
    document.body.classList.toggle("tk-toolbar-popup-open", any);
  };

  const ensureHeader = (el, kicker, title) => {
    if(!el) return;

    qsa(":scope > .tk-popup-head", el).forEach(x => x.remove());
    qsa(":scope > .tk-popup-x", el).forEach(x => x.remove());

    const head = document.createElement("div");
    head.className = "tk-popup-head tk-popup-head-canonical";
    head.innerHTML = `
      <div class="tk-popup-copy">
        <div class="tk-popup-kicker">${kicker}</div>
        <h3>${title}</h3>
      </div>
      <button type="button" class="tk-popup-x" aria-label="Cerrar ${title}">×</button>
    `;

    head.querySelector(".tk-popup-x")?.addEventListener("click", e => {
      e.preventDefault();
      e.stopPropagation();
      closeAll();
    });

    el.prepend(head);
  };

  const normalizeOrder = () => {
    const touched = localStorage.getItem("tc_tickets_order_touched") === "1";
    const mode = touched ? (localStorage.getItem("tc_tickets_order_mode") || "") : "";
    document.documentElement.dataset.tkOrderTouched = touched ? "1" : "0";

    qsa("[data-tk-order]").forEach(b => {
      const on = touched && b.dataset.tkOrder === mode;
      b.classList.toggle("is-on", on);
      b.classList.toggle("is-active", on);
      b.classList.toggle("btn-brand", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  };

  const cleanGear = () => {
    const gear = qs("#tkGearMenu");
    if(!gear) return;

    // Eliminar visualmente duplicados/ruido de ciclos previos.
    qsa(".tk-gear-tabs,[data-gear-tab],.tk-board-bg-section,.tk-bg-urlrow,.tk-bg-upload,.tk-bg-intensity,#tkBgUrl,#tkBgUrlBtn,#tkBgUpload,#tkBgIntensity", gear)
      .forEach(x => x.classList.add("tk-b26-hidden"));

    qsa("button", gear).forEach(btn => {
      const txt = (btn.textContent || "").trim().toLowerCase();
      if(txt.includes("probar sonido")) btn.classList.add("tk-b26-hidden");
    });

    // Si hay más de un bloque de orden, conservar el canónico.
    const orderBoxes = qsa("#tkOrderMode,.tk-order-box,.tk-notif-order-box", gear);
    orderBoxes.forEach(x => {
      const keep = x.id === "tkNotifOrderBox";
      x.classList.toggle("tk-b26-hidden", !keep);
      if(keep) x.classList.remove("tk-b26-hidden");
    });

    // Títulos internos redundantes.
    qsa(".tickets-gear-title", gear).forEach(x => {
      const txt = (x.textContent || "").trim().toLowerCase();
      if(txt === "tickets") x.classList.add("tk-b26-hidden");
    });
  };

  const portalPopups = () => {
    // B2.7-I: sacar Filtros/Configuración del stacking context del hero.
    [qs("#tkAdvancedFilters"), qs("#tkGearMenu")].forEach(el => {
      if(el && el.parentElement !== document.body){
        document.body.appendChild(el);
      }
    });
  };

  const normalize = () => {
    portalPopups();

    const bd = ensureBackdrop();
    bd.style.setProperty("z-index", "10070", "important");

    [qs("#tkAdvancedFilters"), qs("#tkGearMenu")].forEach(el => {
      if(el && !el.hidden && !el.classList.contains("hidden")){
        el.style.removeProperty("display");
        el.style.removeProperty("pointer-events");
        el.removeAttribute("aria-hidden");

        // B2.7-G: el popup debe quedar arriba del backdrop blur.
        el.style.setProperty("position", "fixed", "important");
        el.style.setProperty("z-index", "10090", "important");
        el.style.setProperty("left", "50%", "important");
        el.style.setProperty("top", "50%", "important");
        el.style.setProperty("right", "auto", "important");
        el.style.setProperty("bottom", "auto", "important");
        el.style.setProperty("transform", "translate(-50%,-50%)", "important");
      }
    });

    ensureHeader(qs("#tkAdvancedFilters"), "Mesa", "Filtros");
    ensureHeader(qs("#tkGearMenu"), "Tickets", "Configuración");
    cleanGear();
    normalizeOrder();
    syncBackdrop();
  };

  document.addEventListener("click", e => {
    const order = e.target?.closest?.("[data-tk-order]");
    if(order){
      localStorage.setItem("tc_tickets_order_touched", "1");
      localStorage.setItem("tc_tickets_order_mode", order.dataset.tkOrder || "chrono");
      localStorage.removeItem("tc_tickets_order");
      setTimeout(normalizeOrder, 30);
      setTimeout(normalize, 90);
    }

    const opener = e.target?.closest?.("#tkMoreFiltersBtn,#tkGearBtn");
    if(e.target?.id==="tkToolbarPopupBackdrop"){e.preventDefault();closeAll();return;}
    const inside = e.target?.closest?.("#tkAdvancedFilters,#tkGearMenu,#tkMoreFiltersBtn,#tkGearBtn");

    if(!inside && document.body.classList.contains("tk-toolbar-popup-open")){
      e.preventDefault();
      closeAll();
      return;
    }

    if(opener){
      setTimeout(normalize, 60);
      setTimeout(normalize, 180);
    }
  }, true);

  document.addEventListener("keydown", e => {
    if(e.key === "Escape") closeAll();
  }, true);

  window.__tkB26NormalizePopups = normalize;
  window.__tkB26ClosePopups = closeAll;

  setTimeout(normalize, 500);
})();
/* /B2_6_CANONICAL_TOOLBAR_POPUPS */
