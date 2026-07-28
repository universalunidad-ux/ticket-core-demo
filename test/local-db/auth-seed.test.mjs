// TC-RECOVERY-P5-P9-CLOSE-05
// Pruebas del owner del seed sintetico de auth.users. Cubren lo que el contrato
// no repite: el consumo en streaming del COPY y la forma exacta del correo.

import test from "node:test";
import assert from "node:assert/strict";

import {
  newPerfilesState, feedPerfilesLine, parsePerfilesIds, renderAuthSeedSql,
  syntheticEmail, isUuid, SYNTHETIC_EMAIL_DOMAIN, SYNTHETIC_PASSWORD_MARKER,
} from "../../tools/local-db/lib/auth-seed.mjs";

const ID_A = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const ID_B = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

test("el COPY se consume linea a linea y solo se retiene la columna id", () => {
  const s = newPerfilesState();
  for (const line of [
    "SET statement_timeout = 0;",
    "COPY public.perfiles (id, nombre, email, telefono) FROM stdin;",
    `${ID_A}\tJuan Real\tjuan@empresa.com\t+52 55 1234 5678`,
    `${ID_B}\tAna Real\tana@empresa.com\t+52 55 8765 4321`,
    "\\.",
  ]) feedPerfilesLine(s, line);
  assert.deepEqual(s.ids, [ID_A, ID_B]);
  assert.equal(JSON.stringify(s).includes("empresa.com"), false, "no puede retenerse PII");
  assert.equal(s.inCopy, false, "el terminador \\. cierra el bloque");
});

test("la columna id se localiza por nombre, no por posicion", () => {
  const ids = parsePerfilesIds([
    "COPY public.perfiles (nombre, id, rol) FROM stdin;",
    `Juan\t${ID_A}\tagente`,
    "\\.",
  ].join("\n"));
  assert.deepEqual(ids, [ID_A]);
});

test("un COPY de otra tabla no se procesa", () => {
  assert.deepEqual(parsePerfilesIds(`COPY public.tickets (id) FROM stdin;\n${ID_A}\n\\.`), []);
});

test("un id que no es UUID aborta sin emitir el valor", () => {
  assert.throws(
    () => parsePerfilesIds("COPY public.perfiles (id, email) FROM stdin;\njuan@real.com\tx\n\\."),
    (e) => e instanceof Error && /no es un UUID/.test(e.message) && !/juan@real\.com/.test(e.message),
    "el mensaje de error tampoco puede filtrar el valor",
  );
});

test("el correo sintetico es determinista, minusculo y del dominio reservado", () => {
  const a = syntheticEmail(ID_A);
  assert.equal(a, syntheticEmail(ID_A.toUpperCase()));
  assert.match(a, new RegExp(`^usr-[0-9a-f]{12}@${SYNTHETIC_EMAIL_DOMAIN.replace(".", "\\.")}$`));
  assert.notEqual(a, syntheticEmail(ID_B), "ids distintos no pueden colisionar");
  assert.throws(() => syntheticEmail("no-uuid"), /uuid invalido/);
});

test("el SQL deduplica, ordena y es idempotente", () => {
  const sql = renderAuthSeedSql([ID_B, ID_A, ID_A]);
  assert.ok(sql.indexOf(ID_A) < sql.indexOf(ID_B), "orden determinista");
  assert.equal(sql.split(ID_A).length - 1, 1, "el id duplicado se siembra una sola vez");
  assert.ok(sql.includes(syntheticEmail(ID_A)), "cada id lleva su correo sintetico");
  assert.match(
    sql,
    /select v\.instance_id::uuid, v\.id::uuid, v\.aud, v\.role, v\.email,/i,
    "instance_id e id deben llegar tipados como uuid",
  );
  assert.doesNotMatch(
    sql,
    /select\s+v\.instance_id\s*,\s*v\.id\s*,/i,
    "el patron antiguo sin casts queda prohibido",
  );
  assert.match(sql, /on conflict \(id\) do nothing/i);
  assert.match(sql, /AUTH_SEED_ROWS=2/);
});

test("las cuentas sembradas no pueden autenticarse", () => {
  const sql = renderAuthSeedSql([ID_A]);
  assert.ok(sql.includes(SYNTHETIC_PASSWORD_MARKER), "marcador de contrasena no utilizable");
  assert.doesNotMatch(sql, /\$2[aby]\$/, "no puede haber un hash bcrypt valido");
});

test("el seed solo toca auth.users", () => {
  const sql = renderAuthSeedSql([ID_A]);
  assert.match(sql, /insert into auth\.users/i);
  assert.equal((sql.match(/insert into/gi) || []).length, 1);
  assert.doesNotMatch(sql, /auth\.(identities|sessions|refresh_tokens)/i);
  assert.match(sql, /@example\.invalid/i);
});

test("el SQL generado no copia PII del dump", () => {
  const ids = parsePerfilesIds([
    "COPY public.perfiles (id, nombre, email, telefono) FROM stdin;",
    `${ID_A}\tNombre Privado\tcorreo.real@empresa.com\t+52 55 1234 5678`,
    "\\.",
  ].join("\n"));
  const sql = renderAuthSeedSql(ids);
  assert.doesNotMatch(sql, /Nombre Privado|correo\.real@empresa\.com|\+52 55 1234 5678/i);
  assert.match(sql, /@example\.invalid/i);
});

test("un UUID invalido en renderAuthSeedSql falla cerrado", () => {
  assert.throws(() => renderAuthSeedSql(["no-es-uuid"]), /uuid invalido en el seed/);
});

test("isUuid es estricto", () => {
  assert.equal(isUuid(ID_A), true);
  assert.equal(isUuid("3f2504e0-4f89-11d3-9a0c-0305e82c330"), false);
  assert.equal(isUuid(null), false);
});
