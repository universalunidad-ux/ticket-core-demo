import { supabase as s } from "./supabase.js";
import { openDialog, closeDialog } from "./global.js?v=frontend-final-20260716-01";
import { isAdminRole, scopeLabel, TICKET_SCOPES } from "./shared/ticket-scope.js?v=frontend-final-20260716-01";

const esc = v => String(v ?? "").replace(/[&<>"']/g, m => ({
  "&":"&amp;",
  "<":"&lt;",
  ">":"&gt;",
  '"':"&quot;",
  "'":"&#39;"
}[m]));

const $ = (q, ctx=document) => ctx.querySelector(q);
const $$ = (q, ctx=document) => [...ctx.querySelectorAll(q)];
const isUuid = v => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ""));

let AGENTS = [];
let CURRENT_USER_ID = "";
let IS_ADMIN = false;
let BUSY = false;
let OBS = null;

/* TC-U15A-1: el alcance vive en la URL (única fuente de verdad), resuelto por tickets.js.
   Aquí sólo lo leemos para reflejar selección visible + aria-pressed. */
const currentScope = () => {
  if (typeof window.__tkScope === "function") return window.__tkScope();
  const v = new URLSearchParams(location.search).get("scope");
  return TICKET_SCOPES.includes(v) ? v : "all";
};

function agentLabel(a){
  return a?.nombre || a?.correo || a?.auth_email || (a?.id ? String(a.id).slice(0,8) : "Agente");
}

function initialsFromName(name){
  const clean = String(name || "").trim();
  if(!clean) return "S/A";
  const parts = clean.split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] || "";
  const b = parts.length > 1 ? parts[parts.length - 1]?.[0] : "";
  return (a + b).toUpperCase() || "S/A";
}

function assignedLabel(id){
  if(!id) return "Sin asignar";
  const a = AGENTS.find(x => String(x.id) === String(id));
  return a ? agentLabel(a) : "Asignado";
}

/* Color estable por persona: hash determinístico de agent.id (o nombre) → matiz 0-359.
   No guarda datos, no usa librerías; se aplica inline al badge. */
function agentHue(seed){
  const str = String(seed || "");
  let h = 0;
  for(let i = 0; i < str.length; i++){ h = (h * 31 + str.charCodeAt(i)) % 360; }
  return h;
}

function ticketRows(){
  return Array.isArray(window.TK) ? window.TK : [];
}

function cardId(card){
  return card?.dataset?.id || card?.getAttribute("data-id") || "";
}

function ticketById(id){
  return ticketRows().find(t => String(t.id) === String(id));
}

function toast(text){
  if(window.toast) return window.toast(text, "ok");
  console.log(text);
}

