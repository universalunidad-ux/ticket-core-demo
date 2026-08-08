# F17-W1 — Baseline de esquema y autorización (Seguimiento / staff)

Estado del artefacto: **PREPARED_NOT_APPLIED**. Esta unidad prepara localmente
una única migración aditiva de fundación; **no** la aplica, **no** despliega y
**no** contacta Supabase remoto. El apply remoto queda `DEFERRED_OUT_OF_SCOPE`
(`APPLY_READY=NO`).

## Alcance de la migración

Archivo: `supabase/migrations/20260723080712_f17_staff_schema_authz_foundation.sql`.

Crea 9 tablas core del dominio de Seguimiento, habilita RLS en las 9, revoca
todo privilegio a `PUBLIC`/`anon`, otorga sólo `SELECT` a `authenticated` y
declara 18 policies de lectura (2 por tabla) con predicado rol + pertenencia.
Los writers (`INSERT/UPDATE/DELETE`) se difieren a RPC posteriores (W3+): en W1
**no** existe ninguna policy de escritura ni ningún grant de DML core.

### Nueve tablas

1. `staff_teams` — equipos de soporte reales; soft-disable; sin DELETE funcional.
2. `staff_team_memberships` — membresía con vigencia; una activa por par (team, profile).
3. `staff_conversations` — una conversación por agente de soporte; CAS por `version`.
4. `staff_messages` — append-only; sin UPDATE/DELETE; `ticket_id` sólo referencia.
5. `staff_message_revisions` — append-only; edición vía RPC (ventana 15 min).
6. `staff_announcements` — lifecycle append-only; exclusión de solapes por `audience_hash` (btree_gist).
7. `staff_announcement_targets` — snapshot congelado por receptor.
8. `staff_message_receipts` — upsert monotónico; self-owned.
9. `support_agent_scopes` — scopes `specialty/machine/family` (**nunca** `team`).

Adjudicación canónica: equipos y membresías son **tablas reales**; los scopes
**no** codifican equipos (`support_agent_scopes` sin `scope_kind='team'`).

## Modelo de autorización (RLS fail-closed)

- `anon` / `PUBLIC`: cero privilegios de tabla y cero policies. Sin acceso.
- `authenticated`: sólo `SELECT`; cero DML core. Toda lectura pasa por policy.
- **admin** (`public.tc_is_admin()`): lectura total de las 9 tablas.
- **soporte** (`public.tc_current_role() = 'soporte'` + predicado de pertenencia):
  ve únicamente su conversación, sus mensajes/revisiones, su membresía, sus
  scopes activos, sus receipts, sus targets y los anuncios vigentes dirigidos a
  sí mismo (`starts_at <= now() < ends_at`, no cancelado, no reemplazado).
- **supervisor / ventas / null / no-profile**: cero filas (los predicados de
  propiedad atados a `auth.uid()` no coinciden con ninguna fila de staff).

Las policies son permisivas (combinan con OR) pero cada una incluye predicado de
rol + pertenencia; `TO authenticated` por sí solo nunca autoriza.

> Nota de reconciliación (apply-time): el literal de rol `'soporte'` y las dos
> familias de helpers AuthZ deben reconciliarse contra el snapshot remoto antes
> de aplicar. En W1 el gate de owner/ACL/`search_path`/Security Definer es de
> **diseño** y queda `PENDING` para ejecución en vivo.

## Guards fail-closed

La migración aborta (sin `IF NOT EXISTS` que oculte colisiones) si: falta o es
incompatible `public.perfiles(id,rol)`, `public.tickets(id)` o `public.bitacora`;
falta `auth.uid()`; faltan los helpers `tc_current_role()` / `tc_is_admin()`;
preexiste algún homónimo F17; o falta la extensión `btree_gist`.

## Gates y conteos publicados (derivados, no inventados)

Gate Node estático (sin DB), integrado al runner canónico
`tools/run-contract-tests.mjs` con `process.execPath` y exit 0 obligatorio:

- `tools/f17-schema-contract.test.mjs`: `F17_SCHEMA_CONTRACT_ASSERTIONS=35`; mutaciones M01–M08 (8/8 KILLED).
- `tools/f17-policy-contract.test.mjs`: `F17_POLICY_CONTRACT_ASSERTIONS=56`; mutaciones M09–M10 (2/2 KILLED).
- Corpus de sensibilidad: `NEGATIVE_FIXTURES=10`, `SENSITIVITY_MUTATIONS=10`, mapeo 1:1 mutación→detector.
- Marcadores del runner: `F17_SCHEMA_CONTRACT=PASS`, `F17_POLICY_CONTRACT=PASS`, `F17_NEGATIVE_TESTS=PASS`, `F17_SENSITIVITY=PASS`.

SQL tests preparados (`supabase/tests/f17_schema_contract.sql`,
`supabase/tests/f17_rls_negative.sql`): ejecución **sólo** en Postgres local
efímero autorizado. Sin ese entorno se entregan no ejecutados y su gate queda
`PENDING`; no se declara cobertura viva.

## Fuera de alcance (no tocar)

`app/**`, `supabase/functions/**`, migraciones existentes, `avisos_globales`,
`ticket_eventos`, `reglas_asignacion`, `soporte_adjuntos`, Storage, Realtime,
cualquier RPC funcional, seeds y workflows CI. Preservados íntegros U1, SEC02-W1,
SEC02-W2 y PR14. Sin cambios de frontend ni Portal.
