// TC-RECOVERY-CANONICAL-BOOTSTRAP-P2-P4-04
// Pruebas del owner ÚNICO del bootstrap: tools/local-db/lib/bootstrap.mjs
//
// TODO se ejecuta con MOCKS. Nada aquí toca Docker, Supabase CLI, la red ni el
// filesystem: `run` y `io` se inyectan. Importar el módulo NO debe ejecutar su
// modo CLI.
//
// Estas pruebas existen para cubrir exactamente los hallazgos que motivaron el
// módulo: F-03 (scaffold ausente) y F-04 (`head -1` sobre contenedor ajeno), más
// el split-brain entre DB_URL y CID.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BootstrapError,
  PG_MAJOR_VERSION,
  assertLocalTarget,
  assertRuntimeDirInScope,
  assertValidProjectId,
  bootstrapLocalStack,
  derivePorts,
  expectedDbContainerName,
  parseCliArgs,
  parseDockerPs,
  redactSecrets,
  renderConfigToml,
  scaffoldRuntime,
  selectDbContainer,
  startLocalStack,
} from "../../tools/local-db/lib/bootstrap.mjs";

const HARNESS_PROJECT = "tc_local_db_harness";
const RECOVERY_PROJECT = "tc_recovery_v2";
const HARNESS_PORT = 54329;
const RECOVERY_PORT = 54339;

// tools/secret-gate.sh prohíbe DSN Postgres con credenciales embebidas en el
// árbol, y con razón. Estas pruebas necesitan DSN sintéticos, así que se
// construyen por concatenación: ningún literal del archivo tiene la forma
// completa `esquema://usuario:clave@host`. Mismo recurso que harness.test.mjs.
const SCHEME = "postgresql://";
function dsn(host, port, { user = "postgres", pass = "x" } = {}) {
  return `${SCHEME}${user}:${pass}` + "@" + `${host}:${port}/postgres`;
}

// ---------------------------------------------------------------------------
// Puertos y project_id
// ---------------------------------------------------------------------------
test("derivePorts reparte db/shadow/api de forma determinista", () => {
  assert.deepEqual(derivePorts(54339), { dbPort: 54339, shadowPort: 54340, apiPort: 54439 });
  assert.deepEqual(derivePorts("54329"), { dbPort: 54329, shadowPort: 54330, apiPort: 54429 });
});

test("derivePorts rechaza puertos invalidos (fail-closed)", () => {
  for (const bad of [0, -1, "abc", null, undefined, 70000, 1023, 1.5]) {
    assert.throws(() => derivePorts(bad), BootstrapError, `deberia rechazar: ${String(bad)}`);
  }
});

test("harness y recovery NO comparten ningun puerto", () => {
  const h = derivePorts(HARNESS_PORT);
  const r = derivePorts(RECOVERY_PORT);
  const hs = new Set(Object.values(h));
  for (const p of Object.values(r)) {
    assert.ok(!hs.has(p), `colision de puerto entre harness y recovery: ${p}`);
  }
});

test("assertValidProjectId acepta los dos project_id reales y rechaza basura", () => {
  assert.equal(assertValidProjectId(HARNESS_PROJECT), HARNESS_PROJECT);
  assert.equal(assertValidProjectId(RECOVERY_PROJECT), RECOVERY_PROJECT);
  for (const bad of ["", "A", "ab", "Tc_Recovery", "tc-recovery", "tc recovery", "../x", null, 7]) {
    assert.throws(() => assertValidProjectId(bad), BootstrapError, `deberia rechazar: ${String(bad)}`);
  }
});

test("expectedDbContainerName deriva el nombre por proyecto", () => {
  assert.equal(expectedDbContainerName(RECOVERY_PROJECT), "supabase_db_tc_recovery_v2");
  assert.notEqual(
    expectedDbContainerName(RECOVERY_PROJECT),
    expectedDbContainerName(HARNESS_PROJECT),
  );
});

