export const $=q=>document.querySelector(q),$$=q=>[...document.querySelectorAll(q)];
export const esc=v=>(v??"").toString().replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
export const norm=v=>(v||"").toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g," ").trim();
export const qp=k=>new URLSearchParams(location.search).get(k);

export const show=v=>{const el=typeof v==="string"?$(v):v;el?.classList.remove("hidden");el?.classList.add("open");el?.removeAttribute("hidden");return el};
export const hide=v=>{const el=typeof v==="string"?$(v):v;el?.classList.add("hidden");el?.classList.remove("open");el?.setAttribute("hidden","hidden");return el};

export const toggle=v=>{const el=typeof v==="string"?$(v):v;if(!el)return;el.classList.toggle("hidden");el.classList.toggle("open");el.hidden=el.classList.contains("hidden");return el};

export const toast=(text,type="",ms=2600)=>{document.querySelectorAll(".toast").forEach(x=>x.remove());const d=document.createElement("div");d.className=`toast ${type}`.trim();d.textContent=text;document.body.appendChild(d);setTimeout(()=>d.remove(),ms)};
export const debounce=(fn,ms=220)=>{let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms)}};
export const copyTxt=(v,msg="Copiado")=>navigator.clipboard.writeText(v||"").then(()=>toast(msg,"ok")).catch(()=>toast("No se pudo copiar","bad"));
const blurInside=n=>{const a=document.activeElement;if(n&&a&&n.contains(a)&&a.blur)a.blur()};
export const bindModal=(sel,closeSel=".close,.close-x,.icon-btn")=>{const m=$(sel);if(!m||m.dataset.bound)return;m.dataset.bound="1";m.addEventListener("click",e=>{if(e.target===m||e.target.closest(closeSel))hide(sel)})};

export const applyTheme=v=>{const t=v==="dark"?"dark":"light";document.documentElement.setAttribute("data-theme",t);const label=$("[data-theme-label]");if(label)label.textContent=t==="dark"?"Oscuro":"Claro";return t};
export const toggleTheme=()=>{const next=document.documentElement.getAttribute("data-theme")==="dark"?"light":"dark";localStorage.setItem("tc_theme",next);applyTheme(next);return next};
export const initTheme=()=>applyTheme(localStorage.getItem("tc_theme")||"light");

export const initThemeToggle=()=>{if(document.documentElement.dataset.themeBound)return;document.documentElement.dataset.themeBound="1";document.addEventListener("click",e=>{if(e.target.closest("[data-theme-toggle]"))toggleTheme()})};

export const initRayito=()=>{if($("#rayito"))return;const b=document.createElement("button");b.id="rayito";b.type="button";b.textContent="⚡";b.style.cssText="position:fixed;right:14px;bottom:14px;z-index:80;width:52px;height:52px;border-radius:999px;border:1px solid rgba(255,255,255,.12);background:linear-gradient(135deg,#2dd4bf,#60a5fa);color:#041018;font-size:20px;font-weight:900;box-shadow:0 12px 30px rgba(0,0,0,.22);cursor:pointer";const p=document.createElement("div");p.id="rayito-panel";p.className="panel hidden";p.style.cssText="position:fixed;right:14px;bottom:74px;width:260px;z-index:79";p.innerHTML=`<div class="list"><button class="mini" type="button">Acción 1</button><button class="mini" type="button">Acción 2</button><button class="mini" type="button">Acción 3</button></div>`;document.body.appendChild(b);document.body.appendChild(p);b.addEventListener("click",()=>toggle("#rayito-panel"))};
export const setRayitoItems=items=>{const p=$("#rayito-panel");if(!p)return;const arr=(items||[]).filter(Boolean);p.innerHTML=`<div class="list">${arr.length?arr.map((x,i)=>`<button class="mini" type="button" data-rayito="${i}">${esc(x.label||`Acción ${i+1}`)}</button>`).join(""):`<div class="mut">Sin acciones</div>`}</div>`;p.querySelectorAll("[data-rayito]").forEach(b=>b.addEventListener("click",()=>{const fn=arr[+b.dataset.rayito]?.onClick;try{fn&&fn()}catch(err){console.error(err)}}))}

document.addEventListener("DOMContentLoaded",()=>{initTheme();initThemeToggle();setTimeout(()=>autoAppShell?.(),0)});
/* B19C: rutas reales del menú. "Clientes" abre el LISTADO (clientes.html, no
   cliente.html sin id); "Altas" ahora es la alta interna real (alta-cliente.html;
   altas.html no existe). Se añade Consolidación (consolidacion-clientes.html). */
