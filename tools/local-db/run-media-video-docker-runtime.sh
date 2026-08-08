#!/bin/bash
set -Eeuo pipefail
IFS=$'\n\t'

REPO_ROOT="$(
  cd "$(dirname "${BASH_SOURCE[0]}")/../.." >/dev/null 2>&1 &&
  pwd
)"

cd "$REPO_ROOT"

OUT="${1:-}"
START_PORT="${2:-54369}"

test -n "$OUT" || {
  echo "RESULT=FAIL"
  echo "REASON_CODE=OUTPUT_DIR_REQUIRED"
  exit 2
}

mkdir -p "$OUT"

FINAL="$OUT/00_FINAL.txt"
HARNESS_LOG="$OUT/01_LOCAL_DB_HARNESS.log"
MATRIX_LOG="$OUT/02_MEDIA_VIDEO_MATRIX.log"
SETUP_LOG="$OUT/03_CONCURRENCY_SETUP.log"
RACE_A_LOG="$OUT/04_CONCURRENCY_A.log"
RACE_B_LOG="$OUT/05_CONCURRENCY_B.log"
VERIFY_LOG="$OUT/06_CONCURRENCY_VERIFY.log"
TEARDOWN_LOG="$OUT/07_CONCURRENCY_TEARDOWN.log"
STOP_LOG="$OUT/08_SUPABASE_STOP.log"

RUNTIME_DIR="$REPO_ROOT/tools/local-db/.runtime"
EXPECTED_CID="supabase_db_tc_local_db_harness"

CID=""
DB_PORT=""
FIXTURE_TICKET_ID=""
FIXTURE_ACTOR_ID=""
TEARDOWN_RESULT="NOT_RUN"
TEARDOWN_DONE="NO"

cleanup() {
  rc="$?"

  trap - EXIT
  set +e

  if test -n "$CID" &&
     test -n "$FIXTURE_TICKET_ID" &&
     test "$TEARDOWN_DONE" != "YES" &&
     docker ps \
       --format '{{.Names}}' |
       grep -qx "$CID"
  then
    docker exec -i "$CID" \
      psql \
      -X \
      -U postgres \
      -d postgres \
      -v ON_ERROR_STOP=1 \
      -v ticket_id="$FIXTURE_TICKET_ID" \
  -v actor_id="$FIXTURE_ACTOR_ID" \
  <supabase/tests/media_video_concurrency_teardown.sql \
      >"$TEARDOWN_LOG" 2>&1

    if test "$?" -eq 0; then
      TEARDOWN_RESULT="PASS"
    else
      TEARDOWN_RESULT="FAIL"
    fi
  fi

  supabase stop \
    --workdir "$RUNTIME_DIR" \
    >"$STOP_LOG" 2>&1 ||
    true

  if test "$rc" -ne 0 &&
     test ! -s "$FINAL"
  then
    {
      echo "RESULT=FAIL"
      echo "REASON_CODE=UNEXPECTED_RUNTIME_FAILURE"
      echo "EXIT_CODE=$rc"
      echo "TEARDOWN=$TEARDOWN_RESULT"
      echo "HOST_PSQL_USED=NO"
      echo "DOCKER_PSQL_USED=YES"
      echo "REMOTE_OPERATIONS=NO"
    } >"$FINAL"
  fi

  exit "$rc"
}

trap cleanup EXIT

fail() {
  {
    echo "RESULT=FAIL"
    echo "REASON_CODE=$1"
    echo "REASON_DETAIL=$2"
    echo "DB_PORT=${DB_PORT:-NONE}"
    echo "CONTAINER=${CID:-NONE}"
    echo "TEARDOWN=$TEARDOWN_RESULT"
    echo "HOST_PSQL_USED=NO"
    echo "DOCKER_PSQL_USED=YES"
    echo "REMOTE_OPERATIONS=NO"
  } >"$FINAL"

  exit 1
}

