#!/usr/bin/env bash
# SECURITY GATE (U6): impide introducir secretos en el repositorio público.
# NO marca sb_publishable_* (público por diseño). Reforzado: cubre service_role,
# sb_secret_*, JWT reales, private keys, URLs Postgres con contraseña, tokens de
# acceso/refresh, recovery/magic links con token, cookies de sesión, contraseñas.
set -euo pipefail

root="${1:-.}"
cd "$root"

# 1) Config/entorno local prohibido en el árbol.
if find . -type f \( -name '.env' -o -name '.env.*' -o -name 'supabase.config.local.js' \) \
     -not -path './.git/*' -not -name '*.example' -print -quit | grep -q .; then
  echo 'SECRET_GATE: FAIL forbidden local config/.env'
  exit 1
fi

# 2) Valores con forma de secreto. sb_publishable_ excluido a propósito.
if rg -n --hidden --glob '!.git/**' --glob '!*.example' --glob '!tools/secret-gate.sh' \
  -e '-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----' \
  -e 'postgres(?:ql)?://[^[:space:]/]+:[^[:space:]@]+@' \
  -e 'SUPABASE_SERVICE_ROLE_KEY[^[:cntrl:]]*eyJ' \
  -e 'sb_secret_[A-Za-z0-9_-]{10,}' \
  -e 'service_role[^[:cntrl:]]{0,40}eyJ[A-Za-z0-9_-]{10,}' \
  -e 'eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}' \
  -e 'sbp_[A-Za-z0-9]{40,}' \
  -e 'gh[pousr]_[A-Za-z0-9]{30,}' \
  -e 'xox[baprs]-[A-Za-z0-9-]{10,}' \
  -e 're_[A-Za-z0-9]{25,}' \
  -e 'AKIA[0-9A-Z]{16}' \
  -e '(access|refresh)_token"?\s*[:=]\s*"?eyJ' \
  -e 'sb-[a-z0-9]+-auth-token' \
  -e '(passwd|password)\s*[:=]\s*["'\''][^"'\'' ]{6,}' \
  -e '(recovery|magiclink|magic_link|confirmation)[^[:cntrl:]]{0,20}token=[A-Za-z0-9._-]{20,}' \
  . ; then
  echo 'SECRET_GATE: FAIL secret-shaped value detected'
  exit 1
fi

# 3) sb_publishable_ NO debe tratarse como secreto: aviso informativo si aparece.
if rg -q -n --glob '!.git/**' -e 'sb_publishable_' . 2>/dev/null; then
  echo 'SECRET_GATE: note sb_publishable_ present (public by design; OK)'
fi

echo 'SECRET_GATE: PASS'
