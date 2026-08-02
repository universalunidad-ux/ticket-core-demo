#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." >/dev/null 2>&1 && pwd)"
RUNTIME_DIR="${REPO_ROOT}/tools/local-db/.runtime/mt1-media"
PROJECT_ID="tc_mt1_media_8166e"
DB_PORT=55432
EVIDENCE_DIR="${TC_MEDIA_EVIDENCE_DIR:-}"
PYTHON_BIN="${TC_MEDIA_PYTHON:-python3}"
PDFTOPPM_BIN="${TC_MEDIA_PDFTOPPM:-pdftoppm}"
OWNED=0
TEARDOWN="NOT_STARTED"

fail(){ echo "MEDIA_RUNTIME_FAIL=$1" >&2; exit 1; }
field(){ local key="$1" payload="$2" value; value="$(printf '%s\n' "${payload}" | sed -n "s/^${key}=//p" | head -n 1)"; value="${value#\"}"; value="${value%\"}"; printf '%s\n' "${value}"; }
psql_file(){ local phase="$1"; shift; docker exec -i "${DB_CID}" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -v "phase=${phase}" "$@" -f - <"${REPO_ROOT}/supabase/tests/media_pipeline_runtime.sql"; }
psql_query(){ docker exec -i "${DB_CID}" psql -X -qAt -U postgres -d postgres -v ON_ERROR_STOP=1 -c "$1"; }

cleanup(){
  local rc=$?
  unset LOCAL_STATUS SERVICE_ROLE_KEY
  if [[ "${OWNED}" -eq 1 ]]; then
    if SUPABASE_TELEMETRY_DISABLED=1 node "${REPO_ROOT}/tools/local-db/lib/bootstrap.mjs" --stop --remove-runtime --project-id "${PROJECT_ID}" --runtime-dir "${RUNTIME_DIR}" >"${EVIDENCE_DIR}/teardown.log" 2>&1; then TEARDOWN="PASS"; else TEARDOWN="FAIL"; rc=1; fi
  fi
  printf 'TEARDOWN=%s\n' "${TEARDOWN}" >>"${EVIDENCE_DIR}/runtime-final.txt"
  exit "${rc}"
}

[[ -n "${EVIDENCE_DIR}" && "${EVIDENCE_DIR}" = /* ]] || fail "EVIDENCE_DIR_ABSOLUTE_REQUIRED"
mkdir -p "${EVIDENCE_DIR}/fixtures" "${EVIDENCE_DIR}/derived"
cd "${REPO_ROOT}"
[[ "$(git rev-parse --abbrev-ref HEAD)" == "feat/mt1-media-pipeline-8166e-20260802" ]] || fail "BRANCH_MISMATCH"
[[ -z "$(docker ps --filter 'name=^supabase_' --format '{{.Names}}')" ]] || fail "SUPABASE_STACK_ALREADY_ACTIVE"
for name in DATABASE_URL SUPABASE_DB_URL POSTGRES_URL SUPABASE_ACCESS_TOKEN SUPABASE_PROJECT_REF; do [[ -z "${!name:-}" ]] || fail "REMOTE_ENV_PRESENT_${name}"; done
trap cleanup EXIT INT TERM

BOOTSTRAP="$(SUPABASE_TELEMETRY_DISABLED=1 node tools/local-db/lib/bootstrap.mjs --project-id "${PROJECT_ID}" --db-port "${DB_PORT}" --runtime-dir "${RUNTIME_DIR}" --reset-runtime 2>"${EVIDENCE_DIR}/bootstrap.err")" || fail "BOOTSTRAP_FAILED"
DB_CID="$(field BOOTSTRAP_CID "${BOOTSTRAP}")"
[[ "${DB_CID}" == "supabase_db_${PROJECT_ID}" ]] || fail "DB_CONTAINER_IDENTITY"
OWNED=1

SUPABASE_TELEMETRY_DISABLED=1 supabase db reset --workdir "${RUNTIME_DIR}" >"${EVIDENCE_DIR}/migrations.log" 2>&1 || fail "MIGRATIONS_FAILED"
docker exec -i "${DB_CID}" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -f - <"${REPO_ROOT}/supabase/tests/media_claim_upload_targeted.sql" >"${EVIDENCE_DIR}/claim-targeted.log" 2>&1 || fail "CLAIM_TARGETED_FAILED"
LOCAL_STATUS="$(SUPABASE_TELEMETRY_DISABLED=1 supabase status -o env --workdir "${RUNTIME_DIR}" 2>"${EVIDENCE_DIR}/status.err")" || fail "STATUS_FAILED"
API_URL="$(field API_URL "${LOCAL_STATUS}")"
SERVICE_ROLE_KEY="$(field SERVICE_ROLE_KEY "${LOCAL_STATUS}")"
[[ "${API_URL}" == http://127.0.0.1:* || "${API_URL}" == http://localhost:* ]] || fail "NON_LOCAL_API"
[[ -n "${SERVICE_ROLE_KEY}" ]] || fail "SERVICE_KEY_MISSING"

"${PYTHON_BIN}" -c 'from PIL import Image; import sys; Image.new("RGB",(640,480),(20,90,180)).save(sys.argv[1],"PNG")' "${EVIDENCE_DIR}/fixtures/original.png"
node -e 'const fs=require("fs"),b=Buffer.alloc(64);b.write("ftypisom",4,"ascii");b.write("mvhd",20,"ascii");b.writeUInt32BE(1000,36);b.writeUInt32BE(15000,40);fs.writeFileSync(process.argv[1],b)' "${EVIDENCE_DIR}/fixtures/video-15s.mp4"
IMAGE_SHA="$(shasum -a 256 "${EVIDENCE_DIR}/fixtures/original.png" | awk '{print $1}')"
VIDEO_SHA="$(shasum -a 256 "${EVIDENCE_DIR}/fixtures/video-15s.mp4" | awk '{print $1}')"
IMAGE_BYTES="$(wc -c <"${EVIDENCE_DIR}/fixtures/original.png" | tr -d '[:space:]')"
VIDEO_BYTES="$(wc -c <"${EVIDENCE_DIR}/fixtures/video-15s.mp4" | tr -d '[:space:]')"
IMAGE_REQUEST_HASH="$(printf '%s' "${IMAGE_SHA}:media-runtime-image" | shasum -a 256 | awk '{print $1}')"
VIDEO_REQUEST_HASH="$(printf '%s' "${VIDEO_SHA}:media-runtime-video" | shasum -a 256 | awk '{print $1}')"

psql_file setup -v "image_sha=${IMAGE_SHA}" -v "video_sha=${VIDEO_SHA}" -v "image_bytes=${IMAGE_BYTES}" -v "video_bytes=${VIDEO_BYTES}" -v "image_request_hash=${IMAGE_REQUEST_HASH}" -v "video_request_hash=${VIDEO_REQUEST_HASH}" >"${EVIDENCE_DIR}/sql-setup.log" 2>&1 || fail "SQL_SETUP_FAILED"

ORIGINAL_PATH="8166e222-0000-0000-0000-000000000001/runtime/original.png"
curl -fsS -o "${EVIDENCE_DIR}/storage-upload.json" -X POST "${API_URL}/storage/v1/object/soporte_adjuntos/${ORIGINAL_PATH}" -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" -H "apikey: ${SERVICE_ROLE_KEY}" -H 'content-type: image/png' --data-binary "@${EVIDENCE_DIR}/fixtures/original.png" || fail "STORAGE_UPLOAD_FAILED"

CLAIM="$(psql_query "select job_id::text||'|'||lease_token::text||'|'||adjunto_id::text from app_private.tc_claim_media_job('runtime-worker',120) limit 1")"
IFS='|' read -r JOB_ID LEASE_TOKEN ATTACHMENT_ID <<<"${CLAIM}"
[[ -n "${JOB_ID}" && -n "${LEASE_TOKEN}" && -n "${ATTACHMENT_ID}" ]] || fail "JOB_CLAIM_FAILED"
curl -fsS -o "${EVIDENCE_DIR}/fixtures/downloaded-original.png" "${API_URL}/storage/v1/object/authenticated/soporte_adjuntos/${ORIGINAL_PATH}" -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" -H "apikey: ${SERVICE_ROLE_KEY}" || fail "STORAGE_DOWNLOAD_FAILED"
[[ "$(shasum -a 256 "${EVIDENCE_DIR}/fixtures/downloaded-original.png" | awk '{print $1}')" == "${IMAGE_SHA}" ]] || fail "DOWNLOADED_CHECKSUM_MISMATCH"

TC_MEDIA_PDFTOPPM="${PDFTOPPM_BIN}" "${PYTHON_BIN}" tools/media-worker.py --input "${EVIDENCE_DIR}/fixtures/downloaded-original.png" --output-dir "${EVIDENCE_DIR}/derived" --attachment-id "${ATTACHMENT_ID}" --source-sha256 "${IMAGE_SHA}" --kind image --manifest "${EVIDENCE_DIR}/worker-manifest.json" >"${EVIDENCE_DIR}/worker.log" 2>&1 || fail "WORKER_FAILED"
node -e 'const m=require(process.argv[1]); for(const a of m.artifacts) console.log([a.type,a.path,a.bytes,a.sha256].join("\t"))' "${EVIDENCE_DIR}/worker-manifest.json" >"${EVIDENCE_DIR}/artifacts.tsv"
while IFS=$'\t' read -r kind local_path bytes sha; do
  remote_path="8166e222-0000-0000-0000-000000000001/derived/$(basename "${local_path}")"
  curl -fsS -o "${EVIDENCE_DIR}/storage-${kind}.json" -X POST "${API_URL}/storage/v1/object/soporte_adjuntos/${remote_path}" -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" -H "apikey: ${SERVICE_ROLE_KEY}" -H 'content-type: image/webp' --data-binary "@${local_path}" || fail "DERIVATIVE_UPLOAD_${kind}"
  case "${kind}" in review_webp) REVIEW_PATH="${remote_path}"; REVIEW_BYTES="${bytes}"; REVIEW_SHA="${sha}";; thumbnail_webp) THUMB_PATH="${remote_path}"; THUMB_BYTES="${bytes}"; THUMB_SHA="${sha}";; esac
done <"${EVIDENCE_DIR}/artifacts.tsv"
[[ -n "${REVIEW_PATH:-}" && -n "${THUMB_PATH:-}" ]] || fail "DERIVATIVE_MANIFEST_INCOMPLETE"

psql_file worker_complete -v "job_id=${JOB_ID}" -v "lease_token=${LEASE_TOKEN}" -v "image_sha=${IMAGE_SHA}" -v "review_path=${REVIEW_PATH}" -v "review_bytes=${REVIEW_BYTES}" -v "review_sha=${REVIEW_SHA}" -v "thumb_path=${THUMB_PATH}" -v "thumb_bytes=${THUMB_BYTES}" -v "thumb_sha=${THUMB_SHA}" >"${EVIDENCE_DIR}/sql-worker.log" 2>&1 || fail "SQL_WORKER_COMPLETE_FAILED"

curl -fsS -o "${EVIDENCE_DIR}/signed-url.json" -X POST "${API_URL}/storage/v1/object/sign/soporte_adjuntos/${ORIGINAL_PATH}" -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" -H "apikey: ${SERVICE_ROLE_KEY}" -H 'content-type: application/json' -d '{"expiresIn":120}' || fail "SIGN_FAILED"
SIGNED_PATH="$(node -e 'const j=require(process.argv[1]);process.stdout.write(j.signedURL||j.signedUrl||"")' "${EVIDENCE_DIR}/signed-url.json")"
case "${SIGNED_PATH}" in http://127.0.0.1:*|http://localhost:*) SIGNED_URL="${SIGNED_PATH}";; /storage/v1/*) SIGNED_URL="${API_URL}${SIGNED_PATH}";; /object/*) SIGNED_URL="${API_URL}/storage/v1${SIGNED_PATH}";; *) fail "SIGNED_URL_INVALID";; esac
curl -fsS -o "${EVIDENCE_DIR}/fixtures/signed-access.png" "${SIGNED_URL}" || fail "SIGNED_ACCESS_FAILED"
[[ "$(shasum -a 256 "${EVIDENCE_DIR}/fixtures/signed-access.png" | awk '{print $1}')" == "${IMAGE_SHA}" ]] || fail "SIGNED_ACCESS_CHECKSUM_MISMATCH"

psql_file retention >"${EVIDENCE_DIR}/sql-retention.log" 2>&1 || fail "RETENTION_TEST_FAILED"
DELETE_CLAIM="$(psql_query "select storage_path||'|'||delete_token::text from public.tc_prepare_media_delete((select id from public.adjuntos_ticket where idempotency_key='media-runtime-image-idem-0001'))")"
IFS='|' read -r DELETE_PATH DELETE_TOKEN <<<"${DELETE_CLAIM}"
DERIVED_PATHS="$(psql_query "select storage_path from public.derivados_adjuntos where adjunto_id='${ATTACHMENT_ID}' order by storage_path")"
PREFIXES_JSON="$(printf '%s\n%s\n' "${DELETE_PATH}" "${DERIVED_PATHS}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.stringify({prefixes:s.split(/\n/).filter(Boolean)})))')"
curl -fsS -o "${EVIDENCE_DIR}/storage-delete.json" -X DELETE "${API_URL}/storage/v1/object/soporte_adjuntos" -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" -H "apikey: ${SERVICE_ROLE_KEY}" -H 'content-type: application/json' -d "${PREFIXES_JSON}" || fail "STORAGE_DELETE_FAILED"
psql_query "select public.tc_finalize_media_delete('${ATTACHMENT_ID}','${DELETE_TOKEN}')" >"${EVIDENCE_DIR}/sql-delete-finalize.log" || fail "DELETE_FINALIZE_FAILED"

curl -fsS -o "${EVIDENCE_DIR}/storage-residuals.json" -X POST "${API_URL}/storage/v1/object/list/soporte_adjuntos" -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" -H "apikey: ${SERVICE_ROLE_KEY}" -H 'content-type: application/json' -d '{"prefix":"8166e222-0000-0000-0000-000000000001/","limit":100}' || fail "STORAGE_RESIDUAL_SCAN_FAILED"
OBJECT_RESIDUALS="$(node -e 'const j=require(process.argv[1]);process.stdout.write(String(Array.isArray(j)?j.length:-1))' "${EVIDENCE_DIR}/storage-residuals.json")"
[[ "${OBJECT_RESIDUALS}" == "0" ]] || fail "RESIDUAL_OBJECTS_${OBJECT_RESIDUALS}"

psql_file teardown >"${EVIDENCE_DIR}/sql-teardown.log" 2>&1 || fail "SQL_TEARDOWN_FAILED"
printf '%s\n' 'MEDIA_RUNTIME=PASS' 'MEDIA_E2E=PASS' 'IDEMPOTENCY=PASS' 'NEGATIVE_TESTS=PASS' 'ROLLBACK=PASS' 'RESIDUAL_ROWS=0' 'RESIDUAL_OBJECTS=0' >"${EVIDENCE_DIR}/runtime-final.txt"
echo "MEDIA_PIPELINE_RUNTIME=PASS"
