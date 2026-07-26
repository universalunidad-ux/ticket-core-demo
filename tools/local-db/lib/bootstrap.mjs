// TC-RECOVERY-CANONICAL-BOOTSTRAP-P2-P4-04
// bootstrap.mjs — OWNER ÚNICO del bootstrap de la plataforma Supabase LOCAL.
//
// Antes de este módulo había dos implementaciones del mismo bootstrap:
//   - tools/local-db/harness.mjs        (scaffold completo y correcto)
//   - tools/local-db/run-recovery-v2.sh (supabase start SIN scaffold: no
//     generaba config.toml ni enlazaba migraciones, y resolvía el contenedor
//     con `docker ps | grep '^supabase_db_' | head -1`, pudiendo operar sobre
//     un contenedor ajeno — hallazgos F-03 y F-04)
//
// Este archivo es la ÚNICA fuente responsable. harness.mjs y run-recovery-v2.sh
// lo consumen; ninguno reimplementa nada de lo que vive aquí. No se crea un
// bootstrap alternativo ni un tercer orquestador.
//
// Estado: IMPLEMENTADO LOCAL · NO VALIDADO EN VIVO (sin Docker en el entorno de
// autoría). Las funciones puras SÍ están cubiertas por pruebas unitarias con
// mocks en test/local-db/bootstrap.test.mjs.
//
// Reglas duras que este módulo garantiza:
//   1. Cada proyecto tiene project_id, dbPort, shadowPort y apiPort PROPIOS.
//   2. El contenedor se resuelve por (proyecto AND puerto publicado), exigiendo
//      EXACTAMENTE una coincidencia. Cero o más de una ⇒ abort fail-closed.
//      NUNCA `head -1`.
//   3. DB_URL y CID provienen de la MISMA resolución: el puerto con el que se
//      busca el contenedor se deriva de la DB_URL real que reporta
//      `supabase status`. No hay split-brain posible entre ambos.
//   4. El destino debe clasificar como LOCAL (guards.mjs). Nunca remoto.
//   5. La escritura del runtime está confinada a tools/local-db/.
//
// Uso como módulo:
//   import { bootstrapLocalStack } from "./lib/bootstrap.mjs";
//
// Uso como CLI (lo consume run-recovery-v2.sh; imprime KEY=VALUE en stdout):
//   node tools/local-db/lib/bootstrap.mjs --project-id <id> --db-port <N> \
//        --runtime-dir <ruta-bajo-tools/local-db> [--reset-runtime]

