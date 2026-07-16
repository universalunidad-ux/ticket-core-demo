import{$,$$,toast,esc,debounce}from"./global.js?v=frontend-final-20260716-01";
import{supabase}from"./supabase.js";
import{poblarSelect,montarBuscadorEquipo}from"./janome/janome_catalogo.js?v=frontend-final-20260716-01";

// Etiqueta legible del equipo Janome elegido (el <select> guarda el ID interno).
const sistemaLabel=()=>{const o=$("#spSystem")?.selectedOptions?.[0];if(!o||!o.value)return"";if(o.value==="OTRO"){const t=($("#spOtroModelo")?.value||"").trim();return t?`Otro: ${t}`:"Otro / no aparece en la lista";}const nombre=o.dataset?.nombre||o.textContent||"";const grupo=o.dataset?.grupo||"";return grupo?`Janome ${nombre} (${grupo})`:`Janome ${nombre}`};
/* B17C43D: etiqueta humana — "Modelo: 3008 · Mecánica" / "Accesorio: X".
   El payload sigue usando sistemaLabel() completo — contrato de envío intacto. */
const SINGULAR_GRUPO={"Mecánicas":"Mecánica","Collareteras":"Collaretera","Overlock":"Overlock","Computarizadas":"Computarizada","Bordadoras":"Bordadora","Bordadoras con costura":"Bordadora con costura","Descontinuadas":"Descontinuada"};
const sistemaLabelHuman=()=>{const o=$("#spSystem")?.selectedOptions?.[0];if(!o||!o.value)return"";if(o.value==="OTRO"){const t=($("#spOtroModelo")?.value||"").trim();return t?`Otro: ${t}`:"Otro"}const nombre=o.dataset?.nombre||o.textContent||"",grupo=o.dataset?.grupo||"";const m=grupo.match(/^Máquinas\s*—\s*(.+)$/);if(m){const tipo=SINGULAR_GRUPO[m[1].trim()]||m[1].trim();return`Modelo: ${nombre} · ${tipo}`}if(/^Accesorios/.test(grupo))return`Accesorio: ${nombre}`;return nombre?`Modelo: ${nombre}`:""};

/* B17C43D: límites diferenciados — 3 imágenes (5MB c/u), 1 video (40MB, 1:30), 1 PDF (5MB), 5 archivos, 60MB total */
const ST={files:[],sending:false,notice:null,faq:null,faqDismissed:new Set()},MAX_FILES=5,MAX_IMG=3,MAX_VID=1,MAX_PDF=1,MAX_VID_SECONDS=90,MAX_MB_IMG=5,MAX_MB_PDF=5,MAX_MB_VID=40,MAX_MB_TOTAL=60,ALLOWED_EXT=["jpg","jpeg","png","webp","heic","heif","mp4","mov","m4v","pdf"],ALLOWED_MIME=["image/jpeg","image/png","image/webp","image/heic","image/heif","video/mp4","video/quicktime","video/x-m4v","application/pdf"];
const SUPPORT_ENDPOINT=`${supabase.supabaseUrl}/functions/v1/support-submit-secure`;
const STATUS_PAGE="estado.html";
const SUPPORT_RETURN_ALLOWLIST=new Set(["dashboard.html","tickets.html","ticket.html","clientes.html","cliente.html"]);
const supportReturnTarget=()=>{const params=new URLSearchParams(location.search),from=String(params.get("from")||"").trim().toLowerCase().replace(/\.html$/,""),raw=String(params.get("returnTo")||"");if(!SUPPORT_RETURN_ALLOWLIST.has(`${from}.html`)||!raw||/[\u0000-\u001f\u007f\\]/.test(raw)||raw.includes("..")||/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(raw))return"";try{const target=new URL(raw,location.href),basePath=location.pathname.slice(0,location.pathname.lastIndexOf("/")+1),file=target.pathname.slice(basePath.length);if(target.origin!==location.origin||!target.pathname.startsWith(basePath)||!SUPPORT_RETURN_ALLOWLIST.has(file))return"";return`${file}${target.search}${target.hash}`}catch{return""}};
const mountSupportBack=()=>{const btn=$("#supportBack"),target=supportReturnTarget();if(!btn)return;btn.hidden=!target;if(target)btn.href=target;else btn.removeAttribute("href")};