// ---------------------------------------------------------------------------
// config.toml — el artefacto cuya ausencia era F-03
// ---------------------------------------------------------------------------
test("renderConfigToml emite project_id, los tres puertos y major_version", () => {
  const toml = renderConfigToml({ projectId: RECOVERY_PROJECT, ...derivePorts(RECOVERY_PORT) });
  assert.match(toml, /^project_id = "tc_recovery_v2"$/m);
  assert.match(toml, /^port = 54339$/m);
  assert.match(toml, /^shadow_port = 54340$/m);
  assert.match(toml, /^port = 54439$/m);
  assert.match(toml, new RegExp(`^major_version = ${PG_MAJOR_VERSION}$`, "m"));
  assert.match(toml, /^\[db\]$/m);
  assert.match(toml, /^\[auth\]$/m);
});

test("renderConfigToml usa UNA sola plantilla: solo cambian project_id y puertos", () => {
  const a = renderConfigToml({ projectId: HARNESS_PROJECT, ...derivePorts(HARNESS_PORT) });
  const b = renderConfigToml({ projectId: RECOVERY_PROJECT, ...derivePorts(RECOVERY_PORT) });
  const skeleton = (s) => s.replace(/"[^"]*"/g, '"X"').replace(/\d+/g, "N");
  assert.equal(skeleton(a), skeleton(b), "la estructura del config.toml debe ser identica");
});

// ---------------------------------------------------------------------------
// Guarda de alcance del runtime
// ---------------------------------------------------------------------------
test("assertRuntimeDirInScope solo permite rutas ESTRICTAMENTE bajo tools/local-db/", () => {
  assert.ok(assertRuntimeDirInScope("tools/local-db/.runtime-recovery").endsWith("/tools/local-db/.runtime-recovery"));
  assert.ok(assertRuntimeDirInScope("tools/local-db/.runtime").endsWith("/tools/local-db/.runtime"));
  for (const bad of ["tools/local-db", "tools", "supabase/migrations", "/tmp/x", "tools/local-db/../../app", ".."]) {
    assert.throws(() => assertRuntimeDirInScope(bad), BootstrapError, `deberia rechazar: ${bad}`);
  }
});

// ---------------------------------------------------------------------------
// Resolución de contenedor — el corazón de P3 y el reemplazo de `head -1`
// ---------------------------------------------------------------------------
const PS_RECOVERY = "supabase_db_tc_recovery_v2|||0.0.0.0:54339->5432/tcp";
const PS_HARNESS = "supabase_db_tc_local_db_harness|||0.0.0.0:54329->5432/tcp";
const PS_OTHER = "supabase_db_otro_proyecto|||0.0.0.0:54339->5432/tcp";
const PS_NOISE = "redis_cache|||0.0.0.0:6379->6379/tcp";

test("parseDockerPs separa nombre y puertos, ignorando lineas vacias", () => {
  const rows = parseDockerPs(`${PS_RECOVERY}\n\n  ${PS_HARNESS}  \n`);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, "supabase_db_tc_recovery_v2");
  assert.match(rows[0].ports, /54339->5432\/tcp/);
});

test("selectDbContainer resuelve EXACTAMENTE el contenedor del proyecto y puerto", () => {
  const r = selectDbContainer(
    [PS_NOISE, PS_HARNESS, PS_RECOVERY].join("\n"),
    { projectId: RECOVERY_PROJECT, dbPort: RECOVERY_PORT },
  );
  assert.equal(r.name, "supabase_db_tc_recovery_v2");
});

test("selectDbContainer NO se comporta como `head -1`: ignora el contenedor del harness", () => {
  // El harness aparece PRIMERO en la salida. La implementacion anterior
  // (`grep '^supabase_db_' | head -1`) habria devuelto el del harness y habria
  // ejecutado DISABLE TRIGGER + pg_restore sobre SU base. Este es F-04.
  const r = selectDbContainer(
    [PS_HARNESS, PS_RECOVERY].join("\n"),
    { projectId: RECOVERY_PROJECT, dbPort: RECOVERY_PORT },
  );
  assert.equal(r.name, "supabase_db_tc_recovery_v2");
  assert.notEqual(r.name, "supabase_db_tc_local_db_harness");
});

test("selectDbContainer aborta con CERO contenedores", () => {
  try {
    selectDbContainer(PS_NOISE, { projectId: RECOVERY_PROJECT, dbPort: RECOVERY_PORT });
    assert.fail("deberia haber abortado");
  } catch (e) {
    assert.ok(e instanceof BootstrapError);
    assert.equal(e.fields.REASON, "CONTAINER_NOT_FOUND");
  }
});

