#!/usr/bin/env bash
# TC-RECOVERY-SEQUENTIAL-SCORABLE-01
# Fuente y destino Supabase se ejecutan secuencialmente, nunca simultáneamente.

set -Eeuo pipefail
IFS=$'\n\t'
umask 077

EXPECTED_BRANCH="test/recovery-v2-20260725"
AUTHORIZED_BASE_HEAD="7feeebcee01fc655d8594cb80186d7887b06a47b"
SOURCE_PROJECT_ID="tc_local_db_harness"
SOURCE_DB_PORT="54329"
SOURCE_RUNTIME="tools/local-db/.runtime-recovery-source"
DEST_PROJECT_ID="tc_recovery_v2"
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-synthetic"
ARTIFACTS_DIR="tools/local-db/.artifacts-recovery/${RUN_ID}"
LOCK_DIR="tools/local-db/.recovery-v2-synthetic.lock"

SOURCE_OWNED="no"
SOURCE_STOPPED="NO"
START_HEAD=""
FINAL_RESULT="FAIL"
FAIL_REASON="UNEXPECTED"
SOURCE_SERVER_MAJOR="UNKNOWN"
SOURCE_CLIENT_MAJOR="UNKNOWN"
LOCK_OWNED="no"

mkdir -p "${ARTIFACTS_DIR}"

write_orchestrator_report() {
  {
    echo "ORCHESTRATOR_RESULT=${FINAL_RESULT}"
    echo "FAIL_REASON=${FAIL_REASON}"
    echo "SOURCE_PROJECT_ID=${SOURCE_PROJECT_ID}"
    echo "DEST_PROJECT_ID=${DEST_PROJECT_ID}"
    echo "SOURCE_STOPPED=${SOURCE_STOPPED}"
    echo "SOURCE_SERVER_MAJOR=${SOURCE_SERVER_MAJOR}"
    echo "SOURCE_CLIENT_MAJOR=${SOURCE_CLIENT_MAJOR}"
    echo "SEQUENTIAL_SOURCE_DESTINATION=YES"
    echo "DOCKER_USED=YES"
    echo "SUPABASE_REMOTE=NO"
  } > "${ARTIFACTS_DIR}/00_ORCHESTRATOR_RESULT.txt"
}

stop_source() {
  [[ "${SOURCE_OWNED}" == "yes" ]] || return 0
  if node tools/local-db/lib/bootstrap.mjs --stop \
      --project-id "${SOURCE_PROJECT_ID}" \
      --runtime-dir "${SOURCE_RUNTIME}" \
      --remove-runtime >"${ARTIFACTS_DIR}/10_source_teardown.log" 2>&1; then
    SOURCE_OWNED="no"
    SOURCE_STOPPED="YES"
    return 0
  fi
  SOURCE_STOPPED="FAIL"
  return 1
}

release_lock() {
  [[ "${LOCK_OWNED}" == "yes" ]] || return 0
  if rmdir "${LOCK_DIR}" 2>/dev/null; then
    LOCK_OWNED="no"
    return 0
  fi
  return 1
}

on_exit() {
  local rc=$?
  trap - EXIT
  if [[ "${SOURCE_OWNED}" == "yes" ]] && ! stop_source; then
    rc=1
    FAIL_REASON="SOURCE_TEARDOWN_FAILED"
  fi
  if ! release_lock; then
    rc=1
    FAIL_REASON="ORCHESTRATOR_LOCK_RELEASE_FAILED"
  fi
  if [[ ${rc} -ne 0 ]]; then
    FINAL_RESULT="FAIL"
    write_orchestrator_report
  fi
  exit "${rc}"
}
trap on_exit EXIT

fail() {
  FAIL_REASON="$1"
  echo "ABORT[recovery-v2-synthetic]: $1" >&2
  exit 1
}

assert_no_active_runners() {
  if pgrep -f 'tools/local-db/[r]un-recovery-v2\.sh' >/dev/null 2>&1 \
      || pgrep -f 'tools/local-db/[r]un-local-db-harness\.sh' >/dev/null 2>&1; then
    fail "ACTIVE_LOCAL_DB_RUNNER"
  fi
}

