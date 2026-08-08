// TC-U15C-RUNTIME-IMPLEMENT-D1-D4-01
// Contrato ESTÁTICO (sin DB) sobre el fix D1-D4 de
// supabase/migrations/20260721014500_u15cd_consolidation_rpc.sql.
//
// Complementa (no reemplaza) tools/u15d-consolidation-rpc-contract.test.mjs,
// que ya cubre la forma general del RPC y queda fuera de alcance de esta
// unidad ("No tocar ... U15D"). Este archivo se enfoca específicamente en
// que D1 (acción de idempotencia), D2/D3 (documento_id) y D4 (whitelist de
// ticket_eventos.meta) queden y permanezcan resueltos, sin introducir un
// cuarto mecanismo de idempotencia ni ampliar la whitelist global.
//
// Uso: node tools/u15c-rpc-schema-contract.test.mjs
// No requiere PostgreSQL/Docker/Supabase: es análisis estático del SQL.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const read = (path) => readFileSync(join(ROOT, path), "utf8");

const MIGRATION_PATH =
  "supabase/migrations/20260721014500_u15cd_consolidation_rpc.sql";
const SEARCH_PATH_HARDENING_PATH =
  "supabase/migrations/20260724070000_tc_sec_sd_search_path.sql";
const ACL_RECONCILE_PATH =
  "supabase/migrations/20260724100000_tc_reconcile_edge_idempotency_acl.sql";
const EXTENSIONS_HELPERS_PATH =
  "supabase/migrations/20260715023815_extensions_and_helpers.sql";
const AUDIT_IDEMPOTENCY_PATH =
  "supabase/migrations/20260715023826_audit_rate_limit_and_idempotency.sql";
const RUNNER_PATH = "tools/local-db/run-u15c-runtime.sh";
const CONCURRENCY_MATRIX_PATH = "supabase/tests/u15c_concurrency_matrix.sql";

const migration = read(MIGRATION_PATH);
const searchPathHardening = read(SEARCH_PATH_HARDENING_PATH);
const aclReconcile = read(ACL_RECONCILE_PATH);
const extensionsHelpers = read(EXTENSIONS_HELPERS_PATH);
const auditIdempotency = read(AUDIT_IDEMPOTENCY_PATH);
const runner = read(RUNNER_PATH);
const concurrencyMatrix = read(CONCURRENCY_MATRIX_PATH);

const RPC_SIGNATURE = "uuid, text, bigint, text, uuid, uuid, jsonb, jsonb";

let passed = 0;
const test = (name, fn) => {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
};

// Extrae el bloque entre dos marcadores de texto (ambos deben existir).
const sliceBetween = (text, startMarker, endMarker) => {
  const start = text.indexOf(startMarker);
  assert.ok(start >= 0, `marcador de inicio no encontrado: ${startMarker}`);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `marcador de fin no encontrado: ${endMarker}`);
  return text.slice(start, end);
};

const validateRowLocks = (sql) => {
  assert.match(
    sql,
    /from public\.edge_idempotency[\s\S]*?where idempotency_key = trim\(p_idempotency_key\)[\s\S]*?for update;/,
  );
  assert.match(
    sql,
    /from public\.tickets[\s\S]*?where id = p_ticket_id[\s\S]*?for update;/,
  );
};

const validateExactSignature = (sql) => {
  assert.match(
    sql,
    /create or replace function public\.tc_consolidar_cliente_ticket\(\s*p_ticket_id uuid,\s*p_action text,\s*p_expected_version bigint,\s*p_idempotency_key text,\s*p_cliente_id uuid default null,\s*p_contacto_id uuid default null,\s*p_cliente jsonb default '\{\}'::jsonb,\s*p_contacto jsonb default '\{\}'::jsonb\s*\)/,
  );
};

const validateMandatoryTeardown = (text) => {
  assert.match(text, /trap cleanup EXIT/);
  assert.match(text, /--stop --remove-runtime/);
  assert.match(text, /count_owned_containers/);
  assert.match(text, /count_owned_volumes/);
  assert.match(text, /count_owned_networks/);
  assert.doesNotMatch(text, /--keep-data|--keep-up/);
};

