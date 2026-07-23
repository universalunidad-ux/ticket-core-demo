export const SUPPORT_TURNSTILE_ACTION = "support_submit" as const;
export const TURNSTILE_TOKEN_MAX_LENGTH = 2048;
export const TURNSTILE_MAX_AGE_MS = 300_000;
export const TURNSTILE_CLOCK_SKEW_MS = 30_000;
export const TURNSTILE_FETCH_TIMEOUT_MS = 5_000;

export type SupportRequestErrorCode =
  | "ORIGIN_REQUIRED" | "ORIGIN_NOT_ALLOWED"
  | "CONTENT_TYPE_REQUIRED" | "CONTENT_TYPE_UNSUPPORTED"
  | "MULTIPART_BOUNDARY_REQUIRED" | "MULTIPART_BOUNDARY_INVALID"
  | "CONTENT_ENCODING_UNSUPPORTED" | "CONTENT_LENGTH_INVALID"
  | "BODY_TOO_LARGE" | "BODY_READ_FAILED"
  | "MULTIPART_INVALID" | "MULTIPART_FIELDS_INVALID"
  | "PAYLOAD_TOO_LARGE" | "PAYLOAD_JSON_INVALID"
  | "TURNSTILE_TOKEN_INVALID" | "TURNSTILE_RESPONSE_INVALID"
  | "TURNSTILE_REJECTED" | "TURNSTILE_HOSTNAME_MISMATCH"
  | "TURNSTILE_ACTION_MISMATCH" | "TURNSTILE_TIMESTAMP_INVALID"
  | "TURNSTILE_EXPIRED" | "TURNSTILE_UNAVAILABLE";

export type ContractResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; code: SupportRequestErrorCode }>;

const ok = <T>(value: T): ContractResult<T> => Object.freeze({ ok: true, value });
const fail = <T>(code: SupportRequestErrorCode): ContractResult<T> => Object.freeze({ ok: false, code });
const BOUNDARY_RE = /^[A-Za-z0-9'()+_,./:=?-]{1,70}$/u;
const CONTENT_LENGTH_RE = /^(?:0|[1-9][0-9]*)$/u;

export function inspectSupportRequestHeaders(
  headers: Headers,
  allowedOrigins: ReadonlySet<string>,
  maxBodyBytes: number,
): ContractResult<Readonly<{ origin: string; hostname: string; contentType: string; boundary: string }>> {
  const origin = headers.get("origin");
  if (!origin) return fail("ORIGIN_REQUIRED");
  if (!allowedOrigins.has(origin)) return fail("ORIGIN_NOT_ALLOWED");
  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    return fail("ORIGIN_NOT_ALLOWED");
  }
  if (!["http:", "https:"].includes(parsedOrigin.protocol) || parsedOrigin.origin !== origin) {
    return fail("ORIGIN_NOT_ALLOWED");
  }

  const contentType = headers.get("content-type");
  if (!contentType) return fail("CONTENT_TYPE_REQUIRED");
  const parts = contentType.split(";").map((part) => part.trim());
  if (parts.shift()?.toLowerCase() !== "multipart/form-data") return fail("CONTENT_TYPE_UNSUPPORTED");
  const boundaryValues: string[] = [];
  for (const parameter of parts) {
    const equal = parameter.indexOf("=");
    if (equal <= 0 || parameter.slice(0, equal).trim().toLowerCase() !== "boundary") {
      return fail("MULTIPART_BOUNDARY_INVALID");
    }
    boundaryValues.push(parameter.slice(equal + 1).trim());
  }
  if (boundaryValues.length === 0) return fail("MULTIPART_BOUNDARY_REQUIRED");
  if (boundaryValues.length !== 1) return fail("MULTIPART_BOUNDARY_INVALID");
  let boundary = boundaryValues[0];
  if (boundary.startsWith('"') || boundary.endsWith('"')) {
    if (!(boundary.length >= 2 && boundary.startsWith('"') && boundary.endsWith('"'))) {
      return fail("MULTIPART_BOUNDARY_INVALID");
    }
    boundary = boundary.slice(1, -1);
  }
  if (!BOUNDARY_RE.test(boundary)) return fail("MULTIPART_BOUNDARY_INVALID");

  const encoding = headers.get("content-encoding");
  if (encoding !== null && encoding.trim().toLowerCase() !== "identity") {
    return fail("CONTENT_ENCODING_UNSUPPORTED");
  }
  const contentLength = headers.get("content-length");
  if (contentLength !== null) {
    if (!CONTENT_LENGTH_RE.test(contentLength)) return fail("CONTENT_LENGTH_INVALID");
    const declared = Number(contentLength);
    if (!Number.isSafeInteger(declared)) return fail("CONTENT_LENGTH_INVALID");
    if (declared > maxBodyBytes) return fail("BODY_TOO_LARGE");
  }
  return ok(Object.freeze({ origin, hostname: parsedOrigin.hostname, contentType, boundary }));
}