const APP_MENU={
  soporte:[
    {key:"dashboard",label:"Dashboard",href:"dashboard.html",icon:"⌂"},
    {key:"tickets",label:"Tickets",href:"tickets.html",icon:"🎫"},
    {key:"clientes",label:"Clientes",href:"clientes.html",icon:"👥"},
    {key:"consolidacion",label:"Consolidación",href:"consolidacion-clientes.html",icon:"🔗"},
    {key:"altas",label:"Alta de cliente",href:"alta-cliente.html",icon:"＋"},
    {key:"recent_clients",label:"Últimos clientes",panel:"recent_clients",icon:"🕘"}
  ],
  admin:[
    {key:"dashboard",label:"Dashboard",href:"dashboard.html",icon:"⌂"},
    {key:"tickets",label:"Tickets",href:"tickets.html",icon:"🎫"},
    {key:"clientes",label:"Clientes",href:"clientes.html",icon:"👥"},
    {key:"consolidacion",label:"Consolidación",href:"consolidacion-clientes.html",icon:"🔗"},
    {key:"altas",label:"Alta de cliente",href:"alta-cliente.html",icon:"＋"},
    {key:"recent_clients",label:"Últimos clientes",panel:"recent_clients",icon:"🕘"},
    {key:"admin_tools",label:"Administración",href:"dashboard.html#admin",icon:"⚙️"}
  ]
};

const roleKey=r=>norm(r||"soporte")==="admin"?"admin":"soporte";
const pageTitleMap={dashboard:"Dashboard interno",tickets:"Tickets",ticket:"Ticket",clientes:"Clientes",cliente:"Cliente",consolidacion:"Consolidación de clientes","alta-cliente":"Alta interna de cliente"};
const breadcrumbHtml=page=>`<nav class="crumbs" aria-label="Ruta"><a href="dashboard.html">Panel</a><span>/</span><span>${esc(pageTitleMap[page]||page||"Vista")}</span></nav>`;


const navAttentionHtml=key=>`<span class="app-attention-dot" data-nav-attention="${esc(key)}" hidden aria-hidden="true"></span>`;
const navItemHtml=item=>item.children?`<div class="app-nav-dd"><button class="app-nav-link" type="button" data-nav-dd="${esc(item.key)}"><span>${item.icon||"•"}</span><b>${esc(item.label)}</b><i>⌄</i></button><div class="app-nav-menu">${item.children.map(x=>`<button type="button" data-open-panel="${esc(x.panel)}">${esc(x.label)}</button>`).join("")}</div></div>`:item.panel?`<button class="app-nav-link" type="button" data-open-panel="${esc(item.panel)}"><span>${item.icon||"•"}</span><b>${esc(item.label)}</b>${navAttentionHtml(item.key)}</button>`:`<a class="app-nav-link" href="${esc(item.href)}" data-nav="${esc(item.key)}"><span>${item.icon||"•"}</span><b>${esc(item.label)}</b>${navAttentionHtml(item.key)}</a>`;
const drawerItemHtml=item=>item.children?`<div class="app-drawer-group"><button class="app-drawer-item" type="button" data-drawer-group="${esc(item.key)}"><span>${item.icon||"•"}</span><b>${esc(item.label)}</b><i>›</i></button><div class="app-drawer-sub">${item.children.map(x=>`<button type="button" data-open-panel="${esc(x.panel)}">${esc(x.label)}</button>`).join("")}</div></div>`:item.panel?`<button class="app-drawer-item" type="button" data-open-panel="${esc(item.panel)}"><span>${item.icon||"•"}</span><b>${esc(item.label)}</b>${navAttentionHtml(item.key)}</button>`:`<a class="app-drawer-item" href="${esc(item.href)}" data-nav="${esc(item.key)}"><span>${item.icon||"•"}</span><b>${esc(item.label)}</b>${navAttentionHtml(item.key)}</a>`;
const headerMoreItemHtml=item=>item.children?item.children.map(x=>`<button type="button" data-open-panel="${esc(x.panel)}">${esc(x.label)}</button>`).join(""):item.panel?`<button type="button" data-open-panel="${esc(item.panel)}">${esc(item.label)}</button>`:`<a href="${esc(item.href)}" data-nav="${esc(item.key)}">${esc(item.label)}</a>`;
const moreItemHtml=item=>item.children?item.children.map(x=>`<button type="button" data-open-panel="${esc(x.panel)}">${esc(x.label)}</button>`).join(""):item.panel?`<button type="button" data-open-panel="${esc(item.panel)}">${esc(item.label)}</button>`:`<a href="${esc(item.href)}" data-nav="${esc(item.key)}">${esc(item.label)}</a>`;
const historyIcon=direction=>direction==="back"
  ?'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>'
  :'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
