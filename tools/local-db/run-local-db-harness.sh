#!/usr/bin/env bash
# TC-LOCAL-DB-RLS-HARNESS-01
# run-local-db-harness.sh — Punto de entrada HOST (macOS) del harness local.
#
# Fail-closed: cualquier precondición no cumplida aborta ANTES de tocar Docker.
# No ejecuta Supabase remoto. No aplica SQL remoto. No hace commit/push/deploy.
# Delega la orquestación a tools/local-db/harness.mjs.
#
# Uso:
#   tools/local-db/run-local-db-harness.sh [--dry-run] [--keep-up] [--db-port N]

set -Eeuo pipefail
IFS=$'\n\t'

UNIT="TC-LOCAL-DB-RLS-HARNESS-01"

# --- Resolver raíz del repo/worktree (dir de este script -> ../..) -----------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." >/dev/null 2>&1 && pwd)"
cd "${REPO_ROOT}"

# --- Salida estructurada mínima de parada temprana ---------------------------
fail() {
  # $1=STOP_REASON_CODE  $2=FAILED_PHASE  $3=detalle  $4=exit_code
  local code="$1" phase="$2" detail="$3" exit_code="${4:-40}"
  cat <<EOF

===== 00_FINAL_RESULT (host preflight) =====
RESULT=FAIL
SCRIPT_EXIT_CODE=${exit_code}
UNIT=${UNIT}
FAILED_PHASE=${phase}
STOP_REASON_CODE=${code}
STOP_REASON_DETAIL=${detail}
LOCAL_SUPABASE_STATUS=not-started
SAFE_RECOVERY_ACTION=corregir precondición host y reintentar (solo local)
DO_NOT_RUN=push | PR | merge | deploy | supabase remoto | psql remoto
EOF
  exit "${exit_code}"
}

# --- 1) macOS host -----------------------------------------------------------
if [[ "$(uname -s)" != "Darwin" ]]; then
  fail "E_HOST_NOT_MACOS" "PRECHECK_HOST" "uname=$(uname -s) (se requiere Darwin/macOS)" 10
fi

# --- 2) Node 22 --------------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  fail "E_NODE_VERSION" "PRECHECK_HOST" "node no encontrado en PATH" 11
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [[ "${NODE_MAJOR}" -lt 22 ]]; then
  fail "E_NODE_VERSION" "PRECHECK_HOST" "node major=${NODE_MAJOR} (se requiere >=22)" 11
fi

# --- 3) Docker disponible y corriendo ---------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  fail "E_DOCKER_MISSING" "PRECHECK_HOST" "docker no encontrado en PATH" 12
fi
if ! docker info >/dev/null 2>&1; then
  fail "E_DOCKER_NOT_RUNNING" "PRECHECK_HOST" "docker daemon no responde (abrir Docker Desktop)" 13
fi

# --- 4) Supabase CLI ---------------------------------------------------------
if ! command -v supabase >/dev/null 2>&1; then
  fail "E_SUPABASE_CLI_MISSING" "PRECHECK_HOST" "supabase CLI no encontrado (brew install supabase/tap/supabase)" 14
fi

# --- 5) Worktree/branch ------------------------------------------------------
if [[ "$(git rev-parse --is-inside-work-tree 2>/dev/null || echo false)" != "true" ]]; then
  fail "E_NOT_GIT_WORKTREE" "PRECHECK_REPO" "no es un worktree git" 15
fi
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "${BRANCH}" != test/* ]]; then
  fail "E_WRONG_BRANCH" "PRECHECK_REPO" "rama=${BRANCH} (se espera test/*)" 16
fi

# --- 6) Guarda anti-remoto (env) --------------------------------------------
# Rechaza cualquier variable que apunte a un destino gestionado/remoto.
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

# --- 7) Delegar orquestación a Node (fail-closed) ---------------------------
echo "[harness] host OK (macOS, node>=22, docker, supabase, branch=${BRANCH})"
echo "[harness] delegando a node harness.mjs ..."
exec node "${SCRIPT_DIR}/harness.mjs" "$@"
