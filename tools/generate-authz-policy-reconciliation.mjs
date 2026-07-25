#!/usr/bin/env node

import {
  createHash,
} from "node:crypto";
import {
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import {
  join,
  resolve,
} from "node:path";

const root = resolve(process.argv[2] || ".");
const mode = process.argv[3] || "--check";

const manifestPath = join(
  root,
  "tools/authz-policy-manifest.json",
);

const outputPath = join(
  root,
  "supabase/migrations/"
  + "20260724035000_tc_policy_baseline_reconciliation.sql",
);

const manifest = JSON.parse(
  readFileSync(manifestPath, "utf8"),
);

const identifierPattern =
  /^[A-Za-z_][A-Za-z0-9_]*$/;

const quoteIdentifier = value =>
  `"${String(value).replaceAll('"', '""')}"`;

const quoteLiteral = value =>
  `'${String(value).replaceAll("'", "''")}'`;

const retiredRows = [];

for (
  const tableKey
  of Object.keys(
    manifest.legacy_to_drop || {},
  ).sort()
) {
  if (!tableKey.startsWith("public.")) {
    throw new Error(
      `retired policy outside public schema: ${tableKey}`,
    );
  }

  const table =
    tableKey.slice("public.".length);

  if (!identifierPattern.test(table)) {
    throw new Error(
      `invalid table identifier: ${table}`,
    );
  }

  const names =
    manifest.legacy_to_drop[tableKey];

  if (!Array.isArray(names)) {
    throw new Error(
      `legacy_to_drop must be an array: ${tableKey}`,
    );
  }

  if (
    new Set(names).size
    !== names.length
  ) {
    throw new Error(
      `duplicate retired policy: ${tableKey}`,
    );
  }

  const active = new Set(
    manifest.recognized?.[tableKey] || [],
  );

  for (const name of [...names].sort()) {
    if (!identifierPattern.test(name)) {
      throw new Error(
        `invalid policy identifier: ${tableKey}.${name}`,
      );
    }

    if (active.has(name)) {
      throw new Error(
        `active/retired overlap: ${tableKey}.${name}`,
      );
    }

    retiredRows.push({
      schema: "public",
      table,
      name,
    });
  }
}

if (retiredRows.length === 0) {
  throw new Error(
    "legacy_to_drop is empty",
  );
}

const activeCount = Object.values(
  manifest.recognized || {},
).reduce(
  (total, names) =>
    total
    + (
      Array.isArray(names)
        ? names.length
        : 0
    ),
  0,
);

const canonicalRetired = JSON.stringify(
  retiredRows,
);

const sourceHash = createHash("sha256")
  .update(canonicalRetired)
  .digest("hex");

const drops = retiredRows
  .map(
    row =>
      `drop policy if exists `
      + `${quoteIdentifier(row.name)} `
      + `on `
      + `${quoteIdentifier(row.schema)}.`
      + `${quoteIdentifier(row.table)};`,
  )
  .join("\n");

const values = retiredRows
  .map(
    row =>
      `(${quoteLiteral(row.schema)}, `
      + `${quoteLiteral(row.table)}, `
      + `${quoteLiteral(row.name)})`,
  )
  .join(",\n      ");

const expected =
`-- GENERATED FILE — DO NOT EDIT MANUALLY
-- SOURCE: tools/authz-policy-manifest.json
-- SOURCE_SECTION: legacy_to_drop
-- SOURCE_SHA256: ${sourceHash}
-- GENERATOR: tools/generate-authz-policy-reconciliation.mjs
-- PREPARED_NOT_APPLIED
-- DO_NOT_APPLY_WITHOUT_STAGING_REVIEW

begin;

${drops}

do $verify$
declare
  v_remaining text;
begin
  select string_agg(
    format(
      '%I.%I.%I',
      p.schemaname,
      p.tablename,
      p.policyname
    ),
    ', '
    order by
      p.schemaname,
      p.tablename,
      p.policyname
  )
  into v_remaining
  from pg_policies p
  join (
    values
      ${values}
  ) as retired(
    schemaname,
    tablename,
    policyname
  )
    on retired.schemaname = p.schemaname
   and retired.tablename = p.tablename
   and retired.policyname = p.policyname;

  if v_remaining is not null then
    raise exception
      'TC_RETIRED_POLICY_REMAINS: %',
      v_remaining
      using errcode = '55000';
  end if;
end
$verify$;

commit;
`;

if (mode === "--write") {
  writeFileSync(
    outputPath,
    expected,
    "utf8",
  );

  console.log(
    `AUTHZ_POLICY_SSOT=WRITE `
    + `retired=${retiredRows.length} `
    + `active=${activeCount} `
    + `sha256=${sourceHash}`,
  );
} else if (mode === "--check") {
  if (!existsSync(outputPath)) {
    console.error(
      `AUTHZ_POLICY_SSOT=FAIL `
      + `reason=generated_migration_missing`,
    );
    process.exit(1);
  }

  const actual =
    readFileSync(outputPath, "utf8");

  if (actual !== expected) {
    console.error(
      `AUTHZ_POLICY_SSOT=FAIL `
      + `reason=generated_migration_drift`,
    );
    process.exit(1);
  }

  console.log(
    `AUTHZ_POLICY_SSOT=PASS `
    + `retired=${retiredRows.length} `
    + `active=${activeCount} `
    + `sha256=${sourceHash}`,
  );
} else {
  console.error(
    "usage: generate-authz-policy-reconciliation.mjs "
    + "<root> --write|--check",
  );
  process.exit(2);
}
