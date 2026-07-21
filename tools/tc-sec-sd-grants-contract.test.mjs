import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(
  "supabase/migrations/20260721083212_tc_sec_sd_grants.sql",
  "utf8",
);

const workflow = readFileSync(
  ".github/workflows/frontend-gates.yml",
  "utf8",
);

for (const name of [
  "current_user_role",
  "is_admin",
  "is_internal_user",
  "is_support_or_admin",
]) {
  assert.match(
    sql,
    new RegExp(
      `revoke execute on function public\\.${name}\\(\\)`
      + `[\\s\\S]*?from public, anon;`,
    ),
  );

  assert.match(
    sql,
    new RegExp(
      `grant execute on function public\\.${name}\\(\\)`
      + `[\\s\\S]*?to authenticated;`,
    ),
  );
}

assert.match(
  sql,
  /log_ticket_assignment_event\(\)[\s\S]*from public, anon, authenticated;/,
);

const revokeStatements = [
  ...sql.matchAll(
    /revoke\s+execute\s+on\s+function[\s\S]*?;/gi,
  ),
].map(match => match[0]);

assert.equal(
  revokeStatements.some(statement =>
    /get_ticket_portal/i.test(statement),
  ),
  false,
);

assert.match(sql, /aclexplode/);
assert.match(sql, /a\.grantee = 0/);
assert.match(sql, /v_anon_unexpected/);

assert.equal(
  (
    workflow.match(
      /node tools\/tc-sec-sd-grants-contract\.test\.mjs/g,
    ) || []
  ).length,
  1,
);

console.log("TC_SEC_SD_GRANTS_CONTRACT=PASS");
