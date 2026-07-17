#!/usr/bin/env node
/* SECURITY GATE (U5): la subida de adjuntos del Edge debe usar rutas no
   predecibles (crypto.randomUUID) y NO permitir SVG/HTML ejecutable en las
   allowlists de extensión/MIME. Estático sobre el Edge. */
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const root = resolve(process.argv[2] || ".");
const file = join(root, "supabase/functions/support-submit-secure/index.ts");
if (!existsSync(file)) { console.log("STORAGE_SAFETY_GATE: SKIP (edge no presente)"); process.exit(0); }
const src = readFileSync(file, "utf8");
const failures = [];

// 1) Ruta de subida no predecible.
const upload = src.match(/storage\.from\(\s*["'`]soporte_adjuntos["'`]\s*\)\.upload\(\s*([A-Za-z0-9_]+)/);
if (!upload) failures.push("no se encontró la subida a 'soporte_adjuntos'");
if (!/crypto\.randomUUID\(\)/.test(src)) failures.push("la ruta de subida no usa crypto.randomUUID() (predecible)");

// 2) Extensiones/MIME peligrosos no deben estar permitidos.
const DANGEROUS_EXT = ["svg", "html", "htm", "xhtml", "js", "mjs", "svgz"];
const DANGEROUS_MIME = ["image/svg+xml", "text/html", "application/xhtml+xml", "text/javascript", "application/javascript"];
const allowedExt = (src.match(/allowedExt\s*=\s*new Set\(\[([^\]]*)\]/) || [])[1] || "";
const allowedMime = (src.match(/allowedMime\s*=\s*new Set\(\[([^\]]*)\]/) || [])[1] || "";
for (const e of DANGEROUS_EXT) if (new RegExp(`["'\`]${e}["'\`]`).test(allowedExt)) failures.push(`extensión peligrosa permitida: ${e}`);
for (const m of DANGEROUS_MIME) if (allowedMime.includes(m)) failures.push(`MIME peligroso permitido: ${m}`);

// 3) Debe existir un límite de tamaño por archivo.
if (!/size>\s*\d+\s*\*\s*1024\s*\*\s*1024/.test(src)) failures.push("sin límite de tamaño por archivo");

if (failures.length) {
  console.error([...new Set(failures)].map((x) => " - " + x).join("\n"));
  console.error("STORAGE_SAFETY_GATE: FAIL");
  process.exit(1);
}
console.log("STORAGE_SAFETY_GATE: PASS");
