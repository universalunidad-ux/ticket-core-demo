#!/usr/bin/env bash
# TC-U15D-ASSIGNMENT-RUNTIME-01
# run-u15d-runtime.sh — Punto de entrada HOST (macOS + Docker + Supabase CLI)
# para validar el runtime de public.manage_ticket_assignment(...).
#
# Fail-closed: cualquier precondición no cumplida aborta ANTES de tocar
# Docker. No ejecuta Supabase remoto. No aplica SQL remoto. No modifica la
# RPC. No conecta reglas_asignacion. No hace commit/push/deploy.
#
# NOTA DE ORQUESTACIÓN (carril Docker compartido):
#   Este script NO debe ejecutarse mientras otra unidad tenga el carril
#   Docker/Supabase local en uso (ver DOCKER_LANE_OWNER / DOCKER_QUEUE_POSITION
#   coordinado fuera de este repo). Verificar disponibilidad del carril antes
#   de invocar este script. El script en sí no gestiona esa cola: solo prueba
#   que Docker/Supabase están libres y responden en ESTE host al momento de
#   ejecutarse.
#
# Uso:
#   tools/local-db/run-u15d-runtime.sh              # ejecución completa
#   tools/local-db/run-u15d-runtime.sh --dry-run     # sólo prechecks
#   tools/local-db/run-u15d-runtime.sh --keep-up      # no detener supabase al final
#
# Fases:
#   1. PRECHECK_HOST      — macOS, Node >=22, Docker, Supabase CLI.
#   2. PRECHECK_REPO      — worktree git, rama test/*.
#   3. PRECHECK_REMOTE    — rechaza env/target remotos y proyecto ligado.
#   4. SCAFFOLD           — workdir Supabase efímero (.runtime/) con
#                            migraciones enlazadas (sin duplicar).
#   5. SUPABASE_START     — `supabase start`; verifica DB URL local.
#   6. RUNTIME_SUITE       — supabase/tests/u15d_assignment_runtime.sql
#   7. CONCURRENCY_SUITE   — supabase/tests/u15d_assignment_concurrency.sql
#                            (setup -> race a/b en paralelo -> verify -> teardown)
#   8. REPORT              — escribe tools/local-db/.artifacts/<ts>/00_FINAL_RESULT.txt
#   9. SUPABASE_STOP        — `supabase stop` (salvo --keep-up)

set -Eeuo pipefail
IFS=$'\n\t'

UNIT="TC-U15D-ASSIGNMENT-RUNTIME-01"
DRY_RUN=0
KEEP_UP=0
for arg in "$@"; do
  case "${arg}" in
    --dry-run) DRY_RUN=1 ;;
    --keep-up) KEEP_UP=1 ;;
    *) ;;
  esac
done

# --- Resolver raíz del repo/worktree (dir de este script -> ../..) -----------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." >/dev/null 2>&1 && pwd)"
cd "${REPO_ROOT}"

TS="$(date -u +%Y%m%dT%H%M%SZ)"
PROJECT_ID="tc-u15d-runtime-$(date -u +%Y%m%d%H%M%S)"
ARTIFACT_DIR="${REPO_ROOT}/tools/local-db/.artifacts/u15d-${TS}"
ARTIFACT_LABEL="tools/local-db/.artifacts/u15d-${TS}"
RUNTIME_DIR="${REPO_ROOT}/tools/local-db/.runtime-u15d"
DOCKER_USED="NO"
DOCKER_STOPPED="NOT_STARTED"
STACK_OWNED=0
STOP_ATTEMPTED=0
STOP_SUCCEEDED=0
FINALIZED=0
PID_A=""
PID_B=""

ASSIGN_RESULT="FAIL"
REASSIGN_RESULT="FAIL"
UNASSIGN_RESULT="FAIL"
IDEMPOTENCY_RESULT="FAIL"
RLS_RESULT="FAIL"
ROLE_ESCALATION_RESULT="FAIL"
CONCURRENCY_RESULT="FAIL"
AUDIT_EXACTLY_ONCE="FAIL"
RUNTIME_PASS_COUNT=0
SETUP_RESULT="NOT_RUN"
RACE_A_RESULT="NOT_RUN"
RACE_B_RESULT="NOT_RUN"
VERIFY_RESULT="NOT_RUN"
TEARDOWN_RESULT="NOT_RUN"
STOP_REASON_CODE="OK"
FAILED_PHASE="-"
STOP_REASON_DETAIL="-"
SCRIPT_EXIT_CODE=0

