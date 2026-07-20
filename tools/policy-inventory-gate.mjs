#!/usr/bin/env node
/* SECURITY GATE (V2-3): compara un snapshot de pg_policies (JSON exportado por
   supabase/tests/policy_preflight.sql) contra el manifiesto de policies
   reconocidas. STOP (falla) si:
   - falta el snapshot (no se puede verificar => se falla, no SKIP);
   - existe una policy sobre una tabla cubierta que NO está en el manifiesto
     (posible policy heredada permisiva que abre acceso por OR);
   - persiste una policy marcada legacy_to_drop.
   Uso: POLICY_SNAPSHOT=policy_snapshot.json node tools/policy-inventory-gate.mjs . */
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const root = resolve(process.argv[2] || ".");
const manifest = JSON.parse(readFileSync(join(root, "tools/authz-policy-manifest.json"), "utf8"));
const snapPath = process.env.POLICY_SNAPSHOT || join(root, "policy_snapshot.json");

if (!existsSync(snapPath)) {
  console.error(`POLICY_INVENTORY_GATE: FAIL — falta snapshot (${snapPath}).`);
  console.error("Ejecuta supabase/tests/policy_preflight.sql en staging y exporta el JSON.");
  process.exit(1);
}

let snapshot;
try { snapshot = JSON.parse(readFileSync(snapPath, "utf8")); }
catch (e) { console.error("POLICY_INVENTORY_GATE: FAIL — snapshot ilegible:", e.message); process.exit(1); }

const recognized = manifest.recognized || {};
const legacy = manifest.legacy_to_drop || {};
const covered = new Set(Object.keys(recognized).map((t) => t.replace(/^public\./, "")));
const failures = [];

for (const row of snapshot) {
  const table = row.tablename;
  const name = row.policyname;
  const full = `public.${table}`;
  // política heredada que debía eliminarse
  if ((legacy[full] || []).includes(name)) failures.push(`policy heredada aún presente: ${table}.${name}`);
  // política no reconocida sobre tabla cubierta
  if (covered.has(table)) {
    const ok = (recognized[full] || []).includes(name) || (recognized["storage.objects"] || []).includes(name);
    if (!ok) failures.push(`policy NO reconocida sobre tabla cubierta ${table}.${name} (revisar: OR permisivo)`);
  }
}

if (failures.length) {
  console.error([...new Set(failures)].map((x) => " - " + x).join("\n"));
  console.error("POLICY_INVENTORY_GATE: FAIL");
  process.exit(1);
}
console.log(`POLICY_INVENTORY_GATE: PASS (${snapshot.length} policies verificadas)`);
