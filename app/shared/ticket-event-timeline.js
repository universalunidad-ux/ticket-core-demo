const text = value => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
const token = value => text(value).toLocaleLowerCase("es-MX");

const objectValue = value => {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const stableValue = value => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
};

const eventMeta = row => objectValue(row?.meta ?? row?.detalle);
const eventTimestamp = row => row?.created_at || row?.fecha || row?.fecha_creacion || row?.actualizado_en || row?.updated_at || "";
const eventType = row => token(row?.kind || row?.accion || eventMeta(row)?.kind || eventMeta(row)?.tipo || "evento");
const eventActor = row => token(row?.autor_tipo || row?.autor || eventMeta(row)?.autor || row?.created_by || "sistema");
const eventContent = row => text(row?.texto || eventMeta(row)?.texto || eventMeta(row)?.mensaje || "");
const eventOrigin = row => token(row?.fuente || row?.source || row?.origen || eventMeta(row)?.fuente || eventMeta(row)?.source || eventMeta(row)?.origen || "ticket");

const semanticFingerprint = row => {
  const timestamp = text(eventTimestamp(row));
  const content = token(eventContent(row));
  if (!timestamp || !content) return "";
  return [eventOrigin(row), eventType(row), timestamp, eventActor(row), content].join("|");
};

const fallbackFingerprint = (row, storageSource, sourceIndex) => {
  const material = {
    storageSource,
    sourceIndex,
    type: eventType(row),
    actor: eventActor(row),
    timestamp: text(eventTimestamp(row)),
    content: eventContent(row),
    meta: eventMeta(row),
  };
  return `fallback:${JSON.stringify(stableValue(material))}`;
};

const normalizedRecord = (row, storageSource, sourceIndex, sequence) => {
  const persistentId = text(row?.id);
  const timestamp = eventTimestamp(row);
  const parsedTimestamp = Date.parse(timestamp || "");
  return {
    ...row,
    __timeline: {
      persistentId,
      semanticFingerprint: semanticFingerprint(row),
      fallbackFingerprint: fallbackFingerprint(row, storageSource, sourceIndex),
      storageSource,
      sourceIndex,
      sequence,
      timestamp,
      timestampMs: Number.isFinite(parsedTimestamp) ? parsedTimestamp : null,
    },
  };
};

/**
 * Une ticket_eventos y bitacora sin sacrificar filas ambiguas.
 * Identidad: ID persistente; después origen semántico + tipo + timestamp + actor
 * + contenido normalizado; finalmente un fallback estable por fuente e índice.
 * Dos IDs persistentes distintos siempre representan eventos distintos.
 */
export function mergeTicketEventHistory({ legacy = [], normalized = [] } = {}) {
  const candidates = [];
  let sequence = 0;
  for (const [storageSource, rows] of [["normalized", normalized], ["legacy", legacy]]) {
    for (const [sourceIndex, row] of (Array.isArray(rows) ? rows : []).entries()) {
      if (!row || typeof row !== "object") continue;
      candidates.push(normalizedRecord(row, storageSource, sourceIndex, sequence++));
    }
  }

  const result = [];
  const ids = new Set();
  const semanticOwners = new Map();
  for (const row of candidates) {
    const identity = row.__timeline;
    if (identity.persistentId && ids.has(identity.persistentId)) continue;

    const owners = semanticOwners.get(identity.semanticFingerprint) || [];
    const semanticDuplicate = identity.semanticFingerprint && owners.some(owner => (
      !identity.persistentId || !owner.persistentId || identity.persistentId === owner.persistentId
    ));
    if (semanticDuplicate) continue;

    if (identity.persistentId) ids.add(identity.persistentId);
    if (identity.semanticFingerprint) {
      owners.push(identity);
      semanticOwners.set(identity.semanticFingerprint, owners);
    }
    result.push(row);
  }

  return result.sort((left, right) => {
    const a = left.__timeline.timestampMs;
    const b = right.__timeline.timestampMs;
    if (a == null && b != null) return 1;
    if (a != null && b == null) return -1;
    if (a != null && b != null && a !== b) return a - b;
    return left.__timeline.sequence - right.__timeline.sequence;
  });
}

const stateLabel = value => text(value).replaceAll("_", " ");

export function describeSystemEvent(row, { publicTimeline = false } = {}) {
  const meta = eventMeta(row);
  const visibility = token(row?.visibilidad || meta?.visibilidad || "interna");
  if (publicTimeline && visibility !== "publica") return null;

  const actor = eventActor(row);
  const kind = eventType(row);
  const action = token(row?.accion || meta?.accion || meta?.kind_original);
  const nextState = token(meta?.estado || meta?.estado_nuevo || meta?.nuevo_estado);
  const rawText = text(row?.texto);
  const isSystem = ["sistema", "producto"].includes(actor)
    || ["sistema", "estado", "asignacion", "sla", "cierre", "consolidacion"].includes(kind)
    || /ticket_(?:cread|cierr|cerr|reab|asign|reasign)|prioridad|estado/.test(action);
  if (!isSystem || kind === "nota" || action === "ticket_nota") return null;

  if (/cread/.test(action) || kind === "sistema" && /cread/.test(token(rawText))) {
    return { type: "created", title: "Ticket creado", text: rawText || "Ticket creado." };
  }
  if (/reab/.test(action) || ["reabierto", "abierto"].includes(nextState) && /cierr|cerr/.test(token(meta?.estado_anterior))) {
    return { type: "reopened", title: "Reapertura", text: rawText || "Ticket reabierto." };
  }
  if (/cierr|cerr/.test(action) || kind === "cierre" || ["cerrado", "resuelto"].includes(nextState)) {
    return { type: "closed", title: "Cierre", text: rawText || "Ticket cerrado." };
  }
  if (kind === "asignacion" || /asign|reasign/.test(action)) {
    return { type: "assignment", title: "Asignación", text: rawText || "Asignación actualizada." };
  }
  if (/prioridad/.test(action) || meta?.prioridad != null || meta?.prioridad_nueva != null) {
    const priority = stateLabel(meta?.prioridad_nueva || meta?.prioridad);
    return { type: "priority", title: "Prioridad", text: rawText || (priority ? `Prioridad cambiada a ${priority}.` : "Prioridad actualizada.") };
  }
  if (kind === "estado" || /estado/.test(action) || nextState) {
    const state = stateLabel(nextState);
    return { type: "status", title: "Cambio de estado", text: rawText || (state ? `Estado cambiado a ${state}.` : "Estado actualizado.") };
  }
  return { type: "unknown", title: "Evento del sistema", text: rawText || "El sistema registró una actualización." };
}

export function publicTimelineSystemEvents(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map(row => describeSystemEvent(row, { publicTimeline: true }))
    .filter(Boolean);
}
