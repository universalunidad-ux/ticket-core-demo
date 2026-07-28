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
# Fuente de verdad reutilizada (NO duplicada):
#   - tools/local-db/lib/bootstrap.mjs  OWNER ÚNICO del bootstrap Supabase local
#     (scaffold, config.toml, project_id, puertos, enlace de migraciones, start,
#     y resolución de EXACTAMENTE un contenedor por proyecto y puerto). Este
#     script no reimplementa nada de eso: lo invoca. harness.mjs consume el mismo
#     módulo, así que hay un solo bootstrap en el repositorio.
#   - tools/local-db/lib/guards.mjs     clasificación LOCAL/REMOTO y guarda de env
#   - tools/local-db/lib/parse.mjs      parsers puros
# Este script AÑADE el plano de datos (dump/restore filtrado) y el plano de
# Storage, y orquesta la comparación de firmas (paso 8).
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
#   --source-signature-file <archivo>
#                            Firma completa persistida de la fuente LOCAL.
#   --source-cutoff-epoch <N>
#                            Corte epoch de la fuente, anterior al dump completo.
#   --db-port <N>            Puerto de la DB del clon de recuperación (default 54339;
#                            distinto del harness, que usa 54329, para no compartir
#                            puerto ni contenedor con él).
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
EXPECTED_HOST_POSTGRES_VERSION="18.4"
EXPECTED_HOST_POSTGRES_VERSION_ERE='18\.4'
PSQL_BIN=""
PG_DUMP_BIN=""
PG_RESTORE_BIN=""
HOST_PSQL_VERSION=""
HOST_PG_DUMP_VERSION=""
HOST_PG_RESTORE_VERSION=""

# --- Resolver raíz del repo/worktree (dir de este script -> ../..) ----------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." >/dev/null 2>&1 && pwd)"
cd "${REPO_ROOT}"

RUNTIME_DIR="tools/local-db/.runtime-recovery"
ARTIFACTS_ROOT="tools/local-db/.artifacts-recovery"
TS="${RECOVERY_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
if [[ ! "${TS}" =~ ^[0-9]{8}T[0-9]{6}Z(-[a-z0-9-]+)?$ ]]; then
  echo "ABORT: RECOVERY_RUN_ID invalido" >&2
  exit 2
fi
ARTIFACTS_DIR="${ARTIFACTS_ROOT}/${TS}"

# (P2/P3) Identidad PROPIA del clon de recuperacion. project_id y puerto no se
# comparten con el harness (tc_local_db_harness / 54329): asi el contenedor de
# cada proyecto es distinguible por nombre Y por puerto, y bootstrap.mjs puede
# exigir exactamente una coincidencia sin ambiguedad.
PROJECT_ID="tc_recovery_v2"
DB_PORT="54339"
# Numero de migraciones de la baseline canonica. Fail-closed si el ledger difiere.
EXPECTED_MIGRATIONS="31"
SOURCE_DB_URL=""
DUMP_FILE=""
SOURCE_SIGNATURE_FILE=""
SOURCE_CUTOFF_EPOCH=""
BLOBS_SRC=""
KEEP_UP="no"
DRY_RUN="no"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source-db-url) SOURCE_DB_URL="${2:-}"; shift 2 ;;
    --dump) DUMP_FILE="${2:-}"; shift 2 ;;
    --source-signature-file) SOURCE_SIGNATURE_FILE="${2:-}"; shift 2 ;;
    --source-cutoff-epoch) SOURCE_CUTOFF_EPOCH="${2:-}"; shift 2 ;;
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
STRUCTURE_RESTORE_RESULT="NOT_RUN"
FUNCTIONS_RESTORE_RESULT="NOT_RUN"
POLICIES_RESTORE_RESULT="NOT_RUN"
RLS_RESTORE_RESULT="NOT_RUN"
ACL_RESTORE_RESULT="NOT_RUN"
DATA_RESTORE_RESULT="NOT_RUN"
LEDGER_RESTORE_RESULT="NOT_RUN"
STORAGE_RESTORE_RESULT="NOT_RUN"
OWNERSHIP_RESTORE_RESULT="NOT_RUN"
# Alias historicos preservados para consumidores existentes del artefacto.
LEDGER_PARITY="NOT_RUN"
STORAGE_PARITY="NOT_RUN"
OWNERSHIP_PARITY="NOT_RUN"
SECTIONS_EXPECTED="STRUCTURE,FUNCTIONS,POLICIES,ACL,DATA,LEDGER,STORAGE,OWNERSHIP"
SECTIONS_EXECUTED=""
DUPLICATE_SECTIONS="NONE"
MISSING_SECTIONS="NONE"
RECOVERY_SIGNATURE_SECTIONS=(
  STRUCTURE
  FUNCTIONS
  POLICIES
  ACL
  DATA
  LEDGER
  STORAGE
  OWNERSHIP
)
RPO_SECONDS="-1"
RTO_SECONDS="-1"
DUMP_BYTES="0"
DOCKER_USED="NO"
DOCKER_STOPPED="NO"
WORKTREE_STATUS="unknown"
COMMIT_CREATED="NO"
NEXT_ACTION="revisar ${ARTIFACTS_DIR}/00_RESULT.txt"

# (P6) Adjudicacion real del dump: allowlist sobre la TOC y escaneo del contenido.
DUMP_ALLOWLIST_RESULT="NOT_RUN"
DUMP_CONTENT_SCAN="NOT_RUN"
# (P7) Seed sintetico, FK circular, triggers, ownership e integridad post-restore.
AUTH_SEED_RESULT="NOT_RUN"
AUTH_SEED_USERS="0"
OWNERSHIP_CHECK="NOT_RUN"
CIRCULAR_FK_STRATEGY="NOT_RUN"
INTEGRITY_RESTORE_RESULT="NOT_RUN"
FK_INTEGRITY="NOT_RUN"
# (P5) Ciclo de vida del stack. STACK_OWNED sólo pasa a "yes" DESPUES de que el
# bootstrap acredito que el contenedor es el de ESTE proyecto: mientras valga
# "no", ningun camino de salida puede detener ni inspeccionar nada.
STACK_OWNED="no"
STOP_ATTEMPTED="no"
CID=""
DB_URL=""
EFFECTIVE_DB_PORT=""
INTEGRITY_SUSPENDED="no"
RUNTIME_DELETED="NO"
RUNTIME_PRESERVED="NO"
INTERRUPTED="NO"
STOP_CODE="OK"
SCORABLE="NO"
SOURCE_SIGNATURE_MODE="NONE"
SOURCE_SIGNATURE_RESULT="NOT_RUN"
DUMP_COMPLETE_EPOCH=""
RECOVERY_START_EPOCH=""
SOURCE_SERVER_MAJOR="UNKNOWN"
SOURCE_CLIENT_MAJOR="UNKNOWN"
DESTINATION_SERVER_MAJOR="UNKNOWN"
DESTINATION_CLIENT_MAJOR="UNKNOWN"
OWNERSHIP_CLASSIFICATION="SOURCE_DATA_OWNED"
DUPLICATE_CONSTRAINT="site_config_pkey"
MIGRATION_KEY_COUNT="6"
DUMP_KEY_COUNT="0"
OVERLAP_KEY_COUNT="0"
UNKNOWN_KEY_COUNT="0"
RESTORE_POLICY="ATOMIC_DELETE_COPY_VALIDATE_COMMIT"
SITE_CONFIG_TRANSFERRED="NO"
SITE_CONFIG_BASELINE_VALIDATED="NOT_RUN"

# Argumentos deterministas de psql: ignoran cualquier ~/.psqlrc del operador, de
# modo que el formato de las firmas y de los informes lo fija el .sql, no el host.
PSQL_DET_ARGS=(-X -q --no-psqlrc -v ON_ERROR_STOP=1)

T_START="$(date -u +%s)"

# NOTA (P1): ARTIFACTS_DIR ya NO se crea aqui. Crearlo antes de medir
# WORKTREE_STATUS ensuciaba el arbol con una ruta creada por el propio script y
# forzaba WORKTREE_STATUS=dirty en toda corrida. Se materializa al final de la
# FASE 0, despues de la medicion, y de forma perezosa dentro de write_report
# para no perder evidencia en los abortos previos a esa medicion.

