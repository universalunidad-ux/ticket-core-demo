/* ============================================================================
   B19D-cont — Cola de consolidación.
   Lectura directa (RLS interna). Las acciones de escritura van SIEMPRE por la
   Edge consolidar-cliente-ticket (transaccional, con rol y bitácora).
   Blindaje:
   - capability gate central (shared/capabilities.js): si la Edge no está
     desplegada, los botones de acción quedan bloqueados con aviso honesto;
   - comparación clara: datos capturados vs contacto principal del candidato;
   - confirmación en acciones sensibles (asociar / mantener como nuevo);
   - doble ejecución bloqueada (busy por tarjeta);
   - respuestas obsoletas ignoradas (reqSeq);
   - errores humanos (permiso / indisponible / red / timeout) sin literales
     internos; códigos sanitizados dev-only;
   - tras un fallo la UI no queda ambigua: la tarjeta vuelve a estado operable
     y se ofrece reintentar.
   ============================================================================ */
import { mountNav } from "./shared/nav-interna.js?v=frontend-final-20260716-01";
import { fmtFecha, estadoTag, matchTag } from "./shared/formatters.js?v=frontend-final-20260716-01";
import { esc, toast } from "./global.js?v=frontend-final-20260716-01";
import { mapError, devLog, withTimeout } from "./shared/errors.js";
import { probeEdge, noteEdgeResponse } from "./shared/capabilities.js";
import { perfPrimaryDone, perfPageReady, perfCountRequest } from "./shared/perf.js";

const $ = q => document.querySelector(q);
const ST = { sb: null, rows: [], clientes: {}, contactos: {}, agentes: {}, nivel: "", agente: "", orden: "antiguo", busy: false, reqSeq: 0, cap: "unknown" };
const EDGE = "consolidar-cliente-ticket";

/* ---- capability gate ---- */
async function checkGate() {
  ST.cap = await probeEdge(EDGE);
  const gate = $("#cqGate");
  if (!gate) return;
  if (ST.cap === "unavailable") {
    gate.classList.remove("hidden");
    gate.innerHTML = "<b>Las acciones de consolidación aún no están habilitadas en el servidor.</b><span>Puedes revisar la cola y abrir tickets/fichas, pero confirmar o descartar asociaciones quedará bloqueado hasta el despliegue (dependencia B19B). No se realizará ningún cambio.</span>";
  } else if (ST.cap === "permission_denied") {
    gate.classList.remove("hidden");
    gate.innerHTML = "<b>No tienes permisos para ejecutar acciones de consolidación.</b><span>Contacta al administrador si crees que es un error.</span>";
  } else {
    gate.classList.add("hidden");
  }
  render();
}

/* ---- carga de la cola ---- */
const load = async () => {
  const seq = ++ST.reqSeq;
  const box = $("#cqList");
  box.innerHTML = '<div class="cl-skel"></div><div class="cl-skel"></div>';
  perfCountRequest(4);
  const t0 = performance.now();
  try {
    const { data, error } = await withTimeout(ST.sb.from("tickets")
      .select("id,folio,titulo,estado,prioridad,tipo,fecha_creacion,asignado_a,empresa_capturada,nombre_capturado,correo_capturado,telefono_capturado,cliente_id_sugerido,contacto_id_sugerido,match_score,match_nivel")
      .eq("requiere_consolidacion", true).neq("estado", "cerrado").order("fecha_creacion", { ascending: true }).limit(200), 12000);
    if (error) throw error;
    if (seq !== ST.reqSeq) { devLog("consolidacion", "load", "STALE_RESPONSE_DISCARDED"); return; }
    ST.rows = data || [];
    const cids = [...new Set(ST.rows.map(r => r.cliente_id_sugerido).filter(Boolean))];
    const aids = [...new Set(ST.rows.map(r => r.asignado_a).filter(Boolean))];
    const [cl, ct, ag] = await Promise.all([
      cids.length ? ST.sb.from("clientes").select("id,nombre").in("id", cids) : { data: [] },
      cids.length ? ST.sb.from("clientes_contactos").select("cliente_id,nombre,correo,telefono,es_principal").in("cliente_id", cids).eq("activo", true) : { data: [] },
      aids.length ? ST.sb.from("perfiles").select("id,nombre").in("id", aids) : { data: [] },
    ]);
    if (seq !== ST.reqSeq) return;
    ST.clientes = Object.fromEntries((cl.data || []).map(x => [x.id, x.nombre]));
    ST.contactos = {};
    (ct.data || []).forEach(c => {
      const prev = ST.contactos[c.cliente_id];
      if (!prev || (c.es_principal && !prev.es_principal)) ST.contactos[c.cliente_id] = c;
    });
    ST.agentes = Object.fromEntries((ag.data || []).map(x => [x.id, x.nombre || "Agente"]));
    const agSel = $("#cqAgente");
    agSel.innerHTML = '<option value="">Agente: todos</option>' + aids.map(id => `<option value="${esc(id)}">${esc(ST.agentes[id] || "Agente")}</option>`).join("");
    render();
    perfPrimaryDone(); perfPageReady();
  } catch (ex) {
    if (seq !== ST.reqSeq) return;
    const e = mapError(ex, "CONSOLIDATION_LOAD_FAILED");
    devLog("consolidacion", "load", e.code + ":" + e.kind, null, performance.now() - t0);
    box.innerHTML = `<div class="empty-state">${esc(e.human)} <button class="btn btn-ghost" id="cqRetry" type="button">Reintentar</button></div>`;
    $("#cqRetry")?.addEventListener("click", load);
  }
};