# --- Salida estructurada mínima de parada temprana ---------------------------
fail() {
  # $1=STOP_REASON_CODE  $2=FAILED_PHASE  $3=detalle  $4=exit_code
  local code="$1" phase="$2" detail="$3" exit_code="${4:-40}"
  cat <<EOF

===== 00_FINAL_RESULT (u15d runtime) =====
RESULT=FAIL
SCRIPT_EXIT_CODE=${exit_code}
UNIT=${UNIT}
FAILED_PHASE=${phase}
STOP_REASON_CODE=${code}
STOP_REASON_DETAIL=${detail}
DOCKER_USED=${DOCKER_USED}
DOCKER_STOPPED=${DOCKER_STOPPED}
SAFE_RECOVERY_ACTION=corregir precondición y reintentar (solo local, nunca remoto)
DO_NOT_RUN=push | PR | merge | deploy | supabase remoto | psql remoto
EOF
  exit "${exit_code}"
}

set_stop_reason() {
  # Conserva la primera causa funcional; un fallo de stop la reemplaza porque
  # deja la higiene del host sin cerrar.
  local code="$1" phase="$2" detail="$3" exit_code="$4"
  if [[ "${STOP_REASON_CODE}" == "OK" ]]; then
    STOP_REASON_CODE="${code}"
    FAILED_PHASE="${phase}"
    STOP_REASON_DETAIL="${detail}"
    SCRIPT_EXIT_CODE="${exit_code}"
  fi
}

runtime_has_marker() {
  grep -Eq "$1" "${RUNTIME_LOG}"
}

terminate_race_processes() {
  local pid
  for pid in "${PID_A:-}" "${PID_B:-}"; do
    if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
      kill -TERM "${pid}" 2>/dev/null || :
    fi
  done
}

stop_supabase() {
  # $1=force (1 ignora --keep-up en ERR/INT/TERM/fallo funcional)
  local force="${1:-0}"

  if [[ "${STOP_ATTEMPTED}" -eq 1 ]]; then
    [[ "${STOP_SUCCEEDED}" -eq 1 ]]
    return
  fi
  if [[ "${STACK_OWNED}" -eq 0 ]]; then
    DOCKER_STOPPED="NOT_STARTED"
    STOP_ATTEMPTED=1
    STOP_SUCCEEDED=1
    return 0
  fi
  if [[ "${KEEP_UP}" -eq 1 && "${force}" -eq 0 ]]; then
    DOCKER_STOPPED="NO_KEEP_UP"
    STOP_ATTEMPTED=1
    STOP_SUCCEEDED=1
    echo "[u15d] --keep-up: runtime y stack propio preservados"
    return 0
  fi

  STOP_ATTEMPTED=1
  if [[ ! -d "${RUNTIME_DIR}" ]]; then
    DOCKER_STOPPED="FAILED_RUNTIME_MISSING"
    return 1
  fi
  if (
    cd "${RUNTIME_DIR}" &&
      supabase stop >>"${ARTIFACT_DIR}/supabase-start.log" 2>&1
  ); then
    DOCKER_STOPPED="YES"
    STOP_SUCCEEDED=1
    STACK_OWNED=0
    return 0
  fi

  DOCKER_STOPPED="FAILED"
  return 1
}

remove_runtime_after_stop() {
  [[ "${DOCKER_STOPPED}" == "YES" ]] || return 1
  [[ "${RUNTIME_DIR}" == "${REPO_ROOT}/tools/local-db/.runtime-u15d" ]] ||
    return 1
  rm -rf "${RUNTIME_DIR}"
}