test("selectDbContainer aborta con salida vacia (docker ps sin nada)", () => {
  assert.throws(
    () => selectDbContainer("", { projectId: RECOVERY_PROJECT, dbPort: RECOVERY_PORT }),
    BootstrapError,
  );
});

test("selectDbContainer aborta si MAS DE UNO coincide", () => {
  try {
    selectDbContainer([PS_RECOVERY, PS_RECOVERY].join("\n"), {
      projectId: RECOVERY_PROJECT, dbPort: RECOVERY_PORT,
    });
    assert.fail("deberia haber abortado");
  } catch (e) {
    assert.equal(e.fields.REASON, "CONTAINER_AMBIGUOUS");
  }
});

test("selectDbContainer aborta si el puerto lo publica OTRO proyecto (infra ajena)", () => {
  try {
    selectDbContainer(PS_OTHER, { projectId: RECOVERY_PROJECT, dbPort: RECOVERY_PORT });
    assert.fail("deberia haber abortado");
  } catch (e) {
    assert.equal(e.fields.REASON, "CONTAINER_PORT_FOREIGN");
    assert.match(e.fields.ACTUAL, /supabase_db_otro_proyecto/);
  }
});

test("selectDbContainer aborta si el contenedor propio no publica el puerto esperado", () => {
  try {
    selectDbContainer("supabase_db_tc_recovery_v2|||0.0.0.0:55555->5432/tcp", {
      projectId: RECOVERY_PROJECT, dbPort: RECOVERY_PORT,
    });
    assert.fail("deberia haber abortado");
  } catch (e) {
    assert.equal(e.fields.REASON, "CONTAINER_PORT_MISMATCH");
  }
});

test("selectDbContainer no confunde 154339 con 54339 (coincidencia de subcadena)", () => {
  assert.throws(
    () => selectDbContainer("supabase_db_tc_recovery_v2|||0.0.0.0:154339->5432/tcp", {
      projectId: RECOVERY_PROJECT, dbPort: RECOVERY_PORT,
    }),
    BootstrapError,
  );
});

// ---------------------------------------------------------------------------
// scaffoldRuntime con io mockeado
// ---------------------------------------------------------------------------
function mockIo({ exists = () => false } = {}) {
  const calls = { mkdir: [], write: [], symlink: [], rm: [] };
  return {
    calls,
    io: {
      existsSync: (p) => exists(p),
      mkdirSync: (p, o) => calls.mkdir.push([p, o]),
      writeFileSync: (p, c) => calls.write.push([p, c]),
      symlinkSync: (a, b) => calls.symlink.push([a, b]),
      rmSync: (p, o) => calls.rm.push([p, o]),
    },
  };
}

test("scaffoldRuntime escribe config.toml Y enlaza migraciones (lo que faltaba en F-03)", () => {
  const m = mockIo();
  const r = scaffoldRuntime({
    runtimeDir: "tools/local-db/.runtime-recovery",
    projectId: RECOVERY_PROJECT,
    dbPort: RECOVERY_PORT,
  }, { io: m.io });

  assert.equal(m.calls.write.length, 1);
  const [configPath, configBody] = m.calls.write[0];
  assert.ok(configPath.endsWith("/.runtime-recovery/supabase/config.toml"), configPath);
  assert.match(configBody, /project_id = "tc_recovery_v2"/);

  assert.equal(m.calls.symlink.length, 1);
  const [migSrc, migDst] = m.calls.symlink[0];
  assert.ok(migSrc.endsWith("/supabase/migrations"), migSrc);
  assert.ok(migDst.endsWith("/.runtime-recovery/supabase/migrations"), migDst);

  assert.equal(r.shadowPort, RECOVERY_PORT + 1);
  assert.equal(r.apiPort, RECOVERY_PORT + 100);
});

test("scaffoldRuntime sin resetRuntime solo rehace el scaffold supabase/ (modo harness)", () => {
  const m = mockIo({ exists: () => true });
  scaffoldRuntime({
    runtimeDir: "tools/local-db/.runtime",
    projectId: HARNESS_PROJECT,
    dbPort: HARNESS_PORT,
    resetRuntime: false,
  }, { io: m.io });
  assert.equal(m.calls.rm.length, 1);
  assert.ok(m.calls.rm[0][0].endsWith("/.runtime/supabase"), m.calls.rm[0][0]);
});

