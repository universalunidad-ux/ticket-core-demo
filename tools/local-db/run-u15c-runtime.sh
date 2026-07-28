#!/usr/bin/env bash
# TC-U15C-RUNTIME-IMPLEMENT-D1-D4-01
# run-u15c-runtime.sh — Validación RUNTIME local de
# public.tc_consolidar_cliente_ticket tras el fix D1-D4
# (supabase/migrations/20260721014500_u15cd_consolidation_rpc.sql).
#
# ALCANCE / PROPIEDAD (anti-duplicación, deliberado):
#   Este script NO levanta, NO reinicia y NO apaga el stack local. El único
#   propietario del arranque de Docker/Supabase local sigue siendo el CLI de
#   Supabase (y, para la línea RLS, tools/local-db/run-local-db-harness.sh).
#   Aquí sólo se ejecutan las fases propias de U15C sobre un stack YA levantado.
#   Motivo concreto: el harness RLS aplica una guarda de alcance
#   (tools/local-db/lib/guards.mjs -> PROTECTED_PREFIXES) que rechaza cualquier
#   worktree con cambios bajo supabase/migrations/, es decir exactamente el
#   worktree de U15C. Por eso U15C no puede delegar en ese harness ni debe
#   reimplementar su orquestación: se queda con las fases que sí le pertenecen.
#
# Lo que sí hace, en orden y fail-closed (cualquier precondición no cumplida
# aborta ANTES de tocar la base):
#   PRECHECK_HOST · PRECHECK_REPO · PRECHECK_REMOTE_GUARD · RESOLVE_LOCAL_DB
#   PRECHECK_RPC · MATRIX (25 casos, transaccional con ROLLBACK)
#   CONCURRENCY (2 sesiones reales, misma clave) · REPORT
#
# La guarda anti-remoto NO se reimplementa: se delega en la fuente canónica
# tools/local-db/lib/guards.mjs (inspectEnvForRemote).
#
# PROHIBIDO por diseño: push, PR, merge, deploy, Supabase remoto, psql remoto.
#
# Uso:
#   tools/local-db/run-u15c-runtime.sh [--dry-run] [--db-container NAME]
#                                      [--apply --workdir DIR] [--keep-data]
#
#   --dry-run          sólo prechecks de host/repo/remoto; no toca la base.
#   --db-container     fija el contenedor supabase_db_* (por defecto: se
#                      resuelve si y sólo si hay exactamente uno).
#   --apply            opt-in explícito: ejecuta "supabase db reset" sobre
#                      --workdir antes de las pruebas. Exige --workdir DIR y
#                      que DIR contenga config.toml.
#   --keep-data        no ejecuta la fase de limpieza de concurrencia
#                      (deja evidencia en la base local para inspección).

set -Eeuo pipefail
IFS=$'\n\t'

UNIT="TC-U15C-RUNTIME-IMPLEMENT-D1-D4-01"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." >/dev/null 2>&1 && pwd)"
cd "${REPO_ROOT}"

MIGRATION="supabase/migrations/20260721014500_u15cd_consolidation_rpc.sql"
MATRIX="supabase/tests/u15c_transaction_matrix.sql"
CONC_PROBE="supabase/tests/u15c_concurrency_probe.sql"
CONC_VERIFY="supabase/tests/u15c_concurrency_verify.sql"
CONC_TICKET="96666666-0000-4666-8666-000000000001"
RPC_SIGNATURE="public.tc_consolidar_cliente_ticket(uuid,text,bigint,text,uuid,uuid,jsonb,jsonb)"

DRY_RUN=0
KEEP_DATA=0
APPLY=0
WORKDIR=""
DB_CONTAINER=""
ARTIFACTS=""
DB_STATUS="not-inspected"

# --- Salida estructurada única (mismo contrato que run-local-db-harness.sh) --
report() {
	# $1=RESULT $2=exit_code $3=FAILED_PHASE $4=STOP_REASON_CODE $5=detalle
	cat <<EOF

===== 00_FINAL_RESULT (u15c runtime) =====
RESULT=$1
SCRIPT_EXIT_CODE=$2
UNIT=${UNIT}
FAILED_PHASE=$3
STOP_REASON_CODE=$4
STOP_REASON_DETAIL=$5
LOCAL_DB_STATUS=${DB_STATUS}
ARTIFACTS_DIR=${ARTIFACTS:--}
SAFE_RECOVERY_ACTION=$6
DO_NOT_RUN=push | PR | merge | deploy | supabase remoto | psql remoto
EOF
}

fail() {
	# $1=STOP_REASON_CODE $2=FAILED_PHASE $3=detalle $4=exit_code $5=recuperación
	report FAIL "${4:-99}" "$2" "$1" "$3" "${5:-detener; corregir precondición y reintentar (solo local)}"
	exit "${4:-99}"
}

