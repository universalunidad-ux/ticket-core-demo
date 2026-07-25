#!/usr/bin/env node
// TC-RECOVERY-V2-IMPLEMENT-RUNTIME-01
// recovery-v2-contract.test.mjs — Contrato ESTÁTICO (sin Docker, sin Supabase
// CLI, sin red). Verifica que los artefactos de la unidad existen, tienen la
// forma esperada y respetan las reglas duras del ticket (allowlist, never-
// restore, no-secretos, orden de datos, disciplina de estado). NO ejecuta
// run-recovery-v2.sh ni recovery-signature.sql contra una DB real: eso
// requiere Docker + Supabase CLI (ver docs/operations/RECOVERY_V2_RUNBOOK.md).
//
// Uso:
//   node tools/recovery-v2-contract.test.mjs
//
// Exit 0 con "RECOVERY_V2_CONTRACT=PASS" si todo pasa; assert lanza y aborta
// (exit != 0) ante cualquier violación.

import assert from "node:assert/strict";
import { readFileSync, statSync, readdirSync } from "node:fs";

const SH_PATH = "tools/local-db/run-recovery-v2.sh";
const SQL_PATH = "tools/local-db/recovery-signature.sql";
const ORDER_PATH = "tools/local-db/recovery-data-order.txt";
const RUNBOOK_PATH = "docs/operations/RECOVERY_V2_RUNBOOK.md";
const MIGRATIONS_DIR = "supabase/migrations";

