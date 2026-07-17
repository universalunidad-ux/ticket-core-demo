import { createClient as C } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const cfg = globalThis.TICKET_CORE_CONFIG || {};
const U = String(cfg.supabaseUrl || "").trim();
const K = String(cfg.supabasePublishableKey || "").trim();

if (!U || !K) {
  console.warn(
    "TICKET_CORE_SUPABASE_CONFIG_MISSING: define window.TICKET_CORE_CONFIG before loading app modules."
  );
}

const missing = () => {
  throw new Error("TICKET_CORE_SUPABASE_CONFIG_MISSING");
};

const missingClient = {
  auth: {
    getSession: async () => ({ data: { session: null }, error: new Error("TICKET_CORE_SUPABASE_CONFIG_MISSING") }),
    getUser: async () => ({ data: { user: null }, error: new Error("TICKET_CORE_SUPABASE_CONFIG_MISSING") }),
    signOut: async () => {},
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } })
  },
  from: () => missing(),
  storage: { from: () => missing() }
};

const s = U && K
  ? C(U, K, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  : missingClient;

const S = 288e5;
const L = "tc_login_ts";

export const supabase = s;
export const norm = v => (v || "").toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
export const esc = v => (v ?? "").replace(/[&<>"']/g, r => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[r]));
export const fmt = v => {
  if (!v) return "";
  try { return new Date(v).toLocaleDateString("es-MX"); } catch { return ""; }
};
export const msg = x => x?.message || x?.error_description || x?.details || "Error";

export const markLoginNow = () => localStorage.setItem(L, String(Date.now()));

const loginRedirect = () => {
  const current = `${location.pathname.split("/").pop() || "tickets.html"}${location.search}${location.hash}`;
  return `index.html?next=${encodeURIComponent(current)}`;
};

export async function guardSession(r = loginRedirect()) {
  const { data: { session }, error: a } = await s.auth.getSession();
  if (a || !session) {
    location.replace(r);
    return null;
  }

  const t = +localStorage.getItem(L) || 0;
  if (t && Date.now() - t > S) {
    await s.auth.signOut();
    localStorage.removeItem(L);
    location.replace(r);
    return null;
  }

  const { data: { user }, error: u } = await s.auth.getUser();
  if (u || !user) {
    await s.auth.signOut({ scope: "local" });
    localStorage.removeItem(L);
    location.replace(r);
    return null;
  }

  return { session, user };
}

export async function logout(r = "index.html") {
  await s.auth.signOut();
  localStorage.removeItem(L);
  location.href = r;
}

export async function getProfile() {
  const { data: { user } } = await s.auth.getUser();
  if (!user) return null;

  // SECURITY U2: SOLO LECTURA. El frontend nunca crea perfiles ni asigna rol.
  // Un usuario autenticado sin fila en `perfiles` = SIN ACCESO AUTORIZADO -> null.
  // La autorización real la imponen las políticas RLS del servidor (ver migraciones
  // supabase/migrations/*_authz_*). El aprovisionamiento de perfiles/roles ocurre
  // server-side (admin/backend), jamás desde el navegador.
  const { data } = await s
    .from("perfiles")
    .select("id,nombre,rol,tema,preferencias")
    .eq("id", user.id)
    .maybeSingle();

  return data || null;
}

// Estado seguro para consumidores: perfil existente o "sin acceso autorizado".
export async function getAuthorizedProfile() {
  const p = await getProfile();
  return p ? { profile: p, authorized: true } : { profile: null, authorized: false };
}

export async function saveTheme(v, id) {
  if (!id) return;
  const tema = v === "dark" ? "dark" : "light";
  // SECURITY U2: solo actualiza el tema de un perfil YA existente. Sin fallback
  // de insert: el frontend no aprovisiona perfiles ni escribe `rol`.
  await s.from("perfiles").update({ tema }).eq("id", id);
}

export const applyTheme = v => document.documentElement.setAttribute("data-theme", v === "dark" ? "dark" : "light");

export async function logAction({ accion, documento_id = null, cliente_id = null, detalle = {} }) {
  const { data: { user } } = await s.auth.getUser();
  if (!user) return;

  await s.from("bitacora").insert({ usuario_id: user.id, accion, documento_id, cliente_id, detalle });
}

export async function openPdfSigned(p, h = 8) {
  const { data, error } = await s.storage.from("certificados").createSignedUrl(p, h * 3600);
  if (error || !data?.signedUrl) throw error || new Error("Sin URL");
  window.open(data.signedUrl, "_blank", "noopener");
}

s.auth.onAuthStateChange(async (ev, session) => {
  if (ev === "SIGNED_IN" && session) {
    localStorage.setItem(L, String(localStorage.getItem(L) || Date.now()));
  }

  if (ev === "SIGNED_OUT") {
    localStorage.removeItem(L);
    if (!/index\.html$/i.test(location.pathname)) location.href = "index.html";
  }

  if (ev === "TOKEN_REFRESHED" && session) {
    const t = +localStorage.getItem(L) || 0;
    if (t && Date.now() - t > S) {
      await s.auth.signOut();
      localStorage.removeItem(L);
      location.href = "index.html";
    }
  }
});

export const PROFILE_RECHECK_MS = 15552e6;
export const needsProfileRefresh = p => {
  const miss = !p?.nombre || !p?.telefono || !p?.correo;
  const last = +new Date(p?.datos_confirmados_en || 0) || 0;
  return miss || !last || Date.now() - last > PROFILE_RECHECK_MS;
};
