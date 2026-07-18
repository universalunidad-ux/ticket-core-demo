// Pruebas del contrato de subida (deno test). Ejecutables también vía Node tras
// transpilar (ver tools/run-contract-tests.mjs).
import { extCategory, sniffCategory, ALLOWED_EXT, CAP_VID, MAX_FILES } from "./upload-contract.ts";
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("extCategory clasifica por extensión", () => {
  assertEquals(extCategory("png"), "image");
  assertEquals(extCategory("mp4"), "video");
  assertEquals(extCategory("pdf"), "pdf");
  assertEquals(extCategory("zip"), "other");
});
Deno.test("sniffCategory detecta firmas", () => {
  assertEquals(sniffCategory(new Uint8Array([0xFF,0xD8,0xFF])), "image");
  assertEquals(sniffCategory(new Uint8Array([0x25,0x50,0x44,0x46])), "pdf");
  assertEquals(sniffCategory(new TextEncoder().encode("<html>hola")), "unknown");
});
Deno.test("contrato: zip fuera de allowlist", () => {
  assertEquals(ALLOWED_EXT.has("zip"), false);
  assertEquals(MAX_FILES, 5);
  assertEquals(CAP_VID, 40*1024*1024);
});