const validateExactlyOneWinner = (sql) => {
  assert.match(sql, /TC_C3_EXACTLY_ONE_WINNER=PASS/);
  assert.match(
    sql,
    /idempotency_key in \('tc-u15c-conc-c3-key-A-0001', 'tc-u15c-conc-c3-key-B-0001'\)\) = 1/,
  );
  assert.match(sql, /and status = 'completed'\) = 1/);
};

const validateSameTransactionAuth = (sql) => {
  const activations = sql.match(
    /begin;\s+select pg_temp\.act\('95555555-1111-4111-8111-555555555501'\);/g,
  ) || [];
  assert.equal(
    activations.length,
    6,
    "cada transacción C1-C5 debe instalar su contexto Auth dentro de la misma transacción",
  );
};

// ---------------------------------------------------------------------------
// D1 · Idempotencia reutiliza edge_idempotency con una acción YA válida en
// el CHECK canónico ('consolidar_cliente'), sin crear un cuarto mecanismo.
// ---------------------------------------------------------------------------

test("D1: el CHECK canónico de edge_idempotency.action ya admite 'consolidar_cliente'", () => {
  assert.match(auditIdempotency, /action in \(/);
  assert.match(auditIdempotency, /'consolidar_cliente'/);
  assert.doesNotMatch(auditIdempotency, /'tc_consolidar_cliente_ticket'/);
});

test("D1: el claim de idempotencia del RPC usa 'consolidar_cliente'", () => {
  const claimBlock = sliceBetween(
    migration,
    "insert into public.edge_idempotency (",
    "on conflict (idempotency_key) do nothing;",
  );
  assert.match(claimBlock, /'consolidar_cliente'/);
  assert.doesNotMatch(claimBlock, /'tc_consolidar_cliente_ticket'/);
});

test("D1: la comparación de mismatch también usa 'consolidar_cliente'", () => {
  assert.match(
    migration,
    /v_idempotency\.action is distinct from\s+'consolidar_cliente'/,
  );
});

test("D1: 'tc_consolidar_cliente_ticket' no aparece como valor de acción en ningún literal de texto", () => {
  const actionStringLiteral = /'tc_consolidar_cliente_ticket'/g;
  const matches = migration.match(actionStringLiteral) || [];
  assert.equal(
    matches.length,
    0,
    "tc_consolidar_cliente_ticket no debe usarse como string de acción (solo como nombre de función)",
  );
});

test("D1: no se crea una tabla ni un CHECK de idempotencia nuevo (cuarto mecanismo)", () => {
  assert.doesNotMatch(migration, /create table[^;]*idempotency/i);
  assert.doesNotMatch(migration, /alter table public\.edge_idempotency/i);
  assert.doesNotMatch(migration, /drop constraint[^;]*edge_idempotency/i);
});

test("D1: sigue reutilizando public.edge_idempotency (no un helper nuevo ni otra tabla)", () => {
  assert.match(migration, /insert into public\.edge_idempotency/);
  assert.match(migration, /update public\.edge_idempotency/);
});

// ---------------------------------------------------------------------------
// D2/D3 · documento_id no existe en tickets ni bitacora; no se crea columna.
// ---------------------------------------------------------------------------

test("D2/D3: la migración no referencia documento_id en ningún punto ejecutable", () => {
  const codeLines = migration
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"));
  const withDocumentoId = codeLines.filter((line) =>
    /documento_id/i.test(line),
  );
  assert.equal(
    withDocumentoId.length,
    0,
    `líneas de código con documento_id: ${JSON.stringify(withDocumentoId)}`,
  );
});

test("D2/D3: no se agrega la columna documento_id a tickets ni bitacora", () => {
  assert.doesNotMatch(migration, /add column[^;]*documento_id/i);
});

test("D2/D3: bitacora usa entidad_tipo/entidad_id reales en vez de documento_id", () => {
  const bitacoraBlock = sliceBetween(
    migration,
    "insert into public.bitacora (",
    "'interna',\n    'nota_interna'\n  );",
  );
  assert.match(bitacoraBlock, /entidad_tipo/);
  assert.match(bitacoraBlock, /entidad_id/);
  assert.match(bitacoraBlock, /'ticket'/);
  assert.doesNotMatch(bitacoraBlock, /documento_id/);
});

// ---------------------------------------------------------------------------
// D4 · ticket_eventos.meta se limita al payload mínimo permitido por
// app_private.ticket_event_meta_is_safe. La whitelist NO se amplía.
// ---------------------------------------------------------------------------

test("D4: la whitelist global app_private.ticket_event_meta_is_safe no fue modificada", () => {
  assert.match(extensionsHelpers, /'accion', 'por', 'cliente_id', 'contacto_id'/);
  assert.doesNotMatch(extensionsHelpers, /'operation_id'/);
  assert.doesNotMatch(extensionsHelpers, /'previous_version'/);
  assert.doesNotMatch(extensionsHelpers, /'new_version'/);
});

test("D4: ticket_eventos.meta usa solo claves de la whitelist", () => {
  const eventBlock = sliceBetween(
    migration,
    "insert into public.ticket_eventos (",
    "insert into public.bitacora (",
  );

  const ALLOWED_META_KEYS = new Set([
    "canal", "folio", "estado_anterior", "estado_nuevo", "reply_to",
    "reply_to_autor_tipo", "reply_to_kind", "reply_to_texto",
    "reply_preview", "reply_author", "reply_kind", "idempotency_key",
    "archivos_count", "adjuntos", "errores", "accion", "por", "cliente_id",
    "contacto_id", "requiere_consolidacion", "empresa_capturada",
    "nombre_capturado", "cliente_id_sugerido", "contacto_id_sugerido",
    "capturado_preservado", "asignado_a", "prioridad", "sla_policy",
    "migrated_from", "legacy_id", "origen", "autor", "autor_id", "sistema",
    "replyAction", "quick_key", "target_role", "requires_admin_review",
    "nota_cierre", "actor_id", "actor_nombre", "actor_rol", "ref_evento_id",
    "ref_evento_preview", "ref_archivo_id", "ref_archivo_meta", "comentario",
    "content_type",
  ]);

  const metaObjectBlock = sliceBetween(
    eventBlock,
    "jsonb_build_object(",
    ")\n  );",
  );

  const keyMatches = [...metaObjectBlock.matchAll(/'([a-zA-Z_]+)',/g)].map(
    (m) => m[1],
  );

  assert.ok(keyMatches.length > 0, "no se encontraron claves en meta");

  for (const key of keyMatches) {
    assert.ok(
      ALLOWED_META_KEYS.has(key),
      `clave fuera de whitelist en ticket_eventos.meta: ${key}`,
    );
  }

  assert.doesNotMatch(eventBlock, /'event',/);
  assert.doesNotMatch(eventBlock, /'action',/);
  assert.doesNotMatch(eventBlock, /'operation_id',/);
  assert.doesNotMatch(eventBlock, /'previous_version',/);
  assert.doesNotMatch(eventBlock, /'new_version',/);
});

test("D4: el payload mínimo esperado (accion, idempotency_key, cliente_id, contacto_id) sigue presente", () => {
  const eventBlock = sliceBetween(
    migration,
    "insert into public.ticket_eventos (",
    "insert into public.bitacora (",
  );
  assert.match(eventBlock, /'accion', p_action/);
  assert.match(eventBlock, /'idempotency_key', trim\(p_idempotency_key\)/);
  assert.match(eventBlock, /'cliente_id', v_final_cliente_id/);
  assert.match(eventBlock, /'contacto_id', v_final_contacto_id/);
});

test("D4: la trazabilidad completa (operation_id/previous_version/new_version) se conserva en bitacora.detalle (sin whitelist)", () => {
  const bitacoraBlock = sliceBetween(
    migration,
    "insert into public.bitacora (",
    "'interna',\n    'nota_interna'\n  );",
  );
  assert.match(bitacoraBlock, /'operation_id', v_operation_id/);
  assert.match(bitacoraBlock, /'previous_version', v_ticket\.consolidacion_version/);
  assert.match(
    bitacoraBlock,
    /'new_version', v_ticket\.consolidacion_version \+ 1/,
  );
});

// ---------------------------------------------------------------------------
// Seguridad: SECURITY DEFINER, search_path, grants, coexistencia, firma.
// ---------------------------------------------------------------------------

test("seguridad: RPC sigue SECURITY DEFINER con search_path fijo", () => {
  assert.match(migration, /security definer/);
  assert.match(migration, /set search_path = public, pg_temp/);
});

test("seguridad: grants fail-closed sin cambios (revoke public/anon, grant authenticated)", () => {
  const sig = RPC_SIGNATURE;
  assert.ok(
    migration.includes(
      `revoke execute on function public.tc_consolidar_cliente_ticket(${sig}) from public;`,
    ),
  );
  assert.ok(
    migration.includes(
      `revoke execute on function public.tc_consolidar_cliente_ticket(${sig}) from anon;`,
    ),
  );
  assert.ok(
    migration.includes(
      `grant execute on function public.tc_consolidar_cliente_ticket(${sig}) to authenticated;`,
    ),
  );
});

test("seguridad: la firma de la función no cambió (compatibilidad con el endurecimiento posterior de search_path)", () => {
  const expectedSignature = `public.tc_consolidar_cliente_ticket(uuid,text,bigint,text,uuid,uuid,jsonb,jsonb)`;
  assert.ok(
    searchPathHardening.includes(expectedSignature),
    "20260724070000_tc_sec_sd_search_path.sql depende de esta firma exacta",
  );
  assert.match(
    migration,
    /create or replace function public\.tc_consolidar_cliente_ticket\(\s*p_ticket_id uuid,\s*p_action text,\s*p_expected_version bigint,\s*p_idempotency_key text,\s*p_cliente_id uuid default null,\s*p_contacto_id uuid default null,\s*p_cliente jsonb default '\{\}'::jsonb,\s*p_contacto jsonb default '\{\}'::jsonb\s*\)/,
  );
});

test("concurrencia: los locks de idempotencia y ticket son obligatorios", () => {
  validateRowLocks(migration);
});

test("runner: el stack efímero y el teardown de objetos Docker son obligatorios", () => {
  validateMandatoryTeardown(runner);
  assert.match(runner, /EXPECTED_BRANCH='feat\/u15c-runtime-concurrency-afa3099-20260802'/);
  assert.match(runner, /tools\/local-db\/lib\/bootstrap\.mjs/);
});

test("matriz: C3 exige exactamente un ganador persistido", () => {
  validateExactlyOneWinner(concurrencyMatrix);
});

test("matriz: las dos sesiones conservan Auth dentro de cada transacción", () => {
  validateSameTransactionAuth(concurrencyMatrix);
});

test("mutante sin lock: el contrato falla cerrado", () => {
  const mutant = migration.replaceAll("for update;", ";");
  assert.throws(() => validateRowLocks(mutant));
});

test("mutante de firma RPC incorrecta: el contrato falla cerrado", () => {
  const mutant = migration.replace("p_expected_version bigint", "p_expected_version text");
  assert.throws(() => validateExactSignature(mutant));
});

test("mutante sin teardown: el contrato falla cerrado", () => {
  const mutant = runner.replace("--stop --remove-runtime", "--stop");
  assert.throws(() => validateMandatoryTeardown(mutant));
});

test("mutante de dos ganadores: el contrato falla cerrado", () => {
  const mutant = concurrencyMatrix.replace(
    "and status = 'completed') = 1",
    "and status = 'completed') = 2",
  );
  assert.throws(() => validateExactlyOneWinner(mutant));
});

test("mutante Auth fuera de transacción: el contrato falla cerrado", () => {
  const mutant = concurrencyMatrix.replace(
    "begin;\n  select pg_temp.act",
    "select pg_temp.act",
  );
  assert.throws(() => validateSameTransactionAuth(mutant));
});

test("seguridad: ACL de edge_idempotency no se toca en esta migración (contrato cerrado en su propia migración)", () => {
  assert.doesNotMatch(migration, /grant[^;]*edge_idempotency/i);
  assert.doesNotMatch(migration, /revoke[^;]*edge_idempotency/i);
  assert.match(aclReconcile, /grant select, insert, update\s*on table public\.edge_idempotency\s*to service_role;/);
});

test("coexistencia: no se elimina ni redefine public.consolidate_ticket_client (sin tercer override no autorizado)", () => {
  // Se permite mencionar la función en comentarios explicativos (decisión de
  // diseño documentada); lo que no se permite es tocarla como objeto SQL.
  assert.doesNotMatch(
    migration,
    /(drop function|create or replace function|alter function)\s+(if exists\s+)?public\.consolidate_ticket_client/i,
  );
});

test("PREPARED_NOT_APPLIED se mantiene hasta validación runtime real (Docker/Supabase local)", () => {
  assert.match(migration, /-- PREPARED_NOT_APPLIED/);
});

console.log(`U15C_RPC_SCHEMA_CONTRACT_TESTS=PASS (${passed})`);
