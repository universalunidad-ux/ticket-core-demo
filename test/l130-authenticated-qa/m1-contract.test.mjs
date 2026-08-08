import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..", "..");
const read = path => readFileSync(resolve(ROOT, path), "utf8");
const migration = read("supabase/migrations/20260729010000_l130_m1_authenticated_client.sql");

test("M1 uses a persistent unique auth.users to contact link", () => {
  assert.match(migration, /add column if not exists auth_user_id uuid[\s\S]+references auth\.users\(id\)/i);
  assert.match(migration, /unique index[\s\S]+auth_user_id/i);
  assert.match(migration, /cc\.auth_user_id = \(select auth\.uid\(\)\)/i);
  assert.match(migration, /cc\.activo[\s\S]+c\.activo[\s\S]+c\.estatus <> 'inactivo'/i);
});

test("M1 derives ticket ownership server-side and adds no client writes", () => {
  assert.match(migration, /create policy tickets_client_owner_select[\s\S]+cliente_id = public\.tc_current_client_id\(\)/i);
  assert.match(migration, /create policy contactos_client_self_select/i);
  assert.doesNotMatch(migration, /create policy tickets_client_\w*(?:insert|update|delete)/i);
  assert.doesNotMatch(migration, /grant (?:insert|update|delete)[^;]*tickets to authenticated/i);
  assert.doesNotMatch(migration, /lower\s*\(\s*(?:correo|email)/i);
});

test("M1 leaves internal roles unchanged and does not implement M2", () => {
  const roles = read("supabase/migrations/20260717093100_authz_perfiles_rol_lock.sql");
  assert.doesNotMatch(roles, /'cliente'::text/);
  assert.doesNotMatch(migration, /create\s+table[\s\S]{0,80}(?:membership|membres[ií]a)/i);
  assert.doesNotMatch(migration, /company_selector|client_user_memberships/i);
  assert.match(migration, /M2 multi-company memberships remain explicitly deferred/i);
});

test("client portal never sends cliente_id and contains no privileged key", () => {
  const portal = read("app/portal-cliente.js");
  assert.match(portal, /\.eq\("auth_user_id", auth\.user\.id\)/);
  assert.doesNotMatch(portal, /\.eq\("cliente_id"/);
  assert.doesNotMatch(portal, /service[_-]?role|secret[_-]?key/i);
  assert.match(portal, /guardSession/);
  assert.match(portal, /logout/);
});

test("login routes M1 clients to portal and internal routes fail closed", () => {
  const login = read("app/index.js");
  const nav = read("app/shared/nav-interna.js");
  assert.match(login, /portal-cliente\.html/);
  assert.match(login, /\.from\("clientes_contactos"\)[\s\S]+\.eq\("auth_user_id", user\.id\)/);
  assert.match(nav, /!\["admin","supervisor","ventas","soporte"\]\.includes\(rol\)/);
  assert.match(nav, /location\.replace\("portal-cliente\.html"\)/);
});

test("service_role is absent from all browser M1 sources", () => {
  const browserSources = [
    read("app/index.js"),
    read("app/portal-cliente.js"),
    read("app/portal-cliente.html"),
    read("app/shared/nav-interna.js"),
  ].join("\n");
  assert.doesNotMatch(browserSources, /service[_-]?role/i);
});