import { spawnSync } from "node:child_process";
import {
  mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync,
} from "node:fs";
import { join, resolve, dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

import { STOP, PHASE, classifyTarget } from "./guards.mjs";
import { parseSupabaseStatusDbUrl } from "./parse.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, "..", "..", "..");

// Único prefijo bajo el que este módulo puede crear o destruir un runtime.
export const RUNTIME_ROOT_PREFIX = join(REPO_ROOT, "tools", "local-db");

// Versión mayor de PostgreSQL del stack local. Un solo valor para ambos
// consumidores: si divergiera, las firmas de recovery-signature.sql no serían
// comparables entre harness y recovery.
export const PG_MAJOR_VERSION = 15;

// ---------------------------------------------------------------------------
// Error estructurado. Lleva el STOP code del taxonomía compartida para que
// harness.mjs pueda mapearlo a su stop() SIN cambiar sus exit codes.
// ---------------------------------------------------------------------------
export class BootstrapError extends Error {
  constructor(stopCode, phase, detail, fields = {}) {
    super(detail || stopCode);
    this.name = "BootstrapError";
    this.stopCode = stopCode;
    this.phase = phase;
    this.detail = detail || "";
    this.fields = fields;
  }
}

// ---------------------------------------------------------------------------
// Higiene de secretos. Toda salida de herramienta externa pasa por aquí antes
// de acabar en un mensaje de error, un log o un artefacto.
// ---------------------------------------------------------------------------
export function redactSecrets(text) {
  if (typeof text !== "string") return text;
  return text
    .replace(/(postgres(?:ql)?:\/\/[^:@\s]+:)([^@\s]+)(@)/gi, "$1***$3")
    .replace(/(password\s*=\s*)([^\s;]+)/gi, "$1***")
    .replace(/(eyJ[A-Za-z0-9_-]{6,})\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "***JWT***")
    .replace(/((?:ANON|SERVICE_ROLE|SERVICE)_KEY\s*=\s*)(\S+)/gi, "$1***");
}

// ---------------------------------------------------------------------------
// PURO · Derivación de puertos. Un solo lugar decide el reparto, así que dos
// proyectos con dbPort distinto no pueden colisionar en shadow ni en api.
// ---------------------------------------------------------------------------
export function derivePorts(dbPort) {
  const n = Number(dbPort);
  if (!Number.isInteger(n) || n < 1024 || n > 65433) {
    throw new BootstrapError(
      STOP.E_SCAFFOLD_FAILED,
      PHASE.SCAFFOLD,
      `db_port invalido: ${String(dbPort)} (se espera entero 1024..65433)`,
      { EXPECTED: "1024..65433", ACTUAL: String(dbPort) },
    );
  }
  return { dbPort: n, shadowPort: n + 1, apiPort: n + 100 };
}

// ---------------------------------------------------------------------------
// PURO · Validación del project_id. El nombre del contenedor se deriva de él,
// así que debe ser un identificador estable y sin sorpresas de shell.
// ---------------------------------------------------------------------------
export function assertValidProjectId(projectId) {
  if (typeof projectId !== "string" || !/^[a-z0-9][a-z0-9_]{2,47}$/.test(projectId)) {
    throw new BootstrapError(
      STOP.E_SCAFFOLD_FAILED,
      PHASE.SCAFFOLD,
      `project_id invalido: ${String(projectId)}`,
      { EXPECTED: "^[a-z0-9][a-z0-9_]{2,47}$", ACTUAL: String(projectId) },
    );
  }
  return projectId;
}

// ---------------------------------------------------------------------------
// PURO · Nombre esperado del contenedor de base de datos del proyecto.
// ---------------------------------------------------------------------------
export function expectedDbContainerName(projectId) {
  return `supabase_db_${assertValidProjectId(projectId)}`;
}

// ---------------------------------------------------------------------------
// PURO · config.toml. Plantilla ÚNICA para todos los consumidores.
// ---------------------------------------------------------------------------
export function renderConfigToml({ projectId, dbPort, shadowPort, apiPort }) {
  assertValidProjectId(projectId);
  return [
    `# GENERADO por tools/local-db/lib/bootstrap.mjs (efímero). No editar a mano.`,
    `project_id = "${projectId}"`,
    ``,
    `[db]`,
    `port = ${dbPort}`,
    `shadow_port = ${shadowPort}`,
    `major_version = ${PG_MAJOR_VERSION}`,
    ``,
    `[api]`,
    `enabled = true`,
    `port = ${apiPort}`,
    `schemas = ["public"]`,
    ``,
    `[studio]`,
    `enabled = false`,
    ``,
    `[auth]`,
    `enabled = true`,
    ``,
    `[analytics]`,
    `enabled = false`,
    ``,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// PURO · Parseo de `docker ps --format '{{.Names}}|||{{.Ports}}'`.
// ---------------------------------------------------------------------------
export function parseDockerPs(stdout) {
  return String(stdout || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [name = "", ports = ""] = line.split("|||");
      return { name: name.trim(), ports: ports.trim() };
    })
    .filter((r) => r.name !== "");
}

// ---------------------------------------------------------------------------
// PURO · Resolución del contenedor. Corazón de P3.
//
// Exige EXACTAMENTE una coincidencia por (nombre del proyecto AND puerto
// publicado). Sustituye el `head -1` de run-recovery-v2.sh y el filtro
// `startsWith("supabase_db_")` de harness.mjs, que aceptaba el contenedor de
// cualquier proyecto que publicara el puerto.
//
// Los cuatro modos de fallo se distinguen para que el diagnóstico diga qué
// pasó, no sólo que falló:
//   - ninguno publica el puerto y no existe el del proyecto  -> NOT_FOUND
//   - el puerto lo publica OTRO proyecto                     -> PORT_FOREIGN
//   - el del proyecto existe pero no publica ese puerto      -> PORT_MISMATCH
//   - más de uno coincide                                    -> AMBIGUOUS
// ---------------------------------------------------------------------------
export function selectDbContainer(dockerPsStdout, { projectId, dbPort }) {
  const expectedName = expectedDbContainerName(projectId);
  const portToken = `:${dbPort}->5432/tcp`;
  const rows = parseDockerPs(dockerPsStdout);

  const byName = rows.filter((r) => r.name === expectedName);
  const byPort = rows.filter((r) => r.ports.includes(portToken));
  const matches = rows.filter(
    (r) => r.name === expectedName && r.ports.includes(portToken),
  );

  if (matches.length === 1) {
    return {
      name: matches[0].name,
      ports: matches[0].ports,
      projectId,
      dbPort: Number(dbPort),
    };
  }

  const inventory = rows.map((r) => r.name).join(",") || "(ninguno)";

  if (matches.length > 1) {
    throw new BootstrapError(
      STOP.E_SUPABASE_START_FAILED,
      PHASE.SUPABASE_START,
      `resolucion ambigua: ${matches.length} contenedores coinciden con ${expectedName} en ${dbPort}`,
      {
        REASON: "CONTAINER_AMBIGUOUS",
        EXPECTED: `1 contenedor ${expectedName} publicando ${portToken}`,
        ACTUAL: matches.map((r) => r.name).join(","),
      },
    );
  }

  if (byPort.length > 0) {
    throw new BootstrapError(
      STOP.E_SUPABASE_START_FAILED,
      PHASE.SUPABASE_START,
      `el puerto ${dbPort} lo publica un contenedor que NO pertenece a ${projectId}: `
      + `no se opera sobre infraestructura ajena`,
      {
        REASON: "CONTAINER_PORT_FOREIGN",
        EXPECTED: `1 contenedor ${expectedName} publicando ${portToken}`,
        ACTUAL: byPort.map((r) => r.name).join(","),
        RECOVERY: `elegir otro --db-port, o detener el proyecto que ocupa ${dbPort}`,
      },
    );
  }

  if (byName.length > 0) {
    throw new BootstrapError(
      STOP.E_SUPABASE_START_FAILED,
      PHASE.SUPABASE_START,
      `${expectedName} existe pero no publica ${portToken}: DB_URL y contenedor no concuerdan`,
      {
        REASON: "CONTAINER_PORT_MISMATCH",
        EXPECTED: portToken,
        ACTUAL: byName.map((r) => r.ports).join(" | ") || "(sin puertos publicados)",
      },
    );
  }

  throw new BootstrapError(
    STOP.E_SUPABASE_START_FAILED,
    PHASE.SUPABASE_START,
    `no se resolvio ningun contenedor ${expectedName} publicando ${portToken}`,
    {
      REASON: "CONTAINER_NOT_FOUND",
      EXPECTED: `1 contenedor ${expectedName} publicando ${portToken}`,
      ACTUAL: inventory,
    },
  );
}

// ---------------------------------------------------------------------------
// PURO · Guarda de alcance del runtime. Impide que un runtimeDir mal pasado
// haga que este módulo borre algo fuera de tools/local-db/.
// ---------------------------------------------------------------------------
export function assertRuntimeDirInScope(runtimeDir) {
  const abs = isAbsolute(runtimeDir) ? resolve(runtimeDir) : resolve(REPO_ROOT, runtimeDir);
  const prefix = RUNTIME_ROOT_PREFIX + "/";
  if (abs === RUNTIME_ROOT_PREFIX || !abs.startsWith(prefix)) {
    throw new BootstrapError(
      STOP.E_SCOPE_VIOLATION,
      PHASE.PRECHECK_SCOPE_GUARD,
      `runtime_dir fuera de alcance: debe estar estrictamente bajo tools/local-db/`,
      { EXPECTED: `${prefix}*`, ACTUAL: abs },
    );
  }
  return abs;
}

// ---------------------------------------------------------------------------
// Runner por defecto (inyectable para pruebas).
// ---------------------------------------------------------------------------
function defaultRun(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    cwd: opts.cwd || REPO_ROOT,
    encoding: "utf8",
    env: opts.env || process.env,
    timeout: opts.timeout || 300000,
    maxBuffer: 32 * 1024 * 1024,
  });
  return {
    code: res.status == null ? 1 : res.status,
    stdout: res.stdout || "",
    stderr: res.stderr || "",
  };
}

