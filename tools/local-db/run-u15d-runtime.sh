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
ARTIFACT_DIR="tools/local-db/.artifacts/u15d-${TS}"
DOCKER_USED="NO"
DOCKER_STOPPED="NO"

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
RUNTIME_DIR="tools/local-db/.runtime-u15d"
rm -rf "${RUNTIME_DIR}"
mkdir -p "${RUNTIME_DIR}/supabase/migrations"
for f in supabase/migrations/*.sql; do
  ln -s "${REPO_ROOT}/${f}" "${RUNTIME_DIR}/supabase/migrations/$(basename "${f}")"
done
cat > "${RUNTIME_DIR}/supabase/config.toml" <<EOF
project_id = "tc-u15d-runtime"
[db]
port = 54329
EOF

# --- 8) SUPABASE_START --------------------------------------------------------
DOCKER_USED="YES"
pushd "${RUNTIME_DIR}" >/dev/null
if ! supabase start >"${REPO_ROOT}/${ARTIFACT_DIR}/supabase-start.log" 2>&1; then
  popd >/dev/null
  fail "E_SUPABASE_START_FAILED" "SUPABASE_START" "ver ${ARTIFACT_DIR}/supabase-start.log" 71
fi
DB_URL="$(supabase status -o json | node -e "process.stdin.on('data',d=>{const j=JSON.parse(d);console.log(j.DB_URL||j.db_url)})")"
popd >/dev/null

case "${DB_URL}" in
  *127.0.0.1*|*localhost*) : ;;
  *) fail "E_REMOTE_TARGET_DETECTED" "SUPABASE_START" "DB_URL no es local: ${DB_URL}" 50 ;;
esac
echo "[u15d] supabase local arriba (DB_URL local confirmada)"

stop_supabase() {
  if [[ "${KEEP_UP}" -eq 1 ]]; then
    echo "[u15d] --keep-up: no se detiene supabase local"
    return
  fi
  pushd "${RUNTIME_DIR}" >/dev/null
  supabase stop >>"${REPO_ROOT}/${ARTIFACT_DIR}/supabase-start.log" 2>&1 || true
  popd >/dev/null
  DOCKER_STOPPED="YES"
}
trap stop_supabase EXIT

# --- 9) RUNTIME_SUITE ---------------------------------------------------------
RUNTIME_LOG="${ARTIFACT_DIR}/u15d_assignment_runtime.log"
if psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/tests/u15d_assignment_runtime.sql >"${RUNTIME_LOG}" 2>&1; then
  ASSIGN_RESULT="PASS"; REASSIGN_RESULT="PASS"; UNASSIGN_RESULT="PASS"
  IDEMPOTENCY_RESULT="PASS"; RLS_RESULT="PASS"; ROLE_ESCALATION_RESULT="PASS"
else
  ASSIGN_RESULT="FAIL"; REASSIGN_RESULT="FAIL"; UNASSIGN_RESULT="FAIL"
  IDEMPOTENCY_RESULT="FAIL"; RLS_RESULT="FAIL"; ROLE_ESCALATION_RESULT="FAIL"
fi
grep -c '^NOTICE:  PASS' "${RUNTIME_LOG}" > "${ARTIFACT_DIR}/runtime-pass-count.txt" || true
echo "[u15d] runtime suite -> ver ${RUNTIME_LOG}"

# --- 10) CONCURRENCY_SUITE (setup -> race a/b en paralelo -> verify -> teardown)
CONC_LOG="${ARTIFACT_DIR}/u15d_assignment_concurrency.log"

set +e
(
  psql "${DB_URL}" \
    -v ON_ERROR_STOP=1 \
    -v phase=setup \
    -f supabase/tests/u15d_assignment_concurrency.sql \
    -o "${ARTIFACT_DIR}/concurrency-setup.out"

  SHARED_EXPECTED="$(
    sed -n \
      "s/.*shared_expected=[[:space:]]*'\\(.*\\)'[[:space:]]*$/\\1/p" \
      "${ARTIFACT_DIR}/concurrency-setup.out" |
      tail -1
  )"

  if [[ -z "${SHARED_EXPECTED}" ]]; then
    echo "shared_expected no fue emitido por setup" >&2
    exit 86
  fi

  : >"${ARTIFACT_DIR}/race-exit-codes.txt"

  psql "${DB_URL}" \
    -v ON_ERROR_STOP=1 \
    -v phase=race \
    -v side=a \
    -v shared_expected="${SHARED_EXPECTED}" \
    -f supabase/tests/u15d_assignment_concurrency.sql \
    >"${ARTIFACT_DIR}/race-a.out" 2>&1 &
  PID_A=$!

  psql "${DB_URL}" \
    -v ON_ERROR_STOP=1 \
    -v phase=race \
    -v side=b \
    -v shared_expected="${SHARED_EXPECTED}" \
    -f supabase/tests/u15d_assignment_concurrency.sql \
    >"${ARTIFACT_DIR}/race-b.out" 2>&1 &
  PID_B=$!

  RC_A=0
  RC_B=0

  wait "${PID_A}" || RC_A=$?
  wait "${PID_B}" || RC_B=$?

  echo "race_a_exit=${RC_A}" \
    >>"${ARTIFACT_DIR}/race-exit-codes.txt"
  echo "race_b_exit=${RC_B}" \
    >>"${ARTIFACT_DIR}/race-exit-codes.txt"

  VERIFY_RC=0
  TEARDOWN_RC=0

  psql "${DB_URL}" \
    -v ON_ERROR_STOP=1 \
    -v phase=verify \
    -f supabase/tests/u15d_assignment_concurrency.sql ||
    VERIFY_RC=$?

  psql "${DB_URL}" \
    -v ON_ERROR_STOP=1 \
    -v phase=teardown \
    -f supabase/tests/u15d_assignment_concurrency.sql ||
    TEARDOWN_RC=$?

  if [[ "${VERIFY_RC}" -ne 0 ||
    "${TEARDOWN_RC}" -ne 0 ]]; then
    exit 87
  fi
) >"${CONC_LOG}" 2>&1
CONC_SUITE_RC=$?
set -e

RACE_SUCCESS_COUNT="$(
  grep -Ec '^race_[ab]_exit=0$' \
    "${ARTIFACT_DIR}/race-exit-codes.txt" \
    2>/dev/null ||
    true
)"

if [[ "${CONC_SUITE_RC}" -eq 0 &&
  "${RACE_SUCCESS_COUNT}" -eq 1 ]]; then
  CONCURRENCY_RESULT="PASS"
  AUDIT_EXACTLY_ONCE="PASS"
else
  CONCURRENCY_RESULT="FAIL"
  AUDIT_EXACTLY_ONCE="FAIL"
fi
echo "[u15d] concurrency suite -> ver ${CONC_LOG}"

# --- 11) REPORT ---------------------------------------------------------------
BASE_HEAD="$(git rev-parse HEAD)"
cat > "${ARTIFACT_DIR}/00_FINAL_RESULT.txt" <<EOF
RESULT=$([[ "${ASSIGN_RESULT}" == "PASS" && "${CONCURRENCY_RESULT}" == "PASS" ]] && echo PASS || echo FAIL)
UNIT=${UNIT}
BASE_HEAD=${BASE_HEAD}
FINAL_HEAD=${BASE_HEAD}
ASSIGN_RESULT=${ASSIGN_RESULT}
REASSIGN_RESULT=${REASSIGN_RESULT}
UNASSIGN_RESULT=${UNASSIGN_RESULT}
IDEMPOTENCY_RESULT=${IDEMPOTENCY_RESULT}
CONCURRENCY_RESULT=${CONCURRENCY_RESULT}
AUDIT_EXACTLY_ONCE=${AUDIT_EXACTLY_ONCE}
RLS_RESULT=${RLS_RESULT}
ROLE_ESCALATION_RESULT=${ROLE_ESCALATION_RESULT}
DOCKER_USED=${DOCKER_USED}
DOCKER_STOPPED=pending-trap
DO_NOT_RUN=push | PR | merge | deploy | supabase remoto | psql remoto
EOF
echo "[u15d] reporte -> ${ARTIFACT_DIR}/00_FINAL_RESULT.txt"
cat "${ARTIFACT_DIR}/00_FINAL_RESULT.txt"

rm -rf "${RUNTIME_DIR}"
