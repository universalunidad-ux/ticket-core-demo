/* ============================================================================
   B19C/B19D — cliente.js: orquestación de la ficha 360 con carga progresiva.
   1) Identidad/resumen primero (header pinta de inmediato).
   2) Solo la pestaña activa se carga al inicio.
   3) Las demás pestañas: lazy-load al primer clic + cache por pestaña durante
      la sesión de la página (volver a una pestaña NO repite la consulta).
   4) Reintento específico por pestaña; respuestas obsoletas se ignoran (seq).
   5) Skeleton local por pestaña, nunca bloqueo global. Sin polling.
   Estado de pestaña activa en el hash (#tab=tickets) para conservar contexto.
   Sin ?id= redirige a clientes.html (el menú "Clientes" apunta al listado).
   ============================================================================ */
import { mountNav } from "./shared/nav-interna.js?v=frontend-stabilization-03b";
import { loadIdentidad, loadEquipos, loadTickets, loadBitacora, loadSugeridos } from "./cliente.core.js";
import * as UI from "./cliente.ui.js";
import { perfPrimaryDone, perfSecondaryDone, perfPageReady, perfCountRequest } from "./shared/perf.js";
import { mapError, devLog, withTimeout } from "./shared/errors.js";

const $ = q => document.querySelector(q);
const TABS = ["resumen", "contactos", "equipos", "tickets", "adjuntos", "bitacora", "consolidacion"];
const ST = { sb: null, id: null, identidad: null, tab: "resumen", cache: {}, seq: {}, loading: {} };

/* Loaders por pestaña. adjuntos/consolidación reutilizan la cache de tickets. */
const ticketsData = async () => {
  if (!ST.cache.tickets) { perfCountRequest(2); ST.cache.tickets = await loadTickets(ST.sb, ST.id); }
  return ST.cache.tickets;
};
const LOADERS = {
  resumen: async () => ST.identidad,
  contactos: async () => ST.identidad,
  equipos: async () => { perfCountRequest(); return loadEquipos(ST.sb, ST.id); },
  tickets: ticketsData,
  adjuntos: ticketsData,
  bitacora: async () => { perfCountRequest(); return loadBitacora(ST.sb, ST.id); },
  consolidacion: async () => {
    const [tk, sug] = await Promise.all([ticketsData(), (perfCountRequest(), loadSugeridos(ST.sb, ST.id))]);
    return { pend: tk.tickets.filter(t => t.requiere_consolidacion), sugeridos: sug };
  },
};
const RENDER = {
  resumen: d => UI.renderResumen(d),
  contactos: d => UI.renderContactos(d),
  equipos: d => UI.renderEquipos(d),
  tickets: d => UI.renderTickets(d),
  adjuntos: d => UI.renderAdjuntos(d),
  bitacora: d => UI.renderBitacora(d),
  consolidacion: d => UI.renderConsolidacion(d),
};

const markActive = () => document.querySelectorAll("#cfTabs .chat-tab").forEach(b => {
  const on = b.dataset.tab === ST.tab;
  b.classList.toggle("is-active", on);
  b.setAttribute("aria-selected", on ? "true" : "false");
  if (on) b.scrollIntoView({ block: "nearest", inline: "nearest" }); /* tab activa visible en scroll horizontal */
});

const syncCounts = () => {
  const k = ST.identidad?.kpis || {};
  UI.setTabCount("contactos", ST.identidad ? ST.identidad.contactos.length : null);
  UI.setTabCount("equipos", k.equipos ?? null);
  UI.setTabCount("tickets", k.totales ?? null);
  UI.setTabCount("consolidacion", k.consolidacion ? (k.pendCons + k.sugCons) : null);
  /* adjuntos: solo real tras cargar tickets (no se inventa) */
  if (ST.cache.tickets) UI.setTabCount("adjuntos", ST.cache.tickets.tickets.filter(t => Number(t.evidencia_count) > 0).length);
};