write_final_report() {
  local result="$1"
  local base_head
  base_head="$(git rev-parse HEAD)"
  cat >"${ARTIFACT_DIR}/00_FINAL_RESULT.txt" <<EOF
RESULT=${result}
SCRIPT_EXIT_CODE=${SCRIPT_EXIT_CODE}
UNIT=${UNIT}
BASE_HEAD=${base_head}
FINAL_HEAD=${base_head}
FAILED_PHASE=${FAILED_PHASE}
STOP_REASON_CODE=${STOP_REASON_CODE}
STOP_REASON_DETAIL=${STOP_REASON_DETAIL}
ASSIGN_RESULT=${ASSIGN_RESULT}
REASSIGN_RESULT=${REASSIGN_RESULT}
UNASSIGN_RESULT=${UNASSIGN_RESULT}
IDEMPOTENCY_RESULT=${IDEMPOTENCY_RESULT}
RLS_RESULT=${RLS_RESULT}
ROLE_ESCALATION_RESULT=${ROLE_ESCALATION_RESULT}
RUNTIME_PASS_COUNT=${RUNTIME_PASS_COUNT}
SETUP_RESULT=${SETUP_RESULT}
RACE_A_RESULT=${RACE_A_RESULT}
RACE_B_RESULT=${RACE_B_RESULT}
VERIFY_RESULT=${VERIFY_RESULT}
TEARDOWN_RESULT=${TEARDOWN_RESULT}
CONCURRENCY_RESULT=${CONCURRENCY_RESULT}
AUDIT_EXACTLY_ONCE=${AUDIT_EXACTLY_ONCE}
DOCKER_USED=${DOCKER_USED}
DOCKER_STOPPED=${DOCKER_STOPPED}
DO_NOT_RUN=push | PR | merge | deploy | supabase remoto | psql remoto
EOF
}

finish() {
  # $1=PASS|FAIL. El reporte definitivo sólo se escribe después de decidir y,
  # salvo --keep-up en PASS, completar el stop del stack propio.
  local result="$1"
  local force_stop=0
  trap - ERR INT TERM EXIT
  set +e

  terminate_race_processes
  if [[ "${result}" != "PASS" ]]; then
    force_stop=1
  fi
  if ! stop_supabase "${force_stop}"; then
    result="FAIL"
    STOP_REASON_CODE="E_SUPABASE_STOP_FAILED"
    FAILED_PHASE="SUPABASE_STOP"
    STOP_REASON_DETAIL="stop del stack propio falló; runtime y evidencia preservados"
    SCRIPT_EXIT_CODE=94
  elif [[ "${DOCKER_STOPPED}" == "YES" ]]; then
    if ! remove_runtime_after_stop; then
      result="FAIL"
      STOP_REASON_CODE="E_RUNTIME_DELETE_FAILED"
      FAILED_PHASE="SUPABASE_STOP"
      STOP_REASON_DETAIL="stop completado pero no se pudo eliminar el runtime propio"
      SCRIPT_EXIT_CODE=95
    fi
  fi

  write_final_report "${result}"
  FINALIZED=1
  echo "[u15d] reporte definitivo -> ${ARTIFACT_LABEL}/00_FINAL_RESULT.txt"
  cat "${ARTIFACT_DIR}/00_FINAL_RESULT.txt"
  if [[ "${result}" == "PASS" ]]; then
    exit 0
  fi
  [[ "${SCRIPT_EXIT_CODE}" -ne 0 ]] || SCRIPT_EXIT_CODE=99
  exit "${SCRIPT_EXIT_CODE}"
}

handle_error() {
  local exit_code="$1" line="$2"
  set_stop_reason "E_UNEXPECTED_HARNESS_ERROR" "HARNESS" \
    "error inesperado rc=${exit_code} line=${line}" 98
  finish "FAIL"
}

handle_signal() {
  local signal_name="$1" exit_code="$2"
  set_stop_reason "E_SIGNAL_${signal_name}" "HARNESS_SIGNAL" \
    "señal ${signal_name} recibida" "${exit_code}"
  finish "FAIL"
}