ST.match=null;
const TURNSTILE_ENABLED=false;
let TURNSTILE_TOKEN="";
let SUPPORT_SENDING=false;
const extOf=name=>((name||"").split(".").pop()||"").toLowerCase();
const filesTotalMb=list=>[...(list||[])].reduce((n,f)=>n+(Number(f.size)||0),0)/1048576;
const validPublicFiles=list=>{const files=[...(list||[])];if(files.length>MAX_FILES)return`Máximo ${MAX_FILES} archivos.`;for(const f of files){const ext=extOf(f.name),mime=(f.type||"").toLowerCase(),mb=(Number(f.size)||0)/1048576;if(!ALLOWED_EXT.includes(ext))return`Tipo no permitido: ${f.name}`;if(mime&&!ALLOWED_MIME.includes(mime))return`MIME no permitido: ${f.name}`;if(mb<=0)return`Archivo vacío: ${f.name}`;const cap=isVid(f)?MAX_MB_VID:isPdfF(f)?MAX_MB_PDF:MAX_MB_IMG;if(mb>cap)return`${isVid(f)?"El video":isPdfF(f)?"El PDF":"La imagen"} pesa demasiado (máx. ${cap} MB): ${f.name}`;}if(filesTotalMb(files)>MAX_MB_TOTAL)return`El total de archivos no debe exceder ${MAX_MB_TOTAL} MB.`;return""};
const trimVal=id=>($("#"+id)?.value||"").trim();
const setTxt=(id,v)=>{const el=$("#"+id);if(el)el.textContent=v??"—"};
const setHtml=(id,v)=>{const el=$("#"+id);if(el)el.innerHTML=v??""};
const setVal=(id,v)=>{const el=$("#"+id);if(el)el.value=v??""};
const digits=v=>String(v||"").replace(/\D+/g,"");
const normalizeMxPhone=v=>{const raw=digits(v);return raw.length===12&&raw.startsWith("52")?raw.slice(2):raw};
const emailError=v=>{const mail=String(v||"").trim().toLowerCase();if(!mail)return"Escribe tu correo.";if(/\s/.test(mail))return"El correo no puede contener espacios.";if((mail.match(/@/g)||[]).length!==1)return"El correo debe contener una sola @.";const[local,domain]=mail.split("@");if(!local)return"Escribe texto antes de la @.";if(!domain)return"Escribe el dominio después de la @.";if(local.includes("..")||domain.includes(".."))return"El correo no puede contener puntos consecutivos.";if(local.startsWith(".")||local.endsWith(".")||domain.startsWith(".")||domain.endsWith("."))return"Revisa la posición de los puntos en el correo.";if(!domain.includes(".")||domain.split(".").some(x=>!x))return"El dominio debe incluir al menos un punto.";return""};
const validMail=v=>!emailError(v);
const phoneError=v=>{const phone=normalizeMxPhone(v);if(!phone)return"Escribe tu teléfono.";if(phone.length!==10)return`El teléfono debe quedar en 10 dígitos; recibimos ${phone.length}.`;return""};
const setContactError=(id,message)=>{const input=$(id==="email"?"#spEmail":"#spPhone"),box=$(id==="email"?"#spEmailError":"#spPhoneError");input?.setCustomValidity(message);if(box)box.textContent=message};
const validateContactFields=()=>{const mail=emailError(trimVal("spEmail")),phone=phoneError(trimVal("spPhone"));setContactError("email",mail);setContactError("phone",phone);return mail||phone};
const publicPayload=()=>({nombre:trimVal("spName"),empresa:trimVal("spCompany")||null,correo:trimVal("spEmail").toLowerCase(),telefono:normalizeMxPhone(trimVal("spPhone")),categoria:"soporte",sistema:sistemaLabel(),objetivo:trimVal("spGoal"),titulo:trimVal("spTitle"),descripcion:trimVal("spDesc"),impacto:$("#spImpact")?.value||"media",canal:($("#spWhats")?.checked?"whatsapp":"correo"),desde_cuando:trimVal("spSince"),afecta_a:$("#spAffected")?.value||"no_se",cambio_previo:$("#spLastChange")?.value||"",horario_disponible:[trimVal("spAvailabilityFrom")&&trimVal("spAvailabilityTo")?`${trimVal("spAvailabilityFrom")}–${trimVal("spAvailabilityTo")}`:"",trimVal("spAvailability")].filter(Boolean).join(" · "),horario_desde:trimVal("spAvailabilityFrom")||null,horario_hasta:trimVal("spAvailabilityTo")||null,horario_notas:trimVal("spAvailability")||null,contexto_extra:trimVal("spExtra"),remote_access:trimVal("spRemoteAccess"),cliente_id_confirmado:trimVal("spClienteIdConfirmado")||null,contacto_id_confirmado:trimVal("spContactoIdConfirmado")||null,cliente_id_sugerido:ST.match?.candidates?.[0]?.cliente_id||null,contacto_id_sugerido:ST.match?.candidates?.[0]?.contacto_sugerido?.id||null,match_nivel:ST.match?.candidates?.[0]?.level||null,match_score:ST.match?.candidates?.[0]?.score||null,empresa_confirmada:($("#spEmpresaConfirmada")?.value||"0")==="1",contacto_confirmado:($("#spContactoConfirmado")?.value||"0")==="1",contacto_es_nuevo:($("#spContactoEsNuevo")?.value||"0")==="1"});

/* B17C43C: validación que nombra el campo exacto (lista máx. 3 si faltan varios) */
const validatePublicPayload=p=>{const contactError=validateContactFields();if(contactError)return contactError;const faltan=[];if(!p.nombre)faltan.push("tu nombre");if(!p.sistema)faltan.push("seleccionar producto");if(!p.titulo||p.titulo.trim().length<6)faltan.push("resumir qué está pasando");if(!p.descripcion||p.descripcion.trim().length<20)faltan.push("contarnos el detalle");if(faltan.length===1)return`Falta ${faltan[0]}.`;if(faltan.length>1)return`Falta: ${faltan.slice(0,3).join(", ")}${faltan.length>3?"…":""}.`;if(p.titulo.length>120)return"El título es demasiado largo.";if(p.descripcion.length>3000)return"La descripción es demasiado larga.";if((p.contexto_extra||"").length>3000)return"El contexto adicional es demasiado largo.";return""};
const IDENTITY_KEY="tc_identity_v2",LEGACY_IDENTITY_KEY="tc_identity";
const getKnownIdentity=()=>{
  try{
    const raw=JSON.parse(localStorage.getItem(IDENTITY_KEY)||"null");
    if(!raw||typeof raw!=="object")return null;

    /* B17C43G3:
       La memoria pública del navegador nunca conserva IDs internos. */
    return{
      empresa:String(raw.empresa||"").trim(),
      nombre:String(raw.nombre||"").trim(),
      correo:String(raw.correo||"").trim(),
      telefono:String(raw.telefono||"").trim(),
      source:"soporte",
      ts:Number(raw.ts||0)
    };
  }catch{
    return null;
  }
};
/* B17C43D: identidad guardada incluye correo/teléfono; empresa NUNCA se
   rellena con el nombre de la persona (sin fallback cruzado). */
