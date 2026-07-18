# Fuente canónica y gate anti-drift

Este repositorio contiene **Ticket Core Demo**. No debe tomar código productivo de Ticket Core privado, checkpoints, análisis, entregables, backups, archivos temporales, ZIP ni worktrees cerradas.

El contrato legible por máquina está en `tools/canonical-source.json`; su único owner ejecutable es `tools/canonical-source-gate.mjs`.

## Ejecución

Desde el worktree aprobado y con el árbol limpio:

```sh
node tools/canonical-source-gate.mjs --root "$PWD"
node tools/canonical-source-gate.test.mjs
```

El gate termina con error ante diferencias de repo, remote, política de branch, base Git o common Git dir; worktrees no registradas; operaciones Git incompletas; `index.lock`; fuentes activas ausentes o no canónicas; owners activos duplicados o no versionados; Edge activas sin owner local o externalización explícita; migraciones locales con identificador duplicado; y referencias al producto privado.

La política de HEAD admite únicamente commits descendientes de `fd1336985bd9446c5d28e7d8c6296a2d375ce90b`. La rama de implementación fue `review/backend-security-v2-20260718`; la política futura permite branches `review/` que desciendan de esa base. El checkout CI está permitido de forma explícita, pero conserva las comprobaciones de remote, branch, base y owners.

La ruta `backend-security-v2-review` es contexto aprobado para crear G0, no una ruta eterna. Un worktree futuro pasa únicamente si está registrado en el mismo common Git dir canónico y satisface remote, branch y ancestry. Un clone ajeno o un worktree de otro producto falla.

## Bootstrap G0

`--allow-bootstrap` existe solo para validar el primer commit G0. Funciona únicamente sobre el HEAD base exacto, con los cuatro archivos G0 declarados, staged y sin cambios unstaged. Después del commit se ejecuta el gate sin esa opción y se exige un worktree limpio.

## Owners Edge externalizados

`crear-cliente-janome`, `ticket-escalar-admin`, `crear-ticket-interno`, `estado-ticket-ts` y `estado-ticket-responder-ts` son dependencias activas que no tienen owner versionado en este worktree. El manifiesto las clasifica `EXTERNALIZED_EXPLICIT` con razón. En particular, las dos Edge de estado no se restauran ni se reconstruyen durante G0. Esta declaración no autoriza despliegues, cambios remotos ni uso de código del producto privado.

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
