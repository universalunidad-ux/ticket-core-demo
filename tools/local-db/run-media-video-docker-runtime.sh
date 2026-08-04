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

TICKETS_TOTAL="$(
  docker exec "$CID" \
    psql \
    -X \
    -U postgres \
    -d postgres \
    -Atq \
    -v ON_ERROR_STOP=1 \
    -c "
      select count(*)
      from public.tickets
    " |
  tr -d '\r\n'
)"

FIXTURE_TICKET_ID="$(
  docker exec "$CID" \
    psql \
    -X \
    -U postgres \
    -d postgres \
    -Atq \
    -v ON_ERROR_STOP=1 \
    -c "
      select t.id::text
      from public.tickets t
      order by
        (
          select count(*)
          from public.media_video_registro m
          where m.ticket_id = t.id
        ) +
        (
          select count(*)
          from public.autorizaciones_video a
          where a.ticket_id = t.id
        ),
        t.id
      limit 1
    " |
  tr -d '\r\n'
)"

printf '%s\n' "$FIXTURE_TICKET_ID" |
grep -Eq \
  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' ||
  fail \
    "MEDIA_FIXTURE_TICKET_NOT_FOUND" \
    "No existe ningún ticket en la base local del harness."

{
  echo "TICKETS_TOTAL=$TICKETS_TOTAL"
  echo "FIXTURE_SELECTION=LEAST_MEDIA_ACTIVITY"
  echo "FIXTURE_TICKET_ID=$FIXTURE_TICKET_ID"
} >"$OUT/01B_MEDIA_FIXTURE.txt"


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

set +e

docker exec -i "$CID" \
  psql \
  -X \
  -U postgres \
  -d postgres \
  -v ON_ERROR_STOP=1 \
  -v adjunto_id='20000000-0000-0000-0000-0000000000a1' \
  -v ticket_id="$FIXTURE_TICKET_ID" \
  <supabase/tests/media_video_concurrency_consume.sql \
  >"$RACE_A_LOG" 2>&1 &
PID_A="$!"

docker exec -i "$CID" \
  psql \
  -X \
  -U postgres \
  -d postgres \
  -v ON_ERROR_STOP=1 \
  -v adjunto_id='20000000-0000-0000-0000-0000000000a2' \
  -v ticket_id="$FIXTURE_TICKET_ID" \
  <supabase/tests/media_video_concurrency_consume.sql \
  >"$RACE_B_LOG" 2>&1 &
PID_B="$!"

wait "$PID_A"
RC_A="$?"

wait "$PID_B"
RC_B="$?"

set -e

SUCCESS_COUNT=0
FAILURE_COUNT=0
LOSER_LOG=""

if test "$RC_A" -eq 0; then
  SUCCESS_COUNT="$((SUCCESS_COUNT + 1))"
else
  FAILURE_COUNT="$((FAILURE_COUNT + 1))"
  LOSER_LOG="$RACE_A_LOG"
fi

if test "$RC_B" -eq 0; then
  SUCCESS_COUNT="$((SUCCESS_COUNT + 1))"
else
  FAILURE_COUNT="$((FAILURE_COUNT + 1))"
  LOSER_LOG="$RACE_B_LOG"
fi

test "$SUCCESS_COUNT" -eq 1 ||
  fail \
    "CONCURRENCY_SUCCESS_COUNT_INVALID" \
    "A=$RC_A B=$RC_B successes=$SUCCESS_COUNT"

test "$FAILURE_COUNT" -eq 1 ||
  fail \
    "CONCURRENCY_FAILURE_COUNT_INVALID" \
    "A=$RC_A B=$RC_B failures=$FAILURE_COUNT"

grep -q \
  'E_MEDIA_AUTORIZACION_NO_DISPONIBLE' \
  "$LOSER_LOG" ||
  fail \
    "CONCURRENCY_LOSER_REASON_INVALID" \
    "$LOSER_LOG"

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
  echo "CONCURRENCY_SUCCESS_COUNT=$SUCCESS_COUNT"
  echo "CONCURRENCY_FAILURE_COUNT=$FAILURE_COUNT"
  echo "DB_PORT=$DB_PORT"
  echo "CONTAINER=$CID"
  echo "TEARDOWN=$TEARDOWN_RESULT"
  echo "HOST_PSQL_USED=NO"
  echo "DOCKER_PSQL_USED=YES"
  echo "REMOTE_OPERATIONS=NO"
} >"$FINAL"
