
MIGRATION_NEW_RC=$?

[ "$MIGRATION_NEW_RC" -eq 0 ] ||
  emit_final \
    STOP \
    MIGRATION_CREATION_FAILURE \
    "supabase_migration_new_failed_rc_${MIGRATION_NEW_RC}" \
    INSPECT_MIGRATION_NEW_LOG

find "$WT/supabase/migrations" \
  -maxdepth 1 \
  -type f \
  -print |
  sort > "$TMP/migrations-after.txt"

MIGRATION_FILE="$(
  python3 - \
    "$TMP/migrations-before.txt" \
    "$TMP/migrations-after.txt" <<'PY'
import sys
from pathlib import Path

before = set(
    Path(sys.argv[1]).read_text(
        encoding="utf-8",
    ).splitlines()
)

after = set(
    Path(sys.argv[2]).read_text(
        encoding="utf-8",
    ).splitlines()
)

created = sorted(after - before)

if len(created) != 1:
    raise SystemExit(
        "EXPECTED_ONE_NEW_MIGRATION_FOUND_"
        + str(len(created))
    )

print(created[0])
PY
)"

[ -n "$MIGRATION_FILE" ] &&
[ -f "$MIGRATION_FILE" ] ||
  emit_final \
    STOP \
    MIGRATION_CREATION_FAILURE \
    "new_migration_file_not_resolved" \
    INSPECT_MIGRATION_DIRECTORY

cat > "$MIGRATION_FILE" <<'SQL'
begin;