const saveKnownIdentity=()=>{
  const data={
    empresa:trimVal("spCompany"),
    nombre:trimVal("spName"),
    correo:trimVal("spEmail"),
    telefono:trimVal("spPhone"),
    source:"soporte",
    ts:Date.now()
  };

  if(data.empresa||data.nombre||data.correo||data.telefono){
    localStorage.setItem(IDENTITY_KEY,JSON.stringify(data));
  }
};
const clearKnownIdentity=()=>{localStorage.removeItem(IDENTITY_KEY);localStorage.removeItem(LEGACY_IDENTITY_KEY)};
/* Filas sin dato se ocultan (nada de "—" ni empresa falsa) */
const knownRow=(k,v,val)=>{const kk=$("#"+k),vv=$("#"+v);if(kk)kk.hidden=!val;if(vv){vv.hidden=!val;vv.textContent=val||""}};
const fillKnownIdentityBox=d=>{knownRow("spKnownNameK","spKnownName",d?.nombre||"");knownRow("spKnownCompanyK","spKnownCompany",d?.empresa||"");knownRow("spKnownEmailK","spKnownEmail",d?.correo||"");knownRow("spKnownPhoneK","spKnownPhone",d?.telefono||"")};
const applyKnownIdentity=d=>{
  if(!d)return;
  $("#spCompany")&&($("#spCompany").value=d.empresa||"");
  $("#spName")&&($("#spName").value=d.nombre||"");
  $("#spEmail")&&($("#spEmail").value=d.correo||"");
  $("#spPhone")&&($("#spPhone").value=d.telefono||"");
  syncWhats();
  preview();
};
const setIdentityCollapsed=v=>{$("#spKnownIdentityBox")?.classList.toggle("hidden",!v);$("#spIdentityFields")?.classList.toggle("hidden",!!v)};
/* B17C43D: umbral de confianza — la tarjeta solo aparece con identificadores
   reales (cliente/contacto confirmados o correo/teléfono guardados). Un
   nombre suelto NO es un match confiable. */
const identityStrong=d=>!!(d&&d.nombre&&(d.correo||d.telefono));
const hydrateKnownIdentity=()=>{const d=getKnownIdentity();if(!d||!d.nombre)return setIdentityCollapsed(false);if(identityStrong(d)){fillKnownIdentityBox(d);setIdentityCollapsed(true);return}setIdentityCollapsed(false)};

const resetTurnstile=()=>{try{if(window.turnstile){window.turnstile.reset();TURNSTILE_TOKEN="";$("#spCaptchaStatus")&&($("#spCaptchaStatus").textContent="Confirme la validación para enviar su solicitud.");}}catch{}};

const human=n=>n>=1024*1024?`${(n/1024/1024).toFixed(1)} MB`:`${Math.max(1,Math.round(n/1024))} KB`,ext=f=>(f?.name?.split(".").pop()||"").toLowerCase(),fileKey=f=>`${(f.name||"").toLowerCase()}__${f.size||0}__${(f.type||"").toLowerCase()}`,total=()=>ST.files.reduce((a,f)=>a+(f.size||0),0),allowedFile=f=>ALLOWED_EXT.includes(ext(f))||ALLOWED_MIME.includes((f.type||"").toLowerCase());
const impactToPriority=v=>v==="alta"?"alta":v==="media"?"media":"baja";
const mxNow=()=>new Date(new Date().toLocaleString("en-US",{timeZone:"America/Mexico_City"}));
const inUrgentWindow=()=>{const d=mxNow(),day=d.getDay(),h=d.getHours(),m=d.getMinutes(),hm=h*60+m;if(day>=1&&day<=5)return hm>=600&&hm<1080;if(day===6)return hm>=600&&hm<840;return false};
const urgentMsg=()=>inUrgentWindow()?"Estás dentro del horario de atención prioritaria. Adjunta una foto o video de la máquina y déjanos tu mejor teléfono y horario; te contactaremos cuanto antes.":"Estás fuera del horario de atención. Tu caso queda registrado y el equipo lo tomará a primera hora hábil. Adjuntar foto o video ayuda a resolver más rápido.";
const syncUrgentUi=()=>{const on=$("#spImpact")?.value==="alta";$("#spUrgentBox")?.classList.toggle("hidden",!on);if($("#spUrgentMsg"))$("#spUrgentMsg").textContent=urgentMsg()};
const setBusy=v=>{ST.sending=!!v;$("#spSendBtn")&&($("#spSendBtn").disabled=ST.sending);$("#spDraftBtn")&&($("#spDraftBtn").disabled=ST.sending);$("#spFiles")&&($("#spFiles").disabled=ST.sending)};
const setStatus=(t,type="")=>{setTxt("spStatus",t);const el=$("#spStatus");if(el)el.className=`mut ${type}`.trim()};
/* B17C43C: los mensajes de adjuntos viven junto a la zona de archivos, no al pie */
const setFilesStatus=(t,type="")=>{const el=$("#spFilesStatus");if(!el)return setStatus(t,type);el.textContent=t||"";el.className=`sp-files-status mut ${type}`.trim();el.hidden=!t};
const preview=()=>{setTxt("pvName",trimVal("spName")||"—");setTxt("pvSystem",sistemaLabelHuman()||"—");setTxt("pvPhone",trimVal("spPhone")||"—");const tt=$("#spTitle")?.value?.trim()||"";setTxt("pvTitle",tt||"—");/* B17C43D: resumen corto en línea, largo envuelve */const row=$("#pvTitle")?.closest(".tk-receipt-row");row?.classList.toggle("tk-receipt-block",tt.length>32)};
const isImg=f=>/^image\//.test(f?.type||"")||["jpg","jpeg","png","webp","heic","heif"].includes(ext(f));
const isVid=f=>/^video\//.test(f?.type||"")||["mp4","mov","m4v"].includes(ext(f));
const isPdfF=f=>(f?.type||"").toLowerCase()==="application/pdf"||ext(f)==="pdf";
const thumbHtml=f=>isImg(f)?`<img class="jn-thumb" src="${URL.createObjectURL(f)}" alt="">`:`<span class="jn-thumb jn-thumb-ic">${isVid(f)?"🎬":"📄"}</span>`;
const renderFiles=()=>{const box=$("#spFilesMeta"),lab=$("#spFilesLabel");if(lab)lab.textContent=ST.files.length?(ST.files.length===1?"1 adjunto listo":`${ST.files.length} adjuntos listos`):"Sin archivos seleccionados";if(!box)return;box.className="jn-thumbs";box.innerHTML=ST.files.length?ST.files.map((f,i)=>`<div class="jn-thumb-card">${thumbHtml(f)}<div class="jn-thumb-info"><div class="jn-thumb-name" title="${esc(f.name)}">${esc(f.name)}</div><div class="jn-thumb-meta">${human(f.size)}</div></div><button class="jn-thumb-del" type="button" data-del="${i}" title="Quitar" aria-label="Quitar"><img src="../IMG/borrar.webp" alt="Quitar"></button></div>`).join(""):""};/* B17C43C: sin bloque vacío cuando no hay archivos (menos aire) */
const syncWhats=()=>{const valid=normalizeMxPhone($("#spPhone")?.value||"").length===10,row=$("#spWhatsRow"),check=$("#spWhats");row?.classList.toggle("hidden",!valid);row?.setAttribute("aria-hidden",String(!valid));if(!valid&&check)check.checked=false};
const syncOtro=()=>{const otro=$("#spSystem")?.value==="OTRO";$("#spOtroModelo")?.classList.toggle("hidden",!otro);if(!otro&&$("#spOtroModelo"))$("#spOtroModelo").value=""};
const capName=()=>{const el=$("#spName");if(!el)return;const s=el.selectionStart;el.value=el.value.replace(/(^|\s)(\p{L})/gu,(m,a,b)=>a+b.toUpperCase());try{el.setSelectionRange(s,s)}catch{}};
/* B17C43B: valida duración real del video con metadata (sin subirlo).
   Si la metadata no se puede leer (formato raro), se acepta y se deja warn en consola. */
