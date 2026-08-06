import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const migrationPath =
  process.env.MIGRATION_FILE;

assert.ok(
  migrationPath,
  "MIGRATION_FILE is required",
);

const source =
  fs.readFileSync(
    migrationPath,
    "utf8",
  );

const compact =
  source
    .replace(/--.*$/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

test(
  "migration contains only a transactional SQL payload",
  () => {
    assert.equal(
      source.trimStart().toLowerCase().startsWith(
        "begin;",
      ),
      true,
    );

    assert.equal(
      source.trimEnd().toLowerCase().endsWith(
        "commit;",
      ),
      true,
    );

    for (
      const forbidden
      of [
        /^migration_new_rc=/m,
        /^emit_(?:stop|final)\b/m,
        /^git -c\b/m,
        /^node --test\b/m,
        /supabase migration (?:new|up)/,
        /<<['"]?sql['"]?/,
        /^bash$/m,
        /^py$/m,
        /patch_public_support_consumer/,
      ]
    ) {
      assert.equal(
        forbidden.test(
          source.toLowerCase(),
        ),
        false,
        `shell contamination found: ${forbidden}`,
      );
    }
  },
);

test(
  "defines the secure public support notices RPC",
  () => {
    assert.ok(
      compact.includes(
        "create or replace function public.tc_public_support_notices",
      ),
    );

    assert.ok(
      compact.includes(
        "language sql",
      ),
    );

    assert.ok(
      compact.includes(
        "stable",
      ),
    );

    assert.ok(
      compact.includes(
        "security definer",
      ),
    );

    assert.ok(
      compact.includes(
        "set search_path = ''",
      ),
    );
  },
);

test(
  "returns only the minimal public response shape",
  () => {
    const match =
      compact.match(
        /returns table\s*\(([\s\S]*?)\)\s*language sql/,
      );

    assert.ok(
      match,
      "returns table block not found",
    );

    const shape =
      match[1];

    for (
      const field
      of [
        "id uuid",
        "titulo text",
        "contenido text",
        "tipo text",
        "prioridad integer",
        "starts_at timestamptz",
        "ends_at timestamptz",
      ]
    ) {
      assert.ok(
        shape.includes(field),
        `missing public field: ${field}`,
      );
    }

    for (
      const forbidden
      of [
        "created_by",
        "created_at",
        "updated_at",
        "activo",
        "mostrar_en_soporte",
        "mostrar_en_dashboard",
      ]
    ) {
      assert.equal(
        shape.includes(forbidden),
        false,
        `internal field exposed: ${forbidden}`,
      );
    }
  },
);

test(
  "filters inactive, private, future and expired notices",
  () => {
    assert.ok(
      compact.includes(
        "aviso.activo is true",
      ),
    );

    assert.ok(
      compact.includes(
        "aviso.mostrar_en_soporte is true",
      ),
    );

    assert.ok(
      compact.includes(
        "aviso.starts_at is null",
      ),
    );

    assert.ok(
      compact.includes(
        "aviso.starts_at <= pg_catalog.now()",
      ),
    );

    assert.ok(
      compact.includes(
        "aviso.ends_at is null",
      ),
    );

    assert.ok(
      compact.includes(
        "aviso.ends_at > pg_catalog.now()",
      ),
    );
  },
);

test(
  "uses a valid bounded CASE expression",
  () => {
    for (
      const fragment
      of [
        "when p_limit is null then 5",
        "when p_limit < 1 then 1",
        "when p_limit > 20 then 20",
        "else p_limit",
      ]
    ) {
      assert.ok(
        compact.includes(fragment),
        `missing CASE fragment: ${fragment}`,
      );
    }

    for (
      const invalid
      of [
        "pg_catalog.least",
        "pg_catalog.greatest",
        "pg_catalog.coalesce",
      ]
    ) {
      assert.equal(
        compact.includes(invalid),
        false,
        `invalid qualified expression remains: ${invalid}`,
      );
    }
  },
);

test(
  "grants RPC execution without anon table SELECT",
  () => {
    assert.ok(
      compact.includes(
        "revoke all on function public.tc_public_support_notices(integer) from public",
      ),
    );

    assert.ok(
      compact.includes(
        "grant execute on function public.tc_public_support_notices(integer) to anon, authenticated, service_role",
      ),
    );

    assert.equal(
      /\bgrant\s+(?:all(?:\s+privileges)?|select)\s+on\s+(?:table\s+)?public\.avisos_globales\s+to\s+[^;]*\banon\b/
        .test(compact),
      false,
    );

    assert.equal(
      compact.includes(
        "alter table public.avisos_globales disable row level security",
      ),
      false,
    );
  },
);
