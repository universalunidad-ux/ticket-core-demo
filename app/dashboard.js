/* ============================================================================
   DASHBOARD — Editor de avisos del sitio (solo rol admin).
   Lee y escribe en la tabla `avisos_globales`. El aviso activo se muestra
   automáticamente en soporte.html (loadGlobalNotice).
   Requiere una política RLS que permita al rol admin insert/update/delete
   en `avisos_globales` (ver nota al pie de este archivo).
   ============================================================================ */
import { supabase, getProfile, esc } from "./supabase.js";
import { loadSiteConfig, cfg, configDefaults } from "./config-loader.js";

const $ = (q, c = document) => c.querySelector(q);
const LIM = { titulo: 80, mensaje: 240 };
const COLORS = [
  ["info", "Azul (informativo)"],
  ["success", "Verde (todo bien)"],
  ["warning", "Amarillo (preventivo)"],
  ["danger", "Rojo (importante)"],
  ["mantenimiento", "Gris (mantenimiento)"],
];
// El CSS usa clases info/ok/warn/danger; la BD guarda tipo info/success/warning/danger/mantenimiento.
const CLASE = { info: "info", success: "ok", warning: "warn", danger: "danger", mantenimiento: "warn" };
const ICON = { info: "ℹ️", success: "✅", warning: "⏳", danger: "⚠️", mantenimiento: "🛠️" };

let MOUNT = null;

function toast(t, cls = "") {
  const s = $("#avMsg");
  if (s) { s.textContent = t; s.className = `mut ${cls}`.trim(); }
}

async function listar() {
  const { data, error } = await supabase
    .from("avisos_globales")
    .select("id,titulo,contenido,tipo,activo,mostrar_en_soporte,prioridad,starts_at,ends_at")
    .order("prioridad", { ascending: true })
    .limit(20);
  if (error) { console.warn("AVISOS_LIST", error); return []; }
  return data || [];
}

function previewHtml() {
  const tipo = $("#avColor")?.value || "info";
  const tit = ($("#avTitulo")?.value || "").trim() || "Título del aviso";
  const txt = ($("#avMensaje")?.value || "").trim() || "Aquí va el mensaje que verán los visitantes.";
  return `<div class="support-global-notice ${CLASE[tipo] || "info"}"><div class="notice-ic">${ICON[tipo] || "ℹ️"}</div><div class="notice-copy"><div class="notice-title">${esc(tit)}</div><div class="notice-text">${esc(txt)}</div></div></div>`;
}

function syncPreview() {
  const p = $("#avPreview"); if (p) p.innerHTML = previewHtml();
  const ct = $("#avTituloCount"); if (ct) ct.textContent = `${($("#avTitulo")?.value || "").length}/${LIM.titulo}`;
  const cm = $("#avMensajeCount"); if (cm) cm.textContent = `${($("#avMensaje")?.value || "").length}/${LIM.mensaje}`;
}

function filaAviso(a) {
  const estado = a.activo ? `<span class="tag ok">Activo</span>` : `<span class="tag">Inactivo</span>`;
  const donde = a.mostrar_en_soporte ? "Soporte" : "Oculto";
  return `<div class="av-item">
    <div class="support-global-notice ${CLASE[a.tipo] || "info"}" style="margin:0">
      <div class="notice-ic">${ICON[a.tipo] || "ℹ️"}</div>
      <div class="notice-copy"><div class="notice-title">${esc(a.titulo || "")}</div><div class="notice-text">${esc(a.contenido || "")}</div></div>
    </div>
    <div class="av-item-meta">${estado}<span class="tag">${donde}</span>
      <button class="mini btn-ghost" type="button" data-av-toggle="${a.id}" data-on="${a.activo ? 1 : 0}">${a.activo ? "Desactivar" : "Activar"}</button>
      <button class="mini btn-ghost" type="button" data-av-del="${a.id}">Eliminar</button>
    </div>
  </div>`;
}