const videoDurationOf=f=>new Promise(res=>{try{const u=URL.createObjectURL(f),v=document.createElement("video");let fin=false;const end=d=>{if(fin)return;fin=true;try{URL.revokeObjectURL(u)}catch{}res(d)};v.preload="metadata";v.onloadedmetadata=()=>end(Number(v.duration)||0);v.onerror=()=>end(-1);setTimeout(()=>end(-2),4000);v.src=u}catch{res(-1)}});
/* B17C43D: validación por tipo con mensajes específicos */
const addFiles=async list=>{const incoming=[...(list||[])].filter(Boolean),seen=new Set(ST.files.map(fileKey));let imgN=ST.files.filter(isImg).length,vidN=ST.files.filter(isVid).length,pdfN=ST.files.filter(isPdfF).length,added=0,ignored=0,warn="";const setWarn=m=>{if(!warn)warn=m};if(!incoming.length){setFilesStatus("No se eligió ningún archivo.","warn");renderFiles();return}for(const f of incoming){if(ST.files.length>=MAX_FILES){setWarn(`Máximo ${MAX_FILES} archivos en total.`);ignored++;continue}if(!allowedFile(f)){setWarn("Solo se aceptan imágenes, video o PDF.");ignored++;continue}if((f.size||0)<=0){ignored++;continue}if(seen.has(fileKey(f))){ignored++;continue}if(isVid(f)){if(vidN>=MAX_VID){setWarn("Solo puedes adjuntar 1 video.");ignored++;continue}if((f.size||0)>MAX_MB_VID*1048576){setWarn(`El video pesa demasiado (máx. ${MAX_MB_VID} MB).`);ignored++;continue}const dur=await videoDurationOf(f);if(dur>MAX_VID_SECONDS+1){setWarn("El video supera 1 min 30 s. Recórtalo e inténtalo de nuevo.");ignored++;continue}if(dur<0)console.warn("VIDEO_METADATA_UNREADABLE",f.name)}else if(isPdfF(f)){if(pdfN>=MAX_PDF){setWarn("Solo puedes adjuntar 1 PDF.");ignored++;continue}if((f.size||0)>MAX_MB_PDF*1048576){setWarn(`El PDF pesa demasiado (máx. ${MAX_MB_PDF} MB).`);ignored++;continue}}else if(isImg(f)){if(imgN>=MAX_IMG){setWarn(`Puedes subir máximo ${MAX_IMG} imágenes.`);ignored++;continue}if((f.size||0)>MAX_MB_IMG*1048576){setWarn(`Cada imagen debe pesar máximo ${MAX_MB_IMG} MB.`);ignored++;continue}}if(total()+(f.size||0)>MAX_MB_TOTAL*1048576){setWarn(`El total de adjuntos no debe exceder ${MAX_MB_TOTAL} MB.`);ignored++;continue}ST.files.push(f);seen.add(fileKey(f));if(isImg(f))imgN++;else if(isVid(f))vidN++;else if(isPdfF(f))pdfN++;added++}if(warn)setFilesStatus(warn,"warn");else if(added)setFilesStatus(adjCountLabel(),"ok");else setFilesStatus("No se agregaron archivos. Revisa tipo, peso o duplicados.","bad");renderFiles()};
const clearForm=()=>{$("#supportForm").reset();if($("#spFiles"))$("#spFiles").value="";ST.files=[];ST.faq=null;ST.faqDismissed=new Set();clearDraft();resetMatch();renderFiles();renderFaq(null);setFilesStatus("");$("#spReceiptFolio")&&($("#spReceiptFolio").textContent="Folio · al enviar");$("#spConsentError")&&($("#spConsentError").textContent="");preview();syncUrgentUi();syncWhats();setBusy(false);setStatus("Complete los datos principales. Si tiene evidencia, puede adjuntarla.");stopSubmitFeedback();hydrateKnownIdentity();$("#supportForm")?.scrollIntoView({behavior:"smooth",block:"start"})};
/* URL absoluta derivada del origen actual: local permanece local y producción
   conserva el dominio público actual. */
const buildStatusUrl=(folio,token)=>{try{return new URL(`${STATUS_PAGE}?folio=${encodeURIComponent(folio||"")}${token?`&token=${encodeURIComponent(token)}`:""}`,location.href).href}catch{return`${STATUS_PAGE}?folio=${encodeURIComponent(folio||"")}`}};
let SUBMIT_FEEDBACK_TIMER=0;
let SUBMIT_FEEDBACK_INDEX=0;

const SUBMIT_FEEDBACK_MESSAGES=[
  "Enviando tu caso…",
  "Seguimos procesándolo…",
  "Casi está listo…"
];

const stopSubmitFeedback=()=>{
  if(SUBMIT_FEEDBACK_TIMER){
    clearInterval(SUBMIT_FEEDBACK_TIMER);
    SUBMIT_FEEDBACK_TIMER=0;
  }
  SUBMIT_FEEDBACK_INDEX=0;
};