function mountStyles(){
  if(document.getElementById("tcTicketsAssignStyles")) return;
  const st = document.createElement("style");
  st.id = "tcTicketsAssignStyles";
  st.textContent = `
/* Badge de asignación en la card (integrado al row de acciones) */
.tcAssignBadge{
  display:inline-flex;align-items:center;justify-content:center;
  min-width:36px;height:34px;padding:0 9px;border-radius:12px;
  border:1px solid var(--line);background:color-mix(in srgb,var(--panel) 94%,transparent);
  color:var(--muted);font-size:11px;font-weight:900;line-height:1;cursor:pointer;
  transition:transform .16s ease,border-color .16s ease;flex:0 0 auto;
}
.tcAssignBadge:hover{transform:translateY(-1px)}
.tcAssignBadge.is-free{color:#92400e;background:color-mix(in srgb,#f59e0b 10%,var(--panel))}
.tcAssignBadge.is-mine{box-shadow:0 0 0 2px color-mix(in srgb,var(--brand) 30%,transparent) inset}
/* Que el rayo siga al extremo derecho y el badge quede separado */
.k-card-actions .tcAssignBadge{margin-left:auto}
.k-card-actions .k-action-bolt{margin-left:8px!important}

/* Icono de vista de tickets en el header */
#tcAssignViewBtn{
  width:42px;min-width:42px;height:42px;min-height:42px;padding:0;border-radius:14px;
  display:grid;place-items:center;border:1px solid var(--line);background:var(--panel-2);
  color:var(--text);cursor:pointer;flex:0 0 auto;
}
#tcAssignViewBtn.is-filtered{border-color:color-mix(in srgb,var(--brand) 45%,var(--line));background:color-mix(in srgb,var(--brand) 12%,var(--panel))}
#tcAssignViewBtn svg{width:20px;height:20px;display:block}

/* Modales (reutilizan .overlay/.modal globales; aquí solo el tamaño y detalle) */
.tcAssignModal,.tcViewModal{width:min(420px,100%);max-height:86vh;display:grid;gap:14px}
.tcAssignModal__head,.tcViewModal__head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.tcAssignModal__kicker,.tcViewModal__kicker{font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.tcAssignModal h3,.tcViewModal h3{font-size:18px;font-weight:900;margin:2px 0 0}
.tcAssignModal__x,.tcViewModal__x{border:1px solid var(--line);background:var(--panel-2);color:var(--text);width:40px;height:40px;border-radius:12px;cursor:pointer;font-size:18px;line-height:1;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto}
.tcAssignModal__lbl{font-size:12px;font-weight:800;color:var(--muted)}
.tcAssignModal select{width:100%;min-height:46px;border:1px solid var(--line);border-radius:14px;background:var(--panel);color:var(--text);padding:8px 12px;font-weight:800}
.tcAssignModal__actions{display:flex;justify-content:flex-end;gap:10px}
.tcAssignBtn{min-height:42px;padding:9px 16px;border-radius:13px;border:1px solid var(--line);background:var(--panel-2);color:var(--text);font-weight:850;cursor:pointer}
.tcAssignBtn--brand{background:linear-gradient(135deg,var(--brand),var(--brand-2));color:var(--brand-ink);border:0}
.tcViewPills{display:grid;gap:10px}
.tcViewPills button{min-height:46px;border:1px solid var(--line);border-radius:14px;background:var(--panel);color:var(--text);font-weight:850;cursor:pointer;text-align:left;padding:0 14px}
.tcViewPills button.is-active{border-color:color-mix(in srgb,var(--brand) 45%,var(--line));background:color-mix(in srgb,var(--brand) 12%,var(--panel))}

/* B.1: overlay propio MÁS CLARO (no toca el global .overlay de otros modales) */
#tcAssignOverlay,#tcViewOverlay{background:rgba(15,23,42,.30)!important;backdrop-filter:blur(7px)!important;-webkit-backdrop-filter:blur(7px)!important;padding:18px!important}
html[data-theme=dark] #tcAssignOverlay,html[data-theme=dark] #tcViewOverlay{background:rgba(2,6,23,.42)!important}
.tcAssignModal,.tcViewModal{border-radius:26px!important;box-shadow:0 30px 80px rgba(15,23,42,.22)!important;border:1px solid var(--line)!important;padding:20px!important}

/* B.1: separación badge ↔ rayo en kanban y compacto (el rayo manda al extremo derecho) */
.k-card-actions .tcAssignBadge,.compact-actions .tcAssignBadge{margin-left:auto}
.k-card-actions .k-action-bolt,.compact-actions .k-action-bolt{margin-left:10px!important}

/* Mobile: badge no crece la card; header con hueco para el icono de vista */
@media(max-width:720px){
  .tcAssignBadge{min-width:32px;height:30px;padding:0 8px;font-size:10px}
  body[data-page="tickets"] .tickets-hero{grid-template-columns:minmax(0,1fr) 34px 34px 34px 34px!important;grid-template-areas:"search view filter gear new"!important}
  body[data-page="tickets"] #tcAssignViewBtn{grid-area:view!important;width:34px!important;min-width:34px!important;height:34px!important;border-radius:12px!important}
  body[data-page="tickets"] #tcAssignViewBtn svg{width:18px;height:18px}
  /* B.1: más separación badge↔rayo en móvil */
  body[data-page="tickets"] .k-card-actions .k-action-bolt,body[data-page="tickets"] .compact-actions .k-action-bolt{margin-left:14px!important}
  /* B.1: search móvil más compacto (menos aire lupa↔texto) */
  body[data-page="tickets"] .tk-search-compact>span{left:8px!important;width:16px!important}
  body[data-page="tickets"] .tk-search-compact input{padding-left:26px!important}
}
  `;
  document.head.appendChild(st);
}