const filtered = () => {
  let out = ST.rows;
  if (ST.nivel === "sin") out = out.filter(r => !r.cliente_id_sugerido);
  else if (ST.nivel) out = out.filter(r => (r.match_nivel || "").toLowerCase() === ST.nivel);
  if (ST.agente) out = out.filter(r => r.asignado_a === ST.agente);
  if (ST.orden === "reciente") out = [...out].sort((a, b) => String(b.fecha_creacion).localeCompare(String(a.fecha_creacion)));
  else if (ST.orden === "score") out = [...out].sort((a, b) => (b.match_score || 0) - (a.match_score || 0));
  return out;
};

/* Comparación capturado vs candidato (con marcas de coincidencia) */
const kvHtml = (k, v, match = false) => `<div class="cq-kv"><span class="k">${esc(k)}</span><span class="v ${match ? "cq-match" : ""}">${esc(v || "—")}${match ? " ✓" : ""}</span></div>`;
const eqTxt = (a, b) => !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

const compareHtml = r => {
  const cand = r.cliente_id_sugerido ? ST.clientes[r.cliente_id_sugerido] : null;
  const cc = r.cliente_id_sugerido ? ST.contactos[r.cliente_id_sugerido] : null;
  const capturado = `<div class="cq-col"><div class="cq-col-h">Capturado en el ticket</div>
    ${kvHtml("Nombre", r.nombre_capturado)}
    ${kvHtml("Empresa", r.empresa_capturada)}
    ${kvHtml("Correo", r.correo_capturado)}
    ${kvHtml("Teléfono", r.telefono_capturado)}
    ${kvHtml("Creado", fmtFecha(r.fecha_creacion))}
    ${kvHtml("Agente", ST.agentes[r.asignado_a] || "Sin asignar")}
  </div>`;
  const candidato = cand
    ? `<div class="cq-col is-cand"><div class="cq-col-h">Candidato sugerido ${matchTag(r.match_nivel)}${r.match_score != null ? ` <span class="tag">score ${r.match_score}</span>` : ""}</div>
      ${kvHtml("Cliente", cand, eqTxt(cand, r.empresa_capturada) || eqTxt(cand, r.nombre_capturado))}
      ${kvHtml("Contacto", cc?.nombre, eqTxt(cc?.nombre, r.nombre_capturado))}
      ${kvHtml("Correo", cc?.correo, eqTxt(cc?.correo, r.correo_capturado))}
      ${kvHtml("Teléfono", cc?.telefono, eqTxt(cc?.telefono, r.telefono_capturado))}
      <a class="btn btn-ghost" href="cliente.html?id=${encodeURIComponent(r.cliente_id_sugerido)}" style="justify-self:start">Ver ficha completa</a>
    </div>`
    : '<div class="cq-col is-cand"><div class="cq-col-h">Candidato sugerido</div><div class="mut">Sin candidato — puede mantenerse como cliente nuevo o buscarse manualmente desde Clientes.</div></div>';
  return `<div class="cq-compare">${capturado}${candidato}</div>`;
};

const render = () => {
  const rows = filtered();
  $("#cqTotal").textContent = `${rows.length} pendientes`;
  const blocked = ST.cap === "unavailable" || ST.cap === "permission_denied";
  $("#cqList").innerHTML = rows.length ? rows.map(r => `<article class="cq-card" data-id="${esc(r.id)}">
    <div class="cq-head"><div class="cl-name">${esc(r.folio || "—")} · ${esc(r.titulo || "Sin título")}</div><div>${estadoTag(r.estado)}</div></div>
    ${compareHtml(r)}
    <div class="cq-actions">
      <a class="btn btn-ghost" href="ticket.html?id=${encodeURIComponent(r.id)}">Ver ticket</a>
      ${r.cliente_id_sugerido ? `<button class="btn btn-brand" data-act="confirmar_asociacion" type="button" ${blocked ? "disabled" : ""}>Confirmar asociación</button>` : ""}
      <button class="btn btn-ghost" data-act="mantener_sin_asociar" type="button" ${blocked ? "disabled" : ""}>Mantener como nuevo</button>
      <button class="btn btn-ghost" data-act="posponer" type="button" ${blocked ? "disabled" : ""}>Posponer</button>
    </div>
  </article>`).join("") : '<div class="empty-state">🎉 Nada pendiente de consolidación con estos filtros.</div>';
};