async function openTab(tab, push = true) {
  tab = TABS.includes(tab) ? tab : "resumen";
  ST.tab = tab;
  markActive();
  if (push) history.replaceState(null, "", `${location.pathname}${location.search}#tab=${tab}`);
  const body = $("#cfBody");
  const cached = tab === "resumen" || tab === "contactos" ? ST.identidad : ST.cache[tab];
  if (cached) { body.innerHTML = RENDER[tab](cached); return; } /* sin repetir query */
  const seq = (ST.seq[tab] = (ST.seq[tab] || 0) + 1);
  body.innerHTML = UI.skeletonHtml();
  const t0 = performance.now();
  try {
    ST.loading[tab] = true;
    const data = await withTimeout(LOADERS[tab](), 12000);
    if (seq !== ST.seq[tab]) { devLog("cliente", `tab_${tab}`, "STALE_RESPONSE_DISCARDED"); return; }
    ST.cache[tab] = data;
    if (ST.tab === tab) body.innerHTML = RENDER[tab](data);
    syncCounts();
  } catch (ex) {
    if (seq !== ST.seq[tab]) return;
    const e = mapError(ex, "CLIENT_TAB_LOAD_FAILED");
    devLog("cliente", `tab_${tab}`, e.code + ":" + e.kind, null, performance.now() - t0);
    /* error local a la pestaña: header, tabs y demás pestañas siguen operables */
    if (ST.tab === tab) body.innerHTML = UI.errorHtml(tab, e.human);
  } finally { ST.loading[tab] = false; }
}

document.addEventListener("DOMContentLoaded", async () => {
  const id = new URLSearchParams(location.search).get("id");
  if (!id) { location.replace("clientes.html"); return; }
  const ctx = await mountNav("cliente");
  if (!ctx) return;
  ST.sb = ctx.sb; ST.id = id;

  const hashTab = (location.hash.match(/#tab=(\w+)/) || [])[1];

  try {
    perfCountRequest(8); /* identidad: 8 consultas ligeras en paralelo */
    ST.identidad = await withTimeout(loadIdentidad(ST.sb, id), 12000);
  } catch (ex) {
    const notFound = ex?.message === "CLIENTE_NO_ENCONTRADO";
    const e = mapError(ex, notFound ? "CLIENT_NOT_FOUND" : "CLIENT_DETAIL_LOAD_FAILED");
    devLog("cliente", "identidad", e.code + ":" + e.kind);
    $("#cfNombre").textContent = notFound ? "Cliente no encontrado" : "No se pudo cargar la ficha";
    $("#cfBody").innerHTML = `<div class="cf-empty"><div class="cf-empty-t">${notFound ? "Verifica el enlace o vuelve al listado" : "No se pudo consultar la información"}</div><div class="cf-empty-d">${notFound ? "El cliente pudo haberse consolidado con otro registro." : e.human}</div><div class="actions">${notFound ? "" : '<button class="btn btn-ghost" type="button" id="cfRetryAll">Reintentar</button>'}<a class="btn btn-ghost" href="clientes.html">Volver a clientes</a></div></div>`;
    document.getElementById("cfRetryAll")?.addEventListener("click", () => location.reload());
    return;
  }
  UI.renderHeader(ST.identidad);
  syncCounts();
  perfPrimaryDone();
  await openTab(hashTab || "resumen", false);
  perfPageReady();
  perfSecondaryDone();

  $("#cfTabs").addEventListener("click", e => {
    const b = e.target.closest?.(".chat-tab");
    if (b) openTab(b.dataset.tab);
  });
  $("#cfBody").addEventListener("click", e => {
    const rt = e.target.closest?.("[data-tab-retry]");
    if (rt) { delete ST.cache[rt.dataset.tabRetry]; openTab(rt.dataset.tabRetry, false); return; }
    const t = e.target.closest?.("[data-ticket]");
    if (t) location.href = `ticket.html?id=${encodeURIComponent(t.dataset.ticket)}`;
  });
  $("#cfBody").addEventListener("keydown", e => {
    if (e.key !== "Enter") return;
    const t = e.target.closest?.("[data-ticket]");
    if (t) location.href = `ticket.html?id=${encodeURIComponent(t.dataset.ticket)}`;
  });
  window.addEventListener("hashchange", () => {
    const h = (location.hash.match(/#tab=(\w+)/) || [])[1];
    if (h && h !== ST.tab) openTab(h, false);
  });
});