function read(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (e) {
    throw new Error(`no se pudo leer ${path}: ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// 1) Los 5 artefactos exigidos existen.
// ---------------------------------------------------------------------------
const sh = read(SH_PATH);
const sql = read(SQL_PATH);
const order = read(ORDER_PATH);
const runbook = read(RUNBOOK_PATH);
assert.ok(statSync(SH_PATH).size > 0, `${SH_PATH} esta vacio`);
console.log(`PASS\tartifacts_exist\t${SH_PATH},${SQL_PATH},${ORDER_PATH},${RUNBOOK_PATH}`);

// ---------------------------------------------------------------------------
// 2) run-recovery-v2.sh: ejecutable, allowlist, never-restore, solo LOCAL,
//    nunca supabase link/db push/db pull/psql remoto, teardown presente,
//    nunca imprime el dump ni columnas sensibles, salida final completa.
// ---------------------------------------------------------------------------
{
  const mode = statSync(SH_PATH).mode & 0o111;
  assert.ok(mode !== 0, `${SH_PATH} debe ser ejecutable (chmod +x)`);
  console.log(`PASS\tscript_executable\tmode=${statSync(SH_PATH).mode.toString(8)}`);
}

assert.match(sh, /^#!\/usr\/bin\/env bash/, "shebang bash esperado");
assert.match(sh, /set -Eeuo pipefail/, "modo fail-closed (set -Eeuo pipefail) requerido");

for (const schema of ["public", "app_private"]) {
  assert.match(
    sh,
    new RegExp(`--schema=${schema}`),
    `allowlist debe incluir --schema=${schema} en pg_dump/pg_restore`,
  );
}
console.log("PASS\tallowlist_schemas\tpublic,app_private");

for (const table of [
  "public.rate_limit_events",
  "public.edge_idempotency",
  "public.support_idempotency",
  "public.ticket_portal_logs",
]) {
  assert.match(
    sh,
    new RegExp(`--exclude-table=${table.replace(".", "\\.")}`),
    `tabla efimera debe excluirse del dump: ${table}`,
  );
}
console.log("PASS\tephemeral_tables_excluded\tcount=4");

for (const forbidden of ["realtime", "log_min_messages", "pgsodium", "vault", "supabase_functions"]) {
  assert.match(
    new RegExp(forbidden, "i").test(sh) ? sh : "",
    new RegExp(forbidden, "i"),
    `guarda FORBIDDEN_PATTERN debe mencionar: ${forbidden}`,
  );
}
console.log("PASS\tforbidden_patterns_present\trealtime,log_min_messages,pgsodium,vault,supabase_functions");

for (const banned of [
  "supabase link",
  "db push",
  "db pull",
  "psql .*remote",
]) {
  assert.doesNotMatch(
    sh,
    new RegExp(banned, "i"),
    `operacion remota prohibida presente: ${banned}`,
  );
}
console.log("PASS\tno_remote_operations\tno supabase link|db push|db pull");

assert.match(sh, /inspectEnvForRemote/, "debe reutilizar guards.mjs para la guarda anti-remoto (no duplicar)");
assert.match(sh, /classifyTarget/, "debe reutilizar classifyTarget de guards.mjs para --source-db-url");
console.log("PASS\treuses_guards_mjs\tinspectEnvForRemote,classifyTarget");

assert.doesNotMatch(sh, /cat\s+"?\$\{?DUMP_FILE\}?"?/, "el script no debe volcar el contenido del dump");
assert.doesNotMatch(sh, /select\s+\*\s+from\s+.*bitacora/i, "no debe seleccionar bitacora en claro");
assert.doesNotMatch(sh, /\bdetalle\b.*(?:echo|print|cat)/i, "no debe imprimir la columna sensible detalle");
assert.doesNotMatch(sh, /edge_idempotency\.response/i, "no debe referenciar/imprimir edge_idempotency.response");
console.log("PASS\tno_secret_or_sensitive_printing");

assert.match(sh, /supabase stop --workdir/, "debe incluir teardown (supabase stop --workdir)");
assert.match(sh, /--no-backup/, "el teardown debe usar --no-backup (efimero, sin respaldo)");
console.log("PASS\tteardown_present");

for (const field of [
  "RESULT=",
  "BASE_HEAD=",
  "FINAL_HEAD=",
  "BOOTSTRAP_RESULT=",
  "DUMP_RESULT=",
  "SECRET_SCAN_RESULT=",
  "RESTORE_RESULT=",
  "STRUCTURE_PARITY=",
  "DATA_PARITY=",
  "RLS_RESTORE_RESULT=",
  "ACL_RESTORE_RESULT=",
  "RPO_SECONDS=",
  "RTO_SECONDS=",
  "DUMP_BYTES=",
  "DOCKER_USED=",
  "DOCKER_STOPPED=",
  "WORKTREE_STATUS=",
  "COMMIT_CREATED=",
  "PUSH=NO",
  "DEPLOY=NO",
  "SUPABASE_REMOTE=NO",
  "SCORABLE",
  "NEXT_ACTION=",
]) {
  assert.ok(
    sh.includes(field),
    `salida final debe incluir el campo exigido por el ticket: ${field}`,
  );
}
console.log("PASS\tfinal_output_contract\tfields=22");

assert.doesNotMatch(sh, /git\s+(add|commit|push)\b/, "el script NUNCA debe hacer git add/commit/push");
console.log("PASS\tno_git_operations_in_script");

// ---------------------------------------------------------------------------
// 3) recovery-signature.sql: REPORT_ONLY (sin DDL/DML), cubre las 5
//    dimensiones, y respeta la guarda de columnas sensibles.
// ---------------------------------------------------------------------------
assert.doesNotMatch(
  sql,
  /^\s*(?:create|alter|drop|grant|revoke|update|insert|delete)\b/im,
  "recovery-signature.sql debe ser REPORT_ONLY (solo SELECT/\\echo)",
);
console.log("PASS\tsignature_report_only");

for (const section of ["STRUCTURE", "FUNCTIONS", "POLICIES", "ACL", "DATA"]) {
  assert.match(
    sql,
    new RegExp(`SECTION=${section}`),
    `recovery-signature.sql debe declarar la seccion ${section}`,
  );
}
console.log("PASS\tsignature_sections\tSTRUCTURE,FUNCTIONS,POLICIES,ACL,DATA");

assert.match(sql, /security_definer/i, "debe verificar SECURITY DEFINER");
assert.match(sql, /search_path/i, "debe verificar search_path fijado");
console.log("PASS\tsignature_security_definer_search_path");

assert.doesNotMatch(
  sql,
  /select\s+[^;]*\bdetalle\b[^;]*from\s+public\.bitacora/i,
  "no debe seleccionar la columna detalle en claro desde bitacora",
);
assert.match(
  sql,
  /to_jsonb\(t\)\s*-\s*'detalle'/,
  "debe excluir explicitamente la columna detalle via to_jsonb(t) - 'detalle'",
);
assert.doesNotMatch(
  sql,
  /from\s+public\.edge_idempotency/i,
  "edge_idempotency es efimera/excluida: la seccion DATA no debe tocarla",
);
console.log("PASS\tsignature_sensitive_columns_excluded\tbitacora.detalle,edge_idempotency");

// ---------------------------------------------------------------------------
// 4) recovery-data-order.txt: 22 tablas de datos + 4 excluidas = 26 (ST-03),
//    perfiles antes que el resto, auth.users documentado como prerequisito
//    externo, y el hallazgo de FK circular queda documentado.
// ---------------------------------------------------------------------------
const orderLines = order
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => /^\d+\s+public\./.test(l));
assert.equal(orderLines.length, 22, `se esperan 22 tablas con datos en el orden (encontradas: ${orderLines.length})`);
console.log(`PASS\tdata_order_count\t${orderLines.length}`);

const firstTable = orderLines[0].match(/public\.(\w+)/)[1];
assert.equal(firstTable, "perfiles", "public.perfiles debe ser la primera tabla del orden (FK a auth.users)");
console.log("PASS\tdata_order_perfiles_first");

for (const excluded of [
  "public.rate_limit_events",
  "public.edge_idempotency",
  "public.support_idempotency",
  "public.ticket_portal_logs",
]) {
  assert.match(order, new RegExp(`EXCLUDED ${excluded.replace(".", "\\.")}`), `debe listar como excluida: ${excluded}`);
}
console.log("PASS\tdata_order_excluded_count\t4");

assert.match(order, /auth\.users/, "debe documentar auth.users como prerequisito externo");
assert.match(order, /FK circular|circular/i, "debe documentar el hallazgo de FK circular tickets<->solicitudes_soporte");
console.log("PASS\tdata_order_circular_fk_documented");

// ---------------------------------------------------------------------------
// 5) Cruce contra las migraciones reales: las 26 tablas public referenciadas
//    en recovery-data-order.txt (22 incluidas + 4 excluidas) deben existir
//    de verdad en supabase/migrations (no inventadas).
// ---------------------------------------------------------------------------
const migrationFiles = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => `${MIGRATIONS_DIR}/${f}`);
const migrationsCorpus = migrationFiles.map((f) => readFileSync(f, "utf8")).join("\n");

const allOrderTables = [
  ...orderLines.map((l) => l.match(/public\.(\w+)/)[1]),
  "rate_limit_events",
  "edge_idempotency",
  "support_idempotency",
  "ticket_portal_logs",
];
assert.equal(allOrderTables.length, 26, "22 incluidas + 4 excluidas debe sumar 26 (ST-03)");

for (const t of allOrderTables) {
  const re = new RegExp(`create table\\s+(if not exists\\s+)?public\\.${t}\\b`, "i");
  assert.match(
    migrationsCorpus,
    re,
    `tabla referenciada en recovery-data-order.txt no existe en migraciones: public.${t}`,
  );
}
console.log(`PASS\tdata_order_matches_migrations\ttables=${allOrderTables.length}`);

assert.equal(migrationFiles.length, 31, `se esperan 31 migraciones (encontradas: ${migrationFiles.length})`);
console.log("PASS\tmigration_count\t31");

// ---------------------------------------------------------------------------
// 6) app_private no tiene tablas (verificado por el ticket): 0 CREATE TABLE
//    con schema app_private en las migraciones. Si esto cambia en el futuro,
//    este contrato debe fallar para forzar actualizar recovery-signature.sql
//    y recovery-data-order.txt.
// ---------------------------------------------------------------------------
assert.doesNotMatch(
  migrationsCorpus,
  /create table\s+(if not exists\s+)?app_private\./i,
  "app_private ya no esta vacio de tablas: actualizar allowlist de datos (recovery-data-order.txt/recovery-signature.sql)",
);
console.log("PASS\tapp_private_has_no_tables\t(allowlist de datos aplicada solo a public)");

// ---------------------------------------------------------------------------
// 7) RECOVERY_V2_RUNBOOK.md: disciplina de estado explicita y siguiente paso
//    literal (esta unidad no valida en vivo; debe decirlo sin ambigüedad).
// ---------------------------------------------------------------------------
assert.match(runbook, /IMPLEMENTADO LOCAL/, "el runbook debe declarar el estado IMPLEMENTADO LOCAL");
assert.match(runbook, /NO VALIDADO EN VIVO|VALIDADO EN VIVO.*(pendiente|no)/i, "el runbook debe declarar que NO esta validado en vivo");
assert.match(runbook, /RUN_FROM_MACOS_TERMINAL|Terminal macOS/i, "el runbook debe indicar la corrida real en Terminal macOS como siguiente paso");
console.log("PASS\trunbook_state_discipline");

console.log("RECOVERY_V2_CONTRACT=PASS");
