import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

type JsonObj = Record<string, unknown>;

const CREATE_ACTIONS = new Set([
  "chat_forwarded_to_admin",
  "message_forwarded_to_admin",
  "file_forwarded_to_admin",
]);

function json(body: JsonObj, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function clean(v: unknown, max = 4000) {
  return String(v ?? "").replace(/\0/g, "").trim().slice(0, max);
}

function lower(v: unknown) {
  return String(v ?? "").trim().toLowerCase();
}

function isUuid(v: unknown) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v ?? ""));
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}_TIMEOUT`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function sha256(input: string) {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function idemStart(key: string, action: string, resource_id: string, request_hash: string) {
  if (!key) return { mode: "none", row: null as JsonObj | null };

  const now = new Date().toISOString();
  const ins = await sb.from("edge_idempotency").insert({
    idempotency_key: key,
    action,
    resource_id,
    request_hash,
    status: "processing",
  });

  if (!ins.error) return { mode: "new", row: null as JsonObj | null };

  if (ins.error.code !== "23505") {
    throw new Error(`IDEMPOTENCY_INSERT_ERROR: ${ins.error.message}`);
  }

  const old = await sb.from("edge_idempotency").select("*").eq("idempotency_key", key).maybeSingle();
  if (old.error) throw new Error(`IDEMPOTENCY_READ_ERROR: ${old.error.message}`);

  const row = old.data as JsonObj | null;
  if (!row) return { mode: "new", row: null as JsonObj | null };

  if (row.request_hash && row.request_hash !== request_hash) return { mode: "conflict", row };
  if (row.status === "completed" && row.response) return { mode: "replay", row };

  const updatedAt = String(row.updated_at || row.created_at || "");
  const age = updatedAt ? Date.now() - new Date(updatedAt).getTime() : 999999;

  if (row.status === "failed" || age > 90000) {
    const reset = await sb.from("edge_idempotency").update({
      status: "processing",
      error: null,
      updated_at: now,
    }).eq("idempotency_key", key);
    if (reset.error) throw new Error(`IDEMPOTENCY_RESET_ERROR: ${reset.error.message}`);
    return { mode: "retry", row };
  }

  return { mode: "processing", row };
}

async function idemDone(key: string, response: JsonObj) {
  if (!key) return;
  const { error } = await sb.from("edge_idempotency").update({
    status: "completed",
    response,
    error: null,
    updated_at: new Date().toISOString(),
  }).eq("idempotency_key", key);
  if (error) console.error("IDEMPOTENCY_DONE_ERROR", error);
}

async function idemFail(key: string, errorMsg: string) {
  if (!key) return;
  const { error } = await sb.from("edge_idempotency").update({
    status: "failed",
    error: errorMsg,
    updated_at: new Date().toISOString(),
  }).eq("idempotency_key", key);
  if (error) console.error("IDEMPOTENCY_FAIL_ERROR", error);
}

function baseTextForAction(action: string) {
  if (action === "chat_forwarded_to_admin") return "Se envió este chat a admin para seguimiento del caso.";
  if (action === "message_forwarded_to_admin") return "Se reenvió este mensaje a admin de forma correcta.";
  if (action === "file_forwarded_to_admin") return "Se reenvió este archivo a admin de forma correcta.";
  if (action === "marcar_revisado") return "Supervisión revisada por admin.";
  return "Se registró actualización de supervisión.";
}

function supervisorText(action: string, comentario: string) {
  const base = baseTextForAction(action);
  return comentario ? `${base}\nComentario para admin: ${comentario}` : base;
}

function closeText(nota: string) {
  const base = baseTextForAction("marcar_revisado");
  return nota ? `${base}\nNota: ${nota}` : base;
}

function archivoMeta(row: JsonObj | null, source_table: string) {
  if (!row) return null;
  return {
    source_table,
    id: row.id ?? null,
    nombre_archivo: row.nombre_archivo ?? row.nombre ?? row.filename ?? row.storage_path ?? row.ruta ?? null,
    mime_type: row.mime_type ?? row.tipo ?? row.mimetype ?? null,
    tamano_bytes: row.tamano_bytes ?? row.peso ?? row.size ?? null,
    storage_path: row.storage_path ?? row.ruta ?? row.path ?? null,
  };
}

async function findArchivo(ticket_id: string, ref_archivo_id: string) {
  const a = await sb.from("archivos_ticket").select("*").eq("id", ref_archivo_id).eq("ticket_id", ticket_id).maybeSingle();
  if (a.error) throw new Error(`ARCHIVO_QUERY_ERROR: ${a.error.message}`);
  if (a.data) return { row: a.data as JsonObj, source_table: "archivos_ticket" };

  const legacy = await sb.from("ticket_archivos").select("*").eq("id", ref_archivo_id).eq("ticket_id", ticket_id).maybeSingle();
  if (legacy.error) throw new Error(`ARCHIVO_LEGACY_QUERY_ERROR: ${legacy.error.message}`);
  if (legacy.data) return { row: legacy.data as JsonObj, source_table: "ticket_archivos" };

  return null;
}

async function bitacoraSafe(accion: string, cliente_id: unknown, detalle: JsonObj) {
  try {
    const { error } = await sb.from("bitacora").insert({
      accion,
      cliente_id: cliente_id || null,
      detalle,
      fecha: new Date().toISOString(),
      visibilidad: "interna",
      tipo: "sistema",
    });
    if (error) console.error("BITACORA_ERROR", error.message);
  } catch (e) {
    console.error("BITACORA_THROW", e);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  let idemKey = "";

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json({ error: "Missing Supabase env" }, 500);
    }

    const auth = req.headers.get("authorization") || "";
    const jwt = auth.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) return json({ error: "Sin sesión" }, 401);

    const { data: userRes, error: userErr } = await withTimeout(sb.auth.getUser(jwt), 4500, "AUTH_GET_USER");
    if (userErr || !userRes?.user?.id) return json({ error: "Sesión inválida" }, 401);
    const uid = userRes.user.id;

    const { data: perfil, error: perErr } = await withTimeout(
      sb.from("perfiles").select("id,rol,nombre").eq("id", uid).maybeSingle(),
      4500,
      "PERFIL_QUERY",
    );
    if (perErr) throw new Error(`PERFIL_QUERY_ERROR: ${perErr.message}`);
    if (!perfil || !["admin", "soporte"].includes(lower(perfil.rol))) {
      return json({ error: "Sin permisos" }, 403);
    }

    let body: JsonObj = {};
    try {
      body = await req.json();
    } catch {
      return json({ error: "JSON inválido" }, 400);
    }

    const ticket_id = clean(body.ticket_id, 80);
    const action = clean(body.accion ?? body.action, 80);
    const comentario = clean(body.comentario, 2000);
    const nota_cierre = clean(body.nota_cierre, 2000);
    const ref_evento_id = clean(body.ref_evento_id, 80);
    const ref_archivo_id = clean(body.ref_archivo_id, 80);
    idemKey = clean(body.idempotency_key, 180);

    if (!isUuid(ticket_id)) return json({ error: "ticket_id inválido" }, 400);
    if (!CREATE_ACTIONS.has(action) && action !== "marcar_revisado") {
      return json({ error: "accion inválida" }, 400);
    }

    if (CREATE_ACTIONS.has(action) && !comentario) {
      return json({ error: "comentario requerido" }, 400);
    }

    if (action === "message_forwarded_to_admin" && !isUuid(ref_evento_id)) {
      return json({ error: "ref_evento_id requerido" }, 400);
    }

    if (action === "file_forwarded_to_admin" && !isUuid(ref_archivo_id)) {
      return json({ error: "ref_archivo_id requerido" }, 400);
    }

    const request_hash = await sha256(JSON.stringify({
      ticket_id,
      action,
      comentario,
      nota_cierre,
      ref_evento_id: ref_evento_id || null,
      ref_archivo_id: ref_archivo_id || null,
    }));

    const idem = await idemStart(idemKey, `ticket-escalar-admin:${action}`, ticket_id, request_hash);
    if (idem.mode === "replay") {
      return json({ ...((idem.row?.response as JsonObj) || {}), idempotent_replay: true }, 200);
    }
    if (idem.mode === "conflict") {
      return json({ error: "idempotency_key reutilizada con contenido distinto", idempotency_key: idemKey }, 409);
    }
    if (idem.mode === "processing") {
      return json({ error: "Solicitud ya está en proceso", idempotency_key: idemKey }, 409);
    }

    const { data: ticket, error: tErr } = await withTimeout(
      sb.from("tickets")
        .select("id,folio,estado,cliente_id,requiere_supervision")
        .eq("id", ticket_id)
        .maybeSingle(),
      4500,
      "TICKET_QUERY",
    );

    if (tErr) throw new Error(`TICKET_QUERY_ERROR: ${tErr.message}`);
    if (!ticket) return json({ error: "Ticket no encontrado" }, 404);

    const estado = lower(ticket.estado);
    if (estado === "cerrado" && action !== "marcar_revisado") {
      return json({ error: "No se puede escalar un caso cerrado" }, 409);
    }

    if (action === "marcar_revisado") {
      if (lower(perfil.rol) !== "admin") return json({ error: "Solo admin puede marcar revisado" }, 403);
      if (ticket.requiere_supervision !== true) {
        return json({ error: "El ticket no tiene supervisión pendiente" }, 409);
      }

      const now = new Date().toISOString();
      const texto = closeText(nota_cierre);
      const meta = {
        accion: "admin_review_closed",
        target_role: "admin",
        requires_admin_review: false,
        nota_cierre: nota_cierre || null,
        actor_id: uid,
        actor_nombre: perfil.nombre || null,
        actor_rol: perfil.rol || null,
        folio: ticket.folio || null,
        idempotency_key: idemKey || null,
      };

      const ev = await withTimeout(
        sb.from("ticket_eventos").insert({
          ticket_id,
          autor_tipo: "soporte",
          visibilidad: "interna",
          kind: "nota",
          texto,
          created_by: uid,
          meta,
        }).select("id").single(),
        4500,
        "TICKET_EVENTO_INSERT",
      );
      if (ev.error) throw new Error(`TICKET_EVENTO_ERROR: ${ev.error.message}`);

      const up = await withTimeout(
        sb.from("tickets").update({
          requiere_supervision: false,
          revisado_por: uid,
          revisado_en: now,
          fecha_actualizacion: now,
        }).eq("id", ticket_id).select("id,requiere_supervision,revisado_por,revisado_en").single(),
        4500,
        "TICKET_UPDATE_REVISADO",
      );
      if (up.error) throw new Error(`TICKET_UPDATE_ERROR: ${up.error.message}`);

      await bitacoraSafe("ticket_supervision_revisada", ticket.cliente_id, {
        ticket_id,
        folio: ticket.folio || null,
        evento_id: ev.data?.id || null,
        actor_id: uid,
        actor_nombre: perfil.nombre || null,
      });

      const response = {
        ok: true,
        action,
        ticket_id,
        folio: ticket.folio || null,
        evento_id: ev.data?.id || null,
        requiere_supervision: false,
        revisado_por: uid,
        revisado_en: up.data?.revisado_en || now,
        idempotency_key: idemKey || null,
      };
      await idemDone(idemKey, response);
      return json(response, 200);
    }

    let refEvento: JsonObj | null = null;
    let refArchivo: JsonObj | null = null;

    if (action === "message_forwarded_to_admin") {
      const q = await withTimeout(
        sb.from("ticket_eventos")
          .select("id,ticket_id,autor_tipo,visibilidad,kind,texto,created_at,meta")
          .eq("id", ref_evento_id)
          .eq("ticket_id", ticket_id)
          .maybeSingle(),
        4500,
        "REF_EVENTO_QUERY",
      );
      if (q.error) throw new Error(`REF_EVENTO_QUERY_ERROR: ${q.error.message}`);
      if (!q.data) return json({ error: "Mensaje de referencia no encontrado en este ticket" }, 404);
      refEvento = q.data as JsonObj;
    }

    if (action === "file_forwarded_to_admin") {
      const found = await withTimeout(findArchivo(ticket_id, ref_archivo_id), 4500, "REF_ARCHIVO_QUERY");
      if (!found) return json({ error: "Archivo de referencia no encontrado en este ticket" }, 404);
      refArchivo = archivoMeta(found.row, found.source_table);
    }

    const now = new Date().toISOString();
    const texto = supervisorText(action, comentario);

    const meta = {
      accion: action,
      target_role: "admin",
      requires_admin_review: true,
      ref_evento_id: ref_evento_id || null,
      ref_evento_preview: refEvento ? {
        id: refEvento.id ?? null,
        autor_tipo: refEvento.autor_tipo ?? null,
        visibilidad: refEvento.visibilidad ?? null,
        kind: refEvento.kind ?? null,
        texto_preview: clean(refEvento.texto, 280),
        created_at: refEvento.created_at ?? null,
      } : null,
      ref_archivo_id: ref_archivo_id || null,
      ref_archivo_meta: refArchivo,
      comentario,
      actor_id: uid,
      actor_nombre: perfil.nombre || null,
      actor_rol: perfil.rol || null,
      folio: ticket.folio || null,
      idempotency_key: idemKey || null,
    };

    const ev = await withTimeout(
      sb.from("ticket_eventos").insert({
        ticket_id,
        autor_tipo: "soporte",
        visibilidad: "interna",
        kind: "nota",
        texto,
        created_by: uid,
        meta,
      }).select("id").single(),
      4500,
      "TICKET_EVENTO_INSERT",
    );
    if (ev.error) throw new Error(`TICKET_EVENTO_ERROR: ${ev.error.message}`);

    const up = await withTimeout(
      sb.from("tickets").update({
        requiere_supervision: true,
        requiere_supervision_en: now,
        revisado_por: null,
        revisado_en: null,
        fecha_actualizacion: now,
      }).eq("id", ticket_id).select("id,requiere_supervision,requiere_supervision_en").single(),
      4500,
      "TICKET_UPDATE_SUPERVISION",
    );
    if (up.error) throw new Error(`TICKET_UPDATE_ERROR: ${up.error.message}`);

    await bitacoraSafe("ticket_supervision_escalada", ticket.cliente_id, {
      ticket_id,
      folio: ticket.folio || null,
      accion: action,
      evento_id: ev.data?.id || null,
      actor_id: uid,
      actor_nombre: perfil.nombre || null,
      ref_evento_id: ref_evento_id || null,
      ref_archivo_id: ref_archivo_id || null,
    });

    const response = {
      ok: true,
      action,
      ticket_id,
      folio: ticket.folio || null,
      evento_id: ev.data?.id || null,
      requiere_supervision: true,
      requiere_supervision_en: up.data?.requiere_supervision_en || now,
      idempotency_key: idemKey || null,
    };

    await idemDone(idemKey, response);
    return json(response, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("TICKET_ESCALAR_ADMIN_ERROR", message);
    await idemFail(idemKey, message);
    return json({ error: message, idempotency_key: idemKey || null }, 500);
  }
});
