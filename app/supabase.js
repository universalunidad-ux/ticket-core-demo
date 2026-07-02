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

export async function guardSession(r = "index.html") {
  const { data: { session }, error: a } = await s.auth.getSession();
  if (a || !session) return location.href = r, null;

  const t = +localStorage.getItem(L) || 0;
  if (t && Date.now() - t > S) {
    await s.auth.signOut();
    localStorage.removeItem(L);
    location.href = r;
    return null;
  }

  const { data: { user }, error: u } = await s.auth.getUser();
  return u || !user ? (location.href = r, null) : { session, user };
}

export async function logout(r = "index.html") {
  await s.auth.signOut();
  localStorage.removeItem(L);
  location.href = r;
}

export async function getProfile() {
  const { data: { user } } = await s.auth.getUser();
  if (!user) return null;

  let { data } = await s
    .from("perfiles")
    .select("id,nombre,rol,tema,preferencias")
    .eq("id", user.id)
    .maybeSingle();

  if (data) return data;

  const i = await s
    .from("perfiles")
    .insert({ id: user.id, tema: "light", rol: "soporte" })
    .select("id,nombre,rol,tema,preferencias")
    .single();

  return i.data || null;
}

export async function saveTheme(v, id) {
  if (!id) return;
  const tema = v === "dark" ? "dark" : "light";
  const q = await s.from("perfiles").update({ tema }).eq("id", id);

  if (q.error && /0 rows|No rows/i.test(q.error.message || "")) {
    await s.from("perfiles").insert({ id, tema, rol: "soporte" });
  }
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
