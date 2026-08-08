# RECOVERY V2 — Runbook operativo

UNIDAD: `TC-RECOVERY-SITE-CONFIG-OWNERSHIP-01`
WORKTREE: `_WORKTREES/ticket-core-demo/recovery-v2-20260725`
BRANCHES AUTORIZADAS: `test/recovery-v2-20260725` y `test/rc-u15d-recovery-v2-20260727`
HEADS BASE AUTORIZADOS: rama histórica `7feeebcee01fc655d8594cb80186d7887b06a47b`; rama RC `f7f2cac62df7d86d66396e377080e23a5b5cd210`

**Estado de esta unidad: IMPLEMENTADO LOCAL (código) · NO VALIDADO EN VIVO.**

Todo lo de abajo fue escrito y verificado **estáticamente** (`bash -n`, `node --check`,
`node --test` con mocks, contratos semánticos, `git diff --check`, secret gate) en un entorno
de autoría **sin ejecutar Docker, Supabase CLI, `psql` ni SQL**. Ningún paso que toque una base viva
(bootstrap, migraciones, dump/restore real, paridad, medición real de RPO/RTO) se ha ejecutado.
**PLANIFICADO → IMPLEMENTADO LOCAL → COMMIT LOCAL → PUSH REMOTO → DESPLEGADO → VALIDADO EN
VIVO**: esta unidad llega hasta IMPLEMENTADO LOCAL. Todo lo posterior es `NO`.

**Siguiente paso literal:** ejecutar `tools/local-db/run-recovery-v2-synthetic.sh` en una
Terminal macOS con Docker Desktop corriendo y Supabase CLI instalada
(`RUN_FROM_MACOS_TERMINAL`). El orquestador crea primero la fuente sintética, la detiene por
completo y sólo después inicia Recovery destino. Tratar la primera corrida
como una prueba: revisar `tools/local-db/.artifacts-recovery/<ts>/00_RESULT.txt` línea por
línea antes de asumir que algo funciona de punta a punta.

---

## 1. Causa raíz del incidente original

El restore previo falló porque el dump incluyó el schema **platform-managed** `realtime`.
`realtime.list_changes(...)` se define con `SET log_min_messages TO 'fatal'`;
`log_min_messages` es un GUC de clase **SUSET** (sólo superuser puede fijarlo). Al restaurar
con un rol no-superuser, PostgreSQL aborta con *"must be superuser to set parameter"*, y con
restore atómico cae todo el proceso.

**El fix no es superuser: es mover la frontera.** La plataforma se obtiene del bootstrap
Supabase; la aplicación se reconstruye desde migraciones + un dump de datos filtrado por
allowlist. Análisis completo en
`_ANALYSIS_OUTPUTS/TC_SUPABASE_RECOVERY_BOUNDARY_OPUS_01/00_RESULT.md`.

## 2. Propiedad del código (owners únicos)

| Capacidad | Owner ÚNICO | Consumidores |
|---|---|---|
| Bootstrap Supabase local (scaffold, `config.toml`, `project_id`, puertos, enlace de migraciones, `supabase start`, resolución de contenedor) | `tools/local-db/lib/bootstrap.mjs` | `run-recovery-v2.sh`, `harness.mjs` |
| Teardown del stack | `tools/local-db/lib/bootstrap.mjs --stop` | `run-recovery-v2.sh` |
| Clasificación LOCAL/REMOTO y guarda de entorno | `tools/local-db/lib/guards.mjs` | ambos |
| Allowlist y análisis del dump | `tools/local-db/lib/dump-allowlist.mjs` | `run-recovery-v2.sh` |
| Ownership y restore atómico de `site_config` | `tools/local-db/site-config-ownership.json` + `tools/local-db/lib/site-config-ownership.mjs` | `run-recovery-v2.sh` |
| Seed sintético de `auth.users` | `tools/local-db/lib/auth-seed.mjs` | `run-recovery-v2.sh` |
| Usuarios Auth sintéticos de la fuente, vía Auth Admin API local | `tools/local-db/lib/local-auth-users.mjs` | `run-recovery-v2-synthetic.sh` |
| Secuencia fuente → archivos persistidos → destino | `tools/local-db/run-recovery-v2-synthetic.sh` | operador local |
| Orden de carga de datos (allowlist de tablas) | `tools/local-db/recovery-data-order.txt` | `dump-allowlist.mjs`, contratos |
| Firma de comparación | `tools/local-db/recovery-signature.sql` | `run-recovery-v2.sh` |
| Validación de integridad post-restore | `tools/local-db/fk-integrity.sql` | `run-recovery-v2.sh` |