active_supabase_stacks() {
  docker ps --filter 'name=^supabase_' --format '{{.Names}}'
}

assert_no_supabase_stacks() {
  local active
  active="$(active_supabase_stacks)" \
    || fail "ACTIVE_STACK_CHECK_FAILED"
  [[ -z "${active}" ]] || fail "SUPABASE_STACK_ALREADY_ACTIVE"
}

bootstrap_field() {
  local key="$1" payload="$2"
  printf '%s\n' "${payload}" | sed -n "s/^${key}=//p" | head -n 1
}

status_field() {
  local key="$1" payload="$2" value
  value="$(printf '%s\n' "${payload}" | sed -n "s/^${key}=//p" | head -n 1)"
  value="${value#\"}"
  value="${value%\"}"
  printf '%s\n' "${value}"
}

result_field() {
  local key="$1" file="$2"
  sed -n "s/^${key}=//p" "${file}" | head -n 1
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

version_major() {
  local version="$1"
  [[ "${version}" =~ ^([0-9]+)(\.|$) ]] || return 1
  printf '%s\n' "${BASH_REMATCH[1]}"
}

read_source_toolchain() {
  local server_version_num="" client_raw="" client_version=""
  server_version_num="$(docker exec "${SOURCE_CID}" psql -U postgres -d postgres \
    -X -qAt -v ON_ERROR_STOP=1 -c 'show server_version_num' 2>/dev/null)" \
    || fail "SOURCE_SERVER_VERSION_UNREADABLE"
  [[ "${server_version_num}" =~ ^[0-9]{5,6}$ ]] \
    || fail "SOURCE_SERVER_VERSION_UNRECOGNIZED"
  SOURCE_SERVER_MAJOR="$((10#${server_version_num} / 10000))"

  client_raw="$(docker exec "${SOURCE_CID}" pg_dump --version 2>/dev/null)" \
    || fail "SOURCE_PG_DUMP_VERSION_UNREADABLE"
  client_version="$(parse_postgres_tool_version pg_dump "${client_raw}")" \
    || fail "SOURCE_PG_DUMP_VERSION_UNRECOGNIZED"
  SOURCE_CLIENT_MAJOR="$(version_major "${client_version}")" \
    || fail "SOURCE_PG_DUMP_MAJOR_UNRECOGNIZED"
  [[ "${SOURCE_CLIENT_MAJOR}" == "${SOURCE_SERVER_MAJOR}" ]] \
    || fail "SOURCE_CLIENT_SERVER_MAJOR_MISMATCH"
}

# Identidad y exclusión mutua antes de cualquier llamada a Docker/Supabase.
[[ "$(git branch --show-current)" == "${EXPECTED_BRANCH}" ]] \
  || fail "WRONG_BRANCH"
START_HEAD="$(git rev-parse HEAD)"
git merge-base --is-ancestor "${AUTHORIZED_BASE_HEAD}" "${START_HEAD}" \
  || fail "UNAUTHORIZED_HEAD"
[[ -z "$(git status --porcelain)" ]] || fail "WORKTREE_DIRTY"
COMMON_GIT_DIR="$(git rev-parse --git-common-dir)"
[[ ! -e "${COMMON_GIT_DIR}/index.lock" ]] || fail "INDEX_LOCK_PRESENT"
assert_no_active_runners
mkdir "${LOCK_DIR}" 2>/dev/null || fail "ORCHESTRATOR_LOCK_PRESENT"
LOCK_OWNED="yes"

# Herramientas y contratos estáticos. No hay stack activo todavía.
command -v docker >/dev/null 2>&1 || fail "DOCKER_NOT_FOUND"
docker info >/dev/null 2>&1 || fail "DOCKER_NOT_RUNNING"
command -v supabase >/dev/null 2>&1 || fail "SUPABASE_CLI_NOT_FOUND"
assert_no_supabase_stacks

bash -n tools/local-db/run-recovery-v2.sh
bash -n tools/local-db/run-recovery-v2-synthetic.sh
node --check tools/local-db/lib/local-auth-users.mjs
node --check tools/local-db/lib/site-config-ownership.mjs
node tools/staging-synthetic-seed-contract.test.mjs
node tools/recovery-v2-contract.test.mjs
node --test \
  test/local-db/local-auth-users.test.mjs \
  test/local-db/site-config-ownership.test.mjs

# FASE FUENTE: único stack activo.
SOURCE_BOOTSTRAP="$(node tools/local-db/lib/bootstrap.mjs \
  --project-id "${SOURCE_PROJECT_ID}" \
  --db-port "${SOURCE_DB_PORT}" \
  --runtime-dir "${SOURCE_RUNTIME}" \
  --reset-runtime 2>"${ARTIFACTS_DIR}/01_source_bootstrap.err")" \
  || fail "SOURCE_BOOTSTRAP_FAILED"
SOURCE_OWNED="yes"

SOURCE_CID="$(bootstrap_field BOOTSTRAP_CID "${SOURCE_BOOTSTRAP}")"
[[ "${SOURCE_CID}" == "supabase_db_${SOURCE_PROJECT_ID}" ]] \
  || fail "SOURCE_BOOTSTRAP_IDENTITY_FAILED"
read_source_toolchain

supabase db reset --workdir "${SOURCE_RUNTIME}" \
  >"${ARTIFACTS_DIR}/02_source_migrations.log" 2>&1 \
  || fail "SOURCE_MIGRATIONS_FAILED"

# `supabase status` contiene secretos locales: sólo vive en memoria de shell.
SOURCE_STATUS="$(supabase status -o env --workdir "${SOURCE_RUNTIME}" \
  2>"${ARTIFACTS_DIR}/03_source_status.err")" \
  || fail "SOURCE_STATUS_FAILED"
LOCAL_AUTH_API_URL="$(status_field API_URL "${SOURCE_STATUS}")"
LOCAL_SERVICE_ROLE_KEY="$(status_field SERVICE_ROLE_KEY "${SOURCE_STATUS}")"
[[ -n "${LOCAL_AUTH_API_URL}" && -n "${LOCAL_SERVICE_ROLE_KEY}" ]] \
  || fail "SOURCE_AUTH_ENV_INCOMPLETE"

LOCAL_AUTH_API_URL="${LOCAL_AUTH_API_URL}" \
SUPABASE_SERVICE_ROLE_KEY="${LOCAL_SERVICE_ROLE_KEY}" \
  node tools/local-db/lib/local-auth-users.mjs \
  >"${ARTIFACTS_DIR}/03_source_auth_users.txt" \
  2>"${ARTIFACTS_DIR}/03_source_auth_users.err" \
  || fail "SOURCE_AUTH_USERS_FAILED"
unset SOURCE_STATUS LOCAL_SERVICE_ROLE_KEY

[[ "$(wc -l < "${ARTIFACTS_DIR}/03_source_auth_users.txt" | tr -d '[:space:]')" == "4" ]] \
  || fail "SOURCE_AUTH_USERS_OUTPUT_INVALID"
ADMIN_UID="$(result_field admin "${ARTIFACTS_DIR}/03_source_auth_users.txt")"
SUPERVISOR_UID="$(result_field supervisor "${ARTIFACTS_DIR}/03_source_auth_users.txt")"
SUPPORT_A_UID="$(result_field support_a "${ARTIFACTS_DIR}/03_source_auth_users.txt")"
SUPPORT_B_UID="$(result_field support_b "${ARTIFACTS_DIR}/03_source_auth_users.txt")"
UUID_COUNT="$(printf '%s\n' "${ADMIN_UID}" "${SUPERVISOR_UID}" "${SUPPORT_A_UID}" "${SUPPORT_B_UID}" | sort -u | wc -l | tr -d '[:space:]')"
[[ "${UUID_COUNT}" == "4" ]] || fail "SOURCE_AUTH_UUIDS_NOT_DISTINCT"

set +e
docker exec -i "${SOURCE_CID}" psql -U postgres -d postgres \
  -X -q --no-psqlrc -v ON_ERROR_STOP=1 \
  -v environment=staging \
  -v confirmation=TC_STAGING_SYNTHETIC_V1 \
  -v admin_uid="${ADMIN_UID}" \
  -v supervisor_uid="${SUPERVISOR_UID}" \
  -v support_a_uid="${SUPPORT_A_UID}" \
  -v support_b_uid="${SUPPORT_B_UID}" \
  <supabase/tests/staging_synthetic_seed.sql \
  >"${ARTIFACTS_DIR}/04_source_seed.log" 2>&1
SEED_RC=$?
set -e
if [[ ${SEED_RC} -ne 0 ]]; then
  fail "SOURCE_SEED_NONZERO"
fi
grep -Fxq 'STAGING_SYNTHETIC_SEED=PASS' "${ARTIFACTS_DIR}/04_source_seed.log" \
  || fail "SOURCE_SEED_MARKER_MISSING"

SOURCE_CUTOFF_EPOCH="$(date -u +%s)"
SOURCE_DUMP="${ARTIFACTS_DIR}/05_source_app_data.dump"
docker exec "${SOURCE_CID}" pg_dump -U postgres -d postgres \
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
  >"${SOURCE_DUMP}" 2>"${ARTIFACTS_DIR}/05_source_dump.log" \
  || fail "SOURCE_DUMP_FAILED"

SOURCE_SIGNATURE="${ARTIFACTS_DIR}/06_source_signature.txt"
docker exec -i "${SOURCE_CID}" psql -U postgres -d postgres \
  -X -q --no-psqlrc -v ON_ERROR_STOP=1 \
  <tools/local-db/recovery-signature.sql \
  >"${SOURCE_SIGNATURE}" \
  2>"${ARTIFACTS_DIR}/06_source_signature.err" \
  || fail "SOURCE_SIGNATURE_FAILED"
grep -Fxq 'RECOVERY_SIGNATURE_COMPLETE=YES' "${SOURCE_SIGNATURE}" \
  || fail "SOURCE_SIGNATURE_INCOMPLETE"

# La fuente debe desaparecer por completo antes del bootstrap destino.
stop_source || fail "SOURCE_TEARDOWN_FAILED"
assert_no_supabase_stacks

# FASE DESTINO: run-recovery-v2.sh es el owner único del clon y su teardown.
set +e
RECOVERY_RUN_ID="${RUN_ID}" tools/local-db/run-recovery-v2.sh \
  --dump "${SOURCE_DUMP}" \
  --source-signature-file "${SOURCE_SIGNATURE}" \
  --source-cutoff-epoch "${SOURCE_CUTOFF_EPOCH}" \
  >"${ARTIFACTS_DIR}/07_destination_runner.log" 2>&1
DEST_RC=$?
set -e

DEST_RESULT="${ARTIFACTS_DIR}/00_RESULT.txt"
[[ ${DEST_RC} -eq 0 ]] || fail "DESTINATION_RUNNER_NONZERO"
[[ -f "${DEST_RESULT}" && ! -L "${DEST_RESULT}" ]] \
  || fail "DESTINATION_RESULT_MISSING"
[[ "$(result_field RESULT "${DEST_RESULT}")" == "PASS" ]] \
  || fail "DESTINATION_RESULT_NOT_PASS"
[[ "$(result_field SCORABLE "${DEST_RESULT}")" == "YES" ]] \
  || fail "DESTINATION_NOT_SCORABLE"
[[ "$(result_field DOCKER_STOPPED "${DEST_RESULT}")" == "YES" ]] \
  || fail "DESTINATION_TEARDOWN_NOT_PASS"

assert_no_supabase_stacks
[[ "$(git rev-parse HEAD)" == "${START_HEAD}" ]] || fail "HEAD_CHANGED_DURING_RUNTIME"
[[ -z "$(git status --porcelain)" ]] || fail "WORKTREE_CHANGED_DURING_RUNTIME"

FINAL_RESULT="PASS"
FAIL_REASON="NONE"
write_orchestrator_report
trap - EXIT
release_lock || fail "ORCHESTRATOR_LOCK_RELEASE_FAILED"
echo "RECOVERY_V2_SYNTHETIC=PASS"
echo "ARTIFACTS_DIR=${ARTIFACTS_DIR}"
