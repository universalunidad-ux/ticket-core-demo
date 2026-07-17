#!/usr/bin/env node
/* SECURITY GATE (U1): la respuesta pública de éxito del Edge de soporte no debe
   exponer datos internos de CRM. Parsea cada `return json(<obj>, <status>)` con
   balanceo de llaves y valida los objetos con status 200. Estático (sin Deno). */
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const root = resolve(process.argv[2] || ".");
const file = join(root, "supabase/functions/support-submit-secure/index.ts");
const FORBIDDEN = [
  "suggested_company", "suggested_contact", "match_score", "match_level",
  "cliente_id_sugerido", "contacto_id_sugerido", "cliente_id", "contacto_id",
  "solicitud_id", "ticket_id", "requires_confirmation", "requires_consolidation",
  "candidates", "cliente_nombre", "contacto_nombre", "magic_link",
];

if (!existsSync(file)) { console.log("EDGE_ANON_RESPONSE_GATE: SKIP (edge no presente)"); process.exit(0); }
const src = readFileSync(file, "utf8");

// Extrae argumento objeto balanceado a partir del índice de la '{'.
function readObject(s, start) {
  let depth = 0, i = start, inStr = null, esc = false;
  for (; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") inStr = c;
    else if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return { obj: s.slice(start, i + 1), end: i + 1 }; }
  }
  return null;
}

const failures = [];
let idx = 0, checked = 0;
const marker = "json(";
while ((idx = src.indexOf(marker, idx)) !== -1) {
  const braceStart = src.indexOf("{", idx + marker.length);
  const after = src.slice(idx + marker.length, braceStart);
  idx += marker.length;
  if (braceStart === -1 || /[;)]/.test(after)) continue; // no es json({...})
  const parsed = readObject(src, braceStart);
  if (!parsed) continue;
  const tail = src.slice(parsed.end, parsed.end + 12);
  const mStatus = tail.match(/^\s*,\s*(\d{3})/);
  const status = mStatus ? Number(mStatus[1]) : 200; // default json() => 200
  if (status !== 200) continue;
  checked++;
  for (const key of FORBIDDEN) {
    if (new RegExp(`(^|[{,\\s])"?${key}"?\\s*:`).test(parsed.obj)) {
      failures.push(`campo prohibido en respuesta 200: ${key}`);
    }
  }
}

if (checked === 0) failures.push("no se encontró respuesta 200 de éxito para validar");
if (failures.length) {
  console.error([...new Set(failures)].map((x) => " - " + x).join("\n"));
  console.error("EDGE_ANON_RESPONSE_GATE: FAIL");
  process.exit(1);
}
console.log(`EDGE_ANON_RESPONSE_GATE: PASS (${checked} respuesta[s] 200 validada[s])`);
