import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ALLOWED_EXT, ALLOWED_MIME, CAP_VID, MAX_FILES, UPLOAD_CONTRACT_VERSION,
  detectFileType, extCategory, extensionOf, sniffCategory, validateAttachment,
  validateAttachmentBatch,
} from "./upload-contract.ts";

const iso = (brand: string) => {
  const value = new Uint8Array(12);
  value.set(new TextEncoder().encode("ftyp"), 4);
  value.set(new TextEncoder().encode(brand), 8);
  return value;
};

Deno.test("exports v1 permanecen compatibles", () => {
  assertEquals(extCategory("png"), "image");
  assertEquals(extCategory("mp4"), "video");
  assertEquals(sniffCategory(new Uint8Array([0xff, 0xd8, 0xff])), "image");
  assertEquals(ALLOWED_EXT.has("zip"), false);
  assertEquals(ALLOWED_MIME.has("image/svg+xml"), false);
  assertEquals(MAX_FILES, 5);
  assertEquals(CAP_VID, 40 * 1024 * 1024);
});

Deno.test("v2 detecta tipo exacto y matriz extensión MIME magic", async () => {
  assertEquals(UPLOAD_CONTRACT_VERSION, "support-upload/v2");
  assertEquals(extensionOf("A.JPEG"), "jpeg");
  assertEquals(detectFileType(iso("qt  ")), "mov");
  const ok = await validateAttachment({ name: "video.m4v", mimeType: "video/mp4", bytes: iso("M4V ") });
  assert(ok.ok);
  if (ok.ok) assertEquals(ok.value.detectedType, "m4v");
  const bad = await validateAttachment({ name: "foto.jpg", mimeType: "image/png", bytes: new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]) });
  assertEquals(bad.ok, false);
  if (!bad.ok) assert(bad.issues.some((issue) => issue.code === "UPLOAD_EXTENSION_MIME_MISMATCH"));
});

Deno.test("batch aplica límites de conteo y categoría", async () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff]);
  const result = await validateAttachmentBatch(Array.from({ length: 4 }, (_, index) => ({ name: `${index}.jpg`, mimeType: "image/jpeg", bytes: jpeg })));
  assertEquals(result.ok, false);
  if (!result.ok) assert(result.issues.some((issue) => issue.code === "UPLOAD_CATEGORY_COUNT_EXCEEDED"));
});