const defaultIo = {
  mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync,
};

// ---------------------------------------------------------------------------
// EFECTOS · Scaffold del workdir efímero.
// ---------------------------------------------------------------------------
export function scaffoldRuntime(opts, deps = {}) {
  const io = { ...defaultIo, ...(deps.io || {}) };
  const {
    runtimeDir,
    projectId,
    dbPort,
    migrationsSrc = join(REPO_ROOT, "supabase", "migrations"),
    resetRuntime = false,
  } = opts;

  assertValidProjectId(projectId);
  const runtimeAbs = assertRuntimeDirInScope(runtimeDir);
  const ports = derivePorts(dbPort);
  const runtimeSupabase = join(runtimeAbs, "supabase");

  try {
    // `resetRuntime` borra el runtime COMPLETO (lo usa recovery, que estrena
    // workdir en cada corrida). Sin él sólo se rehace el scaffold `supabase/`,
    // que es el comportamiento histórico del harness.
    if (resetRuntime && io.existsSync(runtimeAbs)) {
      io.rmSync(runtimeAbs, { recursive: true, force: true });
    } else if (io.existsSync(runtimeSupabase)) {
      io.rmSync(runtimeSupabase, { recursive: true, force: true });
    }
    io.mkdirSync(runtimeSupabase, { recursive: true });
    io.writeFileSync(
      join(runtimeSupabase, "config.toml"),
      renderConfigToml({ projectId, ...ports }),
    );
    // Enlace simbólico a las migraciones reales: fuente de verdad única, sin
    // copiar. Sin esto `supabase db reset` no aplica ninguna migración.
    io.symlinkSync(migrationsSrc, join(runtimeSupabase, "migrations"));
  } catch (e) {
    if (e instanceof BootstrapError) throw e;
    throw new BootstrapError(
      STOP.E_SCAFFOLD_FAILED,
      PHASE.SCAFFOLD,
      `no se pudo preparar el workdir: ${redactSecrets(String(e && e.message))}`,
      { ACTUAL: runtimeAbs },
    );
  }

  return {
    projectId,
    runtimeDir: runtimeAbs,
    runtimeSupabase,
    migrationsSrc,
    ...ports,
  };
}

