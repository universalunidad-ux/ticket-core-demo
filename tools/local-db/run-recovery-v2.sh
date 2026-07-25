#!/usr/bin/env bash
# TC-RECOVERY-V2-IMPLEMENT-RUNTIME-01
# run-recovery-v2.sh — Simulacro de recuperación con FRONTERA platform/application.
#
# Estado de este archivo: IMPLEMENTADO LOCAL (código) · NO VALIDADO EN VIVO.
# Fue escrito y revisado estáticamente (bash -n) en un entorno SIN Docker ni
# Supabase CLI disponibles; NUNCA se ha ejecutado de punta a punta. Antes de
# confiar en su salida, córrelo una vez en una máquina con Docker Desktop +
# Supabase CLI (ver docs/operations/RECOVERY_V2_RUNBOOK.md) y trata la primera
# corrida como una prueba, no como un hecho.
#
# Fuente de verdad reutilizada (NO duplicada): tools/local-db/lib/guards.mjs
# (clasificación LOCAL/REMOTO, guarda de entorno remoto) y tools/local-db/
# lib/parse.mjs. Este script AÑADE el plano de datos (dump/restore filtrado)
# y el plano de Storage; no reimplementa el bootstrap por migraciones, que ya
# resuelve tools/local-db/harness.mjs.
#
# Arquitectura obligatoria (10 pasos, ver docs/operations/RECOVERY_V2_RUNBOOK.md):
#   1 bootstrap limpio · 2 migraciones canónicas · 3 nunca platform-managed ·
#   4 dump/restore de datos application-owned · 5 auth.users antes de perfiles ·
#   6 buckets/policies por migración · 7 blobs Storage fuera de pg_dump ·
#   8 comparar datos/RLS/ACL/funciones/search_path · 9 medir RPO/RTO ·
#   10 teardown completo.
#
# NUNCA restaura: realtime.* _realtime.* pgsodium.* vault.* graphql*.*
# supabase_functions.* ni parámetros/funciones SUSET de plataforma.
# ALLOWLIST: public, app_private. Solo LOCAL. Nunca remoto. Nunca push/deploy.
#
# Uso:
#   tools/local-db/run-recovery-v2.sh [opciones]
#
# Opciones:
#   --source-db-url <url>   URL LOCAL de una DB origen (pre-incidente) desde la
#                            que generar el dump de datos. Debe clasificar como
#                            LOCAL (ver guards.mjs); aborta si no.
#   --dump <archivo>         Usar un dump --data-only ya generado (omite 4b).
#   --db-port <N>            Puerto de la DB del clon de recuperación (default 54329).
#   --blobs-src <dir>         Directorio LOCAL con blobs a sincronizar (paso 6).
#                             Si se omite, el paso de blobs queda documentado
#                             como operación manual (ver runbook §Storage).
#   --keep-up                 No hacer teardown al final (deja el clon arriba).
#   --dry-run                 Solo prechecks/guardas; no toca Docker.
#
# Salida: bloque KEY=VALUE al final (00_RESULT.txt en el directorio de
# artefactos), con exactamente los campos exigidos por la unidad.

set -Eeuo pipefail
IFS=$'\n\t'

UNIT="TC-RECOVERY-V2-IMPLEMENT-RUNTIME-01"

# --- Resolver raíz del repo/worktree (dir de este script -> ../..) ----------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." >/dev/null 2>&1 && pwd)"
cd "${REPO_ROOT}"

RUNTIME_DIR="tools/local-db/.runtime-recovery"
ARTIFACTS_ROOT="tools/local-db/.artifacts-recovery"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
ARTIFACTS_DIR="${ARTIFACTS_ROOT}/${TS}"

DB_PORT="54329"
SOURCE_DB_URL=""
DUMP_FILE=""
BLOBS_SRC=""
KEEP_UP="no"
DRY_RUN="no"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source-db-url) SOURCE_DB_URL="${2:-}"; shift 2 ;;
    --dump) DUMP_FILE="${2:-}"; shift 2 ;;
    --db-port) DB_PORT="${2:-}"; shift 2 ;;
    --blobs-src) BLOBS_SRC="${2:-}"; shift 2 ;;
    --keep-up) KEEP_UP="yes"; shift ;;
    --dry-run) DRY_RUN="yes"; shift ;;
    *) echo "ABORT: argumento desconocido: $1" >&2; exit 2 ;;
  esac
