// TC-DEB8FDCC-MEDIA-WORKER-V1-LOCAL-IMPLEMENTATION-28 · Commit B
//
// Contrato puro del worker `media-worker/v1`: tipos, deteccion de firma,
// conciliacion de MIME y derivacion determinista de rutas.
//
// Este modulo no hace red, no lee variables de entorno y no registra nada.
// Todo lo que contiene es determinista y testeable sin Docker.

export const MEDIA_WORKER_VERSION = "media-worker/v1";
export const MEDIA_WORKER_LEASE_SECONDS = 120;
export const MEDIA_WORKER_MAX_JOBS_PER_INVOCATION = 5;
export const MEDIA_WORKER_BUCKET = "soporte_adjuntos";

/** Tope defensivo de descarga. El limite de producto vive en upload-contract. */
export const MEDIA_WORKER_MAX_SOURCE_BYTES = 40 * 1024 * 1024;

export const MEDIA_REVIEW_MAX_EDGE = 1280;
export const MEDIA_THUMBNAIL_MAX_EDGE = 320;

/** Catalogo cerrado, espejo de app_private.tc_media_quarantine_reason_is_valid. */
export const QUARANTINE_REASONS = [
  "MEDIA_SOURCE_CHECKSUM_MISMATCH",
  "MEDIA_SIGNATURE_OR_MIME_REJECTED",
  "MEDIA_DECODE_FAILED",
  "MEDIA_OBJECT_MISSING",
  "MEDIA_SIZE_LIMIT_EXCEEDED",
  "MEDIA_DERIVATIVE_CHECKSUM_CONFLICT",
  "MEDIA_UNSUPPORTED_KIND_PDF",
  "MEDIA_UNSUPPORTED_KIND_VIDEO",
  "MEDIA_JOB_DEAD_LETTER",
] as const;

export type QuarantineReason = typeof QUARANTINE_REASONS[number];

export function isQuarantineReason(value: string): value is QuarantineReason {
  return (QUARANTINE_REASONS as readonly string[]).includes(value);
}

export type DerivativeType =
  | "review_webp"
  | "thumbnail_webp"
  | "pdf_poster_webp"
  | "video_proxy_720p"
  | "video_poster_webp"
  | "video_contact_sheet_webp";

export interface MediaJob {
  job_id: string;
  lease_token: string;
  adjunto_id: string;
  job_tipo: string;
  job_version: string;
  source_checksum_sha256: string;
  intentos: number;
  max_intentos: number;
  bucket_id: string;
  storage_path: string;
  mime_declarado: string;
  mime_detectado: string;
  adjunto_tipo: "image" | "pdf" | "video";
  adjunto_estado: string;
  tamano_bytes: number;
  adjunto_checksum_sha256: string;
}

export interface DerivativePayload {
  tipo: DerivativeType;
  storage_path: string;
  mime_type: string;
  tamano_bytes: number;
  checksum_sha256: string;
  ancho?: number;
  alto?: number;
}

export interface WorkerCounters {
  claimed: number;
  completed: number;
  quarantined: number;
  failed: number;
  empty: boolean;
}

// ---------------------------------------------------------------------------
// Checksum
// ---------------------------------------------------------------------------

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Comparacion en tiempo constante para secretos y checksums. */
export function timingSafeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  // La longitud se filtra igualmente por el tamano del header; se compara
  // sobre el maximo para no cortocircuitar en el primer byte.
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let i = 0; i < length; i += 1) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Firma y MIME
// ---------------------------------------------------------------------------

export type ImageKind = "png" | "jpeg" | "webp";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Detecta el tipo real por bytes magicos. Nunca confia en la extension ni en
 * el MIME declarado por el cliente.
 */
export function detectImageKind(bytes: Uint8Array): ImageKind | null {
  if (bytes.length >= 8 && PNG_SIGNATURE.every((b, i) => bytes[i] === b)) {
    return "png";
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  ) {
    return "jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "webp";
  }
  return null;
}

const MIME_BY_KIND: Record<ImageKind, readonly string[]> = {
  png: ["image/png"],
  jpeg: ["image/jpeg", "image/jpg"],
  webp: ["image/webp"],
};

export function normalizeMime(value: string): string {
  return (value ?? "").split(";")[0].trim().toLowerCase();
}

/**
 * El MIME declarado y el detectado en la subida deben coincidir entre si y con
 * los bytes reales. Cualquier contradiccion es rechazo determinista.
 */
