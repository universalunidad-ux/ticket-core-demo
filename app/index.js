import { supabase, msg } from "./supabase.js";

const $ = q => document.querySelector(q);
const qs = new URLSearchParams(location.search);
const next = qs.get("next") || "tickets.html";

const setStatus = (text, cls = "") => {
  const el = $("#loginStatus");
  if (!el) return;
  el.textContent = text;
  el.className = `mut ${cls}`.trim();
};

const safeNext = v => {
  const raw = String(v || "tickets.html").trim();
  if (!raw || raw.startsWith("http") || raw.startsWith("//") || raw.includes("..")) return "tickets.html";
  return raw;
};

const checkSession = async () => {
  try {
    const { data } = await supabase.auth.getSession();
    if (data?.session) {
      $("#loginSessionBox")?.classList.remove("hidden");
      $("#loginNextLink")?.setAttribute("href", safeNext(next));
    }
  } catch {
    setStatus("Configura Supabase local para iniciar sesión.", "warn");
  }
};

const login = async e => {
  e?.preventDefault?.();

  const email = $("#loginEmail")?.value?.trim() || "";
  const password = $("#loginPassword")?.value || "";

  if (!email || !password) {
    setStatus("Escribe correo y contraseña.", "warn");
    return;
  }

  $("#loginBtn") && ($("#loginBtn").disabled = true);
  setStatus("Iniciando sesión…");

  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    location.href = safeNext(next);
  } catch (err) {
    setStatus(msg?.(err) || err?.message || "No se pudo iniciar sesión.", "bad");
  } finally {
    $("#loginBtn") && ($("#loginBtn").disabled = false);
  }
};

$("#loginForm")?.addEventListener("submit", login);
$("#loginBtn")?.addEventListener("click", login);
checkSession();
