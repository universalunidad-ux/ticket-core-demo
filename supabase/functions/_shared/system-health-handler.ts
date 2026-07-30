import { createClient } from "npm:@supabase/supabase-js@2";
import {
  resolveAllowedOrigin,
  safeStructuredLog,
} from "./observability-contract.ts";

const env = (key: string): string => {
  const value = Deno.env.get(key);
  if (!value) throw new Error(`${key}_REQUIRED`);
  return value;
};
const url = env("SUPABASE_URL");
const authClient = createClient(url, env("SUPABASE_ANON_KEY"));
const service = createClient(url, env("SUPABASE_SERVICE_ROLE_KEY"));
const origins = env("CORS_ALLOWED_ORIGINS");

const cors = (origin: string) => ({
  "Access-Control-Allow-Headers": "authorization, x-client-info",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Origin": origin,
  "Content-Type": "application/json",
  "Vary": "Origin",
});
const response = (
  origin: string,
  status: number,
  body: Record<string, unknown>,
) => new Response(JSON.stringify(body), { status, headers: cors(origin) });

export const handler = async (request: Request): Promise<Response> => {
  const started = Date.now();
  const requestId = crypto.randomUUID();
  const origin = resolveAllowedOrigin(request.headers.get("origin"), origins);
  if (!origin) return response("", 403, { ok: false, code: "ORIGIN_NOT_ALLOWED" });
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors(origin) });
  }
  if (request.method !== "GET") {
    return response(origin, 405, { ok: false, code: "METHOD_NOT_ALLOWED" });
  }

  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer ([A-Za-z0-9._~-]{20,4096})$/);
  if (!match) return response(origin, 401, { ok: false, code: "AUTH_REQUIRED" });

  const { data: authData, error: authError } = await authClient.auth.getUser(match[1]);
  if (authError || !authData.user) {
    return response(origin, 401, { ok: false, code: "AUTH_INVALID" });
  }
  const { data: profile, error: profileError } = await service
    .from("perfiles")
    .select("id")
    .eq("id", authData.user.id)
    .eq("rol", "admin")
    .eq("activo", true)
    .maybeSingle();
  if (profileError || !profile) {
    return response(origin, 403, { ok: false, code: "ADMIN_REQUIRED" });
  }

  const { data, error } = await service.rpc("system_health_snapshot");
  if (error || !data) {
    console.error(JSON.stringify(safeStructuredLog({
      event: "system_health_failed",
      level: "error",
      code: "HEALTH_SNAPSHOT_FAILED",
      requestId,
      status: 503,
      durationMs: Date.now() - started,
    })));
    return response(origin, 503, { ok: false, code: "HEALTH_UNAVAILABLE" });
  }

  console.log(JSON.stringify(safeStructuredLog({
    event: "system_health_read",
    level: "info",
    requestId,
    status: 200,
    durationMs: Date.now() - started,
  })));
  return response(origin, 200, { ok: true, health: data });
};

// Prepared handler contract only. A tracked Edge owner must be registered in
// canonical-source.json by a separately authorized adoption change.
