/* B19A — topbar interna compartida (clientes, cliente, consolidación, alta interna).
   Sesión obligatoria (guardSession) + rol desde perfiles. No se muestra en páginas públicas.
   Nota: la seguridad real vive en RLS/Edge; ocultar links es solo UX (documentado en B19A). */
import{supabase as s,guardSession,getProfile,logout,esc}from"../supabase.js";
const LINKS=[
  {href:"dashboard.html",label:"Dashboard",roles:["admin","soporte"]},
  {href:"tickets.html",label:"Tickets",roles:["admin","soporte"]},
  {href:"clientes.html",label:"Clientes",roles:["admin","soporte"]},
  {href:"consolidacion-clientes.html",label:"Consolidación",roles:["admin","soporte"]},
  {href:"dashboard.html#admin",label:"Administración",roles:["admin"]}
];
export async function mountNav(active){
  const auth=await guardSession();if(!auth)return null;
  const perfil=await getProfile();
  const rol=(perfil?.rol||"soporte").toLowerCase();
  const el=document.getElementById("navInterna");
  if(el){el.innerHTML=`<div class="topbar-inner">
    <a class="brand" href="dashboard.html"><span class="brand-dot"></span><span>Ticket Core · Janome</span></a>
    <div class="top-actions">
      ${LINKS.filter(l=>l.roles.includes(rol)).map(l=>`<a class="mini btn-ghost${l.href.startsWith(active)?" is-active":""}" href="${l.href}">${esc(l.label)}</a>`).join("")}
      <button class="mini" data-theme-toggle>🌓 <span data-theme-label>Claro</span></button>
      <button class="mini" id="navLogout" type="button">Salir</button>
    </div></div>`;
    document.getElementById("navLogout")?.addEventListener("click",()=>logout());
  }
  return{auth,perfil,rol,user:auth.user,sb:s};
}
