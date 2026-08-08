// TC-LOCAL-DB-RLS-HARNESS-01
// Pruebas del propio harness: lógica fail-closed de guards.mjs.
// Ejecutable sin Docker/Supabase:  node --test test/local-db/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STOP, EXIT_CODES, REPORT_FIELDS, PHASE,
  isLocalHost, extractHost, classifyTarget, inspectEnvForRemote,
  isWriteAllowed, checkScope, normalizeRepoPath,
  checkNodeMajor, checkMacOS, buildReport, renderReportText, defaultRecovery,
} from "../../tools/local-db/lib/guards.mjs";

test("isLocalHost acepta solo loopback/local", () => {
  for (const h of ["127.0.0.1", "localhost", "::1", "[::1]", "0.0.0.0", "host.docker.internal", "127.0.0.5"]) {
    assert.equal(isLocalHost(h), true, `debe ser local: ${h}`);
  }
  for (const h of ["db.supabase.co", "10.0.0.5", "example.com", "", null, "192.168.1.10"]) {
    assert.equal(isLocalHost(h), false, `NO debe ser local: ${h}`);
  }
});

test("extractHost soporta URL y DSN", () => {
  const localUrl = [
    "postgresql://postgres:",
    "pw@127.0.0.1:54322/postgres",
  ].join("");
  const remoteUrl = [
    "postgres://u:",
    "p@db.abcd.supabase.co:5432/postgres",
  ].join("");
  assert.equal(extractHost(localUrl), "127.0.0.1");
  assert.equal(extractHost(remoteUrl), "db.abcd.supabase.co");
  assert.equal(extractHost("host=127.0.0.1 port=54322 dbname=postgres"), "127.0.0.1");
  assert.equal(extractHost("hostaddr=10.0.0.1 dbname=x"), "10.0.0.1");
  assert.equal(extractHost("garbage-without-host"), null);
});

test("classifyTarget es fail-closed", () => {
  assert.equal(classifyTarget(["postgresql://postgres:", "pw@127.0.0.1:54322/postgres"].join("")).classification, "LOCAL");
  assert.equal(classifyTarget("host=localhost port=54322").classification, "LOCAL");
  // remotos explícitos
  assert.equal(classifyTarget(["postgres://u:", "p@db.x.supabase.co:5432/postgres"].join("")).classification, "REMOTE");
  assert.equal(classifyTarget(["postgres://u:", "p@aws-0-us-east-1.pooler.supabase.com:6543/postgres"].join("")).classification, "REMOTE");
  assert.equal(classifyTarget(["postgres://u:", "p@10.0.0.9:5432/db"].join("")).classification, "REMOTE");
  // vacío / indeterminado => REMOTO (denegar)
  assert.equal(classifyTarget("").classification, "REMOTE");
  assert.equal(classifyTarget(undefined).classification, "REMOTE");
  assert.equal(classifyTarget("no-host-here").classification, "REMOTE");
});

test("inspectEnvForRemote bloquea env remota, token y project ref", () => {
  assert.equal(inspectEnvForRemote({}).length, 0);
  assert.equal(inspectEnvForRemote({ DATABASE_URL: ["postgres://u:", "p@127.0.0.1:54322/postgres"].join("") }).length, 0);

  const f1 = inspectEnvForRemote({ DATABASE_URL: ["postgres://u:", "p@db.x.supabase.co:5432/postgres"].join("") });
  assert.equal(f1[0].code, STOP.E_REMOTE_ENV_PRESENT);

  const f2 = inspectEnvForRemote({ PGHOST: "db.x.supabase.co" });
  assert.equal(f2[0].code, STOP.E_REMOTE_ENV_PRESENT);

  const f3 = inspectEnvForRemote({ SUPABASE_ACCESS_TOKEN: "sbp_xxx" });
  assert.equal(f3[0].code, STOP.E_SUPABASE_LINKED_PROJECT);

  const f4 = inspectEnvForRemote({ SUPABASE_PROJECT_REF: "abcd" });
  assert.equal(f4[0].code, STOP.E_SUPABASE_LINKED_PROJECT);
});

test("isWriteAllowed: solo tools/local-db y test/local-db", () => {
  assert.equal(isWriteAllowed("tools/local-db/harness.mjs").allowed, true);
  assert.equal(isWriteAllowed("test/local-db/guards.test.mjs").allowed, true);
});

