import { createClient } from "npm:@supabase/supabase-js@2";
import { rateLimit } from "./rate-limit.ts";
import {
  errorFingerprint,
  parseClientErrorEvent,
  resolveAllowedOrigin,
  safeStructuredLog,
} from "./observability-contract.ts";

const env = (key: string): string => {
  const value = Deno.env.get(key);
  if (!value) throw new Error(`${key}_REQUIRED`);
  return value;
};
const service = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
const origins = env("CORS_ALLOWED_ORIGINS");
const MAX_BODY_BYTES = 16 * 1024;

const cors = (origin: string) => ({
  "Access-Control-Allow-Headers": "content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": origin,
  "Content-Type": "application/json",
  "Vary": "Origin",
});
const response = (origin: string, status: number, code: string) =>
  new Response(JSON.stringify({ ok: false, code }), {
    status,
    headers: cors(origin),
  });
const clientKey = (request: Request) =>
  (request.headers.get("cf-connecting-ip")
    || request.headers.get("x-forwarded-for")
    || request.headers.get("x-real-ip")
    || "unknown").split(",")[0].trim();

export const handler = async (request: Request): Promise<Response> => {
  const started = Date.now();
  const requestId = crypto.randomUUID();
  const origin = resolveAllowedOrigin(request.headers.get("origin"), origins);
  if (!origin) return response("", 403, "ORIGIN_NOT_ALLOWED");
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors(origin) });
  }
  if (request.method !== "POST") return response(origin, 405, "METHOD_NOT_ALLOWED");

  const declared = Number(request.headers.get("content-length") || "0");
  if (!Number.isSafeInteger(declared) || declared < 0 || declared > MAX_BODY_BYTES) {
    return response(origin, 413, "BODY_TOO_LARGE");
  }
  if (!(await rateLimit(service, "report_client_error", clientKey(request), 20, 10))) {
    return response(origin, 429, "RATE_LIMITED");
  }

  let text = "";
  try {
    text = await request.text();
  } catch {
    return response(origin, 400, "BODY_UNREADABLE");
  }
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    return response(origin, 413, "BODY_TOO_LARGE");
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return response(origin, 400, "JSON_INVALID");
  }
  const parsed = parseClientErrorEvent(raw);
  if (!parsed.ok) return response(origin, 400, parsed.code);

  const fingerprint = await errorFingerprint(parsed.value);
  const { error } = await service.rpc("record_client_error", {
    p_fingerprint: fingerprint,
    p_source: parsed.value.source,
    p_severity: parsed.value.severity,
    p_code: parsed.value.code,
    p_route: parsed.value.route,
    p_release: parsed.value.release,
    p_request_id: parsed.value.requestId,
    p_context: parsed.value.context,
  });
  if (error) {
    console.error(JSON.stringify(safeStructuredLog({
      event: "client_error_persist_failed",
      level: "error",
      code: "ERROR_EVENT_PERSIST_FAILED",
      requestId,
      status: 503,
      durationMs: Date.now() - started,
    })));
    return response(origin, 503, "EVENT_UNAVAILABLE");
  }

  console.log(JSON.stringify(safeStructuredLog({
    event: "client_error_recorded",
    level: "info",
    code: parsed.value.code,
    requestId,
    status: 202,
    durationMs: Date.now() - started,
  })));
  return new Response(JSON.stringify({ ok: true, status: "accepted" }), {
    status: 202,
    headers: cors(origin),
  });
};

// Prepared handler contract only. A tracked Edge owner must be registered in
// canonical-source.json by a separately authorized adoption change.
