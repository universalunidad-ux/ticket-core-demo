# Recovery V2 — Runbook operativo local

<!--
Materializado desde:
/Users/jaziel/Documents/EXPIRITI_REPOS/_ANALYSIS_OUTPUTS/TC_RECOVERY_V2_EXECUTABLE_HANDOFF_02/07_DOCKER_V2_HANDOFF.md

SOURCE_SHA256=eaa523e86e39446ca276e1bfe0618d579089068e1a771c393fa81801e9209656
REMOTE_ACTIVATION=DEFERRED_OUT_OF_SCOPE
SCORABLE=NO
-->

# 07 · Docker V2 — Handoff ejecutable (script entregado, NO ejecutado en esta unidad)

UNIDAD: TC-RECOVERY-V2-EXECUTABLE-HANDOFF-02
MODO: READ-ONLY repositorio · **SIN Docker ejecutado en esta unidad** · Estado del script:
**IMPLEMENTADO LOCAL** (creado en `_ANALYSIS_OUTPUTS/`, no en el repo, no ejecutado)

---

## 1. Qué es y qué no es este entregable

`08_run_recovery_v2.sh` es un script **completo y ejecutable** (pasa `bash -n`), diseñado
para correr fuera de esta unidad, tras autorización explícita del owner. Esta unidad:

- **Sí** escribió el script completo.
- **Sí** verificó su sintaxis (`bash -n`).
- **No** lo ejecutó contra Docker/Supabase (prohibido explícitamente en las instrucciones
  de esta unidad).
- **No** lo integró al repositorio (vive en `_ANALYSIS_OUTPUTS/`, fuera del árbol
  versionado que consumiría `tools/local-db/`).
- **No** hace commit/add/push/deploy de nada.

## 2. Anti-duplicación — qué reutiliza, qué no reimplementa

| Componente reutilizado | Fuente | Por qué no se duplica |
|---|---|---|
| Guardas de host/target local (`classifyTarget`, `isLocalHost`, `inspectEnvForRemote`, `checkMacOS`, `checkNodeMajor`) | `tools/local-db/lib/guards.mjs` | Es la fuente de verdad existente para "qué es LOCAL"; reimplementarla en bash sería un segundo criterio que puede divergir del harness — el script invoca `node -e 'import("...guards.mjs")...'` |
| Parseo de `supabase status -o env`, orden de migraciones | `tools/local-db/lib/parse.mjs` | Mismo motivo: una sola fuente de verdad para parsear salida del CLI |
| Validación RLS/ACL/policies/contratos | `tools/local-db/harness.mjs` (invocado vía `node ... --keep-up` apuntando a `db_dst`) | Ya existe, ya está probado; V2 solo le pasa el runtime destino |
| Escaneo de secretos | `tools/secret-gate.sh` (+ `secret-gate-scanner.py`, `secret-gate-patterns.txt`) | Ya existe; V2 solo aísla la rendición de texto del dump en un directorio temporal antes de invocarlo (ver `02_DATA_DUMP_ALLOWLIST.txt §G` — incluye el gotcha del scanner con archivos binarios, verificado leyendo el código fuente) |
| Fixtures sintéticos | `supabase/tests/staging_synthetic_seed.sql` | Dataset ya construido y usado por la auditoría de resiliencia; no se genera un segundo seed |
| Estructura canónica | `supabase/migrations/*.sql` (31 archivos) | Fuente de verdad única de DDL; el script nunca reconstruye estructura desde el dump |

