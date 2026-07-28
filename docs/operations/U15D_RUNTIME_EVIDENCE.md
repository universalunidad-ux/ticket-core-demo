# U15D — Evidencia de validación runtime de `public.manage_ticket_assignment`

Unidad: `TC-U15D-ASSIGNMENT-RUNTIME-01`
Worktree: `EXPIRITI_REPOS/_WORKTREES/ticket-core-demo/u15d-runtime-20260725`
Branch: `test/u15d-runtime-20260725`
HEAD BASE: `281f79cd03d702e9b0c4b18ca5a0afb32bdd7642`

## Estado por fase (no confundir estas categorías)

| Categoría | Estado | Detalle |
|---|---|---|
| PLANIFICADO | ✅ | Matriz de 16 escenarios definida (ver tabla abajo). |
| IMPLEMENTADO LOCAL | ✅ | `supabase/tests/u15d_assignment_runtime.sql`, `supabase/tests/u15d_assignment_concurrency.sql`, `tools/local-db/run-u15d-runtime.sh`, `tools/u15d-assignment-runtime-contract.test.mjs` creados y ejecutados en preflight (ver "Metodología de validación"). |
| DESPLEGADO | ❌ N/A | No aplica: esta unidad no toca staging/producción. `SUPABASE_REMOTE=NO`. |
| VALIDADO EN VIVO (Docker/Supabase local oficial) | ⏸ PENDIENTE | El carril Docker/Supabase local es compartido y estaba en uso por otra unidad al momento de esta ejecución (`DOCKER_LANE_OWNER=RECOVERY_V2`, cola `AFTER_U15C`). Por instrucción explícita de orquestación, **no se inició Docker ni Supabase local** en esta pasada. `tools/local-db/run-u15d-runtime.sh` queda listo para ejecutarse en cuanto el carril esté libre. |

## Qué se validó realmente en esta pasada (sin Docker)