export function mimeAgreesWithBytes(
  kind: ImageKind,
  mimeDeclarado: string,
  mimeDetectado: string,
): boolean {
  const allowed = MIME_BY_KIND[kind];
  const declared = normalizeMime(mimeDeclarado);
  const detected = normalizeMime(mimeDetectado);
  if (!allowed.includes(declared)) return false;
  if (!allowed.includes(detected)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Rutas derivadas deterministas, versionadas e idempotentes
// ---------------------------------------------------------------------------

/**
 * `<prefijo-del-original>/derived/<adjuntoId>.<sha16>.<version>.<tipo>.webp`
 *
 * Determinista: la misma fuente y el mismo tipo producen siempre la misma
 * ruta, de modo que un reintento reutiliza el objeto en vez de duplicarlo.
 */
export function derivativeStoragePath(
  originalStoragePath: string,
  adjuntoId: string,
  sourceChecksumSha256: string,
  tipo: DerivativeType,
): string {
  const prefix = originalStoragePath.split("/")[0];
  if (!prefix || prefix === originalStoragePath) {
    throw new Error("MEDIA_ORIGINAL_PATH_INVALID");
  }
  if (!/^[0-9a-f]{64}$/.test(sourceChecksumSha256)) {
    throw new Error("MEDIA_SOURCE_CHECKSUM_INVALID");
  }
  const shortSha = sourceChecksumSha256.slice(0, 16);
  const version = MEDIA_WORKER_VERSION.replace("/", "-");
  return `${prefix}/derived/${adjuntoId}.${shortSha}.${version}.${tipo}.webp`;
}

// ---------------------------------------------------------------------------
// Redaccion de logs
// ---------------------------------------------------------------------------

const REDACTED = "[redacted]";

/**
 * Solo se permite emitir identificadores opacos y codigos enumerados. Nunca
 * claves, JWT, correos, nombres de archivo ni cuerpos de respuesta.
 */
export function safeLogLine(
  event: string,
  fields: Record<string, string | number | boolean | undefined>,
): string {
  const parts = [`event=${event}`];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    const isOpaque = /^[A-Za-z0-9_.:-]{0,120}$/.test(String(value));
    parts.push(`${key}=${isOpaque ? String(value) : REDACTED}`);
  }
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Autenticacion interna del endpoint
// ---------------------------------------------------------------------------

export type AuthDecision =
  | { ok: true }
  | { ok: false; status: number; code: string };

/** Prefijos de claves publicables de Supabase que jamas deben autenticar aqui. */
const PUBLISHABLE_PREFIXES = ["sb_publishable_", "sbp_"];

function looksLikeJwt(token: string): boolean {
  return /^e[yJ][A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(token);
}

function jwtRole(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
    const parsed = JSON.parse(decoded) as { role?: unknown };
    return typeof parsed.role === "string" ? parsed.role : null;
  } catch {
    return null;
  }
}

/**
 * El endpoint es exclusivamente interno:
 *   * exige el header `x-media-worker-key` con el secreto compartido;
 *   * rechaza anon, claves publicables y JWT de usuario aunque el secreto sea
 *     correcto, para que una credencial de navegador nunca alcance la cola;
 *   * no emite CORS y no acepta preflight.
 */
export function authorizeWorkerRequest(
  headers: Headers,
  configuredSecret: string | undefined,
): AuthDecision {
  if (!configuredSecret || configuredSecret.length < 32) {
    return { ok: false, status: 503, code: "MEDIA_WORKER_NOT_CONFIGURED" };
  }

  const apikey = (headers.get("apikey") ?? "").trim();
  const authorization = (headers.get("authorization") ?? "").trim();
  const bearer = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : "";

  for (const candidate of [apikey, bearer]) {
    if (!candidate) continue;
    if (PUBLISHABLE_PREFIXES.some((p) => candidate.startsWith(p))) {
      return { ok: false, status: 401, code: "MEDIA_WORKER_PUBLISHABLE_KEY_REJECTED" };
    }
    if (looksLikeJwt(candidate)) {
      const role = jwtRole(candidate);
      if (role === "anon" || role === "authenticated") {
        return { ok: false, status: 401, code: "MEDIA_WORKER_USER_JWT_REJECTED" };
      }
    }
  }

  const presented = (headers.get("x-media-worker-key") ?? "").trim();
  if (!presented) {
    return { ok: false, status: 401, code: "MEDIA_WORKER_CREDENTIAL_REQUIRED" };
  }
  if (!timingSafeEqual(presented, configuredSecret)) {
    return { ok: false, status: 401, code: "MEDIA_WORKER_CREDENTIAL_INVALID" };
  }

  // Anti-recursion: una invocacion del worker nunca invoca a otra.
  if (headers.get("x-media-worker-depth")) {
    return { ok: false, status: 400, code: "MEDIA_WORKER_RECURSION_REJECTED" };
  }

  return { ok: true };
}

/** Rechazo determinista, por tipo de adjunto todavia no procesable. */
export function unsupportedKindReason(
  adjuntoTipo: string,
): QuarantineReason | null {
  if (adjuntoTipo === "pdf") return "MEDIA_UNSUPPORTED_KIND_PDF";
  if (adjuntoTipo === "video") return "MEDIA_UNSUPPORTED_KIND_VIDEO";
  return null;
}