async function refrescarLista() {
  const cont = $("#avLista");
  if (!cont) return;
  cont.innerHTML = `<div class="mut">Cargando…</div>`;
  const items = await listar();
  cont.innerHTML = items.length ? items.map(filaAviso).join("") : `<div class="empty-state">Aún no hay avisos. Crea el primero arriba.</div>`;
}

async function publicar() {
  const titulo = ($("#avTitulo")?.value || "").trim();
  const contenido = ($("#avMensaje")?.value || "").trim();
  const tipo = $("#avColor")?.value || "info";
  const mostrar = !!$("#avMostrar")?.checked;
  if (!titulo) return toast("Escribe un título.", "bad");
  if (!contenido) return toast("Escribe el mensaje.", "bad");
  if (titulo.length > LIM.titulo) return toast(`El título no debe pasar de ${LIM.titulo} caracteres.`, "bad");
  if (contenido.length > LIM.mensaje) return toast(`El mensaje no debe pasar de ${LIM.mensaje} caracteres.`, "bad");

  toast("Publicando…");
  const row = {
    // La tabla exige `mensaje` (NOT NULL) y `contenido` (NOT NULL): se espejan
    // para no romper el insert (antes faltaba `mensaje` → fallo de constraint).
    titulo, contenido, mensaje: contenido, tipo,
    activo: true,
    mostrar_en_soporte: mostrar,
    starts_at: new Date().toISOString(),
    ends_at: null,
  };
  const { error } = await supabase.from("avisos_globales").insert(row);
  if (error) { console.warn("AVISO_INSERT", error); return toast("No se pudo publicar. Revisa permisos (RLS) del administrador.", "bad"); }
  toast("Aviso publicado. Ya se muestra en soporte.", "ok");
  $("#avTitulo").value = ""; $("#avMensaje").value = ""; syncPreview();
  refrescarLista();
}

async function onClick(e) {
  const tg = e.target.closest("[data-av-toggle]");
  if (tg) {
    const on = tg.dataset.on === "1";
    const { error } = await supabase.from("avisos_globales").update({ activo: !on }).eq("id", tg.dataset.avToggle);
    if (error) return toast("No se pudo actualizar (permisos).", "bad");
    toast(on ? "Aviso desactivado." : "Aviso activado.", "ok");
    return refrescarLista();
  }
  const del = e.target.closest("[data-av-del]");
  if (del) {
    if (!confirm("¿Eliminar este aviso de forma permanente?")) return;
    const { error } = await supabase.from("avisos_globales").delete().eq("id", del.dataset.avDel);
    if (error) return toast("No se pudo eliminar (permisos).", "bad");
    toast("Aviso eliminado.", "ok");
    return refrescarLista();
  }
}

function applyRole(profile, isAdmin) {
  const rol = String(profile?.rol || "").toLowerCase();
  const badge = $("#dashRoleBadge");
  if (badge) badge.textContent = !profile ? "Sin sesión" : isAdmin ? "Administrador" : "Soporte";
  // Ocultar secciones de admin para quien no lo es
  if (!isAdmin) document.querySelectorAll(".dash-admin-only").forEach(el => el.classList.add("hidden"));
  // Vista enfocada para soporte
  const isSoporte = ["soporte", "support", "agente"].includes(rol);
  if (isSoporte) {
    $("#dashSoporte")?.classList.remove("hidden");
    const hi = $("#dashSoporteHi");
    if (hi) hi.textContent = `Hola${profile?.nombre ? ", " + String(profile.nombre).split(" ")[0] : ""}`;
    const t = $("#dashTitle"); if (t) t.textContent = "Tu mesa de soporte";
    const l = $("#dashLead"); if (l) l.textContent = "Atiende tus casos en la bandeja de tickets. Aquí tienes el panorama general.";
  }
}