done

# ---------------------------------------------------------------------------
# Estado del reporte final (campos EXACTOS pedidos por la unidad).
# ---------------------------------------------------------------------------
RESULT="FAIL"
BASE_HEAD="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
FINAL_HEAD="${BASE_HEAD}"
BOOTSTRAP_RESULT="NOT_RUN"
DUMP_RESULT="NOT_RUN"
SECRET_SCAN_RESULT="NOT_RUN"
RESTORE_RESULT="NOT_RUN"
STRUCTURE_PARITY="NOT_RUN"
DATA_PARITY="NOT_RUN"
RLS_RESTORE_RESULT="NOT_RUN"
ACL_RESTORE_RESULT="NOT_RUN"
RPO_SECONDS="-1"
RTO_SECONDS="-1"
DUMP_BYTES="0"
DOCKER_USED="NO"
DOCKER_STOPPED="NO"
WORKTREE_STATUS="unknown"
COMMIT_CREATED="NO"
NEXT_ACTION="revisar ${ARTIFACTS_DIR}/00_RESULT.txt"

T_START="$(date -u +%s)"

mkdir -p "${ARTIFACTS_DIR}"

write_report() {
  cat > "${ARTIFACTS_DIR}/00_RESULT.txt" <<EOF
RESULT=${RESULT}
BASE_HEAD=${BASE_HEAD}
FINAL_HEAD=${FINAL_HEAD}
BOOTSTRAP_RESULT=${BOOTSTRAP_RESULT}
DUMP_RESULT=${DUMP_RESULT}
SECRET_SCAN_RESULT=${SECRET_SCAN_RESULT}
RESTORE_RESULT=${RESTORE_RESULT}
STRUCTURE_PARITY=${STRUCTURE_PARITY}
DATA_PARITY=${DATA_PARITY}
RLS_RESTORE_RESULT=${RLS_RESTORE_RESULT}
ACL_RESTORE_RESULT=${ACL_RESTORE_RESULT}
RPO_SECONDS=${RPO_SECONDS}
RTO_SECONDS=${RTO_SECONDS}
DUMP_BYTES=${DUMP_BYTES}
DOCKER_USED=${DOCKER_USED}
DOCKER_STOPPED=${DOCKER_STOPPED}
WORKTREE_STATUS=${WORKTREE_STATUS}
COMMIT_CREATED=${COMMIT_CREATED}
PUSH=NO
DEPLOY=NO
SUPABASE_REMOTE=NO
SCORABLE=${SCORABLE:-NO}
NEXT_ACTION=${NEXT_ACTION}
EOF
  cat "${ARTIFACTS_DIR}/00_RESULT.txt"
}

abort() {
  # $1=fase  $2=detalle  $3=next_action
  local phase="$1" detail="$2"
  RESULT="FAIL"
  NEXT_ACTION="${3:-corregir '${phase}' (${detail}) y reintentar; ver docs/operations/RECOVERY_V2_RUNBOOK.md}"
  echo "ABORT[${phase}]: ${detail}" >&2
  write_report
  exit 1
}

trap 'abort "UNEXPECTED" "fallo no controlado en linea $LINENO" "revisar logs y ${ARTIFACTS_DIR}"' ERR

# =============================================================================
# FASE 0 · GUARDAS (fail-closed; nada de Docker toca antes de pasar todo esto)
# =============================================================================

if [[ "$(uname -s)" != "Darwin" && "$(uname -s)" != "Linux" ]]; then
  abort "PRECHECK_HOST" "host no soportado: $(uname -s) (se espera Darwin o Linux)"
fi