const startSubmitFeedback=()=>{
  stopSubmitFeedback();
  SUBMIT_FEEDBACK_INDEX=0;
  setStatus(SUBMIT_FEEDBACK_MESSAGES[0]);

  SUBMIT_FEEDBACK_TIMER=window.setInterval(()=>{
    SUBMIT_FEEDBACK_INDEX=Math.min(
      SUBMIT_FEEDBACK_INDEX+1,
      SUBMIT_FEEDBACK_MESSAGES.length-1
    );
    setStatus(SUBMIT_FEEDBACK_MESSAGES[SUBMIT_FEEDBACK_INDEX]);
  },1800);
};
/* B17C43G-R2: sin búsqueda remota de clientes desde el formulario público. */
const resetMatch=()=>{ST.match=null;["spClienteIdConfirmado","spContactoIdConfirmado"].forEach(id=>{const el=$("#"+id);if(el)el.value=""});["spEmpresaConfirmada","spContactoConfirmado","spContactoEsNuevo"].forEach(id=>{const el=$("#"+id);if(el)el.value="0"})};
const validate=()=>validatePublicPayload(publicPayload())||validPublicFiles(ST.files)||"";

const maybeWarnGlobalIssue=()=>{if(!ST.notice)return false;return confirm(`Hay un aviso general activo:\n\n${ST.notice.titulo}\n${ST.notice.contenido}\n\nSi tu caso corresponde a este aviso, quizá no necesites abrir un ticket nuevo.\n\n¿Aun así deseas enviarlo?`)===false};
const AVISO_CLASE={info:"info",warning:"warn",success:"ok",danger:"danger",mantenimiento:"warn"};
const AVISO_ICONO={info:"ℹ️",warning:"⏳",success:"✅",danger:"⚠️",mantenimiento:"🛠️"};
const renderNotice=notice=>{const wrap=$("#supportNoticeSlot"),box=$("#supportGlobalNotice");if(!wrap||!box)return;ST.notice=notice||null;if(!notice){wrap.hidden=true;box.innerHTML="";return}const cls=AVISO_CLASE[notice.tipo]||"info",ic=AVISO_ICONO[notice.tipo]||"ℹ️";wrap.hidden=false;box.className=`support-global-notice ${cls}`;box.innerHTML=`<div class="notice-ic">${ic}</div><div class="notice-copy"><div class="notice-title">${esc(notice.titulo||"Aviso")}</div><div class="notice-text">${esc(notice.contenido||"")}</div></div>`};
/* B17C43C: cada FAQ trae texto "done" (Ya lo hice) en tono humano */
const FAQS=[{id:"hilo",title:"Se enreda o se rompe el hilo",text:"La mayoría de estos casos se resuelven re-enhebrando: sube el prensatelas, retira el hilo, vuelve a enhebrar superior y bobina, y revisa que la bobina gire en el sentido correcto. Si persiste, podemos ayudarte.",link:"#",fill:"El hilo se enreda o se rompe. Ya intenté re-enhebrar superior y bobina con el prensatelas arriba.",done:"Ya re-enhebré hilo superior y bobina con el prensatelas arriba; el problema continúa."},{id:"aguja",title:"La aguja se rompe o se dobla",text:"Verifica que la aguja sea del tipo y calibre correctos para tu tela, que esté bien insertada (parte plana hacia atrás) y sin daño. Evita jalar la tela al coser.",link:"#",fill:"La aguja se rompe o se dobla. Confirmo tipo de aguja y tela usada.",done:"Ya revisé que la aguja sea del tipo correcto, esté bien insertada y sin daño; el problema continúa."},{id:"tension",title:"Puntada despareja o tensión",text:"Una puntada floja por abajo o arriba suele ser tensión o enhebrado. Vuelve a enhebrar y prueba con un retazo ajustando la tensión superior poco a poco.",link:"#",fill:"La puntada queda despareja / con mala tensión. Indico el tipo de tela y el ajuste de tensión que uso.",done:"Ya re-enhebré y probé ajustando la tensión superior con un retazo; la puntada sigue despareja."},{id:"enciende",title:"No enciende o el pedal no responde",text:"Revisa que el cable de corriente y el del pedal estén bien conectados, el interruptor encendido y, si aplica, el devanador desactivado. Indícanos qué pasa al pisar el pedal.",link:"#",fill:"La máquina no enciende o el pedal no responde. Ya revisé cables, interruptor y devanador.",done:"Ya revisé cable de corriente, pedal, interruptor y devanador; el problema continúa."}];
const faqNeedle=()=>`${$("#spTitle")?.value||""} ${$("#spDesc")?.value||""} ${$("#spGoal")?.value||""} ${$("#spSystem")?.value||""}`.toLowerCase();
const pickFaq=txt=>{if(/hilo|enred|atora|atasc|rompe el hilo|enhebr|bobina/.test(txt))return FAQS[0];if(/aguja/.test(txt))return FAQS[1];if(/tensi|puntada|despar|floj|salta/.test(txt))return FAQS[2];if(/enciende|prende|pedal|corriente|cable|luz/.test(txt))return FAQS[3];return null};
const renderFaq=faq=>{const box=$("#spFaqBox");if(!box)return;ST.faq=faq||null;box.classList.toggle("hidden",!faq);if(!faq)return;$("#spFaqTitle").textContent=faq.title;$("#spFaqText").textContent=faq.text;const lk=$("#spFaqLink");if(lk){const real=/^https?:/i.test(faq.link||"");lk.classList.toggle("hidden",!real);lk.href=real?faq.link:"#"}};
const evalFaq=()=>{const txt=faqNeedle();if(txt.trim().length<18)return renderFaq(null);const f=pickFaq(txt);renderFaq(f&&ST.faqDismissed.has(f.id)?null:f)};
/* B17C43C: "Ya lo hice" — anexa texto humano sin borrar lo del usuario y oculta la sugerencia */
/* B17C43D: idempotente — no duplica el mismo texto aunque se dispare dos veces */
const useFaq=()=>{if(!ST.faq)return;const target=$("#spDesc");if(!target)return;const txt=ST.faq.done||ST.faq.fill,cur=target.value?.trim()||"";if(!cur.includes(txt))target.value=`${cur}${cur?"\n\n":""}${txt}`;ST.faqDismissed.add(ST.faq.id);setStatus("Anotamos que ya lo intentaste. Agrega cualquier otro detalle.","ok");renderFaq(null);preview();target.focus()};