**Regla anti-tercer-override aplicada:** si `08_run_recovery_v2.sh` se integrara al repo,
sería un módulo nuevo (`tools/local-db/restore-v2.sh`, opcionalmente con un
`restore-v2.mjs` de soporte) que **importa** los módulos de arriba — no una copia del
harness, no una reimplementación paralela de guardas. Esto responde directamente al
riesgo "tercer override" que la propia auditoría de resiliencia señaló como patrón a
evitar en el repo (dos superficies de consolidación, tres mecanismos de idempotencia —
`TC_U15C_U15D_RESILIENCE_OPUS_AUDIT_01/00_EXECUTIVE_RESULT.md` hallazgo #3).

## 3. Diferencias acumuladas: V1 (falló) → V2-propuesto (Boundary/07) → V2-ejecutable (esta unidad)

| Aspecto | V1 (falló) | V2-propuesto (Boundary) | V2-ejecutable (esta unidad) |
|---|---|---|---|
| Alcance del dump | esquema completo (incl. `realtime`) | allowlist {public, app_private}, solo datos | igual, + inventario en vivo de `app_private` (no asumido) |
| `--disable-triggers` | usado implícitamente (dump de esquema completo) | listado con advertencia contradictoria (03/B vs 03/D) | **eliminado explícitamente**; solo `DISABLE/ENABLE TRIGGER USER` |
| `auth.users` antes de datos | no considerado | "placeholder operativo, punto abierto" | resuelto: Admin API local de GoTrue del runtime efímero destino |
| Comparación origen/destino | ninguna | no especificada | firmas SIG-01..04 (hash de estructura, funciones y datos) |
| Secretos en el dump | no evaluado | no especificado | escaneo obligatorio con gotcha de binario resuelto |
| Medición de tiempos | no | mencionada en runbook aparte | integrada al script (9 marcas, ver `06`) |
| Teardown ante fallo | manual | manual | `trap` automático en cualquier salida no-cero |
| Ejecutable de punta a punta | no (falló) | no (esqueleto anotado, ~40 líneas) | sí (script completo, `bash -n` verificado) |
| Autorización para tocar Docker | n/a (ya había fallado) | requerida, no forzada en el script | requerida y **forzada por guarda explícita** (`--yes-run-docker`; sin ese flag el script solo imprime el plan y sale 0) |

## 4. Contrato de uso (cuando se autorice)

```
Uso:
  08_run_recovery_v2.sh --repo-root <path-al-worktree> [--yes-run-docker]
                         [--db-port-src N] [--db-port-dst N]
                         [--keep-artifacts] [--no-pbcopy] [--dry-run]

Sin --yes-run-docker: modo PLAN (default). Imprime las 19 fases, valida
precondiciones de host/repo/herramientas que NO requieren Docker corriendo,
y sale 0 con RESULT=PLANNED, DOCKER_USED=NO, SCORABLE=NO.

Con --yes-run-docker: ejecuta las 19 fases de 03_DATA_RESTORE_ORDER.md contra
runtimes LOCALES efímeros. Aborta (exit!=0) ante cualquier guarda fallida.
Nunca ejecuta contra un target remoto (guarda GD-02, reutiliza guards.mjs).
Reporta RESULT=REHEARSAL_COMPLETE o RESULT=ABORTED — nunca RESULT=PASS.
Reporta SCORABLE=NO siempre (ninguna corrida de este script certifica
producción; ver 06_RPO_RTO_METHOD.md §5).
```

## 5. Puntos abiertos para el implementador/operador (heredados + nuevos)

1. **Volumen de blobs reales** (heredado de Boundary/07 §5, sin resolver — depende de
   decidir Storage API vs S3 sync con datos de origen reales, no sintéticos; ver
   `05_STORAGE_BLOB_BOUNDARY.md §3`).
2. **Retención de `ticket_portal_logs`** (heredado de Boundary/07 §5 — confirmar con el
   owner si es auditoría regulatoria antes de excluirla permanentemente del backup).
3. **Ratificación de objetivos RPO≤24h/RTO≤2h** (heredado de Boundary/08 — son objetivos
   de negocio, no se validan con datos sintéticos locales).
4. **Nuevo — integración al repo:** decidir si `08_run_recovery_v2.sh` se mueve a
   `tools/local-db/restore-v2.sh` tal cual, o si se porta a `.mjs` para reusar más
   directamente `guards.mjs`/`parse.mjs` sin el paso intermedio `node -e`. Ambas son
   viables; la decisión de estilo (bash vs Node) le corresponde al owner del repo, no a
   esta unidad de análisis.

---

CHECK: script completo entregado; anti-duplicación verificada línea por línea contra los
módulos existentes; sin `RESULT=PASS` en ningún punto del contrato de salida.
CHECKPOINT: 7 entregables previos (`00`-`06`) + este (`07`) + el script (`08`) = 8/8.
DIFF: tabla §3 (tres generaciones del fix).
ROLLBACK: nada ejecutado; nada que revertir. Si se llegara a copiar el script al repo sin
autorización, revertir con `git checkout -- tools/local-db/restore-v2.sh` o `rm` (no
aplica aquí porque no se tocó el repo).
HANDOFF: entregar `00`-`08` completos al operador autorizado para Docker.
SIGUIENTE PASO LITERAL: el owner ejecuta primero
`bash _ANALYSIS_OUTPUTS/TC_RECOVERY_V2_EXECUTABLE_HANDOFF_02/08_run_recovery_v2.sh
--repo-root <worktree> --dry-run` (sin `--yes-run-docker`, Docker puede estar apagado) y
revisa el plan impreso antes de considerar una corrida real.
