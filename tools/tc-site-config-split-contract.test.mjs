#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  readdirSync,
  readFileSync,
} from "node:fs";
import {
  dirname,
  join,
} from "node:path";
import {
  fileURLToPath,
} from "node:url";

const root = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);

const read = path =>
  readFileSync(join(root, path), "utf8");

const migrationPaths = {
  rls: "supabase/migrations/20260717093300_authz_bitacora_ratelimit_solicitudes.sql",
  grants: "supabase/migrations/20260717093400_authz_grants.sql",
  securityDefiner: "supabase/migrations/20260721083212_tc_sec_sd_grants.sql",
};

const migrations = Object.fromEntries(
  Object.entries(migrationPaths).map(([name, path]) => [name, read(path)]),
);

const draft = read(
  "docs/sql-drafts/tc-u15e-site-config-deferred.sql",
);

const workflow = read(
  ".github/workflows/frontend-gates.yml",
);

const stripSqlComments = source =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--[^\r\n]*/g, "");

const sha256 = source =>
  createHash("sha256").update(source).digest("hex");

let passed = 0;

const test = (name, callback) => {
  callback();
  passed += 1;
  console.log(`PASS ${name}`);
};

test("las migraciones foco no ejecutan referencias a site_config", () => {
  for (const name of ["rls", "grants"]) {
    assert.doesNotMatch(
      stripSqlComments(migrations[name]),
      /\bpublic\s*\.\s*site_config\b/i,
      `${name} todavía referencia public.site_config`,
    );
  }
});

test("las dos migraciones foco conservan SQL ejecutable", () => {
  for (const name of ["rls", "grants"]) {
    const executable = stripSqlComments(migrations[name]).trim();
    assert.ok(executable.length > 0, `${name} quedó vacía`);
    assert.match(executable, /;/, `${name} no contiene sentencias`);
  }
});

test("permanecen los cinco bloques RLS válidos", () => {
  for (const table of [
    "bitacora",
    "rate_limit_events",
    "solicitudes_soporte",
    "ticket_eventos",
    "archivos_ticket",
  ]) {
    assert.match(
      migrations.rls,
      new RegExp(
        `alter table public\\.${table} enable row level security;`,
      ),
    );
  }

  for (const policy of [
    "bitacora_select_admin",
    "solicitudes_manager_select",
    "solicitudes_support_select_assigned",
    "ticket_eventos_staff_select",
    "archivos_ticket_staff_select",
  ]) {
    assert.match(migrations.rls, new RegExp(policy));
  }
});

test("permanecen los grants y revokes ajenos a site_config", () => {
  for (const table of [
    "perfiles",
    "tickets",
    "clientes",
    "clientes_contactos",
    "cliente_sistemas",
    "cliente_aliases",
    "solicitudes_soporte",
    "bitacora",
    "rate_limit_events",
    "ticket_eventos",
    "archivos_ticket",
  ]) {
    assert.match(
      migrations.grants,
      new RegExp(
        `revoke select, insert, update, delete on public\\.${table} from anon;`,
      ),
    );
  }

  for (const table of [
    "perfiles",
    "tickets",
    "clientes",
    "clientes_contactos",
    "cliente_sistemas",
    "cliente_aliases",
    "solicitudes_soporte",
    "bitacora",
    "ticket_eventos",
    "archivos_ticket",
  ]) {
    assert.match(
      migrations.grants,
      new RegExp(`grant [^;]+ on public\\.${table} to authenticated;`),
    );
  }
});

test("el draft es no ejecutable y conserva ambos orígenes", () => {
  assert.match(draft, /PREPARED_NOT_APPLIED/);
  assert.match(draft, /NON_EXECUTABLE_DEFERRED_SQL/);
  assert.match(draft, /public\.site_config está ausente en live/);
  assert.match(
    draft,
    /20260717093300_authz_bitacora_ratelimit_solicitudes\.sql:60-70/,
  );
  assert.match(
    draft,
    /20260717093400_authz_grants\.sql:16/,
  );
  assert.match(
    draft,
    /20260717093400_authz_grants\.sql:30/,
  );
  assert.match(draft, /DO_NOT_APPLY_WITHOUT_A_FUTURE_PRODUCT_DECISION/);
  assert.equal(stripSqlComments(draft).trim(), "");
});

test("el draft conserva literalmente los fragmentos diferidos", () => {
  const expectedRls = `-- site_config: lectura para autenticados (config-loader); escritura solo admin.
alter table public.site_config enable row level security;
drop policy if exists site_config_read on public.site_config;
create policy site_config_read
  on public.site_config for select to authenticated
  using (true);
drop policy if exists site_config_admin_write on public.site_config;
create policy site_config_admin_write
  on public.site_config for all to authenticated
  using (public.tc_is_admin())
  with check (public.tc_is_admin());`;

  assert.ok(draft.includes(expectedRls));
  assert.ok(draft.includes(
    "revoke select, insert, update, delete on public.site_config from anon;",
  ));
  assert.ok(draft.includes(
    "grant select, insert, update on public.site_config to authenticated;",
  ));
});

test("ninguna migración activa crea public.site_config", () => {
  const directory = join(root, "supabase/migrations");
  for (const file of readdirSync(directory).filter(name =>
    name.endsWith(".sql")
  )) {
    assert.doesNotMatch(
      stripSqlComments(read(`supabase/migrations/${file}`)),
      /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?public\s*\.\s*site_config\b/i,
      `${file} crea public.site_config`,
    );
  }
});

test("no hay shell accidental en los artefactos SQL del split", () => {
  const shell = /^\s*(?:#!\/|set\s+-[A-Za-z]*[eEuxo]|(?:ba|z|k)?sh\s+|git\s+(?:add|commit|push)\b|supabase\s+|psql\s+)/im;
  for (const [name, source] of Object.entries({
    rls: migrations.rls,
    grants: migrations.grants,
    draft,
  })) {
    assert.doesNotMatch(source, shell, `${name} contiene shell`);
  }
});

test("se conserva la identidad de las cinco funciones vivas", () => {
  assert.equal(
    sha256(migrations.securityDefiner),
    "359f5298d4ec087a17a1c70bdd5cd1f05c47f659546e0a3f267c89e074cb5bf6",
  );

  for (const identity of [
    "public.current_user_role()",
    "public.get_ticket_portal(text,text)",
    "public.is_admin()",
    "public.is_support_or_admin()",
    "public.log_ticket_assignment_event()",
  ]) {
    assert.ok(
      migrations.securityDefiner.includes(identity),
      `identidad viva ausente: ${identity}`,
    );
  }
});

test("F-02 permanece adjudicado como falso positivo", () => {
  assert.match(
    migrations.securityDefiner,
    /pg_get_function_identity_arguments\(p\.oid\)\s*=\s*'p_folio text, p_token text'/,
  );
  assert.doesNotMatch(
    migrations.securityDefiner,
    /pg_get_function_identity_arguments\(p\.oid\)\s*=\s*'text, text'/,
  );
});

test("el contrato está registrado una sola vez en CI", () => {
  assert.equal(
    (
      workflow.match(
        /node tools\/tc-site-config-split-contract\.test\.mjs/g,
      ) || []
    ).length,
    1,
  );
});

console.log(
  `TC_SITE_CONFIG_SPLIT_CONTRACT=PASS (${passed})`,
);
