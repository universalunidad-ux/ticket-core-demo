// Pruebas del handler (deno test). Cubren respuestas tempranas sin tocar la BD:
// 200 OPTIONS, 403 CORS, 405 método, 415 content-type, 413 cuerpo.
// Los códigos 400/409/429/503 dependen de BD/entorno y se validan en integración.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

// Env mínima para carga del módulo (no se realiza I/O en estas rutas).
Deno.env.set("SUPABASE_URL", "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test");
Deno.env.set("ENVIRONMENT", "development");
Deno.env.set("CORS_ALLOWED_ORIGINS", "https://allowed.example");

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
  const r = await handler(new Request(U, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
  assertEquals(r.status, 415);
});
Deno.test("POST cuerpo excesivo => 413", async () => {
  const r = await handler(new Request(U, {
    method: "POST",
    headers: { "content-type": "multipart/form-data; boundary=x", "content-length": String(1024 * 1024 * 1024) },
    body: "x",
  }));
  assertEquals(r.status, 413);
});