const appBrandHtml=()=>`<a class="app-brand" href="dashboard.html" aria-label="Inicio Janome"><img src="../IMG/janome.jpg" alt=""><strong>JANOME</strong></a>`;
const appHeaderHtml=(role,page,{title=""}={})=>{
  const items=APP_MENU[role]||APP_MENU.soporte;
  const ttl=title||pageTitleMap[page]||"Panel interno";
  const primaryKeys=new Set(["dashboard","tickets","clientes","consolidacion","admin_tools"]);
  const main=items.filter(x=>primaryKeys.has(x.key));
  const more=items.filter(x=>!primaryKeys.has(x.key));
  return`<header class="app-header" id="appHeader"><div class="app-head-inner"><div class="app-head-start"><div class="app-history" aria-label="Historial"><button class="app-history-btn" type="button" data-history="back" aria-label="Atrás" disabled>${historyIcon("back")}</button><button class="app-history-btn" type="button" data-history="forward" aria-label="Adelante" disabled>${historyIcon("forward")}</button></div>${appBrandHtml()}</div><nav class="app-nav" aria-label="Principal">${main.map(navItemHtml).join("")}${more.length?`<div class="app-nav-dd app-more"><button class="app-nav-link" type="button" data-more-toggle aria-expanded="false" aria-controls="appMoreMenu"><b>Más</b><i aria-hidden="true">⌄</i></button><div class="app-nav-menu app-nav-menu-right" id="appMoreMenu">${more.map(moreItemHtml).join("")}</div></div>`:""}</nav><div class="app-head-tools"><div class="global-search app-search"><span class="app-search-icon" aria-hidden="true">⌕</span><input class="input" id="globalSearchInput" placeholder="Busca por empresa, cliente, folio o caso" autocomplete="off" aria-label="Búsqueda global" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="globalSearchSuggest"><button class="app-search-clear" id="globalSearchClear" type="button" aria-label="Limpiar búsqueda" hidden>×</button><div class="suggest-panel hidden" id="globalSearchSuggest" role="listbox" hidden></div></div><button class="app-head-btn app-theme-btn" data-theme-toggle type="button" aria-label="Tema">🌓</button><button class="app-head-btn app-logout-btn" data-app-logout type="button" aria-label="Salir">Salir</button><button class="app-burger" id="appBurger" type="button" aria-label="Abrir menú" aria-expanded="false">≡</button></div></div></header><div class="app-mobile-title"><h1>${esc(ttl)}</h1></div><div class="app-dim" id="appDim" hidden></div><aside class="app-drawer" id="appDrawer" aria-hidden="true" hidden><div class="app-drawer-head">${appBrandHtml()}<button class="app-drawer-close" id="appDrawerClose" type="button" aria-label="Cerrar">×</button></div><div class="app-drawer-body">${items.map(drawerItemHtml).join("")}<button class="app-drawer-item app-drawer-logout" data-app-logout type="button"><span>↪</span><b>Salir</b></button></div></aside>`;
};
const panelHtml=()=>`<div class="app-panel-backdrop" id="appPanelBackdrop"></div><aside class="app-panel app-panel-left" id="appPanel" aria-hidden="true"><div class="app-panel-head"><div><div class="app-panel-title" id="appPanelTitle">Panel</div><div class="app-panel-sub" id="appPanelSub">Vista interna</div></div><button class="close-x" id="appPanelClose" type="button" aria-label="Cerrar panel">×</button></div><div class="app-panel-body" id="appPanelBody"></div></aside>`;

const openAppDrawer=()=>{const d=$("#appDrawer"),m=$("#appDim"),b=$("#appBurger");if(!d)return;d.hidden=false;d.inert=false;m&&(m.hidden=false);requestAnimationFrame(()=>{document.documentElement.classList.add("app-drawer-open");d.setAttribute("aria-hidden","false");b?.setAttribute("aria-expanded","true");$("#appDrawerClose")?.focus()})};
const closeAppDrawer=()=>{const d=$("#appDrawer"),m=$("#appDim"),b=$("#appBurger");document.documentElement.classList.remove("app-drawer-open");if(d){blurInside(d);d.inert=true;d.setAttribute("aria-hidden","true")}b?.setAttribute("aria-expanded","false");setTimeout(()=>{if(!document.documentElement.classList.contains("app-drawer-open")){d&&(d.hidden=true);m&&(m.hidden=true)}},180)};

