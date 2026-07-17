#!/usr/bin/env node
/* SECURITY GATE (U2): el código cliente (app/**) no puede aprovisionar perfiles
   ni escribir `rol`. Falla si detecta insert/upsert en `perfiles` o un update/
   insert que escriba la columna `rol` desde el navegador. */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";

const root = resolve(process.argv[2] || ".");
const app = join(root, "app");
const failures = [];

// Permite marcar líneas de test/fixtures intencionales con: // rol-write-gate:allow
const ALLOW = /rol-write-gate:allow/;

function scan(file) {
  const text = readFileSync(file, "utf8");
  const rel = relative(root, file);
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    if (ALLOW.test(line)) return;
    const n = i + 1;
    // 1) insert/upsert directo en perfiles
    if (/\.from\(\s*["'`]perfiles["'`]\s*\)\s*\.\s*(insert|upsert)\s*\(/.test(line))
      failures.push(`${rel}:${n}: insert/upsert en 'perfiles' desde cliente (aprovisionamiento prohibido)`);
    // 2) update de perfiles que incluya rol en el mismo statement/línea
    if (/\.from\(\s*["'`]perfiles["'`]\s*\)/.test(line) && /\.update\(\{[^}]*\brol\b\s*:/.test(line))
      failures.push(`${rel}:${n}: update de 'perfiles' escribiendo 'rol' desde cliente`);
    // 3) cualquier objeto insert/update/upsert que escriba rol junto a perfiles en la línea
    if (/perfiles/.test(line) && /(insert|update|upsert)\(\{[^}]*\brol\b\s*:/.test(line))
      failures.push(`${rel}:${n}: escritura de 'rol' en 'perfiles' desde cliente`);
  });
}

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const f = join(dir, name), st = statSync(f);
    if (st.isDirectory()) walk(f);
    else if (/\.(js|mjs)$/.test(name)) scan(f);
  }
}
walk(app);

if (failures.length) {
  console.error([...new Set(failures)].map((x) => " - " + x).join("\n"));
  console.error("CLIENT_ROLE_WRITE_GATE: FAIL");
  process.exit(1);
}
console.log("CLIENT_ROLE_WRITE_GATE: PASS");
