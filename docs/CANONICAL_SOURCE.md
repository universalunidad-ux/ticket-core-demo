# Fuente canónica y gate anti-drift

Este repositorio contiene **Ticket Core Demo**. No debe tomar código productivo de Ticket Core privado, checkpoints, análisis, entregables, backups, archivos temporales, ZIP ni worktrees cerradas.

El contrato legible por máquina está en `tools/canonical-source.json`; su único owner ejecutable es `tools/canonical-source-gate.mjs`.

## Ejecución

Desde el worktree aprobado y con el árbol limpio:

```sh
node tools/preflight.mjs
```

**Ejecuta el preflight canónico antes de editar y detente si no devuelve PASS.**

Comandos sin npm ni dependencias nuevas:

```sh
# FAST PRE-EDIT: identidad, estado y fuente canónica; exige árbol limpio.
node tools/preflight.mjs

# TEST: pruebas G0 y pruebas de automatización.
node tools/preflight.mjs --mode test

# FULL: gate, pruebas y gates especializados pertinentes.
node tools/preflight.mjs --mode full
```

El gate owner sigue disponible como `node tools/canonical-source-gate.mjs --root "$PWD"`; el preflight lo orquesta y no duplica su contrato.

El gate termina con error ante diferencias de repo, remote, política de branch, base Git o common Git dir; worktrees no registradas; operaciones Git incompletas; `index.lock`; fuentes activas ausentes o no canónicas; owners activos duplicados o no versionados; Edge activas sin owner local o externalización explícita; entrypoints Edge tracked sin clasificación; migraciones locales con identificador duplicado; y referencias al producto privado.

La política de HEAD admite únicamente commits descendientes de `fd1336985bd9446c5d28e7d8c6296a2d375ce90b`. La rama de implementación fue `review/backend-security-v2-20260718`; la política futura permite branches `review/` que desciendan de esa base. El checkout CI está permitido de forma explícita, pero conserva las comprobaciones de remote, branch, base y owners.

La ruta `backend-security-v2-review` es contexto aprobado para crear G0, no una ruta eterna. Un worktree futuro pasa únicamente si está registrado en el mismo common Git dir canónico y satisface remote, branch y ancestry. Un clone ajeno o un worktree de otro producto falla.

Los prefijos de implementación permitidos viven únicamente en el manifiesto: `review/`, `fix/`, `feat/`, `chore/`, `sec/`, `docs/` y `test/`. Trabajar directamente sobre `main` sigue prohibido; CI puede validar un push a `main` sin convertirlo en rama local de implementación.

## Bootstrap G0

`--allow-bootstrap` existe solo para validar el primer commit G0. Funciona únicamente sobre el HEAD base exacto, con los cuatro archivos G0 declarados, staged y sin cambios unstaged. Después del commit se ejecuta el gate sin esa opción y se exige un worktree limpio.

## Owners Edge locales, runtime y externalizados

El manifiesto distingue cuatro categorías mutuamente excluyentes:

- `required_edge_owners` (`REQUIRED_LOCAL`): source local tracked con caller estático en el runtime frontend activo.
- `required_local_runtime_owners` (`REQUIRED_LOCAL_RUNTIME`): entrypoint local tracked que debe existir en runtime, pero que no tiene caller estático activo.
- `externalized_owners` (`EXTERNALIZED_EXPLICIT`): dependencia con caller activo cuyo source no pertenece al checkout.
- `historical_not_active_owners` (`HISTORICAL_NOT_ACTIVE`): función histórica sin caller activo ni entrypoint canónico tracked.

La categoría runtime admite dos estados. `REMOTE_ACTIVE` exige `remote_version`, `verify_jwt` y un `source-current.json` tracked con evidencia read-only concordante: slug, estado `ACTIVE`, versión, política JWT, SHA-256, procedencia no vacía y `deployed_by_this_unit=false`. `LOCAL_ONLY_NOT_DEPLOYED` prohíbe esos campos remotos y exige que el source tracked contenga exactamente el marker `PREPARED_NOT_APPLIED`. En ambos estados el gate valida schema cerrado, path dinámico `supabase/functions/<name>/index.(ts|js|mjs)`, archivo regular no vacío y SHA-256 byte-for-byte.

El gate inventaría desde el índice Git todos los paths `supabase/functions/<slug>/index.ts`, `.js` y `.mjs`. La relación es bidireccional: cada entrypoint tracked debe corresponder exactamente a un record local, en `required_edge_owners` o `required_local_runtime_owners`, y cada record local debe resolver a su entrypoint tracked. Dos extensiones para un mismo slug, un entrypoint huérfano, un source local para una categoría externalizada/histórica, un path local duplicado o una colisión entre categorías hacen fallar el gate.

Owner runtime no significa owner con caller estático. Si aparece un caller activo para un `REQUIRED_LOCAL_RUNTIME`, la transición debe ser atómica: retirar el record runtime y registrar el owner como `REQUIRED_LOCAL` con su caller en el mismo cambio. Mientras no exista ese caller, el registro runtime preserva la propiedad local sin inventar reachability frontend.

