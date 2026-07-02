import{supabase as s,guardSession,logAction,msg}from"./supabase.js";
import{$,toast,esc,norm,ensureAppShell,setAppRole,setRailOpenCount,pushRecentClient,setGlobalSearchData,setBreadcrumb,ticketStateKey,ticketStateLabel,ticketStateCls,prettyBytes}from"./global.js";
import{montarFichaAgente}from"./janome/janome_ticket.js";

let CLIENT_SYSTEMS=[];
const $$=(q,ctx=document)=>[...ctx.querySelectorAll(q)];
// D2B1: fallback runtime para SYS_LOGO.
// Evita que renderHeader/montarFichaAgente rompan la carga del ticket si falta el mapa de logos.
const SYS_LOGO = globalThis.SYS_LOGO || (globalThis.SYS_LOGO = {
  janome: "../IMG/logo_janome.png",
  janome_garantia: "../IMG/logo_janome.png",
  garantia: "../IMG/logo_janome.png",
  default: "../IMG/expiriti.png"
});

// D2B3: fallback local para syncChannelIcon si el helper no existe.
const syncChannelIcon = globalThis.syncChannelIcon || (globalThis.syncChannelIcon = (...args)=>{
  try{
    const el = args.find(x => x && x.nodeType === 1) || null;
    if(el && !el.textContent.trim()) el.textContent = "•";
  }catch(e){}
});

const QS=new URLSearchParams(location.search),ID=QS.get("id")||"",QK=(QS.get("qk")||"").trim().toLowerCase(),MUTE_KEY=`tc_ticket_mute_${ID}`,ST={busy:false,linkedContact:null,logFiles:[],portalMeta:null,notif:null,lastNotifSig:"",poller:null,ticketMuted:false,quickBootDone:false,quickBootKey:"",quickBootText:""};let T=null,C=null,LOGS=[],HEAT={periodDays:30,rows:[],total30:0,urgent30:0,waitOpen:0,level:"Normal"},FILES=[],QRS=[],CLIENT_ACCESSES=[];

const QR={
modelo:{text:"Para revisar {producto} en {empresa}, por favor comparte el modelo exacto de la máquina o producto y, si lo tienes, el número de serie.",kind:"solicitud",state:"esperando_cliente"},
evidencia:{text:"Por favor comparte una foto clara y un video corto máximo de 20 segundos donde se vea {producto}, el problema y la acción que estás realizando.",kind:"solicitud",state:"esperando_cliente"},
garantia:{text:"Para validar garantía de {producto}, por favor comparte comprobante de compra, fecha de compra, modelo y número de serie.",kind:"solicitud",state:"esperando_cliente"},
muestra:{text:"Para revisar {producto}, comparte foto de la muestra de puntada, tipo de tela, hilo usado, aguja instalada y ajuste de tensión.",kind:"solicitud",state:"esperando_cliente"},
horario:{text:"Compártenos por favor uno o dos horarios disponibles para revisar {producto} en {empresa}, y el medio preferido de contacto para continuar.",kind:"solicitud",state:"esperando_cliente"},
espera:{text:"Quedamos en espera de la información solicitada para continuar con la revisión de {producto} en {empresa}.",kind:"seguimiento",state:"esperando_cliente"},
solucion:{text:"Se aplicó ajuste / validación operativa en {producto} y el caso queda listo para confirmación con {empresa}.",kind:"solucion",state:""},
resuelto:{text:"Se registró solución para {producto} y el caso queda resuelto. Puede reabrirse si el problema vuelve a presentarse.",kind:"solucion",state:"resuelto"},

captura:{text:"Por favor comparte una foto clara y un video corto máximo de 20 segundos donde se vea {producto}, el problema y la acción que estás realizando.",kind:"solicitud",state:"esperando_cliente"},
remoto:{text:"Compártenos por favor uno o dos horarios disponibles para revisar {producto} en {empresa}, y el medio preferido de contacto para continuar.",kind:"solicitud",state:"esperando_cliente"}
};
const qrCtx=()=>({empresa:C?.nombre||T?.empresa_capturada||T?.nombre_capturado||"tu empresa",producto:CLIENT_SYSTEMS?.[0]?.producto||T?.producto||T?.producto_detectado||T?.tipo_producto||"el producto",agente:ST?.profile?.nombre||"soporte",folio:T?.folio||"tu ticket"});
const qrTpl=t=>{const c=qrCtx();return String(t||"").replaceAll("{empresa}",c.empresa).replaceAll("{producto}",c.producto).replaceAll("{agente}",c.agente).replaceAll("{folio}",c.folio)};
const ticketCloseDefaultText=()=>`Se concluye la revisión del caso y queda cerrado. Si el problema vuelve a presentarse, puedes responder desde el portal para reabrir el seguimiento.`;
const isAutoFollowupText=txt=>/^gracias por la actualizaci[oó]n\. estamos revisando la informaci[oó]n que compartiste/i.test(String(txt||"").trim());
const resolveTicket=async()=>{
  // D2A: cierre explícito de ticket; no reutiliza el texto genérico de seguimiento.
  if(ST.busy)return;
  const ok=confirm("¿Cerrar este ticket? Se registrará un cierre visible al cliente.");
  if(!ok)return;
  const box=$("#logText");
  const cur=box?.value?.trim()||"";
  if(box)box.value=(!cur||isAutoFollowupText(cur))?ticketCloseDefaultText():cur;
  setComposerMode("solucion","cerrado");
  return saveLog();
};
const applyQuickReply=k=>{const box=$("#logText"),kind=$("#logKind"),state=$("#logState");if(String(k||"").startsWith("__txt__")){if(box)box.value=(box.value.trim()?`${box.value.trim()}\n\n`:"")+qrTpl(String(k).replace(/^__txt__/,""));ST.quickBootText=box?.value?.trim()||ST.quickBootText;scrollComposerIntoView();box?.focus();return}const q=QR[k];if(!q)return;if(box)box.value=(box.value.trim()?`${box.value.trim()}\n\n`:"")+qrTpl(q.text);if(kind&&q.kind)kind.value=q.kind;if(state&&q.state!==undefined)state.value=q.state;ST.quickBootText=box?.value?.trim()||ST.quickBootText;scrollComposerIntoView();box?.focus()};
const syncSystemKind=k=>{$$("[data-sys-kind]").forEach(b=>b.classList.toggle("is-active",b.dataset.sysKind===k));$$(".sys-desktop-field").forEach(x=>x.hidden=k!=="escritorio")};
document.addEventListener("click",e=>{const b=e.target.closest("[data-sys-kind]");if(b)syncSystemKind(b.dataset.sysKind)});