write_report() {
  mkdir -p "${ARTIFACTS_DIR}"
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
STRUCTURE_RESTORE_RESULT=${STRUCTURE_RESTORE_RESULT}
FUNCTIONS_RESTORE_RESULT=${FUNCTIONS_RESTORE_RESULT}
POLICIES_RESTORE_RESULT=${POLICIES_RESTORE_RESULT}
RLS_RESTORE_RESULT=${RLS_RESTORE_RESULT}
ACL_RESTORE_RESULT=${ACL_RESTORE_RESULT}
DATA_RESTORE_RESULT=${DATA_RESTORE_RESULT}
LEDGER_RESTORE_RESULT=${LEDGER_RESTORE_RESULT}
STORAGE_RESTORE_RESULT=${STORAGE_RESTORE_RESULT}
OWNERSHIP_RESTORE_RESULT=${OWNERSHIP_RESTORE_RESULT}
LEDGER_PARITY=${LEDGER_PARITY}
STORAGE_PARITY=${STORAGE_PARITY}
OWNERSHIP_PARITY=${OWNERSHIP_PARITY}
SECTIONS_EXPECTED=${SECTIONS_EXPECTED}
SECTIONS_EXECUTED=${SECTIONS_EXECUTED:-NONE}
DUPLICATE_SECTIONS=${DUPLICATE_SECTIONS}
MISSING_SECTIONS=${MISSING_SECTIONS}
RPO_SECONDS=${RPO_SECONDS}
RTO_SECONDS=${RTO_SECONDS}
DUMP_BYTES=${DUMP_BYTES}
SOURCE_SIGNATURE_MODE=${SOURCE_SIGNATURE_MODE}
SOURCE_SIGNATURE_RESULT=${SOURCE_SIGNATURE_RESULT}
HOST_PSQL_VERSION=${HOST_PSQL_VERSION:-UNKNOWN}
HOST_PG_DUMP_VERSION=${HOST_PG_DUMP_VERSION:-UNKNOWN}
HOST_PG_RESTORE_VERSION=${HOST_PG_RESTORE_VERSION:-UNKNOWN}
SOURCE_SERVER_MAJOR=${SOURCE_SERVER_MAJOR}
SOURCE_CLIENT_MAJOR=${SOURCE_CLIENT_MAJOR}
DESTINATION_SERVER_MAJOR=${DESTINATION_SERVER_MAJOR}
DESTINATION_CLIENT_MAJOR=${DESTINATION_CLIENT_MAJOR}
OWNERSHIP_CLASSIFICATION=${OWNERSHIP_CLASSIFICATION}
DUPLICATE_CONSTRAINT=${DUPLICATE_CONSTRAINT}
MIGRATION_KEY_COUNT=${MIGRATION_KEY_COUNT}
DUMP_KEY_COUNT=${DUMP_KEY_COUNT}
OVERLAP_KEY_COUNT=${OVERLAP_KEY_COUNT}
UNKNOWN_KEY_COUNT=${UNKNOWN_KEY_COUNT}
RESTORE_POLICY=${RESTORE_POLICY}
SITE_CONFIG_TRANSFERRED=${SITE_CONFIG_TRANSFERRED}
SITE_CONFIG_BASELINE_VALIDATED=${SITE_CONFIG_BASELINE_VALIDATED}
SOURCE_CUTOFF_EPOCH=${SOURCE_CUTOFF_EPOCH:-NOT_PROVIDED}
DUMP_ALLOWLIST_RESULT=${DUMP_ALLOWLIST_RESULT}
DUMP_CONTENT_SCAN=${DUMP_CONTENT_SCAN}
AUTH_SEED_RESULT=${AUTH_SEED_RESULT}
AUTH_SEED_USERS=${AUTH_SEED_USERS}
OWNERSHIP_CHECK=${OWNERSHIP_CHECK}
CIRCULAR_FK_STRATEGY=${CIRCULAR_FK_STRATEGY}
INTEGRITY_RESTORE_RESULT=${INTEGRITY_RESTORE_RESULT}
FK_INTEGRITY=${FK_INTEGRITY}
DOCKER_USED=${DOCKER_USED}
DOCKER_STOPPED=${DOCKER_STOPPED}
RUNTIME_DELETED=${RUNTIME_DELETED}
RUNTIME_PRESERVED=${RUNTIME_PRESERVED}
INTERRUPTED=${INTERRUPTED}
STOP_CODE=${STOP_CODE}
PROJECT_ID=${PROJECT_ID}
WORKTREE_STATUS=${WORKTREE_STATUS}
COMMIT_CREATED=${COMMIT_CREATED}
PUSH=NO
DEPLOY=NO
SUPABASE_REMOTE=NO
SCORABLE=${SCORABLE}
NEXT_ACTION=${NEXT_ACTION}
EOF
  cat "${ARTIFACTS_DIR}/00_RESULT.txt"
}

# =============================================================================
# (P7) RESTAURACION DE INTEGRIDAD · idempotente y GARANTIZADA
#
# Reactiva los triggers de usuario y recrea las FK circulares que se retiraron
# para poder cargar los datos. Se invoca en el camino feliz Y desde abort() y
# desde el manejador de senales, de modo que un fallo de streaming, de
# `pg_restore` o de la validacion no puede dejar el clon con integridad
# suspendida. INTEGRITY_SUSPENDED es el unico interruptor: si vale "no" esta
# funcion no toca nada.
# =============================================================================
restore_integrity() {
  [[ "${INTEGRITY_SUSPENDED}" == "yes" ]] || return 0
  local rc=0 cname ctable cdef
  set +e
  docker exec "${CID}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "
    do \$\$ declare r record; begin
      for r in select format('%I.%I', schemaname, tablename) t
               from pg_tables where schemaname in ('public','app_private')
      loop execute 'alter table ' || r.t || ' enable trigger user'; end loop;
    end \$\$;" >>"${ARTIFACTS_DIR}/04i_enable_triggers.log" 2>&1 || rc=1

  # Recrear cada FK circular con su definicion ORIGINAL. El ADD CONSTRAINT
  # revalida TODAS las filas: si el restore dejo huerfanas, falla aqui.
  if [[ -s "${ARTIFACTS_DIR}/04j_circular_fk.txt" ]]; then
    while IFS='|' read -r cname ctable cdef; do
      [[ -n "${cname}" && -n "${ctable}" && -n "${cdef}" ]] || continue
      docker exec "${CID}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
        -c "alter table ${ctable} add constraint ${cname} ${cdef};" \
        >>"${ARTIFACTS_DIR}/04j_restore_circular_fk.log" 2>&1 || rc=1
    done < "${ARTIFACTS_DIR}/04j_circular_fk.txt"
  fi
  set -e

  if [[ ${rc} -eq 0 ]]; then
    INTEGRITY_SUSPENDED="no"
    INTEGRITY_RESTORE_RESULT="PASS"
  else
    INTEGRITY_RESTORE_RESULT="FAIL"
  fi
  return ${rc}
}

# =============================================================================
# (P5) TEARDOWN · fail-closed, idempotente y acotado al stack PROPIO
#
#   - Como maximo UN intento de stop en toda la corrida (STOP_ATTEMPTED).
#   - Si nunca se registro ownership del stack, no se ejecuta nada: no se
#     detiene ni se inspecciona infraestructura ajena.
#   - El teardown lo hace bootstrap.mjs, MISMO owner que el arranque, que exige
#     que el config.toml del workdir declare este project_id.
#   - El runtime SOLO se borra si el stop devolvio 0. Si falla, se preserva
#     runtime + project_id + CID + artefactos para recuperacion manual.
#   - NUNCA se borra ARTIFACTS_DIR: 00_RESULT.txt y los logs de fase sobreviven
#     a cualquier camino de salida.
# =============================================================================
teardown_stack() {
  [[ "${STOP_ATTEMPTED}" == "no" ]] || return 0
  STOP_ATTEMPTED="yes"

  if [[ "${STACK_OWNED}" != "yes" ]]; then
    DOCKER_STOPPED="NOT_OWNED"
    return 0
  fi
  if [[ "${KEEP_UP}" == "yes" ]]; then
    DOCKER_STOPPED="KEPT_UP"
    RUNTIME_PRESERVED="YES"
    return 0
  fi

  local rc=0
  set +e
  node tools/local-db/lib/bootstrap.mjs --stop \
    --project-id "${PROJECT_ID}" \
    --runtime-dir "${RUNTIME_DIR}" \
    --remove-runtime >>"${ARTIFACTS_DIR}/10_teardown.log" 2>&1
  rc=$?
  set -e

  if [[ ${rc} -eq 0 ]]; then
    DOCKER_STOPPED="YES"
    RUNTIME_DELETED="YES"
    RUNTIME_PRESERVED="NO"
  else
    DOCKER_STOPPED="FAIL"
    RUNTIME_DELETED="NO"
    RUNTIME_PRESERVED="YES"
    {
      echo "TEARDOWN_FAILED=YES"
      echo "PRESERVED_RUNTIME_DIR=${RUNTIME_DIR}"
      echo "PRESERVED_PROJECT_ID=${PROJECT_ID}"
      echo "PRESERVED_CID=${CID:-unknown}"
      echo "PRESERVED_DB_PORT=${EFFECTIVE_DB_PORT:-${DB_PORT}}"
      echo "MANUAL_RECOVERY=supabase stop --workdir ${RUNTIME_DIR} --no-backup"
    } > "${ARTIFACTS_DIR}/10_teardown_preserved.txt"
    echo "[recovery-v2] WARN: stop fallo; runtime y evidencia PRESERVADOS en ${RUNTIME_DIR}" >&2
  fi
  return 0
}

abort() {
  # $1=fase  $2=detalle  $3=next_action
  trap - ERR INT TERM
  local phase="$1" detail="$2"
  RESULT="FAIL"
  SCORABLE="NO"
  [[ "${STOP_CODE}" != "OK" ]] || STOP_CODE="E_${phase}"
  NEXT_ACTION="${3:-corregir '${phase}' (${detail}) y reintentar; ver docs/operations/RECOVERY_V2_RUNBOOK.md}"
  echo "ABORT[${phase}]: ${detail}" >&2
  if ! restore_integrity; then
    INTEGRITY_RESTORE_RESULT="FAIL"
  fi
  teardown_stack
  write_report
  exit 1
}

# (P5) Ctrl-C y SIGTERM NO pueden terminar como PASS. Se fija RESULT=FAIL antes
# de cualquier otra cosa, se restituye la integridad, se detiene SOLO el stack
# propio y se preserva la evidencia. Exit code 128+senal, nunca 0.
on_signal() {
  trap - ERR INT TERM
  local signame="$1" signum="$2"
  RESULT="FAIL"
  SCORABLE="NO"
  INTERRUPTED="YES"
  STOP_CODE="E_INTERRUPTED_${signame}"
  echo "ABORT[SIGNAL]: recibida ${signame}; deteniendo el stack propio" >&2
  if ! restore_integrity; then
    INTEGRITY_RESTORE_RESULT="FAIL"
  fi
  teardown_stack
  NEXT_ACTION="corrida interrumpida por ${signame}: NO es un PASS; revisar ${ARTIFACTS_DIR}/00_RESULT.txt y repetir"
  write_report
  exit $((128 + signum))
}