test("isWriteAllowed: rutas protegidas SIEMPRE denegadas", () => {
  for (const p of [
    "supabase/migrations/20260717093000_authz_functions.sql",
    "supabase/functions/estado-ticket-ts/index.ts",
    "app/main.tsx",
    "tools/run-contract-tests.mjs",
    "tools/canonical-source.json",
    ".github/workflows/frontend-gates.yml",
    "tools/local-db/../run-contract-tests.mjs",
    "tools/other-file.mjs",
    "",
  ]) {
    const r = isWriteAllowed(p);
    assert.equal(r.allowed, false, `debe denegar: ${p}`);
    assert.equal(r.code, STOP.E_SCOPE_VIOLATION);
  }
});

test("checkScope reporta violaciones", () => {
  const ok = checkScope(["tools/local-db/a.mjs", "test/local-db/b.test.mjs"]);
  assert.equal(ok.ok, true);
  const bad = checkScope(["tools/local-db/a.mjs", "supabase/migrations/x.sql"]);
  assert.equal(bad.ok, false);
  assert.equal(bad.violations[0].path, "supabase/migrations/x.sql");
});

test("normalizeRepoPath limpia prefijos", () => {
  assert.equal(normalizeRepoPath("./tools/local-db/x"), "tools/local-db/x");
  assert.equal(normalizeRepoPath("/tools/local-db/x"), "tools/local-db/x");
});

test("checkNodeMajor exige >=22", () => {
  assert.equal(checkNodeMajor("v22.22.3").ok, true);
  assert.equal(checkNodeMajor("v24.0.0").ok, true);
  assert.equal(checkNodeMajor("v20.11.0").ok, false);
  assert.equal(checkNodeMajor("basura").ok, false);
});

test("checkMacOS exige darwin", () => {
  assert.equal(checkMacOS("darwin").ok, true);
  assert.equal(checkMacOS("linux").ok, false);
  assert.equal(checkMacOS("win32").ok, false);
});

test("buildReport incluye TODOS los campos requeridos", () => {
  const r = buildReport({ STOP_REASON_CODE: STOP.OK });
  for (const f of REPORT_FIELDS) {
    assert.ok(Object.prototype.hasOwnProperty.call(r, f), `falta campo ${f}`);
    assert.notEqual(r[f], undefined, `campo indefinido ${f}`);
  }
  assert.equal(r.RESULT, "PASS");
  assert.equal(r.SCRIPT_EXIT_CODE, 0);
  assert.equal(r.UNIT, "TC-LOCAL-DB-RLS-HARNESS-01");
});

test("buildReport en fallo => RESULT FAIL y exit code coherente", () => {
  const r = buildReport({ STOP_REASON_CODE: STOP.E_ANON_LEAK, FAILED_PHASE: PHASE.POLICY_INVENTORY, FAILED_ROLE: "anon" });
  assert.equal(r.RESULT, "FAIL");
  assert.equal(r.SCRIPT_EXIT_CODE, EXIT_CODES[STOP.E_ANON_LEAK]);
  assert.notEqual(r.SCRIPT_EXIT_CODE, 0);
  assert.equal(r.FAILED_ROLE, "anon");
});

test("cada STOP tiene EXIT_CODE (solo OK=0)", () => {
  for (const code of Object.values(STOP)) {
    assert.ok(EXIT_CODES[code] !== undefined, `sin exit code: ${code}`);
    if (code === STOP.OK) assert.equal(EXIT_CODES[code], 0);
    else assert.notEqual(EXIT_CODES[code], 0, `${code} no debe ser 0`);
  }
});

test("defaultRecovery nunca sugiere acciones remotas", () => {
  for (const code of Object.values(STOP)) {
    const rec = defaultRecovery(code).toLowerCase();
    assert.ok(!/\bpush\b|deploy|link remoto|db push/.test(rec), `recovery inseguro para ${code}: ${rec}`);
  }
});

test("renderReportText produce KEY=VALUE por línea", () => {
  const txt = renderReportText(buildReport({ STOP_REASON_CODE: STOP.OK }));
  const keys = txt.trim().split("\n").map((l) => l.split("=")[0]);
  assert.deepEqual(keys, [...REPORT_FIELDS]);
});
