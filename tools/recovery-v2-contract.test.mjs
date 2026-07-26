#!/usr/bin/env node
// TC-RECOVERY-SEQUENTIAL-SCORABLE-01
// recovery-v2-contract.test.mjs — Contratos SEMÁNTICOS (sin Docker, sin
// Supabase CLI, sin red).
//
// Diferencia con la versión anterior: aquellos contratos comprobaban CADENAS
// ("el script menciona teardown", "el script menciona realtime"). Una cadena se
// satisface con un comentario, así que no detectaban regresiones de
// comportamiento. Estos contratos comprueban COMPORTAMIENTO:
//
//   - Sobre bash: se eliminan los comentarios ANTES de aserciones sobre código
//     ejecutable, se extraen cuerpos de función y se verifica dónde vive cada
//     decisión (abort vs WARN, orden entre guardas y ALTER, qué rama borra el
//     runtime).
//   - Sobre los módulos .mjs: se IMPORTAN y se ejecutan con entradas mutadas,
//     de modo que la aserción falla si la lógica cambia, no si cambia un texto.
//
// Mutaciones que estos contratos deben detectar (una aserción por cada una):
//   head -1 ejecutable · omitir project_id · ignorar DB_PORT · seleccionar más
//   de un contenedor · separar CID y DB_URL · ledger != 31 degradado a WARN ·
//   paridad bloqueante degradada a WARN · RESULT=PASS con DIFF_FOUND · abort
//   sin teardown · Ctrl-C con resultado PASS · borrado de runtime antes de un
//   stop exitoso · ausencia de seed auth · trigger deshabilitado sin
//   reactivación · tabla sin ownership validado · dump fuera de allowlist ·
//   runbook desincronizado.
//
// Uso:  node tools/recovery-v2-contract.test.mjs
// Exit 0 con "RECOVERY_V2_CONTRACT=PASS".

import assert from "node:assert/strict";
import { readFileSync, statSync, readdirSync } from "node:fs";

import {
  selectDbContainer, parseCliArgs, stopLocalStack, parseProjectIdFromToml,
  BootstrapError,
} from "../tools/local-db/lib/bootstrap.mjs";
import {
  parseRestoreToc, parseAllowedTables, adjudicateToc, scanContentLine,
} from "../tools/local-db/lib/dump-allowlist.mjs";
import {
  parsePerfilesIds, renderAuthSeedSql, assertSyntheticOnly, syntheticEmail,
} from "../tools/local-db/lib/auth-seed.mjs";

const SH_PATH = "tools/local-db/run-recovery-v2.sh";
const SYNTH_SH_PATH = "tools/local-db/run-recovery-v2-synthetic.sh";
const SQL_PATH = "tools/local-db/recovery-signature.sql";
const FK_SQL_PATH = "tools/local-db/fk-integrity.sql";
const ORDER_PATH = "tools/local-db/recovery-data-order.txt";
const RUNBOOK_PATH = "docs/operations/RECOVERY_V2_RUNBOOK.md";
const BOOTSTRAP_PATH = "tools/local-db/lib/bootstrap.mjs";
const ALLOWLIST_PATH = "tools/local-db/lib/dump-allowlist.mjs";
const AUTHSEED_PATH = "tools/local-db/lib/auth-seed.mjs";
const LOCAL_AUTH_PATH = "tools/local-db/lib/local-auth-users.mjs";
const LOCAL_AUTH_TEST_PATH = "test/local-db/local-auth-users.test.mjs";
const MIGRATIONS_DIR = "supabase/migrations";

function read(path) {
  try { return readFileSync(path, "utf8"); }
  catch (e) { throw new Error(`no se pudo leer ${path}: ${e.message}`); }
}

const sh = read(SH_PATH);
const synthSh = read(SYNTH_SH_PATH);
const sql = read(SQL_PATH);
const fkSql = read(FK_SQL_PATH);
const order = read(ORDER_PATH);
const runbook = read(RUNBOOK_PATH);
const bootstrapSrc = read(BOOTSTRAP_PATH);