trap 'abort "UNEXPECTED" "fallo no controlado en linea $LINENO" "revisar logs y ${ARTIFACTS_DIR}"' ERR
trap 'on_signal INT 2' INT
trap 'on_signal TERM 15' TERM

assert_regular_local_file() {
  local label="$1" path="$2"
  case "${path}" in
    ""|*://*) abort "PRECHECK_SCOPE_GUARD" "${label} debe ser una ruta local no vacia" ;;
  esac
  [[ -e "${path}" ]] || abort "PRECHECK_SCOPE_GUARD" "${label} no existe"
  [[ ! -L "${path}" ]] || abort "PRECHECK_SCOPE_GUARD" "${label} no puede ser symlink"
  [[ -f "${path}" ]] || abort "PRECHECK_SCOPE_GUARD" "${label} debe ser archivo regular"
}

resolve_postgres_tool() {
  local tool="$1" candidate="" libpq_prefix=""

  if command -v brew >/dev/null 2>&1; then
    if ! libpq_prefix="$(brew --prefix libpq 2>/dev/null)"; then
      libpq_prefix=""
    fi
    candidate="${libpq_prefix}/bin/${tool}"
    if [[ -n "${libpq_prefix}" && -x "${candidate}" ]]; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  fi

  for libpq_prefix in "/opt/homebrew/opt/libpq" "/usr/local/opt/libpq"; do
    candidate="${libpq_prefix}/bin/${tool}"
    if [[ -x "${candidate}" ]]; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done

  return 1
}

parse_postgres_tool_version() {
  local tool="$1" raw="$2" normalized=""

  normalized="${raw//$'\r'/}"
  if [[ "${normalized}" =~ ^[[:space:]]*${tool}[[:space:]]+\(PostgreSQL\)[[:space:]]+([0-9]+\.[0-9]+(\.[0-9]+)?)[[:space:]]*(\(Homebrew\))?[[:space:]]*$ ]]; then
    printf '%s\n' "${BASH_REMATCH[1]}"
    return 0
  fi

  return 1
}

read_postgres_tool_version() {
  local tool="$1" path="$2" raw="" version=""

  raw="$("${path}" --version 2>/dev/null)" || return 1
  version="$(parse_postgres_tool_version "${tool}" "${raw}")" || return 1
  printf '%s\n' "${version}"
}

version_major() {
  local version="$1"
  [[ "${version}" =~ ^([0-9]+)(\.|$) ]] || return 1
  printf '%s\n' "${BASH_REMATCH[1]}"
}

assert_host_postgres_tools() {
  local psql_version="" pg_dump_version="" pg_restore_version=""

  PSQL_BIN="$(resolve_postgres_tool psql)" \
    || abort "PRECHECK_HOST" "psql no encontrado en PATH ni Homebrew libpq"
  PG_DUMP_BIN="$(resolve_postgres_tool pg_dump)" \
    || abort "PRECHECK_HOST" "pg_dump no encontrado en PATH ni Homebrew libpq"
  PG_RESTORE_BIN="$(resolve_postgres_tool pg_restore)" \
    || abort "PRECHECK_HOST" "pg_restore no encontrado en Homebrew libpq"

  psql_version="$(read_postgres_tool_version psql "${PSQL_BIN}")" \
    || abort "PRECHECK_HOST" "version de psql ilegible o no reconocida"
  pg_dump_version="$(read_postgres_tool_version pg_dump "${PG_DUMP_BIN}")" \
    || abort "PRECHECK_HOST" "version de pg_dump ilegible o no reconocida"
  pg_restore_version="$(read_postgres_tool_version pg_restore "${PG_RESTORE_BIN}")" \
    || abort "PRECHECK_HOST" "version de pg_restore ilegible o no reconocida"

  [[ "${psql_version}" =~ ^${EXPECTED_HOST_POSTGRES_VERSION_ERE}$ ]] \
    || abort "PRECHECK_HOST" "psql host no cumple ${EXPECTED_HOST_POSTGRES_VERSION}"
  [[ "${pg_dump_version}" =~ ^${EXPECTED_HOST_POSTGRES_VERSION_ERE}$ ]] \
    || abort "PRECHECK_HOST" "pg_dump host no cumple ${EXPECTED_HOST_POSTGRES_VERSION}"
  [[ "${pg_restore_version}" =~ ^${EXPECTED_HOST_POSTGRES_VERSION_ERE}$ ]] \
    || abort "PRECHECK_HOST" "pg_restore host no cumple ${EXPECTED_HOST_POSTGRES_VERSION}"
  [[ "${psql_version}" == "${pg_dump_version}" \
    && "${psql_version}" == "${pg_restore_version}" ]] \
    || abort "PRECHECK_HOST" "versiones host psql/pg_dump/pg_restore desalineadas"

  HOST_PSQL_VERSION="${psql_version}"
  HOST_PG_DUMP_VERSION="${pg_dump_version}"
  HOST_PG_RESTORE_VERSION="${pg_restore_version}"
}

read_container_server_major() {
  local cid="$1" version_num=""
  version_num="$(docker exec "${cid}" psql -U postgres -d postgres -X -qAt \
    -v ON_ERROR_STOP=1 -c 'show server_version_num' 2>/dev/null)" || return 1
  [[ "${version_num}" =~ ^[0-9]{5,6}$ ]] || return 1
  printf '%s\n' "$((10#${version_num} / 10000))"
}

read_container_tool_major() {
  local cid="$1" tool="$2" raw="" version=""
  raw="$(docker exec "${cid}" "${tool}" --version 2>/dev/null)" || return 1
  version="$(parse_postgres_tool_version "${tool}" "${raw}")" || return 1
  version_major "${version}"
}

assert_destination_toolchain() {
  DESTINATION_SERVER_MAJOR="$(read_container_server_major "${CID}")" \
    || abort "TOOLCHAIN_INCOMPATIBILITY" "no se pudo leer el major del servidor destino"
  DESTINATION_CLIENT_MAJOR="$(read_container_tool_major "${CID}" pg_restore)" \
    || abort "TOOLCHAIN_INCOMPATIBILITY" "no se pudo leer el major de pg_restore del destino"
  [[ "${DESTINATION_CLIENT_MAJOR}" == "${DESTINATION_SERVER_MAJOR}" ]] \
    || abort "TOOLCHAIN_INCOMPATIBILITY" \
      "DESTINATION_CLIENT_SERVER_MAJOR_MISMATCH client=${DESTINATION_CLIENT_MAJOR} server=${DESTINATION_SERVER_MAJOR}"
}

read_dump_toolchain_metadata() {
  local source_server_version="" source_client_version=""
  source_server_version="$(sed -n 's/^;[[:space:]]*Dumped from database version:[[:space:]]*//p' \
    "${ARTIFACTS_DIR}/04c_toc.txt" | head -n 1)"
  source_client_version="$(sed -n 's/^;[[:space:]]*Dumped by pg_dump version:[[:space:]]*//p' \
    "${ARTIFACTS_DIR}/04c_toc.txt" | head -n 1)"
  SOURCE_SERVER_MAJOR="$(version_major "${source_server_version}")" \
    || abort "TOOLCHAIN_INCOMPATIBILITY" "SOURCE_SERVER_MAJOR_UNREADABLE"
  SOURCE_CLIENT_MAJOR="$(version_major "${source_client_version}")" \
    || abort "TOOLCHAIN_INCOMPATIBILITY" "SOURCE_CLIENT_MAJOR_UNREADABLE"
  [[ "${SOURCE_CLIENT_MAJOR}" == "${SOURCE_SERVER_MAJOR}" ]] \
    || abort "TOOLCHAIN_INCOMPATIBILITY" \
      "SOURCE_CLIENT_SERVER_MAJOR_MISMATCH client=${SOURCE_CLIENT_MAJOR} server=${SOURCE_SERVER_MAJOR}"
  [[ "${SOURCE_SERVER_MAJOR}" == "${DESTINATION_SERVER_MAJOR}" ]] \
    || abort "TOOLCHAIN_INCOMPATIBILITY" \
      "SOURCE_DESTINATION_MAJOR_MISMATCH source=${SOURCE_SERVER_MAJOR} destination=${DESTINATION_SERVER_MAJOR}"
}

assert_local_db_url() {
  local candidate="$1"
  DB_URL_CHECK="${candidate}" node -e '
    import("./tools/local-db/lib/guards.mjs").then((g) => {
      const c = g.classifyTarget(process.env.DB_URL_CHECK || "");
      process.exit(c.classification === "LOCAL" ? 0 : 1);
    }).catch(() => process.exit(2));
  ' >/dev/null 2>&1
}

sanitize_log_stream() {
  node -e '
    import("./tools/local-db/lib/bootstrap.mjs").then(({ redactSecrets }) => {
      let input = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => { input += chunk; });
      process.stdin.on("end", () => {
        const sanitized = redactSecrets(input)
          .replace(/(postgres(?:ql)?:\/\/)[^:@\s]+(?::\*{3})?@/gi, "$1***:***@")
          .replace(/(\buser(?:name)?\s*=\s*)[^\s;]+/gi, "$1***");
        process.stdout.write(sanitized);
      });
    }).catch(() => process.exit(1));
  '
}

file_mtime_epoch() {
  local path="$1" value
  if value="$(stat -f %m "${path}" 2>/dev/null)"; then
    :
  elif value="$(stat -c %Y "${path}" 2>/dev/null)"; then
    :
  else
    value=""
  fi
  [[ "${value}" =~ ^[0-9]+$ ]] || return 1
  printf '%s\n' "${value}"
}