async function mountAvisos() {
  MOUNT = $("#avEditor");
  if (!MOUNT) return;
  MOUNT.innerHTML = `
    <div class="av-grid">
      <div class="av-form">
        <div class="field"><label class="lbl" for="avTitulo">Título <span id="avTituloCount" class="av-count">0/${LIM.titulo}</span></label>
          <input class="input" id="avTitulo" maxlength="${LIM.titulo}" placeholder="Ej. Cierre por mantenimiento"></div>
        <div class="field"><label class="lbl" for="avMensaje">Mensaje <span id="avMensajeCount" class="av-count">0/${LIM.mensaje}</span></label>
          <textarea class="area" id="avMensaje" maxlength="${LIM.mensaje}" placeholder="Ej. El taller estará cerrado el 16 de septiembre. Tu caso será atendido al día siguiente."></textarea></div>
        <div class="field"><label class="lbl" for="avColor">Color</label>
          <select class="select" id="avColor">${COLORS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select></div>
        <label class="jn-wa" style="border:0;background:transparent;padding:0"><input type="checkbox" id="avMostrar" checked><span>Mostrar en la página de soporte</span></label>
        <div class="actions"><button class="btn btn-brand" type="button" id="avPublicar">Publicar aviso</button></div>
        <div class="mut" id="avMsg">El aviso aparecerá arriba del formulario de soporte para todos los visitantes.</div>
      </div>
      <div class="av-preview-wrap">
        <div class="lbl">Vista previa</div>
        <div id="avPreview">${previewHtml()}</div>
        <div class="lbl" style="margin-top:14px">Avisos existentes</div>
        <div id="avLista" class="av-lista"><div class="mut">Cargando…</div></div>
      </div>
    </div>`;

  ["avTitulo", "avMensaje", "avColor"].forEach(id => {
    $("#" + id)?.addEventListener("input", syncPreview);
    $("#" + id)?.addEventListener("change", syncPreview);
  });
  $("#avPublicar")?.addEventListener("click", publicar);
  MOUNT.addEventListener("click", onClick);
  syncPreview();
  refrescarLista();
}

async function init() {
  let profile = null;
  try { profile = await getProfile(); } catch { /* sin sesión */ }
  const rol = String(profile?.rol || "").toLowerCase();
  const isAdmin = ["admin", "jefe", "owner", "administrador"].includes(rol);
  applyRole(profile, isAdmin);
  if (isAdmin) { mountAvisos(); mountConfig(); mountReglas(); }
}

/* ---- Editor de Personalización del sitio (admin) — site_config + bitácora ---- */
/* Claves editables. Los textos por defecto viven en config-loader.js (DEFAULTS),
   fuente única de verdad; aquí solo describimos etiqueta/página/forma. */
const CFG_KEYS = [
  { clave: "soporte.hero.kicker", pagina: "soporte", label: "Soporte · Etiqueta superior", multi: false },
  { clave: "soporte.hero.titulo", pagina: "soporte", label: "Soporte · Título principal", multi: false },
  { clave: "soporte.ayuda.titulo", pagina: "soporte", label: "Soporte · Título de “Cómo agilizar”", multi: false },
  { clave: "soporte.evidencia.hint", pagina: "soporte", label: "Soporte · Ayuda al subir fotos/video", multi: true },
  { clave: "estado.reply.titulo", pagina: "estado", label: "Seguimiento · Título de “Responder”", multi: false },
  { clave: "estado.reply.hint", pagina: "estado", label: "Seguimiento · Ayuda al adjuntar archivos", multi: true },
];

function cfgToast(t, cls = "") { const s = $("#scMsg"); if (s) { s.textContent = t; s.className = `mut ${cls}`.trim(); } }

function cfgFieldHtml(k) {
  const val = cfg(k.clave, "");
  const id = "sc_" + k.clave.replace(/[^a-z0-9]/gi, "_");
  const control = k.multi
    ? `<textarea class="area" id="${id}" data-cfg-key="${k.clave}" rows="3" maxlength="600">${esc(val)}</textarea>`
    : `<input class="input" id="${id}" data-cfg-key="${k.clave}" maxlength="240" value="${esc(val)}">`;
  return `<div class="field"><label class="lbl" for="${id}">${esc(k.label)} <span class="tag">${esc(k.pagina)}</span></label>${control}</div>`;
}

