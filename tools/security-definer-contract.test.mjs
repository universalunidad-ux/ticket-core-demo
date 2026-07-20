#!/usr/bin/env node
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const migrationDir = "supabase/migrations";
const migrationFiles = readdirSync(migrationDir)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => join(migrationDir, name));

const expected = new Map([
  ["public.tc_current_role", "authenticated"],
  ["public.tc_is_admin", "authenticated"],
  ["public.tc_is_manager", "authenticated"],
  ["public.is_internal_user", "authenticated"],
  ["public.tc_can_access_ticket", "authenticated"],
  ["public.admin_create_profile", "authenticated"],
  ["public.admin_set_rol", "authenticated"],
  ["public.admin_disable_access", "authenticated"],
  ["public.tc_prevent_rol_escalation", "trigger_only"],
  ["public.support_idem_claim", "service_only"],
  ["public.support_idem_finish", "service_only"],
  ["public.support_idem_cleanup", "service_only"],
]);

const sources = migrationFiles.map((path) => ({
  path,
  source: readFileSync(path, "utf8"),
}));

const corpus = sources
  .map(({ path, source }) => `\n-- FILE:${path}\n${source}`)
  .join("\n");

const discovered = new Map();

for (const { path, source } of sources) {
  const pattern =
    /create\s+or\s+replace\s+function\s+(public\.[a-z0-9_]+)\s*\(([^)]*)\)/gi;

  const matches = [...source.matchAll(pattern)];

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const next = matches[index + 1];

    const block = source.slice(
      match.index,
      next ? next.index : source.length,
    );

    if (!/security\s+definer/i.test(block)) continue;

    const name = match[1].toLowerCase();

    assert.match(
      block,
      /set\s+search_path\s*(?:=|to)\s*'?public'?/i,
      `${name} lacks fixed public search_path in ${path}`,
    );

    const records = discovered.get(name) || [];
    records.push({
      path,
      args: match[2].trim(),
    });
    discovered.set(name, records);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function aclRoles(kind, name) {
  const direction = kind === "revoke" ? "from" : "to";
  const expression = new RegExp(
    `${kind}\\s+execute\\s+on\\s+function\\s+` +
      `${escapeRegExp(name)}\\s*\\([^;]*\\)\\s+` +
      `${direction}\\s+([^;]+);`,
    "gi",
  );

  const roles = new Set();

  for (const match of corpus.matchAll(expression)) {
    for (const role of match[1].split(",")) {
      roles.add(role.trim().toLowerCase());
    }
  }

  return roles;
}

for (const name of expected.keys()) {
  assert.ok(
    discovered.has(name),
    `expected SECURITY DEFINER missing: ${name}`,
  );
}

for (const [name, definitions] of discovered) {
  const revoked = aclRoles("revoke", name);
  const granted = aclRoles("grant", name);

  assert.ok(
    revoked.has("public"),
    `${name} does not revoke PUBLIC execute`,
  );

  assert.ok(
    revoked.has("anon"),
    `${name} does not revoke anon execute`,
  );

  assert.ok(
    !granted.has("public") && !granted.has("anon"),
    `${name} grants execute to public or anon`,
  );

  const exposure = expected.get(name);

  if (!exposure) {
    console.log(
      `EXTRA_SECURITY_DEFINER=${name}` +
      ` definitions=${definitions.length}`,
    );
    continue;
  }

  if (exposure === "authenticated") {
    assert.ok(
      granted.has("authenticated"),
      `${name} must grant execute to authenticated`,
    );
  } else {
    assert.ok(
      revoked.has("authenticated"),
      `${name} must revoke authenticated execute`,
    );

    assert.ok(
      !granted.has("authenticated"),
      `${name} must not grant authenticated execute`,
    );
  }

  console.log(
    `PASS\t${name}` +
    `\texposure=${exposure}` +
    `\tdefinitions=${definitions.length}`,
  );
}

const preflight = readFileSync(
  "supabase/tests/security_definer_preflight.sql",
  "utf8",
);

assert.match(preflight, /REPORT_ONLY/);
assert.match(preflight, /\bp\.prosecdef\b/);
assert.match(preflight, /\baclexplode\s*\(/);
assert.match(preflight, /search_path_fixed/);
assert.match(preflight, /public_execute/);
assert.match(preflight, /anon_execute/);
assert.match(preflight, /authenticated_execute/);
assert.doesNotMatch(
  preflight,
  /^\s*(?:create|alter|drop|grant|revoke|update|insert|delete)\b/im,
);

console.log(`EXPECTED_SECURITY_DEFINER_COUNT=${expected.size}`);
console.log(`DISCOVERED_SECURITY_DEFINER_COUNT=${discovered.size}`);
console.log("SECURITY_DEFINER_STATIC_INVENTORY=PASS");
console.log("SECURITY_DEFINER_PREFLIGHT_REPORT_ONLY=PASS");
