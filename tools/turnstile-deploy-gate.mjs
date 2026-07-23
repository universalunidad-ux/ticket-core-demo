#!/usr/bin/env node
/* SECURITY GATE (V2-7): impide producción sin Turnstile configurado y verifica
   fail-closed. FALLA (no SKIP) si faltan los archivos que debe proteger. */
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const root = resolve(process.argv[2] || ".");
const html = join(root, "app/soporte.html");
const edge = join(root, "supabase/functions/support-submit-secure/index.ts");
const owner = join(root, "supabase/functions/_shared/support-request-contract.ts");
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
  if (!/class="cf-turnstile"[^>]*data-action="support_submit"/.test(h))
    failures.push("widget Turnstile sin data-action support_submit");
}

if (!existsSync(edge) || !existsSync(owner)) failures.push("falta el Edge o el owner Turnstile (no se puede verificar fail-closed)");
else {
  const e = readFileSync(edge, "utf8");
  const o = readFileSync(owner, "utf8");
  // Fail-closed: ausencia de ENVIRONMENT => producción. Rechaza el patrón fail-open.
  if (/IS_PROD=\(Deno\.env\.get\("ENVIRONMENT"\)\|\|""\)\.toLowerCase\(\)==="production"/.test(e))
    failures.push("Edge fail-OPEN: IS_PROD sólo true si ENVIRONMENT==='production'");
  if (!/const IS_DEV=\[.*\]\.includes\(ENVIRONMENT\)/.test(e) || !/const IS_PROD=!IS_DEV/.test(e))
    failures.push("Edge no define IS_PROD=!IS_DEV (fail-closed por ausencia de ENVIRONMENT)");
  if (!/REQUIRE_TURNSTILE_EFFECTIVE/.test(e)) failures.push("Edge sin REQUIRE_TURNSTILE_EFFECTIVE");
  if (!/TURNSTILE_FETCH_TIMEOUT_MS\s*=\s*5_000/.test(o)) failures.push("timeout Siteverify distinto de 5000ms");
  if (!/setTimeout\(\(\)=>controller\.abort\(\),TURNSTILE_FETCH_TIMEOUT_MS\)/.test(e) || !/signal:controller\.signal/.test(e))
    failures.push("fetch Siteverify sin AbortController/timeout");
  if (!/if\(!res\.ok\)return\{ok:false,code:"TURNSTILE_UNAVAILABLE"\}/.test(e))
    failures.push("Siteverify no falla ante HTTP no-2xx");
  if (!/try\{value=await res\.json\(\)\}catch\{return\{ok:false,code:"TURNSTILE_UNAVAILABLE"\}\}/.test(e))
    failures.push("Siteverify no falla ante JSON inválido");
  if (!/response\.success !== true/.test(o)) failures.push("Siteverify no exige success=true");
  if (!/response\.hostname !== expected\.hostname/.test(o)) failures.push("Siteverify no exige hostname exacto");
  if (!/response\.action !== expected\.action/.test(o) || !/SUPPORT_TURNSTILE_ACTION = "support_submit"/.test(o))
    failures.push("Siteverify no exige action support_submit");
  if (!/challengeMs - expected\.nowMs > TURNSTILE_CLOCK_SKEW_MS/.test(o))
    failures.push("Siteverify no limita skew futuro");
  if (!/expected\.nowMs - challengeMs > TURNSTILE_MAX_AGE_MS/.test(o) || !/TURNSTILE_MAX_AGE_MS = 300_000/.test(o))
    failures.push("Siteverify no limita edad a 300000ms");
  const marker = e.indexOf("// VALIDATION_BARRIER_REACHED", e.indexOf("export const handler"));
  const verify = e.indexOf("await verifyTurnstile", e.indexOf("export const handler"));
  if (verify < 0 || marker < 0 || verify > marker) failures.push("Turnstile no concluye antes de la barrera");
}

if (failures.length) {
  console.error(failures.map((x) => " - " + x).join("\n"));
  console.error("TURNSTILE_DEPLOY_GATE: FAIL");
  process.exit(1);
}
console.log("TURNSTILE_DEPLOY_GATE: PASS");
