#!/usr/bin/env bash
# shellcheck disable=SC2329 # lifecycle helpers are invoked through EXIT/INT/TERM traps
# TC-AFA3099-U15C-RUNTIME-CONCURRENCY-CLOSURE-01
# Runtime local efímero y fail-closed para public.tc_consolidar_cliente_ticket.
# No acepta destinos, credenciales ni proyectos remotos.

set -Eeuo pipefail
IFS=$'\n\t'
umask 077

UNIT='TC-AFA3099-U15C-RUNTIME-CONCURRENCY-CLOSURE-01'
BASE_HEAD='afa30999320c738bea82d4edd789fd849aee0782'
EXPECTED_BRANCH='feat/u15c-runtime-concurrency-afa3099-20260802'
PROJECT_ID='tc_u15c_afa3099'
DB_PORT='55438'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." >/dev/null 2>&1 && pwd)"
RUNTIME_DIR="${REPO_ROOT}/tools/local-db/.runtime/u15c-afa3099"
LOCK_DIR="${REPO_ROOT}/tools/local-db/.u15c-runtime.lock"
EVIDENCE_DIR="${TC_U15C_EVIDENCE_DIR:-}"
cd "${REPO_ROOT}"

MIGRATION='supabase/migrations/20260721014500_u15cd_consolidation_rpc.sql'
MATRIX='supabase/tests/u15c_transaction_matrix.sql'
CONC='supabase/tests/u15c_concurrency_matrix.sql'
AUTHZ_NEGATIVE='supabase/tests/authz_negative.sql'
CONTRACT_U15C='tools/u15c-rpc-schema-contract.test.mjs'
CONTRACT_U15D='tools/u15d-consolidation-rpc-contract.test.mjs'
RPC_SIGNATURE='public.tc_consolidar_cliente_ticket(uuid,text,bigint,text,uuid,uuid,jsonb,jsonb)'

DRY_RUN='NO'
RESULT='STOP'
STOP_REASON_CODE='E_UNEXPECTED'
FAILED_PHASE='PRECHECK'
FIRST_FAILURE='unexpected exit'
FINAL_HEAD='-'
DB_CONTAINER='-'
BOOTSTRAP_ATTEMPTED='NO'
LOCK_OWNED='NO'
TEARDOWN='NOT_NEEDED'
RESIDUAL_ROWS='UNKNOWN'
RESIDUAL_CONTAINERS='UNKNOWN'
RESIDUAL_VOLUMES='UNKNOWN'
RESIDUAL_NETWORKS='UNKNOWN'
STATIC_RPC_CONTRACT='NOT_RUN'
TRANSACTION_CASES='0/25'
CONCURRENCY_CASES='0/5'
TWO_SESSION_RUNTIME='NOT_RUN'
EXACTLY_ONE_WINNER='NOT_RUN'
LOSER_STATE='NOT_RUN'
IDEMPOTENCY='NOT_RUN'
NEGATIVE_AUTH='NOT_RUN'
ROLLBACK='NOT_RUN'

active_supabase_stacks() {
  docker ps --filter 'name=^supabase_' --format '{{.Names}}'
}

count_owned_containers() {
  docker ps -a --format '{{.Names}}' | grep -c "${PROJECT_ID}" || true
}

count_owned_volumes() {
  docker volume ls --format '{{.Name}}' | grep -c "${PROJECT_ID}" || true
}

count_owned_networks() {
  docker network ls --format '{{.Name}}' | grep -c "${PROJECT_ID}" || true
}

