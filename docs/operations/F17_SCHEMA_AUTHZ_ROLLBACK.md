# F17-W1 — Runbook de rollback (esquema y autorización)

Cubre dos escenarios: (A) rollback **local** mientras el artefacto está
`PREPARED_NOT_APPLIED`, y (B) rollback de **staging** tras una aplicación futura
explícitamente autorizada. En esta unidad sólo aplica (A); (B) se documenta.

## A. Rollback local (PREPARED_NOT_APPLIED)

La migración nunca se aplica en esta unidad, así que el rollback remoto es `N/A`
y la base de datos permanece intacta. Revertir sólo los archivos allowlisted de
la rama local (9 paths):

1. Eliminar los 7 NEW:
   - `supabase/migrations/20260723080712_f17_staff_schema_authz_foundation.sql`
   - `supabase/tests/f17_schema_contract.sql`
   - `supabase/tests/f17_rls_negative.sql`
   - `tools/f17-schema-contract.test.mjs`
   - `tools/f17-policy-contract.test.mjs`
   - `docs/operations/F17_SCHEMA_AUTHZ_BASELINE.md`
   - `docs/operations/F17_SCHEMA_AUTHZ_ROLLBACK.md`
2. Revertir los 2 MODIFY, dejándolos idénticos al parent:
   - `tools/authz-policy-manifest.json` (quitar las 9 claves F17 añadidas).
   - `tools/run-contract-tests.mjs` (quitar el bloque de integración F17).
3. No tocar migraciones existentes ni objetos fuera de la allowlist.

Si ya existe el commit local:

```
git reset --soft HEAD~1        # deshace el commit, conserva los cambios
git restore --staged --worktree \
  supabase/migrations/20260723080712_f17_staff_schema_authz_foundation.sql \
  supabase/tests/f17_schema_contract.sql \
  supabase/tests/f17_rls_negative.sql \
  tools/f17-schema-contract.test.mjs \
  tools/f17-policy-contract.test.mjs \
  tools/authz-policy-manifest.json \
  tools/run-contract-tests.mjs \
  docs/operations/F17_SCHEMA_AUTHZ_BASELINE.md \
  docs/operations/F17_SCHEMA_AUTHZ_ROLLBACK.md
```

Los NEW quedan como untracked y se borran manualmente; los 2 MODIFY vuelven al
parent. No requiere autorización de pérdida de datos: no hubo datos ni apply.

## B. Rollback de staging (sólo tras un apply futuro autorizado)

No forma parte de W1. Orden estricto, con aprobación explícita de pérdida de
datos:

1. Apagar el feature flag de UI y detener cualquier writer/worker/canal F17
   (en W1 no existen; el runbook los contempla para el estado post-W3+).
2. Respaldar los datos F17 si existieran.
3. Revocar `EXECUTE` de RPCs F17 y los grants F17.
4. Retirar únicamente policies cuya propiedad F17 esté demostrada; nunca policies
   de objetos legados.
5. Retirar funciones/triggers F17 propios.
6. `DROP TABLE` de las 9 tablas en **orden inverso de dependencias**:
   `staff_message_receipts` → `staff_announcement_targets` → `staff_announcements`
   → `staff_message_revisions` → `staff_messages` → `staff_conversations`
   → `staff_team_memberships` → `staff_teams` → `support_agent_scopes`.
   (`support_agent_scopes` no depende de las demás; puede caer en cualquier punto
   tras revocar sus grants.)
7. **Preservar** `perfiles`, `tickets`, `bitacora`, `avisos_globales`,
   `ticket_eventos`, `reglas_asignacion`, `soporte_adjuntos` y los helpers
   preexistentes. El rollback nunca los altera.
8. Re-ejecutar inventarios de policies, grants, owners y Security Definer.

## Invariantes de rollback

1. Nunca toca objetos fuera de F17.
2. Ningún paso ejecuta escrituras remotas sin staging explícitamente autorizado.
3. La bitácora/auditoría se conserva; el rollback de W1 no genera ni borra eventos.
4. El `DROP` de tablas exige aprobación de pérdida de datos y sólo aplica
   post-apply; en el alcance local **no** se ejecuta.