No se ejecutó `psql` contra un Postgres real vía Docker/Supabase CLI en esta
pasada (instrucción explícita: no iniciar el carril compartido). En su lugar,
se usaron dos vías **no-Docker**, dentro de lo autorizado ("pruebas
estáticas, Node, diff... que no usen el runtime Docker compartido"):

1. **Contrato estático** (`tools/u15d-assignment-runtime-contract.test.mjs`,
   ejecutable con `node tools/u15d-assignment-runtime-contract.test.mjs`):
   verifica que la RPC real no fue tocada, que ningún artefacto nuevo
   redefine `manage_ticket_assignment`, que no se referenció
   `reglas_asignacion`, que no se tocó U15C ni `app/`, que
   `run-u15d-runtime.sh` es fail-closed y nunca hace push/commit/deploy, y
   que los dos archivos SQL cubren los 16 escenarios pedidos.

2. **Preflight funcional en proceso** (Node + `@electric-sql/pglite`, un
   motor Postgres real compilado a WASM que corre embebido, **sin Docker y
   sin el paquete Supabase local**): se replicaron las 31 migraciones reales
   del repo tal cual (sin editarlas) sobre un shim mínimo de
   `auth.users`/`auth.uid()`/`auth.role()`/`storage.*` y los roles
   `anon`/`authenticated`/`service_role`, y se corrió la lógica de los 14
   escenarios de `u15d_assignment_runtime.sql` más una réplica secuencial de
   la lógica de `u15d_assignment_concurrency.sql`. Resultado: **14/14 PASS**
   en el archivo runtime y **PASS** en la réplica lógica de concurrencia
   (ver detalle abajo). Esto da confianza real en la lógica SQL, pero **no
   sustituye** la ejecución oficial: PGlite no es Docker ni el stack
   Supabase local, y al ser una única conexión no puede reproducir el
   *bloqueo* real entre dos sesiones concurrentes (sólo la lógica de
   conflicto de versión, ver limitación explícita más abajo).

Ambas vías corren fuera del carril Docker compartido, consistente con la
instrucción de orquestación recibida.

## Matriz de escenarios (16 pedidos)

| # | Escenario | Cubierto en | Resultado preflight (PGlite, no oficial) |
|---|---|---|---|
| 1 | Asignación inicial | `u15d_assignment_runtime.sql` bloque 1 | PASS |
| 2 | Reasignación | bloque 2 | PASS |
| 3 | Desasignación | bloque 3 | PASS |
| 4 | Replay idempotente | bloque 4 | PASS |
| 5 | Misma key, payload distinto | bloque 5 | PASS (23505 `TC_IDEMPOTENCY_KEY_REUSED`) |
| 6 | Expected `fecha_actualizacion` obsoleta | bloque 6 | PASS (40001 `TC_ASSIGNMENT_VERSION_CONFLICT`) |
| 7 | Admin (positiva) | bloque 1 y 7/8/9 | PASS |
| 8 | Supervisor (negativa) | bloque 7/8/9 | PASS (42501 `admin_or_edge_required`) |
| 9 | Soporte no autorizado | bloque 7/8/9 | PASS (42501) |
| 10 | Anon | bloque 10 | PASS (`insufficient_privilege`, EXECUTE revocado) |
| 11 | Usuario sin perfil | bloque 11 | PASS (42501) |
| 12 | Dos supervisores concurrentes | `u15d_assignment_concurrency.sql` (fases race a/b) | PASS lógico (ver nota de sustitución abajo); bloqueo real pendiente de Docker |
| 13 | Auditoría exactamente una vez | bloque 4 y verify de concurrencia | PASS |
| 14 | `ticket_eventos` | bloque 1 y 4 | PASS |
| 15 | Lectura posterior consistente | bloque 13 | PASS |
| 16 | Escalada de rol bloqueada | bloque 12 | PASS (42501, JWT/metadata forjados ignorados) |
| 17 | Rollback sin filas parciales | bloque 14 | PASS (23503 en el punto medio, sin fila huérfana, reintento limpio) |

(17 filas porque "ticket_eventos" y "auditoría exactamente una vez" son
escenarios distintos del pedido original que además comparten evidencia con
otros bloques; los 16 ítems del ticket están todos cubiertos.)

## Nota sobre "supervisor" en la prueba de concurrencia

`perfiles.rol = 'supervisor'` existe en el esquema, pero
`public.manage_ticket_assignment` sólo autoriza `admin` o `service_role`
(`app_private.has_role(array['admin'])`); un supervisor recibe 42501, igual
que soporte (ver escenario 8 en la tabla). Por lo tanto, la prueba de
concurrencia usa **dos actores `admin`** para poder observar la propiedad
real que importa — exclusión mutua vía `for update` + rechazo determinista
por versión obsoleta (40001), nunca *lost update* — en vez de dos llamadas
que fallarían trivialmente por autorización antes de llegar a competir por
el lock. Esta sustitución está documentada también dentro del propio
`supabase/tests/u15d_assignment_concurrency.sql`.

## Limitación explícita del preflight (PGlite)

PGlite es una única conexión embebida: puede ejecutar la lógica SQL real de
cada llamada, pero no puede abrir dos sesiones Postgres independientes que
se bloqueen entre sí sobre el mismo `for update`. La réplica de concurrencia
hecha en preflight fue **secuencial** (side A completa y "commitea" antes de
que side B corra con el mismo `expected_fecha_actualizacion` ya obsoleto),
lo cual valida el **mecanismo de rechazo por versión** pero no el
**bloqueo/espera real entre sesiones**. Esa segunda propiedad sólo se puede
demostrar con dos procesos `psql` reales corriendo en paralelo contra el
mismo Postgres — exactamente lo que hace la fase `race` (side=a/side=b) de
`u15d_assignment_concurrency.sql` cuando se ejecuta vía
`tools/local-db/run-u15d-runtime.sh` con Docker/Supabase CLI reales.

## Hallazgos (no son defectos de la RPC)

- `now()` es constante durante toda una transacción Postgres explícita. Los
  archivos de prueba que envuelven todo en `begin;...rollback;`
  (`u15d_assignment_runtime.sql`, y las pruebas existentes de
  `authz_negative.sql`) no pueden usar "`fecha_actualizacion` avanzó" como
  aserción dentro de esa misma transacción; se documentó explícitamente en
  el archivo y se usó en su lugar la prueba directa de conflicto de versión
  (escenario 6) para validar la concurrencia optimista real.
- El replay idempotente (misma key + mismo hash) devuelve el estado
  `completed` almacenado **sin volver a validar**
  `expected_fecha_actualizacion`: es el comportamiento esperado de un
  "replay" (debe devolver la misma respuesta, no revalidar), y se dejó
  como prueba explícita en el bloque 4, no como hallazgo a corregir.
- No se encontró ningún caso donde la RPC dejara filas parciales o un claim
  de idempotencia atascado en `processing` tras un fallo a mitad de función
  (escenario 17): el `raise exception` sin manejar dentro de la propia
  función aborta toda la subtransacción de la llamada, incluido el
  `insert` de `edge_idempotency` hecho por `claim_edge_idempotency`.

**No se modificó `public.manage_ticket_assignment` ni ninguna migración
existente.** No se encontró ningún defecto runtime reproducible que
justificara tocarla.

## Artefactos de esta unidad

- `supabase/tests/u15d_assignment_runtime.sql` — 14 bloques `do $$ ... $$`,
  fixtures efímeros (`begin; ... rollback;`), helpers de sesión
  (`pg_temp.act/act_anon/act_forged/reset_su`, mismo patrón que
  `authz_negative.sql`).
- `supabase/tests/u15d_assignment_concurrency.sql` — 4 fases
  (`setup`/`race`/`verify`/`teardown`) parametrizadas con variables `psql
  -v`, pensadas para dos procesos `psql` reales en paralelo. Es el único
  archivo de esta unidad que persiste (COMMIT) entre invocaciones, con
  limpieza explícita en `teardown`.
- `tools/local-db/run-u15d-runtime.sh` — entrada host fail-closed (mismo
  estilo que `tools/local-db/run-local-db-harness.sh`): exige macOS,
  Node≥22, Docker, Supabase CLI y `psql`; rechaza entornos/target remotos;
  levanta Supabase local efímero, corre ambas suites, escribe
  `tools/local-db/.artifacts/u15d-<timestamp>/00_FINAL_RESULT.txt`, detiene
  Supabase (salvo `--keep-up`). **No ejecutado en esta pasada** (carril
  Docker compartido, ver arriba).
- `tools/u15d-assignment-runtime-contract.test.mjs` — contrato estático,
  ejecutado localmente con Node en esta misma pasada.

## Cómo correrlo de verdad (cuando el carril Docker esté libre)

```bash
tools/local-db/run-u15d-runtime.sh            # ejecución completa
tools/local-db/run-u15d-runtime.sh --dry-run  # sólo prechecks, sin Docker
node tools/u15d-assignment-runtime-contract.test.mjs
```

## Próximo paso

Ejecutar `tools/local-db/run-u15d-runtime.sh` contra Docker/Supabase local
real en cuanto el carril compartido quede libre (después de U15C), y
reemplazar los resultados "PASS lógico (preflight PGlite)" de este documento
por los de `tools/local-db/.artifacts/u15d-<timestamp>/00_FINAL_RESULT.txt`.