usage_fail() { fail "E_BAD_USAGE" "PRECHECK_ARGS" "$1" 2 "revisar la ayuda al inicio del script"; }

while [[ $# -gt 0 ]]; do
	case "$1" in
	--dry-run) DRY_RUN=1 ;;
	--keep-data) KEEP_DATA=1 ;;
	--apply) APPLY=1 ;;
	--db-container)
		DB_CONTAINER="${2:-}"
		[[ -n "${DB_CONTAINER}" ]] || usage_fail "--db-container requiere un nombre"
		shift
		;;
	--workdir)
		WORKDIR="${2:-}"
		[[ -n "${WORKDIR}" ]] || usage_fail "--workdir requiere una ruta"
		shift
		;;
	*) usage_fail "argumento no reconocido: $1" ;;
	esac
	shift
done

if [[ "${APPLY}" -eq 1 && -z "${WORKDIR}" ]]; then
	usage_fail "--apply exige --workdir DIR con config.toml"
fi

# --- 1) PRECHECK_HOST --------------------------------------------------------
[[ "$(uname -s)" == "Darwin" ]] ||
	fail "E_HOST_NOT_MACOS" "PRECHECK_HOST" "uname=$(uname -s) (se requiere Darwin/macOS)" 10 \
		"ejecutar en el host macOS con Docker Desktop"

command -v node >/dev/null 2>&1 ||
	fail "E_NODE_VERSION" "PRECHECK_HOST" "node no encontrado en PATH" 11 "instalar Node >=22"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
[[ "${NODE_MAJOR}" -ge 22 ]] ||
	fail "E_NODE_VERSION" "PRECHECK_HOST" "node major=${NODE_MAJOR} (se requiere >=22)" 11 "instalar Node >=22"

command -v docker >/dev/null 2>&1 ||
	fail "E_DOCKER_MISSING" "PRECHECK_HOST" "docker no encontrado en PATH" 12 "instalar Docker Desktop"
docker info >/dev/null 2>&1 ||
	fail "E_DOCKER_NOT_RUNNING" "PRECHECK_HOST" "docker daemon no responde" 13 "abrir Docker Desktop y reintentar"

if [[ "${APPLY}" -eq 1 ]]; then
	command -v supabase >/dev/null 2>&1 ||
		fail "E_SUPABASE_CLI_MISSING" "PRECHECK_HOST" "supabase CLI no encontrado y se pidió --apply" 14 \
			"brew install supabase/tap/supabase"
fi

# --- 2) PRECHECK_REPO --------------------------------------------------------
[[ "$(git rev-parse --is-inside-work-tree 2>/dev/null || echo false)" == "true" ]] ||
	fail "E_NOT_GIT_WORKTREE" "PRECHECK_REPO" "no es un worktree git" 15 "ejecutar dentro del worktree U15C"

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
case "${BRANCH}" in
fix/u15c-* | test/u15c-*) : ;;
*) fail "E_WRONG_BRANCH" "PRECHECK_REPO" "rama=${BRANCH} (se espera fix/u15c-* o test/u15c-*)" 16 \
	"cambiar al worktree/rama de U15C" ;;
esac

for f in "${MIGRATION}" "${MATRIX}" "${CONC_PROBE}" "${CONC_VERIFY}"; do
	[[ -f "${f}" ]] ||
		fail "E_ARTIFACT_MISSING" "PRECHECK_REPO" "archivo requerido ausente: ${f}" 18 \
			"restaurar el archivo antes de validar runtime"
done

# El fix D2/D3 es una precondición estática: si vuelve documento_id, no se corre.
if grep -nE '^[^-]*documento_id' "${MIGRATION}" >/dev/null 2>&1; then
	fail "E_D2_D3_REGRESSION" "PRECHECK_REPO" "la migración volvió a referenciar documento_id" 19 \
		"revertir la regresión D2/D3 antes de ejecutar runtime"
fi