signature_section_markers_valid() {
  local sig="$1" section expected_csv=""
  for section in "${RECOVERY_SIGNATURE_SECTIONS[@]}"; do
    expected_csv="${expected_csv:+${expected_csv},}${section}"
  done

  awk -v expected_csv="${expected_csv}" '
    BEGIN {
      expected_count = split(expected_csv, expected, ",")
      for (i = 1; i <= expected_count; i += 1) {
        recognized[expected[i]] = 1
      }
    }
    /^SECTION=/ {
      name = substr($0, 9)
      if (complete_count > 0) format_error = 1
      if (name == "END") {
        terminator_count += 1
        saw_terminator = 1
        next
      }
      if (saw_terminator) format_error = 1
      if (!(name in recognized)) {
        unknown_count += 1
        next
      }
      section_count += 1
      seen[name] += 1
      next
    }
    /^RECOVERY_SIGNATURE_COMPLETE=YES$/ {
      complete_count += 1
      if (!saw_terminator) format_error = 1
      next
    }
    /^RECOVERY_SIGNATURE_COMPLETE=/ {
      format_error = 1
      next
    }
    {
      if (saw_terminator && complete_count == 0 &&
          $0 !~ /^[[:space:]]*$/) format_error = 1
      if (complete_count > 0 && $0 !~ /^[[:space:]]*$/) format_error = 1
    }
    END {
      if (expected_count != 8 || section_count != expected_count ||
          terminator_count != 1 || complete_count != 1 ||
          unknown_count != 0 || format_error != 0) {
        exit 1
      }
      for (i = 1; i <= expected_count; i += 1) {
        if (seen[expected[i]] != 1) exit 1
      }
    }
  ' "${sig}"
}

assert_complete_source_signature() {
  local sig="$1"
  signature_section_markers_valid "${sig}" \
    || abort "PRECHECK_SCOPE_GUARD" \
      "firma source corrupta: exige ocho secciones reconocidas y unicas, SECTION=END terminal y un solo RECOVERY_SIGNATURE_COMPLETE=YES"
}

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

# (P1) Recien ahora, ya medido el arbol, se materializa el directorio de
# artefactos. Ambas rutas efimeras (.runtime-recovery/ y .artifacts-recovery/)
# estan en tools/local-db/.gitignore, asi que crearlas no ensucia el arbol.
mkdir -p "${ARTIFACTS_DIR}"

# Fuente persistida secuencial: los tres elementos forman una sola evidencia.
# Ninguna combinación parcial puede presentarse como candidata scorable.
if [[ -n "${SOURCE_DB_URL}" && ( -n "${SOURCE_SIGNATURE_FILE}" || -n "${SOURCE_CUTOFF_EPOCH}" ) ]]; then
  abort "PRECHECK_SCOPE_GUARD" "--source-db-url no puede mezclarse con una firma source persistida"
fi
if [[ -n "${SOURCE_SIGNATURE_FILE}" ]]; then
  [[ -n "${DUMP_FILE}" ]] \
    || abort "PRECHECK_SCOPE_GUARD" "--source-signature-file exige --dump"
  [[ -n "${SOURCE_CUTOFF_EPOCH}" ]] \
    || abort "PRECHECK_SCOPE_GUARD" "--dump + --source-signature-file exige --source-cutoff-epoch"
  [[ "${SOURCE_CUTOFF_EPOCH}" =~ ^[0-9]+$ ]] \
    || abort "PRECHECK_SCOPE_GUARD" "--source-cutoff-epoch debe ser entero no negativo"
  assert_regular_local_file "--dump" "${DUMP_FILE}"
  assert_regular_local_file "--source-signature-file" "${SOURCE_SIGNATURE_FILE}"
  assert_complete_source_signature "${SOURCE_SIGNATURE_FILE}"
  SOURCE_SIGNATURE_MODE="PERSISTED_SEQUENTIAL"
  SOURCE_SIGNATURE_RESULT="VALIDATED"
elif [[ -n "${SOURCE_CUTOFF_EPOCH}" ]]; then
  abort "PRECHECK_SCOPE_GUARD" "--source-cutoff-epoch solo es invalido"
elif [[ -n "${DUMP_FILE}" ]]; then
  assert_regular_local_file "--dump" "${DUMP_FILE}"
  SOURCE_SIGNATURE_MODE="NONE_DUMP_ONLY"
elif [[ -n "${SOURCE_DB_URL}" ]]; then
  SOURCE_SIGNATURE_MODE="LIVE_LOCAL_DB"
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
ACTIVE_SUPABASE_STACKS="$(docker ps --filter 'name=^supabase_' --format '{{.Names}}' 2>/dev/null)" \
  || abort "PRECHECK_HOST" "no se pudo comprobar la ausencia de stacks Supabase activos"
if [[ -n "${ACTIVE_SUPABASE_STACKS}" ]]; then
  abort "PRECHECK_HOST" \
    "hay stacks Supabase activos; Recovery V2 exige inicio exclusivo y secuencial" \
    "detener completamente el stack fuente antes de iniciar el destino"
fi
if ! command -v supabase >/dev/null 2>&1; then
  abort "PRECHECK_HOST" "supabase CLI no encontrada" "brew install supabase/tap/supabase"
fi
# El host sólo se usa para la ruta opcional --source-db-url. El dump sintético
# y todo pg_restore usan clientes de los contenedores, alineados con sus servers.
assert_host_postgres_tools

DOCKER_USED="YES"

# =============================================================================
# PASO 1 · BOOTSTRAP DE PLATAFORMA SUPABASE LIMPIO
#
# (P2) Delegado ENTERAMENTE en tools/local-db/lib/bootstrap.mjs, owner unico del
# bootstrap. Este script ya NO hace `supabase start` por su cuenta: antes lo
# hacia sobre un workdir vacio, sin config.toml y sin enlazar migraciones (F-03),
# y resolvia el contenedor con `head -1` (F-04). bootstrap.mjs genera el scaffold
# con project_id y puertos PROPIOS y devuelve DB_URL y CID de la MISMA
# resolucion, de modo que no puede haber split-brain entre ambos.
# =============================================================================
RECOVERY_START_EPOCH="$(date -u +%s)"
BOOTSTRAP_ENV="$(node tools/local-db/lib/bootstrap.mjs \
  --project-id "${PROJECT_ID}" \
  --db-port "${DB_PORT}" \
  --runtime-dir "${RUNTIME_DIR}" \
  --reset-runtime \
  2>"${ARTIFACTS_DIR}/01_bootstrap.err")" || {
  BOOTSTRAP_RESULT="FAIL"
  abort "BOOTSTRAP" "bootstrap.mjs fallo; ver ${ARTIFACTS_DIR}/01_bootstrap.err (diagnostico ya redactado)"
}

# Parseo por clave, sin eval: la salida contiene DB_URL con credenciales del
# postgres local efimero y NUNCA debe ejecutarse ni imprimirse.
bootstrap_field() { printf '%s\n' "${BOOTSTRAP_ENV}" | sed -n "s/^$1=//p" | head -n 1; }

DB_URL="$(bootstrap_field BOOTSTRAP_DB_URL)"
CID="$(bootstrap_field BOOTSTRAP_CID)"
BOOTSTRAP_HOST="$(bootstrap_field BOOTSTRAP_HOST)"
EFFECTIVE_DB_PORT="$(bootstrap_field BOOTSTRAP_DB_PORT)"
CID_DB_URL_SINGLE_SOURCE="$(bootstrap_field BOOTSTRAP_CID_DB_URL_SINGLE_SOURCE)"

if [[ -z "${DB_URL}" || -z "${CID}" || -z "${EFFECTIVE_DB_PORT}" ]]; then
  BOOTSTRAP_RESULT="FAIL"
  abort "BOOTSTRAP" "bootstrap.mjs no devolvio DB_URL/CID/puerto completos"
fi
assert_local_db_url "${DB_URL}" \
  || abort "BOOTSTRAP" "DB_URL del destino no clasifica como LOCAL/loopback"
if [[ "${CID_DB_URL_SINGLE_SOURCE}" != "YES" ]]; then
  BOOTSTRAP_RESULT="FAIL"
  abort "BOOTSTRAP" "DB_URL y CID no provienen de la misma resolucion (split-brain)"
fi
# El nombre del contenedor debe ser exactamente el del proyecto de recovery.
if [[ "${CID}" != "supabase_db_${PROJECT_ID}" ]]; then
  BOOTSTRAP_RESULT="FAIL"
  abort "BOOTSTRAP" "contenedor ajeno al proyecto: esperado=supabase_db_${PROJECT_ID} actual=${CID}"
fi
BOOTSTRAP_RESULT="PASS"
# (P5) SOLO ahora se registra ownership del stack. Cualquier abort anterior sale
# sin tocar Docker, porque no hay nada que este script pueda reclamar como suyo.
STACK_OWNED="yes"
assert_destination_toolchain
# Se reporta el host y el puerto, NUNCA la DB_URL (lleva credenciales locales).
echo "[recovery-v2] bootstrap OK (project_id=${PROJECT_ID}, host=${BOOTSTRAP_HOST}, db_port=${EFFECTIVE_DB_PORT}, cid=${CID})"

# =============================================================================
# PASO 2 · MIGRACIONES CANÓNICAS (fuente de verdad = supabase/migrations)
# =============================================================================
if ! supabase db reset --workdir "${RUNTIME_DIR}" >"${ARTIFACTS_DIR}/02_migrations.log" 2>&1; then
  abort "MIGRATIONS" "supabase db reset fallo; ver ${ARTIFACTS_DIR}/02_migrations.log"
fi

# (P2.6) El ledger es FAIL-CLOSED. Antes era un WARN, asi que una corrida en la
# que no se aplicaba ninguna migracion seguia hasta el restore y podia acabar en
# RESULT=PASS. Un ledger distinto de 31 significa que el destino NO es la
# baseline canonica: no hay nada valido que comparar despues.
LEDGER_COUNT="$(docker exec "${CID}" psql -U postgres -d postgres -tAc \
  "select count(*) from supabase_migrations.schema_migrations;" 2>/dev/null | tr -d '[:space:]' || echo "-1")"
