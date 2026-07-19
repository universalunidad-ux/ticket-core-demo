#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const files = {
  m03: "supabase/migrations/20260717093100_authz_perfiles_rol_lock.sql",
  m04: "supabase/migrations/20260717093200_authz_tickets_clientes.sql",
  draft: "docs/CLIENT_ROLE_FILTER_RLS_DRAFT.sql",
  authz: "supabase/tests/authz_negative.sql",
};

const source = Object.fromEntries(
  Object.entries(files).map(([key, path]) => [
    key,
    readFileSync(path, "utf8"),
  ]),
);

const checks = [
  [
    "role domain accepts supervisor",
    () => assert.match(source.m03, /'supervisor'::text/),
  ],
  [
    "disabled access uses nullable role",
    () => {
      assert.match(source.m03, /alter column rol drop not null/i);
      assert.match(source.m03, /rol is null/i);
    },
  ],
  [
    "manager client boundary includes canonical origin",
    () => {
      assert.match(source.m04, /origen_registro/i);
      assert.match(source.m04, /'alta_interna'::text/);
      assert.match(source.m04, /'registro_aprobado'::text/);
    },
  ],
  [
    "legacy client-role draft is non-executable",
    () => {
      assert.match(source.draft, /SUPERSEDED_NON_EXECUTABLE/);
      assert.match(source.draft, /SAFE_TO_EXECUTE=NO/);
      assert.doesNotMatch(
        source.draft,
        /^\s*(?:begin|alter|create|drop|grant|revoke|commit)\b/im,
      );
    },
  ],
  [
    "staging authz covers origin-only boundary",
    () => {
      assert.match(source.authz, /Cliente Alta Interna/);
      assert.match(source.authz, /supervisor ve cliente alta_interna sin ticket/);
      assert.match(source.authz, /soporte no ve cliente sin ticket asignado/);
    },
  ],
  [
    "staging authz covers disabled-access null state",
    () => {
      assert.match(source.authz, /admin_disable_access/);
      assert.match(source.authz, /acceso desactivado mediante rol NULL/);
    },
  ],
];

for (const [name, run] of checks) {
  run();
  console.log(`PASS\t${name}`);
}

console.log(`PRESTAGING_AUTHZ_CONTRACT: PASS (${checks.length}/${checks.length})`);