write_report() {
  local report_file="${EVIDENCE_DIR}/runtime-final.txt"
  {
    printf 'UNIT=%s\n' "${UNIT}"
    printf 'RESULT=%s\n' "${RESULT}"
    printf 'BASE_HEAD=%s\n' "${BASE_HEAD}"
    printf 'FINAL_HEAD=%s\n' "${FINAL_HEAD}"
    printf 'FAILED_PHASE=%s\n' "${FAILED_PHASE}"
    printf 'FIRST_FAILURE=%s\n' "${FIRST_FAILURE}"
    printf 'REASON_CODE=%s\n' "${STOP_REASON_CODE}"
    printf 'STATIC_RPC_CONTRACT=%s\n' "${STATIC_RPC_CONTRACT}"
    printf 'TRANSACTION_CASES=%s\n' "${TRANSACTION_CASES}"
    printf 'CONCURRENCY_CASES=%s\n' "${CONCURRENCY_CASES}"
    printf 'TWO_SESSION_RUNTIME=%s\n' "${TWO_SESSION_RUNTIME}"
    printf 'EXACTLY_ONE_WINNER=%s\n' "${EXACTLY_ONE_WINNER}"
    printf 'LOSER_STATE=%s\n' "${LOSER_STATE}"
    printf 'IDEMPOTENCY=%s\n' "${IDEMPOTENCY}"
    printf 'NEGATIVE_AUTH=%s\n' "${NEGATIVE_AUTH}"
    printf 'ROLLBACK=%s\n' "${ROLLBACK}"
    printf 'TEARDOWN=%s\n' "${TEARDOWN}"
    printf 'RESIDUAL_ROWS=%s\n' "${RESIDUAL_ROWS}"
    printf 'RESIDUAL_CONTAINERS=%s\n' "${RESIDUAL_CONTAINERS}"
    printf 'RESIDUAL_VOLUMES=%s\n' "${RESIDUAL_VOLUMES}"
    printf 'RESIDUAL_NETWORKS=%s\n' "${RESIDUAL_NETWORKS}"
    printf 'DB_CONTAINER=%s\n' "${DB_CONTAINER}"
    printf 'REMOTE_OPERATIONS=NO\n'
  } | tee "${report_file}"
}

stop_owned_stack() {
  [[ "${BOOTSTRAP_ATTEMPTED}" == 'YES' ]] || return 0
  if SUPABASE_TELEMETRY_DISABLED=1 node tools/local-db/lib/bootstrap.mjs \
      --stop --remove-runtime --project-id "${PROJECT_ID}" \
      --runtime-dir "${RUNTIME_DIR}" >"${EVIDENCE_DIR}/teardown.log" 2>&1; then
    TEARDOWN='PASS'
    return 0
  fi
  TEARDOWN='FAIL'
  return 1
}

cleanup() {
  local rc=$? cleanup_rc=0
  trap - EXIT INT TERM

  if ! stop_owned_stack; then
    cleanup_rc=1
    STOP_REASON_CODE='E_TEARDOWN_FAILED'
    FAILED_PHASE='TEARDOWN'
    FIRST_FAILURE='owned Supabase stack teardown failed'
  fi

  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    RESIDUAL_CONTAINERS="$(count_owned_containers)"
    RESIDUAL_VOLUMES="$(count_owned_volumes)"
    RESIDUAL_NETWORKS="$(count_owned_networks)"
    if [[ "${RESIDUAL_CONTAINERS}" != '0' || "${RESIDUAL_VOLUMES}" != '0' || "${RESIDUAL_NETWORKS}" != '0' ]]; then
      cleanup_rc=1
      STOP_REASON_CODE='E_RESIDUAL_DOCKER_OBJECTS'
      FAILED_PHASE='TEARDOWN'
      FIRST_FAILURE="owned Docker residuals containers=${RESIDUAL_CONTAINERS} volumes=${RESIDUAL_VOLUMES} networks=${RESIDUAL_NETWORKS}"
    fi
  fi

  if [[ "${LOCK_OWNED}" == 'YES' ]]; then
    rmdir "${LOCK_DIR}" 2>/dev/null || cleanup_rc=1
    LOCK_OWNED='NO'
  fi

  if [[ "${DRY_RUN}" == 'NO' && -n "$(git status --porcelain=v1 --untracked-files=all)" ]]; then
    cleanup_rc=1
    STOP_REASON_CODE='E_WORKTREE_CHANGED'
    FAILED_PHASE='TEARDOWN'
    FIRST_FAILURE='worktree is not clean after runtime teardown'
  fi

  if [[ ${rc} -eq 0 && ${cleanup_rc} -eq 0 && "${STOP_REASON_CODE}" == 'OK' ]]; then
    RESULT='PASS'
  else
    RESULT='STOP'
    rc=1
  fi
  write_report
  exit "${rc}"
}

