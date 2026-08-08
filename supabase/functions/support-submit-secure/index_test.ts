// Pruebas del handler (deno test). Cubren respuestas tempranas y Siteverify
// con fetch stub; nunca realizan I/O de red ni de BD.
const assertEquals = (actual: unknown, expected: unknown) => {
  if (!Object.is(actual, expected)) throw new Error(`expected=${expected} actual=${actual}`);
};

// Env mínima para carga del módulo (no se realiza I/O en estas rutas).
Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test");
Deno.env.set("ENVIRONMENT", "development");
Deno.env.set("CORS_ALLOWED_ORIGINS", "https://allowed.example");
Deno.env.set("REQUIRE_TURNSTILE", "true");
Deno.env.set("TURNSTILE_SECRET", "test-secret");

const { handler } = await import("./index.ts");
const U = "http://localhost/functions/v1/support-submit-secure";

Deno.test("OPTIONS con Origin no permitido => 403", async () => {
  const r = await handler(new Request(U, { method: "OPTIONS", headers: { origin: "https://evil.example" } }));
  assertEquals(r.status, 403);
});
Deno.test("OPTIONS con Origin permitido => 200", async () => {
  const r = await handler(new Request(U, { method: "OPTIONS", headers: { origin: "https://allowed.example" } }));
  assertEquals(r.status, 200);
});
Deno.test("GET => 405", async () => {
  assertEquals((await handler(new Request(U, { method: "GET" }))).status, 405);
});
Deno.test("POST no multipart => 415", async () => {
  const r = await handler(new Request(U, { method: "POST", headers: { origin: "https://allowed.example", "content-type": "application/json" }, body: "{}" }));
  assertEquals(r.status, 415);
});
Deno.test("POST cuerpo excesivo => 413", async () => {
  const r = await handler(new Request(U, {
    method: "POST",
    headers: { origin: "https://allowed.example", "content-type": "multipart/form-data; boundary=x", "content-length": String(1024 * 1024 * 1024) },
    body: "x",
  }));
  assertEquals(r.status, 413);
});

const validPayload = () => ({
  nombre: "Persona Segura",
  correo: "persona@example.com",
  telefono: "5512345678",
  categoria: "soporte",
  sistema: "Otro: Modelo local",
  titulo: "Falla reproducible",
  descripcion: "La máquina presenta una falla reproducible.",
  impacto: "media",
  canal: "correo",
  afecta_a: "solo_yo",
});
const turnstileRequest = () => {
  const form = new FormData();
  form.append("payload", JSON.stringify(validPayload()));
  form.append("turnstile_token", "token");
  return new Request(U, { method: "POST", headers: { origin: "https://allowed.example" }, body: form });
};

Deno.test("Siteverify excepción/timeout stub => 503", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((_input: URL | RequestInfo, init?: RequestInit) => {
    assertEquals(init?.signal instanceof AbortSignal, true);
    return Promise.reject(new DOMException("aborted", "AbortError"));
  }) as typeof fetch;
  try {
    assertEquals((await handler(turnstileRequest())).status, 503);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("Siteverify HTTP no 2xx => 503", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response("no", { status: 503 }))) as typeof fetch;
  try {
    assertEquals((await handler(turnstileRequest())).status, 503);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("Siteverify JSON inválido => 503", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response("{", { status: 200 }))) as typeof fetch;
  try {
    assertEquals((await handler(turnstileRequest())).status, 503);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
