import {
  isSupportAffected,
  isSupportCategory,
  isSupportChannel,
  isSupportImpact,
  isSupportLastChange,
  parseSupportSystem,
  type SupportAffected,
  type SupportCategory,
  type SupportChannel,
  type SupportImpact,
  type SupportLastChange,
} from "./support-catalog.ts";
import { sha256Hex } from "./security-primitives.ts";
import type { ValidatedAttachment } from "./upload-contract.ts";

export const PUBLIC_SUPPORT_FIELDS = [
  "nombre", "empresa", "correo", "telefono", "categoria", "sistema", "objetivo",
  "titulo", "descripcion", "impacto", "canal", "desde_cuando", "afecta_a",
  "cambio_previo", "horario_disponible", "horario_desde", "horario_hasta",
  "horario_notas", "contexto_extra", "remote_access",
] as const;

export const REQUIRED_PUBLIC_SUPPORT_FIELDS = [
  "nombre", "correo", "telefono", "categoria", "sistema", "titulo", "descripcion",
  "impacto", "canal", "afecta_a",
] as const;

export const SERVER_OWNED_FIELDS = [
  "actualizado_en", "archivos_count", "asignado_a", "cliente_id", "cliente_id_confirmado",
  "cliente_id_sugerido", "contacto_confirmado", "contacto_es_nuevo", "contacto_id",
  "contacto_id_confirmado", "contacto_id_sugerido", "empresa_confirmada", "estado",
  "estatus", "evidencia_count", "fecha_actualizacion", "folio", "id", "match_confirmado",
  "match_nivel", "match_score", "origen", "prioridad", "requiere_consolidacion",
  "sla_breached_first_response", "sla_breached_resolution", "sla_first_response_deadline",
  "sla_policy", "sla_resolution_deadline", "solicitud_id", "solicitud_soporte_id", "status",
  "ticket_id", "timeline_publica", "token_publico", "token_publico_expira", "total_peso",
] as const;

export const SUPPORT_CANONICAL_VERSION = "support-submit/v1" as const;

export type PublicSupportField = typeof PUBLIC_SUPPORT_FIELDS[number];
export type ServerOwnedField = typeof SERVER_OWNED_FIELDS[number];
export type SupportErrorCode =
  | "DTO_NOT_PLAIN_OBJECT" | "DTO_UNKNOWN_PROPERTY" | "DTO_SERVER_OWNED_PROPERTY"
  | "DTO_MISSING_PROPERTY" | "DTO_INVALID_TYPE" | "DTO_TEXT_EMPTY"
  | "DTO_TEXT_TOO_SHORT" | "DTO_TEXT_TOO_LONG" | "DTO_TEXT_CONTROL_CHAR"
  | "DTO_CATEGORY_INVALID" | "DTO_IMPACT_INVALID" | "DTO_SYSTEM_INVALID"
  | "DTO_EMAIL_INVALID" | "DTO_PHONE_INVALID" | "DTO_CHANNEL_INVALID"
  | "DTO_AFFECTS_INVALID" | "DTO_LAST_CHANGE_INVALID" | "DTO_TIME_INVALID"
  | "DTO_TIME_PAIR_REQUIRED" | "DTO_TIME_SUMMARY_MISMATCH";
export type SupportIssue = Readonly<{ code: SupportErrorCode; field?: string }>;

export type PublicSupportDto = Readonly<{
  nombre: string; empresa: string | null; correo: string; telefono: string;
  categoria: SupportCategory; sistema: string; objetivo: string; titulo: string;
  descripcion: string; impacto: SupportImpact; canal: SupportChannel;
  desde_cuando: string; afecta_a: SupportAffected; cambio_previo: SupportLastChange;
  horario_disponible: string; horario_desde: string | null; horario_hasta: string | null;
  horario_notas: string | null; contexto_extra: string; remote_access: string;
}>;
export type SupportParseResult = Readonly<{ ok: true; value: PublicSupportDto }> | Readonly<{ ok: false; issues: readonly SupportIssue[] }>;
export type CanonicalSupportSubmission = Readonly<{
  version: typeof SUPPORT_CANONICAL_VERSION;
  dto: PublicSupportDto;
  attachments: readonly ValidatedAttachment[];
}>;