const performAppLogout=async()=>{const root=document.documentElement;if(root.dataset.logoutPending==="1")return;root.dataset.logoutPending="1";document.querySelectorAll("[data-app-logout]").forEach(b=>b.disabled=true);try{const{logout}=await import("./supabase.js");await logout("index.html")}catch(err){delete root.dataset.logoutPending;document.querySelectorAll("[data-app-logout]").forEach(b=>b.disabled=false);toast("No se pudo cerrar la sesión.","bad");console.error("APP_LOGOUT_ERROR",err?.message||"logout_failed")}};
const appPathRoot=()=>{const p=location.pathname,i=p.lastIndexOf("/app/");return i>=0?p.slice(0,i+5):p.slice(0,p.lastIndexOf("/")+1)};
const isSafeHistoryUrl=value=>{try{const u=new URL(value,location.href);return u.origin===location.origin&&u.pathname.startsWith(appPathRoot())}catch{return false}};
const historyEntry=delta=>{try{if(!globalThis.navigation?.entries)return null;const entries=navigation.entries(),idx=entries.findIndex(x=>x.key===navigation.currentEntry?.key);return idx>=0?entries[idx+delta]||null:null}catch{return null}};
const updateHistoryButtons=()=>{
  const back=$("[data-history=back]"),forward=$("[data-history=forward]");
  const navBack=historyEntry(-1),navForward=historyEntry(1);
  if(back)back.disabled=globalThis.navigation?.entries?!isSafeHistoryUrl(navBack?.url):!isSafeHistoryUrl(document.referrer);
  if(forward)forward.disabled=!isSafeHistoryUrl(navForward?.url);
};
const navigateHistory=delta=>{
  const entry=historyEntry(delta);
  if(entry&&isSafeHistoryUrl(entry.url))return navigation.traverseTo(entry.key);
  if(delta<0&&isSafeHistoryUrl(document.referrer))history.back();
};
const closeMoreMenu=()=>{const wrap=$(".app-more"),btn=$("[data-more-toggle]");wrap?.classList.remove("is-open");btn?.setAttribute("aria-expanded","false")};
const NAV_ATTENTION_KEY="ticketCore.navAttention",NAV_ATTENTION_SECTIONS=new Set(["dashboard","tickets","clientes","consolidacion","admin_tools"]);
const navAttentionRead=()=>{try{return JSON.parse(localStorage.getItem(NAV_ATTENTION_KEY)||"{}")||{}}catch{return{}}};
const navAttentionWrite=value=>{try{localStorage.setItem(NAV_ATTENTION_KEY,JSON.stringify(value||{}))}catch{}};
const renderNavAttention=()=>{const state=navAttentionRead();document.querySelectorAll("[data-nav-attention]").forEach(dot=>{const key=dot.dataset.navAttention,item=state[key],on=!!item?.hasAttention;dot.hidden=!on;dot.setAttribute("aria-hidden",String(!on));const host=dot.closest("a,button");if(host){if(on)host.setAttribute("aria-label",`${host.textContent.trim()} · actividad pendiente: ${item.reason||"revisar sección"}`);else host.removeAttribute("aria-label")}})};
export const setNavAttention=(section,{hasAttention=false,reason="",latestEventId="",updatedAt=new Date().toISOString()}={})=>{if(!NAV_ATTENTION_SECTIONS.has(section))return;const state=navAttentionRead(),prev=state[section]||{};state[section]={hasAttention:!!hasAttention,reason:String(reason||"").slice(0,80),latestEventId:String(latestEventId||"").slice(0,120),updatedAt,seenAt:hasAttention?prev.seenAt||null:new Date().toISOString()};navAttentionWrite(state);renderNavAttention()};
const markNavVisited=page=>{const section=page==="ticket"?"tickets":page;if(!NAV_ATTENTION_SECTIONS.has(section))return;const state=navAttentionRead(),item=state[section];if(!item?.hasAttention)return;state[section]={...item,hasAttention:false,seenAt:new Date().toISOString()};navAttentionWrite(state)};
const initAppHeader=(page)=>{
  if(!document.documentElement.dataset.appHeaderBound){
    document.documentElement.dataset.appHeaderBound="1";
    document.addEventListener("click",e=>{
      const historyBtn=e.target.closest("[data-history]");
      if(historyBtn){e.preventDefault();if(!historyBtn.disabled)navigateHistory(historyBtn.dataset.history==="back"?-1:1);return}
      const more=e.target.closest("[data-more-toggle]");
      if(more){e.preventDefault();const open=!more.closest(".app-more")?.classList.contains("is-open");closeMoreMenu();more.closest(".app-more")?.classList.toggle("is-open",open);more.setAttribute("aria-expanded",String(open));return}
      if(e.target.closest(".app-more .app-nav-menu a,.app-more .app-nav-menu button"))closeMoreMenu();
      else if(!e.target.closest(".app-more"))closeMoreMenu();
      if(e.target.closest("[data-app-logout]")){e.preventDefault();return performAppLogout()}
      if(e.target.closest("#appBurger"))return openAppDrawer();
      if(e.target.closest("#appDrawerClose")||e.target.closest("#appDim"))return closeAppDrawer();
      const g=e.target.closest("[data-drawer-group]");
      if(g)return g.closest(".app-drawer-group")?.classList.toggle("open");
      if(e.target.closest(".app-drawer a,.app-drawer [data-open-panel]"))closeAppDrawer();
    });
    document.addEventListener("keydown",e=>{if(e.key==="Escape"){closeMoreMenu();closeAppDrawer()}});
    globalThis.navigation?.addEventListener?.("navigatesuccess",updateHistoryButtons);
  }
  updateHistoryButtons();
  document.querySelectorAll("[data-nav]").forEach(x=>x.classList.remove("is-active"));
  if(page)document.querySelectorAll(`[data-nav="${page}"]`).forEach(x=>x.classList.add("is-active"));
  markNavVisited(page);
  renderNavAttention();
};
export const ensureAppShell=({page,title="",kicker="",actionsHtml="",role="soporte"}={})=>{const shell=$("#appShell");if(!shell)return;const rk=roleKey(role),mountedHeader=shell.querySelector("#appHeader"),mountedPanel=shell.querySelector("#appPanel"),roleChanged=shell.dataset.appRole&&shell.dataset.appRole!==rk;if(mountedHeader&&mountedPanel&&!roleChanged){setAppRole(rk);bindGlobalSearch();initAppHeader(page);return}shell.dataset.appRole=rk;shell.innerHTML=`${appHeaderHtml(rk,page,{title,kicker,actionsHtml})}${panelHtml()}`;initAppHeader(page);initAppPanel();setAppRole(rk);bindGlobalSearch();setRailOpenCount()};
export const autoAppShell=()=>{const b=document.body;if(!b||b.dataset.shell!=="app"||!$("#appShell")||$("#appHeader"))return;const page=b.dataset.page||"dashboard";ensureAppShell({page,title:pageTitleMap[page]||page||"Panel",role:b.dataset.role||"soporte"})};