if [[ "${LEDGER_COUNT}" != "${EXPECTED_MIGRATIONS}" ]]; then
  abort "MIGRATIONS" \
    "ledger=${LEDGER_COUNT} (esperado ${EXPECTED_MIGRATIONS}); el destino no es la baseline canonica" \
    "revisar ${ARTIFACTS_DIR}/02_migrations.log y el inventario de supabase/migrations; NO comparar firmas sobre una baseline incompleta"
fi
echo "[recovery-v2] migraciones OK (ledger=${LEDGER_COUNT})"

# public.site_config tiene un baseline de seis claves, pero sus valores son
# SOURCE_DATA_OWNED: public.manage_site_config(text,text) los modifica y registra
# la mutación en bitácora. Antes de trasladar el estado de la fuente se exige que
# el seed del destino sea exactamente el canónico; no se acepta una baseline
# incompleta o con claves no clasificadas.
if ! node tools/local-db/lib/site-config-ownership.mjs --emit-baseline-sql \
    | docker exec -i "${CID}" psql -U postgres -d postgres "${PSQL_DET_ARGS[@]}" \
        >"${ARTIFACTS_DIR}/02b_site_config_baseline.log" 2>&1; then
  SITE_CONFIG_BASELINE_VALIDATED="FAIL"
  abort "MIGRATIONS" \
    "el baseline de public.site_config no coincide con la allowlist owner; ver ${ARTIFACTS_DIR}/02b_site_config_baseline.log"
fi
if ! grep -Fxq 'SITE_CONFIG_BASELINE_VALIDATED=PASS' \
    "${ARTIFACTS_DIR}/02b_site_config_baseline.log"; then
  SITE_CONFIG_BASELINE_VALIDATED="FAIL"
  abort "MIGRATIONS" \
    "la validacion de baseline termino sin marcador semantico PASS; ver ${ARTIFACTS_DIR}/02b_site_config_baseline.log"
fi
SITE_CONFIG_BASELINE_VALIDATED="PASS"

# =============================================================================
# PASO 3 · NUNCA RESTAURAR OBJETOS PLATFORM-MANAGED (guarda estructural)
#
# (P6) La guarda ya NO es un grep de FORBIDDEN_PATTERN sobre la TOC. Sobre una
# TOC --data-only jamas aparecen entradas `SCHEMA - realtime`, asi que aquel
# grep no podia fallar nunca: era una guarda vacua. Se sustituye por la
# adjudicacion POSITIVA de tools/local-db/lib/dump-allowlist.mjs, que exige que
# TODOS los objetos a restaurar esten en la allowlist, y por un escaneo del
# CONTENIDO real del dump (no solo de los nombres de la TOC). Ver 4c/4d/4e.
# =============================================================================

# =============================================================================
# PASO 4 · DUMP / RESTORE DE DATOS APPLICATION-OWNED
# =============================================================================
if [[ -n "${DUMP_FILE}" ]]; then
  DUMP_RESULT="REUSED_EXISTING"
  DUMP_COMPLETE_EPOCH="$(file_mtime_epoch "${DUMP_FILE}")" \
    || abort "DUMP" "no se pudo obtener el timestamp del dump local"
else
  if [[ -z "${SOURCE_DB_URL}" ]]; then
    DUMP_RESULT="SKIPPED_NO_SOURCE"
    echo "[recovery-v2] sin --source-db-url ni --dump: se omite el plano de datos (solo bootstrap+migraciones)." >&2
  else
    DUMP_FILE="${ARTIFACTS_DIR}/app-data.dump"
    SOURCE_CUTOFF_EPOCH="$(date -u +%s)"
    SOURCE_SERVER_VERSION="$("${PSQL_BIN}" "${SOURCE_DB_URL}" -X -qAt --no-psqlrc \
      -v ON_ERROR_STOP=1 -c 'show server_version' 2>/dev/null)" \
      || abort "TOOLCHAIN_INCOMPATIBILITY" "SOURCE_SERVER_VERSION_UNREADABLE"
    SOURCE_SERVER_MAJOR="$(version_major "${SOURCE_SERVER_VERSION}")" \
      || abort "TOOLCHAIN_INCOMPATIBILITY" "SOURCE_SERVER_MAJOR_UNREADABLE"
    SOURCE_CLIENT_MAJOR="$(version_major "${HOST_PG_DUMP_VERSION}")" \
      || abort "TOOLCHAIN_INCOMPATIBILITY" "HOST_PG_DUMP_MAJOR_UNREADABLE"
    [[ "${SOURCE_CLIENT_MAJOR}" == "${SOURCE_SERVER_MAJOR}" ]] \
      || abort "TOOLCHAIN_INCOMPATIBILITY" \
        "SOURCE_CLIENT_SERVER_MAJOR_MISMATCH client=${SOURCE_CLIENT_MAJOR} server=${SOURCE_SERVER_MAJOR}"
    [[ "${SOURCE_SERVER_MAJOR}" == "${DESTINATION_SERVER_MAJOR}" ]] \
      || abort "TOOLCHAIN_INCOMPATIBILITY" \
        "SOURCE_DESTINATION_MAJOR_MISMATCH source=${SOURCE_SERVER_MAJOR} destination=${DESTINATION_SERVER_MAJOR}"
    # Filtros EXACTOS de 03_DUMP_FILTERS.txt/B. NOTA: se omite --disable-triggers
    # (embebe ENABLE/DISABLE TRIGGER ALL que requiere superuser al restaurar);
    # los triggers de usuario se manejan manualmente en 4g (03/E).
    if ! "${PG_DUMP_BIN}" "${SOURCE_DB_URL}" \
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
    DUMP_COMPLETE_EPOCH="$(date -u +%s)"
    DUMP_RESULT="PASS"
  fi
fi

