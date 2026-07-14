#!/usr/bin/env bash
set -euo pipefail

root="${1:-.}"
cd "$root"

if find . -type f \( -name '.env' -o -name 'supabase.config.local.js' \) -not -path './.git/*' -print -quit | grep -q .; then
  echo 'SECRET_GATE: FAIL forbidden local config/.env'
  exit 1
fi

if rg -n --hidden --glob '!.git/**' --glob '!*.example' --glob '!tools/secret-gate.sh' \
  -e '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----' \
  -e 'postgres(?:ql)?://[^[:space:]/]+:[^[:space:]@]+@' \
  -e 'SUPABASE_SERVICE_ROLE_KEY[^[:cntrl:]]*eyJ' .; then
  echo 'SECRET_GATE: FAIL secret-shaped value detected'
  exit 1
fi

echo 'SECRET_GATE: PASS'