fail() {
  STOP_REASON_CODE="$1"
  FAILED_PHASE="$2"
  FIRST_FAILURE="$3"
  exit "${4:-1}"
}

bootstrap_field() {
  printf '%s\n' "${BOOTSTRAP_OUTPUT}" | sed -n "s/^$1=//p" | head -n 1
}

psql_exec() {
  docker exec -i "${DB_CONTAINER}" psql -U postgres -d postgres -X -qAt --no-psqlrc -v ON_ERROR_STOP=1 "$@"
}

psql_file() {
  local src="$1" dest
  shift
  dest="/tmp/$(basename "${src}")"
  docker cp "${REPO_ROOT}/${src}" "${DB_CONTAINER}:${dest}" >/dev/null
  psql_exec "$@" -f "${dest}"
}

conc_psql() {
  local logfile="$1"
  shift
  docker exec -i "${DB_CONTAINER}" psql -U postgres -d postgres -X -qAt --no-psqlrc \
    -v ON_ERROR_STOP=1 "$@" -f "${CONC_DEST}" >"${logfile}" 2>&1
}

run_conc_case() {
  local name="$1" flag="$2" expected_marker="$3"
  local log_a="${EVIDENCE_DIR}/conc-${name}-A.log"
  local log_b="${EVIDENCE_DIR}/conc-${name}-B.log"
  local verify_log="${EVIDENCE_DIR}/conc-${name}-verify.log"
  local pid_a pid_b rc_a=0 rc_b=0 ok_count loser_count

  conc_psql "${log_a}" \
    -v mode_seed=0 -v mode_run=1 -v mode_verify=0 -v mode_teardown=0 \
    -v case_c1=0 -v case_c2=0 -v case_c3=0 -v case_c4=0 -v case_c5=0 \
    -v "${flag}=1" -v session_a=1 -v session_label=A &
  pid_a=$!
  conc_psql "${log_b}" \
    -v mode_seed=0 -v mode_run=1 -v mode_verify=0 -v mode_teardown=0 \
    -v case_c1=0 -v case_c2=0 -v case_c3=0 -v case_c4=0 -v case_c5=0 \
    -v "${flag}=1" -v session_a=0 -v session_label=B &
  pid_b=$!

  if wait "${pid_a}"; then rc_a=0; else rc_a=$?; fi
  if wait "${pid_b}"; then rc_b=0; else rc_b=$?; fi
  printf 'session=A rc=%s\nsession=B rc=%s\n' "${rc_a}" "${rc_b}" >"${EVIDENCE_DIR}/conc-${name}-session-status.log"

  conc_psql "${verify_log}" \
    -v mode_seed=0 -v mode_run=0 -v mode_verify=1 -v mode_teardown=0 \
    -v case_c1=0 -v case_c2=0 -v case_c3=0 -v case_c4=0 -v case_c5=0 \
    -v "${flag}=1" -v session_a=0 -v session_label=verify || return 1
  grep -Eq "^${expected_marker}" "${verify_log}" || return 1

  case "${name}" in
    c1|c2|c4|c5)
      [[ "${rc_a}" -eq 0 && "${rc_b}" -eq 0 ]] || return 1
      ;;
    c3)
      [[ $(( (rc_a == 0 ? 1 : 0) + (rc_b == 0 ? 1 : 0) )) -eq 1 ]] || return 1
      ok_count="$(grep -h -F -c '"ok": true' "${log_a}" "${log_b}" | awk '{s += $1} END {print s + 0}')"
      loser_count="$(grep -h -c 'STALE_EXPECTED_VERSION' "${log_a}" "${log_b}" | awk '{s += $1} END {print s + 0}')"
      [[ "${ok_count}" -eq 1 && "${loser_count}" -ge 1 ]] || return 1
      EXACTLY_ONE_WINNER='PASS'
      LOSER_STATE='STALE_EXPECTED_VERSION'
      ;;
  esac
}

