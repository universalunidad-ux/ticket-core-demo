import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// TC-U15D-ASSIGNMENT-RUNTIME-01
// Contrato ESTÁTICO (sin Docker/Supabase local) para la suite de validación
// runtime de public.manage_ticket_assignment. Verifica que los artefactos
// creados por esta unidad:
//   - existen y tienen la forma esperada (fases, helpers, escenarios);
//   - NO modifican la RPC ni las migraciones existentes;
//   - NO conectan public.reglas_asignacion (motor automático NOT_CONNECTED);
//   - NO tocan U15C ni app/ (frontend);
//   - el harness shell es fail-closed (mismo patrón que
//     tools/local-db/run-local-db-harness.sh).

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(ROOT, path), "utf8");

// Quita comentarios de línea SQL (--...) y de shell (#...) para que las
// aserciones de "no debe referenciar X" no disparen sobre comentarios que
// EXPLICAN la restricción (p.ej. "no conecta reglas_asignacion").
const stripSqlComments = (src) =>
  src
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
const stripShellComments = (src) =>
  src
    .split("\n")
    .map((line) => (/^\s*#/.test(line) ? "" : line))
    .join("\n");

const runtimeSql = read("supabase/tests/u15d_assignment_runtime.sql");
const concurrencySql = read("supabase/tests/u15d_assignment_concurrency.sql");
const runnerSh = read("tools/local-db/run-u15d-runtime.sh");
const rpcMigration = read(
  "supabase/migrations/20260715023827_functions_triggers_and_indexes.sql",
);

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// 0) La RPC real no fue tocada: la firma y el gate de autorización siguen
//    presentes tal cual, y esta unidad no la redefine en ningún artefacto.
// ---------------------------------------------------------------------------
test("la RPC real conserva su firma y su gate admin/service_role", () => {
  assert.match(
    rpcMigration,
    /create function public\.manage_ticket_assignment\(\s*p_ticket_id uuid,\s*p_assigned_to uuid,\s*p_idempotency_key text,\s*p_request_hash text,\s*p_expected_fecha_actualizacion timestamptz\s*\)/,
  );
  assert.match(
    rpcMigration,
    /if request_role <> 'service_role'[\s\S]*?not app_private\.has_role\(array\['admin'\]\)/,
  );
  assert.match(rpcMigration, /raise exception 'admin_or_edge_required'/);
});

test("ningún artefacto nuevo redefine manage_ticket_assignment", () => {
  for (const [name, src] of [
    ["runtime.sql", runtimeSql],
    ["concurrency.sql", concurrencySql],
  ]) {
    assert.doesNotMatch(
      src,
      /create\s+(or\s+replace\s+)?function\s+public\.manage_ticket_assignment/i,
      `${name} no debe redefinir la RPC`,
    );
    assert.doesNotMatch(
      src,
      /alter\s+function\s+public\.manage_ticket_assignment/i,
      `${name} no debe alterar la RPC`,
    );
  }
});

test("no se modificaron migraciones ni funciones existentes (git status limpio)", () => {
  let status;
  try {
    status = execFileSync("git", ["status", "--porcelain=v1"], {
      cwd: ROOT,
      encoding: "utf8",
      env: process.env,
    });
  } catch {
    // Algunos entornos de ejecución (p.ej. worktrees con gitdir absoluto que
    // no resuelve en el sandbox actual) no exponen `git status` de forma
    // directa. No se puede verificar aquí; no se falla el contrato estático
    // por eso, pero tampoco se declara "verificado".
    console.warn(
      "WARN: git no disponible en este entorno; omitiendo verificación de git status",
    );
    return;
  }
  const lines = status.split("\n").filter(Boolean);
  const protectedPrefixes = [
    "supabase/migrations/",
    "supabase/functions/",
    "app/",
  ];
  const offenders = lines.filter((line) => {
    const filePath = line.slice(3);
    const statusCode = line.slice(0, 2);
    if (statusCode.trim() === "??") return false; // no seguimos untracked ajenos aquí
    return protectedPrefixes.some((prefix) => filePath.startsWith(prefix));
  });
  assert.deepEqual(
    offenders,
    [],
    `no debe haber cambios en rutas protegidas: ${JSON.stringify(offenders)}`,
  );
});

test("no conecta reglas_asignacion (motor NOT_CONNECTED permanece así)", () => {
  for (const [name, src, strip] of [
    ["runtime.sql", runtimeSql, stripSqlComments],
    ["concurrency.sql", concurrencySql, stripSqlComments],
    ["run-u15d-runtime.sh", runnerSh, stripShellComments],
  ]) {
    assert.doesNotMatch(
      strip(src),
      /reglas_asignacion/i,
      `${name} no debe referenciar reglas_asignacion fuera de comentarios`,
    );
  }
});

test("no toca U15C (consolidación) ni frontend (app/)", () => {
  for (const [name, src, strip] of [
    ["runtime.sql", runtimeSql, stripSqlComments],
    ["concurrency.sql", concurrencySql, stripSqlComments],
    ["run-u15d-runtime.sh", runnerSh, stripShellComments],
  ]) {
    const clean = strip(src);
    assert.doesNotMatch(clean, /tc_consolidar_cliente_ticket/i, `${name}: U15C`);
    assert.doesNotMatch(clean, /consolidacion_version/i, `${name}: U15C`);
    assert.doesNotMatch(clean, /(^|[^a-z_])app\//, `${name}: frontend`);
  }
});

// ---------------------------------------------------------------------------
// 1) supabase/tests/u15d_assignment_runtime.sql — forma y cobertura de casos
// ---------------------------------------------------------------------------
test("runtime.sql es ephemeral (begin ... rollback) y fail-closed", () => {
  assert.match(runtimeSql, /^\\set ON_ERROR_STOP on/m);
  assert.match(runtimeSql, /^begin;/m);
  assert.match(runtimeSql, /^rollback; -- no persistir fixtures/m);
});

test("runtime.sql reutiliza el patrón de sesión de authz_negative.sql", () => {
  for (const helper of ["pg_temp.act(", "pg_temp.act_anon(", "pg_temp.reset_su("]) {
    assert.ok(
      runtimeSql.includes(helper),
      `falta helper de sesión ${helper}`,
    );
  }
});

const runtimeScenarios = [
  ["asignación inicial", /PASS: asignación inicial/],
  ["reasignación", /PASS: reasignación \(A -> B\)/],
  ["desasignación", /PASS: desasignación \(asignado_a = null\)/],
  ["replay idempotente", /PASS: replay idempotente no duplica/],
  ["misma key, payload distinto", /TC_IDEMPOTENCY_KEY_REUSED/],
  ["expected fecha_actualizacion obsoleta", /TC_ASSIGNMENT_VERSION_CONFLICT/],
  ["admin autorizado", /asignación inicial \(admin\)/],
  ["supervisor no autorizado", /PASS: supervisor no autorizado/],
  ["soporte no autorizado", /PASS: soporte no autorizado/],
  ["anon sin privilegio", /PASS: anon sin privilegio/],
  ["usuario sin perfil", /PASS: usuario autenticado sin perfil/],
  ["auditoría exactamente una vez", /auditoría exactamente una vez/],
  ["ticket_eventos verificado", /ticket_eventos\s*\n?\s*where ticket_id/],
  ["lectura posterior consistente", /PASS: lectura posterior consistente/],
  ["escalada de rol bloqueada", /PASS: escalada de rol bloqueada/],
  ["rollback sin filas parciales", /PASS \(paso 2\/2\): rollback sin filas parciales/],
];
for (const [label, pattern] of runtimeScenarios) {
  test(`runtime.sql cubre: ${label}`, () => {
    assert.match(runtimeSql, pattern, `no se encontró evidencia de "${label}"`);
  });
}

test("runtime.sql usa hashes de idempotencia válidos (64 hex) sin pgcrypto", () => {
  assert.match(runtimeSql, /pg_temp\.fake_hash/);
  assert.match(runtimeSql, /md5\(label\) \|\| md5\(label \|\| ':u15d'\)/);
});

// ---------------------------------------------------------------------------
// 2) supabase/tests/u15d_assignment_concurrency.sql — fases y mecánica real
// ---------------------------------------------------------------------------
test("concurrency.sql define las 4 fases requeridas", () => {
  for (const phase of ["setup", "race", "verify", "teardown"]) {
    assert.match(
      concurrencySql,
      new RegExp(`:'phase' = '${phase}' as phase_${phase}`),
      `falta booleano phase_${phase}`,
    );
    assert.match(
      concurrencySql,
      new RegExp(`\\\\if :phase_${phase}`),
      `falta dispatch booleano de ${phase}`,
    );
  }
  assert.match(concurrencySql, /\\gset/);
  assert.match(concurrencySql, /:'phase' in \('setup', 'race', 'verify', 'teardown'\) as phase_valid/);
});

test("concurrency.sql exige phase y valida side en la fase race", () => {
  assert.match(concurrencySql, /\\if :\{\?phase\}/);
  assert.match(concurrencySql, /\\if :\{\?side\}/);
  assert.match(concurrencySql, /:'side' = 'a' as side_a/);
  assert.match(concurrencySql, /:'side' = 'b' as side_b/);
  assert.match(concurrencySql, /\\if :side_a/);
  assert.match(concurrencySql, /\\elif :side_b/);

  const raceStart = concurrencySql.indexOf("\\if :phase_race");
  const verifyStart = concurrencySql.indexOf("\\if :phase_verify");
  const sideValidation = concurrencySql.indexOf("\\if :{?side}");
  assert.ok(raceStart < sideValidation && sideValidation < verifyStart);
});

test("concurrency.sql no intenta evaluar comparaciones SQL dentro de \\if", () => {
  const ifLines = stripSqlComments(concurrencySql)
    .split("\n")
    .filter((line) => /^\s*\\(?:if|elif)\b/.test(line));
  for (const line of ifLines) {
    assert.doesNotMatch(
      line,
      /(?:=|<>|!=|<=|>=|\s+in\s+)/i,
      `comparación inválida dentro de psql ${line.trim()}`,
    );
  }
});

test("concurrency.sql serializa con FOR UPDATE y detecta versión obsoleta", () => {
  assert.match(concurrencySql, /for update;/);
  assert.match(concurrencySql, /shared_expected/);
});

test("concurrency.sql documenta por qué persiste (no rollback) y limpia en teardown", () => {
  assert.match(concurrencySql, /ESTE archivo NO/);
  assert.match(concurrencySql, /begin;\s*\.\.\.\s*rollback;/);
  assert.match(concurrencySql, /delete from public\.tickets where id = 'd15dc222/);
  assert.match(concurrencySql, /delete from public\.perfiles where id in/);
  assert.match(concurrencySql, /delete from auth\.users where id in/);
});

test("concurrency.sql documenta la sustitución supervisor -> admin autorizado", () => {
  assert.match(concurrencySql, /supervisor.*NO está autorizado a invocar manage_ticket_assignment/s);
});

test("concurrency.sql verifica auditoría exactamente una vez y ganador único", () => {
  assert.match(concurrencySql, /PASS: dos actores admin concurrentes/);
  assert.match(concurrencySql, /esperaba exactamente 1 ticket_eventos/);
  assert.match(concurrencySql, /esperaba exactamente 1 bitacora/);
});

// ---------------------------------------------------------------------------
// 3) tools/local-db/run-u15d-runtime.sh — harness fail-closed
// ---------------------------------------------------------------------------
test("run-u15d-runtime.sh es fail-closed (bash estricto + prechecks)", () => {
  assert.match(runnerSh, /^set -Eeuo pipefail$/m);
  assert.match(runnerSh, /uname -s.*Darwin/);
  assert.match(runnerSh, /docker info/);
  assert.match(runnerSh, /command -v supabase/);
  assert.match(runnerSh, /command -v psql/);
});

test("run-u15d-runtime.sh rechaza destinos remotos y proyectos ligados", () => {
  assert.match(runnerSh, /SUPABASE_ACCESS_TOKEN/);
  assert.match(runnerSh, /SUPABASE_PROJECT_REF/);
  assert.match(runnerSh, /E_REMOTE_ENV_PRESENT/);
  assert.match(runnerSh, /supabase\.co\*\|\*supabase\.com\*/);
});

test("run-u15d-runtime.sh nunca hace push/deploy y detiene supabase al final", () => {
  assert.match(runnerSh, /DO_NOT_RUN=push \| PR \| merge \| deploy \| supabase remoto \| psql remoto/);
  assert.doesNotMatch(runnerSh, /\bgit push\b/);
  assert.doesNotMatch(runnerSh, /\bgit commit\b/);
  assert.match(runnerSh, /supabase stop/);
  assert.match(runnerSh, /trap 'handle_exit \$\?' EXIT/);
});

test("run-u15d-runtime.sh soporta --dry-run y --keep-up sin tocar Docker en dry-run", () => {
  assert.match(runnerSh, /--dry-run/);
  assert.match(runnerSh, /--keep-up/);
  const dryRunBlock = runnerSh.slice(
    0,
    runnerSh.indexOf("mkdir -p \"${ARTIFACT_DIR}\""),
  );
  assert.match(dryRunBlock, /DRY_RUN.*-eq 1/);
});

test("run-u15d-runtime.sh ejecuta ambas suites y produce 00_FINAL_RESULT.txt", () => {
  assert.match(runnerSh, /u15d_assignment_runtime\.sql/);
  assert.match(runnerSh, /u15d_assignment_concurrency\.sql/);
  assert.match(runnerSh, /00_FINAL_RESULT\.txt/);
  for (const field of [
    "RESULT",
    "ASSIGN_RESULT",
    "REASSIGN_RESULT",
    "UNASSIGN_RESULT",
    "IDEMPOTENCY_RESULT",
    "CONCURRENCY_RESULT",
    "AUDIT_EXACTLY_ONCE",
    "RLS_RESULT",
    "ROLE_ESCALATION_RESULT",
    "DOCKER_USED",
  ]) {
    assert.ok(
      runnerSh.includes(`${field}=`),
      `falta campo de reporte ${field}`,
    );
  }
});

test("runner usa rutas absolutas y sólo borra runtime después de stop exitoso", () => {
  assert.match(
    runnerSh,
    /ARTIFACT_DIR="\$\{REPO_ROOT\}\/tools\/local-db\/\.artifacts\/u15d-\$\{TS\}"/,
  );
  assert.match(
    runnerSh,
    /RUNTIME_DIR="\$\{REPO_ROOT\}\/tools\/local-db\/\.runtime-u15d"/,
  );
  assert.match(
    runnerSh,
    /remove_runtime_after_stop\(\)[\s\S]*?DOCKER_STOPPED\}" == "YES"[\s\S]*?rm -rf "\$\{RUNTIME_DIR\}"/,
  );
  assert.match(runnerSh, /E_RUNTIME_ALREADY_EXISTS/);
  assert.equal(
    (stripShellComments(runnerSh).match(/rm -rf "\$\{RUNTIME_DIR\}"/g) || [])
      .length,
    1,
    "el único borrado de runtime debe vivir detrás del stop exitoso",
  );
  const finishBody = runnerSh.slice(
    runnerSh.indexOf("finish() {"),
    runnerSh.indexOf("handle_error() {"),
  );
  const stopIndex = finishBody.indexOf("stop_supabase");
  const deleteIndex = finishBody.indexOf("remove_runtime_after_stop");
  const reportIndex = finishBody.indexOf("write_final_report");
  assert.ok(
    stopIndex >= 0 && stopIndex < deleteIndex && deleteIndex < reportIndex,
    "el orden definitivo debe ser stop -> delete -> report",
  );
});

test("stop es idempotente, máximo una vez y su fallo no se silencia", () => {
  assert.match(runnerSh, /PROJECT_ID="tc-u15d-runtime-\$\(date -u/);
  assert.match(runnerSh, /project_id = "\$\{PROJECT_ID\}"/);
  assert.match(runnerSh, /STOP_ATTEMPTED=0/);
  assert.match(
    runnerSh,
    /if \[\[ "\$\{STOP_ATTEMPTED\}" -eq 1 \]\]; then[\s\S]*?return/,
  );
  assert.equal(
    (stripShellComments(runnerSh).match(/\bsupabase stop\b/g) || []).length,
    1,
    "debe existir una sola invocación real de supabase stop",
  );
  assert.doesNotMatch(runnerSh, /supabase stop[^\n]*(?:\|\|\s*true|\|\|\s*:)/);
  assert.match(runnerSh, /E_SUPABASE_STOP_FAILED/);
});

test("reporte definitivo ocurre después de stop y nunca conserva pending-trap", () => {
  assert.doesNotMatch(runnerSh, /pending-trap/);
  assert.match(runnerSh, /DOCKER_STOPPED=\$\{DOCKER_STOPPED\}/);
  assert.match(
    runnerSh,
    /if ! stop_supabase[\s\S]*?write_final_report "\$\{result\}"/,
  );
  assert.doesNotMatch(
    runnerSh.slice(runnerSh.indexOf("STACK_OWNED=1")),
    /write_final_report[\s\S]*?stop_supabase/,
  );
});

test("INT, TERM y ERR fuerzan cierre FAIL del stack propio", () => {
  assert.match(runnerSh, /trap 'handle_error \$\? \$\{LINENO\}' ERR/);
  assert.match(runnerSh, /trap 'handle_signal INT 130' INT/);
  assert.match(runnerSh, /trap 'handle_signal TERM 143' TERM/);
  assert.match(
    runnerSh,
    /if \[\[ "\$\{result\}" != "PASS" \]\]; then\s*force_stop=1/,
  );
  assert.match(runnerSh, /handle_signal\(\)[\s\S]*?finish "FAIL"/);
});

test("runtime-pass-count tolera el prefijo psql y PASS exige marcadores", () => {
  assert.match(
    runnerSh,
    /grep -Ec 'NOTICE:\[\[:space:\]\]\+PASS' "\$\{RUNTIME_LOG\}"/,
  );
  assert.doesNotMatch(runnerSh, /grep\s+-[^\n]*'\^NOTICE/);
  assert.match(runnerSh, /RUNTIME_PASS_COUNT\}" -lt 14/);
  for (const marker of [
    "PASS: asignación inicial",
    "PASS: reasignación",
    "PASS: desasignación",
    "PASS: replay idempotente",
    "PASS: escalada de rol bloqueada",
  ]) {
    assert.ok(runnerSh.includes(marker), `falta marcador runtime: ${marker}`);
  }
  assert.match(runnerSh, /E_U15D_RUNTIME_MARKERS_MISSING/);
});

test("setup, dos carreras, verify y teardown exigen artefactos propios", () => {
  for (const artifact of [
    "concurrency-setup.out",
    "race-a.out",
    "race-b.out",
    "race-exit-codes.txt",
    "concurrency-verify.out",
    "concurrency-teardown.out",
  ]) {
    assert.ok(runnerSh.includes(artifact), `falta artefacto ${artifact}`);
  }
  for (const code of [
    "E_U15D_SETUP_ARTIFACT_MISSING",
    "E_U15D_RACE_A_ARTIFACT_MISSING",
    "E_U15D_RACE_B_ARTIFACT_MISSING",
    "E_U15D_VERIFY_ARTIFACT_MISSING",
    "E_U15D_TEARDOWN_ARTIFACT_MISSING",
  ]) {
    assert.ok(runnerSh.includes(code), `falta código específico ${code}`);
  }
});

test("teardown se ejecuta siempre después del bloque de carrera", () => {
  const setupInvocation = runnerSh.indexOf("-v phase=setup");
  const raceInvocation = runnerSh.indexOf("-v phase=race");
  const verifyInvocation = runnerSh.indexOf("-v phase=verify");
  const teardownInvocation = runnerSh.indexOf("-v phase=teardown");
  assert.ok(
    setupInvocation < raceInvocation &&
      raceInvocation < verifyInvocation &&
      verifyInvocation < teardownInvocation,
  );
  assert.match(runnerSh, /TEARDOWN_RESULT="PASS"/);
  assert.match(runnerSh, /grep -q 'TEARDOWN_OK'/);
});

test("éxito exige dos resultados de carrera y un ganador único", () => {
  assert.match(runnerSh, /race_a_exit=%s\\nrace_b_exit=%s/);
  assert.match(runnerSh, /grep -Ec '\^race_\[ab\]_exit=\[0-9\]\+\$'/);
  assert.match(runnerSh, /RACE_SUCCESS_COUNT\}" -ne 1/);
  assert.match(runnerSh, /RACE_A_RESULT\}" != "PASS"/);
  assert.match(runnerSh, /RACE_B_RESULT\}" != "PASS"/);
  assert.match(runnerSh, /E_U15D_UNIQUE_WINNER_MISSING/);
});

test("éxito exactly-once exige verify real y su marcador de auditoría", () => {
  assert.match(runnerSh, /VERIFY_RC\}" -eq 0/);
  assert.match(runnerSh, /PASS: dos actores admin concurrentes/);
  assert.match(runnerSh, /E_U15D_AUDIT_MARKER_MISSING/);
  assert.match(
    runnerSh,
    /VERIFY_RESULT\}" == "PASS"[\s\S]*?TEARDOWN_RESULT\}" == "PASS"[\s\S]*?AUDIT_EXACTLY_ONCE="PASS"/,
  );
});

// ---------------------------------------------------------------------------
// 4) Documentación de evidencia presente
// ---------------------------------------------------------------------------
test("docs/operations/U15D_RUNTIME_EVIDENCE.md existe", () => {
  assert.ok(existsSync(join(ROOT, "docs/operations/U15D_RUNTIME_EVIDENCE.md")));
});

console.log(`U15D_ASSIGNMENT_RUNTIME_CONTRACT_TESTS=PASS (${passed})`);
