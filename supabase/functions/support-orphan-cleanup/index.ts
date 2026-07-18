// ADMIN JOB · Limpieza de adjuntos huérfanos en soporte_adjuntos.
// La eliminación usa la Storage API remove() (borrar storage.objects en SQL NO
// elimina el archivo físico). Protegida por un secreto administrativo (header),
// no expuesta al público. No se despliega automáticamente. PREPARED_NOT_APPLIED.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CLEANUP_SECRET = Deno.env.get("ORPHAN_CLEANUP_SECRET") || "";
const OLDER_THAN_HOURS = Number(Deno.env.get("ORPHAN_OLDER_THAN_HOURS") || "24");
const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

Deno.serve(async (req) => {
  // Autorización por secreto administrativo (constante en tiempo, sin exponerlo).
  const provided = req.headers.get("x-cleanup-secret") || "";
  if (!CLEANUP_SECRET || provided !== CLEANUP_SECRET) {
    return new Response(JSON.stringify({ message: "No autorizado." }), { status: 401 });
  }
  try {
    const cutoff = new Date(Date.now() - OLDER_THAN_HOURS * 3600_000).toISOString();
    const { data, error } = await sb
      .from("v_support_orphan_objects")
      .select("storage_path, created_at")
      .lt("created_at", cutoff)
      .limit(1000);
    if (error) throw error;
    const paths = (data || []).map((r: { storage_path: string }) => r.storage_path);
    let removed = 0;
    for (let i = 0; i < paths.length; i += 100) {
      const batch = paths.slice(i, i + 100);
      const { error: rmErr } = await sb.storage.from("soporte_adjuntos").remove(batch);
      if (rmErr) { console.error("REMOVE_BATCH_ERROR"); continue; }
      removed += batch.length;
    }
    return new Response(JSON.stringify({ ok: true, orphans: paths.length, removed }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (_e) {
    const reqId = crypto.randomUUID();
    console.error("ORPHAN_CLEANUP_FATAL", reqId);
    return new Response(JSON.stringify({ message: "Fallo en limpieza.", request_id: reqId }), { status: 500 });
  }
});
