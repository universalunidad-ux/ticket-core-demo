# Local DB / RLS Harness — TC-LOCAL-DB-RLS-HARNESS-01

Harness **ejecutable y fail-closed** para validar localmente migraciones, RLS y
contratos contra **Supabase/PostgreSQL local (Docker)**. No es una auditoría: no
repite inventarios, **consume** los artefactos existentes del repo.

## Qué NO hace (garantías de seguridad)

- No ejecuta Supabase **remoto** ni aplica SQL a staging/producción.
- No modifica `supabase/**`, `app/**`, `tools/run-contract-tests.mjs` ni workflows.
- No modifica datos reales. Sólo levanta un Supabase local efímero.
- No imprime secretos (URLs con password, JWT y tokens se redactan).
- No hace commit/push/PR/merge/deploy.

Ante cualquier duda o precondición no verificable, **aborta** (fail-closed).

## Requisitos del host

macOS · Node ≥ 22 · Docker corriendo · Supabase CLI · worktree en rama `test/*`.

## Uso

```bash
# Punto de entrada host (recomendado):
tools/local-db/run-local-db-harness.sh            # ejecución completa
tools/local-db/run-local-db-harness.sh --dry-run  # sólo prechecks fail-closed
tools/local-db/run-local-db-harness.sh --keep-up  # no detener supabase al final

# Pruebas del propio harness (sin Docker):
node --test test/local-db/*.test.mjs
```

## Fases

1. `PRECHECK_HOST` — macOS, Node 22, Docker, Supabase CLI.
2. `PRECHECK_REPO` — worktree, rama `test/*`, HEAD.
3. `PRECHECK_REMOTE_GUARD` — rechaza env remotas / token / project ref.
4. `PRECHECK_SCOPE_GUARD` — sólo se permiten cambios en `tools/local-db/` y `test/local-db/`.
5. `SCAFFOLD` — workdir Supabase efímero (`.runtime/`) con `config.toml` generado y
   migraciones **enlazadas** (sin duplicar).
6. `SUPABASE_START` — `supabase start`; verifica que la DB URL sea **local**.
7. `DB_RESET_APPLY` / `MIGRATIONS_ORDERED` — aplica migraciones en orden; detecta la que falla.
8. `SCHEMA_CHECK` — `supabase db diff`; falla ante drift.
9. `IDEMPOTENCY_CHECK` — reaplica migraciones; falla si no son idempotentes.
10. `POLICY_INVENTORY` — snapshot `pg_policies` → `tools/policy-inventory-gate.mjs`; probe de
    privilegios `anon` sobre tablas internas.
11. `SECURITY_DEFINER_CHECK` — consume `supabase/tests/security_definer_preflight.sql`;
    falla si `search_path` no está fijado o hay `EXECUTE` público/anon no intencional.
12. `RLS_MATRIX` — ejecuta la matriz negativa multirol `supabase/tests/authz_negative.sql`
    y `idempotency_concurrency.sql`.
13. `CONTRACTS` — `tools/run-contract-tests.mjs`.
14. `REPORT` — escribe artefactos y `00_FINAL_RESULT.txt`.

## Roles cubiertos por la matriz RLS

`anon`, `authenticated` (cliente/staff), `soporte`, `supervisor`, `admin`, y
`soporte` de tenant/ticket ajeno (canario anti-permisivo). Fuente:
`supabase/tests/authz_negative.sql`.

## Condiciones de fallo (STOP_REASON_CODE → exit)

| Condición | Código | Exit |
|---|---|---|
| Host no macOS | `E_HOST_NOT_MACOS` | 10 |
| Node < 22 | `E_NODE_VERSION` | 11 |
| Docker ausente / caído | `E_DOCKER_MISSING` / `E_DOCKER_NOT_RUNNING` | 12 / 13 |
| Supabase CLI ausente | `E_SUPABASE_CLI_MISSING` | 14 |
| Env / target remoto | `E_REMOTE_ENV_PRESENT` / `E_REMOTE_TARGET_DETECTED` | 51 / 50 |
| Proyecto ligado (token/ref) | `E_SUPABASE_LINKED_PROJECT` | 52 |
| Cambio fuera de alcance | `E_SCOPE_VIOLATION` | 55 |
| Migración falla | `E_MIGRATION_FAILED` | 73 |
| Migración no idempotente | `E_MIGRATION_NOT_IDEMPOTENT` | 74 |
| Drift de esquema | `E_SCHEMA_DIFF` | 75 |
| Policy faltante/no reconocida | `E_POLICY_MISSING` | 76 |
| anon lee/escribe tabla interna | `E_ANON_LEAK` | 77 |
| Escalada de privilegios | `E_PRIVILEGE_ESCALATION` | 78 |
| Cliente accede a datos ajenos | `E_CROSS_TENANT_LEAK` | 79 |
| Matriz RLS falla | `E_RLS_MATRIX_FAILED` | 80 |
| SECURITY DEFINER inseguro | `E_SECURITY_DEFINER_UNSAFE` | 81 |
| search_path no fijado | `E_SEARCH_PATH_UNPINNED` | 82 |
| Contratos fallan | `E_CONTRACTS_FAILED` | 83 |

## Artefactos generados (`tools/local-db/.artifacts/<timestamp>/`)

`00_FINAL_RESULT.txt`, `migration-results.csv`, `rls-matrix.csv`,
`schema-diff.txt`, `contract-results.txt`, `rollback-local-reset.md`,
`policy_snapshot.json`, `security-definer.json`, `harness.log`.

## Arquitectura (fuente única de la lógica)

- `lib/guards.mjs` — decisiones puras fail-closed (remoto, alcance, códigos, reporte).
- `lib/parse.mjs` — parsers puros de salidas de `supabase`/`psql`.
- `harness.mjs` — orquestación con efectos (delega la lógica a `lib/`).
- `run-local-db-harness.sh` — entrada host que revalida precondiciones en bash.

`guards.mjs`/`parse.mjs` son la **misma verdad** que consumen las pruebas en
`test/local-db/`, evitando duplicar la lógica entre bash, harness y tests.