const APP_PANEL_MAP={
  admin_tools:{title:"Admin",sub:"Herramientas",html:`<div class="panel-card"><div class="panel-kv"><div class="panel-k">Admin</div><div class="panel-v">Vista reservada para herramientas administrativas.</div></div></div>`},
  recent_clients:{title:"Clientes recientes",sub:"Últimos clientes vistos",html:`<div class="panel-card"><div class="panel-kv"><div class="panel-k">Clientes recientes</div><div class="panel-v" id="recentClientsBody">Aún no hay clientes recientes.</div></div></div>`},
  shortcuts:{title:"Atajos de teclado",sub:"Accesos rápidos globales",html:`<div class="panel-card"><div class="panel-kv"><div class="panel-k">Atajos</div><div class="panel-v">/ → Buscar<br>i d → Ir a inicio<br>i t → Ir a tickets<br>n t → Nuevo ticket<br>esc → Cerrar panel o modal<br>? → Ver esta ayuda</div></div></div>`}
};
export const pushRecentClient=client=>{try{if(!client?.id||!client?.nombre)return;const key="tc_recent_clients",cur=JSON.parse(localStorage.getItem(key)||"[]"),next=[{id:String(client.id),nombre:String(client.nombre)} ,...cur.filter(x=>String(x.id)!==String(client.id))].slice(0,8);localStorage.setItem(key,JSON.stringify(next))}catch{}};
export const readRecentClients=()=>{try{return JSON.parse(localStorage.getItem("tc_recent_clients")||"[]")}catch{return[]}};
export const setRailOpenCount=()=>{try{Object.keys(sessionStorage).filter(k=>k.startsWith("tc_canonical_ticket_count_")).forEach(k=>sessionStorage.removeItem(k))}catch{};$$("#railOpenCount,#railOpenCountMob").forEach(el=>el.remove())};
export const setBreadcrumb=(items=[])=>{const el=$(".crumbs");if(!el||!items.length)return;el.innerHTML=items.map((x,i)=>x.href?`<a href="${esc(x.href)}">${esc(x.label)}</a>`:`<span>${esc(x.label)}</span>`).join("<span>/</span>")};
export const openAppPanel=({title="Panel",sub="Vista interna",html=""}={})=>{const p=$("#appPanel"),b=$("#appPanelBackdrop");if(!p)return;$("#appPanelTitle")&&($("#appPanelTitle").textContent=title);$("#appPanelSub")&&($("#appPanelSub").textContent=sub);$("#appPanelBody")&&($("#appPanelBody").innerHTML=html);p.setAttribute("aria-hidden","false");p.classList.add("open");if(window.innerWidth<=980)b?.classList.add("open");else b?.classList.remove("open")};
export const closeAppPanel=()=>{const p=$("#appPanel");p?.classList.remove("open");p?.setAttribute("aria-hidden","true");$("#appPanelBackdrop")?.classList.remove("open")};
export const initAppPanel=()=>{if(document.documentElement.dataset.appPanelBound)return;document.documentElement.dataset.appPanelBound="1";document.addEventListener("click",e=>{if(e.target.closest("#appPanelClose")||e.target.closest("#appPanelBackdrop"))return closeAppPanel();const op=e.target.closest("[data-open-panel]");if(!op)return;const key=op.dataset.openPanel;if(key==="recent_clients"){const items=readRecentClients(),html=items.length?`<div class="panel-card"><div class="panel-kv"><div class="panel-k">Últimos clientes vistos</div><div class="panel-v">${items.map(x=>`<button class="btn" type="button" data-recent-client="${esc(x.id)}" data-recent-name="${esc(x.nombre)}">${esc(x.nombre)}</button>`).join(" ")}</div></div></div>`:`<div class="panel-card"><div class="panel-kv"><div class="panel-k">Últimos clientes vistos</div><div class="panel-v">Aún no hay clientes recientes.</div></div></div>`;return openAppPanel({title:"Clientes recientes",sub:"Últimos clientes vistos",html})}const cfg=APP_PANEL_MAP[key];if(cfg)return openAppPanel(cfg)});document.addEventListener("keydown",e=>{const tag=(document.activeElement?.tagName||"").toLowerCase(),typing=["input","textarea","select"].includes(tag)||document.activeElement?.isContentEditable,k=(e.key||"").toLowerCase();if((e.metaKey||e.ctrlKey)&&e.shiftKey&&k==="a"){e.preventDefault();return openAppPanel(APP_PANEL_MAP.shortcuts)}if((e.metaKey||e.ctrlKey)&&k==="b"){e.preventDefault();return document.querySelector("#globalSearchInput,#searchInput,#tkSearch")?.focus()}if(e.key==="Escape")return closeAppPanel();if(typing&&e.key!=="/")return;if(e.key==="?"){e.preventDefault();return openAppPanel(APP_PANEL_MAP.shortcuts)}if(e.key==="/"){e.preventDefault();return document.querySelector("#globalSearchInput,#searchInput,#tkSearch")?.focus()}if(k==="i"){window.__exp_next_key="pending_i";clearTimeout(window.__exp_next_key_timer);window.__exp_next_key_timer=setTimeout(()=>window.__exp_next_key="",700);return}if(k==="n"){window.__exp_next_key="pending_n";clearTimeout(window.__exp_next_key_timer);window.__exp_next_key_timer=setTimeout(()=>window.__exp_next_key="",700);return}if(k==="d"&&window.__exp_next_key==="pending_i"){window.__exp_next_key="";return location.href="dashboard.html"}if(k==="t"&&window.__exp_next_key==="pending_i"){window.__exp_next_key="";return location.href="tickets.html"}if(k==="t"&&window.__exp_next_key==="pending_n"){window.__exp_next_key="";return document.querySelector("#heroNewTicketBtn,#newTicketTopBtn,#tkNewBtn")?.click()}});document.addEventListener("click",e=>{const b=e.target.closest("[data-recent-client]");if(!b)return;location.href=`cliente.html?id=${b.dataset.recentClient}`})};
export const setAppRole=role=>{const r=norm(role||"soporte"),isSupport=["soporte","support"].includes(r),isSales=["ventas","venta","sales"].includes(r),isAdmin=r==="admin";document.querySelectorAll("[data-role-only]").forEach(el=>{const need=(el.getAttribute("data-role-only")||"").split(/\s+/).filter(Boolean),ok=need.includes("admin")&&isAdmin||need.includes("soporte")&&isSupport||need.includes("ventas")&&isSales||need.includes("support")&&isSupport;el.hidden=!ok})};
export const initAppRail=page=>{const rail=$("#appRail"),scrim=$("#appScrim"),toggle=$("#railToggle");if(!rail)return;const mobile=()=>window.matchMedia("(max-width: 980px)").matches;if(!rail.dataset.bound){rail.dataset.bound="1";toggle?.addEventListener("click",()=>{rail.classList.toggle("open");scrim?.classList.toggle("open",rail.classList.contains("open"))});scrim?.addEventListener("click",()=>{rail.classList.remove("open");scrim.classList.remove("open")});rail.querySelectorAll("[data-rail-parent]").forEach(b=>{b.addEventListener("click",e=>{if(!mobile())return;e.preventDefault();b.closest(".rail-group")?.classList.toggle("open")})})}rail.querySelectorAll("[data-nav]").forEach(x=>x.classList.remove("is-active"));if(page)rail.querySelector(`[data-nav="${page}"]`)?.classList.add("is-active")};