// ---------------------------------------------------------------------------
// EFECTOS · `supabase start` + status + resolución del contenedor.
//
// DB_URL y CID salen de aquí juntos y del mismo hecho observado: el puerto
// usado para localizar el contenedor es el de la DB_URL real. Devolver ambos
// desde una sola función es lo que hace imposible el split-brain.
// ---------------------------------------------------------------------------
export function startLocalStack(opts, deps = {}) {
  const run = deps.run || defaultRun;
  const { runtimeDir, projectId, dbPort, startTimeoutMs = 600000 } = opts;

  assertValidProjectId(projectId);
  const runtimeAbs = assertRuntimeDirInScope(runtimeDir);

  const started = run("supabase", ["start", "--workdir", runtimeAbs], { timeout: startTimeoutMs });
  if (started.code !== 0) {
    throw new BootstrapError(
      STOP.E_SUPABASE_START_FAILED,
      PHASE.SUPABASE_START,
      "supabase start fallo",
      {
        FAILED_COMMAND: "supabase start --workdir <runtime>",
        ACTUAL: redactSecrets(`${started.stderr || started.stdout}`).slice(-800),
      },
    );
  }

  const status = run("supabase", ["status", "-o", "env", "--workdir", runtimeAbs], { timeout: 120000 });
  if (status.code !== 0) {
    throw new BootstrapError(
      STOP.E_SUPABASE_START_FAILED,
      PHASE.SUPABASE_START,
      "supabase status estructurado fallo",
      {
        FAILED_COMMAND: "supabase status -o env --workdir <runtime>",
        ACTUAL: `exit=${status.code}; salida omitida porque contiene credenciales locales`,
      },
    );
  }

  const parsed = parseSupabaseStatusDbUrl(`${status.stdout}\n${status.stderr}`);
  if (!parsed) {
    throw new BootstrapError(
      STOP.E_SUPABASE_START_FAILED,
      PHASE.SUPABASE_START,
      "no se pudo leer DB_URL local desde la salida estructurada",
      { ACTUAL: "DB_URL ausente o no reconocida; salida omitida por seguridad" },
    );
  }

  // GUARDA CRÍTICA: el destino DEBE ser local. Nunca remoto.
  if (parsed.classification !== "LOCAL") {
    throw new BootstrapError(
      STOP.E_REMOTE_TARGET_DETECTED,
      PHASE.SUPABASE_START,
      `DB_URL no local (${parsed.reason})`,
      {
        EXPECTED: "host en la allowlist local (127.0.0.1/localhost/::1)",
        ACTUAL: `host=${parsed.host ?? "?"}`,
        DO_NOT_RUN: "psql remoto | supabase remoto | link | db push",
      },
    );
  }

  // El puerto EFECTIVO es el de la DB_URL observada, no el solicitado. Si el
  // CLI publicó otro puerto, se detecta aquí en vez de arrastrar la
  // discrepancia hasta un docker exec contra el contenedor equivocado.
  let effectivePort = null;
  try {
    effectivePort = new URL(parsed.url).port;
  } catch { /* se trata abajo como puerto ausente */ }

  if (!effectivePort) {
    throw new BootstrapError(
      STOP.E_SUPABASE_START_FAILED,
      PHASE.SUPABASE_START,
      "DB_URL local sin puerto publicado",
      { ACTUAL: "puerto ausente en DB_URL" },
    );
  }

  if (Number(effectivePort) !== Number(dbPort)) {
    throw new BootstrapError(
      STOP.E_SUPABASE_START_FAILED,
      PHASE.SUPABASE_START,
      `el puerto de DB_URL (${effectivePort}) no coincide con el solicitado (${dbPort})`,
      {
        REASON: "DB_URL_PORT_DRIFT",
        EXPECTED: String(dbPort),
        ACTUAL: String(effectivePort),
      },
    );
  }

  const dockerPs = run("docker", ["ps", "--format", "{{.Names}}|||{{.Ports}}"], { timeout: 60000 });
  if (dockerPs.code !== 0) {
    throw new BootstrapError(
      STOP.E_SUPABASE_START_FAILED,
      PHASE.SUPABASE_START,
      "no se pudo inventariar contenedores Docker",
      {
        FAILED_COMMAND: "docker ps --format <names-and-ports>",
        ACTUAL: redactSecrets(`${dockerPs.stdout}\n${dockerPs.stderr}`).slice(-500),
      },
    );
  }

  const container = selectDbContainer(dockerPs.stdout, { projectId, dbPort: effectivePort });

  return {
    projectId,
    runtimeDir: runtimeAbs,
    dbUrl: parsed.url,
    host: parsed.host,
    dbPort: Number(effectivePort),
    container: container.name,
    containerPorts: container.ports,
  };
}

