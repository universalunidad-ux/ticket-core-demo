#!/usr/bin/env node
/* SECURITY GATE (V2-9/W2): adjuntos completos y validados antes de la barrera.
   Después de ella sólo se permiten bytes y metadata de ValidatedAttachment. */
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const root = resolve(process.argv[2] || ".");
const file = join(root, "supabase/functions/support-submit-secure/index.ts");
const contractFile = join(root, "supabase/functions/_shared/upload-contract.ts");
const failures = [];

if (!existsSync(file) || !existsSync(contractFile)) {
  console.error("STORAGE_SAFETY_GATE: FAIL — falta el Edge support-submit-secure (no se puede verificar).");
  process.exit(1);
}
const src = readFileSync(file, "utf8");
const contract = readFileSync(contractFile, "utf8");

const DANGEROUS = ["svg","svgz","html","htm","xhtml","js","mjs"];
const NON_UI = ["zip","xml","xls","xlsx","csv","txt"]; // no forman parte del contrato UI
const DANGEROUS_MIME = ["image/svg+xml","text/html","application/xhtml+xml","text/javascript","application/javascript","application/zip","application/x-zip-compressed","text/csv","text/plain","application/vnd.ms-excel"];

const allowedExt = (contract.match(/ALLOWED_EXT\s*=\s*new Set\(\[([^\]]*)\]/) || [])[1] || "";
const allowedMime = (contract.match(/ALLOWED_MIME\s*=\s*new Set\(\[([\s\S]*?)\]\)/) || [])[1] || "";
const marker = "// VALIDATION_BARRIER_REACHED";
const handlerStart = src.indexOf("export const handler");
const markerIndex = src.indexOf(marker, handlerStart);
const before = src.slice(handlerStart, markerIndex);
const after = src.slice(markerIndex + marker.length);

if (!/crypto\.randomUUID\(\)/.test(src)) failures.push("ruta de subida predecible (sin crypto.randomUUID)");
for (const e of [...DANGEROUS, ...NON_UI]) if (new RegExp(`["'\`]${e}["'\`]`).test(allowedExt)) failures.push(`extensión fuera de contrato permitida: ${e}`);
for (const m of DANGEROUS_MIME) if (allowedMime.includes(m)) failures.push(`MIME fuera de contrato permitido: ${m}`);
if (markerIndex < 0 || src.split(marker).length - 1 !== 1) failures.push("marker de barrera ausente o duplicado");
if (!/file\.arrayBuffer\(\)/.test(before)) failures.push("bytes de adjuntos no leídos antes de la barrera");
if (!/validateAttachmentBatch\s*\(\s*attachmentInputs\s*\)/.test(before)) failures.push("validateAttachmentBatch no termina antes de la barrera");
if (before.indexOf("file.arrayBuffer()") > before.indexOf("validateAttachmentBatch")) failures.push("batch validado antes de leer todos los bytes");
if (/arrayBuffer\s*\(|sniffCategory\s*\(|detectFileType\s*\(|validateAttachmentBatch\s*\(/.test(after)) failures.push("validación o lectura tardía después de la barrera");
if (!/const \{metadata,bytes\}=upload/.test(after)) failures.push("Storage no consume el par validado metadata/bytes");
if (!/\.upload\(path,bytes,\{contentType:metadata\.mimeType,upsert:false\}\)/.test(after)) failures.push("Storage no usa bytes y MIME validados");
for (const field of ["normalizedName", "mimeType", "size", "detectedType", "contentSha256"]) {
  if (!new RegExp(`metadata\\.${field}`).test(after)) failures.push(`metadata validada no usada: ${field}`);
}

if (failures.length) {
  console.error([...new Set(failures)].map((x) => " - " + x).join("\n"));
  console.error("STORAGE_SAFETY_GATE: FAIL");
  process.exit(1);
}
console.log("STORAGE_SAFETY_GATE: PASS");