// ---------------------------------------------------------------------------
// Utilidades de análisis de bash. Sin ellas, cualquier aserción sobre "código"
// se satisface con un comentario.
// ---------------------------------------------------------------------------
function stripBashComments(text) {
  return text
    .split("\n")
    .map((line) => {
      if (/^\s*#/.test(line)) return "";
      const hash = line.indexOf("#");
      if (hash <= 0) return line;
      const before = line.slice(0, hash);
      const balanced = (s, q) => (s.split(q).length - 1) % 2 === 0;
      if (!balanced(before, "'") || !balanced(before, '"')) return line;
      if (!/\s$/.test(before)) return line;
      return before;
    })
    .join("\n");
}

function stripJsComments(text) {
  return text.split("\n").map((l) => (/^\s*\/\//.test(l) ? "" : l)).join("\n");
}

// Cuerpo de una función bash `name() { ... }` con `}` en columna 0.
function bashFunction(text, name) {
  const start = text.indexOf(`${name}() {`);
  assert.notEqual(start, -1, `no existe la funcion bash ${name}()`);
  const end = text.indexOf("\n}", start);
  assert.notEqual(end, -1, `la funcion ${name}() no cierra en columna 0`);
  return text.slice(start, end + 2);
}

// Bloque `if <cond> ... fi` que contiene una condición dada.
function bashIfBlock(text, needle) {
  const at = text.indexOf(needle);
  assert.notEqual(at, -1, `no se encontro la condicion: ${needle}`);
  const start = text.lastIndexOf("\nif ", at);
  assert.notEqual(start, -1, `la condicion ${needle} no esta dentro de un if`);
  const end = text.indexOf("\nfi", at);
  assert.notEqual(end, -1, `el if de ${needle} no cierra`);
  return text.slice(start, end + 3);
}

const shExec = stripBashComments(sh);
const synthExec = stripBashComments(synthSh);
const bootstrapExec = stripJsComments(bootstrapSrc);

// ===========================================================================
// 1) Artefactos de la unidad
// ===========================================================================
for (const p of [SH_PATH, SQL_PATH, FK_SQL_PATH, ORDER_PATH, RUNBOOK_PATH,
  BOOTSTRAP_PATH, ALLOWLIST_PATH, AUTHSEED_PATH, SYNTH_SH_PATH,
  LOCAL_AUTH_PATH, LOCAL_AUTH_TEST_PATH]) {
  assert.ok(statSync(p).size > 0, `${p} esta vacio o no existe`);
}
assert.ok((statSync(SH_PATH).mode & 0o111) !== 0, `${SH_PATH} debe ser ejecutable`);
assert.ok((statSync(SYNTH_SH_PATH).mode & 0o111) !== 0, `${SYNTH_SH_PATH} debe ser ejecutable`);
assert.match(sh, /^#!\/usr\/bin\/env bash/, "shebang bash esperado");
assert.match(shExec, /set -Eeuo pipefail/, "modo fail-closed requerido");
console.log("PASS\tartifacts_exist\tcount=11");

// ===========================================================================
// 2) MUTACIÓN: reintroducir `head -1` ejecutable
// El texto histórico lo menciona en comentarios a propósito; la aserción sólo
// mira código ejecutable, así que un comentario no puede satisfacerla ni
// romperla.
// ===========================================================================
assert.doesNotMatch(shExec, /\bhead\s+-1\b/, "`head -1` reintroducido en codigo ejecutable");
assert.doesNotMatch(bootstrapExec, /\bhead\s+-1\b/, "`head -1` reintroducido en bootstrap.mjs");
assert.doesNotMatch(
  shExec,
  /docker\s+ps[^\n]*\|[^\n]*head/,
  "la salida de `docker ps` no puede canalizarse a head: la resolucion es por (proyecto AND puerto)",
);
console.log("PASS\tno_head_minus_1_in_executable_code");

// ===========================================================================
// 3) MUTACIÓN: seleccionar más de un contenedor / contenedor ajeno
// Comportamiento real, no cadena.
// ===========================================================================
{
  const ps = [
    "supabase_db_tc_recovery_v2|||0.0.0.0:54339->5432/tcp",
    "supabase_db_tc_local_db_harness|||0.0.0.0:54329->5432/tcp",
  ].join("\n");
  const ok = selectDbContainer(ps, { projectId: "tc_recovery_v2", dbPort: 54339 });
  assert.equal(ok.name, "supabase_db_tc_recovery_v2");

  const dup = [
    "supabase_db_tc_recovery_v2|||0.0.0.0:54339->5432/tcp",
    "supabase_db_tc_recovery_v2|||0.0.0.0:54339->5432/tcp",
  ].join("\n");
  assert.throws(() => selectDbContainer(dup, { projectId: "tc_recovery_v2", dbPort: 54339 }),
    (e) => e instanceof BootstrapError && e.fields.REASON === "CONTAINER_AMBIGUOUS",
    "mas de un contenedor debe abortar, nunca elegir uno");

  assert.throws(() => selectDbContainer(
    "supabase_db_otro_proyecto|||0.0.0.0:54339->5432/tcp",
    { projectId: "tc_recovery_v2", dbPort: 54339 }),
  (e) => e instanceof BootstrapError && e.fields.REASON === "CONTAINER_PORT_FOREIGN",
  "un contenedor ajeno publicando el puerto debe abortar");
}
console.log("PASS\tcontainer_resolution_is_exactly_one");

// ===========================================================================
// 4) MUTACIÓN: omitir project_id / ignorar DB_PORT
// ===========================================================================
assert.throws(() => parseCliArgs(["--db-port", "54339", "--runtime-dir", "tools/local-db/.x"]),
  BootstrapError, "sin --project-id el bootstrap debe abortar");
assert.throws(() => parseCliArgs(["--project-id", "tc_recovery_v2", "--runtime-dir", "tools/local-db/.x"]),
  BootstrapError, "sin --db-port el bootstrap debe abortar");
assert.throws(() => parseCliArgs(["--stop", "--runtime-dir", "tools/local-db/.x"]),
  BootstrapError, "ni siquiera --stop puede prescindir de --project-id");
assert.match(shExec, /PROJECT_ID="tc_recovery_v2"/, "project_id del clon de recovery");
assert.match(shExec, /DB_PORT="54339"/, "puerto DB por defecto del clon de recovery");
assert.match(shExec, /--project-id\s+"\$\{PROJECT_ID\}"/, "el script debe pasar --project-id");
assert.match(shExec, /--db-port\s+"\$\{DB_PORT\}"/, "el script debe pasar --db-port");
assert.match(shExec, /CID\}"\s*!=\s*"supabase_db_\$\{PROJECT_ID\}/,
  "el script debe verificar que el contenedor es el del proyecto");
console.log("PASS\tproject_id_and_db_port_are_mandatory");

// ===========================================================================
// 5) MUTACIÓN: separar CID y DB_URL (split-brain)
// ===========================================================================
assert.match(bootstrapExec, /cidDbUrlSingleSource:\s*true/,
  "bootstrapLocalStack debe declarar la fuente unica de CID+DB_URL");
{
  const block = bashIfBlock(shExec, 'CID_DB_URL_SINGLE_SOURCE}" != "YES"');
  assert.match(block, /abort\s+"BOOTSTRAP"/, "un split-brain CID/DB_URL debe abortar, no advertir");
}
console.log("PASS\tcid_and_db_url_single_source");

// ===========================================================================
// 6) MUTACIÓN: ledger != 31 convertido en WARN
// ===========================================================================
assert.match(shExec, /EXPECTED_MIGRATIONS="31"/, "la baseline canonica es de 31 migraciones");
{
  const block = bashIfBlock(shExec, 'LEDGER_COUNT}" != "${EXPECTED_MIGRATIONS}"');
  assert.match(block, /\babort\b/, "un ledger distinto de 31 debe ABORTAR");
  assert.doesNotMatch(block, /WARN/, "el ledger no puede degradarse a WARN");
}
console.log("PASS\tledger_mismatch_is_fail_closed");

// ===========================================================================
// 7) MUTACIÓN: paridad bloqueante convertida en WARN
// ===========================================================================
assert.match(shExec, /BLOCKING_SECTIONS="STRUCTURE FUNCTIONS POLICIES ACL DATA"/,
  "las 5 secciones bloqueantes deben estar declaradas");
{
  const block = bashIfBlock(shExec, '-n "${BLOCKING_DIVERGED}"');
  assert.match(block, /\babort\s+"VALIDATION"/, "una divergencia bloqueante debe ABORTAR");
  assert.doesNotMatch(block, /WARN/, "la paridad bloqueante no puede degradarse a WARN");
}
// Las informativas SÍ pueden divergir y NUNCA deben abortar.
assert.match(shExec, /INFORMATIVE_SECTIONS="LEDGER STORAGE OWNERSHIP"/,
  "las secciones informativas deben estar declaradas aparte");
console.log("PASS\tblocking_parity_aborts_informative_does_not");

// ===========================================================================
// 8) MUTACIÓN: RESULT=PASS con DIFF_FOUND
// El invariante debe existir Y evaluarse ANTES de fijar RESULT="PASS".
// ===========================================================================
{
  const guardAt = shExec.indexOf("DIFF_FOUND|SOURCE_SIGNATURE_FAILED|FAIL)");
  // El veredicto final es el ULTIMO RESULT="PASS": el primero es el del
  // --dry-run, que sale antes de tocar Docker y no participa de esta invariante.
  const passAt = shExec.lastIndexOf('RESULT="PASS"');
  assert.notEqual(guardAt, -1, "falta el invariante de veredicto");
  assert.ok(guardAt < passAt, "el invariante debe evaluarse ANTES de RESULT=PASS");
  for (const field of ["STRUCTURE_PARITY", "DATA_PARITY", "RLS_RESTORE_RESULT",
    "ACL_RESTORE_RESULT", "DUMP_ALLOWLIST_RESULT", "DUMP_CONTENT_SCAN",
    "AUTH_SEED_RESULT", "OWNERSHIP_CHECK", "INTEGRITY_RESTORE_RESULT", "FK_INTEGRITY",
    "SOURCE_SIGNATURE_RESULT"]) {
    assert.match(
      shExec.slice(shExec.lastIndexOf("for parity_field in", guardAt), guardAt),
      new RegExp(`\\$\\{${field}\\}`),
      `el invariante de veredicto debe cubrir ${field}`,
    );
  }
}
console.log("PASS\tno_pass_with_diff_found\tfields=11");

// ===========================================================================
// 9) MUTACIÓN: abort sin teardown · Ctrl-C con resultado PASS
// ===========================================================================
{
  const abortFn = bashFunction(shExec, "abort");
  assert.match(abortFn, /RESULT="FAIL"/, "abort debe fijar RESULT=FAIL");
  assert.match(abortFn, /SCORABLE="NO"/, "abort debe fijar SCORABLE=NO");
  assert.match(abortFn, /restore_integrity/, "abort debe restituir la integridad");
  assert.match(abortFn, /teardown_stack/, "abort debe hacer teardown del stack propio");
  assert.match(abortFn, /write_report/, "abort debe escribir el reporte (evidencia preservada)");
  assert.match(abortFn, /exit\s+1/, "abort no puede salir con 0");

  const sig = bashFunction(shExec, "on_signal");
  assert.match(sig, /RESULT="FAIL"/, "una senal NUNCA puede terminar como PASS");
  assert.match(sig, /INTERRUPTED="YES"/, "una senal debe marcar INTERRUPTED=YES");
  assert.match(sig, /SCORABLE="NO"/, "una corrida interrumpida no es scorable");
  assert.match(sig, /restore_integrity/, "una senal debe restituir la integridad");
  assert.match(sig, /teardown_stack/, "una senal debe detener el stack propio");
  assert.match(sig, /exit \$\(\(128 \+ signum\)\)/, "el exit code debe ser 128+senal, nunca 0");

  assert.match(shExec, /trap 'on_signal INT 2' INT/, "falta el trap de SIGINT (Ctrl-C)");
  assert.match(shExec, /trap 'on_signal TERM 15' TERM/, "falta el trap de SIGTERM");
  assert.match(shExec, /trap 'abort "UNEXPECTED"[^\n]*' ERR/, "falta el trap de ERR");
  // Y el invariante final lo vuelve a bloquear aunque alguien toque los traps.
  assert.match(bashIfBlock(shExec, 'INTERRUPTED}" != "NO"'), /abort\s+"LIFECYCLE"/,
    "una corrida interrumpida no puede alcanzar RESULT=PASS");
}
console.log("PASS\tabort_and_signals_teardown_and_never_pass");

// ===========================================================================
// 10) MUTACIÓN: borrado del runtime antes de un stop exitoso
// Estático (el script no puede borrar por su cuenta) + de comportamiento
// (stopLocalStack con stop fallido NO borra).
// ===========================================================================
assert.doesNotMatch(shExec, /rm\s+-rf\s+"?\$\{RUNTIME_DIR\}/,
  "el script no puede borrar el runtime por su cuenta: eso lo decide el owner del teardown");
assert.doesNotMatch(shExec, /rm\s+-rf\s+"?\$\{ARTIFACTS/,
  "los artefactos NUNCA se borran");
{
  const td = bashFunction(shExec, "teardown_stack");
  assert.match(td, /STOP_ATTEMPTED}" == "no"/, "el teardown debe ser idempotente (un solo intento)");
  assert.match(td, /STACK_OWNED}" != "yes"/, "sin ownership registrado no se detiene nada");
  assert.match(td, /--stop/, "el teardown debe delegar en el owner unico (bootstrap.mjs --stop)");
  assert.match(td, /RUNTIME_PRESERVED="YES"/, "si el stop falla, el runtime se preserva");
  assert.match(td, /PRESERVED_CID/, "si el stop falla debe preservarse el CID para recuperacion manual");
  assert.match(td, /PRESERVED_PROJECT_ID/, "si el stop falla debe preservarse el project_id");
  // El registro de ownership ocurre DESPUÉS del bootstrap, no antes.
  assert.ok(
    shExec.indexOf('STACK_OWNED="yes"') > shExec.indexOf('BOOTSTRAP_RESULT="PASS"'),
    "STACK_OWNED solo puede fijarse tras un bootstrap exitoso",
  );
}
{
  // Comportamiento: stop fallido + removeRuntime => NO se borra nada.
  const removed = [];
  const io = {
    existsSync: () => true,
    rmSync: (p) => removed.push(p),
    readFileSync: () => 'project_id = "tc_recovery_v2"\n',
  };
  const failing = stopLocalStack(
    { runtimeDir: "tools/local-db/.runtime-recovery", projectId: "tc_recovery_v2", removeRuntime: true },
    { io, run: () => ({ code: 1, stdout: "", stderr: "boom" }) },
  );
  assert.equal(failing.stopped, false);
  assert.equal(failing.runtimeDeleted, false, "runtime borrado pese a un stop FALLIDO");
  assert.equal(failing.runtimePreserved, true);
  assert.equal(removed.length, 0, "no puede haber ningun rmSync tras un stop fallido");

  const okStop = stopLocalStack(
    { runtimeDir: "tools/local-db/.runtime-recovery", projectId: "tc_recovery_v2", removeRuntime: true },
    { io, run: () => ({ code: 0, stdout: "", stderr: "" }) },
  );
  assert.equal(okStop.runtimeDeleted, true, "tras un stop exitoso SI se borra el runtime");

  // Y nunca se detiene un stack ajeno: el config.toml debe acreditar el proyecto.
  assert.throws(() => stopLocalStack(
    { runtimeDir: "tools/local-db/.runtime-recovery", projectId: "tc_recovery_v2" },
    { io: { ...io, readFileSync: () => 'project_id = "otro_proyecto"\n' }, run: () => ({ code: 0 }) },
  ), BootstrapError, "no puede detenerse un stack cuyo workdir declara otro project_id");
  assert.equal(parseProjectIdFromToml('project_id = "tc_recovery_v2"'), "tc_recovery_v2");
}
console.log("PASS\truntime_deleted_only_after_successful_stop");

// ===========================================================================
// 11) MUTACIÓN: dump fuera de allowlist / guarda vacua sobre la TOC
// ===========================================================================
{
  const allowed = parseAllowedTables(order);
  assert.ok(allowed.includes("perfiles") && allowed.length === 22,
    `la allowlist de tablas sale de recovery-data-order.txt (22 esperadas, ${allowed.length})`);

  const good = parseRestoreToc([
    "; Selected TOC Entries:",
    "246; 0 16456 TABLE DATA public perfiles postgres",
    "247; 0 16460 TABLE DATA public tickets postgres",
    "3000; 0 0 SEQUENCE SET public ticket_folios_seq postgres",
  ].join("\n"));
  assert.equal(adjudicateToc(good, { allowedTables: allowed }).ok, true,
    "una TOC data-only limpia debe pasar");

  const mutations = [
    ["esquema de plataforma", "500; 0 17000 TABLE DATA realtime subscription postgres", "SCHEMA_NOT_ALLOWED"],
    ["objeto no data-only", "501; 0 17001 FUNCTION public f() postgres", "TYPE_NOT_ALLOWED"],
    ["tabla efimera excluida", "502; 0 17002 TABLE DATA public edge_idempotency postgres", "TABLE_EXCLUDED_BY_FILTERS"],
    ["tabla no declarada", "503; 0 17003 TABLE DATA public tabla_fantasma postgres", "TABLE_NOT_IN_ALLOWLIST"],
  ];
  for (const [label, line, reason] of mutations) {
    const v = adjudicateToc(parseRestoreToc(line), { allowedTables: allowed });
    assert.equal(v.ok, false, `la adjudicacion debe rechazar: ${label}`);
    assert.ok(v.violations.some((x) => x.reason === reason), `motivo esperado ${reason} (${label})`);
  }
  // Guarda anti-vacuidad: una TOC sin datos NO puede "pasar" por defecto.
  assert.equal(adjudicateToc([], { allowedTables: allowed }).ok, false,
    "una TOC sin entradas de datos no puede aprobarse");

  // El escaneo de CONTENIDO detecta lo que la TOC no ve.
  const contentMutations = [
    "SET log_min_messages TO 'fatal';",
    "GRANT SELECT ON public.tickets TO anon;",
    "ALTER TABLE public.tickets OWNER TO supabase_admin;",
    "ALTER TABLE public.tickets DISABLE TRIGGER ALL;",
    "CREATE EXTENSION IF NOT EXISTS pgsodium;",
    "COPY auth.users (id, email) FROM stdin;",
    "COPY public.edge_idempotency (id) FROM stdin;",
  ];
  for (const line of contentMutations) {
    assert.ok(scanContentLine(line), `el escaneo de contenido debe marcar: ${line.slice(0, 40)}`);
  }
  assert.equal(scanContentLine("COPY public.tickets (id, folio) FROM stdin;"), null,
    "un COPY legitimo de la allowlist no puede marcarse");
}
// El script debe INVOCAR la adjudicación y abortar si falla; y ya no puede
// quedar la guarda vacua de grep sobre la TOC.
assert.match(shExec, /dump-allowlist\.mjs[\s\S]{0,200}--toc/, "el script debe adjudicar la TOC del dump");
assert.match(shExec, /dump-allowlist\.mjs --scan-content/, "el script debe escanear el CONTENIDO del dump");
assert.doesNotMatch(shExec, /FORBIDDEN_PATTERN/, "la guarda vacua FORBIDDEN_PATTERN debe estar eliminada");
assert.match(bashIfBlock(shExec, "--order tools/local-db/recovery-data-order.txt"), /abort\s+"DUMP_GUARD"/,
  "un dump fuera de allowlist debe abortar");
for (const forbidden of ["realtime", "vault", "pgsodium", "supabase_functions", "log_min_messages"]) {
  assert.match(read(ALLOWLIST_PATH), new RegExp(forbidden, "i"),
    `el owner de la allowlist debe cubrir el patron prohibido: ${forbidden}`);
}
console.log("PASS\tdump_allowlist_is_positive_and_content_aware");

// ===========================================================================
// 12) MUTACIÓN: ausencia de seed auth / PII real en el seed
// ===========================================================================
{
  const copy = [
    "COPY public.perfiles (id, nombre, email, rol) FROM stdin;",
    "3f2504e0-4f89-11d3-9a0c-0305e82c3301\tJuan Real\tjuan@empresa-real.com\tagente",
    "6ba7b810-9dad-11d1-80b4-00c04fd430c8\tAna Real\tana@empresa-real.com\tadmin",
    "\\.",
  ].join("\n");
  const ids = parsePerfilesIds(copy);
  assert.deepEqual(ids, ["3f2504e0-4f89-11d3-9a0c-0305e82c3301", "6ba7b810-9dad-11d1-80b4-00c04fd430c8"]);

  const seed = renderAuthSeedSql(ids);
  assert.match(seed, /insert into auth\.users/i, "el seed debe poblar auth.users");
  assert.doesNotMatch(seed, /empresa-real\.com|Juan Real|Ana Real/,
    "el seed NO puede arrastrar PII del dump");
  assert.match(seed, /@example\.invalid/, "los correos sinteticos usan el dominio reservado");
  assert.equal(syntheticEmail(ids[0]), syntheticEmail(ids[0]), "el correo sintetico es determinista");
  assert.match(seed, /on conflict \(id\) do nothing/i, "el seed debe ser idempotente");
  assert.equal(assertSyntheticOnly(seed), true);

  assert.throws(() => renderAuthSeedSql([]), /nada que sembrar/,
    "sin perfiles.id el seed debe fallar de forma explicita (fail-closed)");
  assert.throws(() => assertSyntheticOnly("insert into auth.users values ('x','real@gmail.com');"),
    /fuera de example\.invalid/, "un correo real en el seed debe rechazarse");
  assert.throws(
    () => parsePerfilesIds("COPY public.perfiles (id, email) FROM stdin;\nno-es-uuid\tx@y.z\n\\."),
    /no es un UUID/, "un parseo desalineado debe abortar antes de tocar PII");
}
assert.match(shExec, /auth-seed\.mjs --emit-sql/, "el script debe generar el seed sintetico de auth.users");
assert.match(bashIfBlock(shExec, "auth-seed.mjs --emit-sql"), /abort\s+"AUTH_SEED"/,
  "si el seed de auth falla, la corrida debe abortar (antes solo emitia un WARN)");
assert.doesNotMatch(shExec, /seed-auth-users\.sh/,
  "el hook opcional inexistente debe estar sustituido por el owner canonico");
console.log("PASS\tsynthetic_auth_seed_is_mandatory_and_pii_free");

// ===========================================================================
// 13) MUTACIÓN: trigger deshabilitado sin reactivación · FK circular sin recrear
// ===========================================================================
{
  const ri = bashFunction(shExec, "restore_integrity");
  assert.match(ri, /enable trigger user/, "restore_integrity debe reactivar los triggers de usuario");
  assert.match(ri, /add constraint/, "restore_integrity debe recrear las FK circulares");
  assert.match(ri, /INTEGRITY_SUSPENDED}" == "yes"/, "restore_integrity debe ser idempotente");
  assert.match(ri, /INTEGRITY_RESTORE_RESULT="FAIL"/, "un fallo de restitucion debe quedar registrado");

  // La suspensión de integridad se declara ANTES de tocar constraints/triggers.
  const suspendAt = shExec.indexOf('INTEGRITY_SUSPENDED="yes"');
  assert.ok(suspendAt !== -1 && suspendAt < shExec.indexOf("drop constraint"),
    "INTEGRITY_SUSPENDED debe fijarse antes del primer drop constraint");
  assert.ok(suspendAt < shExec.indexOf("disable trigger user"),
    "INTEGRITY_SUSPENDED debe fijarse antes de deshabilitar triggers");

  // La definición original se guarda ANTES de retirarla: sin eso no hay
  // recuperación posible si el proceso muere en medio.
  assert.ok(shExec.indexOf("04j_circular_fk.txt") < shExec.indexOf("drop constraint"),
    "la definicion de las FK circulares debe guardarse antes de retirarlas");
  assert.match(shExec, /CIRCULAR_FK_STRATEGY="DROP_AND_REVALIDATING_RECREATE"/,
    "la estrategia de FK circular debe ser explicita y verificable");
  assert.match(bashIfBlock(shExec, 'CIRCULAR_FK_COUNT}" != "2"'), /\babort\b/,
    "si no hay exactamente 2 FK circulares, el esquema no es el documentado: abortar");

  // DISABLE TRIGGER USER no puede presentarse como mitigación de integridad.
  assert.doesNotMatch(shExec, /disable trigger all/i,
    "DISABLE TRIGGER ALL exige superuser: no es la estrategia elegida");
}
console.log("PASS\ttriggers_and_circular_fk_always_restored");

// ===========================================================================
// 14) MUTACIÓN: tabla sin ownership validado antes de ALTER TABLE
// ===========================================================================
{
  // Se compara el orden de EJECUCION del flujo principal: restore_integrity()
  // esta definida arriba pero sólo corre cuando INTEGRITY_SUSPENDED=yes, que se
  // fija despues de la guarda de ownership (comprobado abajo).
  const mainFlow = shExec.replace(bashFunction(shExec, "restore_integrity"), "");
  const ownershipAt = mainFlow.indexOf('OWNERSHIP_CHECK="PASS"');
  const firstAlter = mainFlow.search(/alter table/i);
  assert.notEqual(ownershipAt, -1, "falta la validacion de ownership");
  assert.ok(ownershipAt < firstAlter,
    "la validacion de ownership debe ocurrir ANTES del primer ALTER TABLE");
  assert.ok(ownershipAt < shExec.indexOf('INTEGRITY_SUSPENDED="yes"'),
    "la integridad no puede suspenderse antes de validar ownership");
  assert.match(bashIfBlock(shExec, '-n "${OWNER_MISMATCH}"'), /abort\s+"OWNERSHIP"/,
    "una tabla ajena debe abortar antes de cualquier ALTER");
  assert.match(fkSql, /TABLE_OWNER_MISMATCH/, "fk-integrity.sql debe reverificar ownership tras el restore");
}
console.log("PASS\townership_validated_before_any_alter");

// ===========================================================================
// 15) Validación POSITIVA post-restore (no basta con pg_restore exit 0)
// ===========================================================================
assert.doesNotMatch(
  fkSql,
  /^\s*(?:create|alter|drop|grant|revoke|update|insert|delete)\b/im,
  "fk-integrity.sql debe ser REPORT_ONLY",
);
for (const probe of ["FK_NOT_VALIDATED", "FK_ORPHANS", "TRIGGER_DISABLED",
  "CIRCULAR_FK_PRESENT", "PERFILES_WITHOUT_AUTH_USER", "AUTH_USERS_NON_SYNTHETIC",
  "FK_INTEGRITY_COMPLETE=YES"]) {
  assert.ok(fkSql.includes(probe), `fk-integrity.sql debe emitir ${probe}`);
  assert.ok(shExec.includes(probe.split("=")[0]), `el script debe evaluar ${probe}`);
}
assert.match(bashIfBlock(shExec, '-n "${INTEGRITY_FINDINGS}"'), /abort\s+"VALIDATION"/,
  "cualquier hallazgo de integridad debe abortar");
console.log("PASS\tpositive_integrity_validation_after_restore");

// ===========================================================================
// 16) Higiene de secretos y de datos (P6.5)
// ===========================================================================
assert.doesNotMatch(shExec, /cat\s+"?\$\{?DUMP_FILE\}?"?/, "el script no debe volcar el dump");
assert.doesNotMatch(shExec, /\bt\.detalle\b/, "no debe tocar bitacora.detalle en claro");
assert.doesNotMatch(shExec, /edge_idempotency\.response/i, "no debe referenciar edge_idempotency.response");
// El SQL del contenido y el COPY de perfiles se consumen por TUBERÍA, jamás a disco.
assert.match(shExec, /docker exec -i "\$\{CID\}" pg_restore --data-only -f -[\s\S]{0,200}\|\s*\n?\s*node tools\/local-db\/lib\/dump-allowlist\.mjs/,
  "el contenido del dump debe escanearse en streaming, sin materializarlo");
assert.match(shExec, /docker exec -i "\$\{CID\}" pg_restore --data-only --table=perfiles -f -[\s\S]{0,200}\|\s*\n?\s*node tools\/local-db\/lib\/auth-seed\.mjs/,
  "el COPY de perfiles (con PII) debe consumirse por tuberia, sin materializarlo");
assert.match(read(ALLOWLIST_PATH), /NUNCA (?:emite|devuelve) la línea/i,
  "el escaneo debe documentar y respetar que no imprime la linea que dispara el hallazgo");
for (const banned of ["supabase link", "db push", "db pull"]) {
  assert.doesNotMatch(shExec, new RegExp(banned, "i"), `operacion remota prohibida: ${banned}`);
}
assert.match(shExec, /inspectEnvForRemote/, "debe reutilizar guards.mjs (no duplicar la guarda anti-remoto)");
assert.match(shExec, /classifyTarget/, "debe reutilizar classifyTarget para --source-db-url");
assert.doesNotMatch(shExec, /git\s+(add|commit|push)\b/, "el script NUNCA hace git add/commit/push");
console.log("PASS\tsecret_and_pii_hygiene");

// ===========================================================================
// 16b) Toolchain alineado con los servidores fuente/destino
// ===========================================================================
{
  const restoreAt = shExec.indexOf('if ! docker exec -i "${CID}" pg_restore');
  const restoreEnd = shExec.indexOf('\n  RESTORE_RESULT="PASS"', restoreAt);
  assert.notEqual(restoreAt, -1, "el restore final debe usar pg_restore del destino");
  assert.notEqual(restoreEnd, -1, "el restore final debe conservar RESTORE_RESULT");
  const restoreFlow = shExec.slice(
    shExec.lastIndexOf('assert_regular_local_file "--dump"', restoreAt),
    restoreEnd,
  );

  assert.match(restoreFlow, /docker exec -i "\$\{CID\}" pg_restore/,
    "el restore final debe usar el cliente compatible del destino");
  assert.doesNotMatch(shExec, /\bdocker cp\b/,
    "el flujo Recovery no usa docker cp");
  assert.doesNotMatch(shExec, /\/tmp\/app\.dump/,
    "no debe quedar lifecycle de /tmp/app.dump");

  for (const flag of [
    "--dbname=postgres",
    "--data-only",
    "--single-transaction",
    "--exit-on-error",
    "--schema=public",
    "--schema=app_private",
  ]) {
    assert.ok(restoreFlow.includes(flag), `restore host sin flag obligatorio: ${flag}`);
  }
  assert.match(
    restoreFlow,
    /assert_regular_local_file "--dump" "\$\{DUMP_FILE\}"/,
    "el dump debe seguir siendo un archivo local regular",
  );
  assert.match(
    restoreFlow,
    /<"\$\{DUMP_FILE\}"/,
    "el dump host debe transmitirse al destino por stdin",
  );
  assert.match(
    restoreFlow,
    /2>&1[\s\\]*<"\$\{DUMP_FILE\}"[\s\\]*\|\s*sanitize_log_stream >"\$\{ARTIFACTS_DIR\}\/04h_restore\.log"/,
    "stdout/stderr del restore deben persistirse redactados",
  );
  assert.match(bashFunction(shExec, "sanitize_log_stream"), /redactSecrets/,
    "el log debe reutilizar el redactor canónico");
  assert.match(bashFunction(shExec, "sanitize_log_stream"), /user\(\?:name\)\?/,
    "el log también debe ocultar el usuario de conexión");
  assert.doesNotMatch(shExec, /(?:echo|printf)[^\n]*\$\{DB_URL\}/,
    "DB_URL nunca puede imprimirse");

  const destinationToolchain = bashFunction(shExec, "assert_destination_toolchain");
  const dumpToolchain = bashFunction(shExec, "read_dump_toolchain_metadata");
  assert.match(destinationToolchain, /DESTINATION_CLIENT_SERVER_MAJOR_MISMATCH/,
    "pg_restore destino debe coincidir con el major del servidor destino");
  assert.match(dumpToolchain, /SOURCE_CLIENT_SERVER_MAJOR_MISMATCH/,
    "pg_dump fuente debe coincidir con el major del servidor fuente");
  assert.match(dumpToolchain, /SOURCE_DESTINATION_MAJOR_MISMATCH/,
    "majors incompatibles deben abortar antes del restore");

  assert.match(restoreFlow, /RESTORE_OK="no"/,
    "un pg_restore no-cero debe registrarse");
  assert.match(
    restoreFlow,
    /RESTORE_OK\}" != "yes"[\s\S]*RESTORE_RESULT="FAIL"[\s\S]*abort "RESTORE"/,
    "un fallo de restore debe abortar",
  );
  const abortFn = bashFunction(shExec, "abort");
  assert.match(abortFn, /SCORABLE="NO"/,
    "un abort de restore no puede producir SCORABLE=YES");
  assert.match(abortFn, /restore_integrity[\s\S]*teardown_stack/,
    "integridad y teardown siguen garantizados tras un fallo");
}
console.log("PASS\tserver_aligned_pg_restore_fail_closed");

// ===========================================================================
// 17) Contrato de salida final (incluye los campos nuevos de P5-P7)
// ===========================================================================
for (const field of [
  "RESULT=", "BASE_HEAD=", "FINAL_HEAD=", "BOOTSTRAP_RESULT=", "DUMP_RESULT=",
  "SECRET_SCAN_RESULT=", "RESTORE_RESULT=", "STRUCTURE_PARITY=", "DATA_PARITY=",
  "RLS_RESTORE_RESULT=", "ACL_RESTORE_RESULT=", "RPO_SECONDS=", "RTO_SECONDS=",
  "DUMP_BYTES=", "DOCKER_USED=", "DOCKER_STOPPED=", "WORKTREE_STATUS=",
  "COMMIT_CREATED=", "PUSH=NO", "DEPLOY=NO", "SUPABASE_REMOTE=NO", "SCORABLE",
  "NEXT_ACTION=", "DUMP_ALLOWLIST_RESULT=", "DUMP_CONTENT_SCAN=",
  "AUTH_SEED_RESULT=", "OWNERSHIP_CHECK=", "CIRCULAR_FK_STRATEGY=",
  "INTEGRITY_RESTORE_RESULT=", "FK_INTEGRITY=", "RUNTIME_DELETED=",
  "RUNTIME_PRESERVED=", "INTERRUPTED=", "STOP_CODE=",
  "SOURCE_SIGNATURE_MODE=", "SOURCE_SIGNATURE_RESULT=", "SOURCE_CUTOFF_EPOCH=",
  "SOURCE_SERVER_MAJOR=", "SOURCE_CLIENT_MAJOR=", "DESTINATION_SERVER_MAJOR=",
  "DESTINATION_CLIENT_MAJOR=", "HOST_PSQL_VERSION=", "HOST_PG_DUMP_VERSION=",
  "HOST_PG_RESTORE_VERSION=",
]) {
  assert.ok(sh.includes(field), `la salida final debe incluir el campo: ${field}`);
}
console.log("PASS\tfinal_output_contract\tfields=44");

// ===========================================================================
// 18) recovery-signature.sql (REPORT_ONLY, 5 dimensiones, sin datos sensibles)
// ===========================================================================
assert.doesNotMatch(
  sql, /^\s*(?:create|alter|drop|truncate|comment|grant|revoke|update|insert|delete)\b/im,
  "recovery-signature.sql debe ser REPORT_ONLY",
);
for (const section of ["STRUCTURE", "FUNCTIONS", "POLICIES", "ACL", "DATA"]) {
  assert.match(sql, new RegExp(`SECTION=${section}`), `falta la seccion ${section}`);
}
assert.match(sql, /security_definer/i, "debe verificar SECURITY DEFINER");
assert.match(sql, /search_path/i, "debe verificar search_path fijado");
assert.doesNotMatch(sql, /\bt\.detalle\b/, "no debe seleccionar bitacora.detalle en claro");
assert.doesNotMatch(sql, /,\s*detalle\s*,/i, "no debe proyectar detalle como columna suelta");
assert.match(sql, /to_jsonb\(t\)\s*-\s*'detalle'/, "debe excluir detalle via to_jsonb(t) - 'detalle'");
assert.doesNotMatch(sql, /from\s+public\.edge_idempotency/i, "edge_idempotency queda fuera de DATA");
console.log("PASS\tsignature_report_only_and_sections");

// 18a) REGRESIÓN: pg_constraint.contype es el tipo interno PostgreSQL "char".
// Su concatenación directa con text es ambigua; el cast debe permanecer
// explícito sin cambiar el contenido ni el orden determinista de la firma.
{
  const constraintStart = sql.indexOf("'CONSTRAINT_INVENTORY'");
  const constraintEnd = sql.indexOf("'INDEX_INVENTORY'", constraintStart);
  assert.notEqual(constraintStart, -1, "falta CONSTRAINT_INVENTORY");
  assert.notEqual(constraintEnd, -1, "no se pudo delimitar CONSTRAINT_INVENTORY");
  const constraintInventory = sql.slice(constraintStart, constraintEnd);

  assert.match(
    constraintInventory,
    /con\.conname\s*\|\|\s*':'\s*\|\|\s*con\.contype::text\s*\|\|\s*':'\s*\|\|\s*pg_get_constraintdef\(con\.oid\)/,
    "constraint_type debe usar con.contype::text antes de concatenar",
  );
  assert.doesNotMatch(
    sql,
    /\|\|\s*con\.contype\s*\|\|/,
    "con.contype no puede concatenarse directamente: el operador text || \"char\" es ambiguo",
  );
  assert.match(
    constraintInventory,
    /string_agg\([\s\S]*'\|'\s+order by con\.conname[\s\S]*group by nsp\.nspname, rel\.relname, con\.contype\s+order by nsp\.nspname, rel\.relname, con\.contype;/,
    "la firma de constraints debe preservar el orden total interno y externo",
  );
  assert.match(
    constraintInventory,
    /where nsp\.nspname in \('public', 'app_private'\)/,
    "CONSTRAINT_INVENTORY debe conservar la allowlist public,app_private",
  );
}
assert.match(
  sql,
  /\\echo 'RECOVERY_SIGNATURE_ALLOWLIST=public,app_private'/,
  "la firma debe declarar exactamente la allowlist public,app_private",
);
assert.equal(
  (sql.match(/RECOVERY_SIGNATURE_ALLOWLIST=/g) || []).length,
  1,
  "debe existir un solo marcador autoritativo de allowlist",
);
assert.match(sql, /\\echo 'SECTION=STRUCTURE'/, "SECTION=STRUCTURE debe preservarse");
assert.match(
  sql,
  /\\echo 'RECOVERY_SIGNATURE_COMPLETE=YES'/,
  "RECOVERY_SIGNATURE_COMPLETE=YES debe preservarse",
);
console.log("PASS\tconstraint_type_cast_and_signature_invariants");

// ===========================================================================
// 19) recovery-data-order.txt y cruce con migraciones reales
// ===========================================================================
const orderLines = order.split("\n").map((l) => l.trim()).filter((l) => /^\d+\s+public\./.test(l));
assert.equal(orderLines.length, 22, `se esperan 22 tablas con datos (encontradas: ${orderLines.length})`);
assert.equal(orderLines[0].match(/public\.(\w+)/)[1], "perfiles",
  "public.perfiles debe ser la primera (FK a auth.users)");
for (const excluded of ["public.rate_limit_events", "public.edge_idempotency",
  "public.support_idempotency", "public.ticket_portal_logs"]) {
  assert.match(order, new RegExp(`EXCLUDED ${excluded.replace(".", "\\.")}`), `falta excluida: ${excluded}`);
}
assert.match(order, /auth\.users/, "auth.users debe documentarse como prerequisito externo");
assert.match(order, /FK circular|circular/i, "la FK circular debe estar documentada");

const migrationFiles = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"))
  .map((f) => `${MIGRATIONS_DIR}/${f}`);
const migrationsCorpus = migrationFiles.map((f) => readFileSync(f, "utf8")).join("\n");
const allOrderTables = [
  ...orderLines.map((l) => l.match(/public\.(\w+)/)[1]),
  "rate_limit_events", "edge_idempotency", "support_idempotency", "ticket_portal_logs",
];
assert.equal(allOrderTables.length, 26, "22 incluidas + 4 excluidas = 26 (ST-03)");
for (const t of allOrderTables) {
  assert.match(migrationsCorpus, new RegExp(`create table\\s+(if not exists\\s+)?public\\.${t}\\b`, "i"),
    `tabla inexistente en migraciones: public.${t}`);
}
assert.equal(migrationFiles.length, 31, `se esperan 31 migraciones (encontradas: ${migrationFiles.length})`);
assert.doesNotMatch(migrationsCorpus, /create table\s+(if not exists\s+)?app_private\./i,
  "app_private ya no esta vacio: actualizar allowlist y runbook");
console.log("PASS\tdata_order_matches_migrations\ttables=26,migrations=31");

// ===========================================================================
// 20) Fuente persistida: combinaciones, archivos y métricas fail-closed
// ===========================================================================
for (const flag of [
  "--dump", "--source-signature-file", "--source-cutoff-epoch", "--source-db-url",
]) {
  assert.ok(shExec.includes(flag), `runner missing flag ${flag}`);
}
assert.match(
  bashIfBlock(shExec, 'if [[ -n "${SOURCE_SIGNATURE_FILE}" ]]; then'),
  /--source-signature-file exige --dump[\s\S]*--source-cutoff-epoch[\s\S]*assert_regular_local_file/,
  "firma persistida exige dump+cutoff y archivos locales",
);
assert.match(
  bashIfBlock(shExec, 'elif [[ -n "${SOURCE_CUTOFF_EPOCH}" ]]; then'),
  /abort\s+"PRECHECK_SCOPE_GUARD"/,
  "cutoff sin firma debe abortar",
);
{
  const localFile = bashFunction(shExec, "assert_regular_local_file");
  assert.match(localFile, /!\s+-L/, "no se puede seguir un symlink de dump/firma");
  assert.match(localFile, /-f/, "dump/firma deben ser archivos regulares");
  assert.match(localFile, /\*:\/\/\*/, "una URL no es un archivo local");
}
assert.match(
  shExec,
  /SOURCE_SIGNATURE_MODE="PERSISTED_SEQUENTIAL"/,
  "dump+firma+cutoff debe activar el candidato secuencial",
);
assert.match(
  shExec,
  /SOURCE_SIGNATURE_MODE="NONE_DUMP_ONLY"/,
  "dump solo debe quedar explícitamente sin fuente",
);
assert.match(
  bashFunction(shExec, "assert_complete_source_signature"),
  /RECOVERY_SIGNATURE_COMPLETE=YES[\s\S]*STRUCTURE FUNCTIONS POLICIES ACL DATA/,
  "la firma source debe estar completa antes de iniciar recovery",
);
assert.match(
  shExec,
  /RPO_SECONDS="\$\(\( DUMP_COMPLETE_EPOCH - SOURCE_CUTOFF_EPOCH \)\)"/,
  "RPO debe medir corte source -> dump completo",
);
assert.match(
  shExec,
  /RTO_SECONDS="\$\(\( T_END - RECOVERY_START_EPOCH \)\)"/,
  "RTO debe medir inicio recovery -> validacion final",
);
assert.match(
  shExec.slice(shExec.indexOf('if [[ "${DOCKER_USED}" == "YES"'), shExec.indexOf('SCORABLE="YES"')),
  /DOCKER_STOPPED[\s\S]*SOURCE_SIGNATURE_RESULT[\s\S]*RPO_SECONDS[\s\S]*RTO_SECONDS/,
  "SCORABLE exige teardown, firma source y métricas numéricas",
);
assert.match(
  bashIfBlock(shExec, '-n "${ACTIVE_SUPABASE_STACKS}"'),
  /abort\s+"PRECHECK_HOST"/,
  "el destino no puede iniciar mientras exista otro stack Supabase",
);
console.log("PASS\tpersisted_source_scorable_contract");

// ===========================================================================
// 21) Orquestador canónico: fuente cerrada antes del destino
// ===========================================================================
assert.match(synthExec, /set -Eeuo pipefail/, "orquestador debe usar bash estricto");
assert.match(synthExec, /EXPECTED_BRANCH="test\/recovery-v2-20260725"/);
assert.match(synthExec, /AUTHORIZED_BASE_HEAD="edb5703eb1d4431cda917591ba40e872f307f986"/);
assert.match(synthExec, /read_source_toolchain/, "orquestador debe verificar el toolchain fuente");
assert.match(synthExec, /SOURCE_CLIENT_SERVER_MAJOR_MISMATCH/,
  "pg_dump fuente debe compartir major con su servidor");
assert.match(synthExec, /assert_no_active_runners/, "debe impedir runners concurrentes");
assert.match(synthExec, /assert_no_supabase_stacks/, "debe exigir exclusividad de stacks");
assert.match(synthExec, /local-auth-users\.mjs/, "debe crear usuarios por Auth Admin API local");
assert.match(
  synthExec,
  /SUPABASE_SERVICE_ROLE_KEY="\$\{LOCAL_SERVICE_ROLE_KEY\}"[\s\S]*node tools\/local-db\/lib\/local-auth-users\.mjs/,
  "service role sólo se entrega por entorno",
);
assert.doesNotMatch(
  synthExec,
  /local-auth-users\.mjs[^\n]*--(?:service|token|key)/,
  "service role nunca puede ir en argumentos visibles",
);
assert.match(synthExec, /SEED_RC=\$\?/, "debe conservar el rc real del seed");
assert.match(synthExec, /SEED_RC.*-ne 0[\s\S]*SOURCE_SEED_NONZERO/, "rc!=0 bloquea");
assert.match(synthExec, /grep -Fxq 'STAGING_SYNTHETIC_SEED=PASS'/, "rc=0 sin marker bloquea");
{
  const sourceStart = synthExec.indexOf('SOURCE_BOOTSTRAP="$(');
  const sourceStop = synthExec.indexOf('stop_source || fail "SOURCE_TEARDOWN_FAILED"');
  const noStacksAfterSource = synthExec.indexOf("assert_no_supabase_stacks", sourceStop);
  const destinationStart = synthExec.indexOf('RECOVERY_RUN_ID="${RUN_ID}" tools/local-db/run-recovery-v2.sh');
  assert.ok(sourceStart >= 0 && sourceStart < sourceStop, "fuente debe iniciar antes de detenerse");
  assert.ok(sourceStop < noStacksAfterSource, "debe verificar teardown fuente");
  assert.ok(noStacksAfterSource < destinationStart, "destino sólo inicia tras cero stacks");
}
assert.match(
  synthExec,
  /--dump "\$\{SOURCE_DUMP\}"[\s\S]*--source-signature-file "\$\{SOURCE_SIGNATURE\}"[\s\S]*--source-cutoff-epoch "\$\{SOURCE_CUTOFF_EPOCH\}"/,
  "destino debe consumir las tres evidencias source persistidas",
);
assert.match(
  synthExec,
  /docker exec "\$\{SOURCE_CID\}" pg_dump -U postgres -d postgres[\s\S]*>"\$\{SOURCE_DUMP\}"/,
  "el dump debe salir del cliente fuente directo al artefacto host",
);
assert.doesNotMatch(synthExec, /\bdocker cp\b/, "el orquestador no usa docker cp");
assert.match(synthExec, /SCORABLE[\s\S]*== "YES"/, "orquestador adjudica SCORABLE=YES");
assert.match(synthExec, /HEAD_CHANGED_DURING_RUNTIME/, "HEAD debe permanecer igual");
assert.match(synthExec, /WORKTREE_CHANGED_DURING_RUNTIME/, "worktree debe permanecer igual");
assert.doesNotMatch(synthExec, /git\s+(?:add|commit|push|reset|clean|stash)\b/,
  "el runtime no modifica Git");
console.log("PASS\tsequential_source_destination_orchestrator");

// ===========================================================================
// 22) MUTACIÓN: runbook desincronizado del código
// No se comprueba "que mencione algo", sino que los VALORES del runbook sean
// los del código y que no queden referencias al diseño anterior.
// ===========================================================================
assert.match(runbook, /IMPLEMENTADO LOCAL/, "el runbook debe declarar IMPLEMENTADO LOCAL");
assert.match(runbook, /NO VALIDADO EN VIVO/, "el runbook debe declarar que NO esta validado en vivo");
assert.match(runbook, /RUN_FROM_MACOS_TERMINAL/, "siguiente paso literal en Terminal macOS");

// 20a. Owner del bootstrap y del teardown.
assert.match(runbook, /bootstrap\.mjs/, "el runbook debe nombrar al owner unico del bootstrap");
assert.match(runbook, /bootstrap\.mjs --stop/, "el runbook debe documentar el teardown delegado");
assert.doesNotMatch(runbook, /PASO 1:.*supabase start/,
  "referencia obsoleta al bootstrap inline (supabase start dentro del script)");

// 20b. Identidad del clon: los valores deben ser los del código.
assert.match(runbook, /tc_recovery_v2/, "el runbook debe declarar el project_id real");
assert.match(runbook, /\b54339\b/, "el runbook debe declarar el puerto DB por defecto real");
for (const line of runbook.split("\n")) {
  if (line.includes("54329")) {
    assert.match(line, /harness/i,
      "54329 solo puede aparecer identificado como el puerto del harness, nunca como el de recovery");
  }
}

// 20c. Los campos que habilitan SCORABLE=YES en el código deben estar en el runbook.
{
  const scorableBlock = shExec.slice(shExec.indexOf('if [[ "${DOCKER_USED}" == "YES"'),
    shExec.indexOf('SCORABLE="YES"'));
  const fields = [...scorableBlock.matchAll(/\$\{(\w+)\}/g)].map((m) => m[1]);
  assert.ok(fields.length >= 14, `el gate de SCORABLE debe cubrir >=14 campos (${fields.length})`);
  for (const f of new Set(fields)) {
    assert.ok(runbook.includes(f), `el runbook no documenta el campo que habilita SCORABLE: ${f}`);
  }
}

// 20d. Temas exigidos por P8, con el valor exacto del código.
for (const [topic, needle] of [
  ["gate de ejecución Docker", "--dry-run"],
  ["paridades bloqueantes", "STRUCTURE"],
  ["paridades informativas", "LEDGER_PARITY"],
  ["teardown", "STOP_ATTEMPTED"],
  ["seed sintético", "example.invalid"],
  ["FK circular", "DROP_AND_REVALIDATING_RECREATE"],
  ["artefactos", "04k_fk_integrity.txt"],
  ["qué se preserva si el stop falla", "10_teardown_preserved.txt"],
  ["códigos de parada", "E_INTERRUPTED_INT"],
  ["ledger fail-closed", "31"],
]) {
  assert.ok(runbook.includes(needle), `el runbook debe documentar ${topic} (falta: ${needle})`);
}
// Y esos mismos valores deben existir en el código: si el runbook los inventa,
// esta aserción falla en el lado del código.
for (const needle of ["DROP_AND_REVALIDATING_RECREATE", "10_teardown_preserved.txt",
  "04k_fk_integrity.txt", "E_INTERRUPTED_", "STOP_ATTEMPTED"]) {
  assert.ok(shExec.includes(needle), `el runbook documenta algo que el codigo no hace: ${needle}`);
}
assert.ok(read(AUTHSEED_PATH).includes("example.invalid"),
  "el runbook documenta example.invalid: debe ser real en auth-seed.mjs");
console.log("PASS\trunbook_in_sync_with_code");

console.log("RECOVERY_V2_CONTRACT=PASS");
