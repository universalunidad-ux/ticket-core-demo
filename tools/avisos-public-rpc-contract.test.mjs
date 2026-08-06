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
  "defines a bounded public support notices RPC",
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

    assert.ok(
      compact.includes(
        "pg_catalog.least",
      ),
    );

    assert.ok(
      compact.includes(
        "pg_catalog.greatest",
      ),
    );

    assert.ok(
      compact.includes(
        "pg_catalog.coalesce(p_limit, 5)",
      ),
    );
  },
);

test(
  "exposes only the minimal public shape",
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
  "filters inactive, non-support, future and expired rows",
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
  "grants RPC execution without granting anon table SELECT",
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
  },
);

test(
  "does not weaken table RLS",
  () => {
    assert.equal(
      compact.includes(
        "alter table public.avisos_globales disable row level security",
      ),
      false,
    );

    assert.equal(
      /create policy[\s\S]*on public\.avisos_globales[\s\S]*to anon/
        .test(compact),
      false,
    );
  },
);
