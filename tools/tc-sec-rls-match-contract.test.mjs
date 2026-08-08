import assert from "node:assert/strict";
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

const migrationDirectory = join(
  root,
  "supabase/migrations",
);

const migrations = readdirSync(
  migrationDirectory,
).filter(name =>
  name.endsWith("_tc_sec_rls_match.sql"),
);

assert.equal(
  migrations.length,
  1,
  `migraciones TC-SEC-RLS-MATCH: ${migrations.length}`,
);

const migration = readFileSync(
  join(migrationDirectory, migrations[0]),
  "utf8",
);

const workflow = readFileSync(
  join(
    root,
    ".github/workflows/frontend-gates.yml",
  ),
  "utf8",
);

let passed = 0;

const test = (name, callback) => {
  callback();
  passed += 1;
  console.log(`PASS ${name}`);
};

test("permanece PREPARED_NOT_APPLIED", () => {
  assert.match(
    migration,
    /-- PREPARED_NOT_APPLIED/,
  );

  assert.equal(
    (
      migration.match(/-- TC-SEC-RLS-MATCH/g) || []
    ).length,
    1,
  );
});

test("existe una sola migración", () => {
  assert.equal(migrations.length, 1);
});

test("elimina las tres policies permisivas", () => {
  for (const policy of [
    "ticket_match_decisiones_insert_auth",
    "ticket_match_decisiones_select_auth",
    "ticket_match_decisiones_update_auth",
  ]) {
    assert.match(
      migration,
      new RegExp(
        `drop policy if exists ${policy}`,
      ),
    );
  }
});

test("crea sólo una policy SELECT admin", () => {
  assert.equal(
    (
      migration.match(/\bcreate policy\b/g) || []
    ).length,
    1,
  );

  assert.match(
    migration,
    /create policy ticket_match_decisiones_admin_select_v1/,
  );

  assert.match(
    migration,
    /for select[\s\S]*to authenticated/,
  );

  assert.match(
    migration,
    /tc_current_role\(\)[\s\S]{0,100}=\s*'admin'/,
  );
});

test("no crea policies de escritura", () => {
  const start = migration.indexOf(
    "create policy ticket_match_decisiones_admin_select_v1",
  );

  const end = migration.indexOf(
    "revoke all",
    start,
  );

  assert.ok(start >= 0);
  assert.ok(end > start);

  const policy = migration.slice(start, end);

  assert.doesNotMatch(
    policy,
    /for\s+(insert|update|delete|all)/i,
  );
});

test("revoca PUBLIC y anon", () => {
  assert.match(
    migration,
    /revoke all[\s\S]*from public/,
  );

  assert.match(
    migration,
    /revoke all[\s\S]*from anon/,
  );
});

test("authenticated pierde DML directo", () => {
  assert.match(
    migration,
    /revoke insert, update, delete[\s\S]*from authenticated/,
  );

  assert.doesNotMatch(
    migration,
    /grant\s+(insert|update|delete|all)[^;]*to authenticated/i,
  );
});

test("authenticated conserva SELECT", () => {
  assert.match(
    migration,
    /grant select[\s\S]*to authenticated/,
  );

  assert.match(
    migration,
    /has_table_privilege[\s\S]*?'SELECT'/,
  );
});

test("no introduce predicados true", () => {
  assert.doesNotMatch(
    migration,
    /create policy[\s\S]*using\s*\(\s*true\s*\)/i,
  );

  assert.doesNotMatch(
    migration,
    /create policy[\s\S]*with check\s*\(\s*true\s*\)/i,
  );
});

test("incluye verificación fail-closed", () => {
  assert.match(
    migration,
    /v_policy_count <> 1/,
  );

  assert.match(
    migration,
    /v_unsafe_policy_count <> 0/,
  );

  for (const privilege of [
    "INSERT",
    "UPDATE",
    "DELETE",
    "SELECT",
  ]) {
    assert.match(
      migration,
      new RegExp(
        `has_table_privilege[\\s\\S]*?'${privilege}'`,
      ),
    );
  }
});

test("documenta la RPC como escritor único", () => {
  assert.match(
    migration,
    /public\.tc_consolidar_cliente_ticket/,
  );
});

test("no contiene shell accidental", () => {
  assert.doesNotMatch(
    migration,
    /set\s+-Eeuo\s+pipefail|bash\s+<<|\bgit\s+commit\b/,
  );
});

test("el gate aparece exactamente una vez", () => {
  const matches = workflow.match(
    /node tools\/tc-sec-rls-match-contract\.test\.mjs/g,
  ) || [];

  assert.equal(matches.length, 1);
});

console.log(
  `TC_SEC_RLS_MATCH_CONTRACT=PASS (${passed})`,
);