const fileExt=n=>((n||"").split(".").pop()||"").toLowerCase(),isImg=x=>["jpg","jpeg","png","webp","gif","bmp","svg"].includes(fileExt(x?.nombre||x?.name||x?.nombre_archivo||x?.url||""))||String(x?.tipo||x?.type||x?.mime_type||"").startsWith("image/"),isVid=x=>["mp4","mov","m4v","webm"].includes(fileExt(x?.nombre||x?.name||x?.nombre_archivo||x?.url||""))||String(x?.tipo||x?.type||x?.mime_type||"").startsWith("video/"),isPdf=x=>fileExt(x?.nombre||x?.name||x?.nombre_archivo||x?.url||"")==="pdf"||String(x?.tipo||x?.type||x?.mime_type||"").toLowerCase()==="application/pdf",isText=x=>["xml","txt","json","log","csv"].includes(fileExt(x?.nombre||x?.name||x?.nombre_archivo||x?.url||""))||["text/plain","text/xml","application/xml","application/json","text/csv"].includes(String(x?.tipo||x?.type||x?.mime_type||"").toLowerCase()),safeUrl=u=>{try{return /^https?:\/\//i.test(String(u||""))?u:""}catch{return""}},showEv=()=>{$("#evModal")&&($("#evModal").hidden=false,document.body.classList.add("modal-open"))},hideEv=()=>{$("#evModal")&&($("#evModal").hidden=true,document.body.classList.remove("modal-open"));$("#evBody")&&($("#evBody").innerHTML=`<div class="empty-state">Sin vista previa.</div>`);$("#evTitle")&&($("#evTitle").textContent="Vista previa");$("#evOpenRaw")&&($("#evOpenRaw").setAttribute("href","#"))};
const escHtml=v=>(v??"").toString().replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
const openEvidence=async i=>{const x=Array.isArray(FILES)?FILES[i]:null;if(!x)return;let u=safeUrl(x?.url),name=x?.nombre||x?.name||`Adjunto ${Number(i)+1}`;if(!u&&x?.storage_path)u=await signedEvidenceUrl(x);$("#evTitle")&&($("#evTitle").textContent=name);$("#evOpenRaw")&&($("#evOpenRaw").setAttribute("href",u||"#"));if(!u){$("#evBody").innerHTML=`<div class="empty-state">Este adjunto no tiene URL disponible para vista previa.</div>`;return showEv()}if(isImg(x)){$("#evBody").innerHTML=`<img class="ev-img" src="${escHtml(u)}" alt="${escHtml(name)}">`;return showEv()}if(isVid(x)){$("#evBody").innerHTML=`<video class="ev-video" src="${escHtml(u)}" controls playsinline autoplay></video>`;return showEv()}if(isPdf(x)){$("#evBody").innerHTML=`<iframe class="ev-frame" src="${escHtml(u)}" title="${escHtml(name)}"></iframe>`;return showEv()}if(isText(x)){try{const r=await fetch(u),txt=await r.text();$("#evBody").innerHTML=`<pre class="ev-pre">${escHtml(txt.slice(0,120000))}</pre>`;return showEv()}catch{$("#evBody").innerHTML=`<div class="empty-state">No se pudo leer este archivo en vista previa.</div>`;return showEv()}}window.open(u,"_blank","noopener")};
const setComposerMode=(kind="seguimiento",state="")=>{const note=kind==="nota",close=kind==="solucion",box=$(".composer-chatbox");ST.mode=kind;$("#logKind")&&($("#logKind").value=kind);$("#logState")&&($("#logState").value=state);$("#modeReplyBtn")?.classList.toggle("is-active",kind==="seguimiento");$("#modeNoteBtn")?.classList.toggle("is-active",note);box?.classList.toggle("is-note",note);box?.classList.toggle("is-close",close);renderComposerMode();renderLogFilesMeta();loadQuickReplies().then(renderSmartReplies).catch(()=>renderSmartReplies());renderQuickBootHint()};
const quickBootMap=k=>k==="xml"?"evidencia":k==="captura"?"captura":k==="remoto"?"remoto":k==="horario"?"horario":k==="espera"?"espera":k==="resuelto"?"resuelto":"";
const ensureQuickBootUi=()=>{if($("#tkQuickBootHint"))return;const host=$(".composer-chatbox")?.parentElement||$("#saveLogBtn")?.closest(".panel")||$("#saveLogBtn")?.parentElement;if(!host)return;const box=document.createElement("div");box.id="tkQuickBootHint";box.className="tk-quickboot-hint hidden";box.innerHTML='<div class="tk-quickboot-copy"><span class="tag info" id="tkQuickBootTag">Acción rápida</span><span id="tkQuickBootText">Sugerencia cargada</span></div><div class="actions"><button class="mini btn-ghost" type="button" id="tkQuickBootClear">Limpiar</button></div>';host.insertBefore(box,host.firstChild);if(!document.getElementById("tkQuickBootCss")){const st=document.createElement("style");st.id="tkQuickBootCss";st.textContent='.tk-quickboot-hint{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 10px;padding:10px 12px;border:1px solid color-mix(in srgb,var(--line) 70%,transparent);border-radius:14px;background:color-mix(in srgb,var(--panel) 88%,transparent)}.tk-quickboot-hint.hidden{display:none}.tk-quickboot-copy{display:flex;align-items:center;gap:8px;flex-wrap:wrap}';document.head.appendChild(st)}};
const renderQuickBootHint=()=>{ensureQuickBootUi();const box=$("#tkQuickBootHint");if(!box)return;const on=!!ST.quickBootKey&&!!ST.quickBootText;box.classList.toggle("hidden",!on);$("#tkQuickBootTag")&&($("#tkQuickBootTag").textContent=ST.quickBootKey?`Acción rápida: ${ST.quickBootKey}`:"Acción rápida");$("#tkQuickBootText")&&($("#tkQuickBootText").textContent=on?"Se precargó una sugerencia en el composer.":"")};
const scrollComposerIntoView=()=>{const node=$(".composer-chatbox")||$("#logText")||$("#saveLogBtn");if(!node)return;node.scrollIntoView({behavior:"smooth",block:"center"});};
const clearQuickBoot=()=>{ST.quickBootKey="";ST.quickBootText="";renderQuickBootHint()};
let QRM={mode:"seguimiento",scope:"global",rows:[]};

const applyQuickBoot=()=>{if(ST.quickBootDone||!QK)return;const key=quickBootMap(QK);if(!key)return;ST.quickBootDone=true;ST.quickBootKey=key;if(key==="resuelto")setComposerMode("solucion","resuelto");else if(key==="espera")setComposerMode("seguimiento","esperando_cliente");else setComposerMode("seguimiento","");applyQuickReply(key);ST.quickBootText=$("#logText")?.value?.trim()||"";requestAnimationFrame(()=>scrollComposerIntoView());const u=new URL(location.href);u.searchParams.delete("qk");history.replaceState(null,"",u.toString())};

const openContactPanel=()=>{$("#tkContactOverlay")&&($("#tkContactOverlay").hidden=false,document.body.classList.add("modal-open"))};
const closeContactPanel=()=>{$("#tkContactOverlay")&&($("#tkContactOverlay").hidden=true,document.body.classList.remove("modal-open"))};
const shouldShowContactMore=t=>!!(t?.requiere_consolidacion||!t?.cliente_id||!t?.contacto_id||t?.cliente_id_sugerido||t?.contacto_id_sugerido);
const defaultQrs=modo=>modo==="nota"?[
{scope:"global",modo,titulo:"Validar datos",texto:"Pendiente validar nombre, contacto y modelo del equipo antes de continuar con el caso."},
{scope:"global",modo,titulo:"Falta evidencia",texto:"La información aún no permite diagnosticar. Pedir foto o video de la máquina y de la puntada."},
{scope:"global",modo,titulo:"Revisar garantía",texto:"Pendiente validar comprobante de compra, fecha de compra y número de serie para garantía."},
{scope:"global",modo,titulo:"Escalar a técnico",texto:"Conviene escalar con soporte técnico antes de confirmar refacción, garantía o intervención."},
{scope:"global",modo,titulo:"Posible mantenimiento",texto:"El caso sugiere limpieza, ajuste o servicio de mantenimiento. Validar antes de cerrar."},
{scope:"global",modo,titulo:"Revisar historial",texto:"Conviene revisar historial reciente del cliente para detectar recurrencia o patrón de uso."},
{scope:"global",modo,titulo:"Sin acción cliente",texto:"Por ahora no se requiere acción del cliente; queda como nota interna de seguimiento."}
]:modo==="solucion"?[
{scope:"global",modo,titulo:"Solución aplicada",texto:"Se aplicó la solución correspondiente en {producto}. Favor de validar operación con {empresa}."},
{scope:"global",modo,titulo:"Caso resuelto",texto:"Caso resuelto. Queda a reserva de confirmación final por parte de {empresa} si aplica."},
{scope:"global",modo,titulo:"Configuración corregida",texto:"Se corrigió la configuración detectada y el producto quedó listo para operar."},
{scope:"global",modo,titulo:"Mantenimiento aplicado",texto:"Se realizó limpieza y ajuste; el equipo quedó operando correctamente."},
{scope:"global",modo,titulo:"Equipo revisado",texto:"Se revisó el equipo y se confirmó operación correcta."},
{scope:"global",modo,titulo:"Sin falla activa",texto:"No se detecta falla activa al momento de la revisión. Se deja el caso como resuelto."},
{scope:"global",modo,titulo:"Cierre preventivo",texto:"Se deja el caso cerrado con validación preventiva. Si vuelve a presentarse, favor de responder en el portal."}
]:[
{scope:"global",modo,titulo:"Pedir evidencia",texto:QR.evidencia.text},
{scope:"global",modo,titulo:"Pedir foto/video",texto:QR.captura.text},
{scope:"global",modo,titulo:"Pedir horario",texto:QR.horario.text},
{scope:"global",modo,titulo:"Quedar en espera",texto:QR.espera.text},
{scope:"global",modo,titulo:"Pedir muestra",texto:"Comparte una foto de la muestra de puntada, el tipo de tela, el hilo y la aguja instalada."},
{scope:"global",modo,titulo:"Confirmar solución",texto:QR.solucion.text},
{scope:"global",modo,titulo:"Marcar resuelto",texto:QR.resuelto.text}
];

const qrMode=()=>{const k=$("#logKind")?.value||"seguimiento";return k==="solicitud"?"seguimiento":["seguimiento","nota","solucion"].includes(k)?k:"seguimiento"};
const loadQuickReplies=async()=>{const modo=qrMode(),cid=qrClientId(),ctid=qrContactId();let q=s.from("ticket_respuestas_rapidas").select("*").eq("activo",true).eq("modo",modo).order("scope",{ascending:true}).order("orden",{ascending:true}).limit(30);if(cid&&ctid)q=q.or(`scope.eq.global,and(scope.eq.cliente,cliente_id.eq.${cid}),and(scope.eq.contacto,cliente_id.eq.${cid},contacto_id.eq.${ctid})`);else if(cid)q=q.or(`scope.eq.global,and(scope.eq.cliente,cliente_id.eq.${cid})`);else q=q.eq("scope","global");const{data,error}=await q;if(error){QRS=defaultQrs(modo);return}QRS=(data?.length?data:defaultQrs(modo)).slice(0,10)};
const qrClientId=()=>T?.cliente_id||null;
const qrContactId=()=>T?.contacto_id||null;
const qrScopeIds=scope=>({cliente_id:scope==="cliente"||scope==="contacto"?qrClientId():null,contacto_id:scope==="contacto"?qrContactId():null});
const qrCanScope=scope=>scope==="global"||scope==="cliente"&&!!qrClientId()||scope==="contacto"&&!!qrClientId()&&!!qrContactId();
const openQrModal=async()=>{QRM.mode=qrMode();QRM.scope="global";$("#tkQrModal").hidden=false;document.body.classList.add("modal-open");await qrLoadEditor();qrPaintEditor()};
const qrClose=()=>{$("#tkQrModal").hidden=true;document.body.classList.remove("modal-open")};
const qrTabSync=()=>{$$("[data-qrmode]").forEach(b=>b.classList.toggle("is-on",b.dataset.qrmode===QRM.mode));$$("[data-qrscope]").forEach(b=>{const sc=b.dataset.qrscope;b.classList.toggle("is-on",sc===QRM.scope);b.disabled=sc==="cliente"&&!qrClientId()||sc==="contacto"&&!qrContactId();b.title=sc==="contacto"&&!qrContactId()?"Primero vincula contacto":sc==="cliente"&&!qrClientId()?"Primero vincula cliente":""})};
const qrSeedRows=rows=>{const ids=qrScopeIds(QRM.scope),defs=defaultQrs(QRM.mode).map((x,i)=>({...x,id:"",orden:i+1,scope:QRM.scope,...ids})),base=[...(rows?.length?rows:defs)].slice(0,10);while(base.length<7)base.push({id:"",titulo:`Respuesta ${base.length+1}`,texto:"",orden:base.length+1,activo:true,scope:QRM.scope,modo:QRM.mode,...ids});return base};

const qrLoadEditor=async()=>{let q=s.from("ticket_respuestas_rapidas").select("*").eq("activo",true).eq("modo",QRM.mode).eq("scope",QRM.scope).order("orden",{ascending:true}).limit(10);if(QRM.scope==="cliente")q=q.eq("cliente_id",qrClientId()).is("contacto_id",null);if(QRM.scope==="contacto")q=q.eq("cliente_id",qrClientId()).eq("contacto_id",qrContactId());const{data,error}=await q;if(error){toast(msg(error),"bad");QRM.rows=qrSeedRows([]);return}QRM.rows=qrSeedRows(data||[])};
const qrRowTpl=(r,i)=>`<div class="tk-qr-row" data-i="${i}" data-id="${r.id||""}"><input class="tk-qr-title" type="text" data-k="titulo" maxlength="80" placeholder="Nombre" value="${esc(r.titulo||"")}"><textarea class="tk-qr-text" data-k="texto" placeholder="Respuesta que se pondrá en el textbox">${esc(r.texto||"")}</textarea><button class="mini btn-ghost danger" type="button" data-qr-act="del" aria-label="Borrar">Borrar</button></div>`;
const qrPaintEditor=()=>{qrTabSync();$("#tkQrRows").innerHTML=QRM.rows.length?QRM.rows.map((r,i)=>qrRowTpl(r,i)).join(""):`<div class="empty-state">Sin respuestas guardadas.</div>`};
const qrCollect=()=>{$$(".tk-qr-row").forEach((row,i)=>{const id=row.dataset.id||"",t=row.querySelector('[data-k="titulo"]')?.value?.trim()||`Respuesta ${i+1}`,x=row.querySelector('[data-k="texto"]')?.value?.trim()||"";QRM.rows[i]={...QRM.rows[i],id,titulo:t,texto:x,orden:i+1,activo:true}});QRM.rows=qrSeedRows(QRM.rows).slice(0,10)};
const qrAddRow=()=>{qrCollect();if(QRM.rows.length>=10)return toast("Máximo 10 respuestas.","warn");QRM.rows.push({titulo:`Respuesta ${QRM.rows.length+1}`,texto:""});qrPaintEditor()};
const qrSoftDelete=async id=>{if(!id)return;const{error}=await s.from("ticket_respuestas_rapidas").update({activo:false,actualizado_en:new Date().toISOString()}).eq("id",id);if(error)throw error};
const qrSaveAll=async()=>{qrCollect();if(!qrCanScope(QRM.scope))return toast(QRM.scope==="contacto"?"Este ticket no tiene contacto ligado.":"Este ticket no tiene cliente ligado.","warn");const rowsToSave=QRM.rows.filter(x=>x&&x.texto?.trim()).slice(0,10);if(!rowsToSave.length)return toast("Llena al menos una respuesta.","warn");if(rowsToSave.length>10)return toast("Máximo 10.","warn");setBusy(true);try{const ids=qrScopeIds(QRM.scope);let old=s.from("ticket_respuestas_rapidas").select("id").eq("activo",true).eq("modo",QRM.mode).eq("scope",QRM.scope).limit(50);if(QRM.scope==="cliente")old=old.eq("cliente_id",ids.cliente_id).is("contacto_id",null);if(QRM.scope==="contacto")old=old.eq("cliente_id",ids.cliente_id).eq("contacto_id",ids.contacto_id);const oldRows=await old;if(!oldRows.error&&oldRows.data?.length){for(const r of oldRows.data)await qrSoftDelete(r.id)}for(let i=0;i<rowsToSave.length;i++){const r=rowsToSave[i],payload={...ids,scope:QRM.scope,modo:QRM.mode,titulo:r.titulo,texto:r.texto,orden:i+1,activo:true,actualizado_en:new Date().toISOString()};const z=r.id?await s.from("ticket_respuestas_rapidas").update(payload).eq("id",r.id):await s.from("ticket_respuestas_rapidas").insert(payload);if(z.error)throw z.error}await loadQuickReplies();renderSmartReplies();toast("Guardado.","ok");qrClose()}catch(err){toast(msg(err),"bad")}finally{setBusy(false)}};
const saveQuickReply=async r=>{const ids=qrScopeIds(r.scope||"global"),payload={...ids,scope:r.scope||"global",modo:r.modo,titulo:r.titulo,texto:r.texto,orden:r.orden||0,activo:true,actualizado_en:new Date().toISOString()};const res=r.id?await s.from("ticket_respuestas_rapidas").update(payload).eq("id",r.id):await s.from("ticket_respuestas_rapidas").insert(payload);if(res.error)throw res.error};
const deleteQuickReply=async id=>{const{error}=await s.from("ticket_respuestas_rapidas").update({activo:false,actualizado_en:new Date().toISOString()}).eq("id",id);if(error)throw error};

const smartRepliesBySystem=key=>[["modelo","Pedir modelo"],["evidencia","Pedir foto/video"],["garantia","Pedir garantía"],["horario","Pedir horario"],["espera","Quedar en espera"],["solucion","Confirmar solución"],["resuelto","Marcar resuelto"]];
let QR_PICK=null;
const closeQrPick=()=>{$("#tkQrPickPop")?.remove();QR_PICK=null};
const composerText=()=>($("#logText")?.value||"").trim();
const insertQrText=(txt,mode="add")=>{const box=$("#logText");if(!box)return;const val=qrTpl(txt||"");box.value=mode==="replace"?val:(box.value.trim()?`${box.value.trim()}\n\n${val}`:val);box.focus();ST.quickBootText=box.value.trim();fitComposerText?.();renderQuickBootHint?.();closeQrPick()};
const openQrPick=(btn,txt)=>{closeQrPick();QR_PICK={btn,txt};const r=btn.getBoundingClientRect(),p=document.createElement("div");p.id="tkQrPickPop";p.className="tk-qr-pick-pop";p.innerHTML=`<button type="button" data-qrpick="replace">Reemplazar</button><button type="button" data-qrpick="add">Agregar</button>`;document.body.appendChild(p);const top=Math.max(10,r.top-p.offsetHeight-10),left=Math.min(Math.max(10,r.left),innerWidth-p.offsetWidth-10);p.style.left=left+"px";p.style.top=top+"px"};
const useQrPill=(btn,txt)=>{if(!composerText())return insertQrText(txt,"replace");return openQrPick(btn,txt)};

const renderSmartReplies=()=>{const box=$("#quickReplies");if(!box)return;const rows=(QRS?.length?QRS:defaultQrs($("#logKind")?.value||"seguimiento")).slice(0,10);box.innerHTML=rows.map((x,i)=>`<button class="mini btn-ghost qr-pill" type="button" data-qr-text="${esc(x.texto)}" title="${esc(x.titulo||`Respuesta ${i+1}`)}"><span>${esc(x.titulo||`Respuesta ${i+1}`)}</span></button>`).join("")};


const loadRenewalChip=async()=>{if(!T?.cliente_id)return null;const now=new Date().toISOString().slice(0,10);const{data,error}=await s.from("documentos").select("fin_vigencia,producto").eq("cliente_id",T.cliente_id).gte("fin_vigencia",now).order("fin_vigencia",{ascending:true}).limit(1);if(error||!data?.length)return null;return data[0]};


const ENTER_SENDS_KEY="tc_ticket_enter_sends";
const getEnterSends=()=>{try{return localStorage.getItem(ENTER_SENDS_KEY)==="1"}catch{return false}};
const setEnterSends=v=>{try{localStorage.setItem(ENTER_SENDS_KEY,v?"1":"0")}catch{};$("#tkEnterSends")&&($("#tkEnterSends").checked=!!v)};
const capFirst=v=>String(v||"").replace(/^(\s*)([a-záéíóúñ])/i,(m,a,b)=>a+b.toUpperCase());
const fmtHM=v=>v?new Date(v).toLocaleTimeString("es-MX",{hour:"2-digit",minute:"2-digit"}):"";
const rawState=v=>v||"abierto";
const setBusy=v=>{ST.busy=!!v;$("#saveLogBtn")&&($("#saveLogBtn").disabled=ST.busy);$("#pickPublicFilesBtn")&&($("#pickPublicFilesBtn").disabled=ST.busy);$("#modeReplyBtn")&&($("#modeReplyBtn").disabled=ST.busy);$("#tkResolveBtn")&&($("#tkResolveBtn").disabled=ST.busy);$("#modeNoteBtn")&&($("#modeNoteBtn").disabled=ST.busy)};
const logKindLabel=v=>v==="solicitud"?"Solicitud al cliente":v==="solucion"?"Solución aplicada":v==="seguimiento"?"Seguimiento":v==="nota"?"Nota interna":"Actualización";
const publicEntryTitle=v=>v==="solicitud"?"Soporte solicitó información":v==="solucion"?"Soporte confirmó una solución":v==="seguimiento"?"Actualización de soporte":"Actualización";
const humanLog=x=>{if(x?.autor_tipo||x?.kind&&x?.created_at){const a=norm(x?.autor_tipo||"producto"),k=norm(x?.kind||"mensaje"),pub=norm(x?.visibilidad||"publica")==="publica",txt=x?.texto||"",meta=x?.meta||{},time=fmtHM(x?.created_at);if(a==="cliente")return{side:"other",kind:k==="archivo"?"file":"reply",title:k==="archivo"?"Cliente adjuntó archivos":"Cliente respondió",text:txt||"El cliente envió una actualización.",time,meta};if(a==="soporte")return{side:"me",kind:k==="nota"?"note":k==="estado"?"close":k==="archivo"?"file":"reply",title:pub?(k==="estado"?"Cambio de estado":"Soporte respondió"):"Nota interna",text:txt||"Actualización de soporte.",time,meta};return{side:"sys",kind:k==="archivo"?"file":"sys",title:k==="archivo"?"Evidencia registrada":"Sistema",text:txt||"Evento del producto.",time,meta}}const a=String(x?.accion||""),d=x?.detalle||{},txt=d?.texto||d?.nota||d?.mensaje||"";if(a==="ticket_nota")return{side:"me",kind:"note",title:"Nota interna",text:txt||"Se registró una nota interna.",time:fmtHM(x.fecha||x.fecha_creacion)};if(a==="ticket_solucion")return{side:"me",kind:"close",title:"Cierre",text:txt||"Se registró una solución.",time:fmtHM(x.fecha||x.fecha_creacion)};if(txt)return{side:"me",kind:"reply",title:`${logKindLabel(d.kind)}${d?.publico?" · visible al cliente":" · interno"}`,text:txt,time:fmtHM(x.fecha||x.fecha_creacion)};return null};
const normalizeFiles=arr=>(Array.isArray(arr)?arr:[]).map((x,i)=>({id:String(x?.id||x?.storage_path||x?.url||x?.url_firma||i),nombre:x?.nombre||x?.name||x?.nombre_archivo||`Archivo ${i+1}`,tipo:x?.tipo||x?.type||x?.mime_type||"",tamano:x?.peso||x?.size||x?.tamano_bytes||0,url:x?.url||x?.url_firma||"",storage_path:x?.storage_path||x?.url_archivo||"",origen:x?.origen||"ticket",fecha:x?.fecha||x?.creado_en||x?.fecha_subida||null,meta:x?.meta||{}}));
const fileUniqKey=x=>{const loc=String(x?.storage_path||x?.url_archivo||x?.url||x?.url_firma||x?.nombre_archivo||x?.nombre||x?.id||"");const base=loc.split(/[?#]/)[0].split(/[\\/]/).pop().trim().toLowerCase();const sz=String(x?.tamano||x?.tamano_bytes||x?.size||x?.peso||"");return (base||String(x?.id||"").toLowerCase())+"|"+sz;};
const mapEventoToLog=e=>{const autor=norm(e?.autor_tipo||e?.autor||"producto"),kind=norm(e?.kind||"mensaje"),txt=(e?.texto||"").trim(),meta=e?.meta||{},when=e?.created_at||e?.fecha||null;if(e?.visibilidad&&norm(e.visibilidad)==="publica"&&autor==="cliente")return{side:"other",kind:"reply",title:"Cliente respondió",text:txt||"El cliente respondió desde el portal.",time:fmtHM(when)};if(e?.visibilidad&&norm(e.visibilidad)==="publica"&&autor==="soporte")return{side:"me",kind:kind==="archivo"?"reply":"reply",title:kind==="archivo"?"Soporte adjuntó archivos":"Soporte respondió",text:txt||"Actualización de soporte.",time:fmtHM(when)};if(autor==="producto")return{side:"sys",kind:"sys",title:kind==="archivo"?"Sistema registró archivos":"Sistema",text:txt||"Actualización del producto.",time:fmtHM(when)};if(norm(e?.visibilidad||"interna")==="interna")return{side:"me",kind:"note",title:"Evento interno",text:txt||"Evento interno.",time:fmtHM(when)};return null};
const eventPublicEntry=({kind,texto,uploaded,now})=>["solicitud","solucion","seguimiento"].includes(kind)?{kind:uploaded.length&&!texto?"archivo":"mensaje",autor:"soporte",titulo:publicEntryTitle(kind),texto:texto||(uploaded.length?`Se adjuntaron ${uploaded.length} archivo(s) para revisión.`:"Actualización de soporte."),fecha:now,adjuntos:uploaded}:null;
const digits=v=>(v||"").toString().replace(/\D+/g,"");
const mailtoOf=v=>{const x=(v||"").toString().trim();return x?`mailto:${x}`:"#"};
const telOf=v=>{const x=digits(v);return x?`tel:${x}`:"#"};
const hmNow=()=>{const d=new Date();return d.getHours()*60+d.getMinutes()};
const hmMin=v=>{const m=String(v||"").match(/^(\d{1,2}):(\d{2})/);return m?Number(m[1])*60+Number(m[2]):null};
const availabilityState=t=>{const a=hmMin(t?.horario_desde),b=hmMin(t?.horario_hasta),n=hmNow();if(a==null||b==null)return{txt:t?.horario_contacto||t?.horario_disponible||t?.horario_notas||"—",ok:false,known:false,cls:""};const ok=a<=b?n>=a&&n<=b:n>=a||n<=b;return{txt:ok?"Contactable ahora":"Fuera de horario",ok,known:true,cls:ok?"ok":"",range:`${String(t.horario_desde).slice(0,5)}–${String(t.horario_hasta).slice(0,5)}`}};

const setTxt=(id,v)=>{const el=$("#"+id);if(el)el.textContent=v??"—"};
const setHtml=(id,v)=>{const el=$("#"+id);if(el)el.innerHTML=v??""};
const setVal=(id,v)=>{const el=$("#"+id);if(el)el.value=v??""};

const closeFileMenus=()=>document.querySelectorAll(".ev-menu.open").forEach(x=>x.classList.remove("open"));
const signedEvidenceUrl=async f=>{const direct=safeUrl(f?.url||f?.url_firma||"");if(direct)return direct;const path=f?.storage_path||f?.url_archivo||"";if(!path)return"";try{const{data,error}=await s.storage.from("soporte_adjuntos").createSignedUrl(path,60*60*8);if(error){console.warn("SIGNED_EVIDENCE_ERROR",error.message,path);return""}return data?.signedUrl||""}catch(err){console.warn("SIGNED_EVIDENCE_CRASH",err,path);return""}};
const isImgF=f=>/^image\//.test(f?.type||"")||/\.(jpe?g|png|webp|heic)$/i.test(f?.name||"");
const isVidF=f=>/^video\//.test(f?.type||"")||/\.(mp4|mov|m4v)$/i.test(f?.name||"");
const acceptEvidenceFiles=list=>{const all=[...(list||[])];const ok=all.filter(f=>isImgF(f)||isVidF(f));const rejected=all.length-ok.length;const out=ok.slice(0,3);if(ok.length>3)toast("Máximo 3 archivos por mensaje.","warn");else if(rejected>0)toast("Solo se permiten fotos o video (sin PDF).","warn");return out};
const renderLogFilesMeta=()=>{const box=$("#logFilesMeta");if(!box)return;if(!ST.logFiles.length){box.className="mut compact";box.textContent="";return}box.className="tk-attach-row";box.innerHTML=ST.logFiles.map((f,i)=>`<span class="tk-attach-chip">${isImgF(f)?`<img class="tk-attach-thumb" src="${URL.createObjectURL(f)}" alt="">`:`<span class="tk-attach-thumb tk-attach-ic">${isVidF(f)?"🎬":"📄"}</span>`}<span class="tk-attach-name" title="${esc(f.name)}">${esc(f.name)}</span><button type="button" class="tk-attach-del" data-logfile-del="${i}" aria-label="Quitar">×</button></span>`).join("")};
const renderComposerMode=()=>{const kind=$("#logKind")?.value||"seguimiento",state=$("#logState")?.value||"",note=kind==="nota",close=kind==="solucion",modeTag=$("#tkComposerModeTag"),stateTag=$("#tkComposerStateTag"),save=$("#saveLogBtn"),txt=$("#logText");if(modeTag){modeTag.textContent=note?"Nota interna":close?"Cierre al cliente":"Visible al cliente";modeTag.className=`tag ${note?"warn":close?"ok":"info"}`}if(stateTag){stateTag.textContent=close&&state?ticketStateLabel(state):"";stateTag.className=`tag ${close&&state?ticketStateCls(state):"hidden"}`.trim()}$("#tkComposerModeText")&&($("#tkComposerModeText").textContent="");$("#logStatus")&&($("#logStatus").textContent="");if(txt)txt.placeholder=note?"Nota interna.":close?"Describe el cierre.":"Escribe un mensaje";if(save){save.textContent="➤";save.title=note?"Guardar nota":close?"Enviar cierre":"Enviar respuesta";save.setAttribute("aria-label",save.title);save.classList.remove("btn-ghost");save.classList.add("btn-brand")}};

const clearLogFiles=()=>{ST.logFiles=[];$("#logFiles")&&($("#logFiles").value="");renderLogFilesMeta()};
const onLogFiles=e=>{ST.logFiles=acceptEvidenceFiles(e.target.files);renderLogFilesMeta()};

const publicMsgs=t=>(Array.isArray(t?.timeline_publica)?t.timeline_publica:[]).filter(x=>norm(x?.kind)==="mensaje");
const msgAuthorLabel=v=>norm(v)==="cliente"?"Cliente":norm(v)==="soporte"?"Soporte":"Sistema";
const chatTurnMeta=t=>{const closed=ticketStateKey(t?.estado)==="cerrado",msgs=publicMsgs(t),last=msgs.length?msgs[msgs.length-1]:null,lastAuthor=norm(last?.autor),lastAt=last?.fecha||t?.fecha_actualizacion||t?.fecha_creacion||null;if(closed)return{portal:"Cerrado",turno:"Sin respuesta",lastAuthor:lastAuthor?msgAuthorLabel(lastAuthor):"—",lastAt,cls:"neutral",chips:[{txt:"Portal cerrado",cls:"ok"}]};if(!msgs.length)return{portal:"Abierto",turno:"Conviene responder",lastAuthor:"—",lastAt,cls:"info",chips:[{txt:"Sin mensajes públicos aún",cls:"info"},{txt:"Soporte puede abrir conversación",cls:"warn"}]};if(lastAuthor==="cliente")return{portal:"Abierto",turno:"Conviene responder soporte",lastAuthor:"Cliente",lastAt,cls:"warn",chips:[{txt:"Cliente respondió",cls:"warn"},{txt:"Pendiente de soporte",cls:"bad"}]};if(lastAuthor==="soporte")return{portal:"Abierto",turno:"Esperando cliente",lastAuthor:"Soporte",lastAt,cls:"info",chips:[{txt:"Soporte respondió",cls:"ok"},{txt:"Cliente puede escribir",cls:"info"}]};return{portal:"Abierto",turno:"Seguimiento activo",lastAuthor:lastAuthor?msgAuthorLabel(lastAuthor):"Sistema",lastAt,cls:"info",chips:[{txt:"Seguimiento activo",cls:"info"}]}};

const loadLinkedContact=async()=>{if(T?.contacto_id){const{data,error}=await s.from("clientes_contactos").select("id,nombre,correo,telefono,puesto,es_principal").eq("id",T.contacto_id).maybeSingle();if(!error&&data)return data}if(!T?.cliente_id)return null;const{data,error}=await s.from("clientes_contactos").select("id,nombre,correo,telefono,puesto,es_principal").eq("cliente_id",T.cliente_id).eq("activo",true).order("es_principal",{ascending:false}).order("nombre",{ascending:true});if(error||!data?.length)return null;return data.length===1?data[0]:(data.find(x=>x.es_principal)||data[0])};

const loadPortalMeta=async()=>{if(!T?.folio)return{lastView:null,lastReply:null};const {data,error}=await s.from("ticket_portal_logs").select("evento,created_at").eq("ticket_id",ID).order("created_at",{ascending:false}).limit(30);if(error)return{lastView:null,lastReply:null};const rows=Array.isArray(data)?data:[];return{lastView:rows.find(x=>norm(x.evento)==="view")?.created_at||null,lastReply:rows.find(x=>norm(x.evento)==="reply")?.created_at||null}};
const notifDefaults={sound:true,visual:true,volume:0.5,tone:"soft",portal_client_reply:true,portal_waiting_client:true,portal_resolved:true,internal_urgent_ticket:true};
const loadNotifPrefs=async()=>{try{const u=(await s.auth.getUser()).data.user;if(!u?.id)return notifDefaults;const {data,error}=await s.from("perfiles").select("preferencias").eq("id",u.id).maybeSingle();if(error)return notifDefaults;return{...notifDefaults,...(data?.preferencias?.notifications||{})}}catch{return notifDefaults}};
const notifState=()=>({sound:ST.notif?.sound!==false,visual:ST.notif?.visual!==false,volume:Number(ST.notif?.volume??0.5),tone:ST.notif?.tone||"soft",portal_client_reply:ST.notif?.portal_client_reply!==false,portal_waiting_client:ST.notif?.portal_waiting_client!==false,portal_resolved:ST.notif?.portal_resolved!==false,internal_urgent_ticket:ST.notif?.internal_urgent_ticket!==false});
const applyNotifUi=()=>{const n=notifState();$("#tkNotifVisual")&&($("#tkNotifVisual").checked=!!n.visual);$("#tkNotifSound")&&($("#tkNotifSound").checked=!!n.sound);$("#tkNotifVolume")&&($("#tkNotifVolume").value=String(n.volume??0.5));$("#tkNotifStrongOnly")&&($("#tkNotifStrongOnly").checked=n.portal_waiting_client===false&&n.portal_resolved===false)};
const saveNotifPrefs=async patch=>{try{ST.notif={...notifState(),...patch};const u=(await s.auth.getUser()).data.user;if(!u?.id)return;const current=(await s.from("perfiles").select("preferencias").eq("id",u.id).maybeSingle()).data?.preferencias||{};const preferencias={...current,notifications:{...(current.notifications||{}),...ST.notif}};const {error}=await s.from("perfiles").update({preferencias}).eq("id",u.id);if(error)throw error;applyNotifUi()}catch(err){toast(msg(err),"bad")}};

const loadTicketMute=()=>{try{ST.ticketMuted=localStorage.getItem(MUTE_KEY)==="1"}catch{ST.ticketMuted=false}};
const saveTicketMute=v=>{try{ST.ticketMuted=!!v;localStorage.setItem(MUTE_KEY,ST.ticketMuted?"1":"0")}catch{};const b=$("#tkMuteTicketBtn");if(b)b.textContent=ST.ticketMuted?"Activar notificaciones de este ticket":"Silenciar este ticket"};
const SYS_PICK={
escritorio:[
["Máquinas · Domésticas","JANOME_DOMESTICA"],
["Máquinas · Bordadoras","JANOME_BORDADORA"],
["Máquinas · Overlock","JANOME_OVERLOCK"],
["Máquinas · CoverPro / Collaretera","JANOME_COVERPRO"],
["Máquinas · Heavy Duty","JANOME_HD"],
["Máquinas · Profesional","JANOME_PRO"]
],
nube:[
["Accesorios · Prensatelas","JANOME_PRENSATELAS"],
["Accesorios · Bastidores","JANOME_BASTIDOR"],
["Refacciones · Agujas / bobinas","JANOME_REFACCION"],
["Refacciones · Pedal / cable","JANOME_ELECTRICO"],
["Servicio · Mantenimiento","JANOME_SERVICIO"],
["Garantía · Validación","JANOME_GARANTIA"]
]
};
const renderSysPicker=(kind="desktop",active="")=>{const box=$("#tkSysPicker");if(!box)return;box.dataset.kind=kind;box.innerHTML=(SYS_PICK[kind]||[]).map(([name,key])=>`<button class="sys-pick ${norm(name)===norm(active)?"is-active":""}" type="button" data-sys-pick="${esc(name)}">${key&&SYS_LOGO[key]?`<img src="${SYS_LOGO[key]}" alt="${esc(name)}">`:"☁️"}<span>${esc(name)}</span></button>`).join("")};

const openSystemPanel=x=>{const o=$("#tkSystemOverlay");if(!o)return;const kind=x?.entorno||"escritorio";setVal("tkSysId",x?.id||"");setVal("tkSysKey",x?.system_key||"");setVal("tkSysName",x?.producto||"");setVal("tkSysVersion",x?.version_producto||"");setVal("tkSysWindows",x?.version_windows||"");setVal("tkSysSql",x?.version_sql||"");setVal("tkSysInstall",x?.tipo_instalacion||"");setVal("tkSysHost",x?.servidor_o_equipo||"");setVal("tkSysPath",x?.ruta_empresa||"");setVal("tkSysBackupPlace",x?.respaldo_ubicacion||"");setVal("tkSysBackupFreq",x?.respaldo_frecuencia||"");setVal("tkSysLastBackup",(x?.ultimo_respaldo||"").slice(0,10));setVal("tkSysLastMaint",(x?.ultimo_mantenimiento||"").slice(0,10));setVal("tkSysTypeDefault",x?.tipo_solicitud_default||"");setVal("tkSysOrigin",x?.origen||"ticket");setVal("tkSysNotes",x?.observaciones||"");$$("[data-sys-kind]").forEach(b=>b.classList.toggle("is-active",b.dataset.sysKind===kind));syncSystemKind(kind);renderSysPicker(kind,x?.producto||"");$("#tkSystemDelete")&&($("#tkSystemDelete").hidden=!x?.id);o.hidden=false;document.body.classList.add("modal-open")};
const deleteClientSystemFromTicket=async()=>{const id=$("#tkSysId")?.value;if(!id)return closeSystemPanel();if(!confirm("¿Borrar este producto del cliente?"))return;setBusy(true);try{const{error}=await s.from("cliente_sistemas").delete().eq("id",id);if(error)throw error;CLIENT_SYSTEMS=await loadClientSystems();renderMetaBits();closeSystemPanel();toast("Sistema borrado.","ok")}catch(err){toast(msg(err),"bad")}finally{setBusy(false)}};
 const saveClientSystemFromTicket=async()=>{if(ST.busy)return;if(!T?.cliente_id)return toast("Primero liga el cliente.","warn");setBusy(true);try{const id=$("#tkSysId")?.value||"",payload={cliente_id:T.cliente_id,system_key:$("#tkSysKey")?.value||null,entorno:$("[data-sys-kind].is-active")?.dataset?.sysKind||"escritorio",sistema:$("#tkSysName")?.value?.trim()||"",tipo_solicitud_default:$("#tkSysTypeDefault")?.value?.trim()||null,version_sistema:$("#tkSysVersion")?.value?.trim()||null,version_windows:$("#tkSysWindows")?.value?.trim()||null,version_sql:$("#tkSysSql")?.value?.trim()||null,tipo_instalacion:$("#tkSysInstall")?.value||null,servidor_o_equipo:$("#tkSysHost")?.value?.trim()||null,ruta_empresa:$("#tkSysPath")?.value?.trim()||null,respaldo_ubicacion:$("#tkSysBackupPlace")?.value?.trim()||null,respaldo_frecuencia:$("#tkSysBackupFreq")?.value?.trim()||null,ultimo_respaldo:$("#tkSysLastBackup")?.value||null,ultimo_mantenimiento:$("#tkSysLastMaint")?.value||null,origen:$("#tkSysOrigin")?.value?.trim()||"ticket",observaciones:$("#tkSysNotes")?.value?.trim()||null,activo:true,actualizado_en:new Date().toISOString(),actualizado_por:(await s.auth.getUser()).data.user?.id||null};if(!payload.sistema)return toast("Indica el producto.","warn");const r=id?await s.from("cliente_sistemas").update(payload).eq("id",id):await s.from("cliente_sistemas").insert(payload);if(r.error)throw r.error;CLIENT_SYSTEMS=await loadClientSystems();renderMetaBits();closeSystemPanel();toast("Sistema guardado.","ok")}catch(err){console.error("SAVE_CLIENT_SYSTEM_ERROR",err);toast(msg(err),"bad")}finally{setBusy(false)}};

const closeSystemPanel=()=>{$("#tkSystemOverlay")&&($("#tkSystemOverlay").hidden=true,document.body.classList.remove("modal-open"))};

const toggleThreadGear=force=>{const m=$("#tkThreadGearMenu");if(!m)return;const open=typeof force==="boolean"?force:m.hasAttribute("hidden");m.toggleAttribute("hidden",!open);m.classList.toggle("hidden",!open)};

const uploadPublicLogFiles=async()=>{if(!ST.logFiles.length)return[];const out=[],u=(await s.auth.getUser()).data.user;for(const file of ST.logFiles){if((file.size||0)>20*1024*1024)throw new Error(`Archivo demasiado grande: ${file.name}`);const safe=file.name.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g,"_").replace(/[^a-zA-Z0-9._()-]/g,"");const path=`${ID}/soporte_${Date.now()}_${crypto.randomUUID()}_${safe}`;const up=await s.storage.from("soporte_adjuntos").upload(path,file,{contentType:file.type||"application/octet-stream",upsert:false});if(up.error)throw up.error;const legacy=await s.from("ticket_archivos").insert({ticket_id:ID,nombre_archivo:file.name,url_archivo:path,mime_type:file.type||null,tamano_bytes:file.size,subido_por:u?.id||null});if(legacy.error)console.error("LEGACY_TICKET_ARCHIVOS_ERROR",legacy.error.message);const canon=await s.from("archivos_ticket").insert({ticket_id:ID,origen:"interno",visibilidad:"publica",nombre_archivo:file.name,storage_path:path,url_firma:null,mime_type:file.type||null,tamano_bytes:file.size,subido_por:u?.id||null,meta:{canal:"ticket_interno",folio:T?.folio||null}});if(canon.error)throw canon.error;out.push({nombre:file.name,tipo:file.type||null,peso:file.size,storage_path:path,url:null,origen:"soporte_interno"})}return out};

const nextStep=t=>{const s=ticketStateKey(t?.estado),d=norm(`${t?.titulo||""} ${t?.descripcion||""}`);if(s==="esperando_cliente")return"Esperar respuesta del cliente";if(s==="resuelto")return"Cerrar al confirmar";if(d.includes("xml"))return"Pedir evidencia";if(d.includes("captura")||d.includes("máquina"))return"Revisar evidencia";if(d.includes("remoto")||d.includes("remote_access")||d.includes("teamviewer"))return"Coordinar revisión";return s==="abierto"?"Hacer triage":"Dar seguimiento"};
const remoteAccessFromText=t=>{const x=String(t?.contexto_adicional||"").match(/Acceso remoto:\s*([^\n]+)/i);return x?.[1]?.trim()||""};
const remoteAccess=()=>CLIENT_ACCESSES.find(x=>norm(x.tipo)==="remote_access"&&x.activo!==false)||null;
const remoteAccessOf=t=>remoteAccess()?.valor||remoteAccessFromText(t)||"";
const loadClientAccesses=async()=>{if(!T?.cliente_id)return[];const{data,error}=await s.from("cliente_accesos").select("*").eq("cliente_id",T.cliente_id).eq("activo",true).order("actualizado_en",{ascending:false});if(error){console.error("LOAD_CLIENT_ACCESSES_ERROR",error);return[]}return Array.isArray(data)?data:[]};
const renderRemoteAccessPill=()=>{const ad=remoteAccessOf(T),pill=$("#tkRemoteAccessPill"),txt=$("#tkRemoteAccess"),btn=$("#tkCopyRemoteAccessBtn img");if(!pill||!txt)return;txt.textContent=ad||"Agregar acceso";pill.classList.toggle("has-access",!!ad);pill.classList.toggle("no-access",!ad);if(btn)btn.src=ad?"../IMG/copy.png":"../IMG/mas.png"};
const saveRemoteAccess=async()=>{if(!T?.cliente_id)return toast("Primero liga el cliente.","warn");const cur=remoteAccessOf(T),val=prompt(cur?"Actualizar Acceso remoto / acceso remoto:":"Agregar Acceso remoto / acceso remoto:",cur||"");if(val===null)return;const clean=String(val||"").trim();if(!clean)return toast("No se guardó porque quedó vacío.","warn");setBusy(true);try{const u=(await s.auth.getUser()).data.user,old=remoteAccess(),payload={cliente_id:T.cliente_id,contacto_id:T?.contacto_id||null,tipo:"remote_access",valor:clean,etiqueta:"Acceso remoto",activo:true,actualizado_en:new Date().toISOString(),actualizado_por:u?.id||null};const r=old?.id?await s.from("cliente_accesos").update(payload).eq("id",old.id):await s.from("cliente_accesos").insert(payload);if(r.error)throw r.error;const extra=String(T?.contexto_adicional||"").replace(/(^|\n)\s*Acceso remoto:\s*[^\n]*/ig,"").trim(),nextExtra=`${extra}${extra?"\n":""}Acceso remoto: ${clean}`;                                                                                                                                                                                                                                                                                                                                                                        const remotePatch={contexto_adicional:nextExtra,fecha_actualizacion:new Date().toISOString()};if(!T?.asignado_a)remotePatch.asignado_en=null;const up=await s.from("tickets").update(remotePatch).eq("id",ID).select().single();if(up.error)throw up.error;T=up.data;CLIENT_ACCESSES=await loadClientAccesses();renderContext();toast("Acceso remoto guardado para el cliente.","ok")}catch(err){console.error("SAVE_REMOTE_ACCESS_ERROR",err);toast(msg(err),"bad")}finally{setBusy(false)}};
const cleanContextExtra=t=>String(t?.contexto_adicional||"").replace(/(^|\n)\s*Acceso remoto:\s*[^\n]*/ig,"").trim();
const renderContactPreference=()=>{
  // D2B2: fallback runtime. Marca canal preferente sin romper carga si faltaba helper.
  try{
    const raw=String(T?.canal_preferido||T?.medio_contacto||T?.canal||"").toLowerCase();
    const prefersEmail=/correo|email|mail/.test(raw);
    const prefersPhone=/tel|telefono|teléfono|whatsapp|wa|llamada/.test(raw);

    const emailBadge=$("#tkEmailPrefBadge");
    const phoneBadge=$("#tkPhonePrefBadge");
    const emailRow=$("#tkEmailRow");
    const phoneRow=$("#tkPhoneRow");

    if(emailBadge){
      emailBadge.hidden=!prefersEmail;
      emailBadge.textContent="Mejor";
    }
    if(phoneBadge){
      phoneBadge.hidden=!prefersPhone;
      phoneBadge.textContent="Mejor";
    }

    emailRow?.classList.toggle("is-preferred",prefersEmail);
    phoneRow?.classList.toggle("is-preferred",prefersPhone);
  }catch(e){
    console.warn("RENDER_CONTACT_PREF_WARN",e);
  }
};

const renderContext=()=>{const extra=cleanContextExtra(T);setTxt("tkImpact",T?.impacto||T?.impact||"—");setTxt("tkAffected",T?.afecta_a||T?.afectados||"—");setTxt("tkSince",T?.desde_cuando||T?.since||"—");setTxt("tkNext",nextStep(T));setTxt("tkLastChange",T?.ultimo_cambio||"—");setTxt("tkAvailabilitySide",T?.horario_contacto||T?.horario_disponible||"—");setTxt("tkContextExtra",extra||"—");renderRemoteAccessPill();renderContactPreference()};


const crmMiniState=t=>{if(!t?.cliente_id)return{txt:"Falta ligar cliente",cls:"bad"};if(t?.requiere_consolidacion)return{txt:"Falta consolidar identidad",cls:"warn"};if(t?.cliente_id&&!t?.contacto_id)return{txt:"Cliente listo, falta contacto",cls:"warn"};if(t?.cliente_id&&t?.contacto_id)return{txt:"Listo para operar",cls:"ok"};return{txt:"Revisión pendiente",cls:"info"}};
const crmMiniChannel=t=>{const ch=norm(t?.canal_preferido||t?.canal||t?.medio_contacto||"");if(ch==="whatsapp")return"WhatsApp";if(ch==="telefono")return"Llamada";if(ch==="correo")return"Correo";return"Por confirmar"};
const crmMiniHours=t=>T?.horario_disponible||T?.availability||"Sin horario claro";
const crmMiniNext=t=>{if(!t?.cliente_id)return"Ligar cliente antes de seguir";if(t?.requiere_consolidacion)return"Confirmar identidad del caso";if(t?.cliente_id&&!t?.contacto_id)return"Definir contacto operativo";if(norm(t?.estado)==="esperando_cliente")return"Esperar respuesta o archivo";if(norm(t?.prioridad)==="urgente")return"Dar atención prioritaria";return"Continuar seguimiento"};
const crmMiniChips=t=>{const out=[];if(t?.cliente_id)out.push(`<span class="tag ok">Cliente ligado</span>`);if(t?.contacto_id)out.push(`<span class="tag ok">Contacto ligado</span>`);if(!t?.contacto_id&&t?.cliente_id)out.push(`<span class="tag warn">Falta contacto</span>`);if(t?.requiere_consolidacion)out.push(`<span class="tag warn">Por consolidar</span>`);if(norm(t?.canal_preferido||t?.canal)==="whatsapp")out.push(`<span class="tag info">Canal WhatsApp</span>`);if(norm(t?.estado)==="esperando_cliente")out.push(`<span class="tag warn">Espera cliente</span>`);return out.length?out.join(""):`<span class="tag">Sin contexto CRM</span>`};
const renderIdentity=()=>{const cp=$("#tkCopyPhoneBtn"),phone=T?.telefono_capturado||"";if(cp)cp.hidden=!phone;const matchLabel=T?.match_nivel?`${T.match_nivel}${T?.match_score?` · score ${T.match_score}`:""}`:"—",identityOk=!!T?.cliente_id&&!T?.requiere_consolidacion,L=ST.linkedContact||null,st=identityStatusText(T),crmState=crmMiniState(T),av=availabilityState(T),email=T?.correo_capturado||T?.correo_cliente||"",workHours=T?.horario_laboral||L?.horario_laboral||"—",availability=av.known?(av.range||"—"):"—";$("#tkCapturedEmailLink")&&($("#tkCapturedEmailLink").textContent=email||"—",$("#tkCapturedEmailLink").href=mailtoOf(email),$("#tkCapturedEmailLink").target="_blank");$("#tkCapturedPhoneLink")&&($("#tkCapturedPhoneLink").textContent=phone||"—",$("#tkCapturedPhoneLink").href=telOf(phone));$("#tkWorkHours")&&($("#tkWorkHours").textContent=workHours);$("#tkAvailability")&&($("#tkAvailability").textContent=availability);$("#tkAvailabilityNote")&&($("#tkAvailabilityNote").textContent=T?.horario_notas||T?.horario_contacto||"Sin nota adicional.");$("#tkAvailabilityInfo")&&($("#tkAvailabilityInfo").hidden=!(T?.horario_notas||T?.horario_contacto));$("#tkSuggestedClient")&&($("#tkSuggestedClient").textContent=T?.cliente_id_sugerido?`ID ${T.cliente_id_sugerido}`:"—");$("#tkSuggestedContact")&&($("#tkSuggestedContact").textContent=T?.contacto_id_sugerido?`ID ${T.contacto_id_sugerido}`:"—");$("#tkMatchMeta")&&($("#tkMatchMeta").textContent=matchLabel);$("#tkConsolidationState")&&($("#tkConsolidationState").textContent=T?.requiere_consolidacion?"Pendiente de revisión":identityOk?"Consolidado con cliente":"Sin pendiente operativo");$("#tkLinkedContactName")&&($("#tkLinkedContactName").textContent=L?.nombre||"—");$("#tkLinkedContactEmail")&&($("#tkLinkedContactEmail").textContent=L?.correo||"—");$("#tkLinkedContactPhone")&&($("#tkLinkedContactPhone").textContent=L?.telefono||"—");$("#tkLinkedContactRole")&&($("#tkLinkedContactRole").textContent=L?.puesto||"—");$("#tkUseSuggestedClientBtn")&&($("#tkUseSuggestedClientBtn").disabled=!T?.cliente_id_sugerido||!!T?.cliente_id);$("#tkMarkNewContactBtn")&&($("#tkMarkNewContactBtn").disabled=!T?.requiere_consolidacion);$("#tkMarkConsolidatedBtn")&&($("#tkMarkConsolidatedBtn").disabled=!T?.requiere_consolidacion);$("#tkExistingContact")&&($("#tkExistingContact").disabled=!T?.cliente_id);$("#tkLinkExistingContactBtn")&&($("#tkLinkExistingContactBtn").disabled=!T?.cliente_id);$("#tkConsolidationHint")&&($("#tkConsolidationHint").className=`tag ${av.known?av.cls:st.cls}`,$("#tkConsolidationHint").textContent=av.known?av.txt:st.txt);$("#tkCrmState")&&($("#tkCrmState").textContent=crmState.txt);$("#tkCrmChannel")&&($("#tkCrmChannel").textContent=crmMiniChannel(T));$("#tkCrmHours")&&($("#tkCrmHours").textContent=crmMiniHours(T));$("#tkCrmNextAction")&&($("#tkCrmNextAction").textContent=crmMiniNext(T));$("#tkCrmChips")&&($("#tkCrmChips").innerHTML=crmMiniChips(T));$("#tkCrmHint")&&($("#tkCrmHint").textContent=crmState.cls==="ok"?"Ya tienes contexto suficiente para operar sin fricción.":crmState.cls==="warn"?"Conviene cerrar identidad/contacto antes de avanzar demasiado.":"Hace falta contexto básico para operar con claridad.");const more=$("#tkContactMoreBtn"),pending=!!(T?.requiere_consolidacion||!T?.cliente_id||!T?.contacto_id||T?.cliente_id_sugerido||T?.contacto_id_sugerido);if(more){more.style.display=shouldShowContactMore(T)?"inline-grid":"none";more.classList.toggle("needs-review",pending);more.classList.toggle("clean-contact",!pending);more.title=pending?"Revisar contacto e identidad":"Contacto listo"}};

const identityStatusText=t=>{if(!t?.cliente_id)return{txt:"Falta ligar cliente",cls:"bad"};if(t?.requiere_consolidacion)return{txt:"Falta consolidar identidad",cls:"warn"};if(t?.cliente_id&&!t?.contacto_id)return{txt:"Falta definir contacto",cls:"warn"};if(t?.cliente_id&&t?.contacto_id)return{txt:"Listo para operar",cls:"ok"};return{txt:"Revisión pendiente",cls:"info"}};
const renderPortalMeta=()=>{const exp=T?.token_publico_expira?new Date(T.token_publico_expira).getTime():0,now=Date.now(),active=!!T?.token_publico&&(!exp||exp>now),expired=!!exp&&exp<=now,m=ST.portalMeta||{},turn=chatTurnMeta(T),reply=$("#tkPortalLastReply");$("#tkPortalLinkState")&&($("#tkPortalLinkState").textContent=expired?"Vencido":active?"Link activo":"Sin link");$("#tkPortalExpires")&&($("#tkPortalExpires").textContent=T?.token_publico_expira?humanAgo(T.token_publico_expira):"—");$("#tkPortalLastView")&&($("#tkPortalLastView").textContent=m.lastView?humanAgo(m.lastView):"Sin apertura");reply&&(reply.textContent=m.lastReply?humanAgo(m.lastReply):turn.lastAuthor==="Cliente"?"Respondió en chat":"Sin respuesta");$("#tkPortalChips")&&($("#tkPortalChips").innerHTML=`${active?`<span class="tag ok">Link activo</span>`:""}${expired?`<span class="tag bad">Vencido</span>`:""}${turn.lastAuthor==="Cliente"?`<span class="tag warn">Cliente respondió</span>`:`<span class="tag info">${esc(turn.turno||"Seguimiento")}</span>`}${m.lastView?`<span class="tag info">Portal abierto</span>`:""}`)};
const notifSig=()=>JSON.stringify({estado:T?.estado||"",lastReply:ST.portalMeta?.lastReply||"",lastView:ST.portalMeta?.lastView||"",prioridad:T?.prioridad||""});
const beep=(freq=880,dur=.12,type="sine")=>{if(ST.notif?.sound===false)return;try{const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;ST.audio=ST.audio||new AC();const ctx=ST.audio,o=ctx.createOscillator(),g=ctx.createGain();o.type=type;o.frequency.value=freq;g.gain.value=Number(ST.notif?.volume??0.5);o.connect(g);g.connect(ctx.destination);o.start();g.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+dur);o.stop(ctx.currentTime+dur)}catch{}};
const playTone=kind=>{if(ST.notif?.sound===false)return;if(kind==="strong"){beep(980,.12,"square");setTimeout(()=>beep(740,.12,"square"),130);return}beep(720,.08);setTimeout(()=>beep(880,.08),90)};
const notifyInternal=(text,kind="soft")=>{if(ST.ticketMuted)return;if(ST.notif?.visual!==false)toast(text,kind==="strong"?"warn":"ok");if(kind==="strong"||ST.notif?.sound!==false)playTone(kind)};
const evaluateInternalNotif=()=>{const sig=notifSig();if(!ST.lastNotifSig){ST.lastNotifSig=sig;return}if(sig===ST.lastNotifSig)return;const prev=JSON.parse(ST.lastNotifSig||"{}"),state=ticketStateKey(T?.estado),prevState=ticketStateKey(prev?.estado),replyNow=ST.portalMeta?.lastReply||"",replyPrev=prev?.lastReply||"";if(replyNow&&replyNow!==replyPrev&&ST.notif?.portal_client_reply!==false)notifyInternal("El cliente respondió desde el portal.","strong");else if(state!==prevState&&state==="esperando_cliente"&&ST.notif?.portal_waiting_client!==false)notifyInternal("Este ticket quedó esperando cliente.","soft");else if(state!==prevState&&state==="resuelto"&&ST.notif?.portal_resolved!==false)notifyInternal("Este ticket fue marcado como resuelto.","soft");else if(state!==prevState&&norm(T?.prioridad)==="urgente"&&ST.notif?.internal_urgent_ticket!==false)notifyInternal("Ticket urgente actualizado.","strong");ST.lastNotifSig=sig};
const ticketVisibleSnapshot=()=>({sig:notifSig(),state:ticketStateKey(T?.estado),reply:ST.portalMeta?.lastReply||"",view:ST.portalMeta?.lastView||"",clientId:T?.cliente_id||null,logsLen:(LOGS||[]).length,filesLen:(FILES||[]).length,updated:T?.fecha_actualizacion||"",timelineLen:Array.isArray(T?.timeline_publica)?T.timeline_publica.length:0});
const refreshTicketLive=async()=>{const prev=ticketVisibleSnapshot(),tk=await loadTicketCore();if(!tk)return;T=tk;await loadTicketContext();ST.portalMeta=await loadPortalMeta();const clientChanged=(T?.cliente_id||null)!==prev.clientId;if(clientChanged){ST.linkedContact=await loadLinkedContact();await loadClientContacts();CLIENT_SYSTEMS=await loadClientSystems();CLIENT_ACCESSES=await loadClientAccesses()}else{if(!ST.linkedContact&&T?.cliente_id)ST.linkedContact=await loadLinkedContact();if(T?.cliente_id)CLIENT_ACCESSES=await loadClientAccesses()}const next=ticketVisibleSnapshot(),shouldRender=clientChanged||next.sig!==prev.sig||next.state!==prev.state||next.reply!==prev.reply||next.view!==prev.view||next.logsLen!==prev.logsLen||next.filesLen!==prev.filesLen||next.updated!==prev.updated||next.timelineLen!==prev.timelineLen;if(shouldRender)withLogScrollPreserved(()=>render());if(next.sig!==prev.sig||next.state!==prev.state||next.reply!==prev.reply||next.view!==prev.view)evaluateInternalNotif()};

const startTicketPolling=()=>{stopTicketPolling();ST.poller=setInterval(()=>refreshTicketLive().catch(()=>{}),20000)};
const stopTicketPolling=()=>{if(ST.poller)clearInterval(ST.poller);ST.poller=null};
const refreshTicketAfterIdentityChange=async()=>{const tk=await loadTicketCore();if(!tk)return;T=tk;await loadTicketContext();ST.linkedContact=await loadLinkedContact();ST.portalMeta=await loadPortalMeta();await loadClientContacts();CLIENT_SYSTEMS=await loadClientSystems();CLIENT_ACCESSES=await loadClientAccesses();withLogScrollPreserved(()=>render());applyNotifUi();if(!ST.lastNotifSig)ST.lastNotifSig=notifSig()};

const applyTicketIdentityUpdate=async({payload,accion,detalle,toastOk})=>{if(ST.busy)return;setBusy(true);try{const ticketPatch={...payload,fecha_actualizacion:new Date().toISOString()};if(!T?.asignado_a&&!ticketPatch.asignado_a)ticketPatch.asignado_en=null;const up=await s.from("tickets").update(ticketPatch).eq("id",ID).select().single();if(up.error)throw up.error;T=up.data;await logAction({accion,cliente_id:T?.cliente_id||null,detalle:{ticket_id:String(ID),...detalle}}).catch(()=>{});await refreshTicketAfterIdentityChange();toast(toastOk,"ok")}catch(err){toast(msg(err),"bad")}finally{setBusy(false)}};

const useSuggestedClient=async()=>{if(!T?.cliente_id_sugerido)return toast("No hay cliente sugerido.","warn");await applyTicketIdentityUpdate({payload:{cliente_id:T.cliente_id_sugerido,match_confirmado:true,requiere_consolidacion:false},accion:"ticket_identity_use_suggested_client",detalle:{cliente_id_sugerido:T?.cliente_id_sugerido||null,match_confirmado:true,requiere_consolidacion:false},toastOk:"Cliente sugerido aplicado."})};
const markNewContact=async()=>{await applyTicketIdentityUpdate({payload:{contacto_es_nuevo:true,contacto_confirmado:false,requiere_consolidacion:true},accion:"ticket_identity_mark_new_contact",detalle:{contacto_es_nuevo:true,contacto_confirmado:false,requiere_consolidacion:true},toastOk:"Caso marcado con contacto nuevo."})};
const markConsolidated=async()=>{await applyTicketIdentityUpdate({payload:{requiere_consolidacion:false,match_confirmado:!!T?.cliente_id},accion:"ticket_identity_consolidated",detalle:{requiere_consolidacion:false,match_confirmado:!!T?.cliente_id},toastOk:"Caso marcado como consolidado."})};
const linkExistingContact=async()=>{const sel=$("#tkExistingContact");if(!sel?.value)return toast("Selecciona un contacto primero.","warn");await applyTicketIdentityUpdate({payload:{contacto_id:sel.value,contacto_confirmado:true,contacto_es_nuevo:false,requiere_consolidacion:false},accion:"ticket_contact_linked",detalle:{contacto_id:sel.value,contacto_confirmado:true,requiere_consolidacion:false},toastOk:"Contacto vinculado"})};


const loadClientContacts=async()=>{const sel=$("#tkExistingContact");if(!sel)return;if(!T?.cliente_id){sel.innerHTML=`<option value="">Primero liga un cliente</option>`;sel.disabled=true;return}const {data,error}=await s.from("clientes_contactos").select("id,nombre,correo,telefono,puesto,activo,es_principal").eq("cliente_id",T.cliente_id).eq("activo",true).order("es_principal",{ascending:false}).order("nombre",{ascending:true});if(error){sel.innerHTML=`<option value="">No se pudieron cargar contactos</option>`;sel.disabled=true;return}sel.disabled=false;sel.innerHTML=`<option value="">Selecciona un contacto del cliente</option>${(data||[]).map(x=>`<option value="${x.id}">${esc(x.nombre||"Sin nombre")}${x.puesto?` · ${esc(x.puesto)}`:""}${x.correo?` · ${esc(x.correo)}`:""}${x.telefono?` · ${esc(x.telefono)}`:""}${x.es_principal?" · principal":""}</option>`).join("")}`;if(T?.contacto_id)sel.value=T.contacto_id;};
const loadClientSystems=async()=>{if(!T?.cliente_id)return[];const {data,error}=await s.from("cliente_sistemas").select("*,producto:sistema,version_producto:version_sistema").eq("cliente_id",T.cliente_id).order("sistema",{ascending:true});if(error){console.error("LOAD_CLIENT_SYSTEMS_ERROR",error);return[]}return Array.isArray(data)?data:[]};
const systemIconHtml=name=>{const fake={producto:name||""};return systemLogoHtml(fake)};
const systemLogoHtml=t=>{const k=detectSystemKey(t),src=SYS_LOGO[k]||"",label=t?.producto||t?.producto_detectado||t?.tipo_producto||(k?k.replaceAll("_"," "):"Soporte general");return src?`<span class="tk-system-chip"><img src="${src}" alt="${esc(label)}" class="tk-system-logo"></span>`:`<span>${esc(label)}</span>`};

const renderClientSystems=()=>{const box=$("#tkSystemsList");if(!box)return;box.innerHTML=CLIENT_SYSTEMS.length?CLIENT_SYSTEMS.map(x=>`<div class="tk-system-item"><div class="tk-system-head"><div class="tk-system-title">${systemIconHtml(x.producto)}<span>${esc(x.producto||"Sistema")}</span></div><div class="tk-system-actions"><button class="mini btn-ghost" type="button" data-sys-edit="${x.id}">Editar</button></div></div><div class="tk-system-meta"><span class="tag">${esc(x.tipo_solicitud_default||"Sin tipo default")}</span>${x.version_producto?`<span class="tag">Versión ${esc(x.version_producto)}</span>`:""}${x.version_windows?`<span class="tag">${esc(x.version_windows)}</span>`:""}${x.servidor_o_equipo?`<span class="tag">${esc(x.servidor_o_equipo)}</span>`:""}</div>${x.observaciones?`<div class="tk-system-notes">${esc(x.observaciones)}</div>`:""}</div>`).join(""):`<div class="empty-state">Sin productos registrados para este cliente.</div>`};



const heatLevel=x=>x>=28?"Muy alta":x>=14?"Alta actividad":x>=7?"Actividad media":"Normal";
const heatRowsFor=days=>{const since=Date.now()-Number(days||30)*864e5;return(HEAT.rows||[]).filter(x=>new Date(x.fecha_creacion||x.fecha_actualizacion||0).getTime()>=since)};
const heatPeriodLabel=d=>Number(d)===365?"1 año":Number(d)===180?"6 meses":Number(d)===90?"3 meses":"1 mes";
const heatStats=days=>{const rows=heatRowsFor(days),urgent=rows.filter(x=>norm(x.prioridad)==="urgente").length,wait=rows.filter(x=>ticketStateKey(x.estado)==="esperando_cliente").length,open=rows.filter(x=>!["resuelto","cerrado"].includes(ticketStateKey(x.estado))).length,score=rows.length+(urgent*2)+wait;return{total:rows.length,urgent,wait,open,level:heatLevel(score),score}};
const renderHeat=()=>{const days=HEAT.periodDays||30,st=heatStats(days);$("#tkHeatPeriodBadge")&&($("#tkHeatPeriodBadge").textContent="Historial");document.querySelectorAll("[data-heat-days]").forEach(b=>b.classList.toggle("is-active",Number(b.dataset.heatDays)===Number(days)));$("#tkHeatTotal")&&($("#tkHeatTotal").textContent=String(st.total));$("#tkHeatUrgent")&&($("#tkHeatUrgent").textContent=String(st.urgent));$("#tkHeatWait")&&($("#tkHeatWait").textContent=String(st.wait));$("#tkHeatLevel")&&($("#tkHeatLevel").textContent=st.level)};

const detectSystemKey=t=>{
const x=norm(`${t?.sistema||""} ${t?.sistema_detectado||""} ${t?.tipo_sistema||""} ${t?.categoria||""} ${t?.tipo||""} ${t?.titulo||""} ${t?.descripcion||""}`);
if(x.includes("bord"))return"JANOME_BORDADORA";
if(x.includes("overlock")||x.includes("454")||x.includes("7034"))return"JANOME_OVERLOCK";
if(x.includes("cover")||x.includes("collaretera"))return"JANOME_COVERPRO";
if(x.includes("hd")||x.includes("heavy"))return"JANOME_HD";
if(x.includes("prensatelas")||x.includes("pie "))return"JANOME_PRENSATELAS";
if(x.includes("bastidor"))return"JANOME_BASTIDOR";
if(x.includes("garantia")||x.includes("garantía"))return"JANOME_GARANTIA";
if(x.includes("refaccion")||x.includes("refacción")||x.includes("aguja")||x.includes("bobina")||x.includes("pedal"))return"JANOME_REFACCION";
if(x.includes("mantenimiento")||x.includes("servicio"))return"JANOME_SERVICIO";
return"JANOME_DOMESTICA";
};

const smartWhen=v=>{if(!v)return"—";const d=new Date(v),now=new Date(),today=new Date(now.getFullYear(),now.getMonth(),now.getDate()),that=new Date(d.getFullYear(),d.getMonth(),d.getDate()),diff=Math.round((today-that)/86400000),hm=d.toLocaleTimeString("es-MX",{hour:"numeric",minute:"2-digit"});if(diff===0)return`Hoy · ${hm}`;if(diff===1)return`Ayer · ${hm}`;if(diff===2)return`Antier · ${hm}`;if(diff<=6)return`Hace ${diff} días · ${hm}`;return`${d.toLocaleDateString("es-MX",{day:"numeric",month:"long"})} · ${hm}`};
const humanAgo=v=>{if(!v)return"—";const d=new Date(v),now=new Date(),today=new Date(now.getFullYear(),now.getMonth(),now.getDate()),that=new Date(d.getFullYear(),d.getMonth(),d.getDate()),diff=Math.round((today-that)/86400000),hm=d.toLocaleTimeString("es-MX",{hour:"numeric",minute:"2-digit"});if(diff===0)return`Hoy · ${hm}`;if(diff===1)return`Ayer · ${hm}`;if(diff===2)return`Antier · ${hm}`;if(diff<=6)return`Hace ${diff} días · ${hm}`;return`${d.toLocaleDateString("es-MX",{day:"2-digit",month:"2-digit"})} · ${hm}`};

const renderChatTurn=()=>{const m=chatTurnMeta(T),lastAuthor=m.lastAuthor==="Soporte"?"Soporte respondió":m.lastAuthor==="Cliente"?"Cliente respondió":"Sin movimiento claro";$("#tkPortalState")&&($("#tkPortalState").textContent=m.portal);$("#tkChatTurn")&&($("#tkChatTurn").textContent=m.turno);$("#tkChatLastAuthor")&&($("#tkChatLastAuthor").textContent=lastAuthor);$("#tkChatLastAgo")&&($("#tkChatLastAgo").textContent=humanAgo(m.lastAt))};
const slaMeta=t=>{const now=Date.now(),fr=t?.sla_first_response_deadline?new Date(t.sla_first_response_deadline).getTime():0,res=t?.sla_resolution_deadline?new Date(t.sla_resolution_deadline).getTime():0,state=ticketStateKey(t?.estado),needFr=!t?.primera_respuesta_en&&fr,target=needFr?fr:res;if(["resuelto","cerrado"].includes(state))return{txt:"SLA cerrado",cls:"ok",hint:"Caso sin presión SLA."};if(!target)return{txt:"Sin SLA",cls:"",hint:"Este ticket no trae fechas SLA calculadas."};const mins=Math.round((target-now)/60000),label=needFr?"1ra respuesta":"Resolución";if(mins<0)return{txt:`${label} vencida`,cls:"bad",hint:`SLA vencido hace ${Math.abs(mins)} min.`};if(mins<=60)return{txt:`${label} ${mins} min`,cls:"bad",hint:"Atender antes de que venza."};if(mins<=240)return{txt:`${label} ${Math.round(mins/60)} h`,cls:"warn",hint:"SLA próximo. Priorizar si hay carga alta."};return{txt:`${label} ${Math.round(mins/60)} h`,cls:"ok",hint:"SLA en margen sano."}};
const attentionMeta=t=>{const state=ticketStateKey(t?.estado),m=chatTurnMeta(t),last=m?.lastAt?new Date(m.lastAt).getTime():0,upd=new Date(t?.fecha_actualizacion||t?.fecha_creacion||Date.now()).getTime(),hrs=last?Math.round((Date.now()-last)/36e5):0,forgot=Math.round((Date.now()-upd)/36e5);if(["resuelto","cerrado"].includes(state))return{txt:"Sin presión inmediata",cls:"ok",hint:"Caso en cierre o consulta."};if(m?.lastAuthor==="Cliente"&&hrs>=2)return{txt:`Cliente espera ${hrs} h`,cls:"bad",hint:"Conviene responder antes de seguir con otros casos."};if(m?.lastAuthor==="Cliente")return{txt:"Cliente respondió",cls:"warn",hint:"Hay respuesta nueva del cliente."};if(state==="esperando_cliente"&&forgot>=24)return{txt:`Cliente sin responder ${forgot} h`,cls:"warn",hint:"Puedes enviar recordatorio suave si aplica."};if(forgot>=48)return{txt:`Ticket olvidado ${forgot} h`,cls:"bad",hint:"No tiene movimiento reciente. Revisa si falta cierre, respuesta o evidencia."};if(forgot>=24)return{txt:`Sin movimiento ${forgot} h`,cls:"warn",hint:"Buen momento para revisar siguiente acción."};return{txt:"Sin presión inmediata",cls:"ok",hint:"El caso no requiere alerta urgente ahora."}};
const composerSuggestion=t=>{const s=ticketStateKey(t?.estado),a=attentionMeta(t),txt=norm(`${t?.titulo||""} ${t?.descripcion||""}`);if(a.cls==="bad"&&a.txt.includes("Cliente espera"))return{kind:"seguimiento",state:"en_proceso",text:"Gracias por la actualización. Estamos revisando la información que compartiste y te confirmamos el siguiente paso en breve."};if(s==="esperando_cliente")return{kind:"seguimiento",state:"esperando_cliente",text:"Seguimos atentos a la información solicitada para poder continuar con la revisión del caso."};if(txt.includes("xml")||txt.includes("cfdi")||txt.includes("timbr"))return{kind:"solicitud",state:"esperando_cliente",text:"Para avanzar con la revisión, por favor comparte un foto o video corto del problema y una captura completa del comportamiento reportado."};if(txt.includes("remoto")||txt.includes("remote_access")||txt.includes("teamviewer"))return{kind:"solicitud",state:"esperando_cliente",text:"Para avanzar más rápido, por favor comparte el acceso remoto y un horario disponible para la revisión."};if(s==="resuelto")return{kind:"solucion",state:"resuelto",text:"El caso aparece como resuelto. Si confirmas que todo opera correctamente, podemos dejarlo cerrado."};return{kind:"seguimiento",state:"",text:""}};
const applyAutoComposer=()=>{if(ST.quickBootDone||$("#logText")?.value?.trim())return;const x=composerSuggestion(T);if(!x?.text)return;setComposerMode(x.kind,x.state);$("#logText")&&($("#logText").value=x.text);ST.quickBootKey="sugerencia";ST.quickBootText=x.text;renderQuickBootHint()};

const renderHeader=()=>{const u=T?.nombre_capturado||T?.nombre_cliente_contacto||"—",a=$("#tkSideClose"),b=$("#tkSideToggle");a&&a.toggleAttribute("hidden",innerWidth>1180);b&&b.toggleAttribute("hidden",innerWidth>1180);$("#tkClient")&&($("#tkClient").textContent=u);$("#tkSystem")&&($("#tkSystem").innerHTML=systemLogoHtml(T));$("#tkType")&&($("#tkType").textContent="");montarFichaAgente($("#tkJanome"),T?.sistema)};

const logSenderName=x=>x.side==="other"?(T?.nombre_capturado||T?.nombre_cliente_contacto||"Cliente"):x.side==="me"?(x?.meta?.autor_nombre||ST?.profile?.nombre||"Soporte"):"Sistema";const fileIcon=f=>isImg(f)?"🖼️":isPdf(f)?"📄":isVid(f)?"🎬":"📎";const renderLogFiles=()=>FILES?.length?`<div class="log-files">${FILES.map((f,i)=>`<span class="ev-menu-wrap"><button class="log-file" type="button" data-ev-menu="${i}" title="Opciones de adjunto">${esc(fileIcon(f))} ${esc(f.nombre||`Archivo ${i+1}`)}</button><div class="ev-menu" id="evMenu${i}"><button type="button" data-ev-open="${i}"><img src="../IMG/090-vista.webp" alt="">Vista previa</button><button type="button" data-ev-download="${i}"><img src="../IMG/descargar.png" alt="">Descargar</button><button type="button" data-ev-copy="${i}"><img src="../IMG/015-papel.webp" alt="">Copiar enlace</button></div></span>`).join("")}</div>`:"";const renderThreadFileCard=(f,i)=>{
  const name=f?.nombre||f?.name||f?.nombre_archivo||`Adjunto ${Number(i)+1}`;
  const size=f?.tamano||f?.peso||f?.size||f?.tamano_bytes||0;
  const direct=safeUrl(f?.url||f?.url_firma||"");
  const kind=isImg(f)?"img":isVid(f)?"video":isPdf(f)?"pdf":isText(f)?"text":"file";
  const label=kind==="img"?"Imagen":kind==="video"?"Video":kind==="pdf"?"PDF":kind==="text"?"Texto":"Archivo";
  const icon=kind==="img"?"🖼️":kind==="video"?"🎬":kind==="pdf"?"📄":kind==="text"?"📝":"📎";
  const thumb=kind==="img"&&direct
    ? `<img class="thread-file-thumb-img" src="${escHtml(direct)}" alt="">`
    : kind==="video"&&direct
      ? `<video class="thread-file-thumb-img" src="${escHtml(direct)}" muted playsinline></video>`
      : `<span class="thread-file-thumb-icon">${icon}</span>`;
  return `<article class="thread-file-card thread-file-card--${kind}" data-thread-open="${i}" role="button" tabindex="0" title="${escHtml(name)}">
    <div class="thread-file-thumb" data-thread-thumb="${i}">${thumb}</div>
    <div class="thread-file-main">
      <b>${label}</b>
      <span>${size?prettyBytes(size):"Adjunto"}</span>
    </div>
    <button class="thread-file-download" type="button" data-thread-download="${i}" title="Descargar" aria-label="Descargar">
      <img src="../IMG/descargar.png" alt="">
    </button>
  </article>`;
};

const hydrateThreadFileThumbs=async()=>{
  const nodes=[...document.querySelectorAll("[data-thread-thumb]")];
  for(const node of nodes){
    if(node.dataset.ready==="1") continue;
    const i=Number(node.dataset.threadThumb);
    const f=FILES?.[i];
    if(!f) continue;
    if(!(isImg(f)||isVid(f))) {
      node.dataset.ready="1";
      continue;
    }
    const current=node.querySelector("img,video");
    if(current){
      node.dataset.ready="1";
      continue;
    }
    const u=await signedEvidenceUrl(f);
    if(!u){
      node.dataset.ready="1";
      continue;
    }
    node.innerHTML=isImg(f)
      ? `<img class="thread-file-thumb-img" src="${escHtml(u)}" alt="">`
      : `<video class="thread-file-thumb-img" src="${escHtml(u)}" muted playsinline></video>`;
    node.dataset.ready="1";
  }
};

if(!window.__tcThreadFilesPolishBound){
  window.__tcThreadFilesPolishBound=true;
  document.addEventListener("click",async e=>{
    const dl=e.target.closest("[data-thread-download]");
    if(dl){
      e.preventDefault();
      e.stopPropagation();
      const f=FILES?.[Number(dl.dataset.threadDownload)];
      if(!f)return;
      const u=await signedEvidenceUrl(f);
      if(!u)return toast("No se pudo generar enlace de descarga.","warn");
      const a=document.createElement("a");
      a.href=u;
      a.download=f.nombre||f.name||f.nombre_archivo||"archivo";
      document.body.appendChild(a);
      a.click();
      a.remove();
      return;
    }
    const card=e.target.closest("[data-thread-open]");
    if(card){
      e.preventDefault();
      e.stopPropagation();
      return openEvidence(Number(card.dataset.threadOpen));
    }
  },true);
};

const threadTs=v=>{
  const t=Date.parse(v||"");
  return Number.isFinite(t)?t:0;
};

const fileTs=f=>threadTs(f?.fecha||f?.creado_en||f?.fecha_subida||f?.created_at||f?.meta?.fecha||f?.meta?.created_at||T?.fecha_creacion);

const logRawTs=h=>threadTs(h?.created_at||h?.fecha||h?.fecha_creacion||h?.actualizado_en||h?.updated_at);

const isNoiseLogText=t=>/tu caso fue recibido correctamente|ya entró a nuestra mesa|adjunt[óo]\s+\d+\s+archivo/i.test(String(t||""));

const renderLogs=()=>{
  const author=T?.nombre_capturado||T?.nombre_cliente_contacto||C?.nombre||T?.empresa_capturada||"Cliente";
  $("#tkThreadStamp")&&($("#tkThreadStamp").textContent=`${humanAgo(T?.fecha_creacion)}${FILES?.length?` · ${FILES.length} ${FILES.length===1?"adjunto":"adjuntos"}`:""}`);

  const baseTs=threadTs(T?.fecha_creacion)||1;
  const entries=[];

  entries.push({
    ts:baseTs,
    order:0,
    html:`<div class="log-msg other origin"><div class="log-meta"><b>${esc(author)}</b><span>${fmtHM(T?.fecha_creacion)}</span></div><div class="log-text">${esc(T?.descripcion||"Sin descripción")}</div></div>`
  });

  (LOGS||[]).forEach((raw,idx)=>{
    const x=humanLog(raw);
    if(!x) return;
    if(x.side==="sys") return;
    if(isNoiseLogText(x.text)) return;
    const ts=logRawTs(raw)||baseTs+1000+idx;
    entries.push({
      ts,
      order:100+idx,
      html:`<div class="log-msg ${x.side==="me"?"me":"other"} ${x.kind||""}"><div class="log-meta"><b>${esc(logSenderName(x))}</b><span>${esc(x.time)}</span></div><div class="log-text">${esc(x.text)}</div></div>`
    });
  });

  (FILES||[]).forEach((f,i)=>{
    const ts=fileTs(f)||baseTs+2000+i;
    const who=String(f?.origen||"").includes("cliente")?"Cliente":"Soporte";
    entries.push({
      ts,
      order:300+i,
      html:`<div class="log-msg ${who==="Soporte"?"me":"other"} file-event"><div class="log-meta"><b>${esc(who)}</b><span>${esc(fmtHM(f?.fecha||f?.creado_en||f?.fecha_subida||f?.created_at||T?.fecha_creacion))}</span></div><div class="thread-files-grid">${renderThreadFileCard(f,i)}</div></div>`
    });
  });

  entries.sort((a,b)=>(a.ts-b.ts)||(a.order-b.order));

  $("#logArea").innerHTML=entries.map(x=>x.html).join(""); hydrateThreadFileThumbs().catch(()=>{});
};

const withLogScrollPreserved=fn=>{const box=$("#logArea");if(!box)return fn();const nearBottom=box.scrollHeight-box.scrollTop-box.clientHeight<40,top=box.scrollTop;fn();requestAnimationFrame(()=>{if(nearBottom)box.scrollTop=box.scrollHeight;else box.scrollTop=top})};

const renderShellBits=()=>{renderHeader();renderContext();renderIdentity();renderPortalMeta();renderHeat();renderComposerMode();renderLogFilesMeta();renderSmartReplies()};
const renderThreadBits=()=>{renderLogs()};
const softenHeat=()=>{
  // D2B4: fallback runtime. Suaviza/normaliza chips de historial sin romper carga.
  try{
    const fold=$("#tkHeatFold");
    const badge=$("#tkHeatPeriodBadge");
    const level=$("#tkHeatLevel");
    const total=Number($("#tkHeatTotal")?.textContent||0);
    const urgent=Number($("#tkHeatUrgent")?.textContent||0);
    const wait=Number($("#tkHeatWait")?.textContent||0);

    if(badge)badge.textContent="Historial";
    fold?.classList.toggle("is-hot",urgent>0||wait>0);
    fold?.classList.toggle("is-calm",!urgent&&!wait&&total<=3);

    const pulse=$("#tkRadarPulse");
    if(pulse && level){
      const txt=String(level.textContent||"").trim();
      if(txt) pulse.textContent=txt==="Normal" ? "Sin presión" : txt;
    }
  }catch(e){
    console.warn("SOFTEN_HEAT_WARN",e);
  }
};

const renderMetaBits=()=>{renderClientSystems();applyNotifUi();saveTicketMute(ST.ticketMuted);syncChannelIcon();softenHeat()};

const render=()=>{renderShellBits();renderThreadBits();renderMetaBits();applyAutoComposer()};

const loadTicketCore=async()=>{if(!ID)return null;const tk=await s.from("tickets").select("*").eq("id",ID).single();if(tk.error||!tk.data)return null;return tk.data};
const loadTicketContext=async()=>{const since365=new Date(Date.now()-365*864e5).toISOString();const[cl,legacyLogs,heatRows,legacyArchRows,eventRows,newArchRows]=await Promise.all([T?.cliente_id?s.from("clientes").select("id,nombre").eq("id",T.cliente_id).single():Promise.resolve({data:null}),s.from("bitacora").select("*").eq("detalle->>ticket_id",String(ID)).order("fecha",{ascending:true}),T?.cliente_id?s.from("tickets").select("id,prioridad,estado,fecha_creacion,fecha_actualizacion").eq("cliente_id",T.cliente_id).gte("fecha_creacion",since365):Promise.resolve({data:[]}),s.from("ticket_archivos").select("*").eq("ticket_id",ID).order("fecha_subida",{ascending:true}),s.from("ticket_eventos").select("*").eq("ticket_id",ID).order("created_at",{ascending:true}),s.from("archivos_ticket").select("*").eq("ticket_id",ID).order("creado_en",{ascending:true})]);C=cl.data||null;const ev=Array.isArray(eventRows?.data)?eventRows.data:[];const legacy=legacyLogs?.data||[];LOGS=ev.length?ev:legacy;HEAT.rows=Array.isArray(heatRows?.data)?heatRows.data:[];
const canonFiles=normalizeFiles(newArchRows?.data),legacyFiles=normalizeFiles(legacyArchRows?.data),ticketFiles=normalizeFiles(T?.adjuntos),timelineFiles=normalizeFiles((Array.isArray(T?.timeline_publica)?T.timeline_publica:[]).flatMap(x=>Array.isArray(x?.adjuntos)?x.adjuntos:[]));FILES=[...canonFiles,...ticketFiles,...timelineFiles,...legacyFiles].filter((x,i,a)=>a.findIndex(y=>fileUniqKey(y)===fileUniqKey(x))===i);$("#tkDataMode")&&($("#tkDataMode").textContent=ev.length||canonFiles.length||timelineFiles.length?"new":"legacy")};
const hydrateTicketUi=async()=>{setRailOpenCount(1);if(C?.id&&C?.nombre)pushRecentClient({id:C.id,nombre:C.nombre});setGlobalSearchData({clientes:C?[C]:[],tickets:T?[{...T,clientes:C||null}]:[]});setBreadcrumb([{label:"Panel",href:"dashboard.html"},{label:"Tickets",href:"tickets.html"},{label:T?.titulo||"Caso"}]);ST.linkedContact=await loadLinkedContact();ST.portalMeta=await loadPortalMeta();ST.notif=ST.notif||await loadNotifPrefs();loadTicketMute();await loadClientContacts();CLIENT_SYSTEMS=await loadClientSystems();CLIENT_ACCESSES=await loadClientAccesses();await loadQuickReplies();const renewal=await loadRenewalChip();withLogScrollPreserved(()=>render());applyQuickBoot();if(!ST.lastNotifSig)evaluateInternalNotif()};

const load=async()=>{await guardSession("index.html");const profile=(await s.from("perfiles").select("*").limit(1).maybeSingle()).data||{rol:"soporte"};ST.profile=profile||null;ensureAppShell({page:"ticket",title:"",kicker:"",role:profile?.rol||"soporte",actionsHtml:""});setAppRole(profile.rol||"soporte");if(!ID){toast("Falta ID del ticket","bad");setTimeout(()=>location.href="tickets.html",900);return}const tk=await loadTicketCore();if(!tk){toast("Ticket no encontrado","bad");setTimeout(()=>location.href="tickets.html",900);return}T=tk;await loadTicketContext();await hydrateTicketUi()};
const refreshTicketAfterWrite=async()=>{const prevClientId=T?.cliente_id||null;const tk=await loadTicketCore();if(!tk)return;T=tk;await loadTicketContext();ST.linkedContact=await loadLinkedContact();ST.portalMeta=await loadPortalMeta();if((T?.cliente_id||null)!==prevClientId){await loadClientContacts();CLIENT_SYSTEMS=await loadClientSystems()}withLogScrollPreserved(()=>render());const renewal=await loadRenewalChip(); renderComposerMode();renderLogFilesMeta();applyNotifUi();if(!ST.lastNotifSig)ST.lastNotifSig=notifSig()};
const buildTicketPublicEntry=({kind,texto,uploaded,now})=>["solicitud","solucion","seguimiento"].includes(kind)?{kind:"mensaje",autor:"soporte",titulo:publicEntryTitle(kind),texto:texto||(uploaded.length?`Se adjuntaron ${uploaded.length} archivo(s) para revisión.`:"Actualización de soporte."),fecha:now,adjuntos:uploaded}:null;
const buildTicketUpdatePayload=({nextState,entry,uploaded=[],now})=>{
  const timeline=Array.isArray(T?.timeline_publica)?T.timeline_publica:[];
  const adjuntosActuales=Array.isArray(T?.adjuntos)?T.adjuntos:[];
  const payload={fecha_actualizacion:now};

  if(nextState)payload.estado=ticketStateKey(nextState);
  if(entry)payload.timeline_publica=[...timeline,entry];
  if(entry&&!T?.primera_respuesta_en)payload.primera_respuesta_en=now;
  if(["cerrado"].includes(ticketStateKey(nextState)))payload.fecha_cierre=now;

  if(uploaded.length){
    payload.adjuntos=[...adjuntosActuales,...uploaded];
    payload.evidencia_count=payload.adjuntos.length;
  }

  // D1B: compatibilidad con check tickets_asignado_en_requires_asignado_a_chk.
  if(!T?.asignado_a)payload.asignado_en=null;

  return payload;
};
const resetComposerAfterSave=kind=>{
  // D2A: fallback estable; evita toast rojo resetComposerAfterSave is not defined.
  try{
    const box=$("#logText");
    if(box){
      box.value="";
      fitComposerText?.();
      box.setAttribute("placeholder","Escribe un mensaje");
    }
    ST.logFiles=[];
    const files=$("#logFiles");
    if(files)files.value="";
    renderLogFilesMeta?.();
    clearQuickBoot?.();
    setComposerMode?.("seguimiento","");
    renderSmartReplies?.();
    renderComposerMode?.();
    const st=$("#logStatus");
    if(st)st.textContent="";
  }catch(e){
    console.warn("RESET_COMPOSER_AFTER_SAVE_WARN",e);
  }
};

const saveLog=async()=>{if(ST.busy)return;const texto=$("#logText").value.replace(/\n{3,}/g,"\n\n").trim(),kind=$("#logKind")?.value||"nota",nextState=$("#logState")?.value||"",isPublic=["solicitud","solucion","seguimiento"].includes(kind),visibilidad=isPublic?"publica":"interna",evKind=kind==="nota"?"nota":kind==="solucion"?"estado":"mensaje";if(!texto&&!ST.logFiles.length){$("#logStatus")&&($("#logStatus").textContent="Escribe un avance o adjunta al menos un archivo.");return}$("#logStatus")&&($("#logStatus").textContent="Guardando...");setBusy(true);try{let uploaded=[];if(isPublic&&ST.logFiles.length)uploaded=await uploadPublicLogFiles();const ev=await s.from("ticket_eventos").insert({ticket_id:ID,autor_tipo:"soporte",visibilidad,kind:evKind,texto:(texto||uploaded.length)?(texto||`Soporte adjuntó ${uploaded.length} archivo(s).`):null,meta:{kind_original:kind,estado:nextState||null,adjuntos:uploaded,folio:T?.folio||null}});if(ev.error)throw ev.error;if(nextState&&kind!=="solucion"){const ev2=await s.from("ticket_eventos").insert({ticket_id:ID,autor_tipo:"soporte",visibilidad:"publica",kind:"estado",texto:`Estado actualizado a ${ticketStateLabel(nextState)}.`,meta:{estado:nextState,folio:T?.folio||null}});if(ev2.error)throw ev2.error}const ins=await s.from("bitacora").insert({accion:`ticket_${kind}`,cliente_id:T?.cliente_id||null,detalle:{ticket_id:String(ID),texto:texto||null,kind,estado:nextState||null,publico:isPublic,autor:"soporte",adjuntos:uploaded},fecha:new Date().toISOString(),visibilidad:"interna",tipo:"nota_interna"});if(ins.error)console.error("TICKET_BITACORA_ERROR",ins.error.message);const now=new Date().toISOString(),entry=buildTicketPublicEntry({kind,texto,uploaded,now}),payload=buildTicketUpdatePayload({nextState,entry,uploaded,now}),up=await s.from("tickets").update(payload).eq("id",ID).select().single();if(up.error)throw up.error;if(up.data)T=up.data;resetComposerAfterSave(kind);await refreshTicketAfterWrite();toast("Seguimiento guardado","ok")}catch(err){$("#logStatus")&&($("#logStatus").textContent=msg(err));$("#logText")?.focus();toast(msg(err),"bad")}finally{setBusy(false)}};



const setWait=async()=>setComposerMode("seguimiento","esperando_cliente");
const setSolve=async()=>setComposerMode("solucion","resuelto");
const reopenTicket=async()=>setComposerMode("seguimiento","abierto");
const closeTicket=async()=>setComposerMode("solucion","cerrado");

const bindFolds=()=>document.querySelectorAll(".fold-card>summary").forEach(s=>s.addEventListener?.("click",e=>{e.preventDefault();const d=s.closest("details");if(d)d.open=!d.open}));

const fitComposerText=()=>{const t=$("#logText");if(!t)return;t.style.height="auto";t.style.height=Math.min(t.scrollHeight,118)+"px"};
const ensureComposerSendInside=()=>{const wrap=$(".composer-input-wrap"),btn=$("#saveLogBtn");if(wrap&&btn&&!wrap.contains(btn))wrap.appendChild(btn);fitComposerText()};

const bindComposer=()=>{const box=$(".composer-chatbox"),txt=$("#logText");$("#saveLogBtn")&&($("#saveLogBtn").onclick=saveLog);$("#logFiles")&&$("#logFiles").addEventListener("change",onLogFiles);$("#logKind")&&$("#logKind").addEventListener("change",()=>{renderComposerMode();renderSmartReplies();renderLogFilesMeta()});$("#logState")&&$("#logState").addEventListener("change",renderComposerMode);$("#pickPublicFilesBtn")&&($("#pickPublicFilesBtn").onclick=()=>$("#logFiles")?.click());let _closeArm=0;$("#tkCloseCaseBtn")&&($("#tkCloseCaseBtn").onclick=()=>{const b=$("#tkCloseCaseBtn"),now=Date.now();if(now-_closeArm<3000){_closeArm=0;if(b)b.textContent="Cerrar caso";resolveTicket()}else{_closeArm=now;if(b)b.textContent="Confirma cierre";setTimeout(()=>{if($("#tkCloseCaseBtn"))$("#tkCloseCaseBtn").textContent="Cerrar caso"},3000)}});$("#logFilesMeta")&&$("#logFilesMeta").addEventListener("click",e=>{const d=e.target.closest("[data-logfile-del]");if(!d)return;ST.logFiles.splice(+d.dataset.logfileDel,1);const dt=new DataTransfer();ST.logFiles.forEach(f=>dt.items.add(f));$("#logFiles")&&($("#logFiles").files=dt.files);renderLogFilesMeta()});$("#modeReplyBtn")&&($("#modeReplyBtn").onclick=()=>setComposerMode("seguimiento",""));$("#modeNoteBtn")&&($("#modeNoteBtn").onclick=()=>setComposerMode("nota",""));$("#tkResolveBtn")&&($("#tkResolveBtn").onclick=resolveTicket);$("#tkEnterSends")&&($("#tkEnterSends").onchange=e=>{setEnterSends(e.target.checked);renderComposerMode()});setEnterSends(getEnterSends());ensureComposerSendInside();txt&&txt.addEventListener("input",()=>{const p=txt.selectionStart,v=txt.value,n=capFirst(v);if(v!==n){txt.value=n;txt.setSelectionRange(p,p)}ST.quickBootText=txt.value.trim()||"";fitComposerText();renderQuickBootHint()});txt&&txt.addEventListener("keydown",e=>{const enter=e.key==="Enter",sendFast=enter&&(e.ctrlKey||e.metaKey),sendPlain=enter&&getEnterSends()&&!e.shiftKey;if(sendFast||sendPlain){e.preventDefault();if(!ST.busy)saveLog()}});box&&["dragenter","dragover"].forEach(ev=>box.addEventListener(ev,e=>{e.preventDefault();box.classList.add("is-drag")}));box&&["dragleave","drop"].forEach(ev=>box.addEventListener(ev,e=>{e.preventDefault();box.classList.remove("is-drag")}));box&&box.addEventListener("drop",e=>{const files=acceptEvidenceFiles(e.dataTransfer?.files);if(files.length){ST.logFiles=files;const dt=new DataTransfer();files.forEach(f=>dt.items.add(f));$("#logFiles")&&($("#logFiles").files=dt.files);renderLogFilesMeta()}});document.addEventListener("click",e=>{if(e.target.closest("#tkQuickBootClear")){clearQuickBoot();txt&&(txt.value="");renderComposerMode();return}})};
const bindIdentity=()=>{$("#tkUseSuggestedClientBtn")&&($("#tkUseSuggestedClientBtn").onclick=useSuggestedClient);$("#tkMarkNewContactBtn")&&($("#tkMarkNewContactBtn").onclick=markNewContact);$("#tkMarkConsolidatedBtn")&&($("#tkMarkConsolidatedBtn").onclick=markConsolidated);$("#tkLinkExistingContactBtn")&&($("#tkLinkExistingContactBtn").onclick=linkExistingContact);$("#tkContactMoreBtn")&&($("#tkContactMoreBtn").onclick=openContactPanel);$("#tkContactClose")&&($("#tkContactClose").onclick=closeContactPanel);$("#tkContactOverlay")&&$("#tkContactOverlay").addEventListener("click",e=>{if(e.target.id==="tkContactOverlay")closeContactPanel()});$("#tkCopyEmailBtn")&&($("#tkCopyEmailBtn").onclick=()=>{const v=$("#tkCapturedEmailLink")?.textContent||"";if(v&&v!=="—")navigator.clipboard.writeText(v).then(()=>toast("Correo copiado","ok")).catch(()=>toast("No se pudo copiar","bad"))});$("#tkCopyPhoneBtn")&&($("#tkCopyPhoneBtn").onclick=()=>{const v=$("#tkCapturedPhoneLink")?.textContent||"";if(v&&v!=="—")navigator.clipboard.writeText(v).then(()=>toast("Teléfono copiado","ok")).catch(()=>toast("No se pudo copiar","bad"))})};
const bindSystems=()=>{$("#tkAddSystemBtn")&&($("#tkAddSystemBtn").onclick=()=>openSystemPanel(null));$("#tkSystemClose")&&($("#tkSystemClose").onclick=closeSystemPanel);$("#tkSystemCancel")&&($("#tkSystemCancel").onclick=closeSystemPanel);$("#tkSystemSave")&&($("#tkSystemSave").onclick=saveClientSystemFromTicket);$("#tkSystemDelete")&&($("#tkSystemDelete").onclick=deleteClientSystemFromTicket);$("#tkSystemOverlay")&&$("#tkSystemOverlay").addEventListener("click",e=>{if(e.target===e.currentTarget)return closeSystemPanel();const k=e.target.closest("[data-sys-kind]");if(k){syncSystemKind(k.dataset.sysKind);renderSysPicker(k.dataset.sysKind,$("#tkSysName")?.value||"");return}const p=e.target.closest("[data-sys-pick]");if(p){const kind=$("#tkSysPicker")?.dataset?.kind||"escritorio",row=(SYS_PICK[kind]||[]).find(a=>a[0]===p.dataset.sysPick)||[];$("#tkSysName")&&($("#tkSysName").placeholder=`Modelo de ${p.dataset.sysPick||"producto"} (ej. HD3000BE)`);$("#tkSysKey")&&($("#tkSysKey").value=row[1]||"");$$(".sys-pick").forEach(x=>x.classList.toggle("is-active",x===p));return}})};



const bindChrome=()=>{$("#evClose")&&($("#evClose").onclick=hideEv);$("#tkNotifVisual")&&$("#tkNotifVisual").addEventListener("change",e=>saveNotifPrefs({visual:!!e.target.checked}));$("#tkNotifSound")&&$("#tkNotifSound").addEventListener("change",e=>saveNotifPrefs({sound:!!e.target.checked}));$("#tkNotifVolume")&&$("#tkNotifVolume").addEventListener("input",e=>saveNotifPrefs({volume:Number(e.target.value||0.5)}));$("#tkNotifStrongOnly")&&$("#tkNotifStrongOnly").addEventListener("change",e=>{const on=!!e.target.checked;saveNotifPrefs(on?{portal_waiting_client:false,portal_resolved:false}:{portal_waiting_client:true,portal_resolved:true})})};
const openSide=()=>document.body.classList.add("tk-side-open");
const closeSide=()=>document.body.classList.remove("tk-side-open");

const bindGlobalClicks=()=>{document.addEventListener("click",async e=>{const hp=e.target.closest("[data-heat-days]");if(hp){HEAT.periodDays=Number(hp.dataset.heatDays)||30;renderHeat();return}const sideBtn=e.target.closest("#tkSideToggle");if(sideBtn)return openSide();const sideClose=e.target.closest("#tkSideClose");if(sideClose)return closeSide();const contactMore=e.target.closest("#tkContactMoreBtn");if(contactMore)return openContactPanel();const avInfo=e.target.closest("#tkAvailabilityInfo");if(avInfo){e.preventDefault();const r=avInfo.getBoundingClientRect(),p=document.createElement("div");p.className="tk-info-pop";p.textContent=T?.horario_notas||T?.horario_contacto||"Sin nota adicional de horario.";document.body.appendChild(p);p.style.left=Math.min(r.left,innerWidth-260)+"px";p.style.top=Math.max(12,r.top-54)+"px";setTimeout(()=>p.remove(),2600);return}const contactDot=e.target.closest("#tkContactDot");if(contactDot){e.preventDefault();e.stopPropagation();return openContactPanel()}const contactTop=e.target.closest("#tkContactCollapse");if(contactTop){$("#tkContactFold").open=false;return}const contactClose=e.target.closest("#tkContactClose");if(contactClose)return closeContactPanel();if(document.body.classList.contains("tk-side-open")&&!e.target.closest(".ticket-side")&&!e.target.closest("#tkSideToggle"))return closeSide();const qrc=e.target.closest("#tkQrClose");if(qrc)return qrClose();
const qrm=e.target.closest("[data-qrmode]");if(qrm){qrCollect();QRM.mode=qrm.dataset.qrmode;await qrLoadEditor();qrPaintEditor();return}const qrs=e.target.closest("[data-qrscope]");if(qrs){qrCollect();QRM.scope=qrs.dataset.qrscope;if(QRM.scope==="cliente"&&!qrClientId())return toast("Este ticket no tiene cliente ligado.","warn");if(QRM.scope==="contacto"&&!qrContactId())return toast("Este ticket no tiene contacto ligado.","warn");await qrLoadEditor();qrPaintEditor();return}const qra=e.target.closest("#tkQrAddRow");if(qra)return qrAddRow();const qrg=e.target.closest("#tkQrSaveAll");if(qrg)return qrSaveAll();const qrx=e.target.closest("[data-qr-act]");if(qrx){const row=qrx.closest(".tk-qr-row"),i=+row.dataset.i,id=row.dataset.id||"",act=qrx.dataset.qrAct;qrCollect();if(act==="up"){if(i>0){[QRM.rows[i-1],QRM.rows[i]]=[QRM.rows[i],QRM.rows[i-1]];qrPaintEditor()}return}if(act==="down"){if(i<QRM.rows.length-1){[QRM.rows[i+1],QRM.rows[i]]=[QRM.rows[i],QRM.rows[i+1]];qrPaintEditor()}return}if(act==="use"){applyQuickReply("__txt__"+(QRM.rows[i]?.texto||""));return qrClose()}if(act==="del"){try{if(id)await qrSoftDelete(id);QRM.rows.splice(i,1);qrPaintEditor()}catch(err){toast(msg(err),"bad")}return}}if(e.target?.id==="tkQrModal")return qrClose();
                                                    const gear=e.target.closest("#tkThreadGearBtn");if(gear){e.preventDefault();e.stopPropagation();applyNotifUi();return toggleThreadGear()}const mute=e.target.closest("#tkMuteTicketBtn");if(mute){e.preventDefault();saveTicketMute(!ST.ticketMuted);return}const editSys=e.target.closest("[data-sys-edit]");if(editSys){const rec=CLIENT_SYSTEMS.find(x=>String(x.id)===String(editSys.dataset.sysEdit));if(rec)openSystemPanel(rec);return}const pick=e.target.closest("[data-qrpick]");if(pick&&QR_PICK)return insertQrText(QR_PICK.txt,pick.dataset.qrpick==="replace"?"replace":"add");const qt=e.target.closest("[data-qr-text]");if(qt){e.preventDefault();e.stopPropagation();return useQrPill(qt,qt.dataset.qrText)}if(!e.target.closest("#tkQrPickPop"))closeQrPick();const qe=e.target.closest("#tkQrEditBtn");if(qe)return openQrModal();const q=e.target.closest("[data-qr]");if(q)return applyQuickReply(q.dataset.qr);const copyAny=e.target.closest("#tkCopyRemoteAccessBtn");if(copyAny){const ad=remoteAccessOf(T);if(!ad)return saveRemoteAccess();try{await navigator.clipboard.writeText(ad);toast("Acceso remoto copiado.","ok")}catch{return saveRemoteAccess()}return}const m=e.target.closest("[data-ev-menu]");if(m){e.preventDefault();e.stopPropagation();const box=$(`#evMenu${m.dataset.evMenu}`);closeFileMenus();return box?.classList.toggle("open")}const c=e.target.closest("[data-ev-close]");if(c){e.preventDefault();return closeFileMenus()}const o=e.target.closest("[data-ev-open]");if(o)return openEvidence(+o.dataset.evOpen);const openNew=e.target.closest("[data-ev-open-new]");if(openNew){const f=FILES[+openNew.dataset.evOpenNew],u=await signedEvidenceUrl(f);if(u)window.open(u,"_blank","noopener");closeFileMenus();return}const dl=e.target.closest("[data-ev-download]");if(dl){const f=FILES[+dl.dataset.evDownload],u=await signedEvidenceUrl(f);if(u){const a=document.createElement("a");a.href=u;a.download=f.nombre||"archivo";document.body.appendChild(a);a.click();a.remove()}closeFileMenus();return}const cp=e.target.closest("[data-ev-copy]");if(cp){const f=FILES[+cp.dataset.evCopy],u=await signedEvidenceUrl(f);if(u)await navigator.clipboard.writeText(u).catch(()=>{}),toast("Enlace copiado","ok");closeFileMenus();return}if(!e.target.closest(".ev-menu-wrap"))closeFileMenus();if(!e.target.closest(".thread-gear-wrap"))toggleThreadGear(false);if(e.target===document.querySelector("#evModal"))hideEv()});document.addEventListener("keydown",e=>{if(e.key==="Escape"){if(document.body.classList.contains("tk-side-open"))return closeSide();const gearOpen=!$("#tkThreadGearMenu")?.hidden,isQrOpen=!$("#tkQrModal")?.hidden,evOpen=!$("#evModal")?.hidden,menuOpen=!!document.querySelector(".ev-menu.open"),contactOpen=!$("#tkContactOverlay")?.hidden,sysOpen=!$("#tkSystemOverlay")?.hidden;if(gearOpen)return toggleThreadGear(false);if(isQrOpen)return qrClose();if(evOpen)return hideEv();if(contactOpen)return closeContactPanel();if(sysOpen)return closeSystemPanel();if(menuOpen)return closeFileMenus()}})};
const bind=()=>{if(document.documentElement.dataset.ticketBound)return;document.documentElement.dataset.ticketBound="1";bindComposer();bindFolds();bindIdentity();bindSystems();bindChrome();bindGlobalClicks()};
document.addEventListener("DOMContentLoaded",()=>{const _st=document.createElement("style");_st.textContent="@keyframes tkspin{to{transform:rotate(360deg)}}";document.head.appendChild(_st);ensureAppShell({page:"ticket",title:"",kicker:"",role:"soporte",actionsHtml:""});const _la=document.getElementById("logArea");if(_la)_la.innerHTML='<div style="display:flex;align-items:center;justify-content:center;gap:10px;padding:48px 16px;color:var(--muted,#64748b);font:600 14px Inter,system-ui,sans-serif"><span style="width:16px;height:16px;border:2px solid currentColor;border-top-color:transparent;border-radius:50%;display:inline-block;animation:tkspin .7s linear infinite"></span> Cargando conversación…</div>';try{bind();renderLogFilesMeta();renderComposerMode();setComposerMode("seguimiento","");load().catch(err=>{const e=document.getElementById("logArea");if(e)e.innerHTML='<div class="empty-state">No se pudo cargar la conversación.</div>';toast(msg(err),"bad")});startTicketPolling()}catch(err){console.error("TICKET_BOOT_ERROR",err);toast(msg(err),"bad")}});window.addEventListener("beforeunload",stopTicketPolling,{passive:true});




;(()=> {
  // D2A: copy compacto composer.
  if(window.__tcTicketD2AComposerCopy)return;
  window.__tcTicketD2AComposerCopy=1;
  const sync=()=>{
    try{
      const box=$("#logText");
      if(box)box.setAttribute("placeholder","Escribe un mensaje");
      const enter=$("#tkEnterSends");
      const lab=enter?.closest?.("label");
      if(lab){
        [...lab.childNodes].forEach(n=>{
          if(n.nodeType===3 && String(n.textContent||"").trim()) n.textContent=" Tecla Enter envía";
        });
        if(![...lab.childNodes].some(n=>n.nodeType===3 && /Tecla Enter envía/.test(n.textContent||""))){
          lab.appendChild(document.createTextNode(" Tecla Enter envía"));
        }
      }
    }catch(e){}
  };
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",sync,{once:true});
  else sync();
  setTimeout(sync,350);
  setTimeout(sync,1200);
})();