// ---------------------------------------------------------------------------
// EFECTOS · Bootstrap completo: scaffold + start + resolución.
// Único punto de entrada que deberían usar los consumidores.
// ---------------------------------------------------------------------------
export function bootstrapLocalStack(opts, deps = {}) {
  const scaffolded = scaffoldRuntime(opts, deps);
  const started = startLocalStack(
    { ...opts, runtimeDir: scaffolded.runtimeDir, dbPort: scaffolded.dbPort },
    deps,
  );
  return {
    ...scaffolded,
    ...started,
    // Invariante explícita: ambos vienen de startLocalStack, misma resolución.
    cidDbUrlSingleSource: true,
  };
}

// ---------------------------------------------------------------------------
// PURO · project_id declarado por un config.toml. Es la PRUEBA de ownership del
// workdir: si el toml no declara nuestro proyecto, ese runtime no es nuestro.
// ---------------------------------------------------------------------------
export function parseProjectIdFromToml(text) {
  const m = /^\s*project_id\s*=\s*"([^"]+)"\s*$/m.exec(String(text || ""));
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// EFECTOS · Teardown (P5). Mismo owner que el arranque, para que nadie invente
// su propia forma de parar lo que este módulo levantó.
//
// Invariantes duras:
//   1. Sólo se detiene el stack PROPIO: el config.toml del workdir debe declarar
//      exactamente el project_id esperado. Sin esa prueba NO se ejecuta stop
//      (E_SCOPE_VIOLATION): nunca se detiene ni se inspecciona infra ajena.
//   2. El runtime SÓLO se borra si el stop terminó en 0. Antes se borraba pase
//      lo que pasase, destruyendo la evidencia (config.toml, project_id, puerto)
//      necesaria para recuperar a mano un stack que quedó arriba.
//   3. Devuelve siempre qué se preservó, para que el llamador lo reporte.
// ---------------------------------------------------------------------------
export function stopLocalStack(opts, deps = {}) {
  const run = deps.run || defaultRun;
  const io = { ...defaultIo, ...(deps.io || {}) };
  const { runtimeDir, projectId = null, noBackup = true, removeRuntime = false } = opts;
  const runtimeAbs = assertRuntimeDirInScope(runtimeDir);
  const configPath = join(runtimeAbs, "supabase", "config.toml");

  if (projectId !== null) {
    assertValidProjectId(projectId);
    const declared = io.existsSync(configPath)
      ? parseProjectIdFromToml(io.readFileSync(configPath, "utf8"))
      : null;
    if (declared !== projectId) {
      throw new BootstrapError(
        STOP.E_SCOPE_VIOLATION,
        PHASE.PRECHECK_SCOPE_GUARD,
        "el workdir no acredita ser del proyecto esperado: NO se detiene un stack ajeno",
        {
          REASON: "STACK_OWNERSHIP_UNPROVEN",
          EXPECTED: `project_id="${projectId}" en ${configPath}`,
          ACTUAL: declared === null ? "(config.toml ausente o sin project_id)" : declared,
          RECOVERY: "detener manualmente el stack correcto con su propio workdir",
        },
      );
    }
  }

  const args = ["stop", "--workdir", runtimeAbs];
  if (noBackup) args.push("--no-backup");
  const res = run("supabase", args, { timeout: 180000 });
  const stopped = res.code === 0;

  let runtimeDeleted = false;
  if (removeRuntime && stopped && io.existsSync(runtimeAbs)) {
    io.rmSync(runtimeAbs, { recursive: true, force: true });
    runtimeDeleted = true;
  }

  return {
    stopped,
    code: res.code,
    runtimeDir: runtimeAbs,
    runtimeDeleted,
    // Si no se detuvo, el runtime queda EN DISCO a propósito: es la evidencia
    // para el teardown manual.
    runtimePreserved: !runtimeDeleted && io.existsSync(runtimeAbs),
    detail: stopped ? "" : redactSecrets(`${res.stderr || res.stdout}`).slice(-500),
  };
}

