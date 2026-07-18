#!/usr/bin/env bash
set -euo pipefail

test_dir="$(cd "${BASH_SOURCE[0]%/*}" && pwd -P)"
gate="$test_dir/secret-gate.sh"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/secret-gate-test.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT

secret_value='sb''_secret_SYNTHETIC0123456789'
publishable_value='sb''_publishable_SYNTHETIC0123456789'
output=""
status=0
passed=0

run_gate() {
  set +e
  output="$("$@" 2>&1)"
  status=$?
  set -e
}

assert_status() {
  local expected="$1"
  local label="$2"
  if [[ "$status" != "$expected" ]]; then
    printf 'SECRET_GATE_TESTS: FAIL %s (status=%s)\n%s\n' "$label" "$status" "$output" >&2
    exit 1
  fi
}

assert_output() {
  local expected="$1"
  local label="$2"
  if [[ "$output" != *"$expected"* ]]; then
    printf 'SECRET_GATE_TESTS: FAIL %s (missing=%s)\n%s\n' "$label" "$expected" "$output" >&2
    exit 1
  fi
}

assert_no_pass() {
  local label="$1"
  if [[ "$output" == *'SECRET_GATE: PASS'* ]]; then
    printf 'SECRET_GATE_TESTS: FAIL %s declared PASS\n%s\n' "$label" "$output" >&2
    exit 1
  fi
}

new_repo() {
  local root="$1"
  mkdir -p "$root"
  git -C "$root" init -q
}

# 1. Árbol limpio.
clean_root="$tmp/clean"
new_repo "$clean_root"
run_gate /bin/bash "$gate" "$clean_root"
assert_status 0 clean-tree
assert_output 'SECRET_GATE: PASS' clean-tree
((passed += 1))

# Exclusiones explícitas: archivos example, node_modules y binarios.
excluded_root="$tmp/excluded"
new_repo "$excluded_root"
mkdir -p "$excluded_root/node_modules"
printf '%s\n' "$secret_value" >"$excluded_root/allowed.example"
printf '%s\n' "$secret_value" >"$excluded_root/allowed.example.js"
printf '%s\n' "$secret_value" >"$excluded_root/node_modules/dependency.txt"
printf '\000%s\n' "$secret_value" >"$excluded_root/binary.dat"
run_gate /bin/bash "$gate" "$excluded_root"
assert_status 0 explicit-exclusions
assert_output 'SECRET_GATE: PASS' explicit-exclusions
((passed += 1))

# 2. Secreto sintético no rastreado.
untracked_root="$tmp/untracked"
new_repo "$untracked_root"
printf '%s\n' "$secret_value" >"$untracked_root/untracked.txt"
if git -C "$untracked_root" ls-files --error-unmatch untracked.txt >/dev/null 2>&1; then
  echo 'SECRET_GATE_TESTS: FAIL fixture should be untracked' >&2
  exit 1
fi
run_gate /bin/bash "$gate" "$untracked_root"
assert_status 1 untracked-secret
assert_output 'SECRET_GATE: FAIL secret-shaped value detected' untracked-secret
assert_no_pass untracked-secret
((passed += 1))

# Sin rg ni Python 3 disponible, el gate debe fallar de forma explícita.
no_scanner_bin="$tmp/no-scanner-bin"
mkdir -p "$no_scanner_bin"
ln -s "$(command -v find)" "$no_scanner_bin/find"
no_scanner_root="$tmp/no-scanner"
new_repo "$no_scanner_root"
run_gate env PATH="$no_scanner_bin" /bin/bash "$gate" "$no_scanner_root"
assert_status 1 no-scanner
assert_output 'SECRET_GATE: FAIL no scanner available' no-scanner
assert_no_pass no-scanner
((passed += 1))

# 3. Secreto sintético rastreado.
tracked_root="$tmp/tracked"
new_repo "$tracked_root"
printf '%s\n' "$secret_value" >"$tracked_root/tracked.txt"
git -C "$tracked_root" add tracked.txt
git -C "$tracked_root" ls-files --error-unmatch tracked.txt >/dev/null
run_gate /bin/bash "$gate" "$tracked_root"
assert_status 1 tracked-secret
assert_output 'SECRET_GATE: FAIL secret-shaped value detected' tracked-secret
assert_no_pass tracked-secret
((passed += 1))

# 4. Clave publicable sintética permitida.
publishable_root="$tmp/publishable"
new_repo "$publishable_root"
printf '%s\n' "$publishable_value" >"$publishable_root/public.txt"
run_gate /bin/bash "$gate" "$publishable_root"
assert_status 0 publishable-key
assert_output 'public by design; OK' publishable-key
assert_output 'SECRET_GATE: PASS' publishable-key
((passed += 1))

# Un PATH controlado sin rg fuerza el fallback de Python 3.
fallback_bin="$tmp/fallback-bin"
mkdir -p "$fallback_bin"
ln -s "$(command -v find)" "$fallback_bin/find"
ln -s "$(command -v python3)" "$fallback_bin/python3"
fallback_root="$tmp/fallback"
new_repo "$fallback_root"
printf '%s\n' "$secret_value" >"$fallback_root/fallback.txt"
run_gate env PATH="$fallback_bin" /bin/bash "$gate" "$fallback_root"
assert_status 1 no-rg-fallback
assert_output 'SECRET_GATE: scanner=python3' no-rg-fallback
assert_output 'SECRET_GATE: FAIL secret-shaped value detected' no-rg-fallback
assert_no_pass no-rg-fallback
((passed += 1))

# Un scanner que termina con error debe fallar cerrado, nunca declarar PASS.
failure_bin="$tmp/failure-bin"
mkdir -p "$failure_bin"
ln -s "$(command -v find)" "$failure_bin/find"
printf '%s\n' '#!/bin/sh' 'exit 70' >"$failure_bin/python3"
chmod +x "$failure_bin/python3"
failure_root="$tmp/failure"
new_repo "$failure_root"
run_gate env PATH="$failure_bin" /bin/bash "$gate" "$failure_root"
assert_status 1 scanner-failure
assert_output 'SECRET_GATE: FAIL scanner error (scanner=python3 status=70)' scanner-failure
assert_no_pass scanner-failure
((passed += 1))

echo "SECRET_GATE_TESTS: PASS ($passed cases)"
echo 'UNTRACKED_SECRET_TEST: PASS'
echo 'TRACKED_SECRET_TEST: PASS'
echo 'PUBLISHABLE_KEY_TEST: PASS'
echo 'NO_RG_FALLBACK_TEST: PASS'
echo 'SCANNER_FAILURE_TEST: PASS'
