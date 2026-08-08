#!/usr/bin/env node
// F17-W1 schema contract — gate Node estatico (sin DB). Valida el texto de la
// migracion de fundacion y demuestra sensibilidad M01-M08 (cada mutacion debe
// hacer FALLAR el gate). No abre conexion a ninguna base de datos.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(process.argv[2] || ".");
const MIGRATIONS_DIR = join(root, "supabase/migrations");
const MIGRATION_SUFFIX = "_f17_staff_schema_authz_foundation.sql";

export const F17_TABLES = [
  "staff_teams",
  "staff_team_memberships",
  "staff_conversations",
  "staff_messages",
  "staff_message_revisions",
  "staff_announcements",
  "staff_announcement_targets",
  "staff_message_receipts",
  "support_agent_scopes",
];

export function locateMigration(dir = MIGRATIONS_DIR) {
  const matches = readdirSync(dir).filter((f) => f.endsWith(MIGRATION_SUFFIX));
  if (matches.length !== 1) {
    throw new Error(`F17_MIGRATION_NOT_UNIQUE: encontrados ${matches.length}`);
  }
  return join(dir, matches[0]);
}

// Validador puro: devuelve { ok, failures:[{code}], assertions }.
export function validateSchema(sql) {
  const failures = [];
  let assertions = 0;
  const check = (code, cond) => {
    assertions++;
    if (!cond) failures.push({ code });
  };
  const createTableRe = /create\s+table\s+/gi;
  const createTableCount = (sql.match(createTableRe) || []).length;

  // 1. marker PREPARED_NOT_APPLIED
  check("MARKER_MISSING", /PREPARED_NOT_APPLIED/.test(sql));

  // 2. exactamente 9 create table y los 9 nombres F17 esperados
  check("CREATE_TABLE_COUNT", createTableCount === 9);
  for (const t of F17_TABLES) {
    check(`TABLE_MISSING:${t}`, new RegExp(`create\\s+table\\s+(if\\s+not\\s+exists\\s+)?public\\.${t}\\b`, "i").test(sql));
  }

  // 3. ENABLE ROW LEVEL SECURITY para las 9
  for (const t of F17_TABLES) {
    check(`RLS_MISSING:${t}`, new RegExp(`alter\\s+table\\s+public\\.${t}\\s+enable\\s+row\\s+level\\s+security`, "i").test(sql));
  }

  // 4. prohibido CREATE TABLE ... IF NOT EXISTS
  check("IF_NOT_EXISTS_FORBIDDEN", !/create\s+table\s+if\s+not\s+exists/i.test(sql));

  // 5. cero GRANT a anon/PUBLIC; existe REVOKE ALL ... FROM PUBLIC, anon
  check("GRANT_TO_ANON", !/grant\b[^;]*\bto\b[^;]*\banon\b/i.test(sql));
  check("GRANT_TO_PUBLIC", !/grant\b[^;]*\bto\s+public\b/i.test(sql));
  check("REVOKE_PUBLIC_ANON", /revoke\s+all\b[^;]*\bfrom\s+public\s*,\s*anon/i.test(sql));

  // 6. cero DML core a authenticated (solo GRANT SELECT permitido)
  check("DML_TO_AUTHENTICATED", !/grant\s+(insert|update|delete)[^;]*\bto\s+authenticated\b/i.test(sql));

  // 7. guards fail-closed presentes
  check("GUARD_BLOCK", /F17_GUARD/.test(sql));
  for (const token of ["public.perfiles", "public.tickets", "public.bitacora", "auth.uid()", "tc_current_role", "tc_is_admin"]) {
    check(`GUARD_TOKEN:${token}`, sql.includes(token));
  }

  // 8. sin data migration a tablas F17
  check("DATA_MIGRATION", !/insert\s+into\s+(public\.)?staff_/i.test(sql));

  // 9. scope_kind sin 'team'; catalogo specialty/machine/family
  check("SCOPE_KIND_TEAM", !/'team'/i.test(sql));
  check("SCOPE_KIND_CATALOG", /scope_kind\s+in\s*\(\s*'specialty'\s*,\s*'machine'\s*,\s*'family'\s*\)/i.test(sql));

  return { ok: failures.length === 0, failures, assertions };
}

// ---- Corpus de sensibilidad M01-M08 (schema-contract owns 8) -----------------
export const SCHEMA_MUTATIONS = {
  M01: (sql) => sql.replace(/create table public\.staff_teams \([\s\S]*?\n\);\n/, ""), // drop 1 de 9
  M02: (sql) => sql + "\ncreate table public.staff_extra (id uuid primary key);\n", // 10a tabla
  M03: (sql) => sql.replace("alter table public.staff_teams enable row level security;\n", ""), // quitar RLS
  M04: (sql) => sql.replace("create table public.staff_teams (", "create table if not exists public.staff_teams ("),
  M05: (sql) => sql + "\ngrant insert on public.staff_messages to authenticated;\n", // DML a authenticated
  M06: (sql) => sql + "\ngrant select on public.staff_teams to anon;\n", // grant a anon
  M07: (sql) => sql.replace("scope_kind in ('specialty','machine','family')", "scope_kind in ('specialty','machine','family','team')"),
  M08: (sql) => sql.replace(/PREPARED_NOT_APPLIED/g, "READY"), // quitar marker
};

function main() {
  const path = locateMigration();
  const sql = readFileSync(path, "utf8");

  const base = validateSchema(sql);
  assert.equal(base.ok, true, `schema-contract base fallo: ${JSON.stringify(base.failures)}`);

  let killed = 0;
  for (const [id, mutate] of Object.entries(SCHEMA_MUTATIONS)) {
    const result = validateSchema(mutate(sql));
    assert.equal(result.ok, false, `sensibilidad ${id}: la mutacion NO fue detectada`);
    killed++;
    console.log(`F17_SCHEMA_MUTATION ${id}=KILLED`);
  }
  assert.equal(killed, 8, `se esperaban 8 mutaciones, killed=${killed}`);

  console.log(`F17_SCHEMA_CONTRACT_ASSERTIONS=${base.assertions}`);
  console.log(`F17_SCHEMA_SENSITIVITY_MUTATIONS=${killed}`);
  console.log("F17_SCHEMA_CONTRACT=PASS");
}

if (import.meta.url === `file://${process.argv[1]}`) main();
