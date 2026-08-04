import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.argv[2] ?? ".";

const migrationsDir = path.join(
  root,
  "supabase",
  "migrations",
);

const migrations = fs
  .readdirSync(migrationsDir)
  .filter(name =>
    name.endsWith(
      "_media_video_security_definer_hardening.sql",
    ),
  );

assert.equal(
  migrations.length,
  1,
  "must have exactly one Media video hardening migration",
);

const migration = path.join(
  migrationsDir,
  migrations[0],
);

const sql = fs.readFileSync(
  migration,
  "utf8",
);

const signatures = [
  String.raw`tc_media_otorgar_autorizacion\s*\(\s*uuid\s*,\s*text\s*,\s*timestamptz\s*,\s*text\s*\)`,
  String.raw`tc_media_consumir_autorizacion\s*\(\s*uuid\s*,\s*uuid\s*,\s*text\s*\)`,
  String.raw`tc_media_validar_duracion\s*\(\s*uuid\s*,\s*uuid\s*,\s*integer\s*\)`,
  String.raw`tc_media_revocar_autorizacion\s*\(\s*uuid\s*\)`,
];

for (const signature of signatures) {
  assert.match(
    sql,
    new RegExp(
      String.raw`alter\s+function\s+public\.${signature}\s+set\s+search_path\s+to\s+pg_catalog\s*,\s*public\s*;`,
      "i",
    ),
    `missing pinned search_path for ${signature}`,
  );

  assert.match(
    sql,
    new RegExp(
      String.raw`revoke\s+all\s+on\s+function\s+public\.${signature}\s+from\s+public\s*,\s*anon`,
      "i",
    ),
    `missing PUBLIC/anon revoke for ${signature}`,
  );
}

assert.match(
  sql,
  /grant\s+execute\s+on\s+function\s+public\.tc_media_otorgar_autorizacion[\s\S]*?to\s+service_role\s*;/i,
);

assert.match(
  sql,
  /grant\s+execute\s+on\s+function\s+public\.tc_media_consumir_autorizacion[\s\S]*?to\s+authenticated\s*,\s*service_role\s*;/i,
);

assert.match(
  sql,
  /grant\s+execute\s+on\s+function\s+public\.tc_media_validar_duracion[\s\S]*?to\s+authenticated\s*,\s*service_role\s*;/i,
);

assert.match(
  sql,
  /grant\s+execute\s+on\s+function\s+public\.tc_media_revocar_autorizacion[\s\S]*?to\s+service_role\s*;/i,
);

assert.doesNotMatch(
  sql,
  /set\s+search_path\s+to\s+public\s*,\s*pg_temp/i,
);

assert.doesNotMatch(
  sql,
  /create\s+or\s+replace\s+function/i,
  "hardening migration must not redefine function bodies",
);

console.log(JSON.stringify({
  rows: ["MEDIA-010", "MEDIA-011", "MEDIA-012"],
  migration: `supabase/migrations/${migrations[0]}`,
  functionsHardened: signatures.length,
  searchPath: "pg_catalog, public",
  publicExecuteRevoked: true,
  anonExecuteRevoked: true,
  result: "PASS",
}));