**No existe bootstrap inline.** `run-recovery-v2.sh` no ejecuta `supabase start` por su
cuenta ni resuelve contenedores por sí mismo: invoca a `bootstrap.mjs`. Cualquier
reintroducción de un `supabase start` o de un `docker ps | head -1` dentro del script es una
regresión y los contratos la rechazan.

## 3. Identidad del clon de recuperación

| Parámetro | Valor | Por qué |
|---|---|---|
| `project_id` | `tc_recovery_v2` | Distinto del harness (`tc_local_db_harness`): el contenedor es distinguible por nombre |
| Puerto DB (default) | **54339** (`--db-port` lo cambia) | Distinto del harness; permite exigir coincidencia por nombre **Y** puerto |
| Puerto shadow / API | `dbPort+1` / `dbPort+100` | Derivados en `derivePorts`, un único lugar decide el reparto |
| Contenedor esperado | `supabase_db_tc_recovery_v2` | Se exige **exactamente una** coincidencia (nombre AND puerto publicado) |
| Runtime efímero | `tools/local-db/.runtime-recovery` | Bajo `tools/local-db/` (guarda de alcance), en `.gitignore` |
| Artefactos | `tools/local-db/.artifacts-recovery/<ts>/` | En `.gitignore`; **nunca** se borran |

`DB_URL` y `CID` salen de la **misma** resolución dentro de `startLocalStack`: el puerto con
el que se busca el contenedor se deriva de la `DB_URL` real que reporta `supabase status`. El
script verifica `BOOTSTRAP_CID_DB_URL_SINGLE_SOURCE=YES` y aborta si no lo recibe (anti
split-brain).

## 4. Gate explícito de ejecución con Docker

`--dry-run` corre **sólo** la FASE 0 (guardas) y termina con `RESULT=PASS`,
`BOOTSTRAP_RESULT=SKIPPED_DRY_RUN` y **`SCORABLE=NO`**. Nunca toca Docker.

Sin `--dry-run`, antes de `DOCKER_USED=YES` deben pasar, en este orden y todos fail-closed:
host `Darwin`/`Linux` · `node >= 22` · worktree git · rama `test/*` · guarda anti-remoto
(`inspectEnvForRemote` + `classifyTarget` sobre `--source-db-url`) · guarda de alcance del
runtime · `docker` en PATH · `docker info` responde · **cero contenedores `supabase_*`
activos** · `supabase` CLI · `pg_dump`/`psql` host disponibles para la ruta opcional
`--source-db-url`. `DOCKER_USED` sólo
pasa a `YES` cuando **todo** lo anterior pasó.

### 4.1 Fuente persistida secuencial

`run-recovery-v2.sh` conserva `--source-db-url` para una DB local no gestionada que no implique
otro stack Supabase activo. La ruta canónica scorable usa tres evidencias inseparables:

- `--dump <archivo local regular, no symlink>`;
- `--source-signature-file <archivo local regular, no symlink>`;
- `--source-cutoff-epoch <entero>`.

`--dump` solo sigue siendo `SCORABLE=NO`; firma sola, cutoff solo, o dump+firma sin cutoff
aborta en precheck. Los tres juntos fijan
`SOURCE_SIGNATURE_MODE=PERSISTED_SEQUENTIAL`. Una firma incompleta o cualquier diff bloqueante
fija `SOURCE_SIGNATURE_RESULT=FAIL`/`SOURCE_SIGNATURE_FAILED` y prohíbe PASS.

## 5. Allowlist / never-restore

- **ALLOWLIST (dump y restore de datos):** `public`, `app_private`.
- **`app_private` tiene 0 tablas** (0 `create table` en las 31 migraciones), 2 vistas y 12
  funciones: en el plano de datos sólo hay filas en `public`. Se mantiene en la allowlist por
  si se agregan tablas; el contrato falla a propósito si eso cambia sin actualizar este runbook.
- **NUNCA restaurar:** `realtime.*`, `_realtime.*`, `pgsodium.*`, `vault.*`, `graphql*.*`,
  `supabase_functions.*`, `auth.*`, `storage.*`, `extensions`, `supabase_migrations` (ledger:
  se repuebla por reaplicación, no se restaura), y cualquier parámetro/función SUSET.