[[ $# -le 1 ]] || { echo 'usage: run-u15c-runtime.sh [--dry-run]' >&2; exit 2; }
if [[ $# -eq 1 ]]; then
  [[ "$1" == '--dry-run' ]] || { echo 'usage: run-u15c-runtime.sh [--dry-run]' >&2; exit 2; }
  DRY_RUN='YES'
fi

[[ -n "${EVIDENCE_DIR}" && "${EVIDENCE_DIR}" == /* ]] || {
  echo 'TC_U15C_EVIDENCE_DIR_ABSOLUTE_REQUIRED' >&2
  exit 2
}
mkdir -p "${EVIDENCE_DIR}"
trap cleanup EXIT
trap 'fail E_INTERRUPTED PRECHECK "interrupted" 130' INT TERM

[[ "$(uname -s)" == 'Darwin' ]] || fail 'E_HOST_NOT_MACOS' 'PRECHECK_HOST' 'Darwin required' 10
command -v node >/dev/null 2>&1 || fail 'E_NODE_MISSING' 'PRECHECK_HOST' 'node missing' 11
[[ "$(node -p 'Number(process.versions.node.split(".")[0])')" -ge 22 ]] || fail 'E_NODE_VERSION' 'PRECHECK_HOST' 'Node >=22 required' 11
command -v docker >/dev/null 2>&1 || fail 'E_DOCKER_MISSING' 'PRECHECK_HOST' 'docker missing' 12
docker info >"${EVIDENCE_DIR}/docker-info.log" 2>&1 || fail 'E_DOCKER_NOT_RUNNING' 'PRECHECK_HOST' 'Docker daemon unavailable' 13
command -v supabase >/dev/null 2>&1 || fail 'E_SUPABASE_CLI_MISSING' 'PRECHECK_HOST' 'Supabase CLI missing' 14
SUPABASE_TELEMETRY_DISABLED=1 supabase --version >"${EVIDENCE_DIR}/supabase-version.log" 2>&1 || fail 'E_SUPABASE_CLI_FAILED' 'PRECHECK_HOST' 'Supabase CLI version failed' 14

FINAL_HEAD="$(git rev-parse HEAD)"
[[ "$(git branch --show-current)" == "${EXPECTED_BRANCH}" ]] || fail 'E_WRONG_BRANCH' 'PRECHECK_REPO' 'unexpected branch' 20
git merge-base --is-ancestor "${BASE_HEAD}" HEAD || fail 'E_BASE_NOT_ANCESTOR' 'PRECHECK_REPO' 'canonical base is not ancestor' 21
[[ -z "$(git status --porcelain=v1 --untracked-files=all)" ]] || fail 'E_WORKTREE_DIRTY' 'PRECHECK_REPO' 'runtime requires committed clean worktree' 22
[[ ! -e "$(git rev-parse --git-path index.lock)" ]] || fail 'E_INDEX_LOCK_PRESENT' 'PRECHECK_REPO' 'index.lock present' 23
[[ -z "$(find "$(git rev-parse --git-common-dir)" -type f -name '*.lock' -print -quit 2>/dev/null)" ]] || fail 'E_GIT_LOCK_PRESENT' 'PRECHECK_REPO' 'shared Git lock present' 23
for file in "${MIGRATION}" "${MATRIX}" "${CONC}" "${AUTHZ_NEGATIVE}" "${CONTRACT_U15C}" "${CONTRACT_U15D}"; do
  [[ -f "${file}" ]] || fail 'E_ARTIFACT_MISSING' 'PRECHECK_REPO' "missing ${file}" 24
done

if ! node -e '
  import(process.argv[1]).then((g) => {
    const findings = g.inspectEnvForRemote(process.env);
    if (findings.length) process.exit(1);
  });
' "file://${REPO_ROOT}/tools/local-db/lib/guards.mjs" >/dev/null 2>&1; then
  fail 'E_REMOTE_ENV_PRESENT' 'PRECHECK_REMOTE_GUARD' 'remote-like environment detected' 50
fi

node "${CONTRACT_U15C}" >"${EVIDENCE_DIR}/contract-u15c.log" 2>&1 || fail 'E_RPC_CONTRACT_FAILED' 'STATIC_RPC_CONTRACT' 'U15C contract failed' 60
node "${CONTRACT_U15D}" >"${EVIDENCE_DIR}/contract-u15d-related.log" 2>&1 || fail 'E_RELATED_RPC_CONTRACT_FAILED' 'STATIC_RPC_CONTRACT' 'related U15D contract failed' 61
STATIC_RPC_CONTRACT='PASS'

if [[ "${DRY_RUN}" == 'YES' ]]; then
  STOP_REASON_CODE='OK'
  FAILED_PHASE='-'
  FIRST_FAILURE='-'
  exit 0
fi

for pattern in 'tools/local-db/[r]un-local-db-harness' 'tools/local-db/[r]un-recovery-v2' 'tools/local-db/[r]un-u15d-runtime' 'tools/local-db/[r]un-media-pipeline-runtime'; do
  pgrep -f "${pattern}" >/dev/null 2>&1 && fail 'E_ACTIVE_LOCAL_DB_RUNNER' 'PRECHECK_EXCLUSIVE_WRITER' "active runner ${pattern}" 62
done
[[ -z "$(active_supabase_stacks)" ]] || fail 'E_INITIAL_SUPABASE_STACKS_PRESENT' 'PRECHECK_EXCLUSIVE_WRITER' 'another Supabase stack is active' 63
mkdir "${LOCK_DIR}" 2>/dev/null || fail 'E_WRITER_LOCK_PRESENT' 'PRECHECK_EXCLUSIVE_WRITER' 'U15C writer lock present' 64
LOCK_OWNED='YES'

BOOTSTRAP_ATTEMPTED='YES'
BOOTSTRAP_OUTPUT="$(SUPABASE_TELEMETRY_DISABLED=1 node tools/local-db/lib/bootstrap.mjs \
  --project-id "${PROJECT_ID}" --db-port "${DB_PORT}" --runtime-dir "${RUNTIME_DIR}" \
  --reset-runtime 2>"${EVIDENCE_DIR}/bootstrap.log")" || fail 'E_BOOTSTRAP_FAILED' 'SUPABASE_START' 'ephemeral bootstrap failed' 70
DB_CONTAINER="$(bootstrap_field BOOTSTRAP_CID)"
[[ "${DB_CONTAINER}" == "supabase_db_${PROJECT_ID}" ]] || fail 'E_DB_CONTAINER_IDENTITY' 'SUPABASE_START' 'container identity mismatch' 71
SUPABASE_TELEMETRY_DISABLED=1 supabase db reset --workdir "${RUNTIME_DIR}" >"${EVIDENCE_DIR}/migrations.log" 2>&1 || fail 'E_MIGRATIONS_FAILED' 'MIGRATIONS' 'full migration reset failed' 72
[[ "$(psql_exec -c "select coalesce(to_regprocedure('${RPC_SIGNATURE}')::text,'MISSING')")" != 'MISSING' ]] || fail 'E_RPC_MISSING' 'RPC_RUNTIME_CONTRACT' 'exact RPC signature missing' 73

psql_file "${MATRIX}" >"${EVIDENCE_DIR}/transaction-matrix.log" 2>&1 || fail 'E_TRANSACTION_MATRIX_FAILED' 'TRANSACTION_MATRIX' 'transaction matrix failed' 80
grep -q 'U15C_TRANSACTION_MATRIX=PASS' "${EVIDENCE_DIR}/transaction-matrix.log" || fail 'E_TRANSACTION_MATRIX_MARKER' 'TRANSACTION_MATRIX' '25/25 PASS marker missing' 80
TRANSACTION_CASES='25/25'
ROLLBACK='PASS'

CONC_DEST="/tmp/$(basename "${CONC}")"
docker cp "${REPO_ROOT}/${CONC}" "${DB_CONTAINER}:${CONC_DEST}" >/dev/null || fail 'E_CONCURRENCY_COPY' 'CONCURRENCY_MATRIX' 'matrix copy failed' 81
conc_psql "${EVIDENCE_DIR}/conc-seed.log" \
  -v mode_seed=1 -v mode_run=0 -v mode_verify=0 -v mode_teardown=0 \
  -v case_c1=0 -v case_c2=0 -v case_c3=0 -v case_c4=0 -v case_c5=0 \
  -v session_a=0 -v session_label=seed || fail 'E_CONCURRENCY_SEED' 'CONCURRENCY_MATRIX' 'seed failed' 82

CONC_PASS=0
for spec in \
  'c1:case_c1:TC_C1_VERIFY=PASS' \
  'c2:case_c2:TC_C2_VERIFY=PASS' \
  'c3:case_c3:TC_C3_EXACTLY_ONE_WINNER=PASS' \
  'c4:case_c4:TC_C4_VERIFY=PASS' \
  'c5:case_c5:TC_C5_VERIFY=PASS'; do
  name="${spec%%:*}"
  rest="${spec#*:}"
  flag="${rest%%:*}"
  marker="${rest#*:}"
  if run_conc_case "${name}" "${flag}" "${marker}"; then
    CONC_PASS=$((CONC_PASS + 1))
  else
    fail 'E_CONCURRENCY_CASE_FAILED' 'CONCURRENCY_MATRIX' "${name} failed" 83
  fi
done
CONCURRENCY_CASES="${CONC_PASS}/5"
TWO_SESSION_RUNTIME='PASS'
IDEMPOTENCY='PASS'

conc_psql "${EVIDENCE_DIR}/conc-teardown.log" \
  -v mode_seed=0 -v mode_run=0 -v mode_verify=0 -v mode_teardown=1 \
  -v case_c1=0 -v case_c2=0 -v case_c3=0 -v case_c4=0 -v case_c5=0 \
  -v session_a=0 -v session_label=teardown || fail 'E_SQL_TEARDOWN_FAILED' 'ROLLBACK_TEARDOWN' 'fixture teardown failed' 84
grep -Fxq 'TC_CONCURRENCY_RESIDUAL_ROWS=0' "${EVIDENCE_DIR}/conc-teardown.log" || fail 'E_RESIDUAL_ROWS' 'ROLLBACK_TEARDOWN' 'fixture rows remain' 85
RESIDUAL_ROWS='0'

psql_file "${AUTHZ_NEGATIVE}" >"${EVIDENCE_DIR}/authz-negative.log" 2>&1 || fail 'E_NEGATIVE_AUTH_FAILED' 'NEGATIVE_AUTH' 'related AuthZ negative suite failed' 86
NEGATIVE_AUTH='PASS'

ACL_CHECK="$(psql_exec -c "select not (has_table_privilege('authenticated','public.edge_idempotency','SELECT') or has_table_privilege('authenticated','public.edge_idempotency','INSERT') or has_table_privilege('anon','public.edge_idempotency','SELECT')) and has_table_privilege('service_role','public.edge_idempotency','SELECT')")"
[[ "${ACL_CHECK}" == 't' ]] || fail 'E_ACL_REGRESSION' 'NEGATIVE_AUTH' 'edge_idempotency ACL mismatch' 87

STOP_REASON_CODE='OK'
FAILED_PHASE='-'
FIRST_FAILURE='-'
exit 0