export const SUPPORT_ERROR_CODES: readonly SupportErrorCode[] = Object.freeze([
  "DTO_NOT_PLAIN_OBJECT", "DTO_UNKNOWN_PROPERTY", "DTO_SERVER_OWNED_PROPERTY",
  "DTO_MISSING_PROPERTY", "DTO_INVALID_TYPE", "DTO_TEXT_EMPTY", "DTO_TEXT_TOO_SHORT",
  "DTO_TEXT_TOO_LONG", "DTO_TEXT_CONTROL_CHAR", "DTO_CATEGORY_INVALID",
  "DTO_IMPACT_INVALID", "DTO_SYSTEM_INVALID", "DTO_EMAIL_INVALID", "DTO_PHONE_INVALID",
  "DTO_CHANNEL_INVALID", "DTO_AFFECTS_INVALID", "DTO_LAST_CHANGE_INVALID",
  "DTO_TIME_INVALID", "DTO_TIME_PAIR_REQUIRED", "DTO_TIME_SUMMARY_MISMATCH",
]);

const publicFields = new Set<string>(PUBLIC_SUPPORT_FIELDS);
const serverOwnedFields = new Set<string>(SERVER_OWNED_FIELDS);
const CONTROL_RE = /[\u0000-\u001f\u007f]/u;
const MULTILINE_CONTROL_RE = /[\u0000-\u0009\u000b-\u001f\u007f]/u;
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

