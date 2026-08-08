import { assert, assertEquals, assertMatch, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { SHA256_HEX_RE, escapeHtml, normalizeFileName, sanitizeEmailSubject, sha256Hex } from "./security-primitives.ts";

Deno.test("SHA-256 es completo, determinista y UTF-8", async () => {
  const digest = await sha256Hex("abc");
  assertEquals(digest, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assertMatch(digest, SHA256_HEX_RE);
  assertEquals(await sha256Hex("á"), await sha256Hex(new TextEncoder().encode("á")));
  assertNotEquals(await sha256Hex("abc"), await sha256Hex("abd"));
});

Deno.test("HTML y subject bloquean inyección", () => {
  assertEquals(escapeHtml(`&<>"'`), "&amp;&lt;&gt;&quot;&#39;");
  assertEquals(sanitizeEmailSubject(" Asunto\r\nBcc: x "), "AsuntoBcc: x");
  assert(!/[\r\n\u0000]/u.test(sanitizeEmailSubject("a\r\n\u0000b")));
});

Deno.test("filename usa basename y ASCII seguro", () => {
  assertEquals(normalizeFileName("../../máquina dañada.png"), "maquina_danada.png");
  assertEquals(normalizeFileName(".."), "archivo");
  assert(normalizeFileName("CON.txt").startsWith("archivo_"));
});
