import { supabase, markLoginNow } from "./supabase.js";

const $ = q => document.querySelector(q);
const qs = new URLSearchParams(location.search);
const next = qs.get("next") || "tickets.html";
const INTERNAL_ROUTES = new Set([
  "alta-cliente.html",
  "cliente.html",
  "clientes.html",
  "consolidacion-clientes.html",
  "dashboard.html",
  "ticket.html",
  "tickets.html"
]);

const setStatus = (text, tone = "", alert = false) => {
  const el = $("#loginStatus");
  if (!el) return;
  el.textContent = text;
  el.className = `login-status ${tone}`.trim();
  if (alert) el.setAttribute("role", "alert");
  else el.removeAttribute("role");
};

const setBusy = busy => {
  $("#loginForm")?.setAttribute("aria-busy", String(busy));
  const button = $("#loginBtn");
  if (button) {
    button.disabled = busy;
    button.textContent = busy ? "Ingresando…" : "Continuar";
  }
};

const safeNext = v => {
  const raw = String(v || "tickets.html").trim();
  try {
    const target = new URL(raw, location.href);
    const file = target.pathname.split("/").pop() || "";
    if (target.origin !== location.origin || !INTERNAL_ROUTES.has(file)) return "tickets.html";
    return `${file}${target.search}${target.hash}`;
  } catch {
    return "tickets.html";
  }
};

const humanLoginError = error => {
  const detail = String(error?.message || error?.error_description || error?.name || "");
  if (/invalid login credentials|invalid credentials|email.*password|correo.*contrase/i.test(detail)) {
    return "El correo o la contraseña no coinciden.";
  }
  if (/failed to fetch|fetch failed|network|networkerror|load failed|timeout|connection/i.test(detail)) {
    return "No pudimos conectar. Revisa tu conexión e inténtalo de nuevo.";
  }
  return "No pudimos iniciar sesión. Inténtalo nuevamente.";
};

const checkSession = async () => {
  try {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error) throw error;
    if (user) {
      $("#loginSessionBox")?.classList.remove("hidden");
      $("#loginNextLink")?.setAttribute("href", safeNext(next));
      setStatus("Tu sesión sigue activa.", "ok");
    }
  } catch (error) {
    if (/auth session missing|session missing/i.test(String(error?.message || error?.name || ""))) return;
    setStatus(humanLoginError(error), "bad", true);
  }
};

const login = async event => {
  event?.preventDefault?.();

  const email = $("#loginEmail")?.value?.trim() || "";
  const password = $("#loginPassword")?.value || "";

  if (!email || !password) {
    setStatus("Escribe tu correo y contraseña.", "warn", true);
    return;
  }

  setBusy(true);
  setStatus("Ingresando…");

  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    markLoginNow();
    location.replace(safeNext(next));
  } catch (error) {
    setStatus(humanLoginError(error), "bad", true);
  } finally {
    setBusy(false);
  }
};

$("#loginForm")?.addEventListener("submit", login);
checkSession();
