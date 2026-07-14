/* ============================================================================
   B19C/B19D — cliente.core.js: datos de la ficha 360 con CARGA PROGRESIVA.
   Antes (B19A): 6 consultas iniciales (cliente, contactos, equipos, tickets
   x100, bitácora x30, sugeridos x30) bloqueaban el primer render.
   Ahora:
   1) loadIdentidad(): cliente + contactos + counts head baratos → header al instante.
   2) Cada pestaña tiene su loader propio (lazy al primer clic, cacheado por
      cliente.js durante la sesión de la página, con reintento por pestaña).
   Todas las columnas seleccionadas están confirmadas por uso previo.
   ============================================================================ */
export const OPEN_STATES = ["abierto", "en_proceso", "esperando_cliente"];
const cnt = (p) => p.then(r => (r.error ? null : (r.count ?? 0))).catch(() => null);

/* --- 1) Identidad + resumen (primer paint): 1 fila + contactos + counts head --- */
export async function loadIdentidad(sb, id) {
  const BASE = { count: "exact", head: true };
  const [cl, contactos, abiertos, totales, equipos, pendCons, sugCons, ult] = await Promise.all([
    sb.from("clientes").select("*").eq("id", id).maybeSingle(),
    sb.from("clientes_contactos").select("id,nombre,correo,telefono,puesto,es_principal,activo").eq("cliente_id", id).order("es_principal", { ascending: false }),
    cnt(sb.from("tickets").select("id", BASE).eq("cliente_id", id).in("estado", OPEN_STATES)),
    cnt(sb.from("tickets").select("id", BASE).eq("cliente_id", id)),
    cnt(sb.from("cliente_sistemas").select("id", BASE).eq("cliente_id", id)),
    cnt(sb.from("tickets").select("id", BASE).eq("cliente_id", id).eq("requiere_consolidacion", true)),
    cnt(sb.from("tickets").select("id", BASE).eq("cliente_id_sugerido", id).eq("requiere_consolidacion", true)),
    sb.from("tickets").select("fecha_actualizacion").eq("cliente_id", id).order("fecha_actualizacion", { ascending: false }).limit(1),
  ]);
  if (cl.error) throw cl.error;
  if (!cl.data) throw new Error("CLIENTE_NO_ENCONTRADO");
  return {
    cliente: cl.data,
    contactos: (contactos.data || []).filter(c => c.activo !== false),
    kpis: {
      abiertos, totales, equipos,
      actividad: ult.data?.[0]?.fecha_actualizacion || null,
      consolidacion: (pendCons || 0) > 0 || (sugCons || 0) > 0,
      pendCons: pendCons || 0, sugCons: sugCons || 0,
    },
  };
}

/* --- 2) Loaders por pestaña (uno por clic; cache en cliente.js) --- */
export async function loadEquipos(sb, id) {
  const r = await sb.from("cliente_sistemas").select("*").eq("cliente_id", id);
  if (r.error) throw r.error;
  return r.data || [];
}

export async function loadTickets(sb, id) {
  const r = await sb.from("tickets")
    .select("id,folio,titulo,estado,prioridad,asignado_a,fecha_creacion,fecha_actualizacion,evidencia_count,requiere_consolidacion,tipo")
    .eq("cliente_id", id).order("fecha_actualizacion", { ascending: false }).limit(100);
  if (r.error) throw r.error;
  const tickets = r.data || [];
  const agentes = await loadAgentes(sb, tickets);
  return { tickets, agentes };
}

export async function loadBitacora(sb, id) {
  const r = await sb.from("bitacora").select("accion,detalle,fecha,usuario_id").eq("cliente_id", id).order("fecha", { ascending: false }).limit(30);
  if (r.error) throw r.error;
  return r.data || [];
}

export async function loadSugeridos(sb, id) {
  const r = await sb.from("tickets")
    .select("id,folio,titulo,estado,match_score,match_nivel,empresa_capturada,nombre_capturado,fecha_creacion")
    .eq("cliente_id_sugerido", id).eq("requiere_consolidacion", true).limit(30);
  if (r.error) throw r.error;
  return r.data || [];
}

/* Resolver nombres de agentes asignados en un solo lote (sin N+1) */
export async function loadAgentes(sb, tickets) {
  const ids = [...new Set((tickets || []).map(t => t.asignado_a).filter(Boolean))];
  if (!ids.length) return {};
  const { data } = await sb.from("perfiles").select("id,nombre").in("id", ids);
  return Object.fromEntries((data || []).map(p => [p.id, p.nombre || "Agente"]));
}