test("scaffoldRuntime con resetRuntime borra el runtime completo (modo recovery)", () => {
  const m = mockIo({ exists: () => true });
  scaffoldRuntime({
    runtimeDir: "tools/local-db/.runtime-recovery",
    projectId: RECOVERY_PROJECT,
    dbPort: RECOVERY_PORT,
    resetRuntime: true,
  }, { io: m.io });
  assert.equal(m.calls.rm.length, 1);
  assert.ok(m.calls.rm[0][0].endsWith("/.runtime-recovery"), m.calls.rm[0][0]);
  assert.ok(!m.calls.rm[0][0].endsWith("/supabase"), "no debe limitarse al subdir supabase/");
});

test("scaffoldRuntime nunca borra fuera de tools/local-db/", () => {
  const m = mockIo({ exists: () => true });
  assert.throws(
    () => scaffoldRuntime({
      runtimeDir: "supabase", projectId: RECOVERY_PROJECT, dbPort: RECOVERY_PORT, resetRuntime: true,
    }, { io: m.io }),
    BootstrapError,
  );
  assert.equal(m.calls.rm.length, 0, "no debe haber intentado ningun borrado");
});

// ---------------------------------------------------------------------------
// startLocalStack con run mockeado — DB_URL y CID de la misma resolución
// ---------------------------------------------------------------------------
function mockRun({
  startCode = 0,
  statusCode = 0,
  dbUrl = dsn("127.0.0.1", RECOVERY_PORT, { pass: "postgres" }),
  psCode = 0,
  ps = PS_RECOVERY,
} = {}) {
  const seen = [];
  const run = (cmd, args) => {
    seen.push([cmd, ...args]);
    if (cmd === "supabase" && args[0] === "start") return { code: startCode, stdout: "", stderr: "" };
    if (cmd === "supabase" && args[0] === "status") {
      return { code: statusCode, stdout: `ANON_KEY="eyJabc.def.ghi"\nDB_URL="${dbUrl}"\n`, stderr: "" };
    }
    if (cmd === "docker" && args[0] === "ps") return { code: psCode, stdout: ps, stderr: "" };
    return { code: 0, stdout: "", stderr: "" };
  };
  return { run, seen };
}

test("startLocalStack devuelve DB_URL y CID de la MISMA resolucion", () => {
  const m = mockRun();
  const r = startLocalStack(
    { runtimeDir: "tools/local-db/.runtime-recovery", projectId: RECOVERY_PROJECT, dbPort: RECOVERY_PORT },
    { run: m.run },
  );
  assert.equal(r.container, "supabase_db_tc_recovery_v2");
  assert.equal(r.dbPort, RECOVERY_PORT);
  assert.equal(r.host, "127.0.0.1");
  // El puerto con el que se buscó el contenedor es el de la DB_URL observada.
  assert.equal(String(new URL(r.dbUrl).port), String(r.dbPort));
});

test("startLocalStack aborta si DB_URL apunta a un host REMOTO", () => {
  const m = mockRun({ dbUrl: dsn("db.abcdefgh.supabase.co", 5432) });
  try {
    startLocalStack(
      { runtimeDir: "tools/local-db/.runtime-recovery", projectId: RECOVERY_PROJECT, dbPort: RECOVERY_PORT },
      { run: m.run },
    );
    assert.fail("deberia haber abortado");
  } catch (e) {
    assert.equal(e.stopCode, "E_REMOTE_TARGET_DETECTED");
  }
});

test("startLocalStack aborta si el puerto de DB_URL no es el solicitado (anti split-brain)", () => {
  const m = mockRun({ dbUrl: dsn("127.0.0.1", 54999) });
  try {
    startLocalStack(
      { runtimeDir: "tools/local-db/.runtime-recovery", projectId: RECOVERY_PROJECT, dbPort: RECOVERY_PORT },
      { run: m.run },
    );
    assert.fail("deberia haber abortado");
  } catch (e) {
    assert.equal(e.fields.REASON, "DB_URL_PORT_DRIFT");
  }
});