/* B17C46: contrato de publicación de avisos. La consulta ya filtra por activo,
   mostrar_en_soporte y ventana de fechas; el cliente lo vuelve a validar (defensa
   en profundidad) para que un aviso desactivado, vencido o futuro nunca se
   renderice en el hero. No se oculta por CSS: se descarta el dato. */
const isPublishableNotice=n=>{
  if(!n||typeof n!=="object")return false;
  if(n.activo!==true)return false;
  if(n.mostrar_en_soporte!==true)return false;
  const now=Date.now();
  const s=n.starts_at?Date.parse(n.starts_at):NaN;
  if(!Number.isNaN(s)&&s>now)return false;
  const e=n.ends_at?Date.parse(n.ends_at):NaN;
  if(!Number.isNaN(e)&&e<now)return false;
  return true;
};
const loadGlobalNotice=async()=>{try{const now=new Date().toISOString();const {data,error}=await supabase.from("avisos_globales").select("id,titulo,contenido,tipo,activo,mostrar_en_soporte,starts_at,ends_at,prioridad").eq("activo",true).eq("mostrar_en_soporte",true).or(`starts_at.is.null,starts_at.lte.${now}`).or(`ends_at.is.null,ends_at.gte.${now}`).order("prioridad",{ascending:true}).limit(1).maybeSingle();if(error)throw error;renderNotice(isPublishableNotice(data)?data:null)}catch(err){console.warn("SUPPORT_NOTICE_LOAD_ERROR",err);renderNotice(null)}};

const send=async e=>{
  e.preventDefault();

  const submitT0=performance.now();

  if(($("#spWebsite")?.value||"").trim()){
    setStatus("Solicitud enviada.","ok");
    return;
  }

  if(ST.sending||SUPPORT_SENDING)return;

  const consent=$("#spConsent");
  if(!consent?.checked){
    const message="Acepta el Aviso de privacidad y los Términos y condiciones para enviar tu solicitud.";
    $("#spConsentError")&&($("#spConsentError").textContent=message);
    setStatus(message,"bad");
    consent?.focus();
    return;
  }
  $("#spConsentError")&&($("#spConsentError").textContent="");

  const payload=publicPayload();

  /* B17C43G3:
     La superficie pública no puede confirmar, seleccionar ni transmitir
     identificadores internos de clientes/contactos. El matching definitivo
     pertenece exclusivamente a support-submit-secure. */
  [
    "cliente_id",
    "contacto_id",
    "cliente_id_confirmado",
    "contacto_id_confirmado",
    "empresa_confirmada",
    "contacto_confirmado",
    "contacto_es_nuevo"
  ].forEach(key=>delete payload[key]);

  const err=validate();
  if(err)return setStatus(err,"bad");

  if(TURNSTILE_ENABLED&&!TURNSTILE_TOKEN){
    return setStatus("Confirma la validación de seguridad.","bad");
  }

  if(maybeWarnGlobalIssue()){
    return setStatus(
      "Se canceló el envío para evitar un ticket duplicado por aviso global activo.",
      "warn"
    );
  }

  SUPPORT_SENDING=true;
  setBusy(true);
  startSubmitFeedback();

  try{
    const fd=new FormData();
    fd.append("turnstile_token",TURNSTILE_TOKEN);
    fd.append("payload",JSON.stringify(payload));

    ST.files.forEach((f,i)=>{
      fd.append(`file_${i}`,f,f.name);
    });

    const r=await fetch(SUPPORT_ENDPOINT,{
      method:"POST",
      body:fd
    });

    const raw=await r.text();
    let j={};

    try{
      j=raw?JSON.parse(raw):{};
    }catch{
      j={raw};
    }

    if(!r.ok){
      throw new Error(
        j?.message||
        j?.error||
        j?.raw||
        `HTTP_${r.status}`
      );
    }

    const folioReal=String(j?.folio||"").trim();
    const tokenReal=String(
      j?.token_publico||
      j?.token||
      ""
    ).trim();

    if(!folioReal){
      throw new Error(
        "El servidor creó la solicitud, pero no devolvió un folio válido."
      );
    }

    if(!tokenReal){
      throw new Error(
        "El servidor no devolvió el acceso seguro de seguimiento."
      );
    }

    const linkReal=buildStatusUrl(folioReal,tokenReal);

    if(!linkReal){
      throw new Error(
        "No se pudo construir el enlace de seguimiento."
      );
    }

    stopSubmitFeedback();
    setStatus("Caso enviado. Abriendo seguimiento…","ok");

    $("#spReceiptFolio")&&(
      $("#spReceiptFolio").textContent=`Folio · ${folioReal}`
    );

    saveKnownIdentity();
    clearDraft();
    resetTurnstile();

    console.info(
      "SUPPORT_SUBMIT_MS",
      Math.round(performance.now()-submitT0),
      folioReal
    );

    /* Breve confirmación visual; luego sustituye la página para evitar
       reenviar accidentalmente al volver atrás. */
    await new Promise(resolve=>setTimeout(resolve,450));
    location.replace(linkReal);

  }catch(ex){
    stopSubmitFeedback();
    console.error("SUPPORT_SEND_ERROR",ex);

    setStatus(
      ex?.message||"No se pudo enviar la solicitud.",
      "bad"
    );

    toast(
      ex?.message||"Error al enviar la solicitud",
      "bad"
    );

    resetTurnstile();

  }finally{
    SUPPORT_SENDING=false;
    setBusy(false);
  }
};