async function mountConfig() {
  const m = $("#siteConfigEditor");
  if (!m) return;
  await loadSiteConfig(true); // refresca cache antes de pintar
  m.innerHTML = `
    <div class="av-grid">
      <div class="av-form">
        ${CFG_KEYS.map(cfgFieldHtml).join("")}
        <div class="actions"><button class="btn btn-brand" type="button" id="scGuardar">Guardar cambios</button>
          <button class="btn btn-ghost" type="button" id="scReset">Restaurar valores por defecto</button></div>
        <div class="mut" id="scMsg">Los cambios se aplican en soporte y seguimiento sin tocar código. Si la tabla <code>site_config</code> aún no existe, verás un aviso y nada se rompe.</div>
      </div>
      <div class="av-preview-wrap">
        <div class="lbl">Cómo se verá</div>
        <div class="preview-card" style="padding:14px">
          <div class="section-kicker" data-prev="soporte.hero.kicker">—</div>
          <div style="font-weight:700;font-size:18px;margin:2px 0" data-prev="soporte.hero.titulo">—</div>
          <div class="mut" data-prev="soporte.evidencia.hint">—</div>
          <hr style="border:0;border-top:1px solid var(--line,#e5e7eb);margin:12px 0">
          <div style="font-weight:600" data-prev="estado.reply.titulo">—</div>
          <div class="mut" data-prev="estado.reply.hint">—</div>
        </div>
      </div>
    </div>`;
  const syncPrev = () => {
    m.querySelectorAll("[data-prev]").forEach(el => {
      const inp = m.querySelector(`[data-cfg-key="${el.getAttribute("data-prev")}"]`);
      el.textContent = (inp?.value || "").trim() || cfg(el.getAttribute("data-prev"), "");
    });
  };
  m.querySelectorAll("[data-cfg-key]").forEach(el => el.addEventListener("input", syncPrev));
  $("#scGuardar")?.addEventListener("click", guardarConfig);
  $("#scReset")?.addEventListener("click", () => {
    const d = configDefaults();
    m.querySelectorAll("[data-cfg-key]").forEach(el => { el.value = d[el.getAttribute("data-cfg-key")] ?? ""; });
    syncPrev();
    cfgToast("Valores por defecto cargados. Pulsa “Guardar cambios” para aplicarlos.", "");
  });
  syncPrev();
}

async function guardarConfig() {
  const m = $("#siteConfigEditor");
  if (!m) return;
  const uid = (await supabase.auth.getUser()).data.user?.id || null;
  const pendientes = [];
  CFG_KEYS.forEach(k => {
    const el = m.querySelector(`[data-cfg-key="${k.clave}"]`);
    if (!el) return;
    const despues = (el.value || "").trim();
    const antes = cfg(k.clave, "");
    if (String(despues) !== String(antes)) pendientes.push({ k, antes, despues });
  });
  if (!pendientes.length) return cfgToast("No hay cambios que guardar.", "");
  cfgToast("Guardando…");
  let okCount = 0;
  for (const p of pendientes) {
    const row = {
      clave: p.k.clave, valor: p.despues, pagina: p.k.pagina,
      tipo: "texto", publico: true,
      actualizado_por: uid, actualizado_en: new Date().toISOString(),
    };
    const { error } = await supabase.from("site_config").upsert(row, { onConflict: "clave" });
    if (error) {
      console.warn("SITE_CONFIG_UPSERT", error);
      return cfgToast("No se pudo guardar. ¿Ya creaste la tabla site_config (DDL en PROPUESTA_PERSONALIZACION.md §4) y tienes permisos de admin?", "bad");
    }
    // Bitácora del cambio (no bloquea el guardado si falla)
    try {
      await supabase.from("bitacora").insert({
        usuario_id: uid, accion: "site_config_update", tipo: "nota_interna",
        detalle: { clave: p.k.clave, antes: p.antes, despues: p.despues },
      });
    } catch (_) { /* la bitácora es best-effort */ }
    okCount++;
  }
  await loadSiteConfig(true);
  cfgToast(`Listo. ${okCount} cambio${okCount === 1 ? "" : "s"} guardado${okCount === 1 ? "" : "s"} y registrado${okCount === 1 ? "" : "s"} en bitácora.`, "ok");
}

