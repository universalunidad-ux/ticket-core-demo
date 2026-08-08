import {
  SUPPORT_TURNSTILE_ACTION,
  inspectSupportRequestHeaders,
  parseSupportMultipartBody,
  readBoundedRequestBody,
  validateTurnstileSiteverify,
} from "./support-request-contract.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("request envelope exige Origin, multipart exacto y boundary", () => {
  const headers = new Headers({
    origin: "https://allowed.example",
    "content-type": 'Multipart/Form-Data; boundary="safe_1"',
    "content-encoding": "identity",
  });
  const result = inspectSupportRequestHeaders(headers, new Set(["https://allowed.example"]), 1024);
  assert(result.ok && result.value.boundary === "safe_1", JSON.stringify(result));
});

Deno.test("request body aplica el límite real del stream", async () => {
  const result = await readBoundedRequestBody(new Blob(["12345"]).stream(), 4);
  assert(!result.ok && result.code === "BODY_TOO_LARGE", JSON.stringify(result));
});

Deno.test("multipart cerrado conserva archivos contiguos", async () => {
  const form = new FormData();
  form.append("payload", "{}");
  form.append("turnstile_token", "token");
  form.append("file_0", new Blob(["x"], { type: "image/jpeg" }), "x.jpg");
  const request = new Request("http://multipart.local/", { method: "POST", body: form });
  const result = await parseSupportMultipartBody(
    new Uint8Array(await request.arrayBuffer()),
    request.headers.get("content-type") || "",
  );
  assert(result.ok && result.value.files.length === 1, JSON.stringify(result));
});

Deno.test("Siteverify exige hostname action y timestamp", () => {
  const nowMs = Date.now();
  const result = validateTurnstileSiteverify({
    success: true,
    hostname: "allowed.example",
    action: SUPPORT_TURNSTILE_ACTION,
    challenge_ts: new Date(nowMs).toISOString(),
  }, { hostname: "allowed.example", action: SUPPORT_TURNSTILE_ACTION, nowMs });
  assert(result.ok, JSON.stringify(result));
});
