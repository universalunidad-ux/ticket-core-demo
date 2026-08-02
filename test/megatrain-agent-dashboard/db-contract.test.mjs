import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../../supabase/migrations/20260802030445_agent_dashboard_view_grants_rls.sql", import.meta.url),
  "utf8",
);

function validate(sql) {
  assert.match(sql, /create view public\.v_janome_dashboard_agentes\s+with \(security_invoker = true\)/i);
  assert.match(sql, /app_private\.has_role\(array\['admin'\]\)/i);
  assert.match(sql, /where p\.rol = 'soporte'\s+and p\.activo/i);
  assert.match(sql, /revoke all on table public\.v_janome_dashboard_agentes\s+from public, anon, authenticated;/i);
  assert.match(sql, /grant select on table public\.v_janome_dashboard_agentes\s+to authenticated, service_role;/i);
  assert.match(sql, /TC_AGENT_DASHBOARD_VIEW_NOT_SECURITY_INVOKER/);
  assert.match(sql, /TC_AGENT_DASHBOARD_ADMIN_GUARD_MISSING/);
  assert.match(sql, /TC_AGENT_DASHBOARD_ANON_SELECT_EXPOSED/);
}

test("agent dashboard SQL contract is fail closed", () => validate(migration));

for (const [name, mutate] of [
  ["security invoker", sql => sql.replace("with (security_invoker = true)", "")],
  ["admin predicate", sql => sql.replace("and app_private.has_role(array['admin'])", "and true")],
  ["anon revoke", sql => sql.replace("from public, anon, authenticated;", "from public, authenticated;")],
]) {
  test(`negative mutation rejects missing ${name}`, () => {
    assert.throws(() => validate(mutate(migration)));
  });
}
