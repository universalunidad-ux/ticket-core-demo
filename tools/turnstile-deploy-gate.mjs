#!/usr/bin/env node
/* SECURITY GATE (V2-7): impide producción sin Turnstile configurado y verifica
   fail-closed. FALLA (no SKIP) si faltan los archivos que debe proteger. */
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const root = resolve(process.argv[2] || ".");
const html = join(root, "app/soporte.html");
const edge = join(root, "supabase/functions/support-submit-secure/index.ts");
const failures = [];

if (!existsSync(html)) failures.push("falta app/soporte.html (no se puede verificar Turnstile)");
else {
  const h = readFileSync(html, "utf8");
  if (!/turnstile\/v0\/api\.js/.test(h)) failures.push("soporte.html no carga el script de Turnstile");
  const m = h.match(/class="cf-turnstile"[^>]*data-sitekey="([^"]*)"/);
  if (!m) failures.push("soporte.html sin widget cf-turnstile/data-sitekey");
  else {
    const key = m[1].trim();
    if (!key || /^0x0+$/.test(key) || /PLACEHOLDER|YOUR_|DEV/i.test(key))
      failures.push(`data-sitekey placeholder/ausente: '${key}'`);
  }
}

if (!existsSync(edge)) failures.push("falta el Edge support-submit-secure (no se puede verificar fail-closed)");
else {
  const e = readFileSync(edge, "utf8");
  // Fail-closed: ausencia de ENVIRONMENT => producción. Rechaza el patrón fail-open.
  if (/IS_PROD=\(Deno\.env\.get\("ENVIRONMENT"\)\|\|""\)\.toLowerCase\(\)==="production"/.test(e))
    failures.push("Edge fail-OPEN: IS_PROD sólo true si ENVIRONMENT==='production'");
  if (!/const IS_DEV=\[.*\]\.includes\(ENVIRONMENT\)/.test(e) || !/const IS_PROD=!IS_DEV/.test(e))
    failures.push("Edge no define IS_PROD=!IS_DEV (fail-closed por ausencia de ENVIRONMENT)");
  if (!/REQUIRE_TURNSTILE_EFFECTIVE/.test(e)) failures.push("Edge sin REQUIRE_TURNSTILE_EFFECTIVE");
}

if (failures.length) {
  console.error(failures.map((x) => " - " + x).join("\n"));
  console.error("TURNSTILE_DEPLOY_GATE: FAIL");
  process.exit(1);
}
console.log("TURNSTILE_DEPLOY_GATE: PASS");
