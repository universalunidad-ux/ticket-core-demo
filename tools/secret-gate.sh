#!/usr/bin/env bash
# SECURITY GATE (U6): impide introducir secretos en el repositorio público.
# NO marca sb_publishable_* (público por diseño). Reforzado: cubre service_role,
# sb_secret_*, JWT reales, private keys, URLs Postgres con contraseña, tokens de
# acceso/refresh, recovery/magic links con token, cookies de sesión, contraseñas.
set -euo pipefail

root="${1:-.}"
gate_source="${BASH_SOURCE[0]}"
case "$gate_source" in
  /*) ;;
  *) gate_source="$PWD/$gate_source" ;;
esac
gate_dir="${gate_source%/*}"
patterns_file="$gate_dir/secret-gate-patterns.txt"
fallback_scanner="$gate_dir/secret-gate-scanner.py"

fail() {
  echo "SECRET_GATE: FAIL $*" >&2
  exit 1
}

if ! cd "$root"; then
  fail "scan root is not accessible: $root"
fi

if ! command -v find >/dev/null 2>&1; then
  fail "required file enumerator unavailable: find"
fi
if [[ ! -r "$patterns_file" ]]; then
  fail "pattern file unavailable: $patterns_file"
fi

# 1) Config/entorno local prohibido en el árbol. Los errores de enumeración son
# fallos del gate, no equivalen a un árbol limpio.
set +e
forbidden_output="$({ find . \
  \( -path '*/.git' -o -path '*/node_modules' \) -prune -o \
  -type f \( -name '.env' -o -name '.env.*' -o -name 'supabase.config.local.js' \) \
  -not -name '*.example' -not -name '*.example.*' -print -quit; } 2>&1)"
forbidden_status=$?
set -e
if (( forbidden_status != 0 )); then
  fail "file enumeration failed: $forbidden_output"
fi
if [[ -n "$forbidden_output" ]]; then
  fail "forbidden local config/.env: $forbidden_output"
fi

scanner=""
if command -v rg >/dev/null 2>&1; then
  scanner="rg"
elif command -v python3 >/dev/null 2>&1 && [[ -r "$fallback_scanner" ]]; then
  scanner="python3"
else
  fail "no scanner available (install rg or provide python3 with $fallback_scanner)"
fi

run_rg_scan() {
  local mode="$1"
  local common=(
    --files-with-matches --hidden --no-ignore
    --glob '!.git/**'
    --glob '!**/.git/**'
    --glob '!node_modules/**'
    --glob '!**/node_modules/**'
    --glob '!*.example'
    --glob '!*.example.*'
    --glob '!tools/secret-gate.sh'
    --glob '!tools/secret-gate-scanner.py'
    --glob '!tools/secret-gate-patterns.txt'
  )
  if [[ "$mode" == "secrets" ]]; then
    rg "${common[@]}" -f "$patterns_file" .
  else
    rg "${common[@]}" -e 'sb_publishable_' .
  fi
}

run_python_scan() {
  python3 "$fallback_scanner" --patterns "$patterns_file" --mode "$1" .
}

run_scan() {
  local mode="$1"
  set +e
  if [[ "$scanner" == "rg" ]]; then
    scan_output="$(run_rg_scan "$mode" 2>&1)"
  else
    scan_output="$(run_python_scan "$mode" 2>&1)"
  fi
  scan_status=$?
  set -e
}

echo "SECRET_GATE: scanner=$scanner"

# Los scanners usan semántica grep: 0=hallazgo, 1=sin hallazgos, >1=error.
# Cualquier estado inesperado falla cerrado.
run_scan secrets
case "$scan_status" in
  0)
    [[ -n "$scan_output" ]] && printf '%s\n' "$scan_output" >&2
    fail "secret-shaped value detected"
    ;;
  1) ;;
  *)
    [[ -n "$scan_output" ]] && printf '%s\n' "$scan_output" >&2
    fail "scanner error (scanner=$scanner status=$scan_status)"
    ;;
esac

# sb_publishable_ NO debe tratarse como secreto: aviso informativo si aparece.
run_scan publishable
case "$scan_status" in
  0) echo 'SECRET_GATE: note sb_publishable_ present (public by design; OK)' ;;
  1) ;;
  *)
    [[ -n "$scan_output" ]] && printf '%s\n' "$scan_output" >&2
    fail "scanner error while checking publishable keys (scanner=$scanner status=$scan_status)"
    ;;
esac

echo 'SECRET_GATE: PASS'