export async function readBoundedRequestBody(
  body: ReadableStream<Uint8Array> | null,
  maxBodyBytes: number,
): Promise<ContractResult<Uint8Array>> {
  if (!body) return ok(new Uint8Array());
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new TypeError("request body chunk is not Uint8Array");
      total += value.byteLength;
      if (total > maxBodyBytes) {
        await reader.cancel("BODY_TOO_LARGE").catch(() => undefined);
        return fail("BODY_TOO_LARGE");
      }
      chunks.push(value);
    }
  } catch {
    await reader.cancel("BODY_READ_FAILED").catch(() => undefined);
    return fail("BODY_READ_FAILED");
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return ok(bytes);
}

export async function parseSupportMultipartBody(
  bytes: Uint8Array,
  contentType: string,
): Promise<ContractResult<Readonly<{
  payload: string;
  turnstileToken: string;
  files: readonly File[];
  honeypot: string;
}>>> {
  let form: FormData;
  try {
    const boundedRequest = new Request("http://support-request.local/", {
      method: "POST",
      headers: { "content-type": contentType },
      body: bytes,
    });
    form = await boundedRequest.formData();
  } catch {
    return fail("MULTIPART_INVALID");
  }

  let payload = "";
  let turnstileToken = "";
  let payloadSeen = false;
  let tokenSeen = false;
  const honeypots = new Map<string, string>();
  const indexedFiles = new Map<number, File>();
  for (const [name, value] of form.entries()) {
    if (name === "payload") {
      if (payloadSeen || typeof value !== "string") return fail("MULTIPART_FIELDS_INVALID");
      payloadSeen = true;
      payload = value;
      continue;
    }
    if (name === "turnstile_token") {
      if (tokenSeen || typeof value !== "string") return fail("MULTIPART_FIELDS_INVALID");
      tokenSeen = true;
      turnstileToken = value;
      continue;
    }
    if (name === "website" || name === "hp_field") {
      if (honeypots.has(name) || typeof value !== "string") return fail("MULTIPART_FIELDS_INVALID");
      honeypots.set(name, value);
      continue;
    }
    const match = /^file_([0-4])$/u.exec(name);
    if (!match || typeof value === "string" || indexedFiles.has(Number(match[1]))) {
      return fail("MULTIPART_FIELDS_INVALID");
    }
    indexedFiles.set(Number(match[1]), value);
  }
  if (!payloadSeen || !tokenSeen) return fail("MULTIPART_FIELDS_INVALID");
  const indexes = [...indexedFiles.keys()].sort((left, right) => left - right);
  if (indexes.some((index, position) => index !== position)) return fail("MULTIPART_FIELDS_INVALID");
  return ok(Object.freeze({
    payload,
    turnstileToken,
    files: Object.freeze(indexes.map((index) => indexedFiles.get(index) as File)),
    honeypot: [...honeypots.values()].join("").trim(),
  }));
}

export function validateTurnstileSiteverify(
  input: unknown,
  expected: Readonly<{ hostname: string; action: typeof SUPPORT_TURNSTILE_ACTION; nowMs: number }>,
): ContractResult<Readonly<{ challengeTs: string; hostname: string; action: string }>> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return fail("TURNSTILE_RESPONSE_INVALID");
  }
  const response = input as Record<string, unknown>;
  if (response.success !== true) return fail("TURNSTILE_REJECTED");
  if (typeof response.hostname !== "string" || response.hostname !== expected.hostname) {
    return fail("TURNSTILE_HOSTNAME_MISMATCH");
  }
  if (typeof response.action !== "string" || response.action !== expected.action) {
    return fail("TURNSTILE_ACTION_MISMATCH");
  }
  if (typeof response.challenge_ts !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(response.challenge_ts)) {
    return fail("TURNSTILE_TIMESTAMP_INVALID");
  }
  const challengeMs = Date.parse(response.challenge_ts);
  if (!Number.isFinite(challengeMs) || !Number.isFinite(expected.nowMs)) return fail("TURNSTILE_TIMESTAMP_INVALID");
  if (challengeMs - expected.nowMs > TURNSTILE_CLOCK_SKEW_MS) return fail("TURNSTILE_TIMESTAMP_INVALID");
  if (expected.nowMs - challengeMs > TURNSTILE_MAX_AGE_MS) return fail("TURNSTILE_EXPIRED");
  return ok(Object.freeze({
    challengeTs: response.challenge_ts,
    hostname: response.hostname,
    action: response.action,
  }));
}