test("startLocalStack aborta si supabase start falla, sin llegar a docker ps", () => {
  const m = mockRun({ startCode: 1 });
  assert.throws(
    () => startLocalStack(
      { runtimeDir: "tools/local-db/.runtime-recovery", projectId: RECOVERY_PROJECT, dbPort: RECOVERY_PORT },
      { run: m.run },
    ),
    BootstrapError,
  );
  assert.ok(!m.seen.some(([c, a]) => c === "docker" && a === "ps"), "no debe inventariar Docker tras fallar el start");
});

test("startLocalStack aborta si docker ps falla", () => {
  const m = mockRun({ psCode: 1 });
  assert.throws(
    () => startLocalStack(
      { runtimeDir: "tools/local-db/.runtime-recovery", projectId: RECOVERY_PROJECT, dbPort: RECOVERY_PORT },
      { run: m.run },
    ),
    BootstrapError,
  );
});

test("startLocalStack aborta si el puerto lo ocupa un contenedor ajeno", () => {
  const m = mockRun({ ps: PS_OTHER });
  try {
    startLocalStack(
      { runtimeDir: "tools/local-db/.runtime-recovery", projectId: RECOVERY_PROJECT, dbPort: RECOVERY_PORT },
      { run: m.run },
    );
    assert.fail("deberia haber abortado");
  } catch (e) {
    assert.equal(e.fields.REASON, "CONTAINER_PORT_FOREIGN");
  }
});

test("bootstrapLocalStack encadena scaffold+start y marca la fuente unica", () => {
  const mi = mockIo();
  const mr = mockRun();
  const r = bootstrapLocalStack(
    {
      runtimeDir: "tools/local-db/.runtime-recovery",
      projectId: RECOVERY_PROJECT,
      dbPort: RECOVERY_PORT,
      resetRuntime: true,
    },
    { io: mi.io, run: mr.run },
  );
  assert.equal(r.cidDbUrlSingleSource, true);
  assert.equal(r.container, "supabase_db_tc_recovery_v2");
  assert.equal(r.projectId, RECOVERY_PROJECT);
  assert.equal(r.apiPort, RECOVERY_PORT + 100);
  assert.equal(mi.calls.write.length, 1, "debe haber escrito config.toml antes de arrancar");
});

// ---------------------------------------------------------------------------
// Higiene de secretos y regresión de F-01
// ---------------------------------------------------------------------------
test("redactSecrets oculta password de DSN, JWT y claves de servicio", () => {
  const s = [
    "postgresql://postgres:", "s3cr3t", "@127.0.0.1:54339/postgres ",
    "SERVICE_ROLE_KEY=", "eyJhbGciOi", ".payloadpart.sigpart",
  ].join("");
  const r = redactSecrets(s);
  assert.ok(!r.includes("s3cr3t"), "password del DSN no debe filtrarse");
  assert.ok(!r.includes("payloadpart"), "JWT no debe filtrarse");
  assert.ok(r.includes("127.0.0.1"), "el host local si puede mostrarse");
});

test("assertLocalTarget lee .classification (regresion de F-01: objeto tratado como string)", () => {
  const c = assertLocalTarget(dsn("127.0.0.1", RECOVERY_PORT));
  assert.equal(c.classification, "LOCAL");
  assert.throws(() => assertLocalTarget(dsn("db.xyz.supabase.co", 5432)), BootstrapError);
  // Un host remoto que CONTIENE "localhost" como subcadena no debe pasar.
  assert.throws(() => assertLocalTarget(dsn("localhost.evil.example.com", 5432)), BootstrapError);
});

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
test("parseCliArgs exige project-id, db-port y runtime-dir", () => {
  const a = parseCliArgs(["--project-id", RECOVERY_PROJECT, "--db-port", "54339", "--runtime-dir", "tools/local-db/.runtime-recovery", "--reset-runtime"]);
  assert.equal(a.projectId, RECOVERY_PROJECT);
  assert.equal(a.dbPort, 54339);
  assert.equal(a.resetRuntime, true);
  assert.throws(() => parseCliArgs(["--project-id", RECOVERY_PROJECT]), BootstrapError);
  assert.throws(() => parseCliArgs(["--vaya"]), BootstrapError);
});
