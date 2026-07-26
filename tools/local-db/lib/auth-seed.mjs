// TC-RECOVERY-P5-P9-CLOSE-05
// auth-seed.mjs — OWNER ÚNICO del seed SINTÉTICO de auth.users (P7).
//
// Problema que cierra: `public.perfiles.id` tiene FK a `auth.users(id)`, pero
// `auth.*` es platform-managed y NO viaja en el dump de datos. Sin usuarios en
// auth.users el restore de perfiles falla por FK, y con ello todo el plano de
// datos. El punto de extensión anterior (`tools/local-db/seed-auth-users.sh`)
// no existía: el script sólo emitía un WARN y dejaba caer el restore.
//
// Estrategia canónica (sin PII real):
//   - Los UUID NO se inventan: son EXACTAMENTE los `perfiles.id` que trae el
//     dump. Son deterministas (misma entrada -> mismo seed) y son los únicos
//     valores que satisfacen la FK. Un UUID no es un dato personal.
//   - TODO lo demás es sintético: correo `usr-<12hex>@example.invalid`
//     (RFC 2606/6761: dominio reservado, no resoluble), contraseña cifrada
//     imposible de usar, metadata vacía. Ningún nombre, correo o teléfono real
//     del dump cruza a este SQL.
//   - La entrada (COPY de perfiles, que SÍ contiene PII) se consume en
//     streaming desde stdin y NUNCA se escribe a disco ni se imprime.
//
// Uso como CLI:
//   pg_restore --data-only --table=perfiles -f - dump \
//     | node tools/local-db/lib/auth-seed.mjs --emit-sql > seed.sql

import { createInterface } from "node:readline";

export const SYNTHETIC_EMAIL_DOMAIN = "example.invalid";
// Marcador que NO es un hash bcrypt válido: crypt() nunca coincide, así que
// ninguna de estas cuentas puede autenticarse. No es un secreto.
export const SYNTHETIC_PASSWORD_MARKER = "!synthetic-no-login";
export const SYNTHETIC_TIMESTAMP = "2000-01-01 00:00:00+00";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v) { return typeof v === "string" && UUID_RE.test(v); }

// PURO · Correo sintético determinista a partir del UUID. Mismo id -> mismo
// correo, en un dominio reservado que nunca puede recibir correo real.
export function syntheticEmail(uuid) {
  if (!isUuid(uuid)) throw new Error(`uuid invalido: ${String(uuid)}`);
  return `usr-${uuid.replace(/-/g, "").slice(0, 12).toLowerCase()}@${SYNTHETIC_EMAIL_DOMAIN}`;
}

// ---------------------------------------------------------------------------
// PURO · Extrae los `id` del bloque `COPY public.perfiles (...) FROM stdin;`.
// Sólo se conserva la columna `id`; el resto de columnas (nombre, correo real,
// teléfono) se descarta en el acto y no se devuelve por ninguna vía.
// ---------------------------------------------------------------------------
export function parsePerfilesIds(text) {
  const state = { inCopy: false, idIndex: -1, ids: [] };
  for (const line of String(text || "").split("\n")) feedPerfilesLine(state, line);
  return state.ids;
}

export function newPerfilesState() { return { inCopy: false, idIndex: -1, ids: [] }; }

export function feedPerfilesLine(state, rawLine) {
  const line = rawLine.replace(/\r$/, "");
  if (!state.inCopy) {
    const m = /^\s*COPY\s+public\.perfiles\s*\(([^)]*)\)\s+FROM\s+stdin;/i.exec(line);
    if (!m) return state;
    const cols = m[1].split(",").map((c) => c.trim().replace(/^"|"$/g, "").toLowerCase());
    state.idIndex = cols.indexOf("id");
    if (state.idIndex < 0) throw new Error("el COPY de public.perfiles no declara la columna id");
    state.inCopy = true;
    return state;
  }
  if (line === "\\.") { state.inCopy = false; return state; }
  const value = line.split("\t")[state.idIndex];
  if (!isUuid(value)) {
    // Fail-closed: si la columna id no es un UUID, el parseo está desalineado y
    // podríamos estar leyendo una columna con PII. Se aborta sin emitir el valor.
    throw new Error(`columna id no es un UUID en la fila ${state.ids.length + 1} del COPY de perfiles`);
  }
  state.ids.push(value.toLowerCase());
  return state;
}

