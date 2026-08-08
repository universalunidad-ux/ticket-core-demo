#!/usr/bin/env bash
# TC-GENERATED-SQL-TYPE-SAFETY-GATE-01
# Smoke semántico LOCAL del SQL generado por auth-seed.mjs.
# Este runner sí requiere Docker, Supabase CLI y psql, pero nunca acepta un
# destino externo ni deja el stack arriba. No tiene modo de persistencia.

set -Eeuo pipefail
IFS=$'\n\t'
umask 077

UNIT="TC-GENERATED-SQL-TYPE-SAFETY-GATE-01"
EXPECTED_BRANCH="test/recovery-v2-20260725"
PROJECT_ID="tc_auth_seed_smoke"
DB_PORT="54349"
RUNTIME_DIR="tools/local-db/.runtime-auth-seed-smoke"
LOCK_DIR="tools/local-db/.auth-seed-smoke.lock"
SMOKE_UUID="3f2504e0-4f89-11d3-9a0c-0305e82c3301"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." >/dev/null 2>&1 && pwd)"
cd "${REPO_ROOT}"

START_HEAD=""
BOOTSTRAP_ATTEMPTED="NO"
STACK_OWNED="NO"
LOCK_OWNED="NO"
TMP_DIR=""
RESULT="FAIL"
STOP_CODE="E_UNEXPECTED"
TEARDOWN="NOT_NEEDED"
RESIDUAL_STACKS="UNKNOWN"

active_supabase_stacks() {
  docker ps --filter 'name=^supabase_' --format '{{.Names}}'
}

fail() {
  STOP_CODE="$1"
  echo "AUTH_SEED_SMOKE=FAIL" >&2
  echo "STOP_CODE=${STOP_CODE}" >&2
  exit 1
}

assert_no_active_runners() {
  if pgrep -f 'tools/local-db/[r]un-recovery-v2\.sh' >/dev/null 2>&1 \
      || pgrep -f 'tools/local-db/[r]un-recovery-v2-synthetic\.sh' >/dev/null 2>&1 \
      || pgrep -f 'tools/local-db/[r]un-local-db-harness\.sh' >/dev/null 2>&1; then
    fail "E_ACTIVE_LOCAL_DB_RUNNER"
  fi
}

assert_remote_env_absent() {
  local name value
  for name in DATABASE_URL SUPABASE_DB_URL SUPABASE_URL POSTGRES_URL \
              SUPABASE_HOST PGHOST SUPABASE_ACCESS_TOKEN SUPABASE_PROJECT_REF; do
    value="${!name:-}"
    [[ -z "${value}" ]] || fail "E_REMOTE_ENV_PRESENT"
  done
}

stop_owned_stack() {
  [[ "${BOOTSTRAP_ATTEMPTED}" == "YES" ]] || return 0
  if node tools/local-db/lib/bootstrap.mjs --stop \
      --project-id "${PROJECT_ID}" \
      --runtime-dir "${RUNTIME_DIR}" \
      --remove-runtime >/dev/null 2>&1; then
    STACK_OWNED="NO"
    TEARDOWN="PASS"
    return 0
  fi
  TEARDOWN="FAIL"
  return 1
}

on_exit() {
  local rc=$? active="" cleanup_rc=0
  trap - EXIT ERR INT TERM

  if [[ "${BOOTSTRAP_ATTEMPTED}" == "YES" ]] && ! stop_owned_stack; then
    cleanup_rc=1
    STOP_CODE="E_TEARDOWN_FAILED"
  fi

  if command -v docker >/dev/null 2>&1; then
    if active="$(active_supabase_stacks 2>/dev/null)"; then
      if [[ -z "${active}" ]]; then
        RESIDUAL_STACKS="ZERO"
      else
        RESIDUAL_STACKS="PRESENT"
        cleanup_rc=1
        STOP_CODE="E_RESIDUAL_SUPABASE_STACKS"
      fi
    else
      RESIDUAL_STACKS="CHECK_FAILED"
      cleanup_rc=1
      STOP_CODE="E_RESIDUAL_STACK_CHECK_FAILED"
    fi
  fi

  if [[ -n "${TMP_DIR}" && "${TMP_DIR}" == /tmp/tc-auth-seed-smoke.* ]]; then
    rm -rf -- "${TMP_DIR}" || cleanup_rc=1
  fi
  if [[ "${LOCK_OWNED}" == "YES" ]]; then
    rmdir "${LOCK_DIR}" 2>/dev/null || cleanup_rc=1
  fi

  if [[ ${rc} -eq 0 && ${cleanup_rc} -eq 0 \
        && "${TEARDOWN}" == "PASS" && "${RESIDUAL_STACKS}" == "ZERO" ]]; then
    RESULT="PASS"
    STOP_CODE="OK"
  else
    RESULT="FAIL"
    rc=1
  fi

  echo "AUTH_SEED_SMOKE=${RESULT}"
  echo "UNIT=${UNIT}"
  echo "STOP_CODE=${STOP_CODE}"
  echo "TRANSACTION=ROLLBACK"
  echo "TYPE_UUID=${RESULT}"
  echo "TYPE_TIMESTAMPTZ=${RESULT}"
  echo "TYPE_JSONB=${RESULT}"
  echo "TEARDOWN=${TEARDOWN}"
  echo "RESIDUAL_SUPABASE_STACKS=${RESIDUAL_STACKS}"
  echo "SUPABASE_REMOTE=NO"
  exit "${rc}"
}
trap on_exit EXIT
trap 'STOP_CODE=E_INTERRUPTED_INT; exit 130' INT
trap 'STOP_CODE=E_INTERRUPTED_TERM; exit 143' TERM

