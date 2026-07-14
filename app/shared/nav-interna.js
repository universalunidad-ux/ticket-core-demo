/* B19A — topbar interna compartida (clientes, cliente, consolidación, alta interna).
   Sesión obligatoria (guardSession) + rol desde perfiles. No se muestra en páginas públicas.
   Nota: la seguridad real vive en RLS/Edge; ocultar links es solo UX (documentado en B19A). */
import{supabase as s,guardSession,getProfile}from"../supabase.js";
import{ensureAppShell}from"../global.js";
export async function mountNav(active){
  const auth=await guardSession();if(!auth)return null;
  const perfil=await getProfile();
  const rol=(perfil?.rol||"soporte").toLowerCase();
  ensureAppShell({page:active,role:rol});
  return{auth,perfil,rol,user:auth.user,sb:s};
}