handle_exit() {
  local exit_code="$1"
  if [[ "${FINALIZED}" -eq 0 ]]; then
    set_stop_reason "E_UNFINALIZED_EXIT" "HARNESS" \
      "salida sin cierre definitivo rc=${exit_code}" 97
    finish "FAIL"
  fi
}

# --- 1) macOS host -----------------------------------------------------------
if [[ "$(uname -s)" != "Darwin" ]]; then
  fail "E_HOST_NOT_MACOS" "PRECHECK_HOST" "uname=$(uname -s) (se requiere Darwin/macOS)" 10
fi

# --- 2) Node >=22 -------------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  fail "E_NODE_VERSION" "PRECHECK_HOST" "node no encontrado en PATH" 11
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [[ "${NODE_MAJOR}" -lt 22 ]]; then
  fail "E_NODE_VERSION" "PRECHECK_HOST" "node major=${NODE_MAJOR} (se requiere >=22)" 11
fi

# --- 3) Docker disponible y corriendo ----------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  fail "E_DOCKER_MISSING" "PRECHECK_HOST" "docker no encontrado en PATH" 12
fi
if ! docker info >/dev/null 2>&1; then
  fail "E_DOCKER_NOT_RUNNING" "PRECHECK_HOST" "docker daemon no responde (abrir Docker Desktop)" 13
fi

# --- 4) Supabase CLI y psql ---------------------------------------------------
if ! command -v supabase >/dev/null 2>&1; then
  fail "E_SUPABASE_CLI_MISSING" "PRECHECK_HOST" "supabase CLI no encontrado (brew install supabase/tap/supabase)" 14
fi
if ! command -v psql >/dev/null 2>&1; then
  fail "E_PSQL_MISSING" "PRECHECK_HOST" "psql no encontrado en PATH" 18
fi

# --- 5) Worktree/branch -------------------------------------------------------
if [[ "$(git rev-parse --is-inside-work-tree 2>/dev/null || echo false)" != "true" ]]; then
  fail "E_NOT_GIT_WORKTREE" "PRECHECK_REPO" "no es un worktree git" 15