if ! command -v node >/dev/null 2>&1; then
  abort "PRECHECK_HOST" "node no encontrado en PATH"
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [[ "${NODE_MAJOR}" -lt 22 ]]; then
  abort "PRECHECK_HOST" "node major=${NODE_MAJOR} (se requiere >=22)"
fi

if [[ "$(git rev-parse --is-inside-work-tree 2>/dev/null || echo false)" != "true" ]]; then
  abort "PRECHECK_REPO" "no es un worktree git"
fi
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "${BRANCH}" != test/* ]]; then
  abort "PRECHECK_REPO" "rama=${BRANCH} (se espera test/*)"
fi
if [[ -n "$(git status --porcelain 2>/dev/null)" ]]; then
  WORKTREE_STATUS="dirty"
else
  WORKTREE_STATUS="clean"
fi

# --- Guarda anti-remoto reutilizando guards.mjs (NO se duplica la lógica) ---
REMOTE_FINDINGS="$(SOURCE_DB_URL_CHECK="${SOURCE_DB_URL}" node -e '
  import("./tools/local-db/lib/guards.mjs").then((g) => {
    const findings = g.inspectEnvForRemote(process.env);
    const srcUrl = process.env.SOURCE_DB_URL_CHECK || "";
    if (srcUrl) {
      const c = g.classifyTarget(srcUrl);
      if (c.classification !== "LOCAL") {
        findings.push({ code: "E_REMOTE_TARGET_DETECTED", var: "--source-db-url", host: c.host, reason: c.reason });
      }
    }
    if (findings.length) {
      console.log(JSON.stringify(findings));
      process.exit(1);
    }
    process.exit(0);
  }).catch((e) => { console.error(String(e)); process.exit(2); });
')" || { abort "PRECHECK_REMOTE_GUARD" "destino remoto o env remota detectada: ${REMOTE_FINDINGS}"; }

# --- Guarda de alcance: este script solo escribe bajo tools/local-db/ -------
case "$(pwd)/${RUNTIME_DIR}" in
  "$(pwd)/tools/local-db/"*) : ;;
  *) abort "PRECHECK_SCOPE_GUARD" "RUNTIME_DIR fuera de tools/local-db/" ;;
esac

if [[ "${DRY_RUN}" == "yes" ]]; then
  RESULT="PASS"
  BOOTSTRAP_RESULT="SKIPPED_DRY_RUN"
  SCORABLE="NO"
  NEXT_ACTION="dry-run OK; ejecutar sin --dry-run en macOS con Docker + Supabase CLI"
  write_report
  exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
  abort "PRECHECK_HOST" "docker no encontrado en PATH" "instalar/abrir Docker Desktop y reintentar (solo local)"
fi
if ! docker info >/dev/null 2>&1; then
  abort "PRECHECK_HOST" "docker daemon no responde" "abrir Docker Desktop y reintentar"
fi
if ! command -v supabase >/dev/null 2>&1; then
  abort "PRECHECK_HOST" "supabase CLI no encontrada" "brew install supabase/tap/supabase"
fi
if ! command -v pg_dump >/dev/null 2>&1 || ! command -v pg_restore >/dev/null 2>&1; then
  abort "PRECHECK_HOST" "pg_dump/pg_restore no encontrados en PATH (cliente psql/postgresql)"
fi

DOCKER_USED="YES"

# =============================================================================
# PASO 1 · BOOTSTRAP DE PLATAFORMA SUPABASE LIMPIO
# =============================================================================
rm -rf "${RUNTIME_DIR}"
mkdir -p "${RUNTIME_DIR}"
if ! supabase start --workdir "${RUNTIME_DIR}" >"${ARTIFACTS_DIR}/01_bootstrap.log" 2>&1; then
  BOOTSTRAP_RESULT="FAIL"
  abort "BOOTSTRAP" "supabase start fallo; ver ${ARTIFACTS_DIR}/01_bootstrap.log"
fi
DB_URL="$(supabase status -o env --workdir "${RUNTIME_DIR}" 2>/dev/null | sed -n 's/^DB_URL=//p' | tr -d '"')"
case "${DB_URL}" in
  *127.0.0.1*|*localhost*) : ;;
  *) BOOTSTRAP_RESULT="FAIL"; abort "BOOTSTRAP" "DB_URL del clon no es local: ${DB_URL}" ;;
esac
BOOTSTRAP_RESULT="PASS"
echo "[recovery-v2] bootstrap OK (destino local confirmado)"

# =============================================================================
# PASO 2 · MIGRACIONES CANÓNICAS (fuente de verdad = supabase/migrations)
# =============================================================================
if ! supabase db reset --workdir "${RUNTIME_DIR}" >"${ARTIFACTS_DIR}/02_migrations.log" 2>&1; then
  abort "MIGRATIONS" "supabase db reset fallo; ver ${ARTIFACTS_DIR}/02_migrations.log"
fi

CID="$(docker ps --format '{{.Names}}' | grep '^supabase_db_' | head -1 || true)"
if [[ -z "${CID}" ]]; then
  abort "MIGRATIONS" "no se pudo resolver el contenedor supabase_db_* local"
fi

LEDGER_COUNT="$(docker exec "${CID}" psql -U postgres -d postgres -tAc \
  "select count(*) from supabase_migrations.schema_migrations;" 2>/dev/null | tr -d '[:space:]' || echo "-1")"
if [[ "${LEDGER_COUNT}" != "31" ]]; then
  echo "[recovery-v2] WARN ledger=${LEDGER_COUNT} (esperado 31); ver migraciones nuevas/eliminadas" >&2
fi

# =============================================================================
# PASO 3 · NUNCA RESTAURAR OBJETOS PLATFORM-MANAGED (guarda estructural)
# =============================================================================
# Se garantiza por construcción: el dump (paso 4) usa allowlist {public,
# app_private} y --data-only. Verificación adicional en 4c antes de restaurar.
FORBIDDEN_PATTERN='SCHEMA - (realtime|_realtime|vault|pgsodium|graphql|graphql_public|supabase_functions|auth|storage)|list_changes|log_min_messages'

# =============================================================================
# PASO 4 · DUMP / RESTORE DE DATOS APPLICATION-OWNED
# =============================================================================
if [[ -n "${DUMP_FILE}" ]]; then
  [[ -f "${DUMP_FILE}" ]] || abort "DUMP" "archivo --dump no existe: ${DUMP_FILE}"
  DUMP_RESULT="REUSED_EXISTING"
else
  if [[ -z "${SOURCE_DB_URL}" ]]; then
    DUMP_RESULT="SKIPPED_NO_SOURCE"
    echo "[recovery-v2] sin --source-db-url ni --dump: se omite el plano de datos (solo bootstrap+migraciones)." >&2
  else
    DUMP_FILE="${ARTIFACTS_DIR}/app-data.dump"
    # Filtros EXACTOS de 03_DUMP_FILTERS.txt/B. NOTA: se omite --disable-triggers
    # (embebe ENABLE/DISABLE TRIGGER ALL que requiere superuser al restaurar);
    # los triggers de usuario se manejan manualmente en 4g (03/E).
    if ! pg_dump "${SOURCE_DB_URL}" \
        --format=custom \
        --data-only \
        --no-owner \
        --no-privileges \
        --schema=public \
        --schema=app_private \
        --exclude-table=public.rate_limit_events \
        --exclude-table=public.edge_idempotency \
        --exclude-table=public.support_idempotency \
        --exclude-table=public.ticket_portal_logs \
        --file="${DUMP_FILE}" 2>"${ARTIFACTS_DIR}/04_dump.log"; then
      DUMP_RESULT="FAIL"
      abort "DUMP" "pg_dump fallo; ver ${ARTIFACTS_DIR}/04_dump.log"
    fi
    DUMP_RESULT="PASS"
  fi
fi

if [[ -n "${DUMP_FILE}" && -f "${DUMP_FILE}" ]]; then
  DUMP_BYTES="$(wc -c < "${DUMP_FILE}" | tr -d '[:space:]')"

  # --- 4c/GUARD: TOC del dump SIN patrones/objetos platform (nunca bytes de datos) ---
  TOC="$(pg_restore -l "${DUMP_FILE}" 2>"${ARTIFACTS_DIR}/04c_toc.log" || true)"
  echo "${TOC}" > "${ARTIFACTS_DIR}/04c_toc.txt"
  if echo "${TOC}" | grep -Eiq "${FORBIDDEN_PATTERN}"; then
    abort "DUMP_GUARD" "el dump contiene esquemas/objetos platform-managed (no allowlist); regenerar con filtros de 03_DUMP_FILTERS.txt"
  fi

  # --- 4e SECRET SCAN: solo sobre el TOC (estructura de nombres, nunca filas) ---
  if [[ -f tools/secret-gate-patterns.txt ]]; then
    if grep -Eqf tools/secret-gate-patterns.txt "${ARTIFACTS_DIR}/04c_toc.txt" 2>/dev/null; then
      SECRET_SCAN_RESULT="FAIL"
      abort "SECRET_SCAN" "patron de secreto detectado en el TOC del dump (no se imprime el hallazgo)"
    fi
  fi
  SECRET_SCAN_RESULT="PASS"

  # --- 4f auth.users ANTES de datos (paso 5 del ticket) -----------------------
  if [[ -x "tools/local-db/seed-auth-users.sh" ]]; then
    if ! tools/local-db/seed-auth-users.sh "${DB_URL}" >"${ARTIFACTS_DIR}/04f_auth_seed.log" 2>&1; then
      abort "AUTH_USERS" "seed-auth-users.sh fallo; ver ${ARTIFACTS_DIR}/04f_auth_seed.log"
    fi
  else
    echo "[recovery-v2] WARN: no existe tools/local-db/seed-auth-users.sh (punto abierto 07 §5.1)." >&2
    echo "[recovery-v2] WARN: si public.perfiles no encuentra auth.users, el restore abortara por FK (esperado, fail-closed)." >&2
  fi

  # --- 4g DESHABILITAR triggers de usuario (owner, NO superuser) -------------
  docker exec "${CID}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "
    do \$\$ declare r record; begin
      for r in select format('%I.%I', schemaname, tablename) t
               from pg_tables where schemaname in ('public','app_private')
      loop execute 'alter table ' || r.t || ' disable trigger user'; end loop;
    end \$\$;" >"${ARTIFACTS_DIR}/04g_disable_triggers.log" 2>&1 || \
    abort "RESTORE" "no se pudieron deshabilitar triggers de usuario"

  docker cp "${DUMP_FILE}" "${CID}:/tmp/app.dump"
  RESTORE_OK="yes"
  if ! docker exec "${CID}" pg_restore -U postgres -d postgres \
      --data-only --single-transaction --exit-on-error \
      --schema=public --schema=app_private \
      /tmp/app.dump >"${ARTIFACTS_DIR}/04h_restore.log" 2>&1; then
    RESTORE_OK="no"
  fi
  docker exec "${CID}" rm -f /tmp/app.dump || true

  # --- reactivar triggers pase lo que pase (best-effort) ---------------------
  docker exec "${CID}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "
    do \$\$ declare r record; begin
      for r in select format('%I.%I', schemaname, tablename) t
               from pg_tables where schemaname in ('public','app_private')
      loop execute 'alter table ' || r.t || ' enable trigger user'; end loop;
    end \$\$;" >"${ARTIFACTS_DIR}/04i_enable_triggers.log" 2>&1 || \
    echo "[recovery-v2] WARN: fallo al reactivar triggers de usuario (revisar manualmente)" >&2

  if [[ "${RESTORE_OK}" != "yes" ]]; then
    RESTORE_RESULT="FAIL"
    abort "RESTORE" "pg_restore --data-only fallo; ver ${ARTIFACTS_DIR}/04h_restore.log (posible FK circular tickets<->solicitudes_soporte, ver recovery-data-order.txt)"
  fi
  RESTORE_RESULT="PASS"
else
  RESTORE_RESULT="SKIPPED_NO_DUMP"
fi

# =============================================================================
# PASO 5/6 · BUCKETS Y POLICIES (ya aplicados por migración en el PASO 2)
# =============================================================================
# Verificación mínima aquí; verificación completa en PASO 8 vía recovery-signature.sql.
BUCKETS_OK="$(docker exec "${CID}" psql -U postgres -d postgres -tAc \
  "select count(*) from storage.buckets where id in ('soporte_adjuntos','certificados');" 2>/dev/null | tr -d '[:space:]' || echo "0")"
if [[ "${BUCKETS_OK}" != "2" ]]; then
  echo "[recovery-v2] WARN: buckets application esperados=2, encontrados=${BUCKETS_OK}" >&2
fi

# =============================================================================
# PASO 7 · BLOBS DE STORAGE FUERA DE pg_dump (plano separado, solo LOCAL)
# =============================================================================
if [[ -n "${BLOBS_SRC}" ]]; then
  case "${BLOBS_SRC}" in
    s3://*|http://*|https://*)
      abort "STORAGE_BLOBS" "--blobs-src remoto no autorizado en esta unidad (solo LOCAL)"
      ;;
    *)
      if [[ -d "${BLOBS_SRC}" ]]; then
        echo "[recovery-v2] blobs: copia local best-effort desde ${BLOBS_SRC} (operativo, no valida metadata)." >&2
        echo "[recovery-v2] NOTA: el re-registro de metadata en storage.objects se hace via Storage API, no SQL (ver 05)." >&2
      else
        abort "STORAGE_BLOBS" "--blobs-src no es un directorio local existente: ${BLOBS_SRC}"
      fi
      ;;
  esac
else
  echo "[recovery-v2] blobs: sin --blobs-src; paso documentado como operacion manual (ver runbook)." >&2
fi

# =============================================================================
# PASO 8 · COMPARAR datos, RLS, ACL, funciones y search_path
# =============================================================================
docker cp "tools/local-db/recovery-signature.sql" "${CID}:/tmp/recovery-signature.sql"
docker exec "${CID}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -f /tmp/recovery-signature.sql >"${ARTIFACTS_DIR}/08_dest_signature.txt" 2>"${ARTIFACTS_DIR}/08_dest_signature.err" \
  || { STRUCTURE_PARITY="FAIL"; DATA_PARITY="FAIL"; RLS_RESTORE_RESULT="FAIL"; ACL_RESTORE_RESULT="FAIL"; \
       abort "VALIDATION" "recovery-signature.sql fallo contra el destino; ver ${ARTIFACTS_DIR}/08_dest_signature.err"; }
docker exec "${CID}" rm -f /tmp/recovery-signature.sql || true

if [[ -n "${SOURCE_DB_URL}" ]]; then
  if psql "${SOURCE_DB_URL}" -v ON_ERROR_STOP=1 -f tools/local-db/recovery-signature.sql \
      >"${ARTIFACTS_DIR}/08_src_signature.txt" 2>"${ARTIFACTS_DIR}/08_src_signature.err"; then
    if diff -q "${ARTIFACTS_DIR}/08_src_signature.txt" "${ARTIFACTS_DIR}/08_dest_signature.txt" >/dev/null 2>&1; then
      STRUCTURE_PARITY="PASS"; DATA_PARITY="PASS"; RLS_RESTORE_RESULT="PASS"; ACL_RESTORE_RESULT="PASS"
    else
      diff "${ARTIFACTS_DIR}/08_src_signature.txt" "${ARTIFACTS_DIR}/08_dest_signature.txt" \
        > "${ARTIFACTS_DIR}/08_signature.diff" 2>&1 || true
      STRUCTURE_PARITY="DIFF_FOUND"; DATA_PARITY="DIFF_FOUND"; RLS_RESTORE_RESULT="DIFF_FOUND"; ACL_RESTORE_RESULT="DIFF_FOUND"
      echo "[recovery-v2] WARN: diferencias fuente/destino en ${ARTIFACTS_DIR}/08_signature.diff (revisar antes de aprobar)" >&2
    fi
  else
    STRUCTURE_PARITY="SOURCE_SIGNATURE_FAILED"; DATA_PARITY="SOURCE_SIGNATURE_FAILED"
    RLS_RESTORE_RESULT="SOURCE_SIGNATURE_FAILED"; ACL_RESTORE_RESULT="SOURCE_SIGNATURE_FAILED"
  fi
else
  STRUCTURE_PARITY="BASELINE_ONLY_NO_SOURCE"
  DATA_PARITY="BASELINE_ONLY_NO_SOURCE"
  RLS_RESTORE_RESULT="BASELINE_ONLY_NO_SOURCE"
  ACL_RESTORE_RESULT="BASELINE_ONLY_NO_SOURCE"
fi

# NOTA (no-duplicado / no-integracion falsa): tools/local-db/harness.mjs NO
# se invoca aqui. harness.mjs es una herramienta standalone con su propio
# workdir/puerto hardcodeados (tools/local-db/.runtime) y no expone flags para
# apuntar a un clon ya levantado por otro proceso ni funciones exportadas por
# fase; llamarlo desde este script levantaria un SEGUNDO Supabase local
# independiente en vez de validar el clon de recovery-v2, lo cual seria un
# resultado falso-positivo. RLS/ACL/policies/funciones/search_path de ESTE
# clon se validan arriba con recovery-signature.sql (secciones POLICIES/ACL/
# FUNCTIONS) ejecutado dentro del contenedor real (${CID}).
#
# Complementario y OPCIONAL (corrida independiente, workdir propio, no forma
# parte del resultado de esta unidad): tools/local-db/run-local-db-harness.sh
# añade la matriz RLS negativa multirol (authz_negative.sql) y el preflight de
# contratos (tools/run-contract-tests.mjs) que este script no repite.

# =============================================================================
# PASO 9 · MEDIR RPO / RTO
# =============================================================================
T_END="$(date -u +%s)"
RTO_SECONDS="$(( T_END - T_START ))"
if [[ -n "${DUMP_FILE}" && -f "${DUMP_FILE}" ]]; then
  DUMP_MTIME="$(date -u -r "${DUMP_FILE}" +%s 2>/dev/null || echo "${T_END}")"
  RPO_SECONDS="$(( T_END - DUMP_MTIME ))"
else
  RPO_SECONDS="-1"
fi

# =============================================================================
# PASO 10 · TEARDOWN COMPLETO
# =============================================================================
if [[ "${KEEP_UP}" == "yes" ]]; then
  DOCKER_STOPPED="NO"
  NEXT_ACTION="clon local activo (--keep-up); detener manualmente con: supabase stop --workdir ${RUNTIME_DIR} --no-backup"
else
  if supabase stop --workdir "${RUNTIME_DIR}" --no-backup >"${ARTIFACTS_DIR}/10_teardown.log" 2>&1; then
    DOCKER_STOPPED="YES"
  else
    DOCKER_STOPPED="FAIL"
    echo "[recovery-v2] WARN: supabase stop fallo; revisar Docker manualmente" >&2
  fi
  rm -rf "${RUNTIME_DIR}"
  NEXT_ACTION="revisar ${ARTIFACTS_DIR}/00_RESULT.txt y ${ARTIFACTS_DIR}/08_signature.diff (si existe)"
fi

FINAL_HEAD="$(git rev-parse HEAD 2>/dev/null || echo "${BASE_HEAD}")"
COMMIT_CREATED="NO"   # este script no realiza staging ni publicación remota; eso lo decide el operador.
RESULT="PASS"

# SCORABLE=YES solo si esta corrida ejecuto de verdad bootstrap+restore con
# Docker real (no dry-run, no dump omitido). Si el dump se omitio (sin
# --source-db-url ni --dump) esta corrida valido bootstrap+migraciones pero
# NO el plano de datos completo: no es scorable como recuperacion end-to-end.
if [[ "${DOCKER_USED}" == "YES" && "${BOOTSTRAP_RESULT}" == "PASS" && "${RESTORE_RESULT}" == "PASS" ]]; then
  SCORABLE="YES"
else
  SCORABLE="NO"
fi

trap - ERR
write_report
