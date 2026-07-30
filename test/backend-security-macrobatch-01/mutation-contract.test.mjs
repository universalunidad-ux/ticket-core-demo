import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../../supabase/migrations/20260730081307_backend_security_macrobatch_01.sql", import.meta.url),
  "utf8",
);

function passes(sql) {
  return /STATIC_CONTRACT_ONLY/.test(sql)
    && /TC_BSM01_PROFILE_PRIVILEGE_OVERGRANT/.test(sql)
    && /TC_BSM01_PUBLIC_SECURITY_DEFINER/.test(sql)
    && /from public, anon, authenticated/.test(sql)
    && (sql.match(/tc_current_client_id\(\)/g) || []).length >= 6
    && (sql.match(/enable row level security/g) || []).length === 3
    && !/with check\s*\(\s*true\s*\)/i.test(sql);
}

test("21 canonical source satisfies mutation oracle", () => {
  assert.equal(passes(source), true);
});

test("22 mutation: dropping static-only marker fails", () => {
  assert.equal(passes(source.replace("STATIC_CONTRACT_ONLY", "RUNTIME_PASS")), false);
});

test("23 mutation: dropping profile overgrant verifier fails", () => {
  assert.equal(passes(source.replace("TC_BSM01_PROFILE_PRIVILEGE_OVERGRANT", "REMOVED")), false);
});

test("24 mutation: dropping PUBLIC ACL verifier fails", () => {
  assert.equal(passes(source.replace("TC_BSM01_PUBLIC_SECURITY_DEFINER", "REMOVED")), false);
});

test("25 mutation: granting trigger execution fails", () => {
  assert.equal(passes(source.replace("from public, anon, authenticated", "from public, anon")), false);
});

test("26 mutation: weakening a client predicate fails", () => {
  assert.equal(
    passes(source.replaceAll("tc_current_client_id()", "current_setting('request.client_id')")),
    false,
  );
});

test("27 mutation: disabling one RLS table fails", () => {
  assert.equal(
    passes(source.replace("enable row level security", "disable row level security")),
    false,
  );
});

test("28 mutation: always-true WITH CHECK fails", () => {
  assert.equal(
    passes(source.replace(
      "with check (\n    id = (select auth.uid())",
      "with check (true) /*\n    id = (select auth.uid())",
    )),
    false,
  );
});