const fillMap={no_cose:{title:"No cose o salta puntadas",goal:"Volver a coser bien",desc:"La máquina no cose o salta puntadas. Indico el tipo de tela e hilo, si re-enhebré y desde cuándo ocurre.",sys:"",impact:"media"},hilo:{title:"Se enreda o rompe el hilo",goal:"Coser sin que se enrede el hilo",desc:"El hilo se enreda por abajo o se rompe. Ya intenté re-enhebrar superior y bobina con el prensatelas arriba. Indico tipo de tela e hilo.",sys:"",impact:"media"},no_enciende:{title:"No enciende / pedal no responde",goal:"Que vuelva a encender",desc:"La máquina no enciende o el pedal no responde. Revisé cables, interruptor y devanador. Describo qué pasa al pisar el pedal.",sys:"",impact:"alta"},tension:{title:"Tensión despareja",goal:"Emparejar la puntada",desc:"La puntada queda floja o despareja. Indico el tipo de tela y el ajuste de tensión que uso.",sys:"",impact:"baja"}};
const applyFill=k=>{const x=fillMap[k];if(!x)return;setVal("spTitle",x.title);setVal("spGoal",x.goal);setVal("spDesc",x.desc);setVal("spSystem",x.sys);setVal("spImpact",x.impact||"media");preview();setStatus("Se cargó una sugerencia rápida.","ok")};
const bind=()=>{$("#supportForm")?.addEventListener("submit",send);$("#spDraftBtn")?.addEventListener("click",clearForm);$("#spUseKnownBtn")?.addEventListener("click",()=>{const d=getKnownIdentity();if(!d)return;applyKnownIdentity(d);setIdentityCollapsed(false);setStatus("Datos recordados aplicados.","ok")});$("#spOtherIdentityBtn")?.addEventListener("click",()=>{clearKnownIdentity();resetMatch();setIdentityCollapsed(false);$("#spCompany")&&($("#spCompany").value="");$("#spName")&&($("#spName").value="");$("#spEmail")&&($("#spEmail").value="");$("#spPhone")&&($("#spPhone").value="");syncWhats();preview();setStatus("Ingrese otros datos para este caso.","warn")});/* B17C43D: listeners de Copiar enlace/Copiar folio retirados junto con sus botones */["#spTitle","#spSystem","#spImpact","#spSince","#spAffected"].forEach(sel=>$(sel)?.addEventListener("input",preview));["#spSystem","#spImpact","#spAffected"].forEach(sel=>$(sel)?.addEventListener("change",preview));$("#spImpact")?.addEventListener("change",syncUrgentUi);$("#spFiles")?.addEventListener("change",e=>{const files=[...(e.target?.files||[])];addFiles(files);if($("#spFiles"))$("#spFiles").value=""});document.addEventListener("click",e=>{const del=e.target.closest("[data-del]");if(del){ST.files.splice(+del.dataset.del,1);renderFiles();setFilesStatus(ST.files.length?adjCountLabel():"");return}const fill=e.target.closest("[data-fill]");if(fill){applyFill(fill.dataset.fill);return}});["#spName","#spCompany","#spEmail","#spPhone","#spGoal","#spTitle","#spDesc","#spSince","#spAvailability","#spExtra"].forEach(sel=>$(sel)?.addEventListener("input",debounce(preview,120)));["#spTitle","#spDesc","#spGoal","#spSystem"].forEach(sel=>$(sel)?.addEventListener("input",debounce(evalFaq,180)));$("#spSystem")?.addEventListener("change",evalFaq);$("#spFaqUse")?.addEventListener("click",useFaq);$("#spPhone")?.addEventListener("input",()=>{syncWhats();preview()});$("#spWhats")?.addEventListener("change",preview);$("#spConsent")?.addEventListener("change",()=>{$("#spConsentError")&&($("#spConsentError").textContent="")});$("#spSystem")?.addEventListener("change",syncOtro);$("#spOtroModelo")?.addEventListener("input",preview);$("#spName")?.addEventListener("input",capName)};
/* ====== B17C43B — UX público: plurales, borrador local, normalización suave y manuales ====== */
const adjCountLabel=()=>ST.files.length===1?"1 adjunto listo.":`${ST.files.length} adjuntos listos.`;

/* Borrador local con TTL de 1 hora. NO guarda archivos (seguridad/navegador). */
const DRAFT_KEY="tc_soporte_draft_v1",DRAFT_TTL_MS=60*60*1000;
const DRAFT_FIELDS=["spName","spEmail","spPhone","spCompany","spTitle","spDesc","spOtroModelo"];
const saveDraft=()=>{try{const d={ts:Date.now(),fields:{},system:$("#spSystem")?.value||"",systemText:document.querySelector("#spEquipoCombo .jn-combo-input")?.value||"",whats:!!$("#spWhats")?.checked};DRAFT_FIELDS.forEach(id=>{const el=$("#"+id);if(el)d.fields[id]=el.value||""});const any=Object.values(d.fields).some(v=>String(v).trim())||d.system;if(!any){localStorage.removeItem(DRAFT_KEY);return}localStorage.setItem(DRAFT_KEY,JSON.stringify(d))}catch{}};
const clearDraft=()=>{try{localStorage.removeItem(DRAFT_KEY)}catch{}};
const restoreDraft=()=>{try{const d=JSON.parse(localStorage.getItem(DRAFT_KEY)||"null");if(!d?.ts||Date.now()-d.ts>DRAFT_TTL_MS){clearDraft();return false}let any=false;DRAFT_FIELDS.forEach(id=>{const el=$("#"+id);if(el&&d.fields?.[id]&&!el.value.trim()){el.value=d.fields[id];any=true}});if(d.whats&&$("#spWhats"))$("#spWhats").checked=true;if(d.system&&$("#spSystem")&&!$("#spSystem").value){$("#spSystem").value=d.system;const inp=document.querySelector("#spEquipoCombo .jn-combo-input");if(inp&&d.systemText)inp.value=d.systemText;const clr=document.querySelector("#spEquipoCombo .jn-combo-clear");if(clr&&d.systemText)clr.hidden=false;$("#spSystem").dispatchEvent(new Event("change",{bubbles:true}));any=true}return any}catch{return false}};