async function loadAgents(){
  const user = await s.auth.getUser().catch(() => ({ data:{ user:null } }));
  CURRENT_USER_ID = user?.data?.user?.id || "";

  const { data: me, error: meError } = await s
    .from("perfiles")
    .select("id,rol")
    .eq("id", CURRENT_USER_ID)
    .maybeSingle();
  IS_ADMIN = !meError && isAdminRole(me?.rol);
  document.body.dataset.accessRole = IS_ADMIN ? "admin" : "soporte";
  if(!IS_ADMIN){
    AGENTS = [];
    return;
  }

  const { data, error } = await s
    .from("perfiles")
    .select("*")
    .in("rol", ["admin", "soporte"])
    .order("nombre", { ascending:true });

  if(error){
    console.warn("ASSIGN_BOARD_AGENTS_ERROR", error);
    AGENTS = [];
    return;
  }

  AGENTS = Array.isArray(data) ? data : [];
}

/* ---- Icono de vista (filtros Todos/Mis/Sin asignar) en el header ---- */
const VIEW_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="16" rx="1"/><rect x="17" y="4" width="4" height="16" rx="1"/></svg>`;

function mountViewButton(){
  if($("#tcAssignViewBtn")) return;
  const host = $(".hero-actions");
  if(!host) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "tcAssignViewBtn";
  btn.setAttribute("aria-label", "Vista de tickets");
  btn.setAttribute("title", "Vista: todos / mis tickets / sin asignar");
  btn.innerHTML = VIEW_ICON;
  // B.1: listener DIRECTO (pointerdown), no document-capture → sin carrera.
  btn.addEventListener("pointerdown", e => { e.preventDefault(); e.stopPropagation(); openView(btn); });
  host.prepend(btn);
}

/* ---- Modal de vista (Todos / Mis tickets / Sin asignar) ---- */
function mountViewModal(){
  if($("#tcViewOverlay")) return;
  const ov = document.createElement("div");
  ov.id = "tcViewOverlay";
  ov.className = "overlay";
  ov.hidden = true;
  ov.setAttribute("role", "dialog");
  ov.setAttribute("aria-modal", "true");
  ov.setAttribute("aria-label", "Vista de tickets");
  ov.setAttribute("aria-hidden", "true");
  ov.setAttribute("tabindex", "-1");
  ov.innerHTML = `
    <div class="modal tcViewModal">
      <div class="tcViewModal__head">
        <div><div class="tcViewModal__kicker">Vista</div><h3>¿Qué tickets quieres ver?</h3></div>
        <button type="button" class="tcViewModal__x" id="tcViewClose" aria-label="Cerrar">×</button>
      </div>
      <div class="tcViewPills">
        <button type="button" data-scope="all" aria-pressed="false">Todos</button>
        <button type="button" data-scope="mine" aria-pressed="false">Mis tickets</button>
        <button type="button" data-scope="unassigned" aria-pressed="false">Sin asignar</button>
      </div>
    </div>`;
  document.body.appendChild(ov);

  // Cierre con backdrop (click en el propio overlay, no en document) → sin carrera.
  ov.addEventListener("click", e => { if(e.target === ov) closeView(); });
  $("#tcViewClose").onclick = () => closeView();
  // TC-U15A-1: delega el alcance en el contrato canónico (tickets.js). Éste sincroniza
  // URL, reinicia paginación (Kanban + compacta), recalcula métricas y recarga con
  // guarda anti-carreras (LOAD_SEQ). Aquí sólo reflejamos la selección.
  ov.querySelectorAll("[data-scope]").forEach(b => {
    b.addEventListener("click", () => {
      const scope = b.dataset.scope || "all";
      if (typeof window.__tkApplyScope === "function") window.__tkApplyScope(scope);
      syncViewPills();
      syncViewButton();
      closeView();
    });
  });
}

function openView(trigger){
  if(!IS_ADMIN) return;
  mountViewModal();
  syncViewPills();
  openDialog("#tcViewOverlay", { trigger, initialFocus:"#tcViewClose", onCloseRequest:closeView });
}
function closeView(){ closeDialog("#tcViewOverlay"); }

/* ---- Modal de asignación (centrado) ---- */
function mountAssignModal(){
  if($("#tcAssignOverlay")) return;
  const ov = document.createElement("div");
  ov.id = "tcAssignOverlay";
  ov.className = "overlay";
  ov.hidden = true;
  ov.setAttribute("role", "dialog");
  ov.setAttribute("aria-modal", "true");
  ov.setAttribute("aria-label", "Asignar ticket");
  ov.setAttribute("aria-hidden", "true");
  ov.setAttribute("tabindex", "-1");
  ov.innerHTML = `
    <div class="modal tcAssignModal">
      <div class="tcAssignModal__head">
        <div><div class="tcAssignModal__kicker">Asignación</div><h3 id="tcAssignModalTitle">Ticket</h3></div>
        <button type="button" class="tcAssignModal__x" id="tcAssignClose" aria-label="Cerrar">×</button>
      </div>
      <label class="tcAssignModal__lbl" for="tcAssignSelect">Responsable operativo</label>
      <select id="tcAssignSelect"></select>
      <div class="tcAssignModal__actions">
        <button type="button" class="tcAssignBtn" id="tcAssignCancel">Cancelar</button>
        <button type="button" class="tcAssignBtn tcAssignBtn--brand" id="tcAssignSave">Guardar</button>
      </div>
    </div>`;
  document.body.appendChild(ov);

  // Cierre con backdrop (sobre el overlay), X y Cancelar.
  ov.addEventListener("click", e => { if(e.target === ov) closeAssign(); });
  $("#tcAssignClose").onclick = () => closeAssign();
  $("#tcAssignCancel").onclick = () => closeAssign();
  $("#tcAssignSave").onclick = () => saveAssignment();
}

function openAssign(id, trigger){
  if(!IS_ADMIN) return;
  const t = ticketById(id);
  if(!t) return;
  mountAssignModal();
  const ov = $("#tcAssignOverlay");
  ov.dataset.id = String(id);
  $("#tcAssignModalTitle").textContent = t.titulo || t.folio || "Ticket";
  const assigned = t.asignado_a || "";
  $("#tcAssignSelect").innerHTML = [
    `<option value="">Sin asignar</option>`,
    ...AGENTS.map(a => `<option value="${esc(a.id)}" ${String(a.id)===String(assigned)?"selected":""}>${esc(agentLabel(a))} · ${esc(a.rol || "")}</option>`)
  ].join("");
  openDialog(ov, { trigger, initialFocus:"#tcAssignSelect", onCloseRequest:closeAssign });
}
function closeAssign(){ closeDialog("#tcAssignOverlay"); }

async function saveAssignment(){
  if(!IS_ADMIN){ closeAssign(); return; }
  if(BUSY) return;
  const ov = $("#tcAssignOverlay");
  const id = ov?.dataset?.id || "";
  const t = ticketById(id);
  if(!t) return;

  const next = $("#tcAssignSelect")?.value || null;
  const now = new Date().toISOString();
  const asignado_en = next ? now : null;

  if(!isUuid(id)){
    t.asignado_a = next;
    t.asignado_en = asignado_en;
    closeAssign();
    applyAssignmentDecorations();
    toast("Demo local: asignación simulada.");
    return;
  }

  BUSY = true;
  let error=null;
  try{const result=await s.from("tickets").update({asignado_a:next,asignado_en,fecha_actualizacion:now}).eq("id",id);error=result.error}
  catch(err){error=err}
  finally{BUSY=false}

  if(error){
    console.error("ASSIGN_BOARD_SAVE_ERROR",{code:String(error?.code||error?.name||"UNKNOWN"),status:Number(error?.status||0)||null,operation:"tickets.update_assignment"});
    alert(error.message || "No se pudo guardar asignación.");
    return;
  }

  t.asignado_a = next;
  t.asignado_en = asignado_en;
  closeAssign();
  applyAssignmentDecorations();
  toast(next ? "Asignación actualizada." : "Ticket sin asignar.");
}

/* ---- Badge en cada card (integrado al row de acciones) ---- */
function ensureCardAssignButton(card, t){
  if(card.querySelector(".tcAssignBadge")) return;
  const badge = document.createElement("button");
  badge.type = "button";
  badge.className = "tcAssignBadge";
  const id = String(t.id || cardId(card));
  badge.dataset.assignOpen = id;
  // B.1: apertura por listener DIRECTO en el badge (pointerdown), NO por
  // document-click-capture (que competía con los stopImmediatePropagation de tickets.js).
  badge.addEventListener("pointerdown", e => { e.preventDefault(); e.stopPropagation(); openAssign(id, badge); });

  // B.2/B.2.2: el badge de agente va en la ZONA DE IDENTIDAD (junto al nombre/remitente).
  // B2_2_KANBAN_ASSIGN_BADGE_INLINE: kanban también va junto al nombre/remitente, no en acciones.
  if(card.matches(".k-card")){
    const host = card.querySelector(".k-company-line") || card.querySelector(".k-title-line") || card.querySelector(".k-head");
    if(host){
      const nameEl = host.querySelector(".k-company") || host.querySelector("strong") || host.firstElementChild;
      if(nameEl?.nextSibling) host.insertBefore(badge, nameEl.nextSibling);
      else host.appendChild(badge);
      badge.classList.add("tcAssignBadge--kanban-inline");
      host.classList.add("tcHasAssignBadge");
      return;
    }
  }

  // Lista compacta: dentro de .compact-topline → Nombre · badge · prioridad.
  if(card.matches(".compact-row")){
    const top = card.querySelector(".compact-topline");
    if(top){
      const tag = top.querySelector(".tag");
      const client = top.querySelector(".compact-client");
      if(tag) top.insertBefore(badge, tag);                       // antes de la prioridad
      else if(client?.nextSibling) top.insertBefore(badge, client.nextSibling);
      else top.appendChild(badge);
      badge.classList.add("tcAssignBadge--inline");
      return;
    }
  }

  // Popups (cabecera de columna y tickets cerrados): junto al nombre en .closed-client.
  if(card.matches(".tk-col-modal-row, .closed-row")){
    const idBlock = card.querySelector(".closed-client");
    if(idBlock){
      const nameEl = idBlock.querySelector("strong");
      if(nameEl?.nextSibling) idBlock.insertBefore(badge, nameEl.nextSibling);
      else idBlock.appendChild(badge);
      badge.classList.add("tcAssignBadge--inline");
      idBlock.classList.add("tcHasAssignBadge");
      return;
    }
  }

  // Kanban / fallback: row de acciones, ANTES del rayo (.k-action-bolt).
  const actions = card.querySelector(".k-card-actions, .compact-actions");
  if(actions){
    const bolt = actions.querySelector(".k-action-bolt");
    if(bolt) actions.insertBefore(badge, bolt);
    else actions.appendChild(badge);
  } else {
    card.appendChild(badge);
  }
}

function updateCardBadge(card, t){
  ensureCardAssignButton(card, t);
  const b = card.querySelector(".tcAssignBadge");
  const assigned = t?.asignado_a || "";
  const mine = assigned && CURRENT_USER_ID && String(assigned) === String(CURRENT_USER_ID);
  b.classList.toggle("is-free", !assigned);
  b.classList.toggle("is-mine", !!mine);
  const label = assigned ? assignedLabel(assigned) : "Sin asignar";
  b.textContent = assigned ? initialsFromName(label) : "S/A";
  b.title = label;
  b.setAttribute("aria-label", label);
  if(assigned){
    const hue = agentHue(assigned || label);
    b.style.color = `hsl(${hue} 64% 42%)`;
    b.style.background = `color-mix(in srgb, hsl(${hue} 70% 50%) 13%, var(--panel))`;
    b.style.borderColor = `color-mix(in srgb, hsl(${hue} 70% 50%) 36%, var(--line))`;
  }else{
    b.style.color = "";
    b.style.background = "";
    b.style.borderColor = "";
  }
}

// TC-U15A-1: el filtro real de alcance ya no oculta filas en el DOM; se aplica en la
// consulta Supabase (tickets.js/fetchTicketsRest). Este módulo sólo decora badges y
// refleja la selección visible; no re-filtra el board.

function syncViewPills(){
  const scope = currentScope();
  $$("#tcViewOverlay [data-scope]").forEach(b => {
    const on = (b.dataset.scope || "all") === scope;
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

function syncViewButton(){
  const btn = $("#tcAssignViewBtn");
  if(!btn) return;
  const scope = currentScope();
  btn.classList.toggle("is-filtered", scope !== "all");
  btn.setAttribute("aria-label", `Vista de tickets: ${scopeLabel(scope)}`);
  btn.setAttribute("title", `Vista: ${scopeLabel(scope)}`);
}

function applyAssignmentDecorations(){
  // B.1: desconectar el observer mientras decoramos para no auto-disparar el bucle
  // (las inserciones de badge son mutaciones childList y re-disparaban el observer).
  OBS?.disconnect();
  if(!IS_ADMIN){
    $("#tcAssignViewBtn")?.remove();
    $("#tcAssignOverlay")?.remove();
    $("#tcViewOverlay")?.remove();
    $$(".tcAssignBadge").forEach(x=>x.remove());
    return;
  }
  mountViewButton();
  mountViewModal();
  mountAssignModal();
  syncViewButton();
  syncViewPills();
  // B.1: SOLO cards/rows reales de tickets (no `[data-id]` genérico, que pegaba
  // badges en pagers/contenedores y vaciaba columnas al filtrar).
  // B.2: además decoramos las filas de los popups (cabecera de columna y cerrados).
  // TC-U15A-1: ya no se oculta ninguna fila aquí; el alcance se aplica en la consulta.
  $$(".k-card[data-id], .compact-row[data-id], .tk-col-modal-row[data-id], .closed-row[data-id]").forEach(card => {
    const id = cardId(card);
    const t = ticketById(id);
    if(!t) return;
    updateCardBadge(card, t);
  });
  OBS?.observe(document.body, { childList:true, subtree:true });
}

function bind(){
  // B.1: NO se usa document-click-capture para abrir (esa era la carrera con
  // los stopImmediatePropagation de tickets.js). La apertura ahora está en
  // listeners DIRECTOS (pointerdown) sobre cada badge y sobre el icono de vista.

  // Re-decorar cuando el board re-renderiza (debounce). El observer se
  // desconecta dentro de applyAssignmentDecorations para no auto-dispararse.
  if(!OBS){
    OBS = new MutationObserver(() => {
      clearTimeout(window.__tcAssignBoardTimer);
      window.__tcAssignBoardTimer = setTimeout(applyAssignmentDecorations, 150);
    });
    OBS.observe(document.body, { childList:true, subtree:true });
  }
  // TC-U15A-1: mantener selección visible + aria-pressed sincronizados con el alcance.
  if(!window.__tcAssignScopeBound){
    window.__tcAssignScopeBound = true;
    window.addEventListener("tk:scopechange", () => { syncViewPills(); syncViewButton(); });
  }
}

async function boot(){
  mountStyles();
  await loadAgents();
  if(!IS_ADMIN) return;
  mountViewButton();
  mountViewModal();
  mountAssignModal();
  bind();
  applyAssignmentDecorations();
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", boot, { once:true });
}else{
  boot();
}