# --- 3) PRECHECK_REMOTE_GUARD (delegado en la fuente canónica) --------------
GUARD_OUT="$(
	# JavaScript is intentionally single-quoted; dollar expressions belong to Node, not Bash.
	# shellcheck disable=SC2016
	node -e '
    import(process.argv[1])
      .then((g) => {
        const f = g.inspectEnvForRemote(process.env);
        if (f.length) { console.log(`${f[0].code}|${f[0].var}|${f[0].reason}`); process.exit(1); }
        console.log("OK");
      })
      .catch((e) => { console.log(`E_INTERNAL|guards|${e.message}`); process.exit(2); });
  ' "file://${REPO_ROOT}/tools/local-db/lib/guards.mjs"
)" || fail "${GUARD_OUT%%|*}" "PRECHECK_REMOTE_GUARD" "env remota detectada: ${GUARD_OUT#*|}" 51 \
	"limpiar del shell toda env remota (DATABASE_URL, SUPABASE_ACCESS_TOKEN, ...) y reintentar"
[[ "${GUARD_OUT}" == "OK" ]] ||
	fail "E_INTERNAL" "PRECHECK_REMOTE_GUARD" "guarda anti-remoto no concluyente: ${GUARD_OUT}" 99 \
		"revisar tools/local-db/lib/guards.mjs"

if [[ "${DRY_RUN}" -eq 1 ]]; then
	DB_STATUS="not-inspected(dry-run)"
	report PASS 0 "-" "OK" "dry-run: prechecks fail-closed superados; base intacta" "ninguna"
	exit 0
fi

# --- 4) RESOLVE_LOCAL_DB -----------------------------------------------------
if [[ -z "${DB_CONTAINER}" ]]; then
	# Sin mapfile/wait -n: el host puede traer bash 3.2 (macOS de fábrica).
	CANDIDATES="$(docker ps --format '{{.Names}}' | grep '^supabase_db_' || true)"
	CANDIDATE_COUNT="$(printf '%s' "${CANDIDATES}" | grep -c . || true)"
	[[ "${CANDIDATE_COUNT}" -eq 1 ]] ||
		fail "E_LOCAL_STACK_AMBIGUOUS" "RESOLVE_LOCAL_DB" \
			"contenedores supabase_db_* activos=${CANDIDATE_COUNT} (se requiere exactamente 1)" 60 \
			"levantar el stack local (supabase start) o fijar --db-container NAME"
	DB_CONTAINER="${CANDIDATES}"
fi

[[ "${DB_CONTAINER}" == supabase_db_* ]] ||
	fail "E_REMOTE_TARGET_DETECTED" "RESOLVE_LOCAL_DB" "contenedor no reconocido como local: ${DB_CONTAINER}" 50 \
		"usar únicamente un contenedor supabase_db_* local"
docker inspect -f '{{.State.Running}}' "${DB_CONTAINER}" 2>/dev/null | grep -qx true ||
	fail "E_LOCAL_STACK_DOWN" "RESOLVE_LOCAL_DB" "el contenedor ${DB_CONTAINER} no está corriendo" 61 \
		"supabase start (línea Docker, propiedad del operador)"
DB_STATUS="up(${DB_CONTAINER})"

ARTIFACTS="${SCRIPT_DIR}/.artifacts/u15c-runtime-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "${ARTIFACTS}"

# psql local: SIEMPRE dentro del contenedor (nunca una URL que pueda ser remota).
psql_exec() { docker exec -i "${DB_CONTAINER}" psql -U postgres -d postgres -X -q --no-psqlrc -v ON_ERROR_STOP=1 "$@"; }

psql_file() {
	local src="$1" dest
	dest="/tmp/$(basename "${src}")"
	shift
	docker cp "${REPO_ROOT}/${src}" "${DB_CONTAINER}:${dest}" >/dev/null ||
		fail "E_INTERNAL" "PSQL" "no se pudo copiar ${src} al contenedor" 99 "revisar permisos de Docker"
	psql_exec "$@" -f "${dest}"
}

# --- 5) APPLY_MIGRATIONS (opt-in explícito) ---------------------------------
if [[ "${APPLY}" -eq 1 ]]; then
	[[ -f "${WORKDIR}/supabase/config.toml" ]] ||
		fail "E_WORKDIR_INVALID" "APPLY_MIGRATIONS" "no existe ${WORKDIR}/supabase/config.toml" 62 \
			"apuntar --workdir al workdir efímero con config.toml y migraciones"
	supabase db reset --workdir "${WORKDIR}" >"${ARTIFACTS}/db-reset.log" 2>&1 ||
		fail "E_MIGRATION_FAILED" "APPLY_MIGRATIONS" "supabase db reset falló (ver db-reset.log)" 73 \
			"revisar la migración señalada en el log; NO promover a staging"
fi

# --- 6) PRECHECK_RPC (fail-closed: sin función compilada no hay runtime) -----
RPC_OID="$(psql_exec -t -A -c "select coalesce(to_regprocedure('${RPC_SIGNATURE}')::text, 'MISSING')" 2>/dev/null || echo MISSING)"
[[ "${RPC_OID}" != "MISSING" ]] ||
	fail "E_MIGRATION_NOT_APPLIED" "PRECHECK_RPC" "la RPC no existe en la base local (migración no aplicada o no compiló)" 63 \
		"re-ejecutar con --apply --workdir DIR, o aplicar migraciones y reintentar"

# --- 7) MATRIX (T01-T25; el script abre y revierte su propia transacción) ----
if ! psql_file "${MATRIX}" >"${ARTIFACTS}/matrix.log" 2>&1; then
	fail "E_U15C_MATRIX_FAILED" "MATRIX" "u15c_transaction_matrix.sql falló (ver matrix.log)" 84 \
		"NO promover a staging; corregir la RPC y re-ejecutar runtime local"
fi
grep -q 'U15C_TRANSACTION_MATRIX=PASS' "${ARTIFACTS}/matrix.log" ||
	fail "E_U15C_MATRIX_FAILED" "MATRIX" "la matriz no emitió el marcador PASS (ver matrix.log)" 84 \
		"NO promover a staging; revisar los 25 resultados en matrix.log"

# --- 8) CONCURRENCY (dos sesiones reales sobre la MISMA clave) --------------
CONC_KEY="tc-u15c-conc-$(date -u +%Y%m%d%H%M%S)-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
T0="$(psql_exec -t -A -c "select (clock_timestamp() + interval '5 seconds')::text")"
[[ -n "${T0}" ]] ||
	fail "E_INTERNAL" "CONCURRENCY" "no se pudo fijar la barrera de reloj" 99 "reintentar"

docker cp "${REPO_ROOT}/${CONC_PROBE}" "${DB_CONTAINER}:/tmp/u15c_concurrency_probe.sql" >/dev/null

CONC_PIDS=()
for slot in 1 2; do
	docker exec -i "${DB_CONTAINER}" psql -U postgres -d postgres -X -q --no-psqlrc \
		-v ON_ERROR_STOP=1 -v "slot=${slot}" -v "key=${CONC_KEY}" -v "ticket=${CONC_TICKET}" -v "t0=${T0}" \
		-f /tmp/u15c_concurrency_probe.sql >"${ARTIFACTS}/concurrency-slot${slot}.log" 2>&1 &
	CONC_PIDS+=("$!")
done
# Ambas sondas deben terminar; su código de salida NO decide el veredicto (se
# espera que una pierda la carrera). El veredicto lo dan verify + los conteos.
CONC_RC=0
for pid in "${CONC_PIDS[@]}"; do
	wait "${pid}" || CONC_RC=1
done

cat "${ARTIFACTS}"/concurrency-slot*.log >"${ARTIFACTS}/concurrency.log" 2>/dev/null || true
WINNERS="$(grep -c 'U15C_CONC_RESULT .*ok=true .*replayed=false' "${ARTIFACTS}/concurrency.log" || true)"
RESULTS="$(grep -c 'U15C_CONC_RESULT ' "${ARTIFACTS}/concurrency.log" || true)"

if [[ "${KEEP_DATA}" -eq 0 ]]; then
	if ! psql_file "${CONC_VERIFY}" -v "key=${CONC_KEY}" -v "ticket=${CONC_TICKET}" \
		>"${ARTIFACTS}/concurrency-verify.log" 2>&1; then
		fail "E_U15C_CONCURRENCY_FAILED" "CONCURRENCY" \
			"la carrera dejó un efecto no unitario (ver concurrency-verify.log)" 85 \
			"NO promover a staging; revisar el claim de idempotencia bajo concurrencia"
	fi
	grep -q 'U15C_CONCURRENCY=PASS' "${ARTIFACTS}/concurrency-verify.log" ||
		fail "E_U15C_CONCURRENCY_FAILED" "CONCURRENCY" "verify no emitió el marcador PASS" 85 \
			"revisar concurrency-verify.log"
fi

[[ "${RESULTS}" -eq 2 ]] ||
	fail "E_U15C_CONCURRENCY_FAILED" "CONCURRENCY" "sondas con resultado=${RESULTS} (esperado 2; rc=${CONC_RC})" 85 \
		"revisar concurrency-slot1.log y concurrency-slot2.log"
[[ "${WINNERS}" -eq 1 ]] ||
	fail "E_U15C_CONCURRENCY_FAILED" "CONCURRENCY" "ejecuciones reales ganadoras=${WINNERS} (esperado exactamente 1)" 85 \
		"NO promover a staging; el claim de idempotencia no es atómico bajo carrera"

# --- 9) REPORT ---------------------------------------------------------------
SUMMARY="matriz 25/25 PASS; concurrencia 2 sesiones -> 1 ejecución real"
if [[ "${KEEP_DATA}" -eq 1 ]]; then
	SUMMARY="${SUMMARY} (--keep-data: verify/limpieza omitidos, quedan filas sintéticas locales)"
fi
report PASS 0 "-" "OK" "${SUMMARY}" "ninguna"