/* Normalización suave SOLO en campos narrativos (título/descripción):
   trim + colapsar espacios; si TODO está en mayúsculas se baja a oración.
   No toca producto/modelo/series. */
const softNormalize=v=>{let t=String(v||"").replace(/[ \t]+/g," ").replace(/ *\n */g,"\n").trim();if(!t)return t;const letters=t.replace(/[^\p{L}]/gu,"");if(letters.length>=4&&letters===letters.toUpperCase())t=t.toLowerCase();if(/^\p{Ll}/u.test(t))t=t[0].toUpperCase()+t.slice(1);return t};

/* B17C43C: catálogo humano — quita el prefijo "Máquinas — / Accesorios —" de
   grupos y categorías del combo y agrega separadores de segmento. Solo decora
   el DOM que renderiza janome_catalogo.js; no toca su lógica ni sus data-cat. */
const humanizeCombo=()=>{const host=$("#spEquipoCombo");if(!host)return;host.querySelectorAll(".jn-combo-group,.jn-cat-btn").forEach(el=>{if(el.dataset.human)return;const m=(el.textContent||"").match(/^\s*(Máquinas|Accesorios)\s*—\s*(.+)$/);if(m){el.dataset.human="1";el.textContent=m[2]}});const cats=host.querySelector(".jn-combo-cats");if(cats&&!cats.querySelector(".jn-cat-seg")){let sm=false,sa=false;[...cats.querySelectorAll(".jn-cat-btn")].forEach(b=>{const g=b.dataset.cat||"";if(/^Máquinas/.test(g)&&!sm){sm=true;b.insertAdjacentHTML("beforebegin",'<div class="jn-cat-seg">Máquinas</div>')}if(/^Accesorios/.test(g)&&!sa){sa=true;b.insertAdjacentHTML("beforebegin",'<div class="jn-cat-seg">Accesorios</div>')}})}};

const bindB17C43B=()=>{
  $("#spEmail")?.addEventListener("blur",e=>{e.target.value=String(e.target.value||"").trim().toLowerCase();setContactError("email",emailError(e.target.value))});
  $("#spEmail")?.addEventListener("input",()=>setContactError("email",""));
  $("#spPhone")?.addEventListener("blur",e=>{const normalized=normalizeMxPhone(e.target.value);if(!phoneError(e.target.value))e.target.value=normalized;setContactError("phone",phoneError(e.target.value));syncWhats();preview()});
  $("#spPhone")?.addEventListener("input",()=>setContactError("phone",""));
  $("#spFilesBtn")?.addEventListener("click",()=>$("#spFiles")?.click());
  /* B17C43C: manuales/ayuda SIEMPRE en nueva pestaña — se intercepta en capture
     y se fuerza window.open; imposible navegar dentro de soporte.html. */
  document.addEventListener("click",e=>{const a=e.target.closest("#spAyudaProducto a[href],#spFaqBox a[href]");if(!a)return;e.preventDefault();e.stopPropagation();const href=a.getAttribute("href")||"";if(/^https?:/i.test(href))window.open(href,"_blank","noopener")},true);
  /* B17C43C: theme toggle blindado — binding directo en el botón del header
     público; stopPropagation evita doble toggle si theme.js también escucha. */
  document.querySelector(".jn-theme-btn")?.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();const html=document.documentElement;const next=(html.getAttribute("data-theme")||"light")==="dark"?"light":"dark";html.dataset.theme=next;html.setAttribute("data-theme",next);try{localStorage.setItem("tc_theme",next)}catch{}document.querySelectorAll("[data-theme-label]").forEach(x=>x.textContent=next==="dark"?"Oscuro":"Claro")});
  /* B17C43C: humanizar catálogo en cada re-render del panel */
  const host=$("#spEquipoCombo");if(host){humanizeCombo();new MutationObserver(()=>humanizeCombo()).observe(host,{childList:true,subtree:true})}
  ["#spTitle","#spDesc"].forEach(sel=>$(sel)?.addEventListener("blur",e=>{const n=softNormalize(e.target.value);if(n!==e.target.value){e.target.value=n;preview()}}));
  const saveSoon=debounce(saveDraft,400);
  $("#supportForm")?.addEventListener("input",saveSoon);
  $("#supportForm")?.addEventListener("change",saveSoon);
  addEventListener("beforeunload",saveDraft);
};

/* B17C43E-R2: hijack de rueda retirado. El scroll ahora es documento
   natural (ver soporte.css); no se secuestra el wheel del hero/recibo. */

document.addEventListener("DOMContentLoaded",async()=>{mountSupportBack();const box=document.createElement("div");box.id="spFilesMeta";box.className="list";$("#spFiles")?.closest(".field")?.appendChild(box);const fst=document.createElement("div");fst.id="spFilesStatus";fst.className="sp-files-status mut";fst.hidden=true;$("#spFiles")?.closest(".field")?.appendChild(fst);poblarSelect($("#spSystem"));montarBuscadorEquipo($("#spSystem"),$("#spEquipoCombo"));bind();$("#spSystem")?.addEventListener("change",preview);preview();renderFiles();renderFaq(null);evalFaq();syncUrgentUi();syncWhats();syncOtro();hydrateKnownIdentity();bindB17C43B();if(restoreDraft()){preview();evalFaq();setStatus("Restauramos tu borrador. Por seguridad, vuelve a seleccionar tus archivos si recargaste la página.","ok")}if(!TURNSTILE_ENABLED)$("#spTurnstileWrap")?.classList.add("hidden");await loadGlobalNotice()});
window.onTurnstileSuccess=token=>{TURNSTILE_TOKEN=token||"";$("#spCaptchaStatus")&&($("#spCaptchaStatus").textContent="Validación correcta.");};
window.onTurnstileExpired=()=>{TURNSTILE_TOKEN="";$("#spCaptchaStatus")&&($("#spCaptchaStatus").textContent="La validación expiró. Confírmela de nuevo.");};
window.onTurnstileError=()=>{TURNSTILE_TOKEN="";$("#spCaptchaStatus")&&($("#spCaptchaStatus").textContent="No se pudo validar. Intente de nuevo.");};