// ---------------------------------------------------------------------------
// CLI · lo consume run-recovery-v2.sh. Imprime KEY=VALUE en stdout.
//
// BOOTSTRAP_DB_URL contiene la contraseña del postgres LOCAL efímero. Se emite
// para ser capturado por sustitución de comandos (nunca se muestra en
// terminal); el consumidor NO debe hacerle echo. Los diagnósticos de error van
// a stderr YA redactados.
// ---------------------------------------------------------------------------
export function parseCliArgs(argv) {
  const args = {
    projectId: null, dbPort: null, runtimeDir: null,
    resetRuntime: false, stop: false, removeRuntime: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--project-id") args.projectId = argv[++i];
    else if (a === "--db-port") args.dbPort = Number(argv[++i]);
    else if (a === "--runtime-dir") args.runtimeDir = argv[++i];
    else if (a === "--reset-runtime") args.resetRuntime = true;
    else if (a === "--stop") args.stop = true;
    else if (a === "--remove-runtime") args.removeRuntime = true;
    else throw new BootstrapError(
      STOP.E_SCAFFOLD_FAILED, PHASE.SCAFFOLD, `argumento desconocido: ${a}`,
    );
  }
  // En modo --stop no hay puerto que pedir, pero el project_id SIGUE siendo
  // obligatorio: es lo que acredita que el stack a detener es el propio.
  const required = args.stop
    ? ["projectId", "runtimeDir"]
    : ["projectId", "dbPort", "runtimeDir"];
  for (const k of required) {
    if (args[k] === null || args[k] === undefined || args[k] === "") {
      throw new BootstrapError(
        STOP.E_SCAFFOLD_FAILED, PHASE.SCAFFOLD, `falta argumento obligatorio: --${k}`,
      );
    }
  }
  return args;
}