- **Tablas `public` efímeras excluidas:** `rate_limit_events`, `edge_idempotency`,
  `support_idempotency`, `ticket_portal_logs`.

### 5.1 Cómo se comprueba (dos planos, ninguno opcional)

1. **TOC (`pg_restore -l`) → adjudicación POSITIVA.** `dump-allowlist.mjs` enumera lo que
   realmente se restauraría y exige que **todo** encaje: sólo descriptores `TABLE DATA` y
   `SEQUENCE SET`, sólo schemas `public`/`app_private`, sólo tablas listadas en
   `recovery-data-order.txt`, ninguna de las 4 efímeras. Un dump **sin** entradas de datos
   también aborta.
2. **CONTENIDO (`pg_restore --data-only -f -`) → escaneo de sentencias.** Los nombres de la
   TOC no revelan un `SET log_min_messages`, un `GRANT`, un `ALTER … OWNER TO`, un
   `SECURITY DEFINER` ni un `COPY` a un schema de plataforma. El SQL se consume **en
   streaming por una tubería**, nunca se escribe a disco, y el informe sólo contiene
   **nombre de regla + número de línea + conteo** — jamás la línea ni las filas.
   Los patrones de `tools/secret-gate-patterns.txt` se aplican en el mismo paso.

La ruta sintética scorable usa el toolchain de cada servidor. El `pg_dump` del contenedor
fuente escribe el custom dump por `stdout` directamente en
`05_source_app_data.dump` del host. Después de detener por completo la fuente, el
`pg_restore` del contenedor destino lee ese mismo archivo por `stdin`; TOC, escaneo de
contenido, extracción de `perfiles` y restore final siguen el mismo mecanismo. No existe
`docker cp` ni una copia del dump dentro del contenedor.

Antes del restore se exige:

- `SOURCE_CLIENT_MAJOR == SOURCE_SERVER_MAJOR`;
- `DESTINATION_CLIENT_MAJOR == DESTINATION_SERVER_MAJOR`;
- `SOURCE_SERVER_MAJOR == DESTINATION_SERVER_MAJOR`.

Una violación aborta con `STOP_CODE=E_TOOLCHAIN_INCOMPATIBILITY`, conserva artefactos,
ejecuta teardown y mantiene `SCORABLE=NO`. Los clientes host 18.4 siguen disponibles y
alineados para operación general, pero no restauran el dump contra el PostgreSQL 15 local.

> La guarda anterior (grep de `FORBIDDEN_PATTERN` sobre la TOC de un dump `--data-only`) era
> **vacua**: en esa TOC nunca aparece una entrada `SCHEMA - realtime`, así que no podía fallar.
> Está eliminada.

### 5.2 Ownership exacto de `public.site_config`

Clasificación: **`SOURCE_DATA_OWNED`**.

La decisión no se basa sólo en que la tabla aparezca en el dump:

- `20260715023825_assignment_and_configuration.sql:30-58` crea
  `public.site_config`, limita el universo a seis claves e instala un seed
  completo para que una baseline nueva sea utilizable.
- `20260715023827_functions_triggers_and_indexes.sql:273-313` define
  `public.manage_site_config(text,text)`: bloquea la fila, sustituye el valor y
  registra la mutación en `bitacora`. Por tanto, el seed deja de ser autoritativo
  después de operar la aplicación.
- `app/config-loader.js:50-83` consume los valores como contenido, con defaults
  locales sólo para degradación; `app/dashboard.js:765-827` inventaría las seis
  claves y mantiene la edición remota bloqueada mientras falta el workflow
  draft/publish. Ninguna Edge Function llama `site_config`.
- `tools/local-db/recovery-data-order.txt` ya clasifica la tabla dentro de los
  datos application-owned y `recovery-signature.sql:419-421` exige paridad de
  filas completa.

La política positiva vive en `site-config-ownership.json`: seis claves
source-owned, cero environment-owned, claves desconocidas/faltantes/duplicadas
rechazadas. Sus nombres no se imprimen en logs; los diagnósticos usan conteos y
SHA-256.

El restore usa dos transacciones deliberadas:

1. La lista TOC del restore general comenta **exactamente** la entrada `TABLE
   DATA public.site_config`; las otras 21 tablas permanecen seleccionadas.
