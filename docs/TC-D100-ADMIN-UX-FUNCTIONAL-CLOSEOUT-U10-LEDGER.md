# TC-D100 — Admin UX Functional Closeout U10

Fecha local: 2026-07-18
Worktree: `_WORKTREES/ticket-core-demo/backend-security-v2-review`
Base verificada: `8f111114104692e9dcedbad0f3fd91a864ad349e`
Rama: `review/backend-security-v2-20260718`

## Estado ejecutivo

`LEVEL_100_LOCAL_STATUS=CONDITIONAL`

El contrato frontend y sus fixtures permanentes quedan implementados y las compuertas estáticas pasan. La validación runtime autenticada de los roles y la publicación remota de personalización no se declaran completas: requieren una sesión manual real y, para personalización, un contrato backend draft/published/versionado que no existe en esta fuente canónica.

## Decisiones y propietarios

| Superficie | Propietario canónico | Estado local | Evidencia |
| --- | --- | --- | --- |
| Contexto del header | `app/global.js` | Completo | mapa estable, ticket dinámico, elipsis de una línea |
| Selects nativos | `app/global.css` | Completo | un solo chevron/focus owner, sin dropdown paralelo |
| Rail KPI y actividad | `app/dashboard.js`, `app/dashboard.css` | Completo | conteo exacto, dots/click/flechas/swipe sincronizados |
| Métricas de agentes | `app/dashboard.js` | Completo según contrato de campos | nueve métricas, misma colección para conteo y detalle, modal compartido, páginas de 10 |
| Navegación admin | `app/dashboard.js` | Completo | paneles `hidden`/`inert`, foco de tab, contexto y confirmación de dirty state |
| Personalización | `app/dashboard.js` | Solo vista previa local | sin falso éxito; guardar/publicar bloqueados de forma explícita |
| Reglas | `app/dashboard.js` | `CONFIG_ONLY` | CRUD permitido por contrato confirmado, solapes y preview sin mutar tickets |
| Bitácora | `app/bitacora-admin.*` + query owner en `dashboard.js` | Extraída | guard admin antes de query, filtros server-side, count exacto, metadata reducida |
| Clientes y alta | `app/clientes.*`, `app/alta-cliente.*` | Completo en frontend | conteo real, códigos canónicos, RFC/WhatsApp/preferencia en payload capability-gated |

## Bloqueos reales

1. La ruta real de Dashboard redirige a `app/index.html?next=dashboard.html`; no se solicitaron credenciales, JWT, cookies ni service role. Falta repetir la matriz ANON/AUTH_SIN_PERFIL/VENTAS/SOPORTE/ADMIN con sesiones reales autorizadas.
2. El navegador local permitió inspeccionar el fixture a 320 px y luego bloqueó la matriz repetida en `127.0.0.1` por política. No se eludió el control. Responsive multi-viewport, dark completo y zoom 200% quedan pendientes de evidencia visual manual.
3. Personalización no tiene backend atómico para draft/publish/version/conflict/audit. `PUBLIC_COPY_WORKFLOW_MIGRATION_DRAFT.sql` es solo un borrador de diseño y no fue aplicado.
4. La ejecución automática de reglas no está conectada; el estado visible y contractual permanece `CONFIG_ONLY`.

## Riesgos abiertos

- `OPEN_P0=0`
- `OPEN_P1=2`: QA de roles autenticados; contrato remoto de publicación de textos.
- `OPEN_P2=1`: completar matriz visual manual multi-viewport/dark/zoom.

## Pruebas permanentes

- `tools/admin-ux-u10.test.mjs`: 13 contratos U10 y duplicate IDs.
- `.github/workflows/frontend-gates.yml`: ejecuta el gate U10 en CI.
- `tools/admin-u10-visual-fixture.html`: fixture sintético sin datos reales para QA visual.
- `tools/status-error-state.test.mjs`: arnés corregido para cargar el helper del runtime que prueba.

## Gobierno y alcance

- No se realizó push, merge, deploy, cambio remoto de Supabase, migración ni despliegue Edge.
- El SQL nuevo está marcado `DRAFT / DO NOT APPLY`.
- No se tocaron otros proyectos.
- El checkpoint externo previo a mutar es `/private/tmp/TC-D100-ADMIN-UX-FUNCTIONAL-CLOSEOUT-U10-8f11111.bundle`.

## Próxima decisión

No decidir push todavía. Primero: iniciar sesión manualmente con cuentas admin y soporte, repetir QA de roles y matriz visual; luego revisar/aprobar por separado el contrato backend de personalización.
