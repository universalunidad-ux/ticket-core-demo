#!/usr/bin/env node
/* SECURITY GATE (V2-9): contrato de subida seguro y alineado con la UI.
   FALLA (no SKIP) si falta el Edge que debe proteger. Verifica:
   - ruta no predecible (crypto.randomUUID);
   - allowlists SIN SVG/HTML/JS ejecutable NI zip/xml/excel/csv/txt (alineado a UI);
   - validación por FIRMA de bytes (sniffCategory);
   - límite de tamaño por archivo. */
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const root = resolve(process.argv[2] || ".");
const file = join(root, "supabase/functions/support-submit-secure/index.ts");
const failures = [];

if (!existsSync(file)) {
  console.error("STORAGE_SAFETY_GATE: FAIL — falta el Edge support-submit-secure (no se puede verificar).");
  process.exit(1);
}
const src = readFileSync(file, "utf8");

const DANGEROUS = ["svg","svgz","html","htm","xhtml","js","mjs"];
const NON_UI = ["zip","xml","xls","xlsx","csv","txt"]; // no forman parte del contrato UI
const DANGEROUS_MIME = ["image/svg+xml","text/html","application/xhtml+xml","text/javascript","application/javascript","application/zip","application/x-zip-compressed","text/csv","text/plain","application/vnd.ms-excel"];

const allowedExt = (src.match(/allowedExt\s*=\s*new Set\(\[([^\]]*)\]/) || [])[1] || "";
const allowedMime = (src.match(/allowedMime\s*=\s*new Set\(\[([^\]]*)\]/) || [])[1] || "";

if (!/crypto\.randomUUID\(\)/.test(src)) failures.push("ruta de subida predecible (sin crypto.randomUUID)");
for (const e of [...DANGEROUS, ...NON_UI]) if (new RegExp(`["'\`]${e}["'\`]`).test(allowedExt)) failures.push(`extensión fuera de contrato permitida: ${e}`);
for (const m of DANGEROUS_MIME) if (allowedMime.includes(m)) failures.push(`MIME fuera de contrato permitido: ${m}`);
if (!/sniffCategory\s*\(/.test(src)) failures.push("sin validación por firma de bytes (sniffCategory)");
if (!/sniff!==expected/.test(src)) failures.push("no se compara firma vs extensión declarada");
if (!/size>\s*CAP_(IMG|PDF|VID)/.test(src)) failures.push("sin límite de tamaño por tipo (CAP_*)");

if (failures.length) {
  console.error([...new Set(failures)].map((x) => " - " + x).join("\n"));
  console.error("STORAGE_SAFETY_GATE: FAIL");
  process.exit(1);
}
console.log("STORAGE_SAFETY_GATE: PASS");