2. El `COPY` de `site_config` se consume por streaming y
   `site-config-ownership.mjs` emite `BEGIN` → `DELETE` acotado a esa tabla →
   `COPY` → validación exacta de claves → `COMMIT`. Cualquier error desconecta la
   sesión antes del commit, preserva `RESULT=FAIL`/`SCORABLE=NO` y activa el
   teardown obligatorio.

Antes de lo anterior se valida que las migraciones dejaron exactamente las seis
claves baseline (`SITE_CONFIG_BASELINE_VALIDATED=PASS`). La firma final conserva
`site_config` en `DATA`: no se clasifica como no comparable ni se reduce la
paridad.

## 6. Arquitectura obligatoria (10 pasos) → dónde vive cada uno

| # | Paso | Implementación |
|---|---|---|
| 1 | Bootstrap limpio | PASO 1: `node tools/local-db/lib/bootstrap.mjs --project-id tc_recovery_v2 --db-port 54339 --runtime-dir tools/local-db/.runtime-recovery --reset-runtime` |
| 2 | Migraciones canónicas | PASO 2: `supabase db reset --workdir …` (31 migraciones) + **ledger fail-closed** (`≠31` ⇒ abort, nunca WARN) |
| 3 | Nunca platform-managed | §5.1: allowlist positiva sobre TOC + escaneo de contenido |
| 4 | Dump/restore application-owned | PASO 4: restore general atómico de 21 tablas con lista TOC exacta + sustitución atómica SOURCE_DATA_OWNED de `site_config`; ambos usan clientes major 15 del contenedor |
| 5 | `auth.users` antes de `perfiles` | PASO 4f: seed sintético (§7) |
| 6 | Buckets y policies por migración | Aplicados en el PASO 2; verificados en PASO 8 |
| 7 | Blobs fuera de `pg_dump` | PASO 7: plano separado, sólo `--blobs-src <dir local>`; rechaza `s3://`/`http(s)://` |
| 8 | Comparar datos/RLS/ACL/funciones/search_path | PASO 8 con `recovery-signature.sql` (§9) |
| 9 | Medir RPO/RTO | PASO 9 |
| 10 | Teardown completo | PASO 10 → `teardown_stack()` (§8) |

## 7. `auth.users`: seed sintético (P7)

`public.perfiles.id` referencia `auth.users(id)`, y `auth.*` es platform-managed: **no viaja
en el dump**. Sin usuarios, el restore de `perfiles` cae por FK.

Mecanismo canónico — `tools/local-db/lib/auth-seed.mjs`:

- **UUID deterministas:** los `id` son exactamente los `perfiles.id` del dump. No se inventan
  y son los únicos valores que satisfacen la FK. Un UUID no es un dato personal.
- **Todo lo demás es sintético:** correo `usr-<12hex>@example.invalid` (dominio reservado,
  RFC 2606/6761, no resoluble), `encrypted_password` fijado a un marcador que **no** es un hash
  bcrypt válido (ninguna de esas cuentas puede autenticarse), timestamps fijos, metadata vacía.
- **Sin PII:** el `COPY` de `perfiles` (que sí trae nombres y correos reales) se consume por
  **tubería**; sólo se extrae la columna `id` y el resto se descarta en el acto. El artefacto
  `04f_auth_seed.sql` contiene únicamente UUID y correos `@example.invalid`.
- **Fail-closed:** si la columna `id` de una fila no es un UUID (parseo desalineado), se aborta
  sin emitir el valor. `assertSyntheticOnly()` rechaza el SQL si aparece cualquier correo fuera
  del dominio reservado o si se toca algo distinto de `auth.users`.
- **Idempotente:** `insert … on conflict (id) do nothing`.

La relación se verifica después con `fk-integrity.sql`: `PERFILES_WITHOUT_AUTH_USER` debe ser
`0` y `AUTH_USERS_NON_SYNTHETIC` debe ser `0`.

### 7.1 Cuatro identidades de la fuente

Antes de ejecutar `staging_synthetic_seed.sql`, `local-auth-users.mjs` acepta únicamente
`localhost`, `127.0.0.1` o `::1`, recibe la service role por
`SUPABASE_SERVICE_ROLE_KEY` (nunca argumento), y crea o reutiliza exactamente:
`tc-recovery-admin@example.invalid`, `tc-recovery-supervisor@example.invalid`,
`tc-recovery-support-a@example.invalid` y `tc-recovery-support-b@example.invalid`.
Sólo devuelve `rol=UUID`. Exige cuatro UUID distintos y metadata
`TC_RECOVERY_SYNTHETIC_V1`; una identidad preexistente sin ese marcador es una colisión
no sintética y aborta.