fi
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "${BRANCH}" != test/* ]]; then
  fail "E_WRONG_BRANCH" "PRECHECK_REPO" "rama=${BRANCH} (se espera test/*)" 16
fi

# --- 6) Guarda anti-remoto (env) ---------------------------------------------
for VAR in DATABASE_URL SUPABASE_DB_URL SUPABASE_URL POSTGRES_URL SUPABASE_HOST PGHOST; do
  VAL="${!VAR:-}"
  [[ -z "${VAL}" ]] && continue
  case "${VAL}" in
    *supabase.co*|*supabase.com*|*supabase.in*|*amazonaws.com*|*neon.tech*|*railway.app*|*fly.dev*|*render.com*)
      fail "E_REMOTE_ENV_PRESENT" "PRECHECK_REMOTE_GUARD" "${VAR} apunta a host remoto" 51 ;;
    *127.0.0.1*|*localhost*|*::1*|*0.0.0.0*|*host.docker.internal*)
      : ;;  # local explícito permitido
    *)
      fail "E_REMOTE_ENV_PRESENT" "PRECHECK_REMOTE_GUARD" "${VAR} no es local reconocido" 51 ;;
  esac
done
if [[ -n "${SUPABASE_ACCESS_TOKEN:-}" || -n "${SUPABASE_PROJECT_REF:-}" ]]; then
  fail "E_SUPABASE_LINKED_PROJECT" "PRECHECK_REMOTE_GUARD" "token/project ref remoto presente en el entorno" 52
fi

echo "[u15d] host OK (macOS, node>=22, docker, supabase, psql, branch=${BRANCH})"

if [[ "${DRY_RUN}" -eq 1 ]]; then
  cat <<EOF

===== 00_FINAL_RESULT (u15d runtime, dry-run) =====
RESULT=PASS
UNIT=${UNIT}
FAILED_PHASE=-
STOP_REASON_CODE=OK
DOCKER_USED=NO
DOCKER_STOPPED=NO
NEXT_ACTION=ejecutar sin --dry-run cuando el carril Docker compartido esté libre
EOF
  exit 0
fi

mkdir -p "${ARTIFACT_DIR}"

# --- 7) SCAFFOLD: workdir Supabase efímero (enlaza migraciones reales) -------
# Un runtime preexistente puede ser evidencia de un stop fallido o pertenecer
# a otra ejecución. Se preserva fail-closed; este runner sólo elimina la ruta
# que creó él mismo y únicamente mediante remove_runtime_after_stop().
[[ "${RUNTIME_DIR}" == "${REPO_ROOT}/tools/local-db/.runtime-u15d" ]] ||
  fail "E_RUNTIME_PATH_INVALID" "SCAFFOLD" "runtime fuera de ruta autorizada" 70
if [[ -e "${RUNTIME_DIR}" ]]; then
  fail "E_RUNTIME_ALREADY_EXISTS" "SCAFFOLD" \
    "runtime preexistente preservado; verificar ownership antes de reintentar" 72
fi
mkdir -p "${RUNTIME_DIR}/supabase/migrations"
for f in supabase/migrations/*.sql; do
  ln -s "${REPO_ROOT}/${f}" "${RUNTIME_DIR}/supabase/migrations/$(basename "${f}")"
done
cat >"${RUNTIME_DIR}/supabase/config.toml" <<EOF
project_id = "${PROJECT_ID}"
[db]
port = 54329
EOF

trap 'handle_error $? ${LINENO}' ERR
trap 'handle_signal INT 130' INT
trap 'handle_signal TERM 143' TERM
trap 'handle_exit $?' EXIT

# --- 8) SUPABASE_START --------------------------------------------------------
# Desde la invocación de start, este namespace efímero es propiedad del
# harness, incluso si start falla a mitad de camino; cualquier cierre forzado
# intentará detener únicamente este project_id desde este runtime.
DOCKER_USED="YES"
STACK_OWNED=1
if ! (
  cd "${RUNTIME_DIR}" &&
    supabase start >"${ARTIFACT_DIR}/supabase-start.log" 2>&1
); then
  set_stop_reason "E_SUPABASE_START_FAILED" "SUPABASE_START" \
    "ver ${ARTIFACT_LABEL}/supabase-start.log" 71
  finish "FAIL"
fi

DB_URL="$(
  cd "${RUNTIME_DIR}" &&
    supabase status -o json |
      node -e "process.stdin.on('data',d=>{const j=JSON.parse(d);console.log(j.DB_URL||j.db_url)})"
)"
case "${DB_URL}" in
  *127.0.0.1*|*localhost*) : ;;
  *)
    set_stop_reason "E_REMOTE_TARGET_DETECTED" "SUPABASE_START" \
      "DB_URL no es local" 50
    finish "FAIL"
    ;;
esac
echo "[u15d] supabase local arriba (DB_URL local confirmada)"

# --- 9) RUNTIME_SUITE ---------------------------------------------------------
RUNTIME_LOG="${ARTIFACT_DIR}/u15d_assignment_runtime.log"
RUNTIME_RC=0
psql "${DB_URL}" -v ON_ERROR_STOP=1 \
  -f "${REPO_ROOT}/supabase/tests/u15d_assignment_runtime.sql" \
  >"${RUNTIME_LOG}" 2>&1 || RUNTIME_RC=$?

# `psql -f` antepone `psql:ruta:línea:` a los NOTICE. El patrón busca el
# marcador en cualquier posición de la línea, sin depender del prefijo.
RUNTIME_PASS_COUNT="$(grep -Ec 'NOTICE:[[:space:]]+PASS' "${RUNTIME_LOG}" || :)"
printf '%s\n' "${RUNTIME_PASS_COUNT}" \
  >"${ARTIFACT_DIR}/runtime-pass-count.txt"

if [[ "${RUNTIME_RC}" -eq 0 ]] &&
  runtime_has_marker 'PASS: asignación inicial \(admin\)'; then
  ASSIGN_RESULT="PASS"
fi
if [[ "${RUNTIME_RC}" -eq 0 ]] &&
  runtime_has_marker 'PASS: reasignación \(A -> B\)'; then
  REASSIGN_RESULT="PASS"
fi
if [[ "${RUNTIME_RC}" -eq 0 ]] &&
  runtime_has_marker 'PASS: desasignación \(asignado_a = null\)'; then
  UNASSIGN_RESULT="PASS"
fi
if [[ "${RUNTIME_RC}" -eq 0 ]] &&
  runtime_has_marker 'PASS: replay idempotente no duplica' &&
  runtime_has_marker 'PASS: misma key con payload distinto' &&
  runtime_has_marker 'PASS: expected_fecha_actualizacion obsoleta' &&
  runtime_has_marker 'PASS \(paso 2/2\): rollback sin filas parciales'; then
  IDEMPOTENCY_RESULT="PASS"
fi
if [[ "${RUNTIME_RC}" -eq 0 ]] &&
  runtime_has_marker 'PASS: supervisor no autorizado' &&
  runtime_has_marker 'PASS: soporte no autorizado' &&
  runtime_has_marker 'PASS: anon sin privilegio' &&
  runtime_has_marker 'PASS: usuario autenticado sin perfil'; then
  RLS_RESULT="PASS"
fi
if [[ "${RUNTIME_RC}" -eq 0 ]] &&
  runtime_has_marker 'PASS: escalada de rol bloqueada'; then
  ROLE_ESCALATION_RESULT="PASS"
fi

if [[ "${RUNTIME_RC}" -ne 0 ||
  "${RUNTIME_PASS_COUNT}" -lt 14 ||
  "${ASSIGN_RESULT}" != "PASS" ||
  "${REASSIGN_RESULT}" != "PASS" ||
  "${UNASSIGN_RESULT}" != "PASS" ||
  "${IDEMPOTENCY_RESULT}" != "PASS" ||
  "${RLS_RESULT}" != "PASS" ||
  "${ROLE_ESCALATION_RESULT}" != "PASS" ]]; then
  set_stop_reason "E_U15D_RUNTIME_MARKERS_MISSING" "RUNTIME_SUITE" \
    "rc=${RUNTIME_RC}; pass_count=${RUNTIME_PASS_COUNT}; faltan marcadores mínimos" 84
fi
echo "[u15d] runtime suite -> ver ${ARTIFACT_LABEL}/u15d_assignment_runtime.log"

# --- 10) CONCURRENCY_SUITE (setup -> race a/b -> verify -> teardown) ---------
SETUP_OUT="${ARTIFACT_DIR}/concurrency-setup.out"
RACE_A_OUT="${ARTIFACT_DIR}/race-a.out"
RACE_B_OUT="${ARTIFACT_DIR}/race-b.out"
RACE_CODES="${ARTIFACT_DIR}/race-exit-codes.txt"
VERIFY_OUT="${ARTIFACT_DIR}/concurrency-verify.out"
TEARDOWN_OUT="${ARTIFACT_DIR}/concurrency-teardown.out"
CONC_LOG="${ARTIFACT_DIR}/u15d_assignment_concurrency.log"
CONC_SQL="${REPO_ROOT}/supabase/tests/u15d_assignment_concurrency.sql"
SETUP_RC=0
RC_A=125
RC_B=125
VERIFY_RC=125
TEARDOWN_RC=0
SHARED_EXPECTED=""
RACE_SUCCESS_COUNT=0

psql "${DB_URL}" -v ON_ERROR_STOP=1 -v phase=setup \
  -f "${CONC_SQL}" >"${SETUP_OUT}" 2>&1 || SETUP_RC=$?
if [[ -s "${SETUP_OUT}" ]]; then
  SHARED_EXPECTED="$(
    sed -n \
      "s/.*shared_expected=[[:space:]]*'\\(.*\\)'[[:space:]]*$/\\1/p" \
      "${SETUP_OUT}" |
      tail -1
  )"
fi
if [[ "${SETUP_RC}" -eq 0 &&
  -n "${SHARED_EXPECTED}" ]] &&
  grep -q 'SETUP_OK shared_expected=' "${SETUP_OUT}"; then
  SETUP_RESULT="PASS"
else
  SETUP_RESULT="FAIL"
  if [[ ! -s "${SETUP_OUT}" ]]; then
    set_stop_reason "E_U15D_SETUP_ARTIFACT_MISSING" "CONCURRENCY_SETUP" \
      "concurrency-setup.out ausente o vacío" 86
  else
    set_stop_reason "E_U15D_SETUP_INCOMPLETE" "CONCURRENCY_SETUP" \
      "setup rc=${SETUP_RC}; shared_expected o SETUP_OK ausente" 87
  fi
fi

if [[ "${SETUP_RESULT}" == "PASS" ]]; then
  : >"${RACE_CODES}"

  psql "${DB_URL}" -v ON_ERROR_STOP=1 -v phase=race -v side=a \
    -v shared_expected="${SHARED_EXPECTED}" -f "${CONC_SQL}" \
    >"${RACE_A_OUT}" 2>&1 &
  PID_A=$!
  psql "${DB_URL}" -v ON_ERROR_STOP=1 -v phase=race -v side=b \
    -v shared_expected="${SHARED_EXPECTED}" -f "${CONC_SQL}" \
    >"${RACE_B_OUT}" 2>&1 &
  PID_B=$!

  RC_A=0
  RC_B=0
  wait "${PID_A}" || RC_A=$?
  PID_A=""
  wait "${PID_B}" || RC_B=$?
  PID_B=""
  printf 'race_a_exit=%s\nrace_b_exit=%s\n' "${RC_A}" "${RC_B}" \
    >"${RACE_CODES}"

  if [[ -s "${RACE_A_OUT}" && -s "${RACE_B_OUT}" &&
    "$(grep -Ec '^race_[ab]_exit=[0-9]+$' "${RACE_CODES}" || :)" -eq 2 ]]; then
    if [[ "${RC_A}" -eq 0 ]] &&
      grep -q 'RACE_SIDE_A_DONE' "${RACE_A_OUT}"; then
      RACE_A_RESULT="PASS"
    else
      RACE_A_RESULT="FAIL"
    fi
    if [[ "${RC_B}" -ne 0 ]] &&
      grep -Eq '40001|TC_ASSIGNMENT_VERSION_CONFLICT' "${RACE_B_OUT}" &&
      ! grep -q 'admin_or_edge_required' "${RACE_B_OUT}" &&
      ! grep -q 'RACE_SIDE_B_UNEXPECTED_SUCCESS' "${RACE_B_OUT}"; then
      RACE_B_RESULT="PASS"
    else
      RACE_B_RESULT="FAIL"
    fi
  else
    [[ -s "${RACE_A_OUT}" ]] || set_stop_reason \
      "E_U15D_RACE_A_ARTIFACT_MISSING" "CONCURRENCY_RACE" \
      "race-a.out ausente o vacío" 88
    [[ -s "${RACE_B_OUT}" ]] || set_stop_reason \
      "E_U15D_RACE_B_ARTIFACT_MISSING" "CONCURRENCY_RACE" \
      "race-b.out ausente o vacío" 89
    [[ -s "${RACE_CODES}" ]] || set_stop_reason \
      "E_U15D_RACE_CODES_ARTIFACT_MISSING" "CONCURRENCY_RACE" \
      "race-exit-codes.txt ausente o vacío" 90
  fi

  [[ "${RC_A}" -eq 0 ]] && RACE_SUCCESS_COUNT=$((RACE_SUCCESS_COUNT + 1))
  [[ "${RC_B}" -eq 0 ]] && RACE_SUCCESS_COUNT=$((RACE_SUCCESS_COUNT + 1))
  if [[ "${RACE_SUCCESS_COUNT}" -ne 1 ||
    "${RACE_A_RESULT}" != "PASS" ||
    "${RACE_B_RESULT}" != "PASS" ]]; then
    set_stop_reason "E_U15D_UNIQUE_WINNER_MISSING" "CONCURRENCY_RACE" \
      "se exige side=a ganador, side=b 40001 y exactamente un exit 0" 91
  fi

  psql "${DB_URL}" -v ON_ERROR_STOP=1 -v phase=verify \
    -f "${CONC_SQL}" >"${VERIFY_OUT}" 2>&1 || VERIFY_RC=$?
  if [[ "${VERIFY_RC}" -eq 0 && -s "${VERIFY_OUT}" ]] &&
    grep -q 'PASS: dos actores admin concurrentes' "${VERIFY_OUT}"; then
    VERIFY_RESULT="PASS"
  else
    VERIFY_RESULT="FAIL"
    if [[ ! -s "${VERIFY_OUT}" ]]; then
      set_stop_reason "E_U15D_VERIFY_ARTIFACT_MISSING" "CONCURRENCY_VERIFY" \
        "concurrency-verify.out ausente o vacío" 92
    else
      set_stop_reason "E_U15D_AUDIT_MARKER_MISSING" "CONCURRENCY_VERIFY" \
        "verify rc=${VERIFY_RC}; marcador exactly-once ausente" 93
    fi
  fi
fi

# Teardown se intenta siempre después de setup, incluso si setup o la carrera
# fallaron. Su salida es un artefacto obligatorio e independiente.
psql "${DB_URL}" -v ON_ERROR_STOP=1 -v phase=teardown \
  -f "${CONC_SQL}" >"${TEARDOWN_OUT}" 2>&1 || TEARDOWN_RC=$?
if [[ "${TEARDOWN_RC}" -eq 0 && -s "${TEARDOWN_OUT}" ]] &&
  grep -q 'TEARDOWN_OK' "${TEARDOWN_OUT}"; then
  TEARDOWN_RESULT="PASS"
else
  TEARDOWN_RESULT="FAIL"
  if [[ ! -s "${TEARDOWN_OUT}" ]]; then
    set_stop_reason "E_U15D_TEARDOWN_ARTIFACT_MISSING" "CONCURRENCY_TEARDOWN" \
      "concurrency-teardown.out ausente o vacío" 96
  else
    set_stop_reason "E_U15D_TEARDOWN_FAILED" "CONCURRENCY_TEARDOWN" \
      "teardown rc=${TEARDOWN_RC}; TEARDOWN_OK ausente" 97
  fi
fi

{
  printf 'setup=%s\n' "${SETUP_RESULT}"
  printf 'race_a=%s rc=%s\n' "${RACE_A_RESULT}" "${RC_A}"
  printf 'race_b=%s rc=%s\n' "${RACE_B_RESULT}" "${RC_B}"
  printf 'race_success_count=%s\n' "${RACE_SUCCESS_COUNT}"
  printf 'verify=%s rc=%s\n' "${VERIFY_RESULT}" "${VERIFY_RC}"
  printf 'teardown=%s rc=%s\n' "${TEARDOWN_RESULT}" "${TEARDOWN_RC}"
} >"${CONC_LOG}"

if [[ "${SETUP_RESULT}" == "PASS" &&
  "${RACE_A_RESULT}" == "PASS" &&
  "${RACE_B_RESULT}" == "PASS" &&
  "${RACE_SUCCESS_COUNT}" -eq 1 &&
  "${VERIFY_RESULT}" == "PASS" &&
  "${TEARDOWN_RESULT}" == "PASS" ]]; then
  CONCURRENCY_RESULT="PASS"
  AUDIT_EXACTLY_ONCE="PASS"
fi
echo "[u15d] concurrency suite -> ver ${ARTIFACT_LABEL}/u15d_assignment_concurrency.log"

# --- 11) STOP -> DELETE RUNTIME -> REPORT ------------------------------------
if [[ "${ASSIGN_RESULT}" == "PASS" &&
  "${REASSIGN_RESULT}" == "PASS" &&
  "${UNASSIGN_RESULT}" == "PASS" &&
  "${IDEMPOTENCY_RESULT}" == "PASS" &&
  "${RLS_RESULT}" == "PASS" &&
  "${ROLE_ESCALATION_RESULT}" == "PASS" &&
  "${CONCURRENCY_RESULT}" == "PASS" &&
  "${AUDIT_EXACTLY_ONCE}" == "PASS" &&
  "${STOP_REASON_CODE}" == "OK" ]]; then
  finish "PASS"
fi
finish "FAIL"