function cliMain() {
  let args;
  try {
    args = parseCliArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`BOOTSTRAP_ERROR=${e.stopCode || "E_INTERNAL"} ${redactSecrets(String(e.message))}\n`);
    process.exit(2);
  }

  // Modo teardown: mismo owner que el arranque, un solo camino de parada.
  if (args.stop) {
    try {
      const s = stopLocalStack({
        projectId: args.projectId,
        runtimeDir: args.runtimeDir,
        removeRuntime: args.removeRuntime,
      });
      process.stdout.write([
        `BOOTSTRAP_STOPPED=${s.stopped ? "YES" : "NO"}`,
        `BOOTSTRAP_RUNTIME_DELETED=${s.runtimeDeleted ? "YES" : "NO"}`,
        `BOOTSTRAP_RUNTIME_PRESERVED=${s.runtimePreserved ? "YES" : "NO"}`,
        `BOOTSTRAP_RUNTIME_DIR=${s.runtimeDir}`,
        `BOOTSTRAP_PROJECT_ID=${args.projectId}`,
        "",
      ].join("\n"));
      if (!s.stopped) {
        process.stderr.write(`BOOTSTRAP_ERROR=E_TEARDOWN_FAILED\nBOOTSTRAP_DETAIL=${s.detail}\n`);
        process.exit(6);
      }
      process.exit(0);
    } catch (e) {
      const code = e instanceof BootstrapError ? e.stopCode : STOP.E_INTERNAL;
      process.stderr.write(`BOOTSTRAP_ERROR=${code}\nBOOTSTRAP_DETAIL=${redactSecrets(String(e.message || ""))}\n`);
      for (const [k, v] of Object.entries(e instanceof BootstrapError ? e.fields : {})) {
        process.stderr.write(`BOOTSTRAP_${k}=${redactSecrets(String(v))}\n`);
      }
      process.exit(6);
    }
  }

  try {
    const r = bootstrapLocalStack({
      projectId: args.projectId,
      dbPort: args.dbPort,
      runtimeDir: args.runtimeDir,
      resetRuntime: args.resetRuntime,
    });
    process.stdout.write([
      `BOOTSTRAP_PROJECT_ID=${r.projectId}`,
      `BOOTSTRAP_RUNTIME_DIR=${r.runtimeDir}`,
      `BOOTSTRAP_DB_PORT=${r.dbPort}`,
      `BOOTSTRAP_SHADOW_PORT=${r.shadowPort}`,
      `BOOTSTRAP_API_PORT=${r.apiPort}`,
      `BOOTSTRAP_HOST=${r.host}`,
      `BOOTSTRAP_CID=${r.container}`,
      `BOOTSTRAP_CID_DB_URL_SINGLE_SOURCE=YES`,
      `BOOTSTRAP_DB_URL=${r.dbUrl}`,
      "",
    ].join("\n"));
    process.exit(0);
  } catch (e) {
    const code = e instanceof BootstrapError ? e.stopCode : STOP.E_INTERNAL;
    const phase = e instanceof BootstrapError ? e.phase : PHASE.SUPABASE_START;
    const extra = e instanceof BootstrapError ? e.fields : {};
    process.stderr.write(`BOOTSTRAP_ERROR=${code}\nBOOTSTRAP_PHASE=${phase}\n`);
    process.stderr.write(`BOOTSTRAP_DETAIL=${redactSecrets(String(e.message || ""))}\n`);
    for (const [k, v] of Object.entries(extra)) {
      process.stderr.write(`BOOTSTRAP_${k}=${redactSecrets(String(v))}\n`);
    }
    process.exit(3);
  }
}

// Sólo actúa como CLI si se invoca directamente. Importar no ejecuta nada.
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === resolve(fileURLToPath(import.meta.url))) {
  cliMain();
}

// Guarda contra el propio bug que este módulo existe para eliminar: si alguien
// vuelve a tratar el resultado de classifyTarget como string, esto lo delata.
export function assertLocalTarget(connectionString) {
  const c = classifyTarget(connectionString);
  if (c.classification !== "LOCAL") {
    throw new BootstrapError(
      STOP.E_REMOTE_TARGET_DETECTED,
      PHASE.PRECHECK_REMOTE_GUARD,
      `destino no local (${c.reason})`,
      { ACTUAL: `host=${c.host ?? "?"}` },
    );
  }
  return c;
}
