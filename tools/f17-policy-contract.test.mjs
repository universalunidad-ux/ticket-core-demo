#!/usr/bin/env node
// F17-W1 policy contract — gate Node estatico (sin DB). Verifica la biyeccion
// exacta entre las policies F17 declaradas en la migracion y el subconjunto F17
// de tools/authz-policy-manifest.json, la ausencia de policies permisivas
// desconocidas, y la coherencia de grants con la matriz. Demuestra sensibilidad
// M09-M10 (cada mutacion debe hacer FALLAR el gate).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { locateMigration, F17_TABLES } from "./f17-schema-contract.test.mjs";

const root = resolve(process.argv[2] || ".");
const MANIFEST_PATH = join(root, "tools/authz-policy-manifest.json");

const F17_TABLE_SET = new Set(F17_TABLES);
const isF17Key = (key) => key.startsWith("public.staff_") || key === "public.support_agent_scopes";

export function manifestF17Policies(manifest) {
  const out = new Set();
  for (const [key, policies] of Object.entries(manifest.recognized || {})) {
    if (isF17Key(key)) for (const name of policies) out.add(name);
  }
  return out;
}

export function migrationF17Policies(sql) {
  const out = new Set();
  const re = /create\s+policy\s+(\w+)\s+on\s+public\.(\w+)/gi;
  let m;
  while ((m = re.exec(sql)) !== null) {
    if (F17_TABLE_SET.has(m[2])) out.add(m[1]);
  }
  return out;
}

// Validador puro sobre (sql, manifest).
export function validatePolicy(sql, manifest) {
  const failures = [];
  let assertions = 0;
  const check = (code, cond) => { assertions++; if (!cond) failures.push({ code }); };

  const inMigration = migrationF17Policies(sql);
  const inManifest = manifestF17Policies(manifest);

  // Biyeccion: cada policy de la migracion debe estar en el manifest (no permisiva desconocida).
  for (const name of inMigration) check(`UNKNOWN_PERMISSIVE:${name}`, inManifest.has(name));
  // ...y cada policy F17 del manifest debe existir en la migracion (no huerfana).
  for (const name of inManifest) check(`MANIFEST_ORPHAN:${name}`, inMigration.has(name));

  // Cardinalidad esperada: 2 policies por tabla F17 = 18.
  check("POLICY_CARDINALITY", inMigration.size === 18);

  // Grants por tabla coherentes con 04_RLS_GRANTS_MATRIX: SELECT authenticated,
  // revoke public/anon, cero DML a authenticated.
  for (const t of F17_TABLES) {
    check(`GRANT_SELECT_MISSING:${t}`, new RegExp(`grant\\s+select\\s+on\\s+public\\.${t}\\s+to\\s+authenticated`, "i").test(sql));
    check(`REVOKE_MISSING:${t}`, new RegExp(`revoke\\s+all\\s+on\\s+public\\.${t}\\s+from\\s+public\\s*,\\s*anon`, "i").test(sql));
  }
  check("DML_TO_AUTHENTICATED", !/grant\s+(insert|update|delete)[^;]*\bto\s+authenticated\b/i.test(sql));

  return { ok: failures.length === 0, failures, assertions };
}

const clone = (o) => JSON.parse(JSON.stringify(o));

// ---- Corpus de sensibilidad M09-M10 (policy-contract owns 2) -----------------
export const POLICY_MUTATIONS = {
  // M09: omitir una policy del manifest (queda huerfana en la migracion).
  M09: ({ sql, manifest }) => {
    const m = clone(manifest);
    m.recognized["public.staff_teams"] = m.recognized["public.staff_teams"].filter((n) => n !== "staff_teams_support_select");
    return { sql, manifest: m };
  },
  // M10: agregar una policy permisiva desconocida en la migracion.
  M10: ({ sql, manifest }) => ({
    sql: sql + "\ncreate policy staff_teams_rogue_select on public.staff_teams for select to authenticated using (true);\n",
    manifest,
  }),
};

function main() {
  const sql = readFileSync(locateMigration(), "utf8");
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));

  const base = validatePolicy(sql, manifest);
  assert.equal(base.ok, true, `policy-contract base fallo: ${JSON.stringify(base.failures)}`);

  let killed = 0;
  for (const [id, mutate] of Object.entries(POLICY_MUTATIONS)) {
    const { sql: mSql, manifest: mManifest } = mutate({ sql, manifest });
    const result = validatePolicy(mSql, mManifest);
    assert.equal(result.ok, false, `sensibilidad ${id}: la mutacion NO fue detectada`);
    killed++;
    console.log(`F17_POLICY_MUTATION ${id}=KILLED`);
  }
  assert.equal(killed, 2, `se esperaban 2 mutaciones, killed=${killed}`);

  console.log(`F17_POLICY_CONTRACT_ASSERTIONS=${base.assertions}`);
  console.log(`F17_POLICY_SENSITIVITY_MUTATIONS=${killed}`);
  console.log("F17_POLICY_CONTRACT=PASS");
}

if (import.meta.url === `file://${process.argv[1]}`) main();