/* ---- Editor de reglas de asignación (admin) ---- */
const COND = [
  ["tipo_maquina", "Tipo de máquina (overlock, bordadora…)"],
  ["tipo_caso", "Tipo de caso (garantía, refacción…)"],
  ["empresa", "Empresa / cliente (texto)"],
  ["palabra_clave", "Palabra clave en el caso"],
  ["cliente_nuevo", "Cliente nuevo (sin valor)"],
];

let AGENTES = [];

async function cargarAgentes() {
  const { data } = await supabase.from("perfiles").select("id,nombre,rol").in("rol", ["soporte", "admin"]).order("nombre");
  AGENTES = data || [];
}

function rgToast(t, cls = "") { const s = $("#rgMsg"); if (s) { s.textContent = t; s.className = `mut ${cls}`.trim(); } }

async function rgLista() {
  const cont = $("#rgLista"); if (!cont) return;
  const { data, error } = await supabase
    .from("reglas_asignacion")
    .select("id,nombre,prioridad,tipo_condicion,valor,agente_id,activo")
    .order("prioridad", { ascending: true }).limit(100);
  if (error) { cont.innerHTML = `<div class="empty-state">No se pudo leer reglas. ¿Ejecutaste el SQL (supabase/asignacion_janome.sql) y tienes permisos de admin?</div>`; return; }
  const nombreAg = id => AGENTES.find(a => a.id === id)?.nombre || "—";
  const labelCond = c => (COND.find(x => x[0] === c) || ["", c])[1];
  cont.innerHTML = (data || []).length ? data.map(r => `
    <div class="av-item">
      <div><b>#${r.prioridad}</b> · ${esc(r.nombre || "")} ${r.activo ? '<span class="tag ok">Activa</span>' : '<span class="tag">Inactiva</span>'}</div>
      <div class="mut">Si <b>${esc(labelCond(r.tipo_condicion))}</b>${r.valor ? ` = "${esc(r.valor)}"` : ""} → <b>${esc(nombreAg(r.agente_id))}</b></div>
      <div class="av-item-meta">
        <button class="mini btn-ghost" type="button" data-rg-toggle="${r.id}" data-on="${r.activo ? 1 : 0}">${r.activo ? "Desactivar" : "Activar"}</button>
        <button class="mini btn-ghost" type="button" data-rg-del="${r.id}">Eliminar</button>
      </div>
    </div>`).join("") : `<div class="empty-state">Aún no hay reglas. Crea la primera arriba.</div>`;
}

async function rgCrear() {
  const nombre = ($("#rgNombre")?.value || "").trim();
  const tipo = $("#rgTipo")?.value || "tipo_maquina";
  const valor = ($("#rgValor")?.value || "").trim();
  const agente_id = $("#rgAgente")?.value || "";
  const prioridad = parseInt($("#rgPrioridad")?.value || "100", 10) || 100;
  if (!nombre) return rgToast("Ponle un nombre a la regla.", "bad");
  if (!agente_id) return rgToast("Elige a quién se asigna.", "bad");
  if (tipo !== "cliente_nuevo" && !valor) return rgToast("Escribe el valor a comparar.", "bad");
  rgToast("Guardando…");
  const { error } = await supabase.from("reglas_asignacion").insert({ nombre, tipo_condicion: tipo, valor: tipo === "cliente_nuevo" ? null : valor, agente_id, prioridad, activo: true });
  if (error) return rgToast("No se pudo guardar (revisa SQL/permisos).", "bad");
  rgToast("Regla creada.", "ok");
  $("#rgNombre").value = ""; $("#rgValor").value = "";
  rgLista();
}