Los guards ausentes del seed ya no usan `\quit 3`: cada uno emite su
`STOP=<variable>_REQUIRED` y ejecuta un bloque SQL que lanza excepción.
`\set ON_ERROR_STOP on` fuerza `rc!=0`, ninguna DML posterior es alcanzable, y
`STAGING_SYNTHETIC_SEED=PASS` sólo aparece después de un `COMMIT` exitoso.

## 8. FK circular, triggers, ownership y teardown

### 8.1 FK circular `tickets` ↔ `solicitudes_soporte`

`public.tickets.solicitud_soporte_id → solicitudes_soporte(id)` y
`public.solicitudes_soporte.ticket_id → tickets(id)`. **Ninguna es `DEFERRABLE`**, así que
`SET CONSTRAINTS … DEFERRED` no aplica, y `ALTER TABLE … DISABLE TRIGGER USER` **no** desactiva
los triggers internos de integridad referencial: no es una mitigación válida.

**Estrategia elegida (`CIRCULAR_FK_STRATEGY=DROP_AND_REVALIDATING_RECREATE`):**

1. Se inventarían las dos constraints con `pg_get_constraintdef` y se guardan literales en
   `04j_circular_fk.txt`. Si no son exactamente **2**, se aborta (el esquema no es el
   documentado).
2. Se **retiran** ambas (`DROP CONSTRAINT`) — operación de *owner*, sin superuser.
3. Se cargan los datos.
4. Se **recrean** con su definición original. El `ADD CONSTRAINT` **revalida todas las filas**:
   si el restore dejó huérfanas, falla ahí. La estructura final es idéntica a la de partida
   (lo confirma además `SECTION=STRUCTURE` en la paridad).

`DISABLE TRIGGER USER` se mantiene sólo como higiene de carga (evitar triggers de aplicación),
nunca como argumento de integridad.

### 8.2 Restitución garantizada

Entre el paso 2 y el 4, `INTEGRITY_SUSPENDED=yes`. `restore_integrity()` reactiva triggers y
recrea las constraints, es **idempotente**, y se invoca desde el camino feliz, desde `abort()`
y desde el manejador de señales. Un fallo de streaming, de `pg_restore` o de la validación
**no** puede dejar el clon con integridad suspendida. Si aun así falla,
`INTEGRITY_RESTORE_RESULT=FAIL` y `RESULT` nunca puede ser `PASS`.

### 8.3 Ownership

Antes de **cualquier** `ALTER TABLE` se comprueba que ninguna tabla de `public`/`app_private`
tenga `tableowner <> current_user`. Si la hay, se aborta sin ejecutar ningún `ALTER`:
`OWNERSHIP_CHECK=FAIL`. Se vuelve a verificar tras el restore
(`TABLE_OWNER_MISMATCH` en `fk-integrity.sql`).

### 8.4 Teardown (P5)

`teardown_stack()` es el **único** camino de parada:

- **Ownership del stack:** `STACK_OWNED` pasa a `yes` **sólo después** de que el bootstrap
  acreditó que el contenedor es `supabase_db_tc_recovery_v2`. Mientras valga `no`, ningún
  camino de salida detiene ni inspecciona nada → `DOCKER_STOPPED=NOT_OWNED`.
- **Idempotencia:** `STOP_ATTEMPTED` garantiza **como máximo un** `stop` en toda la corrida.
- **Sólo el stack propio:** el stop lo hace `bootstrap.mjs --stop`, que exige que el
  `config.toml` del workdir declare `project_id = "tc_recovery_v2"`. Sin esa prueba lanza
  `E_SCOPE_VIOLATION` y **no** ejecuta nada. Nunca se detiene ni se inspecciona
  destructivamente infraestructura ajena.
- **Borrado del runtime:** `--remove-runtime` sólo se honra **si el stop devolvió 0**.
- **Cuando el stop falla se preserva todo:** runtime, `project_id`, `CID`, puerto efectivo y
  la línea de recuperación manual quedan en `10_teardown_preserved.txt`;
  `DOCKER_STOPPED=FAIL`, `RUNTIME_PRESERVED=YES`, `RUNTIME_DELETED=NO`.