Tracked no equivale a deployed. El índice Git sólo prueba presencia y clasificación local; el estado remoto requiere la evidencia explícita de `REMOTE_ACTIVE`, y aun esa snapshot no prueba vigencia remota en tiempo real ni autoriza deploy.

`support-orphan-cleanup` es el único record actual de `required_local_runtime_owners`. Está clasificado `REQUIRED_LOCAL_RUNTIME` con estado `LOCAL_ONLY_NOT_DEPLOYED`, source `supabase/functions/support-orphan-cleanup/index.ts`, SHA-256 `528633ffc557e1fdc636a7dfcd05e8901b21058bdf38cbb25397a4bf2045a5ad` y marker `PREPARED_NOT_APPLIED`. Su registro no modifica el source ni lo despliega.

`crear-cliente-janome` y `crear-ticket-interno` continúan como dependencias activas sin owner versionado en este worktree. El manifiesto las clasifica `EXTERNALIZED_EXPLICIT` con razón. Esta declaración no autoriza despliegues, cambios remotos ni uso de código del producto privado.

`ticket-escalar-admin` está clasificada `REQUIRED_LOCAL`. Su owner canónico es `supabase/functions/ticket-escalar-admin/index.ts`, con caller activo `app/ticket-composer-polish.js`; `source-current.json` conserva la procedencia de la versión remota 5 con `verify_jwt=true`. La adopción preserva los bytes recuperados y no implica deploy, hardening ni cambios remotos.

`estado-ticket-ts` y `estado-ticket-responder-ts` están clasificadas `REQUIRED_LOCAL`. Sus owners canónicos son `supabase/functions/estado-ticket-ts/index.ts` y `supabase/functions/estado-ticket-responder-ts/index.ts`, con caller activo `app/estado.js`; sus archivos `source-current.json` conservan la procedencia de las versiones remotas 37 y 39. La adopción preserva los bytes recuperados y no implica deploy, hardening, cambios remotos ni reconstrucción desde el producto privado.

`support-submit-secure` está clasificada `REQUIRED_LOCAL`, tiene owner en `supabase/functions/support-submit-secure/` y el gate exige conservarlo mientras exista la llamada activa. G0 no usa inventarios históricos: solo clasifica nombres descubiertos en código activo.

## Entry points y recursos externos

Los trece entrypoints del manifiesto corresponden al redirect raíz, login, dashboard, tickets, clientes, soporte/estado y documentos legales actualmente enlazados. Cada registro incluye superficie y razón; fixtures, backups y salidas de análisis quedan fuera.

La allowlist externa no se duplica. G0 deriva `allowedExternalAssets` de `tools/final-fix-gates.mjs`, owner existente que permite el script HTTPS de Cloudflare Turnstile. El gate falla si ese owner desaparece o si una superficie activa introduce otro asset externo.

Las comprobaciones especializadas de secretos, PII, XSS, storage, Turnstile y contratos conservan sus gates propios. G0 solo verifica que esos owners sigan versionados; no reimplementa su lógica.

## Continuidad

Antes de cada unidad futura:

1. ejecutar el gate con el árbol limpio;
2. detenerse ante cualquier fallo, sin limpiar automáticamente;
3. modificar solo archivos autorizados para esa unidad;
4. repetir este gate y los gates específicos del cambio;
5. no usar `_CHECKPOINTS`, `_ANALYSIS_OUTPUTS`, `_DELIVERABLES`, backups o worktrees como fuente productiva.

## Hook local y CI

El hook versionado `.githooks/pre-commit` llama `node tools/preflight.mjs --mode pre-commit`. Ese modo materializa el índice staged en un directorio temporal, valida exactamente el candidato y no usa `stash`, `reset`, `checkout` del worktree ni `clean`.

Instalación local segura, solo si no existe un owner previo:

```sh
node tools/install-git-hooks.mjs
```

El instalador configura `core.hooksPath=.githooks` y se detiene ante cualquier ruta o hook ajeno. La ruta relativa funciona desde worktrees registrados del mismo repo.

El workflow existente `.github/workflows/frontend-gates.yml` ejecuta el modo CI en PR/push con historial completo. Detached HEAD solo se admite en GitHub Actions con evento, repositorio, ref, remote y ancestry válidos; `CI=true` no desactiva otros controles.

## Evidencia reservada para unidades futuras

FIX-U1 no se implementó: `app/estado.html` carece de `#stNextStepBox` y `#stNextStep`; tres rutas de error en `app/estado.js` escriben esos IDs con optional chaining. Los owners `.estado-status-pill.warn` y `.estado-next` ya existen, y `setHero()` puede restaurar la clase normal tras éxito. La unidad futura deberá reutilizarlos, centralizar las tres rutas y demostrar limpieza de `warn`, sin CSS duplicado.

FIX-U4 tampoco se implementó: existen `header`, `main`, `#stChatPop`, `#stViewer` y listeners Escape, pero falta demostrar la jerarquía exacta y los cuatro estados de overlays antes de aplicar `inert`.