create or replace function public.tc_public_support_notices(
  p_limit integer default 5
)
returns table (
  id uuid,
  titulo text,
  contenido text,
  tipo text,
  prioridad integer,
  starts_at timestamptz,
  ends_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    aviso.id,
    aviso.titulo,
    aviso.contenido,
    aviso.tipo,
    aviso.prioridad,
    aviso.starts_at,
    aviso.ends_at
  from public.avisos_globales as aviso
  where aviso.activo is true
    and aviso.mostrar_en_soporte is true
    and (
      aviso.starts_at is null
      or aviso.starts_at <= pg_catalog.now()
    )
    and (
      aviso.ends_at is null
      or aviso.ends_at > pg_catalog.now()
    )
  order by
    aviso.prioridad asc,
    aviso.created_at desc,
    aviso.id asc
  limit pg_catalog.least(
    pg_catalog.greatest(
      pg_catalog.coalesce(p_limit, 5),
      1
    ),
    20
  );
$function$;

comment on function public.tc_public_support_notices(integer)
is
  'Returns only active, currently effective notices explicitly enabled for the public support surface.';

revoke all
on function public.tc_public_support_notices(integer)
from public;

revoke all
on function public.tc_public_support_notices(integer)
from anon, authenticated;

grant execute
on function public.tc_public_support_notices(integer)
to anon, authenticated, service_role;

commit;
SQL

TEST_FILE="$WT/tools/avisos-public-rpc-contract.test.mjs"

cat > "$TEST_FILE" <<'NODE'
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const migrationPath =
  process.env.MIGRATION_FILE;

assert.ok(
  migrationPath,
  "MIGRATION_FILE environment variable is required",
);

const sql =
  fs.readFileSync(
    migrationPath,
    "utf8",
  );

const compact =
  sql
    .replace(/--.*$/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

test(
  "defines one bounded public-support RPC",
  () => {
    assert.match(
      compact,
      /create or replace function public\.tc_public_support_notices\s*\(\s*p_limit integer default 5\s*\)/,
    );

    assert.match(
      compact,
      /language sql stable security definer set search_path = ''/,
    );

    assert.match(
      compact,
      /limit pg_catalog\.least\s*\(\s*pg_catalog\.greatest\s*\(\s*pg_catalog\.coalesce\s*\(\s*p_limit\s*,\s*5\s*\)\s*,\s*1\s*\)\s*,\s*20\s*\)/,
    );
  },
);

test(
  "exposes only the minimal public response shape",
  () => {
    const returnMatch =
      compact.match(
        /returns table\s*\(([\s\S]*?)\)\s*language sql/,
      );

    assert.ok(
      returnMatch,
      "returns table block not found",
    );

    const returnShape =
      returnMatch[1];

    for (
      const required
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
        returnShape.includes(required),
        `missing public return field: ${required}`,
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
        returnShape.includes(forbidden),
        false,
        `internal field exposed: ${forbidden}`,
      );
    }
  },
);

test(
  "filters inactive, non-support, future and expired notices",
  () => {
    assert.match(
      compact,
      /aviso\.activo is true/,
    );

    assert.match(
      compact,
      /aviso\.mostrar_en_soporte is true/,
    );

    assert.match(
      compact,
      /aviso\.starts_at is null or aviso\.starts_at <= pg_catalog\.now\(\)/,
    );

    assert.match(
      compact,
      /aviso\.ends_at is null or aviso\.ends_at > pg_catalog\.now\(\)/,
    );
  },
);

test(
  "uses explicit function ACL without granting anon table access",
  () => {
    assert.match(
      compact,
      /revoke all on function public\.tc_public_support_notices\(integer\) from public/,
    );

    assert.match(
      compact,
      /revoke all on function public\.tc_public_support_notices\(integer\) from anon, authenticated/,
    );

    assert.match(
      compact,
      /grant execute on function public\.tc_public_support_notices\(integer\) to anon, authenticated, service_role/,
    );

    assert.doesNotMatch(
      compact,
      /grant select on (table )?public\.avisos_globales to anon/,
    );
  },
);

test(
  "does not weaken the existing table RLS contract",
  () => {
    assert.doesNotMatch(
      compact,
      /alter table public\.avisos_globales disable row level security/,
    );

    assert.doesNotMatch(
      compact,
      /create policy[\s\S]*on public\.avisos_globales[\s\S]*to anon/,
    );
  },
);
NODE

export MIGRATION_FILE

node --test "$TEST_FILE" \
  > "$OUT/02_STATIC_TEST.log" \
  2>&1

TEST_RC=$?

if [ "$TEST_RC" -eq 0 ]; then
  STATIC_TEST="PASS"
else
  STATIC_TEST="FAIL"

  emit_final \
    STOP \
    STATIC_TEST_FAILURE \
    "avisos_public_rpc_contract_test_failed" \
    INSPECT_STATIC_TEST_LOG
fi

export STATIC_REPORT WT OUT

python3 <<'PY'
import json
import os
import re
import shlex
from pathlib import Path

report_path = Path(
    os.environ["STATIC_REPORT"]
)

worktree = Path(
    os.environ["WT"]
)

out = Path(
    os.environ["OUT"]
)

report = json.loads(
    report_path.read_text(
        encoding="utf-8",
    )
)

consumers = list(
    report.get(
        "support_consumers",
        [],
    )
)

if len(consumers) != 1:
    raise SystemExit(
        "EXPECTED_ONE_SUPPORT_CONSUMER_FOUND_"
        + str(len(consumers))
    )

sections = []
direct_table_read = False

for relative_text in consumers:
    relative = Path(relative_text)
    source = worktree / relative

    if not source.is_file():
        raise SystemExit(
            "SUPPORT_CONSUMER_MISSING:"
            + relative_text
        )

    text = source.read_text(
        encoding="utf-8",
        errors="replace",
    )

    if re.search(
        r"""\.from\s*\(\s*["']avisos_globales["']\s*\)""",
        text,
        re.I,
    ):
        direct_table_read = True

    lines = text.splitlines()

    hit_lines = [
        index
        for index, line in enumerate(
            lines,
            start=1,
        )
        if re.search(
            r"avisos_globales|mostrar_en_soporte|starts_at|ends_at",
            line,
            re.I,
        )
    ]

    sections.append(
        f"## {relative_text}\n"
    )

    if not hit_lines:
        sections.append(
            "_No exact table token found; the reference may be indirect._\n"
        )
        continue

    ranges = []

    for hit in hit_lines:
        start = max(1, hit - 25)
        end = min(
            len(lines),
            hit + 35,
        )

        if (
            ranges
            and start <= ranges[-1][1] + 1
        ):
            ranges[-1] = (
                ranges[-1][0],
                max(
                    ranges[-1][1],
                    end,
                ),
            )
        else:
            ranges.append(
                (start, end)
            )

    for start, end in ranges:
        sections.append(
            f"### Lines {start}-{end}\n"
        )

        sections.append(
            "```text\n"
        )

        for number in range(
            start,
            end + 1,
        ):
            sections.append(
                f"{number:05d}: "
                f"{lines[number - 1]}\n"
            )

        sections.append(
            "```\n"
        )

context_path = (
    out /
    "03_PUBLIC_SUPPORT_CONSUMER_CONTEXT.md"
)

context_path.write_text(
    "# Public support notices consumer\n\n"
    + "".join(sections),
    encoding="utf-8",
)

env_lines = [
    f"SUPPORT_CONSUMER_COUNT={len(consumers)}",

    "SUPPORT_CONSUMER_FILES="
    + shlex.quote(
        ",".join(consumers)
    ),

    "DIRECT_TABLE_READ="
    + (
        "YES"
        if direct_table_read
        else "NO"
    ),
]

(out / "03_CONSUMER.env").write_text(
    "\n".join(env_lines) + "\n",
    encoding="utf-8",
)
PY

CONTEXT_RC=$?

[ "$CONTEXT_RC" -eq 0 ] ||
  emit_final \
    STOP \
    CONSUMER_CONTEXT_FAILURE \
    "public_support_consumer_context_failed_rc_${CONTEXT_RC}" \
    INSPECT_UNIT_29_REPORT

. "$OUT/03_CONSUMER.env"

git -C "$WT" diff --check

DIFF_CHECK_RC=$?

[ "$DIFF_CHECK_RC" -eq 0 ] ||
  emit_final \
    STOP \
    CODE_QUALITY_BLOCK \
    "git_diff_check_failed" \
    FIX_PATCH_FORMATTING

git -C "$WT" diff -- \
  "$MIGRATION_FILE" \
  "$TEST_FILE" \
  > "$OUT/01_PATCH.diff"

git -C "$WT" add \
  "$MIGRATION_FILE" \
  "$TEST_FILE"

git -C "$WT" commit \
  -m "feat(avisos): add safe public support notices RPC" \
  > "$OUT/04_COMMIT.log" \
  2>&1

COMMIT_RC=$?

[ "$COMMIT_RC" -eq 0 ] ||
  emit_final \
    STOP \
    GIT_COMMIT_FAILURE \
    "commit_failed_rc_${COMMIT_RC}" \
    INSPECT_COMMIT_LOG

COMMIT_CREATED="YES"
COMMIT_SHA="$(new_head)"

[ "$(new_clean)" = "YES" ] ||
  emit_final \
    STOP \
    SAFETY_BLOCK \
    "new_worktree_not_clean_after_commit" \
    RESTORE_CLEAN_NEW_WORKTREE

emit_final \
  PASS \
  OK \
  "A safe, minimal public-support notices RPC was created and committed locally with explicit ACLs, bounded output, temporal filtering and no anon table grant." \
  PATCH_PUBLIC_SUPPORT_CONSUMER_TO_RPC_AND_REVIEW_MIGRATION