if [[ -n "${DUMP_FILE}" && -f "${DUMP_FILE}" ]]; then
  DUMP_BYTES="$(wc -c < "${DUMP_FILE}" | tr -d '[:space:]')"

  # --- 4c ALLOWLIST POSITIVA sobre la TOC (P6.1-P6.3) -------------------------
  # Se enumera lo que REALMENTE se va a restaurar y se exige que todo este en la
  # allowlist. Un objeto que no sea TABLE DATA/SEQUENCE SET de public|app_private,
  # una tabla efimera excluida, o una tabla que no figure en recovery-data-order.txt,
  # aborta. Un dump sin entradas de datos tambien aborta: nada que restaurar no es
  # lo mismo que "todo en regla".
  if ! docker exec -i "${CID}" pg_restore -l \
      <"${DUMP_FILE}" >"${ARTIFACTS_DIR}/04c_toc.txt" 2>"${ARTIFACTS_DIR}/04c_toc.log"; then
    DUMP_ALLOWLIST_RESULT="FAIL"
    abort "DUMP_GUARD" "pg_restore -l fallo sobre el dump; ver ${ARTIFACTS_DIR}/04c_toc.log"
  fi
  read_dump_toolchain_metadata
  if ! node tools/local-db/lib/dump-allowlist.mjs \
      --toc "${ARTIFACTS_DIR}/04c_toc.txt" \
      --order tools/local-db/recovery-data-order.txt \
      >"${ARTIFACTS_DIR}/04c_allowlist.txt" 2>&1; then
    DUMP_ALLOWLIST_RESULT="FAIL"
    abort "DUMP_GUARD" \
      "el dump restauraria objetos fuera de la allowlist; ver ${ARTIFACTS_DIR}/04c_allowlist.txt" \
      "regenerar el dump con los filtros de 03_DUMP_FILTERS.txt; NO restaurar un dump no adjudicado"
  fi
  DUMP_ALLOWLIST_RESULT="PASS"

  # SOURCE_DATA_OWNED: la carga general omite exactamente una entrada de TOC,
  # TABLE DATA public.site_config. No se omite ninguna otra tabla; site_config se
  # aplica después mediante sustitución transaccional y validación positiva.
  if ! node tools/local-db/lib/site-config-ownership.mjs \
      --build-restore-list --toc "${ARTIFACTS_DIR}/04c_toc.txt" \
      >"${ARTIFACTS_DIR}/04c_main_restore_toc.txt" \
      2>"${ARTIFACTS_DIR}/04c_site_config_policy.log"; then
    abort "DUMP_GUARD" \
      "la TOC no contiene exactamente un owner TABLE DATA para public.site_config; ver ${ARTIFACTS_DIR}/04c_site_config_policy.log"
  fi
  if ! docker exec -i "${CID}" sh -c \
      'umask 077; cat > /tmp/tc-recovery-main-restore.list' \
      <"${ARTIFACTS_DIR}/04c_main_restore_toc.txt"; then
    abort "DUMP_GUARD" \
      "no se pudo entregar la lista exacta de restore al contenedor destino"
  fi

  # --- 4d/4e ESCANEO DEL CONTENIDO REAL + SECRET SCAN (P6.4-P6.5) -------------
  # Los nombres de la TOC no revelan un `SET log_min_messages`, un GRANT o un
  # ALTER ... OWNER TO embebido: hay que mirar las sentencias. El SQL se consume
  # en STREAMING por una tuberia y NUNCA se escribe a disco ni se imprime; el
  # informe solo lleva regla + numero de linea + conteo.
  if ! docker exec -i "${CID}" pg_restore --data-only -f - \
      <"${DUMP_FILE}" 2>"${ARTIFACTS_DIR}/04d_content.log" \
      | node tools/local-db/lib/dump-allowlist.mjs --scan-content \
          --secret-patterns tools/secret-gate-patterns.txt \
          >"${ARTIFACTS_DIR}/04e_content_scan.txt" 2>&1; then
    DUMP_CONTENT_SCAN="FAIL"
    SECRET_SCAN_RESULT="FAIL"
    abort "SECRET_SCAN" \
      "el contenido del dump viola una regla de contenido o de secretos (hallazgo NO impreso); ver ${ARTIFACTS_DIR}/04e_content_scan.txt" \
      "revisar las reglas violadas por nombre; el dump no se restaura"
  fi
  DUMP_CONTENT_SCAN="PASS"
  SECRET_SCAN_RESULT="PASS"

  # --- 4f SEED SINTETICO DE auth.users, ANTES de los datos (P7.1-P7.3) --------
  # public.perfiles.id tiene FK a auth.users(id) y auth.* NO viaja en el dump.
  # Los UUID salen del propio dump (son los unicos que satisfacen la FK); todo
  # lo demas es sintetico y vive en example.invalid. El COPY de perfiles (que SI
  # trae PII) se consume por tuberia y no se materializa en ningun artefacto.
  if ! docker exec -i "${CID}" pg_restore --data-only --table=perfiles -f - \
      <"${DUMP_FILE}" 2>"${ARTIFACTS_DIR}/04f_auth_extract.log" \
      | node tools/local-db/lib/auth-seed.mjs --emit-sql \
          >"${ARTIFACTS_DIR}/04f_auth_seed.sql" 2>"${ARTIFACTS_DIR}/04f_auth_seed.err"; then
    AUTH_SEED_RESULT="FAIL"
    abort "AUTH_SEED" \
      "no se pudo generar el seed sintetico de auth.users; ver ${ARTIFACTS_DIR}/04f_auth_seed.err" \
      "sin auth.users el restore de public.perfiles fallaria por FK: corregir el dump de perfiles y repetir"
  fi
  AUTH_SEED_USERS="$(sed -n 's/^AUTH_SEED_USERS=//p' "${ARTIFACTS_DIR}/04f_auth_seed.err" | head -n 1)"
  AUTH_SEED_USERS="${AUTH_SEED_USERS:-0}"
  if ! docker exec -i "${CID}" psql -U postgres -d postgres -X -q --no-psqlrc \
      -v ON_ERROR_STOP=1 <"${ARTIFACTS_DIR}/04f_auth_seed.sql" \
      >"${ARTIFACTS_DIR}/04f_auth_seed.log" 2>&1; then
    AUTH_SEED_RESULT="FAIL"
    abort "AUTH_SEED" "el seed sintetico de auth.users fallo; ver ${ARTIFACTS_DIR}/04f_auth_seed.log"
  fi
  AUTH_SEED_RESULT="PASS"
  echo "[recovery-v2] auth.users sembrado sinteticamente (usuarios=${AUTH_SEED_USERS}, dominio example.invalid)"

  # --- 4g OWNERSHIP antes de cualquier ALTER TABLE (P7.8) --------------------
  OWNER_MISMATCH="$(docker exec "${CID}" psql -U postgres -d postgres -tAc \
    "select coalesce(string_agg(schemaname||'.'||tablename, ',' order by tablename), '')
     from pg_tables where schemaname in ('public','app_private') and tableowner <> current_user;" \
    2>"${ARTIFACTS_DIR}/04g_ownership.log" | tr -d '[:space:]')"
  if [[ -n "${OWNER_MISMATCH}" ]]; then
    OWNERSHIP_CHECK="FAIL"
    abort "OWNERSHIP" \
      "hay tablas de la allowlist que no pertenecen al rol actual: no se ejecuta ninguna modificacion sobre objetos ajenos (${OWNER_MISMATCH})" \
      "revisar ownership en el clon; un ALTER sobre una tabla ajena es una operacion no autorizada"
  fi
  OWNERSHIP_CHECK="PASS"

  # --- 4h FK CIRCULAR tickets <-> solicitudes_soporte (P7.4-P7.6) ------------
  # Estrategia elegida: RETIRAR las dos FK circulares antes de la carga y
  # RECREARLAS con su definicion original despues. Es owner-privileged (no exige
  # superuser), no altera la estructura final (la definicion se recupera literal
  # de pg_get_constraintdef) y el propio ADD CONSTRAINT REVALIDA todas las filas:
  # la integridad se demuestra, no se asume. `DISABLE TRIGGER USER` se mantiene
  # solo como higiene de carga (evita triggers de aplicacion) y NO se considera
  # mitigacion de integridad referencial: los triggers RI internos son otra cosa.
  docker exec "${CID}" psql -U postgres -d postgres -tA -v ON_ERROR_STOP=1 -c \
    "select c.conname||'|'||n.nspname||'.'||r.relname||'|'||pg_get_constraintdef(c.oid)
     from pg_constraint c
     join pg_class r on r.oid = c.conrelid
     join pg_namespace n on n.oid = r.relnamespace
     join pg_class fr on fr.oid = c.confrelid
     where c.contype='f' and n.nspname='public'
       and ((r.relname='tickets' and fr.relname='solicitudes_soporte')
         or (r.relname='solicitudes_soporte' and fr.relname='tickets'))
     order by c.conname;" >"${ARTIFACTS_DIR}/04j_circular_fk.txt" 2>"${ARTIFACTS_DIR}/04j_circular_fk.log" \
    || abort "RESTORE" "no se pudo inventariar la FK circular; ver ${ARTIFACTS_DIR}/04j_circular_fk.log"

  CIRCULAR_FK_COUNT="$(awk -F'|' 'NF > 1 { count += 1 } END { print count + 0 }' \
    "${ARTIFACTS_DIR}/04j_circular_fk.txt")"
  if [[ "${CIRCULAR_FK_COUNT}" != "2" ]]; then
    abort "RESTORE" \
      "se esperaban 2 FK circulares tickets<->solicitudes_soporte y se encontraron ${CIRCULAR_FK_COUNT}: el esquema no es el documentado" \
      "actualizar recovery-data-order.txt y el runbook antes de restaurar datos"
  fi

  # A partir de aqui la integridad queda SUSPENDIDA: restore_integrity() es
  # obligatoria en todos los caminos de salida (abort y senales la invocan).
  INTEGRITY_SUSPENDED="yes"
  CIRCULAR_FK_STRATEGY="DROP_AND_REVALIDATING_RECREATE"

  while IFS='|' read -r CFK_NAME CFK_TABLE CFK_DEF; do
    [[ -n "${CFK_NAME}" && -n "${CFK_TABLE}" ]] || continue
    docker exec "${CID}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
      -c "alter table ${CFK_TABLE} drop constraint ${CFK_NAME};" \
      >>"${ARTIFACTS_DIR}/04j_drop_circular_fk.log" 2>&1 \
      || abort "RESTORE" "no se pudo retirar la FK circular ${CFK_NAME}; ver ${ARTIFACTS_DIR}/04j_drop_circular_fk.log"
  done < "${ARTIFACTS_DIR}/04j_circular_fk.txt"

  docker exec "${CID}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "
    do \$\$ declare r record; begin
      for r in select format('%I.%I', schemaname, tablename) t
               from pg_tables where schemaname in ('public','app_private')
      loop execute 'alter table ' || r.t || ' disable trigger user'; end loop;
    end \$\$;" >"${ARTIFACTS_DIR}/04g_disable_triggers.log" 2>&1 || \
    abort "RESTORE" "no se pudieron deshabilitar triggers de usuario"

  assert_regular_local_file "--dump" "${DUMP_FILE}"
  RESTORE_OK="yes"
  if ! docker exec -i "${CID}" pg_restore \
      -U postgres \
      --dbname=postgres \
      --data-only \
      --single-transaction \
      --exit-on-error \
      --schema=public \
      --schema=app_private \
      --use-list=/tmp/tc-recovery-main-restore.list 2>&1 \
      <"${DUMP_FILE}" \
      | sanitize_log_stream >"${ARTIFACTS_DIR}/04h_restore.log"; then
    RESTORE_OK="no"
  fi

  # Sustitución SOURCE_DATA_OWNED. El SQL de COPY viaja sólo por streaming:
  # nunca se escribe ni se imprime. El owner valida allowlist, faltantes,
  # duplicados y desconocidas antes de emitir BEGIN/DELETE/COPY/validate/COMMIT.
  if [[ "${RESTORE_OK}" == "yes" ]]; then
    if ! docker exec -i "${CID}" pg_restore \
        --data-only --table=site_config -f - \
        <"${DUMP_FILE}" 2>"${ARTIFACTS_DIR}/04h_site_config_extract.log" \
        | node tools/local-db/lib/site-config-ownership.mjs --emit-atomic-sql \
            2>"${ARTIFACTS_DIR}/04h_site_config_policy.log" \
        | docker exec -i "${CID}" psql -U postgres -d postgres "${PSQL_DET_ARGS[@]}" \
            2>&1 \
        | sanitize_log_stream >>"${ARTIFACTS_DIR}/04h_restore.log"; then
      RESTORE_OK="no"
    else
      if ! grep -Fxq 'SITE_CONFIG_ATOMIC_RESTORE=PASS' \
          "${ARTIFACTS_DIR}/04h_restore.log"; then
        RESTORE_OK="no"
      else
        MIGRATION_KEY_COUNT="$(sed -n 's/^MIGRATION_KEY_COUNT=//p' \
          "${ARTIFACTS_DIR}/04h_site_config_policy.log" | head -n 1)"
        DUMP_KEY_COUNT="$(sed -n 's/^DUMP_KEY_COUNT=//p' \
          "${ARTIFACTS_DIR}/04h_site_config_policy.log" | head -n 1)"
        OVERLAP_KEY_COUNT="$(sed -n 's/^OVERLAP_KEY_COUNT=//p' \
          "${ARTIFACTS_DIR}/04h_site_config_policy.log" | head -n 1)"
        UNKNOWN_KEY_COUNT="$(sed -n 's/^UNKNOWN_KEY_COUNT=//p' \
          "${ARTIFACTS_DIR}/04h_site_config_policy.log" | head -n 1)"
        if [[ "${MIGRATION_KEY_COUNT}" == "6" \
           && "${DUMP_KEY_COUNT}" == "6" \
           && "${OVERLAP_KEY_COUNT}" == "6" \
           && "${UNKNOWN_KEY_COUNT}" == "0" ]]; then
          SITE_CONFIG_TRANSFERRED="YES"
        else
          RESTORE_OK="no"
        fi
      fi
    fi
  fi

  # --- 4i RESTITUCION GARANTIZADA de triggers y FK circulares (P7.7) ---------
  if ! restore_integrity; then
    RESTORE_RESULT="FAIL"
    abort "RESTORE" \
      "no se pudieron restituir triggers y/o FK circulares tras el restore; ver ${ARTIFACTS_DIR}/04j_restore_circular_fk.log" \
      "el clon queda con integridad suspendida: NO usarlo; recrear las constraints de ${ARTIFACTS_DIR}/04j_circular_fk.txt a mano"
  fi

  if [[ "${RESTORE_OK}" != "yes" ]]; then
    RESTORE_RESULT="FAIL"
    abort "RESTORE" "pg_restore --data-only fallo; ver ${ARTIFACTS_DIR}/04h_restore.log"
  fi
  RESTORE_RESULT="PASS"

  # --- 4k VALIDACION POSITIVA DE INTEGRIDAD (P7.9) ---------------------------
  # pg_restore terminando en 0 NO demuestra integridad. Se comprueba
  # explicitamente: FK validadas, cero huerfanas, cero triggers deshabilitados,
  # ownership intacto, y cada perfil con su auth.users sintetico.
  if ! docker exec -i "${CID}" psql -U postgres -d postgres "${PSQL_DET_ARGS[@]}" \
      <tools/local-db/fk-integrity.sql \
      >"${ARTIFACTS_DIR}/04k_fk_integrity.txt" 2>"${ARTIFACTS_DIR}/04k_fk_integrity.err"; then
    FK_INTEGRITY="FAIL"
    abort "VALIDATION" "fk-integrity.sql fallo; ver ${ARTIFACTS_DIR}/04k_fk_integrity.err"
  fi

  INTEGRITY_FINDINGS=""
  grep -q '^FK_INTEGRITY_COMPLETE=YES$' "${ARTIFACTS_DIR}/04k_fk_integrity.txt" \
    || INTEGRITY_FINDINGS="${INTEGRITY_FINDINGS}informe_truncado "
  integrity_value() { sed -n "s/^$1|//p" "${ARTIFACTS_DIR}/04k_fk_integrity.txt" | head -n 1; }
  [[ -z "$(integrity_value FK_NOT_VALIDATED)" ]]            || INTEGRITY_FINDINGS="${INTEGRITY_FINDINGS}fk_no_validadas "
  [[ -z "$(integrity_value TRIGGER_DISABLED)" ]]            || INTEGRITY_FINDINGS="${INTEGRITY_FINDINGS}triggers_deshabilitados "
  [[ -z "$(integrity_value TABLE_OWNER_MISMATCH)" ]]        || INTEGRITY_FINDINGS="${INTEGRITY_FINDINGS}ownership "
  [[ "$(integrity_value CIRCULAR_FK_PRESENT)" == "2" ]]     || INTEGRITY_FINDINGS="${INTEGRITY_FINDINGS}fk_circular_no_recreada "
  [[ "$(integrity_value PERFILES_WITHOUT_AUTH_USER)" == "0" ]] || INTEGRITY_FINDINGS="${INTEGRITY_FINDINGS}perfiles_sin_auth_user "
  [[ "$(integrity_value AUTH_USERS_NON_SYNTHETIC)" == "0" ]]   || INTEGRITY_FINDINGS="${INTEGRITY_FINDINGS}auth_users_no_sinteticos "
  if awk -F'|' '/^FK_ORPHANS\|/ { if ($3 != "0") exit 1 }' "${ARTIFACTS_DIR}/04k_fk_integrity.txt"; then :; else
    INTEGRITY_FINDINGS="${INTEGRITY_FINDINGS}filas_huerfanas "
  fi

  if [[ -n "${INTEGRITY_FINDINGS}" ]]; then
    FK_INTEGRITY="FAIL"
    abort "VALIDATION" \
      "validacion positiva de integridad fallida: ${INTEGRITY_FINDINGS}(ver ${ARTIFACTS_DIR}/04k_fk_integrity.txt)" \
      "el restore termino en 0 pero la integridad NO se sostiene: no aprobar esta recuperacion"
  fi
  FK_INTEGRITY="PASS"
  echo "[recovery-v2] integridad OK (FK validadas, 0 huerfanas, ownership intacto, perfiles<->auth.users completo)"
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
#
# (P4) Las ocho secciones son autoritativas para esta unidad. Cada una se
# compara exactamente una vez y sólo igualdad real produce PASS. Diferencia
# produce DIFF_FOUND; evidencia ausente o corrupta produce FAIL.
#
# Ambas firmas se generan con -X --no-psqlrc para ignorar cualquier ~/.psqlrc, y
# el formato lo fija recovery-signature.sql, no el invocador.
# =============================================================================
# --- Particion de una firma en bloques por seccion --------------------------
# Sin esto habria que hacer diff del archivo completo, y las secciones que
# divergen contaminarian el veredicto.
split_signature() {
  # $1 = archivo .sig  ·  $2 = directorio destino
  local sig="$1" out="$2"
  mkdir -p "${out}"
  awk -v out="${out}" '
    /^SECTION=END$/ { section = ""; next }
    /^SECTION=/ { section = substr($0, 9); next }
    { if (section != "") print > (out "/" section ".txt") }
  ' "${sig}"
}

