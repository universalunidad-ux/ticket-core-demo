#!/usr/bin/env bash
set -Eeuo pipefail

UNIT="TC-Q2-B130-003-004-CANONICAL-WRITER-01"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
PROJECT_ID="tc_q2_canonical_runtime"
DB_PORT="${TC_Q2_DB_PORT:-56300}"
RUNTIME_DIR=""
EVIDENCE_DIR=""
STATE_FILE=""
CREDENTIAL_FILE=""
EDGE_PID=""
STACK_STARTED=NO
AUTH_CREATED=NO
FIXTURES_CREATED=NO
B130_003=FAIL
B130_004=FAIL
TEARDOWN_STATUS=FAIL
FINALIZED=NO

fail() {
  printf 'STOP_CODE=%s\n' "$1" >&2
  return 1
}

require_local_url() {
  node -e '
    const value = new URL(process.argv[1]);
    const hosts = new Set(["127.0.0.1", "localhost", "::1"]);
    if (value.protocol !== "http:" || !hosts.has(value.hostname.replace(/^\\[|\\]$/g, ""))) process.exit(2);
  ' "$1" || fail "E_REMOTE_SUPABASE_DENIED"
}

status_field() {
  local key="$1" file="$2" value
  value="$(sed -n "s/^${key}=//p" "$file" | tail -n 1)"
  value="${value%\"}"
  value="${value#\"}"
  [[ -n "$value" ]] || fail "E_STATUS_FIELD_${key}"
  printf '%s' "$value"
}

state_uid() {
  node -e '
    const state = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
    const row = state.users.find(item => item.key === process.argv[2]);
    if (!row?.id) process.exit(2);
    process.stdout.write(row.id);
  ' "$STATE_FILE" "$1"
}

stop_edge() {
  if [[ -n "$EDGE_PID" ]] && kill -0 "$EDGE_PID" 2>/dev/null; then
    kill -TERM "$EDGE_PID"
    for _ in {1..40}; do
      kill -0 "$EDGE_PID" 2>/dev/null || break
      sleep 0.25
    done
    if kill -0 "$EDGE_PID" 2>/dev/null; then
      kill -KILL "$EDGE_PID"
    fi
    wait "$EDGE_PID" 2>/dev/null || true
  fi
  [[ -z "$EDGE_PID" ]] || ! kill -0 "$EDGE_PID" 2>/dev/null
}

teardown() {
  local rc=0
  stop_edge || rc=1

  if [[ "$FIXTURES_CREATED" == YES && -s "$STATE_FILE" ]]; then
    psql "$LOCAL_DATABASE_URL" \
      -v ON_ERROR_STOP=1 \
      -v client_a_uid="$(state_uid client_a)" \
      -v client_b_uid="$(state_uid client_b)" \
      -v support_uid="$(state_uid support)" \
      -v admin_uid="$(state_uid admin)" \
      -f "$REPO/supabase/tests/l130_m1_synthetic_teardown.sql" \
      >"$EVIDENCE_DIR/m1-fixture-teardown.log" 2>&1 || rc=1
    FIXTURES_CREATED=NO
  fi

  if [[ "$AUTH_CREATED" == YES && -s "$STATE_FILE" ]]; then
    node "$REPO/tools/l130-authenticated-qa/m1-runtime.mjs" auth-down "$STATE_FILE" \
      >"$EVIDENCE_DIR/m1-auth-down.log" 2>&1 || rc=1
    AUTH_CREATED=NO
  fi

  if [[ -n "$CREDENTIAL_FILE" && -e "$CREDENTIAL_FILE" ]]; then
    node "$REPO/tools/l130-authenticated-qa/local-credential-material.mjs" \
      destroy "$CREDENTIAL_FILE" || rc=1
  fi
  unset TC_L130_CLIENT_A_PASSWORD
  unset TC_L130_CLIENT_B_PASSWORD
  unset TC_L130_SUPPORT_PASSWORD
  unset TC_L130_ADMIN_PASSWORD

  if [[ "$STACK_STARTED" == YES && -n "$RUNTIME_DIR" ]]; then
    node "$REPO/tools/local-db/lib/bootstrap.mjs" \
      --project-id "$PROJECT_ID" \
      --runtime-dir "$RUNTIME_DIR" \
      --stop --remove-runtime \
      >"$EVIDENCE_DIR/bootstrap-stop.log" 2>&1 || rc=1
    STACK_STARTED=NO
  fi

  if [[ -n "$RUNTIME_DIR" && -e "$RUNTIME_DIR" ]]; then
    rc=1
  fi
  if [[ "$rc" -eq 0 ]]; then TEARDOWN_STATUS=PASS; fi
  return "$rc"
}

