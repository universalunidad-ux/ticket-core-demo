#!/usr/bin/env python3
"""Validador estricto de la unica excepcion permitida en tools/secret-gate.sh.

Supabase publica dos formatos de clave de navegador que son publicas por diseno:
  * el formato nuevo `sb_publishable_...` (el gate nunca lo marca), y
  * el formato legacy: un JWT HS256 cuyo claim `role` es exactamente `anon`.

El escaner generico marca cualquier JWT de tres segmentos, de modo que el formato
legacy produce un falso positivo. Este validador autoriza ese caso y NADA mas:

  1. la ruta relativa debe ser exactamente app/supabase.config.public.js;
  2. el archivo debe ser el config publico minimo (tamano y forma acotados);
  3. no puede contener marcadores de credencial privilegiada;
  4. debe declarar exactamente una supabaseUrl https://<ref>.supabase.co;
  5. cada JWT debe decodificar a alg=HS256, typ=JWT, iss=supabase,
     role == "anon" (comparacion exacta) y ref == <ref> de la URL;
  6. el payload no puede traer claims fuera de {iss, ref, role, iat, exp};
  7. ningun otro patron del gate puede coincidir en el archivo.

Cualquier desviacion -> no autorizado. Nunca imprime el valor de la clave.

Codigos de salida:
  0: archivo autorizado (falso positivo confirmado)
  1: archivo NO autorizado (el hallazgo del gate se mantiene)
  2: error de validador/configuracion
"""

import argparse
import base64
import binascii
import json
import re
import sys
from pathlib import Path

ALLOWED_RELATIVE_PATH = "app/supabase.config.public.js"
MAX_BYTES = 2048
MAX_LINES = 12

JWT_RE = re.compile(r"eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}")
GENERIC_JWT_PATTERN = (
    r"eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"
)
SUPABASE_URL_RE = re.compile(
    r'supabaseUrl\s*:\s*"https://([a-z0-9]{20})\.supabase\.co"'
)
PRIVILEGED_MARKERS = (
    "service" + "_role",
    "SERVICE" + "_ROLE",
    "sb" + "_secret_",
    "SUPABASE" + "_SERVICE_ROLE_KEY",
    "secretKey",
    "serviceKey",
)
ALLOWED_PAYLOAD_CLAIMS = {"iss", "ref", "role", "iat", "exp"}


def reject(reason: str) -> int:
    print(f"secret-gate-public-anon: NOT_ALLOWED {reason}", file=sys.stderr)
    return 1


def fail(reason: str) -> int:
    print(f"secret-gate-public-anon: ERROR {reason}", file=sys.stderr)
    return 2


def b64url_json(segment: str):
    padded = segment + "=" * (-len(segment) % 4)
    return json.loads(base64.urlsafe_b64decode(padded))


def load_other_patterns(patterns_path: Path):
    compiled = []
    for line in patterns_path.read_text(encoding="utf-8").splitlines():
        if not line or line == GENERIC_JWT_PATTERN:
            continue
        translated = line.replace("[:space:]", r"\s").replace(
            "[:cntrl:]", r"\x00-\x1f\x7f"
        )
        compiled.append(re.compile(translated))
    return compiled


def validate(root: Path, relative: str, patterns_path: Path) -> int:
    if relative != ALLOWED_RELATIVE_PATH:
        return reject(f"path not allowlisted: {relative}")

    target = (root / relative).resolve()
    try:
        target.relative_to(root.resolve())
    except ValueError:
        return reject("path escapes scan root")
    if target.is_symlink() or not target.is_file():
        return reject("not a regular file")

    raw = target.read_bytes()
    if len(raw) > MAX_BYTES:
        return reject(f"file too large for a public config ({len(raw)} bytes)")
    try:
        text = raw.decode("utf-8")
    except UnicodeError:
        return reject("file is not valid utf-8")
    if len(text.splitlines()) > MAX_LINES:
        return reject("file has more lines than a public config")

    if "window.TICKET_CORE_CONFIG" not in text:
        return reject("missing window.TICKET_CORE_CONFIG")

    for marker in PRIVILEGED_MARKERS:
        if marker in text:
            return reject("privileged credential marker present")

    urls = SUPABASE_URL_RE.findall(text)
    if len(urls) != 1:
        return reject(f"expected exactly one supabase project url, found {len(urls)}")
    project_ref = urls[0]

    tokens = JWT_RE.findall(text)
    if not tokens:
        return reject("no jwt-shaped token to adjudicate")

    for token in tokens:
        header_segment, payload_segment, _signature = token.split(".")
        try:
            header = b64url_json(header_segment)
            payload = b64url_json(payload_segment)
        except (ValueError, binascii.Error, UnicodeDecodeError):
            return reject("token is not a decodable jwt")
        if not isinstance(header, dict) or not isinstance(payload, dict):
            return reject("token segments are not json objects")
        if header.get("alg") != "HS256" or header.get("typ") != "JWT":
            return reject("unexpected jwt header")
        if payload.get("iss") != "supabase":
            return reject("issuer is not supabase")
        if payload.get("role") != "anon":
            return reject("token role is not anon")
        if payload.get("ref") != project_ref:
            return reject("token project ref does not match the configured url")
        if not set(payload).issubset(ALLOWED_PAYLOAD_CLAIMS):
            return reject("token carries unexpected claims")

    residual = text
    for token in tokens:
        residual = residual.replace(token, "<PUBLIC_ANON_KEY>")
    for pattern in load_other_patterns(patterns_path):
        if pattern.search(residual):
            return reject("another secret pattern matches this file")

    print(
        "secret-gate-public-anon: ALLOWED "
        f"{relative} (role=anon ref={project_ref})"
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--patterns", required=True, type=Path)
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("relative")
    args = parser.parse_args()
    try:
        root = args.root.resolve(strict=True)
        if not root.is_dir():
            return fail(f"scan root is not a directory: {root}")
        if not args.patterns.is_file():
            return fail(f"pattern file unavailable: {args.patterns}")
        return validate(root, args.relative, args.patterns)
    except (OSError, re.error, json.JSONDecodeError) as error:
        return fail(str(error))


if __name__ == "__main__":
    sys.exit(main())