// ---------------------------------------------------------------------------
// PURO · SQL de seed. Idempotente (ON CONFLICT DO NOTHING) y acotado a auth.users.
// ---------------------------------------------------------------------------
export function renderAuthSeedSql(ids) {
  const unique = [...new Set(ids.map((i) => String(i).toLowerCase()))].sort();
  if (unique.length === 0) throw new Error("no hay perfiles.id: nada que sembrar (fail-closed)");
  for (const id of unique) if (!isUuid(id)) throw new Error(`uuid invalido en el seed: ${id}`);

  const values = unique
    .map((id) => `  ('00000000-0000-0000-0000-000000000000','${id}','authenticated','authenticated','${syntheticEmail(id)}')`)
    .join(",\n");

  return [
    "-- GENERADO por tools/local-db/lib/auth-seed.mjs (TC-RECOVERY-P5-P9-CLOSE-05).",
    "-- Usuarios SINTÉTICOS para satisfacer public.perfiles.id -> auth.users(id).",
    `-- ${unique.length} usuario(s). Correos en ${SYNTHETIC_EMAIL_DOMAIN} (dominio reservado).`,
    "-- Sin PII: no se copia ningún nombre, correo ni teléfono del dump.",
    "begin;",
    "insert into auth.users (instance_id, id, aud, role, email,",
    "  encrypted_password, email_confirmed_at, created_at, updated_at,",
    "  raw_app_meta_data, raw_user_meta_data)",
    "select v.instance_id, v.id, v.aud, v.role, v.email,",
    `  '${SYNTHETIC_PASSWORD_MARKER}', '${SYNTHETIC_TIMESTAMP}'::timestamptz,`,
    `  '${SYNTHETIC_TIMESTAMP}'::timestamptz, '${SYNTHETIC_TIMESTAMP}'::timestamptz,`,
    "  '{\"provider\":\"synthetic\",\"providers\":[\"synthetic\"]}'::jsonb, '{}'::jsonb",
    "from (values",
    values,
    ") as v(instance_id, id, aud, role, email)",
    "on conflict (id) do nothing;",
    "commit;",
    `\\echo AUTH_SEED_ROWS=${unique.length}`,
    "",
  ].join("\n");
}

// PURO · Guarda anti-PII sobre el SQL ya generado. Se ejecuta SIEMPRE antes de
// emitirlo: si algún correo no está en el dominio reservado, no se emite nada.
export function assertSyntheticOnly(sql) {
  const emails = String(sql).match(/[\w.+-]+@[\w.-]+/g) || [];
  const foreign = emails.filter((e) => !e.toLowerCase().endsWith(`@${SYNTHETIC_EMAIL_DOMAIN}`));
  if (foreign.length > 0) throw new Error(`el seed contiene ${foreign.length} correo(s) fuera de ${SYNTHETIC_EMAIL_DOMAIN}`);
  if (/\b(auth\.identities|auth\.sessions|auth\.refresh_tokens)\b/i.test(sql)) {
    throw new Error("el seed sólo puede tocar auth.users");
  }
  return true;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function isMain() {
  if (!process.argv[1]) return false;
  try { return new URL(`file://${process.argv[1]}`).pathname.endsWith("/auth-seed.mjs"); }
  catch { return false; }
}

if (isMain() && process.argv.includes("--emit-sql")) {
  const state = newPerfilesState();
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  try {
    for await (const line of rl) feedPerfilesLine(state, line);
    const sql = renderAuthSeedSql(state.ids);
    assertSyntheticOnly(sql);
    process.stdout.write(sql);
    process.stderr.write(`AUTH_SEED=PASS\nAUTH_SEED_USERS=${new Set(state.ids).size}\n`);
  } catch (e) {
    // El mensaje nunca lleva filas del dump: sólo posiciones y conteos.
    process.stderr.write(`AUTH_SEED=FAIL\nAUTH_SEED_DETAIL=${String(e && e.message)}\n`);
    process.exit(5);
  }
}