render_markers() {
  local aggregate=FAIL
  if [[ "$B130_003" == PASS && "$B130_004" == PASS && "$TEARDOWN_STATUS" == PASS ]]; then
    aggregate=PASS
  fi
  printf 'B130_003_EDGE_E2E=%s\n' "$B130_003"
  printf 'B130_004_EDGE_E2E=%s\n' "$B130_004"
  printf 'Q2_B130_003_004_EDGE_E2E=%s\n' "$aggregate"
  printf 'TEARDOWN=%s\n' "$TEARDOWN_STATUS"
}

on_exit() {
  local original_rc=$?
  if [[ "$FINALIZED" != YES ]]; then
    teardown || true
    render_markers
  fi
  exit "$original_rc"
}
trap on_exit EXIT

[[ "${1:-}" == "--evidence-dir" && -n "${2:-}" && $# -eq 2 ]] || fail "E_USAGE"
EVIDENCE_DIR="$(mkdir -p "$2" && cd "$2" && pwd -P)"
STATE_FILE="$EVIDENCE_DIR/m1-auth-state.json"

[[ "$(git -C "$REPO" rev-parse --show-toplevel)" == "$REPO" ]] || fail "E_REPO_IDENTITY"
EXPECTED_BRANCH="${
  TC_CANONICAL_BRANCH:-
  test/l130-authenticated-qa-prep-20260728
}"
EXPECTED_BRANCH="$(
  printf '%s' "$EXPECTED_BRANCH" |
  tr -d '[:space:]'
)"
EXPECTED_HEAD="${TC_CANONICAL_HEAD:-}"

ACTUAL_BRANCH="$(
  git -C "$REPO" branch --show-current
)"
ACTUAL_HEAD="$(
  git -C "$REPO" rev-parse HEAD
)"

[[ "$ACTUAL_BRANCH" == "$EXPECTED_BRANCH" ]] ||
  fail "E_BRANCH_IDENTITY"

[[ -z "$EXPECTED_HEAD" || "$ACTUAL_HEAD" == "$EXPECTED_HEAD" ]] ||
  fail "E_HEAD_IDENTITY"
[[ -z "$(find "$(git -C "$REPO" rev-parse --git-common-dir)" -type f -name '*.lock' -print -quit)" ]] || fail "E_GIT_LOCK"
for name in SUPABASE_ACCESS_TOKEN SUPABASE_PROJECT_ID SUPABASE_PROJECT_REF STAGING_URL DATABASE_URL; do
  [[ -z "${!name:-}" ]] || fail "E_REMOTE_ENV_${name}"
done

RUNTIME_DIR="$(mktemp -d "$REPO/tools/local-db/q2-canonical-runtime.XXXXXX")"
CREDENTIAL_FILE="$RUNTIME_DIR/.l130-credentials.env"
node "$REPO/tools/l130-authenticated-qa/local-credential-material.mjs" \
  create "$CREDENTIAL_FILE"
# El archivo sólo contiene valores base64url o fixtures sin caracteres de
# control, está bajo el runtime efímero y fue creado O_EXCL con modo 0600.
# shellcheck disable=SC1090
source "$CREDENTIAL_FILE"

BOOTSTRAP_FILE="$EVIDENCE_DIR/bootstrap.env"
install -m 600 /dev/null "$BOOTSTRAP_FILE"
node "$REPO/tools/local-db/lib/bootstrap.mjs" \
  --project-id "$PROJECT_ID" \
  --db-port "$DB_PORT" \
  --runtime-dir "$RUNTIME_DIR" \
  --reset-runtime >"$BOOTSTRAP_FILE" 2>"$EVIDENCE_DIR/bootstrap.log"
