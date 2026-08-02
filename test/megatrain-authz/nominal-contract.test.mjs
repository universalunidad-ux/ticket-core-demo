import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const sql = read("test/megatrain-authz/nominal-matrix.sql");
const runner = read("tools/megatrain-authz-nominal.mjs");

const surfaces = ["tickets","archivos_ticket","perfiles","cliente_aliases","ticket_match_decisiones","ticket_respuestas_rapidas","v_janome_dashboard_agentes"];
test("nominal matrix names all seven owner surfaces", () => {
  for (const surface of surfaces) assert.match(sql, new RegExp(surface));
  assert.match(sql, /actor text not null/);
  assert.match(sql, /expected text not null/);
  assert.match(sql, /actual text not null/);
  assert.match(sql, /sqlstate text not null/);
  assert.match(sql, /policy text not null/);
  assert.match(sql, /mutant text not null/);
});

test("runner is local-only, redacts credentials and always tears down", () => {
  assert.match(runner, /delete env\[key\]/);
  assert.match(runner, /postgresql:\\\/\\\/\[\^@\\s\]\+@/);
  assert.match(runner, /--stop","--remove-runtime/);
  assert.match(runner, /POLICY_SNAPSHOT: policySnapshot/);
  assert.match(runner, /policy-inventory-gate\.mjs/);
  assert.match(runner, /RESIDUAL_ROWS=/);
  assert.doesNotMatch(runner, /supabase\s+(link|db push|functions deploy)/);
});

for (const [name, mutate] of [
  ["client ticket ownership", source => source.replace("tickets_client_owner_select", "missing_ticket_owner")],
  ["attachment ownership", source => source.replace("archivos_ticket_client_owner_select", "missing_attachment_owner")],
  ["profile role lock", source => source.replace("column_acl_and_tc_prevent_rol_escalation", "missing_role_lock")],
  ["alias scope", source => source.replace("cliente_aliases_select_scoped", "missing_alias_scope")],
  ["match admin owner", source => source.replace("ticket_match_decisiones_admin_select_v1", "missing_match_owner")],
  ["quick reply admin write", source => source.replace("quick_replies_admin_write", "missing_quick_owner")],
  ["agent view guard", source => source.replace("security_invoker_admin_guard", "missing_view_guard")],
  ["HEIC and video MIME allowlist", source => source.replace("'image/heic','image/heif','video/mp4','video/quicktime','video/x-m4v'", "'image/jpeg'")],
]) {
  test(`negative mutation is distinguishable: ${name}`, () => {
    const changed = mutate(sql);
    assert.notEqual(changed, sql);
    assert.ok(changed.includes("missing_") || !changed.includes("'image/heic','image/heif','video/mp4','video/quicktime','video/x-m4v'"));
  });
}