set_signature_section_result() {
  local section="$1" verdict="$2"
  case "${section}" in
    STRUCTURE)
      STRUCTURE_RESTORE_RESULT="${verdict}"
      STRUCTURE_PARITY="${verdict}"
      ;;
    FUNCTIONS)
      FUNCTIONS_RESTORE_RESULT="${verdict}"
      ;;
    POLICIES)
      POLICIES_RESTORE_RESULT="${verdict}"
      RLS_RESTORE_RESULT="${verdict}"
      ;;
    ACL)
      ACL_RESTORE_RESULT="${verdict}"
      ;;
    DATA)
      DATA_RESTORE_RESULT="${verdict}"
      DATA_PARITY="${verdict}"
      ;;
    LEDGER)
      LEDGER_RESTORE_RESULT="${verdict}"
      LEDGER_PARITY="${verdict}"
      ;;
    STORAGE)
      STORAGE_RESTORE_RESULT="${verdict}"
      STORAGE_PARITY="${verdict}"
      ;;
    OWNERSHIP)
      OWNERSHIP_RESTORE_RESULT="${verdict}"
      OWNERSHIP_PARITY="${verdict}"
      ;;
    *)
      return 1
      ;;
  esac
}

set_all_signature_section_results() {
  local verdict="$1" section
  for section in "${RECOVERY_SIGNATURE_SECTIONS[@]}"; do
    set_signature_section_result "${section}" "${verdict}"
  done
}

compare_signature_sections() {
  local src_dir="$1" dst_dir="$2" diff_dir="$3"
  local section src_section dst_section verdict
  local failures=""

  SECTIONS_EXECUTED=""
  DUPLICATE_SECTIONS="NONE"
  MISSING_SECTIONS="NONE"

  for section in "${RECOVERY_SIGNATURE_SECTIONS[@]}"; do
    SECTIONS_EXECUTED="${SECTIONS_EXECUTED:+${SECTIONS_EXECUTED},}${section}"
    src_section="${src_dir}/${section}.txt"
    dst_section="${dst_dir}/${section}.txt"
    verdict="PASS"

    if [[ ! -s "${src_section}" || ! -s "${dst_section}" ]]; then
      verdict="FAIL"
      MISSING_SECTIONS="${MISSING_SECTIONS/NONE/}"
      MISSING_SECTIONS="${MISSING_SECTIONS:+${MISSING_SECTIONS},}${section}"
    elif ! diff -u "${src_section}" "${dst_section}" \
        > "${diff_dir}/08_diff_${section}.txt" 2>&1; then
      verdict="DIFF_FOUND"
    else
      rm -f "${diff_dir}/08_diff_${section}.txt"
    fi

    set_signature_section_result "${section}" "${verdict}"
    if [[ "${verdict}" != "PASS" ]]; then
      failures="${failures:+${failures},}${section}:${verdict}"
    fi
  done

  SIGNATURE_SECTION_FAILURES="${failures}"
  [[ -z "${SIGNATURE_SECTION_FAILURES}" ]]
}

signature_sections_all_pass() {
  [[ "${STRUCTURE_RESTORE_RESULT}" == "PASS" \
    && "${FUNCTIONS_RESTORE_RESULT}" == "PASS" \
    && "${POLICIES_RESTORE_RESULT}" == "PASS" \
    && "${RLS_RESTORE_RESULT}" == "PASS" \
    && "${ACL_RESTORE_RESULT}" == "PASS" \
    && "${DATA_RESTORE_RESULT}" == "PASS" \
    && "${LEDGER_RESTORE_RESULT}" == "PASS" \
    && "${STORAGE_RESTORE_RESULT}" == "PASS" \
    && "${OWNERSHIP_RESTORE_RESULT}" == "PASS" ]]
}

SIGNATURE_SECTION_FAILURES=""

if ! docker exec -i "${CID}" psql -U postgres -d postgres "${PSQL_DET_ARGS[@]}" \
    <tools/local-db/recovery-signature.sql \
    >"${ARTIFACTS_DIR}/08_dest_signature.txt" 2>"${ARTIFACTS_DIR}/08_dest_signature.err"; then
  set_all_signature_section_results "FAIL"
  abort "VALIDATION" "recovery-signature.sql fallo contra el destino; ver ${ARTIFACTS_DIR}/08_dest_signature.err"