async function rgClick(e) {
  const tg = e.target.closest("[data-rg-toggle]");
  if (tg) {
    const on = tg.dataset.on === "1";
    const { error } = await supabase.from("reglas_asignacion").update({ activo: !on }).eq("id", tg.dataset.rgToggle);
    if (error) return rgToast("No se pudo actualizar.", "bad");
    return rgLista();
  }
  const del = e.target.closest("[data-rg-del]");
  if (del) {
    if (!confirm("¿Eliminar esta regla?")) return;
    const { error } = await supabase.from("reglas_asignacion").delete().eq("id", del.dataset.rgDel);
    if (error) return rgToast("No se pudo eliminar.", "bad");
    return rgLista();
  }
}

async function mountReglas() {
  const m = $("#reglasEditor");
  if (!m) return;
  await cargarAgentes();
  const ags = AGENTES.length ? AGENTES.map(a => `<option value="${a.id}">${esc(a.nombre || a.id)}</option>`).join("") : `<option value="">(crea perfiles de soporte primero)</option>`;
  m.innerHTML = `
    <div class="av-grid">
      <div class="av-form">
        <div class="field"><label class="lbl" for="rgNombre">Nombre de la regla</label><input class="input" id="rgNombre" placeholder="Ej. Overlock → Juan"></div>
        <div class="field"><label class="lbl" for="rgTipo">Criterio</label><select class="select" id="rgTipo">${COND.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select></div>
        <div class="field" id="rgValorField"><label class="lbl" for="rgValor">Valor a comparar</label><input class="input" id="rgValor" placeholder="Ej. overlock"></div>
        <div class="field"><label class="lbl" for="rgAgente">Asignar a</label><select class="select" id="rgAgente">${ags}</select></div>
        <div class="field"><label class="lbl" for="rgPrioridad">Prioridad (menor = primero)</label><input class="input" id="rgPrioridad" type="number" value="100" min="1"></div>
        <div class="actions"><button class="btn btn-brand" type="button" id="rgCrear">Crear regla</button></div>
        <div class="mut" id="rgMsg">Las reglas se evalúan de menor a mayor prioridad; gana la primera que coincida.</div>
      </div>
      <div class="av-preview-wrap">
        <div class="lbl">Reglas existentes</div>
        <div id="rgLista" class="av-lista"><div class="mut">Cargando…</div></div>
      </div>
    </div>`;
  const toggleValor = () => { const t = $("#rgTipo")?.value; $("#rgValorField")?.classList.toggle("hidden", t === "cliente_nuevo"); };
  $("#rgTipo")?.addEventListener("change", toggleValor);
  $("#rgCrear")?.addEventListener("click", rgCrear);
  m.addEventListener("click", rgClick);
  toggleValor();
  rgLista();
}

document.addEventListener("DOMContentLoaded", init);

/* NOTA RLS (hazlo una vez en Supabase, SQL editor):
   Para que el admin pueda escribir avisos, la tabla avisos_globales necesita
   una política que lo permita. Ejemplo (ajústalo a tu modelo de roles):

   alter table avisos_globales enable row level security;
   create policy "admin gestiona avisos" on avisos_globales
     for all to authenticated
     using (exists (select 1 from perfiles p where p.id = auth.uid() and p.rol = 'admin'))
     with check (exists (select 1 from perfiles p where p.id = auth.uid() and p.rol = 'admin'));
   Y lectura pública del aviso activo (para soporte.html sin sesión):
   create policy "lectura aviso activo" on avisos_globales
     for select to anon using (activo = true and mostrar_en_soporte = true);
*/