function frozenIssue(code: SupportErrorCode, field?: string): SupportIssue {
  return Object.freeze({ code, ...(field ? { field } : {}) });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeSingleLine(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function normalizeMultiline(value: string): string {
  return value.normalize("NFKC").replaceAll("\r\n", "\n").trim();
}

function textValue(
  raw: unknown,
  field: PublicSupportField,
  issues: SupportIssue[],
  options: { min?: number; max: number; empty?: boolean; nullable?: boolean; multiline?: boolean },
): string | null {
  if (raw === null && options.nullable) return null;
  if (typeof raw !== "string") {
    issues.push(frozenIssue("DTO_INVALID_TYPE", field));
    return null;
  }
  const controlRe = options.multiline ? MULTILINE_CONTROL_RE : CONTROL_RE;
  const controlInput = options.multiline ? raw.replaceAll("\r\n", "\n") : raw;
  if (controlRe.test(controlInput)) {
    issues.push(frozenIssue("DTO_TEXT_CONTROL_CHAR", field));
    return null;
  }
  const normalized = options.multiline ? normalizeMultiline(raw) : normalizeSingleLine(raw);
  if (normalized.length === 0 && options.empty) return "";
  if (normalized.length === 0) {
    issues.push(frozenIssue("DTO_TEXT_EMPTY", field));
    return null;
  }
  if (options.min !== undefined && normalized.length < options.min) {
    issues.push(frozenIssue("DTO_TEXT_TOO_SHORT", field));
    return null;
  }
  if (normalized.length > options.max) {
    issues.push(frozenIssue("DTO_TEXT_TOO_LONG", field));
    return null;
  }
  return normalized;
}

function parseEmail(raw: unknown, issues: SupportIssue[]): string | null {
  if (typeof raw !== "string") {
    issues.push(frozenIssue("DTO_INVALID_TYPE", "correo"));
    return null;
  }
  const email = raw.normalize("NFKC").toLowerCase();
  const parts = email.split("@");
  const local = parts[0] || "";
  const domain = parts[1] || "";
  const labels = domain.split(".");
  const localOk = local.length >= 1 && local.length <= 64
    && /^[a-z0-9!#$%&'*+/=?^_`{|}~.-]+$/u.test(local)
    && !local.startsWith(".") && !local.endsWith(".") && !local.includes("..");
  const domainOk = labels.length >= 2 && labels.every((label) =>
    label.length >= 1 && label.length <= 63
    && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label)
  );
  if (raw !== raw.trim() || email.length < 3 || email.length > 120 || parts.length !== 2 || !/^[\x00-\x7f]+$/u.test(email) || !localOk || !domainOk) {
    issues.push(frozenIssue("DTO_EMAIL_INVALID", "correo"));
    return null;
  }
  return email;
}

function parsePhone(raw: unknown, issues: SupportIssue[]): string | null {
  if (typeof raw !== "string") {
    issues.push(frozenIssue("DTO_INVALID_TYPE", "telefono"));
    return null;
  }
  if (!/^\d{10}$/u.test(raw)) {
    issues.push(frozenIssue("DTO_PHONE_INVALID", "telefono"));
    return null;
  }
  return raw;
}

export function parsePublicSupportDto(input: unknown): SupportParseResult {
  if (!isPlainObject(input)) {
    return Object.freeze({ ok: false, issues: Object.freeze([frozenIssue("DTO_NOT_PLAIN_OBJECT")]) });
  }

  const issues: SupportIssue[] = [];
  const keys = Object.keys(input);
  const unknownKeys = keys.filter((key) => !publicFields.has(key) && !serverOwnedFields.has(key)).sort();
  const ownedKeys = keys.filter((key) => serverOwnedFields.has(key)).sort();
  if (unknownKeys.length > 0) {
    for (const key of unknownKeys) issues.push(frozenIssue("DTO_UNKNOWN_PROPERTY", key));
  }
  if (ownedKeys.length > 0) {
    for (const key of ownedKeys) issues.push(frozenIssue("DTO_SERVER_OWNED_PROPERTY", key));
  }
  for (const field of REQUIRED_PUBLIC_SUPPORT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(input, field)) issues.push(frozenIssue("DTO_MISSING_PROPERTY", field));
  }

  const value: Record<string, unknown> = {};
  const read = (field: PublicSupportField, fallback: unknown) => Object.prototype.hasOwnProperty.call(input, field) ? input[field] : fallback;

  for (const field of PUBLIC_SUPPORT_FIELDS) {
    if (REQUIRED_PUBLIC_SUPPORT_FIELDS.includes(field as typeof REQUIRED_PUBLIC_SUPPORT_FIELDS[number]) && !Object.prototype.hasOwnProperty.call(input, field)) continue;
    const raw = read(field,
      field === "empresa" || field === "horario_desde" || field === "horario_hasta" || field === "horario_notas" ? null : "");
    switch (field) {
      case "nombre": value[field] = textValue(raw, field, issues, { min: 2, max: 80 }); break;
      case "empresa": value[field] = textValue(raw, field, issues, { max: 160, nullable: true }); break;
      case "correo": value[field] = parseEmail(raw, issues); break;
      case "telefono": value[field] = parsePhone(raw, issues); break;
      case "categoria":
        if (typeof raw !== "string") issues.push(frozenIssue("DTO_INVALID_TYPE", field));
        else if (!isSupportCategory(raw)) issues.push(frozenIssue("DTO_CATEGORY_INVALID", field));
        else value[field] = raw;
        break;
      case "sistema": {
        if (typeof raw !== "string") issues.push(frozenIssue("DTO_INVALID_TYPE", field));
        else if (raw.length === 0) issues.push(frozenIssue("DTO_TEXT_EMPTY", field));
        else {
          const system = parseSupportSystem(raw);
          if (!system) issues.push(frozenIssue("DTO_SYSTEM_INVALID", field));
          else value[field] = system.label;
        }
        break;
      }
      case "objetivo": value[field] = textValue(raw, field, issues, { max: 300, empty: true }); break;
      case "titulo": value[field] = textValue(raw, field, issues, { min: 6, max: 120 }); break;
      case "descripcion": value[field] = textValue(raw, field, issues, { min: 20, max: 3000, multiline: true }); break;
      case "impacto":
        if (typeof raw !== "string") issues.push(frozenIssue("DTO_INVALID_TYPE", field));
        else if (!isSupportImpact(raw)) issues.push(frozenIssue("DTO_IMPACT_INVALID", field));
        else value[field] = raw;
        break;
      case "canal":
        if (typeof raw !== "string") issues.push(frozenIssue("DTO_INVALID_TYPE", field));
        else if (!isSupportChannel(raw)) issues.push(frozenIssue("DTO_CHANNEL_INVALID", field));
        else value[field] = raw;
        break;
      case "desde_cuando": value[field] = textValue(raw, field, issues, { max: 160, empty: true }); break;
      case "afecta_a":
        if (typeof raw !== "string") issues.push(frozenIssue("DTO_INVALID_TYPE", field));
        else if (!isSupportAffected(raw)) issues.push(frozenIssue("DTO_AFFECTS_INVALID", field));
        else value[field] = raw;
        break;
      case "cambio_previo":
        if (typeof raw !== "string") issues.push(frozenIssue("DTO_INVALID_TYPE", field));
        else if (!isSupportLastChange(raw)) issues.push(frozenIssue("DTO_LAST_CHANGE_INVALID", field));
        else value[field] = raw;
        break;
      case "horario_disponible": value[field] = textValue(raw, field, issues, { max: 160, empty: true, multiline: true }); break;
      case "horario_desde":
      case "horario_hasta":
        if (raw === null) value[field] = null;
        else if (typeof raw !== "string") issues.push(frozenIssue("DTO_INVALID_TYPE", field));
        else if (!TIME_RE.test(raw)) issues.push(frozenIssue("DTO_TIME_INVALID", field));
        else value[field] = raw;
        break;
      case "horario_notas": value[field] = textValue(raw, field, issues, { max: 140, empty: true, nullable: true, multiline: true }); break;
      case "contexto_extra": value[field] = textValue(raw, field, issues, { max: 3000, empty: true, multiline: true }); break;
      case "remote_access": value[field] = textValue(raw, field, issues, { max: 120, empty: true }); break;
    }
  }

  const from = value.horario_desde as string | null | undefined;
  const to = value.horario_hasta as string | null | undefined;
  const notes = value.horario_notas as string | null | undefined;
  const summary = value.horario_disponible as string | undefined;
  if ((from === null) !== (to === null) || (notes !== null && notes !== "" && from === null)) {
    issues.push(frozenIssue("DTO_TIME_PAIR_REQUIRED", "horario_desde"));
  } else if (from && to) {
    const expected = `${from}–${to}${notes ? ` · ${notes}` : ""}`;
    if (summary !== expected) issues.push(frozenIssue("DTO_TIME_SUMMARY_MISMATCH", "horario_disponible"));
  } else if (summary !== "") {
    issues.push(frozenIssue("DTO_TIME_SUMMARY_MISMATCH", "horario_disponible"));
  }

  if (issues.length > 0) return Object.freeze({ ok: false, issues: Object.freeze(issues) });
  return Object.freeze({ ok: true, value: Object.freeze(value) as PublicSupportDto });
}

function orderedDto(dto: PublicSupportDto): PublicSupportDto {
  return Object.freeze({
    nombre: dto.nombre, empresa: dto.empresa, correo: dto.correo, telefono: dto.telefono,
    categoria: dto.categoria, sistema: dto.sistema, objetivo: dto.objetivo, titulo: dto.titulo,
    descripcion: dto.descripcion, impacto: dto.impacto, canal: dto.canal,
    desde_cuando: dto.desde_cuando, afecta_a: dto.afecta_a, cambio_previo: dto.cambio_previo,
    horario_disponible: dto.horario_disponible, horario_desde: dto.horario_desde,
    horario_hasta: dto.horario_hasta, horario_notas: dto.horario_notas,
    contexto_extra: dto.contexto_extra, remote_access: dto.remote_access,
  });
}

function orderedAttachment(attachment: ValidatedAttachment): ValidatedAttachment {
  return Object.freeze({
    normalizedName: attachment.normalizedName, extension: attachment.extension,
    mimeType: attachment.mimeType, detectedType: attachment.detectedType,
    category: attachment.category, size: attachment.size, contentSha256: attachment.contentSha256,
  });
}

export function canonicalSupportSubmission(dto: PublicSupportDto, attachments: readonly ValidatedAttachment[]): CanonicalSupportSubmission {
  const compareText = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
  const orderedAttachments = attachments.map(orderedAttachment).sort((left, right) =>
    compareText(left.contentSha256, right.contentSha256)
    || compareText(left.normalizedName, right.normalizedName)
    || left.size - right.size
    || compareText(left.mimeType, right.mimeType)
  );
  return Object.freeze({
    version: SUPPORT_CANONICAL_VERSION,
    dto: orderedDto(dto),
    attachments: Object.freeze(orderedAttachments),
  });
}

export function serializeCanonicalSupportSubmission(value: CanonicalSupportSubmission): string {
  const canonical = canonicalSupportSubmission(value.dto, value.attachments);
  return JSON.stringify({
    version: canonical.version,
    dto: canonical.dto,
    attachments: canonical.attachments,
  });
}

export async function fingerprintSupportSubmission(dto: PublicSupportDto, attachments: readonly ValidatedAttachment[]): Promise<string> {
  return sha256Hex(serializeCanonicalSupportSubmission(canonicalSupportSubmission(dto, attachments)));
}
