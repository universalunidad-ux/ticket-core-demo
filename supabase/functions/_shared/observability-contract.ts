export type ErrorSeverity = "warning" | "error" | "critical";

export type ClientErrorEvent = Readonly<{
  source: "browser";
  severity: ErrorSeverity;
  code: string;
  route: string | null;
  release: string | null;
  requestId: string;
  context: Readonly<Record<string, string | number | boolean>>;
}>;

type ContractResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; code: string }>;

const EVENT_KEYS = new Set([
  "code",
  "context",
  "release",
  "requestId",
  "route",
  "severity",
]);
const CONTEXT_KEYS = new Set([
  "component",
  "http_status",
  "online",
  "operation",
  "retryable",
  "viewport_bucket",
]);
const BLOCKED_KEY = /(authorization|cookie|credential|email|message|name|password|payload|phone|secret|stack|token|url_firma)/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODE = /^[A-Z0-9_]{3,80}$/;

const plainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null
  && typeof value === "object"
  && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;

const boundedText = (value: unknown, max: number): string | null => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 && text.length <= max ? text : null;
};

export function parseClientErrorEvent(value: unknown): ContractResult<ClientErrorEvent> {
  if (!plainObject(value)) return { ok: false, code: "EVENT_NOT_OBJECT" };
  if (Object.keys(value).some((key) => !EVENT_KEYS.has(key) || BLOCKED_KEY.test(key))) {
    return { ok: false, code: "EVENT_KEY_FORBIDDEN" };
  }
  if (!CODE.test(String(value.code || ""))) {
    return { ok: false, code: "EVENT_CODE_INVALID" };
  }
  if (!["warning", "error", "critical"].includes(String(value.severity || ""))) {
    return { ok: false, code: "EVENT_SEVERITY_INVALID" };
  }
  if (!UUID.test(String(value.requestId || ""))) {
    return { ok: false, code: "EVENT_REQUEST_ID_INVALID" };
  }

  const route = boundedText(value.route, 240);
  if (value.route !== null && value.route !== undefined && value.route !== "" && route === null) {
    return { ok: false, code: "EVENT_ROUTE_INVALID" };
  }
  const release = boundedText(value.release, 120);
  if (value.release !== null && value.release !== undefined && value.release !== "" && release === null) {
    return { ok: false, code: "EVENT_RELEASE_INVALID" };
  }

  const rawContext = value.context ?? {};
  if (!plainObject(rawContext)) return { ok: false, code: "EVENT_CONTEXT_INVALID" };
  const context: Record<string, string | number | boolean> = {};
  for (const [key, item] of Object.entries(rawContext)) {
    if (!CONTEXT_KEYS.has(key) || BLOCKED_KEY.test(key)) {
      return { ok: false, code: "EVENT_CONTEXT_KEY_FORBIDDEN" };
    }
    if (!["string", "number", "boolean"].includes(typeof item)) {
      return { ok: false, code: "EVENT_CONTEXT_VALUE_INVALID" };
    }
    if (typeof item === "string" && item.length > 120) {
      return { ok: false, code: "EVENT_CONTEXT_VALUE_INVALID" };
    }
    if (typeof item === "number" && !Number.isFinite(item)) {
      return { ok: false, code: "EVENT_CONTEXT_VALUE_INVALID" };
    }
    context[key] = item as string | number | boolean;
  }

  return {
    ok: true,
    value: Object.freeze({
      source: "browser",
      severity: value.severity as ErrorSeverity,
      code: String(value.code),
      route,
      release,
      requestId: String(value.requestId).toLowerCase(),
      context: Object.freeze(context),
    }),
  };
}

export async function errorFingerprint(event: ClientErrorEvent): Promise<string> {
  const stable = `${event.source}\n${event.code}\n${event.route || ""}\n${event.release || ""}`;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(stable),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function safeStructuredLog(input: {
  event: string;
  level: "info" | "warn" | "error";
  code?: string;
  requestId: string;
  status?: number;
  durationMs?: number;
}): Readonly<Record<string, string | number>> {
  if (!/^[a-z0-9_]{3,80}$/.test(input.event)) throw new Error("LOG_EVENT_INVALID");
  if (!UUID.test(input.requestId)) throw new Error("LOG_REQUEST_ID_INVALID");
  const output: Record<string, string | number> = {
    event: input.event,
    level: input.level,
    request_id: input.requestId.toLowerCase(),
  };
  if (input.code && CODE.test(input.code)) output.code = input.code;
  if (Number.isInteger(input.status) && input.status! >= 100 && input.status! <= 599) {
    output.status = input.status!;
  }
  if (Number.isFinite(input.durationMs) && input.durationMs! >= 0) {
    output.duration_ms = Math.round(input.durationMs!);
  }
  return Object.freeze(output);
}

export function resolveAllowedOrigin(origin: string | null, rawAllowlist: string): string {
  const normalized = String(origin || "").trim().replace(/\/+$/, "");
  if (!normalized || normalized === "null") return "";
  const allowlist = new Set(
    rawAllowlist.split(",")
      .map((item) => item.trim().replace(/\/+$/, ""))
      .filter((item) => /^https:\/\/[^/]+(?::\d+)?$/.test(item)),
  );
  return allowlist.has(normalized) ? normalized : "";
}