- **Artefactos:** `00_RESULT.txt` y los logs de fase **nunca** se borran, en ningún camino.
- **Señales:** `INT` (Ctrl-C) y `TERM` fijan `RESULT=FAIL`, `SCORABLE=NO`, `INTERRUPTED=YES`
  y `STOP_CODE=E_INTERRUPTED_INT|TERM`, restituyen integridad, hacen teardown, escriben el
  reporte y salen con `130`/`143`. **Ctrl-C no puede terminar como PASS.**
- `--keep-up` deja el clon arriba a propósito: `DOCKER_STOPPED=KEPT_UP`,
  `RUNTIME_PRESERVED=YES`, y `NEXT_ACTION` indica el comando exacto de parada manual.

## 9. Comparación (paso 8) — `recovery-signature.sql`

`REPORT_ONLY` (sólo `SELECT`/`\echo`). Se corre contra el destino y se compara con la firma
obtenida por `--source-db-url` o con `--source-signature-file`; la salida se parte por
`SECTION=` y se compara sección a sección.

**BLOQUEANTES (cualquier divergencia ⇒ abort):**

- **STRUCTURE** — esquemas, columnas (hash), conteos, vistas, constraints, índices,
  `relrowsecurity`.
- **FUNCTIONS** — inventario, `SECURITY DEFINER`, `search_path` fijado, hash del cuerpo, grants.
- **POLICIES** — `pg_policies` de `public`/`app_private` + las 2 policies sobre
  `storage.objects`; hash de `qual`/`with_check`.
- **ACL** — matriz `has_table_privilege` para `anon`/`authenticated`/`service_role`.
- **DATA** — conteo + hash por fila de las 22 tablas. `public.bitacora` se hashea
  **excluyendo** `detalle` (`to_jsonb(t) - 'detalle'`). `edge_idempotency` queda fuera.

Un fallo o truncamiento de la firma (de la fuente **o** del destino) también aborta: **no
comparar no es lo mismo que comparar y coincidir.**

**INFORMATIVAS (nunca abortan, nunca participan del veredicto):** `LEDGER` (repoblado por
reaplicación), `STORAGE` (blobs en plano separado), `OWNERSHIP` (efecto de `--no-owner`). Se
reportan en `LEDGER_PARITY`, `STORAGE_PARITY`, `OWNERSHIP_PARITY` con su semántica explícita.

> El **ledger del PASO 2** (`≠ 31` filas) es cosa distinta y es **bloqueante**: un destino que
> no es la baseline canónica no tiene nada válido que comparar. No es un WARN.

Sin `--source-db-url` ni `--source-signature-file` no hay paridad: las cuatro dimensiones
quedan en `BASELINE_ONLY_NO_SOURCE` y `SCORABLE=NO`.

## 10. Artefactos (`tools/local-db/.artifacts-recovery/<ts>/`)

| Archivo | Contenido |
|---|---|
| `00_RESULT.txt` | Bloque `KEY=VALUE` final. Se escribe en **todos** los caminos de salida |
| `01_bootstrap.err` | Diagnóstico de `bootstrap.mjs`, ya redactado |
| `02_migrations.log` | `supabase db reset` |
| `02b_site_config_baseline.log` | Validación exacta del seed destino; sólo marcador, sin valores |
| `04_dump.log` | `pg_dump` (sólo si se generó el dump) |
| `04c_toc.txt` / `04c_allowlist.txt` | TOC del dump y adjudicación de allowlist |
| `04c_main_restore_toc.txt` / `04c_site_config_policy.log` | Lista que separa únicamente `site_config` y diagnóstico por conteos |
| `04e_content_scan.txt` | Escaneo de contenido: **regla + línea + conteo**, nunca el texto |
| `04f_auth_seed.sql` / `.err` / `.log` | Seed sintético (sólo UUID y `@example.invalid`) |
| `04g_ownership.log`, `04g_disable_triggers.log` | Ownership y triggers |
| `04j_circular_fk.txt` | Definición literal de las 2 FK circulares (para recuperación manual) |
| `04h_restore.log`, `04h_site_config_extract.log`, `04h_site_config_policy.log` | Restore general + sustitución atómica; nunca valores |
| `04k_fk_integrity.txt` | Validación positiva de integridad |
| `08_dest_signature.txt`, `08_src_signature.txt`, `08_sections_*`, `08_diff_<SECCIÓN>.txt` | Firmas, secciones y diffs |
| `10_teardown.log`, `10_teardown_preserved.txt` | Teardown; el segundo sólo si el stop falló |

