import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);

const read = path =>
  readFileSync(join(ROOT, path), "utf8");

const migration = read(
  "supabase/migrations/20260721014500_u15cd_consolidation_rpc.sql",
);

const workflow = read(
  ".github/workflows/frontend-gates.yml",
);

const frontend = read(
  "app/consolidacion-clientes.js",
);

let passed = 0;

const test = (name, fn) => {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
};

test("migración permanece PREPARED_NOT_APPLIED", () => {
  assert.match(migration, /-- PREPARED_NOT_APPLIED/);
  assert.match(migration, /-- TC-U15C-D/);
});

test("añade versión monotónica dedicada", () => {
  assert.match(
    migration,
    /add column if not exists consolidacion_version bigint not null default 0/,
  );

  assert.match(
    migration,
    /tickets_consolidacion_version_nonnegative_chk/,
  );
});

test("RPC es SECURITY DEFINER con search_path fijo", () => {
  assert.match(
    migration,
    /create or replace function public\.tc_consolidar_cliente_ticket\(/,
  );

  assert.match(migration, /security definer/);

  assert.match(
    migration,
    /set search_path = public, pg_temp/,
  );
});

test("autorización v1 es exclusivamente admin", () => {
  assert.match(
    migration,
    /v_role := public\.tc_current_role\(\)/,
  );

  assert.match(
    migration,
    /v_role is distinct from 'admin'/,
  );

  assert.doesNotMatch(
    migration,
    /v_role[^;\n]*(owner|administrador|supervisor)/,
  );
});

test("grants son fail-closed", () => {
  assert.match(
    migration,
    /revoke all on function public\.tc_consolidar_cliente_ticket[\s\S]*from public/,
  );

  assert.match(
    migration,
    /revoke all on function public\.tc_consolidar_cliente_ticket[\s\S]*from anon/,
  );

  assert.match(
    migration,
    /grant execute on function public\.tc_consolidar_cliente_ticket[\s\S]*to authenticated/,
  );
});

test("bloquea ticket antes de comparar versión", () => {
  const lock = migration.indexOf(
    "where id = p_ticket_id\n    for update;",
  );

  const compare = migration.indexOf(
    "v_ticket.consolidacion_version <> p_expected_version",
  );

  assert.ok(lock >= 0);
  assert.ok(compare > lock);
});

test("no usa fecha_actualizacion como expected_version", () => {
  assert.match(
    migration,
    /p_expected_version bigint/,
  );

  assert.match(
    migration,
    /consolidacion_version <> p_expected_version/,
  );

  assert.doesNotMatch(
    migration,
    /fecha_actualizacion\s*<>\s*p_expected_version/,
  );
});

test("reutiliza edge_idempotency sin crear otra tabla", () => {
  assert.match(
    migration,
    /insert into public\.edge_idempotency/,
  );

  assert.match(
    migration,
    /on conflict \(idempotency_key\) do nothing/,
  );

  assert.match(
    migration,
    /IDEMPOTENCY_PAYLOAD_MISMATCH/,
  );

  assert.match(
    migration,
    /'replayed', true/,
  );

  assert.doesNotMatch(
    migration,
    /create table[^;]*edge_idempotency/,
  );
});

test("declara exactamente las cuatro acciones", () => {
  for (const action of [
    "associate_existing",
    "create_new",
    "discard_candidate",
    "postpone",
  ]) {
    assert.match(
      migration,
      new RegExp(`'${action}'`),
    );
  }
});

test("contacto debe pertenecer al cliente", () => {
  assert.match(
    migration,
    /from public\.clientes_contactos[\s\S]*cliente_id = v_final_cliente_id/,
  );

  assert.match(
    migration,
    /CONTACT_NOT_OWNED_BY_CLIENT/,
  );
});

test("actualiza decisión, evento y bitácora", () => {
  assert.match(
    migration,
    /update public\.ticket_match_decisiones/,
  );

  assert.match(
    migration,
    /insert into public\.ticket_eventos/,
  );

  assert.match(
    migration,
    /insert into public\.bitacora/,
  );
});

test("incrementa la versión exactamente en uno", () => {
  assert.match(
    migration,
    /consolidacion_version = consolidacion_version \+ 1/,
  );

  assert.match(
    migration,
    /'new_version', v_ticket\.consolidacion_version \+ 1/,
  );
});

test("incluye los tres índices faltantes", () => {
  for (const indexName of [
    "idx_tickets_cliente_id_sugerido",
    "idx_tickets_contacto_id",
    "idx_tickets_contacto_id_sugerido",
  ]) {
    assert.match(
      migration,
      new RegExp(`create index if not exists ${indexName}`),
    );
  }
});

test("frontend permanece deshabilitado", () => {
  assert.match(
    frontend,
    /CONSOLIDATION_EXECUTION_ENABLED = false/,
  );

  assert.doesNotMatch(
    frontend,
    /\.rpc\(/,
  );

  assert.doesNotMatch(
    frontend,
    /functions\.invoke/,
  );
});

test("contract test está registrado en CI", () => {
  assert.match(
    workflow,
    /node tools\/u15d-consolidation-rpc-contract\.test\.mjs/,
  );
});

console.log(
  `U15D_CONSOLIDATION_RPC_CONTRACT_TESTS=PASS (${passed})`,
);