/* ---- acción vía Edge (nunca se simula éxito) ---- */
const callEdge = async (ticket, accion) => {
  const { data: { session } } = await ST.sb.auth.getSession();
  if (!session?.access_token) throw new Error("REQUEST_TIMEOUT: sesión expirada");
  const cfg = globalThis.TICKET_CORE_CONFIG || {}, url = `${String(cfg.supabaseUrl || "").trim()}/functions/v1/${EDGE}`;
  perfCountRequest();
  const r = await withTimeout(fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${session.access_token}`, "content-type": "application/json" },
    body: JSON.stringify({ ticket_id: ticket.id, accion, cliente_id: ticket.cliente_id_sugerido || null, contacto_id: ticket.contacto_id_sugerido || null, idempotency_key: `${ticket.id}_${accion}` }),
  }), 20000);
  noteEdgeResponse(EDGE, r.status);
  const j = await r.json().catch(() => ({}));
  if (r.status === 404 && !j?.error) { ST.cap = "unavailable"; checkGate(); throw new Error("CONSOLIDATION_UNAVAILABLE"); }
  if (r.status === 401 || r.status === 403) { ST.cap = "permission_denied"; checkGate(); throw new Error("PERMISSION_DENIED"); }
  if (!r.ok) throw Object.assign(new Error(j?.error && String(j.error).length < 160 ? j.error : "CONSOLIDATION_ACTION_FAILED"), { status: r.status });
  return j;
};

const HUMAN_ACTION_ERR = {
  CONSOLIDATION_UNAVAILABLE: "Las acciones de consolidación aún no están habilitadas en el servidor. No se realizó ningún cambio.",
  PERMISSION_DENIED: "No tienes permisos para esta acción. No se realizó ningún cambio.",
};

document.addEventListener("DOMContentLoaded", async () => {
  const ctx = await mountNav("consolidacion");
  if (!ctx) return;
  ST.sb = ctx.sb;
  ["cqNivel", "cqAgente", "cqOrden"].forEach(id => $("#" + id).addEventListener("change", () => {
    ST.nivel = $("#cqNivel").value; ST.agente = $("#cqAgente").value; ST.orden = $("#cqOrden").value;
    render(); /* filtros locales: cero consultas nuevas */
  }));
  $("#cqList").addEventListener("click", async e => {
    const btn = e.target.closest?.("[data-act]");
    if (!btn || ST.busy || btn.disabled) return;
    const card = btn.closest(".cq-card"), t = ST.rows.find(x => x.id === card?.dataset.id);
    if (!t) return;
    const accion = btn.dataset.act;
    if (accion === "confirmar_asociacion" && !confirm(`¿Asociar ${t.folio} a "${ST.clientes[t.cliente_id_sugerido] || "el cliente sugerido"}"? Los datos capturados originales se preservan.`)) return;
    if (accion === "mantener_sin_asociar" && !confirm(`¿Mantener ${t.folio} como cliente nuevo (sin asociar al candidato)?`)) return;
    ST.busy = true; btn.disabled = true;
    const prev = btn.textContent; btn.textContent = "Procesando…";
    const t0 = performance.now();
    try {
      await callEdge(t, accion);
      devLog("consolidacion", accion, "CONSOLIDATION_ACTION_OK", null, performance.now() - t0);
      toast("Acción registrada", "ok"); /* éxito solo tras respuesta válida */
      await load();
    } catch (ex) {
      const known = HUMAN_ACTION_ERR[ex?.message];
      const e2 = known ? { code: ex.message, human: known, kind: "known" } : mapError(ex, "CONSOLIDATION_ACTION_FAILED", ex?.status);
      devLog("consolidacion", accion, e2.code + ":" + (e2.kind || ""), ex?.status ?? null, performance.now() - t0);
      toast(e2.human, "bad"); /* la tarjeta vuelve a estado operable: sin estado ambiguo */
    } finally {
      ST.busy = false; btn.disabled = ST.cap === "unavailable" || ST.cap === "permission_denied"; btn.textContent = prev;
    }
  });
  load();
  checkGate(); /* en paralelo; deshabilita acciones si aplica */
});