const GLOBAL_PAGES=[
  {type:"pagina",id:"dashboard",label:"Dashboard",href:"dashboard.html",sub:"Vista general"},
  {type:"pagina",id:"tickets",label:"Tickets",href:"tickets.html",sub:"Mesa operativa"},
  {type:"pagina",id:"clientes",label:"Clientes",href:"clientes.html",sub:"Listado de clientes"},
  {type:"pagina",id:"consolidacion",label:"Consolidación",href:"consolidacion-clientes.html",sub:"Cola de consolidación"},
  {type:"pagina",id:"alta-cliente",label:"Alta de cliente",href:"alta-cliente.html",sub:"Alta interna"}
];
let __globalSearchBound=0,__globalSearchData={clientes:[],tickets:[],extras:[]},__globalSearchTimer=0,__globalSearchIndex=-1;
export const setGlobalSearchData=({clientes=[],tickets=[],extras=[]}={})=>{__globalSearchData={clientes,tickets,extras:[...GLOBAL_PAGES,...extras]};if(document.activeElement?.id==="globalSearchInput")renderGlobalSuggest()};
const globalSuggestRows=q=>{const x=norm(q),tickets=__globalSearchData.tickets||[],exactFolio=tickets.some(t=>norm(t?.folio||"")===x);if(!x||x.length<2&&!exactFolio)return[];const out=[];( __globalSearchData.extras||[]).forEach(p=>{if(norm(`${p.label} ${p.sub||""} ${p.id||""}`).includes(x))out.push({k:`p_${p.id}`,type:"pagina",group:"Secciones",label:p.label,sub:p.sub||"",href:p.href})});(__globalSearchData.clientes||[]).forEach(c=>{if(norm(`${c.nombre||""} ${c.alias||""} ${c.correo||""} ${c.telefono||""} ${c.contacto||""}`).includes(x))out.push({k:`c_${c.id}`,type:"cliente",group:"Clientes",label:c.nombre||"Sin nombre",sub:c.alias||c.correo||"Cliente",href:`cliente.html?id=${encodeURIComponent(c.id)}`})});tickets.forEach(t=>{const blob=norm(`${t.folio||""} ${t.titulo||""} ${t.descripcion||""} ${t.tipo||""} ${t.estado||""} ${t.prioridad||""} ${t.empresa_capturada||""} ${t.nombre_capturado||""} ${t.nombre_cliente_contacto||""} ${t.clientes?.nombre||""} ${t.sistema||""} ${t.sistema_detectado||""} ${t.producto_modelo||""}`);if(blob.includes(x))out.push({k:`t_${t.id}`,type:"ticket",group:"Tickets",label:t.folio?`${t.folio} · ${t.titulo||"Ticket"}`:t.titulo||`Ticket ${t.id}`,sub:`${t.empresa_capturada||t.clientes?.nombre||t.nombre_capturado||"Sin cliente"} · ${t.estado||"abierto"}`,href:`ticket.html?id=${encodeURIComponent(t.id)}`})});return[...new Map(out.map(row=>[row.k,row])).values()].slice(0,12)};
const closeGlobalSuggest=()=>{const box=$("#globalSearchSuggest"),input=$("#globalSearchInput");box?.classList.add("hidden");box?.setAttribute("hidden","hidden");input?.setAttribute("aria-expanded","false");input?.removeAttribute("aria-activedescendant");__globalSearchIndex=-1};
const globalSearchState=text=>{const box=$("#globalSearchSuggest"),input=$("#globalSearchInput");if(!box||!input)return;box.innerHTML=`<div class="app-search-state">${esc(text)}</div>`;box.classList.remove("hidden");box.removeAttribute("hidden");input.setAttribute("aria-expanded","true")};
const renderGlobalSuggest=()=>{const box=$("#globalSearchSuggest"),input=$("#globalSearchInput"),clear=$("#globalSearchClear"),q=input?.value||"",x=norm(q),items=globalSuggestRows(q);if(!box||!input)return;if(clear)clear.hidden=!q;if(!q)return closeGlobalSuggest();if(x.length<2&&!items.length)return globalSearchState("Escribe al menos 2 caracteres.");const groups=["Tickets","Clientes","Secciones"],html=groups.map(group=>{const rows=items.filter(x=>x.group===group);return rows.length?`<section class="app-search-group"><div class="app-search-group-title">${group}</div>${rows.map((row,i)=>{const idx=items.indexOf(row),id=`globalSearchOption${idx}`;return`<a id="${id}" class="item suggest-item" role="option" aria-selected="false" data-search-index="${idx}" href="${esc(row.href)}"><div class="item-title">${esc(row.label)}</div><div class="item-meta">${esc(row.sub||"")}</div></a>`}).join("")}</section>`:""}).join("");box.innerHTML=html||'<div class="app-search-state">Sin resultados.</div>';box.classList.remove("hidden");box.removeAttribute("hidden");input.setAttribute("aria-expanded","true");__globalSearchIndex=-1};
const setGlobalSearchIndex=index=>{const rows=[...document.querySelectorAll("#globalSearchSuggest [data-search-index]")],input=$("#globalSearchInput");if(!rows.length)return;__globalSearchIndex=(index+rows.length)%rows.length;rows.forEach((row,i)=>{const on=i===__globalSearchIndex;row.classList.toggle("is-active",on);row.setAttribute("aria-selected",String(on))});const active=rows[__globalSearchIndex];input?.setAttribute("aria-activedescendant",active.id);active.scrollIntoView({block:"nearest"})};
export const bindGlobalSearch=()=>{if(__globalSearchBound)return;__globalSearchBound=1;document.addEventListener("input",e=>{if(e.target?.id!=="globalSearchInput")return;clearTimeout(__globalSearchTimer);const q=e.target.value||"";$("#globalSearchClear")&&($("#globalSearchClear").hidden=!q);if(!q)return closeGlobalSuggest();globalSearchState("Buscando…");__globalSearchTimer=setTimeout(renderGlobalSuggest,300)});document.addEventListener("focusin",e=>{if(e.target?.id==="globalSearchInput"&&e.target.value)renderGlobalSuggest()});document.addEventListener("keydown",e=>{if(e.target?.id!=="globalSearchInput")return;if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault();setGlobalSearchIndex(__globalSearchIndex+(e.key==="ArrowDown"?1:-1));return}if(e.key==="Enter"&&__globalSearchIndex>=0){e.preventDefault();document.querySelector(`#globalSearchSuggest [data-search-index="${__globalSearchIndex}"]`)?.click();return}if(e.key==="Escape"){e.preventDefault();e.target.value="";$("#globalSearchClear")&&($("#globalSearchClear").hidden=true);closeGlobalSuggest()}});document.addEventListener("click",e=>{if(e.target.closest("#globalSearchClear")){const input=$("#globalSearchInput");if(input)input.value="";$("#globalSearchClear").hidden=true;closeGlobalSuggest();input?.focus();return}if(!e.target.closest(".global-search"))closeGlobalSuggest()})};