case "$(git branch --show-current)" in
  test/*)
    ;;
  *)
    fail \
      "E_WRONG_BRANCH" \
      "La rama runtime debe usar prefijo test/"
    ;;
esac

for command_name in \
  node \
  docker \
  supabase \
  python3 \
  lsof
do
  command -v "$command_name" >/dev/null 2>&1 ||
    fail \
      "REQUIRED_COMMAND_MISSING" \
      "$command_name"
done

docker info >/dev/null 2>&1 ||
  fail \
    "DOCKER_NOT_AVAILABLE" \
    "Docker no responde."

if docker ps \
  --format '{{.Names}}' |
  grep -qx "$EXPECTED_CID"
then
  fail \
    "LOCAL_HARNESS_ALREADY_ACTIVE" \
    "$EXPECTED_CID"
fi

choose_port() {
  candidate="$START_PORT"
  attempts=0

  while test "$attempts" -lt 20
  do
    api_port="$((candidate + 1))"
    shadow_port="$((candidate + 1000))"
    busy="NO"

    for port in \
      "$candidate" \
      "$api_port" \
      "$shadow_port"
    do
      if lsof \
        -nP \
        -iTCP:"$port" \
        -sTCP:LISTEN \
        >/dev/null 2>&1
      then
        busy="YES"
        break
      fi
    done

    if test "$busy" = "NO"; then
      printf '%s\n' "$candidate"
      return 0
    fi

    candidate="$((candidate + 3))"
    attempts="$((attempts + 1))"
  done

  return 1
}

DB_PORT="$(choose_port)" ||
  fail \
    "NO_FREE_LOCAL_DB_PORT_SET" \
    "start=$START_PORT"

tools/local-db/run-local-db-harness.sh \
  --keep-up \
  --db-port "$DB_PORT" \
  >"$HARNESS_LOG" 2>&1 ||
  fail \
    "BASELINE_LOCAL_DB_HARNESS_FAILED" \
    "$HARNESS_LOG"

CID="$(
  docker ps \
    --format '{{.Names}}' |
  awk -v expected="$EXPECTED_CID" '
    $0 == expected { print }
  '
)"

CID_COUNT="$(
  printf '%s\n' "$CID" |
  awk 'NF {count++} END {print count + 0}'
)"

test "$CID_COUNT" -eq 1 ||
  fail \
    "LOCAL_DB_CONTAINER_NOT_UNIQUE" \
    "expected=$EXPECTED_CID count=$CID_COUNT actual=$CID"

docker exec "$CID" \
  psql --version \
  >"$OUT/01A_CONTAINER_PSQL_VERSION.txt" 2>&1 ||
  fail \
    "CONTAINER_PSQL_NOT_AVAILABLE" \
    "$CID"

FIXTURE_TICKET_ID="10000000-0000-0000-0000-0000000000aa"
FIXTURE_ACTOR_ID="00000000-0000-0000-0000-000000000001"

docker exec -i "$CID" \
  psql \
  -X \
  -U postgres \
  -d postgres \
  -v ON_ERROR_STOP=1 \
  -v ticket_id="$FIXTURE_TICKET_ID" \
  -v actor_id="$FIXTURE_ACTOR_ID" \
  <supabase/tests/media_video_local_fixture_seed.sql \
  >"$OUT/01B_MEDIA_FIXTURE_SEED.log" 2>&1 ||
  fail \
    "MEDIA_LOCAL_FIXTURE_SEED_FAILED" \
    "$OUT/01B_MEDIA_FIXTURE_SEED.log"

{
  echo "FIXTURE_MODE=SYNTHETIC_LOCAL_ONLY"
  echo "FIXTURE_TICKET_ID=$FIXTURE_TICKET_ID"
  echo "FIXTURE_ACTOR_ID=$FIXTURE_ACTOR_ID"
} >"$OUT/01C_MEDIA_FIXTURE.txt"


docker exec -i "$CID" \
  psql \
  -X \
  -U postgres \
  -d postgres \
  -v ON_ERROR_STOP=1 \
  -v ticket_id="$FIXTURE_TICKET_ID" \
  <supabase/tests/media_video_runtime_matrix.sql \
  >"$MATRIX_LOG" 2>&1 ||
  fail \
    "MEDIA_VIDEO_MATRIX_FAILED" \
    "$MATRIX_LOG"

MATRIX_PASS_COUNT="$(
  grep -c \
    'PASS MEDIA-VIDEO-MATRIX case=' \
    "$MATRIX_LOG" ||
  true
)"

test "$MATRIX_PASS_COUNT" -eq 9 ||
  fail \
    "MEDIA_VIDEO_MATRIX_PASS_COUNT_INVALID" \
    "expected=9 actual=$MATRIX_PASS_COUNT"

docker exec -i "$CID" \
  psql \
  -X \
  -U postgres \
  -d postgres \
  -v ON_ERROR_STOP=1 \
  -v ticket_id="$FIXTURE_TICKET_ID" \
  <supabase/tests/media_video_concurrency_setup.sql \
  >"$SETUP_LOG" 2>&1 ||
  fail \
    "MEDIA_VIDEO_CONCURRENCY_SETUP_FAILED" \
    "$SETUP_LOG"

SESSION_COUNT=10
SUCCESS_COUNT=0
FAILURE_COUNT=0
LOSER_REASON_COUNT=0
LAUNCHED_COUNT=0
WAITED_COUNT=0

CONCURRENCY_SUMMARY_LOG="$OUT/04_CONCURRENCY_SUMMARY.log"

: >"$CONCURRENCY_SUMMARY_LOG"

START_AT="$(
  docker exec "$CID" \
    psql \
    -X \
    -U postgres \
    -d postgres \
    -Atq \
    -v ON_ERROR_STOP=1 \
    -c "
      select (
        clock_timestamp()
        + interval '8 seconds'
      )::text
    " |
  tr -d '\r\n'
)"

test -n "$START_AT" ||
  fail \
    "CONCURRENCY_START_AT_NOT_RESOLVED" \
    "$CONCURRENCY_SUMMARY_LOG"

SLOT=1

while test "$SLOT" -le "$SESSION_COUNT"
do
  SUFFIX="$(
    printf '%x' "$((160 + SLOT))"
  )"

  ADJUNTO_ID="20000000-0000-0000-0000-0000000000${SUFFIX}"
  SLOT_LOG="$OUT/04_CONCURRENCY_SLOT_${SLOT}.log"
  STATUS_LOG="$OUT/04_CONCURRENCY_SLOT_${SLOT}.status"

  rm -f "$SLOT_LOG" "$STATUS_LOG"

  (
    set +e

    docker exec -i "$CID" \
      psql \
      -X \
      -U postgres \
      -d postgres \
      -v ON_ERROR_STOP=1 \
      -v start_at="$START_AT" \
      -v adjunto_id="$ADJUNTO_ID" \
      -v ticket_id="$FIXTURE_TICKET_ID" \
      <supabase/tests/media_video_concurrency_consume.sql \
      >"$SLOT_LOG" 2>&1

    SESSION_RC="$?"

    printf '%s\n' \
      "$SESSION_RC" \
      >"$STATUS_LOG"

    exit 0
  ) &

  eval "PID_${SLOT}=$!"

  LAUNCHED_COUNT="$((LAUNCHED_COUNT + 1))"
  SLOT="$((SLOT + 1))"
done

test "$LAUNCHED_COUNT" -eq 10 ||
  fail \
    "CONCURRENCY_LAUNCHED_COUNT_INVALID" \
    "expected=10 actual=$LAUNCHED_COUNT"

SLOT=1

while test "$SLOT" -le "$SESSION_COUNT"
do
  eval "PID=\${PID_${SLOT}:-}"

  test -n "$PID" ||
    fail \
      "CONCURRENCY_PID_MISSING" \
      "slot=$SLOT"

  wait "$PID" ||
    fail \
      "CONCURRENCY_WRAPPER_WAIT_FAILED" \
      "slot=$SLOT pid=$PID"

  WAITED_COUNT="$((WAITED_COUNT + 1))"
  SLOT="$((SLOT + 1))"
done

test "$WAITED_COUNT" -eq 10 ||
  fail \
    "CONCURRENCY_WAITED_COUNT_INVALID" \
    "expected=10 actual=$WAITED_COUNT"

SLOT=1

while test "$SLOT" -le "$SESSION_COUNT"
do
  SLOT_LOG="$OUT/04_CONCURRENCY_SLOT_${SLOT}.log"
  STATUS_LOG="$OUT/04_CONCURRENCY_SLOT_${SLOT}.status"

  test -f "$SLOT_LOG" ||
    fail \
      "CONCURRENCY_SLOT_LOG_MISSING" \
      "$SLOT_LOG"

  test -f "$STATUS_LOG" ||
    fail \
      "CONCURRENCY_STATUS_LOG_MISSING" \
      "$STATUS_LOG"

  RC="$(
    tr -d '[:space:]' \
      <"$STATUS_LOG"
  )"

  printf '%s\n' "$RC" |
    grep -Eq '^[0-9]+$' ||
    fail \
      "CONCURRENCY_STATUS_INVALID" \
      "slot=$SLOT value=$RC file=$STATUS_LOG"

  echo \
    "SLOT=$SLOT RC=$RC LOG=$SLOT_LOG STATUS=$STATUS_LOG" \
    >>"$CONCURRENCY_SUMMARY_LOG"

  if test "$RC" -eq 0; then
    SUCCESS_COUNT="$((SUCCESS_COUNT + 1))"

    grep -Eq \
      '(^|[[:space:]])15([[:space:]]|$)' \
      "$SLOT_LOG" ||
      fail \
        "CONCURRENCY_WINNER_OUTPUT_INVALID" \
        "$SLOT_LOG"
  else
    FAILURE_COUNT="$((FAILURE_COUNT + 1))"

    if grep -q \
      'E_MEDIA_AUTORIZACION_NO_DISPONIBLE' \
      "$SLOT_LOG"
    then
      LOSER_REASON_COUNT="$((LOSER_REASON_COUNT + 1))"
    else
      {
        echo "INVALID_LOSER_SLOT=$SLOT"
        echo "INVALID_LOSER_LOG=$SLOT_LOG"
        tail -n 100 "$SLOT_LOG"
      } >>"$CONCURRENCY_SUMMARY_LOG"
    fi
  fi

  SLOT="$((SLOT + 1))"
done

test "$SLOT" -eq 11 ||
  fail \
    "CONCURRENCY_SESSION_ACCOUNTING_INVALID" \
    "next_slot=$SLOT expected=11"

test "$SUCCESS_COUNT" -eq 1 ||
  fail \
    "CONCURRENCY_SUCCESS_COUNT_INVALID" \
    "sessions=$SESSION_COUNT successes=$SUCCESS_COUNT summary=$CONCURRENCY_SUMMARY_LOG"

test "$FAILURE_COUNT" -eq 9 ||
  fail \
    "CONCURRENCY_FAILURE_COUNT_INVALID" \
    "sessions=$SESSION_COUNT failures=$FAILURE_COUNT summary=$CONCURRENCY_SUMMARY_LOG"

test "$LOSER_REASON_COUNT" -eq 9 ||
  fail \
    "CONCURRENCY_LOSER_REASON_COUNT_INVALID" \
    "expected=9 actual=$LOSER_REASON_COUNT summary=$CONCURRENCY_SUMMARY_LOG"

docker exec -i "$CID" \
  psql \
  -X \
  -U postgres \
  -d postgres \
  -v ON_ERROR_STOP=1 \
  -v ticket_id="$FIXTURE_TICKET_ID" \
  <supabase/tests/media_video_concurrency_verify.sql \
  >"$VERIFY_LOG" 2>&1 ||
  fail \
    "MEDIA_VIDEO_CONCURRENCY_VERIFY_FAILED" \
    "$VERIFY_LOG"

grep -q \
  'PASS MEDIA-VIDEO-CONCURRENCY verify' \
  "$VERIFY_LOG" ||
  fail \
    "CONCURRENCY_VERIFY_MARKER_MISSING" \
    "$VERIFY_LOG"

docker exec -i "$CID" \
  psql \
  -X \
  -U postgres \
  -d postgres \
  -v ON_ERROR_STOP=1 \
  -v ticket_id="$FIXTURE_TICKET_ID" \
  -v actor_id="$FIXTURE_ACTOR_ID" \
  <supabase/tests/media_video_concurrency_teardown.sql \
  >"$TEARDOWN_LOG" 2>&1 ||
  fail \
    "MEDIA_VIDEO_CONCURRENCY_TEARDOWN_FAILED" \
    "$TEARDOWN_LOG"

TEARDOWN_RESULT="PASS"
TEARDOWN_DONE="YES"

{
  echo "RESULT=PASS"
  echo "MEDIA_VIDEO_DB_MIGRATIONS=PASS"
  echo "MEDIA_VIDEO_MATRIX=PASS"
  echo "MEDIA_VIDEO_MATRIX_CASES=9"
  echo "MEDIA_VIDEO_CONCURRENCY=PASS"
  echo "CONCURRENCY_SESSION_COUNT=$SESSION_COUNT"
  echo "CONCURRENCY_SUCCESS_COUNT=$SUCCESS_COUNT"
  echo "CONCURRENCY_FAILURE_COUNT=$FAILURE_COUNT"
  echo "CONCURRENCY_LOSER_REASON_COUNT=$LOSER_REASON_COUNT"
  echo "CONCURRENCY_START_AT=$START_AT"
  echo "DB_PORT=$DB_PORT"
  echo "CONTAINER=$CID"
  echo "TEARDOWN=$TEARDOWN_RESULT"
  echo "HOST_PSQL_USED=NO"
  echo "DOCKER_PSQL_USED=YES"
  echo "REMOTE_OPERATIONS=NO"
} >"$FINAL"