fi

if ! signature_section_markers_valid "${ARTIFACTS_DIR}/08_dest_signature.txt"; then
  set_all_signature_section_results "FAIL"
  abort "VALIDATION" "firma destino corrupta: secciones o marcadores terminales invalidos"
fi

SOURCE_SIGNATURE_ARTIFACT=""
if [[ -n "${SOURCE_DB_URL}" ]]; then
  if ! "${PSQL_BIN}" "${SOURCE_DB_URL}" "${PSQL_DET_ARGS[@]}" -f tools/local-db/recovery-signature.sql \
      >"${ARTIFACTS_DIR}/08_src_signature.txt" 2>"${ARTIFACTS_DIR}/08_src_signature.err"; then
    SOURCE_SIGNATURE_RESULT="FAIL"
    set_all_signature_section_results "FAIL"
    abort "VALIDATION" \
      "la firma de la FUENTE fallo; sin ella no hay paridad que demostrar (ver ${ARTIFACTS_DIR}/08_src_signature.err)" \
      "corregir el acceso a la fuente LOCAL y repetir; no aprobar un simulacro sin comparacion"
  fi
  SOURCE_SIGNATURE_ARTIFACT="${ARTIFACTS_DIR}/08_src_signature.txt"
  SOURCE_SIGNATURE_RESULT="PASS"
elif [[ -n "${SOURCE_SIGNATURE_FILE}" ]]; then
  cp "${SOURCE_SIGNATURE_FILE}" "${ARTIFACTS_DIR}/08_src_signature.txt" \
    || abort "VALIDATION" "no se pudo persistir la firma source en artefactos"
  SOURCE_SIGNATURE_ARTIFACT="${ARTIFACTS_DIR}/08_src_signature.txt"
  SOURCE_SIGNATURE_RESULT="PASS_PERSISTED"
fi

if [[ -n "${SOURCE_SIGNATURE_ARTIFACT}" ]]; then
  if ! signature_section_markers_valid "${SOURCE_SIGNATURE_ARTIFACT}"; then
    SOURCE_SIGNATURE_RESULT="FAIL"
    set_all_signature_section_results "FAIL"
    abort "VALIDATION" "firma source corrupta: secciones o marcadores terminales invalidos"
  fi

  split_signature "${SOURCE_SIGNATURE_ARTIFACT}" "${ARTIFACTS_DIR}/08_sections_src"
  split_signature "${ARTIFACTS_DIR}/08_dest_signature.txt" "${ARTIFACTS_DIR}/08_sections_dst"

  if ! compare_signature_sections \
      "${ARTIFACTS_DIR}/08_sections_src" \
      "${ARTIFACTS_DIR}/08_sections_dst" \
      "${ARTIFACTS_DIR}"; then
    abort "VALIDATION" \
      "firma source/dest no coincide en: ${SIGNATURE_SECTION_FAILURES} (ver ${ARTIFACTS_DIR}/08_diff_<SECCION>.txt)" \
      "una seccion en DIFF_FOUND o FAIL impide aprobar y puntuar la recuperacion"
  fi

  echo "[recovery-v2] paridad OK en ocho secciones: ${SECTIONS_EXPECTED}"
else
  # Sin fuente NO hay paridad: evidencia ausente es FAIL, nunca fallback.
  set_all_signature_section_results "FAIL"
  split_signature "${ARTIFACTS_DIR}/08_dest_signature.txt" "${ARTIFACTS_DIR}/08_sections_dst"
  abort "VALIDATION" "sin firma source: las ocho comparaciones quedan en FAIL"
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
if [[ "${RECOVERY_START_EPOCH}" =~ ^[0-9]+$ ]]; then
  RTO_SECONDS="$(( T_END - RECOVERY_START_EPOCH ))"
else
  RTO_SECONDS="-1"
fi
if [[ "${SOURCE_CUTOFF_EPOCH}" =~ ^[0-9]+$ && "${DUMP_COMPLETE_EPOCH}" =~ ^[0-9]+$ ]]; then
  if (( DUMP_COMPLETE_EPOCH < SOURCE_CUTOFF_EPOCH )); then
    abort "VALIDATION" "dump completo es anterior al corte source; RPO no es adjudicable"
  fi
  RPO_SECONDS="$(( DUMP_COMPLETE_EPOCH - SOURCE_CUTOFF_EPOCH ))"
else
  RPO_SECONDS="-1"
fi

# =============================================================================
# PASO 10 · TEARDOWN COMPLETO
# =============================================================================
# (P5) Un solo camino de teardown para toda la corrida: el mismo que usan
# abort() y el manejador de senales. Idempotente, acotado al stack propio, y con
# borrado de runtime SOLO tras un stop exitoso.
teardown_stack

if [[ "${KEEP_UP}" == "yes" ]]; then
  NEXT_ACTION="clon local activo (--keep-up); detener con: node tools/local-db/lib/bootstrap.mjs --stop --project-id ${PROJECT_ID} --runtime-dir ${RUNTIME_DIR} --remove-runtime"
elif [[ "${DOCKER_STOPPED}" != "YES" ]]; then
  abort "LIFECYCLE" \
    "teardown destino fallido; RESULT=PASS queda prohibido" \
    "runtime y evidencia preservados; ver ${ARTIFACTS_DIR}/10_teardown_preserved.txt"
else
  NEXT_ACTION="revisar ${ARTIFACTS_DIR}/00_RESULT.txt y los diff por seccion (si existen)"
fi

FINAL_HEAD="$(git rev-parse HEAD 2>/dev/null || echo "${BASE_HEAD}")"
COMMIT_CREATED="NO"   # este script no realiza staging ni publicación remota; eso lo decide el operador.

# =============================================================================
# INVARIANTE DE VEREDICTO (P4) · fail-closed
#
# Ninguna de las cuatro dimensiones bloqueantes puede quedar en DIFF_FOUND,
# SOURCE_SIGNATURE_FAILED o FAIL y aun asi reportar RESULT=PASS. Los caminos que
# producen esos valores ya abortan arriba; esta guarda es la red de seguridad que
# impide que un camino futuro reintroduzca el fail-open que tenia este script.
# =============================================================================
for parity_field in "${STRUCTURE_RESTORE_RESULT}" "${FUNCTIONS_RESTORE_RESULT}" \
                    "${POLICIES_RESTORE_RESULT}" "${RLS_RESTORE_RESULT}" \
                    "${ACL_RESTORE_RESULT}" "${DATA_RESTORE_RESULT}" \
                    "${LEDGER_RESTORE_RESULT}" "${STORAGE_RESTORE_RESULT}" \
                    "${OWNERSHIP_RESTORE_RESULT}" \
                    "${DUMP_ALLOWLIST_RESULT}" "${DUMP_CONTENT_SCAN}" "${AUTH_SEED_RESULT}" \
                    "${OWNERSHIP_CHECK}" "${INTEGRITY_RESTORE_RESULT}" "${FK_INTEGRITY}" \
                    "${SOURCE_SIGNATURE_RESULT}"; do
  case "${parity_field}" in
    DIFF_FOUND|SOURCE_SIGNATURE_FAILED|FAIL)
      abort "VALIDATION" \
        "invariante de veredicto violada: ${parity_field} no puede coexistir con RESULT=PASS" \
        "revisar los artefactos de la fase correspondiente; la recuperacion no es aprobable"
      ;;
  esac
done

# (P5) Una corrida interrumpida o con integridad suspendida NUNCA es PASS.
if [[ "${INTERRUPTED}" != "NO" ]]; then
  abort "LIFECYCLE" "corrida interrumpida: no puede reportarse como PASS"
fi
if [[ "${INTEGRITY_SUSPENDED}" != "no" ]]; then
  abort "LIFECYCLE" "la integridad quedo suspendida (triggers/FK sin restituir): no puede reportarse como PASS"
fi

RESULT="PASS"

# SCORABLE=YES exige las cuatro condiciones, no tres: Docker real, bootstrap OK,
# restore OK y PARIDAD DEMOSTRADA contra una fuente. Antes bastaba con que el
# restore terminara, asi que una corrida con --dump y sin --source-db-url (sin
# ninguna comparacion) se declaraba scorable. No comparar no es coincidir.
if [[ "${DOCKER_USED}" == "YES" \
   && "${DOCKER_STOPPED}" == "YES" \
   && "${INTERRUPTED}" == "NO" \
   && "${BOOTSTRAP_RESULT}" == "PASS" \
   && "${DUMP_ALLOWLIST_RESULT}" == "PASS" \
   && "${DUMP_CONTENT_SCAN}" == "PASS" \
   && "${AUTH_SEED_RESULT}" == "PASS" \
   && "${OWNERSHIP_CHECK}" == "PASS" \
   && "${SITE_CONFIG_BASELINE_VALIDATED}" == "PASS" \
   && "${SITE_CONFIG_TRANSFERRED}" == "YES" \
   && "${INTEGRITY_RESTORE_RESULT}" == "PASS" \
   && "${FK_INTEGRITY}" == "PASS" \
   && "${RESTORE_RESULT}" == "PASS" ]] \
   && signature_sections_all_pass; then
  if [[ "${SOURCE_SIGNATURE_RESULT}" == "PASS" || "${SOURCE_SIGNATURE_RESULT}" == "PASS_PERSISTED" ]] \
     && (( RPO_SECONDS >= 0 && RTO_SECONDS >= 0 )); then
    SCORABLE="YES"
  else
    SCORABLE="NO"
  fi
else
  SCORABLE="NO"
fi

trap - ERR INT TERM
write_report