Ninguno se borra nunca. El directorio está en `tools/local-db/.gitignore`.

## 11. Códigos de parada

`abort "<FASE>"` fija `RESULT=FAIL` y `STOP_CODE=E_<FASE>`. Fases:
`PRECHECK_HOST`, `PRECHECK_REPO`, `PRECHECK_REMOTE_GUARD`, `PRECHECK_SCOPE_GUARD`,
`BOOTSTRAP`, `TOOLCHAIN_INCOMPATIBILITY`, `MIGRATIONS`, `DUMP`, `DUMP_GUARD`,
`SECRET_SCAN`, `AUTH_SEED`, `OWNERSHIP`,
`RESTORE`, `STORAGE_BLOBS`, `VALIDATION`, `LIFECYCLE`, `UNEXPECTED`.
Señales: `E_INTERRUPTED_INT` (exit 130), `E_INTERRUPTED_TERM` (exit 143).
`bootstrap.mjs` usa la taxonomía `STOP` de `guards.mjs` (`E_SCAFFOLD_FAILED`,
`E_SUPABASE_START_FAILED`, `E_REMOTE_TARGET_DETECTED`, `E_SCOPE_VIOLATION`) y sale con
`2` (argumentos), `3` (bootstrap) o `6` (teardown).

## 12. Qué permite `SCORABLE=YES`

**Todas** estas condiciones a la vez; si falta una, `SCORABLE=NO`:

`DOCKER_USED=YES` · `DOCKER_STOPPED=YES` · `INTERRUPTED=NO` ·
`SOURCE_SIGNATURE_RESULT=PASS|PASS_PERSISTED` · `RPO_SECONDS>=0` · `RTO_SECONDS>=0` ·
`BOOTSTRAP_RESULT=PASS` ·
`DUMP_ALLOWLIST_RESULT=PASS` · `DUMP_CONTENT_SCAN=PASS` · `AUTH_SEED_RESULT=PASS` ·
`OWNERSHIP_CHECK=PASS` · `SITE_CONFIG_BASELINE_VALIDATED=PASS` ·
`SITE_CONFIG_TRANSFERRED=YES` · `INTEGRITY_RESTORE_RESULT=PASS` · `FK_INTEGRITY=PASS` ·
`RESTORE_RESULT=PASS` · `STRUCTURE_PARITY=PASS` · `DATA_PARITY=PASS` ·
`RLS_RESTORE_RESULT=PASS` · `ACL_RESTORE_RESULT=PASS`.

En particular: un `--dry-run`, una corrida sin fuente live ni firma persistida, una
corrida interrumpida con Ctrl-C y una corrida con teardown fallido **no** son scorables.
`RESULT=PASS` es además imposible si alguna dimensión bloqueante quedó en `DIFF_FOUND`,
`SOURCE_SIGNATURE_FAILED` o `FAIL`, si `INTERRUPTED≠NO`, o si la integridad quedó suspendida.

## 13. RPO / RTO (propuestos; a ratificar por el owner)

| Métrica | Objetivo | Cómo se mide aquí |
|---|---|---|
| RPO | ≤ 24 h | `RPO_SECONDS` = dump completo − `SOURCE_CUTOFF_EPOCH` |
| RTO | ≤ 2 h (clon local) | `RTO_SECONDS` = validación final − inicio del bootstrap destino |

El RPO real lo domina el plano más lento de respaldar (típicamente los blobs de Storage).

## 14. Puntos abiertos

1. **Volumen de blobs:** sólo copia local best-effort (`--blobs-src <dir>`). Storage API / S3
   sync quedan fuera (requieren credenciales y objetivo real).
2. **Re-provisión de `auth.users` con identidades reales:** el seed de §7 es sintético a
   propósito. Restaurar usuarios reales implica PII y Admin API, y requiere decisión del owner.
3. **`harness.mjs` no se integra dentro de `run-recovery-v2.sh`:** tiene workdir y puerto
   propios del harness (`tools/local-db/.runtime`, 54329 — nunca los del clon de recovery) y
   no expone flags para apuntar a un clon ya levantado; integrarlo levantaría un **segundo**
   Supabase local, no una validación del clon de recuperación. `run-local-db-harness.sh` sigue siendo una corrida independiente y
   complementaria (matriz RLS negativa multirol + `tools/run-contract-tests.mjs`).
