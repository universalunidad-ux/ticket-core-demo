#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const seedPath = "supabase/tests/staging_synthetic_seed.sql";
const teardownPath =
  "supabase/tests/staging_synthetic_teardown.sql";

const seed = readFileSync(seedPath, "utf8");
const teardown = readFileSync(teardownPath, "utf8");

const requiredVariables = [
  "environment",
  "confirmation",
  "admin_uid",
  "supervisor_uid",
  "support_a_uid",
  "support_b_uid",
];

for (const variable of requiredVariables) {
  const pattern = new RegExp(
    String.raw`\\if\s+:\{\?${variable}\}`,
  );

  assert.match(seed, pattern, `seed missing ${variable} guard`);
  assert.match(
    teardown,
    pattern,
    `teardown missing ${variable} guard`,
  );
}

assert.match(seed, /STAGING_ONLY/);
assert.match(seed, /TC_STAGING_SYNTHETIC_V1/);
assert.match(seed, /pg_advisory_xact_lock/i);
assert.match(seed, /begin;/i);
assert.match(seed, /commit;/i);

assert.match(seed, /insert into public\.perfiles/i);
assert.match(seed, /insert into public\.clientes/i);
assert.match(seed, /insert into public\.tickets/i);
assert.match(seed, /on conflict \(id\) do update/i);
assert.match(seed, /from auth\.users/i);
assert.match(seed, /SEED_COLLISION/);

assert.doesNotMatch(
  seed,
  /\b(?:insert\s+into|update|delete\s+from|truncate)\s+auth\.users\b/i,
);

assert.doesNotMatch(
  seed,
  /\b(?:insert\s+into|update|delete\s+from)\s+storage\.objects\b/i,
);

assert.match(teardown, /STAGING_ONLY/);
assert.match(teardown, /TC_STAGING_TEARDOWN_V1/);
assert.match(teardown, /MARKER_SCOPED/);
assert.match(teardown, /pg_advisory_xact_lock/i);
assert.match(teardown, /TEARDOWN_COLLISION/);
assert.match(teardown, /Storage API first/);
assert.match(teardown, /to_regclass\('storage\.objects'\)/);

assert.doesNotMatch(
  teardown,
  /\b(?:insert\s+into|update|delete\s+from|truncate)\s+auth\.users\b/i,
);

assert.doesNotMatch(
  teardown,
  /\bdelete\s+from\s+storage\.objects\b/i,
);

const reservedIds = [
  "a1000000-0000-4000-8000-000000000001",
  "a1000000-0000-4000-8000-000000000002",
  "b1000000-0000-4000-8000-000000000001",
  "b1000000-0000-4000-8000-000000000002",
  "b1000000-0000-4000-8000-000000000003",
];

for (const id of reservedIds) {
  assert.ok(seed.includes(id), `seed missing reserved ID ${id}`);
  assert.ok(
    teardown.includes(id),
    `teardown missing reserved ID ${id}`,
  );
}

for (const marker of [
  "[TC-STG]",
  "TC-STG-A-001",
  "TC-STG-B-001",
  "TC-STG-U-001",
]) {
  assert.ok(seed.includes(marker), `seed missing ${marker}`);
}

const childLoop = teardown.indexOf("for target in");
const firstChildPlan = teardown.indexOf(
  "('ticket_eventos', 'ticket_id')",
);
const dynamicChildDelete = teardown.indexOf(
  "'delete from public.%I where %I = any ($1)'",
);
const ticketDelete = teardown.indexOf(
  "delete from public.tickets",
);
const clientDelete = teardown.indexOf(
  "delete from public.clientes",
);
const profileDelete = teardown.indexOf(
  "delete from public.perfiles",
);

for (const marker of [
  "('ticket_eventos', 'ticket_id')",
  "('archivos_ticket', 'ticket_id')",
  "('ticket_archivos', 'ticket_id')",
  "('ticket_match_decisiones', 'ticket_id')",
  "('ticket_qr', 'ticket_id')",
]) {
  assert.ok(
    teardown.includes(marker),
    `dynamic child cleanup missing ${marker}`,
  );
}

assert.ok(childLoop >= 0, "dynamic child cleanup loop missing");
assert.ok(
  firstChildPlan > childLoop,
  "child cleanup plan appears outside its loop",
);
assert.ok(
  dynamicChildDelete > firstChildPlan,
  "dynamic child delete template missing or misplaced",
);
assert.ok(
  ticketDelete > dynamicChildDelete,
  "tickets deleted before dynamic child cleanup",
);
assert.ok(clientDelete > ticketDelete, "clients deleted too early");
assert.ok(profileDelete > clientDelete, "profiles deleted too early");

assert.match(seed, /AUTH_USERS_MODIFIED=NO/);
assert.match(seed, /STORAGE_MODIFIED=NO/);
assert.match(teardown, /AUTH_USERS_MODIFIED=NO/);
assert.match(teardown, /STORAGE_MODIFIED=NO/);

console.log("PASS\tstaging-only execution guards");
console.log("PASS\tfour external Auth user UUID inputs");
console.log("PASS\tpersistent seed is idempotent");
console.log("PASS\treserved UUID collision protection");
console.log("PASS\tteardown child-before-parent ordering");
console.log("PASS\tauth.users mutation forbidden");
console.log("PASS\tStorage deletion forbidden in SQL");
console.log("STAGING_SYNTHETIC_SEED_CONTRACT: PASS (7/7)");
