import { supabase as s } from "./supabase.js";

const $ = (q, ctx=document) => ctx.querySelector(q);
const $$ = (q, ctx=document) => [...ctx.querySelectorAll(q)];
const esc = v => String(v ?? "").replace(/[&<>"']/g, m => ({
  "&":"&amp;",
  "<":"&lt;",
  ">":"&gt;",
  '"':"&quot;",
  "'":"&#39;"
}[m]));

const QS = new URLSearchParams(location.search);
const ID = QS.get("id") || "";

const isUuid = v => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ""));

let AGENTS = [];
let CURRENT_USER_ID = "";
let CURRENT_TICKET = null;

function agentLabel(a){
  return a?.nombre || a?.correo || a?.auth_email || (a?.id ? String(a.id).slice(0,8) : "Agente");
}

function assignedLabel(id){
  if(!id) return "Sin asignar";
  const a = AGENTS.find(x => String(x.id) === String(id));
  return a ? agentLabel(a) : "Asignado";
}

function mountStyles(){
  if(document.getElementById("tcTicketAssignStyles")) return;
  const st = document.createElement("style");
  st.id = "tcTicketAssignStyles";
  st.textContent = `
.tcAssignBox{
  border:1px solid var(--line);
  background:var(--panel);
  border-radius:18px;
  padding:12px;
  display:grid;
  gap:8px;
  margin:10px 0;
}
.tcAssignBox__top{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;
}
.tcAssignBox__k{
  font-size:11px;
  letter-spacing:.13em;
  text-transform:uppercase;
  color:var(--mut);
  font-weight:900;
}
.tcAssignBox__v{
  font-weight:900;
  color:var(--ink);
}
.tcAssignBox select{
  width:100%;
  min-height:40px;
  border:1px solid var(--line);
  border-radius:14px;
  background:var(--panel);
  color:var(--ink);
  padding:8px 10px;
  font-weight:800;
}
.tcAssignBox__hint{
  font-size:12px;
  color:var(--mut);
}
  `;
  document.head.appendChild(st);
}

function toast(text){
  if(window.toast) return window.toast(text, "ok");
  console.log(text);
}

async function loadAgents(){
  const user = await s.auth.getUser().catch(() => ({ data:{ user:null } }));
  CURRENT_USER_ID = user?.data?.user?.id || "";

  const { data, error } = await s
    .from("perfiles")
    .select("*")
    .in("rol", ["admin", "soporte"])
    .order("nombre", { ascending:true });

  if(error){
    console.warn("ASSIGN_LOAD_AGENTS_ERROR", error);
    AGENTS = [];
    return;
  }

  AGENTS = Array.isArray(data) ? data : [];
}

async function loadTicket(){
  if(!ID || !isUuid(ID)) return null;
  const { data, error } = await s
    .from("tickets")
    .select("id,folio,titulo,asignado_a,asignado_en,estado,prioridad")
    .eq("id", ID)
    .maybeSingle();

  if(error){
    console.warn("ASSIGN_LOAD_TICKET_ERROR", error);
    return null;
  }

  CURRENT_TICKET = data;
  return data;
}

function findMount(){
  return (
    $("#tkContext") ||
    $("#tkSide") ||
    $(".ticket-side") ||
    $(".side-panel") ||
    $(".ticket-aside") ||
    $("aside") ||
    $("main")
  );
}

function renderAssignBox(){
  mountStyles();

  let box = $("#tcTicketAssignBox");
  const mount = findMount();
  if(!mount) return;

  if(!box){
    box = document.createElement("section");
    box.id = "tcTicketAssignBox";
    box.className = "tcAssignBox";
    mount.prepend(box);
  }

  const assigned = CURRENT_TICKET?.asignado_a || "";
  const options = [
    `<option value="">Sin asignar</option>`,
    ...AGENTS.map(a => `<option value="${esc(a.id)}" ${String(a.id)===String(assigned)?"selected":""}>${esc(agentLabel(a))} · ${esc(a.rol || "")}</option>`)
  ].join("");

  box.innerHTML = `
    <div class="tcAssignBox__top">
      <div>
        <div class="tcAssignBox__k">Asignación</div>
        <div class="tcAssignBox__v" id="tcTicketAssignCurrent">${esc(assignedLabel(assigned))}</div>
      </div>
      <span class="tag info">${assigned ? "Asignado" : "Libre"}</span>
    </div>
    <select id="tcTicketAssignSelect" aria-label="Asignar ticket">
      ${options}
    </select>
    <div class="tcAssignBox__hint">Cambia el responsable operativo de este ticket.</div>
  `;

  $("#tcTicketAssignSelect")?.addEventListener("change", onAssignChange);
}

async function onAssignChange(e){
  const next = e.target.value || null;
  const now = new Date().toISOString();
  const asignado_en = next ? now : null;

  if(!ID || !isUuid(ID)){
    toast("Demo local: asignación simulada.");
    CURRENT_TICKET = { ...(CURRENT_TICKET || {}), asignado_a: next, asignado_en };
    renderAssignBox();
    return;
  }

  e.target.disabled = true;

  const { data, error } = await s
    .from("tickets")
    .update({
      asignado_a: next,
      asignado_en,
      fecha_actualizacion: now
    })
    .eq("id", ID)
    .select("id,folio,titulo,asignado_a,asignado_en,estado,prioridad")
    .maybeSingle();

  e.target.disabled = false;

  if(error){
    console.error("ASSIGN_TICKET_ERROR", error);
    alert(error.message || "No se pudo asignar.");
    return;
  }

  CURRENT_TICKET = data || { ...(CURRENT_TICKET || {}), asignado_a: next, asignado_en };
  renderAssignBox();
  toast("Asignación actualizada.");
}

async function boot(){
  if(!ID) return;
  await loadAgents();
  await loadTicket();
  renderAssignBox();
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", boot, { once:true });
}else{
  boot();
}