4. **Nada de esto está validado en vivo.** Los pasos 8.1 (recreación de FK circular), 7 (seed)
   y 8.4 (teardown) están implementados y cubiertos por pruebas con mocks, pero no ejecutados
   contra un Postgres real.

## 15. Qué NUNCA hace esta unidad

- No aplica SQL a staging/producción ni usa `supabase link`/`db push`/`db pull`.
- No toca ningún host que no clasifique como `LOCAL` (`classifyTarget`/`inspectEnvForRemote`).
- No imprime el contenido del dump, tokens, `bitacora.detalle` ni `edge_idempotency.response`.
  El escaneo de contenido reporta reglas y posiciones, jamás el texto.
- No hace `git add`/`commit`/`push` desde dentro del script.
- No detiene, borra ni inspecciona destructivamente stacks que no sean el propio.

## 16. Cómo correrlo (macOS)

```bash
# Prechecks sin tocar Docker (SCORABLE=NO por diseño):
tools/local-db/run-recovery-v2.sh --dry-run

# Corrida contra un dump ya generado (sin comparación de paridad ⇒ SCORABLE=NO):
tools/local-db/run-recovery-v2.sh --dump /ruta/a/app-data.dump

# Corrida completa comparando fuente vs destino (única vía a SCORABLE=YES).
# La URL se toma de: supabase status -o env --workdir <workdir origen>
tools/local-db/run-recovery-v2.sh --source-db-url "$SOURCE_LOCAL_DB_URL"

# Ruta canónica: fuente Supabase sintética y destino estrictamente secuenciales.
tools/local-db/run-recovery-v2-synthetic.sh

# Reanudar Recovery desde evidencia source ya persistida:
tools/local-db/run-recovery-v2.sh \
  --dump /ruta/a/app-data.dump \
  --source-signature-file /ruta/a/source-signature.txt \
  --source-cutoff-epoch 1785024000

# Dejar el clon arriba para inspección manual:
tools/local-db/run-recovery-v2.sh --dump /ruta/a/app-data.dump --keep-up

# Teardown manual (owner único; el mismo que usa el script):
node tools/local-db/lib/bootstrap.mjs --stop \
  --project-id tc_recovery_v2 \
  --runtime-dir tools/local-db/.runtime-recovery --remove-runtime
```

## 17. Verificación estática de esta unidad

```bash
bash -n tools/local-db/run-recovery-v2.sh
bash -n tools/local-db/run-recovery-v2-synthetic.sh
node --test test/local-db/recovery-host-pg-restore.test.mjs
node --check tools/local-db/lib/local-auth-users.mjs
node --test test/local-db/local-auth-users.test.mjs
node tools/staging-synthetic-seed-contract.test.mjs
node tools/recovery-v2-contract.test.mjs   # contratos semánticos
```

Los contratos son **semánticos**: fallan ante mutaciones de comportamiento (reintroducir
`head -1` ejecutable, omitir `project_id`, ignorar `DB_PORT`, seleccionar más de un
contenedor, separar `CID` y `DB_URL`, degradar el ledger o una paridad bloqueante a WARN,
`RESULT=PASS` con `DIFF_FOUND`, abortar sin teardown, Ctrl-C con `PASS`, borrar el runtime
antes de un stop exitoso, omitir el seed de `auth`, dejar un trigger sin reactivar, saltarse
la validación de ownership, aceptar un dump fuera de la allowlist, o desincronizar este
runbook del código).

---

CHECK: allowlist={public,app_private} adjudicada positivamente; `app_private` sin tablas;
never-restore completa; `auth.users`→`perfiles` resuelto con seed sintético; FK circular
resuelta con drop+recreación revalidante; teardown fail-closed y acotado al stack propio.

ROLLBACK: `git checkout --` de los archivos de esta unidad (ninguno toca
`supabase/migrations/`, `app/` ni workflows). El entorno local se revierte con
`node tools/local-db/lib/bootstrap.mjs --stop --project-id tc_recovery_v2 --runtime-dir tools/local-db/.runtime-recovery --remove-runtime`.

SIGUIENTE PASO LITERAL: `RUN_FROM_MACOS_TERMINAL` — ejecutar
`tools/local-db/run-recovery-v2-synthetic.sh` en una Terminal macOS con Docker Desktop
corriendo. El resultado sólo es terminal si `00_RESULT.txt` declara `RESULT=PASS`,
`SCORABLE=YES`, `DOCKER_STOPPED=YES` y no queda ningún contenedor `supabase_*`.
