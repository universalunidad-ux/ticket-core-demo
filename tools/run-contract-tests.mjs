#!/usr/bin/env node
// Ejecuta las pruebas del contrato de subida SIN Deno (Node 22 strip-types).
// FALLA (no SKIP) si el módulo no existe.
import assert from "node:assert";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(process.argv[2] || ".");
const mod = join(root, "supabase/functions/_shared/upload-contract.ts");
if (!existsSync(mod)) { console.error("CONTRACT_TESTS: FAIL — falta upload-contract.ts"); process.exit(1); }

const { extCategory, sniffCategory, ALLOWED_EXT, ALLOWED_MIME, MAX_FILES, CAP_VID, CAP_IMG } =
  await import(pathToFileURL(mod).href);

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
ok(extCategory("png") === "image"); ok(extCategory("mov") === "video");
ok(extCategory("pdf") === "pdf"); ok(extCategory("zip") === "other"); ok(extCategory("svg") === "other");
ok(sniffCategory(new Uint8Array([0xFF,0xD8,0xFF])) === "image", "jpeg");
ok(sniffCategory(new Uint8Array([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A])) === "image", "png");
ok(sniffCategory(new Uint8Array([0x25,0x50,0x44,0x46])) === "pdf", "pdf");
const mp4 = new Uint8Array(12); "ftyp".split("").forEach((c,i)=>mp4[4+i]=c.charCodeAt(0)); "isom".split("").forEach((c,i)=>mp4[8+i]=c.charCodeAt(0));
ok(sniffCategory(mp4) === "video", "mp4");
ok(sniffCategory(new TextEncoder().encode("<svg xmlns")) === "unknown", "svg disfrazado");
ok(!ALLOWED_EXT.has("zip") && !ALLOWED_EXT.has("svg") && !ALLOWED_EXT.has("html"), "sin zip/svg/html");
ok(ALLOWED_EXT.has("mp4") && ALLOWED_EXT.has("heic"), "con video/heic");
ok(!ALLOWED_MIME.has("application/zip") && !ALLOWED_MIME.has("image/svg+xml"), "mime seguro");
ok(MAX_FILES === 5 && CAP_VID === 40*1024*1024 && CAP_IMG === 5*1024*1024, "limites");
console.log(`CONTRACT_TESTS: PASS (${n} asserts)`);