[[ $# -eq 0 ]] || fail "E_ARGUMENTS_FORBIDDEN"
[[ "$(git branch --show-current)" == "${EXPECTED_BRANCH}" ]] || fail "E_WRONG_BRANCH"
START_HEAD="$(git rev-parse HEAD)"
[[ -z "$(git status --porcelain=v1 --untracked-files=all)" ]] || fail "E_WORKTREE_DIRTY"
[[ ! -e "$(git rev-parse --git-path index.lock)" ]] || fail "E_INDEX_LOCK_PRESENT"
assert_no_active_runners
assert_remote_env_absent
mkdir "${LOCK_DIR}" 2>/dev/null || fail "E_WRITER_LOCK_PRESENT"
LOCK_OWNED="YES"

command -v node >/dev/null 2>&1 || fail "E_NODE_MISSING"
command -v docker >/dev/null 2>&1 || fail "E_DOCKER_MISSING"
docker info >/dev/null 2>&1 || fail "E_DOCKER_NOT_RUNNING"
command -v supabase >/dev/null 2>&1 || fail "E_SUPABASE_CLI_MISSING"
command -v psql >/dev/null 2>&1 || fail "E_PSQL_MISSING"

INITIAL_STACKS="$(active_supabase_stacks)" || fail "E_INITIAL_STACK_CHECK_FAILED"
[[ -z "${INITIAL_STACKS}" ]] || fail "E_INITIAL_STACKS_PRESENT"

node tools/local-db/generated-sql-type-safety-gate.mjs \
  || fail "E_STATIC_TYPE_GATE_FAILED"

TMP_DIR="$(mktemp -d /tmp/tc-auth-seed-smoke.XXXXXX)" \
  || fail "E_TMPDIR_FAILED"
SQL_FILE="${TMP_DIR}/auth-seed-smoke.sql"
PSQL_LOG="${TMP_DIR}/auth-seed-smoke.log"

BOOTSTRAP_ATTEMPTED="YES"
BOOTSTRAP_ENV="$(node tools/local-db/lib/bootstrap.mjs \
  --project-id "${PROJECT_ID}" \
  --db-port "${DB_PORT}" \
  --runtime-dir "${RUNTIME_DIR}" \
  --reset-runtime)" || fail "E_BOOTSTRAP_FAILED"

bootstrap_field() {
  printf '%s\n' "${BOOTSTRAP_ENV}" | sed -n "s/^$1=//p" | head -n 1
}
DB_URL="$(bootstrap_field BOOTSTRAP_DB_URL)"
CID="$(bootstrap_field BOOTSTRAP_CID)"
HOST="$(bootstrap_field BOOTSTRAP_HOST)"
[[ "${CID}" == "supabase_db_${PROJECT_ID}" ]] || fail "E_BOOTSTRAP_CID_MISMATCH"
case "${HOST}" in
  localhost|127.0.0.1|::1) : ;;
  *) fail "E_NON_LOCAL_DB_HOST" ;;
esac
[[ -n "${DB_URL}" ]] || fail "E_BOOTSTRAP_DB_URL_MISSING"
STACK_OWNED="YES"

printf 'COPY public.perfiles (id) FROM stdin;\n%s\n\\.\n' "${SMOKE_UUID}" \
  | node tools/local-db/lib/auth-seed.mjs --emit-sql --smoke \
  >"${SQL_FILE}" \
  || fail "E_SQL_GENERATION_FAILED"

psql "${DB_URL}" -X -q --no-psqlrc -v ON_ERROR_STOP=1 \
  -f "${SQL_FILE}" >"${PSQL_LOG}" 2>&1 \
  || fail "E_SQL_SMOKE_FAILED"

for marker in \
  AUTH_SEED_TYPE_UUID=PASS \
  AUTH_SEED_TYPE_TIMESTAMPTZ=PASS \
  AUTH_SEED_TYPE_JSONB=PASS \
  AUTH_SEED_TRANSACTION=ROLLBACK; do
  grep -Fxq "${marker}" "${PSQL_LOG}" || fail "E_SMOKE_MARKER_MISSING"
done

POST_ROLLBACK_COUNT="$(psql "${DB_URL}" -X -qAt --no-psqlrc -v ON_ERROR_STOP=1 \
  -c "select count(*) from auth.users where id = '${SMOKE_UUID}'::uuid")" \
  || fail "E_ROLLBACK_CHECK_FAILED"
[[ "${POST_ROLLBACK_COUNT}" == "0" ]] || fail "E_ROLLBACK_NOT_EFFECTIVE"

[[ "$(git rev-parse HEAD)" == "${START_HEAD}" ]] || fail "E_HEAD_CHANGED"
[[ -z "$(git status --porcelain=v1 --untracked-files=all)" ]] || fail "E_WORKTREE_CHANGED"
exit 0
