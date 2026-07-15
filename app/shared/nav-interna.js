/* B19A — topbar interna compartida (clientes, cliente, consolidación, alta interna).
   Sesión obligatoria (guardSession) + rol desde perfiles. No se muestra en páginas públicas.
   Nota: la seguridad real vive en RLS/Edge; ocultar links es solo UX (documentado en B19A). */
import{supabase as s,guardSession,getProfile}from"../supabase.js";
import{ensureAppShell,registerGlobalSearchProvider}from"../global.js?v=frontend-stabilization-03b";
const cleanSearchTerm=value=>String(value||"").normalize("NFKC").replace(/[^\p{L}\p{N}\s-]/gu," ").replace(/\s+/g," ").trim().slice(0,80);
const signalQuery=(query,signal)=>typeof query?.abortSignal==="function"?query.abortSignal(signal):query;
export function registerInternalSearchProvider({sb=s,user,rol="soporte"}={}){
  const isAdmin=["admin","owner","administrador"].includes(String(rol||"").toLowerCase());
  const userId=user?.id||"";
  let supportClientIdsPromise=null;
  const supportClientIds=()=>supportClientIdsPromise||(supportClientIdsPromise=s.from("tickets").select("cliente_id").eq("asignado_a",userId).not("cliente_id","is",null).limit(500).then(({data,error})=>{if(error)throw error;return[...new Set((data||[]).map(x=>x.cliente_id).filter(Boolean))]}));
  registerGlobalSearchProvider({id:"internal-role-scoped",async search(raw,{signal}={}){
    const term=cleanSearchTerm(raw);if(term.length<2)return[];
    let tickets=s.from("tickets").select("id,folio,titulo,estado,empresa_capturada,cliente_id").or(`folio.ilike.%${term}%,titulo.ilike.%${term}%,empresa_capturada.ilike.%${term}%`).order("fecha_actualizacion",{ascending:false}).limit(8);
    if(!isAdmin)tickets=tickets.eq("asignado_a",userId);
    let clients=s.from("clientes").select("id,nombre").ilike("nombre",`%${term}%`).order("nombre",{ascending:true}).limit(6);
    if(!isAdmin){const ids=await supportClientIds();if(signal?.aborted)return[];if(!ids.length)clients=null;else clients=clients.in("id",ids)}
    const [tk,cl]=await Promise.all([signalQuery(tickets,signal),clients?signalQuery(clients,signal):Promise.resolve({data:[],error:null})]);
    if(tk.error||cl.error)throw tk.error||cl.error;
    return[
      ...(tk.data||[]).map(t=>({k:`t_${t.id}`,type:"ticket",group:"Tickets",label:t.folio?`${t.folio} · ${t.titulo||"Ticket"}`:t.titulo||"Ticket",sub:`${t.empresa_capturada||"Sin cliente"} · ${t.estado||"abierto"}`,href:`ticket.html?id=${encodeURIComponent(t.id)}`})),
      ...(cl.data||[]).map(c=>({k:`c_${c.id}`,type:"cliente",group:"Clientes",label:c.nombre||"Sin nombre",sub:"Cliente",href:`cliente.html?id=${encodeURIComponent(c.id)}`}))
    ];
  }});
}
export async function mountNav(active){
  const auth=await guardSession();if(!auth)return null;
  const perfil=await getProfile();
  const rol=(perfil?.rol||"soporte").toLowerCase();
  ensureAppShell({page:active,role:rol});
  registerInternalSearchProvider({sb:s,user:auth.user,rol});
  return{auth,perfil,rol,user:auth.user,sb:s};
}