export const fmtDT=v=>v?new Date(v).toLocaleString("es-MX"):"—";
export const daysSince=v=>v?Math.floor((Date.now()-new Date(v).getTime())/864e5):999;
export const prettyBytes=n=>{const x=Number(n||0);return x>=1048576?`${(x/1048576).toFixed(1)} MB`:x>=1024?`${Math.max(1,Math.round(x/1024))} KB`:`${x} B`};
export const ticketStateKey=v=>{const x=norm(v);if(["abierto","nuevo"].includes(x))return"abierto";if(["en_proceso","en proceso","proceso"].includes(x))return"en_proceso";if(["esperando_cliente","esperando cliente","espera"].includes(x))return"esperando_cliente";if(["resuelto"].includes(x))return"resuelto";if(["cerrado","closed","done","cancelado"].includes(x))return"cerrado";return"abierto"};
export const ticketStateLabel=v=>ticketStateKey(v)==="en_proceso"?"En proceso":ticketStateKey(v)==="esperando_cliente"?"Esperando cliente":ticketStateKey(v)==="resuelto"?"Resuelto":ticketStateKey(v)==="cerrado"?"Cerrado":"Abierto";
export const ticketStateCls=v=>{const x=ticketStateKey(v);return x==="resuelto"||x==="cerrado"?"ok":x==="esperando_cliente"?"warn":x==="en_proceso"?"info":"neutral"};
export const ticketPriorityCls=v=>{const x=norm(v);return x==="urgente"?"bad":x==="alta"?"warn":x==="media"?"info":"ok"};


export const telHref=v=>{const d=String(v||"").replace(/\D+/g,"");return d?`tel:${d}`:"#"};
export const mailHref=v=>String(v||"").trim()?`mailto:${String(v).trim()}`:"#";
export const ago=v=>{if(!v)return"—";const ms=new Date(v).getTime();if(!Number.isFinite(ms))return"Fecha no disponible";const s=Math.floor((Date.now()-ms)/1000);if(s<0)return s>=-60?"ahora":new Date(ms).toLocaleString("es-MX");if(s<60)return"ahora";if(s<3600)return`hace ${Math.floor(s/60)}m`;if(s<86400)return`hace ${Math.floor(s/3600)}h`;return`hace ${Math.floor(s/86400)}d`};