STACK_STARTED=YES

STATUS_FILE="$EVIDENCE_DIR/supabase-status.env"
supabase status -o env --workdir "$RUNTIME_DIR" >"$STATUS_FILE" 2>"$EVIDENCE_DIR/supabase-status.log"
chmod 600 "$STATUS_FILE"
export LOCAL_SUPABASE_URL="$(status_field API_URL "$STATUS_FILE")"
export LOCAL_SUPABASE_ANON_KEY="$(status_field ANON_KEY "$STATUS_FILE")"
export LOCAL_SUPABASE_SERVICE_ROLE_KEY="$(status_field SERVICE_ROLE_KEY "$STATUS_FILE")"
export LOCAL_DATABASE_URL="$(status_field DB_URL "$STATUS_FILE")"
require_local_url "$LOCAL_SUPABASE_URL"

node "$REPO/tools/l130-authenticated-qa/m1-runtime.mjs" auth-up "$STATE_FILE" \
  >"$EVIDENCE_DIR/m1-auth-up.log" 2>&1
AUTH_CREATED=YES

psql "$LOCAL_DATABASE_URL" \
  -v ON_ERROR_STOP=1 \
  -v client_a_uid="$(state_uid client_a)" \
  -v client_b_uid="$(state_uid client_b)" \
  -v support_uid="$(state_uid support)" \
  -v admin_uid="$(state_uid admin)" \
  -f "$REPO/supabase/tests/l130_m1_synthetic_seed.sql" \
  >"$EVIDENCE_DIR/m1-fixture-seed.log" 2>&1
FIXTURES_CREATED=YES

node "$REPO/tools/l130-authenticated-qa/m1-runtime.mjs" api-e2e "$STATE_FILE" \
  >"$EVIDENCE_DIR/m1-api-e2e.log" 2>&1

node "$REPO/tools/l130-authenticated-qa/edge-runtime-serve.mjs" \
  --runtime-dir "$RUNTIME_DIR" \
  --evidence-dir "$EVIDENCE_DIR" \
  >"$EVIDENCE_DIR/edge-supervisor.log" 2>&1 &
EDGE_PID=$!
for _ in {1..180}; do
  grep -qx 'EDGE_RUNTIME_READY=PASS' "$EVIDENCE_DIR/edge-supervisor.log" 2>/dev/null && break
  kill -0 "$EDGE_PID" 2>/dev/null || fail "E_EDGE_PROCESS_EXITED"
  sleep 0.5
done
grep -qx 'EDGE_RUNTIME_READY=PASS' "$EVIDENCE_DIR/edge-supervisor.log" || fail "E_EDGE_NOT_READY"

node "$REPO/tools/l130-authenticated-qa/edge-contract-http.mjs" "$STATE_FILE" \
  2>&1 | tee "$EVIDENCE_DIR/edge-contract-http.log"
[[ "${PIPESTATUS[0]}" -eq 0 ]] || fail "E_EDGE_HTTP"
grep -qx 'B130_003_EDGE_E2E=PASS' "$EVIDENCE_DIR/edge-contract-http.log" || fail "E_B130_003_MARKER"
B130_003=PASS

node "$REPO/tools/l130-authenticated-qa/m1-response-visibility.mjs" "$STATE_FILE" \
  2>&1 | tee "$EVIDENCE_DIR/m1-response-visibility.log"
[[ "${PIPESTATUS[0]}" -eq 0 ]] || fail "E_RESPONSE_VISIBILITY"
grep -qx 'B130_004_EDGE_E2E=PASS' "$EVIDENCE_DIR/m1-response-visibility.log" || fail "E_B130_004_MARKER"
B130_004=PASS

teardown
render_markers | tee "$EVIDENCE_DIR/q2-runtime-markers.txt"
grep -qx 'Q2_B130_003_004_EDGE_E2E=PASS' "$EVIDENCE_DIR/q2-runtime-markers.txt"
FINALIZED=YES
trap - EXIT
