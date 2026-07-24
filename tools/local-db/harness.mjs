#!/usr/bin/env node
// TC-LOCAL-DB-RLS-HARNESS-01
// harness.mjs — Orquestador fail-closed del harness local de DB/RLS.
//
// Ejecuta SOLO contra Supabase/PostgreSQL LOCAL (Docker). Nunca remoto.
// Consume artefactos existentes (migraciones, supabase/tests/*.sql, contratos
// .mjs). No modifica supabase/**, app/** ni tools/run-contract-tests.mjs.
//
// Uso:
//   node tools/local-db/harness.mjs [--dry-run] [--keep-up] [--db-port N]
//
// Salida: escribe artefactos en tools/local-db/.artifacts/<timestamp>/ e imprime
// el reporte estructurado en stdout. Exit code != 0 ante cualquier fallo.

import { spawnSync } from "node:child_process";
import {
  mkdirSync, writeFileSync, readdirSync, existsSync, rmSync, symlinkSync, realpathSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  STOP, PHASE, EXIT_CODES, buildReport, renderReportText, checkNodeMajor, checkMacOS,
  classifyTarget, inspectEnvForRemote, checkScope,
} from "./lib/guards.mjs";
import {
  parseSupabaseStatusDbUrl, orderMigrations, parseRlsMatrixOutput, evaluateSecurityDefiner,
} from "./lib/parse.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const RUNTIME_DIR = join(REPO_ROOT, "tools", "local-db", ".runtime");
const RUNTIME_SUPABASE = join(RUNTIME_DIR, "supabase");
const MIGRATIONS_SRC = join(REPO_ROOT, "supabase", "migrations");
const TESTS_SRC = join(REPO_ROOT, "supabase", "tests");

// Tablas internas que DEBEN quedar inaccesibles para anon vía Data API.
const INTERNAL_TABLES = [
  "perfiles", "tickets", "clientes", "clientes_contactos", "cliente_sistemas",
  "cliente_aliases", "solicitudes_soporte", "bitacora", "rate_limit_events",
  "ticket_eventos", "archivos_ticket", "ticket_match_decisiones",
];

// ---------------------------------------------------------------------------
// Utilidades de proceso e higiene de secretos.
// ---------------------------------------------------------------------------
function redact(text) {
  if (typeof text !== "string") return text;
  // Oculta credenciales embebidas en DSN PostgreSQL y tokens largos.
  return text
    .replace(/(postgres(?:ql)?:\/\/[^:@\s]+:)([^@\s]+)(@)/gi, "$1***$3")
    .replace(/(password\s*=\s*)([^\s;]+)/gi, "$1***")
    .replace(/(eyJ[A-Za-z0-9_-]{6,})\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "***JWT***");
}

function run(cmd, args, opts = {}) {
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
    error: res.error ? String(res.error.message) : null,
  };
}

function which(bin) {
  const r = run("bash", ["-lc", `command -v ${bin} || true`]);
  return r.stdout.trim();
}

class HarnessStop extends Error {
  constructor(fields) {
    super(fields.STOP_REASON_DETAIL || fields.STOP_REASON_CODE);
    this.fields = fields;
  }
}
function stop(code, phase, detail, extra = {}) {
  throw new HarnessStop({
    STOP_REASON_CODE: code,
    FAILED_PHASE: phase,
    STOP_REASON_DETAIL: redact(detail || ""),
    ...extra,
  });
}

// ---------------------------------------------------------------------------
// Estado de artefactos.
// ---------------------------------------------------------------------------
function makeArtifactsDir() {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = join(REPO_ROOT, "tools", "local-db", ".artifacts", ts);
  mkdirSync(dir, { recursive: true });
  return dir;
}
function artifact(dir, name, content) {
  writeFileSync(join(dir, name), content);
}

// ---------------------------------------------------------------------------
// FASES
// ---------------------------------------------------------------------------
function precheckHost(ctx) {
  const mac = checkMacOS(process.platform);
  if (!mac.ok) stop(STOP.E_HOST_NOT_MACOS, PHASE.PRECHECK_HOST, `plataforma=${process.platform}`, { EXPECTED: "darwin", ACTUAL: process.platform });

  const node = checkNodeMajor(process.version, 22);
  if (!node.ok) stop(STOP.E_NODE_VERSION, PHASE.PRECHECK_HOST, `node=${process.version}`, { EXPECTED: ">=22", ACTUAL: String(node.actual) });

  if (!which("docker")) stop(STOP.E_DOCKER_MISSING, PHASE.PRECHECK_HOST, "docker no encontrado en PATH", { FAILED_COMMAND: "command -v docker" });
  const dockerInfo = run("docker", ["info"], { timeout: 30000 });
  if (dockerInfo.code !== 0) stop(STOP.E_DOCKER_NOT_RUNNING, PHASE.PRECHECK_HOST, "docker daemon no responde", { FAILED_COMMAND: "docker info" });

  if (!which("supabase")) stop(STOP.E_SUPABASE_CLI_MISSING, PHASE.PRECHECK_HOST, "supabase CLI no encontrado", { FAILED_COMMAND: "command -v supabase" });
  const ver = run("supabase", ["--version"], { timeout: 30000 });
  ctx.log.push(`supabase_version=${ver.stdout.trim()}`);
  ctx.log.push(`node_version=${process.version}`);
}

function precheckRepo(ctx) {
  const inside = run("git", ["rev-parse", "--is-inside-work-tree"]);
  if (inside.stdout.trim() !== "true") {
    stop(STOP.E_NOT_GIT_WORKTREE, PHASE.PRECHECK_REPO, "no es worktree git", { FAILED_COMMAND: "git rev-parse --is-inside-work-tree" });
  }
  const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim();
  const head = run("git", ["rev-parse", "HEAD"]).stdout.trim();
  ctx.branch = branch;
  ctx.head = head;
  ctx.log.push(`branch=${branch}`, `head=${head}`);
  // Rama esperada del ticket: prefijo test/. Advertencia dura si no coincide.
  if (!branch.startsWith("test/")) {
    stop(STOP.E_WRONG_BRANCH, PHASE.PRECHECK_REPO, `rama inesperada: ${branch}`, { EXPECTED: "test/*", ACTUAL: branch });
  }
}

function precheckRemoteGuard(ctx) {
  const findings = inspectEnvForRemote(process.env);
  if (findings.length > 0) {
    const f = findings[0];
    stop(f.code, PHASE.PRECHECK_REMOTE_GUARD, `env remota detectada: ${f.var} (${f.reason})`, {
      FAILED_COMMAND: `env:${f.var}`,
      EXPECTED: "sin destinos remotos",
      ACTUAL: `${f.var}=<redactado> host=${f.host ?? "?"}`,
      DO_NOT_RUN: "supabase remoto | psql remoto | link | db push",
    });
  }
  ctx.log.push("remote_guard=OK (sin env remota)");
}

function precheckScopeGuard(ctx) {
  const porcelain = run("git", ["status", "--porcelain"]).stdout;
  const changed = porcelain
    .split("\n").map((l) => l.trim()).filter(Boolean)
    .map((l) => l.replace(/^\S+\s+/, "").replace(/^.*->\s*/, ""));
  const scope = checkScope(changed);
  if (!scope.ok) {
    const v = scope.violations[0];
    stop(STOP.E_SCOPE_VIOLATION, PHASE.PRECHECK_SCOPE_GUARD, `ruta fuera de alcance: ${v.path} (${v.reason})`, {
      EXPECTED: "solo tools/local-db/ y test/local-db/",
      ACTUAL: v.path,
    });
  }
  ctx.log.push(`scope_guard=OK (${changed.length} rutas modificadas dentro de alcance)`);
}

function scaffold(ctx) {
  // Workdir supabase efímero: NO se toca supabase/**; se enlazan migraciones.
  try {
    if (existsSync(RUNTIME_SUPABASE)) rmSync(RUNTIME_SUPABASE, { recursive: true, force: true });
    mkdirSync(RUNTIME_SUPABASE, { recursive: true });
    const dbPort = ctx.dbPort;
    const config = [
      `# GENERADO por harness (efímero). No editar a mano.`,
      `project_id = "tc_local_db_harness"`,
      ``,
      `[db]`,
      `port = ${dbPort}`,
      `shadow_port = ${dbPort + 1}`,
      `major_version = 15`,
      ``,
      `[api]`,
      `enabled = true`,
      `port = ${dbPort + 100}`,
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
    writeFileSync(join(RUNTIME_SUPABASE, "config.toml"), config);
    // Enlace simbólico a las migraciones reales (sin duplicar).
    symlinkSync(MIGRATIONS_SRC, join(RUNTIME_SUPABASE, "migrations"));
    ctx.log.push(`scaffold=OK (workdir efímero, db_port=${dbPort}, migraciones enlazadas)`);
  } catch (e) {
    stop(STOP.E_SCAFFOLD_FAILED, PHASE.SCAFFOLD, `no se pudo preparar workdir: ${e.message}`);
  }
}

function supabaseStart(ctx) {
  const res = run("supabase", ["start", "--workdir", RUNTIME_DIR], { timeout: 600000 });
  if (res.code !== 0) {
    stop(STOP.E_SUPABASE_START_FAILED, PHASE.SUPABASE_START, "supabase start falló", {
      FAILED_COMMAND: "supabase start --workdir <runtime>",
      ACTUAL: redact(res.stderr || res.stdout).slice(-800),
    });
  }
  const status = run(
    "supabase",
    ["status", "-o", "env", "--workdir", RUNTIME_DIR],
  );
  if (status.code !== 0) {
    stop(
      STOP.E_SUPABASE_START_FAILED,
      PHASE.SUPABASE_START,
      "supabase status estructurado falló",
      {
        FAILED_COMMAND:
          "supabase status -o env --workdir <runtime>",
        ACTUAL:
          `exit=${status.code}; salida omitida porque contiene credenciales locales`,
      },
    );
  }
  const parsed = parseSupabaseStatusDbUrl(
    `${status.stdout}\n${status.stderr}`,
  );
  if (!parsed) {
    stop(
      STOP.E_SUPABASE_START_FAILED,
      PHASE.SUPABASE_START,
      "no se pudo leer DB URL local desde salida estructurada",
      {
        FAILED_COMMAND:
          "supabase status -o env --workdir <runtime>",
        ACTUAL:
          "DB_URL ausente o no reconocida; salida omitida por seguridad",
      },
    );
  }
  // GUARDA CRÍTICA: el target DEBE ser local. Nunca remoto.
  if (parsed.classification !== "LOCAL") {
    stop(STOP.E_REMOTE_TARGET_DETECTED, PHASE.SUPABASE_START, `DB URL no local (${parsed.reason})`, {
      EXPECTED: "host local (127.0.0.1/localhost)",
      ACTUAL: `host=${parsed.host ?? "?"}`,
      DO_NOT_RUN: "psql remoto | supabase remoto",
    });
  }
  ctx.dbUrl = parsed.url;
  ctx.localStatus = "up";
  ctx.log.push(`supabase_start=OK (host=${parsed.host})`);
}

// psql local con guarda de destino en cada invocación.
function psql(ctx, { file = null, sql = null, args = [] } = {}) {
  const c = classifyTarget(ctx.dbUrl);
  if (c.classification !== "LOCAL") {
    stop(STOP.E_REMOTE_TARGET_DETECTED, PHASE.RLS_MATRIX, "intento de psql contra host no local", { ACTUAL: `host=${c.host ?? "?"}` });
  }
  const base = [ctx.dbUrl, "-v", "ON_ERROR_STOP=1", "-X", "-q", "--no-psqlrc", ...args];
  if (file) base.push("-f", file);
  if (sql) base.push("-c", sql);
  return run("psql", base, { timeout: 180000 });
}

function dbResetApply(ctx) {
  // supabase db reset aplica TODAS las migraciones en orden sobre la db local.
  const res = run("supabase", ["db", "reset", "--workdir", RUNTIME_DIR], { timeout: 600000 });
  const combined = `${res.stdout}\n${res.stderr}`;
  if (res.code !== 0) {
    // Detectar la migración señalada por el error.
    const failed = detectFailedMigration(combined);
    stop(STOP.E_MIGRATION_FAILED, PHASE.DB_RESET_APPLY, "fallo al aplicar migraciones", {
      FAILED_COMMAND: "supabase db reset --workdir <runtime>",
      FAILED_MIGRATION: failed || "-",
      ACTUAL: redact(combined).slice(-800),
    });
  }
  ctx.log.push("db_reset=OK (migraciones aplicadas en orden)");
}

function detectFailedMigration(text) {
  // Supabase imprime "Applying migration <archivo>..." antes del error.
  const lines = text.split("\n");
  let last = null;
  for (const l of lines) {
    const m = l.match(/Applying migration\s+(\S+\.sql)/i);
    if (m) last = m[1];
  }
  return last;
}

function migrationsInventory(ctx) {
  const files = orderMigrations(readdirSync(MIGRATIONS_SRC));
  ctx.migrations = files;
  return files;
}

function schemaCheck(ctx) {
  // supabase db diff: si hay drift entre migraciones y estado aplicado, reporta.
  const res = run("supabase", ["db", "diff", "--workdir", RUNTIME_DIR, "--schema", "public"], { timeout: 300000 });
  const out = `${res.stdout}\n${res.stderr}`;
  ctx.schemaDiff = redact(out);
  // Un diff con contenido de DDL indica inconsistencia migración/esquema.
  const hasDrift = /create |alter |drop /i.test(res.stdout) && !/no schema changes|no changes/i.test(out);
  if (res.code !== 0 && !/no changes/i.test(out)) {
    stop(STOP.E_SCHEMA_DIFF, PHASE.SCHEMA_CHECK, "supabase db diff falló", { FAILED_COMMAND: "supabase db diff", ACTUAL: redact(out).slice(-600) });
  }
  if (hasDrift) {
    stop(STOP.E_SCHEMA_DIFF, PHASE.SCHEMA_CHECK, "drift de esquema detectado", { ACTUAL: "diff con DDL no vacío" });
  }
  ctx.log.push("schema_check=OK (sin drift)");
}

function idempotencyCheck(ctx) {
  // Nombre histórico conservado por compatibilidad con PHASE/STOP.
  // Las migraciones de baseline son deliberadamente estrictas y no
  // deben reaplicarse encima del esquema ya construido. La propiedad
  // verificable es reproducibilidad: dos resets limpios consecutivos.
  const res = run(
    "supabase",
    ["db", "reset", "--workdir", RUNTIME_DIR],
    { timeout: 600000 },
  );
  const combined = `${res.stdout}\n${res.stderr}`;

  if (res.code !== 0) {
    const failed = detectFailedMigration(combined);

    stop(
      STOP.E_MIGRATION_NOT_IDEMPOTENT,
      PHASE.IDEMPOTENCY_CHECK,
      "segunda reconstrucción limpia falló",
      {
        FAILED_COMMAND:
          "supabase db reset --workdir <runtime> (segunda ejecución)",
        FAILED_MIGRATION: failed || "-",
        ACTUAL: redact(combined).slice(-800),
      },
    );
  }

  // Vuelve a comprobar que el segundo estado reconstruido coincide
  // completamente con el esquema derivado de las migraciones.
  schemaCheck(ctx);

  ctx.migrationResults = ctx.migrations.map((migration) => ({
    migration,
    applied: true,
    reproducible: true,
  }));

  ctx.log.push(
    "reproducibility=OK "
    + "(segunda reconstrucción limpia y sin drift)",
  );
}

function anonPrivilegeProbe(ctx) {
  // anon NO debe tener ningún privilegio de tabla sobre tablas internas.
  const checks = INTERNAL_TABLES.map(
    (t) => `select '${t}' as tabla, ` +
      `has_table_privilege('anon','public.${t}','SELECT') as sel, ` +
      `has_table_privilege('anon','public.${t}','INSERT') as ins, ` +
      `has_table_privilege('anon','public.${t}','UPDATE') as upd, ` +
      `has_table_privilege('anon','public.${t}','DELETE') as del`
  ).join(" union all ");
  const res = psql(ctx, { sql: checks, args: ["-A", "-F,", "-t"] });
  if (res.code !== 0) {
    stop(STOP.E_INTERNAL, PHASE.POLICY_INVENTORY, "probe anon falló", { ACTUAL: redact(res.stderr).slice(-400) });
  }
  const leaks = [];
  for (const line of res.stdout.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const [tabla, sel, ins, upd, del] = line.split(",");
    if ([sel, ins, upd, del].some((v) => v === "t" || v === "true")) leaks.push(tabla);
  }
  if (leaks.length > 0) {
    stop(STOP.E_ANON_LEAK, PHASE.POLICY_INVENTORY, `anon tiene privilegios en tablas internas: ${leaks.join(", ")}`, {
      FAILED_ROLE: "anon",
      EXPECTED: "anon sin privilegios de tabla",
      ACTUAL: leaks.join(", "),
    });
  }
  ctx.log.push("anon_probe=OK (sin privilegios en tablas internas)");
}

function policyInventory(ctx, dir) {
  // Exporta snapshot y lo pasa al gate existente (no reimplementa la lógica).
  const snapPath = join(dir, "policy_snapshot.json");
  const exportSql =
    `select coalesce(json_agg(row_to_json(p)),'[]'::json) from (` +
    `select schemaname, tablename, policyname, cmd, permissive, roles, qual, with_check ` +
    `from pg_policies where schemaname='public' order by tablename, policyname) p;`;
  const res = psql(ctx, { sql: exportSql, args: ["-A", "-t"] });
  if (res.code !== 0) {
    stop(STOP.E_POLICY_MISSING, PHASE.POLICY_INVENTORY, "no se pudo exportar snapshot de policies", { ACTUAL: redact(res.stderr).slice(-400) });
  }
  writeFileSync(snapPath, res.stdout.trim() + "\n");
  const gate = run("node", [join(REPO_ROOT, "tools", "policy-inventory-gate.mjs"), REPO_ROOT], {
    env: { ...process.env, POLICY_SNAPSHOT: snapPath },
  });
  if (gate.code !== 0) {
    stop(STOP.E_POLICY_MISSING, PHASE.POLICY_INVENTORY, "policy-inventory-gate FAIL", {
      FAILED_COMMAND: "node tools/policy-inventory-gate.mjs",
      ACTUAL: redact(gate.stdout + gate.stderr).slice(-500),
    });
  }
  ctx.log.push("policy_inventory=OK");
}

function securityDefinerCheck(ctx, dir) {
  const f = join(TESTS_SRC, "security_definer_preflight.sql");
  if (!existsSync(f)) {
    ctx.log.push("security_definer=SKIP (preflight ausente)");
    return;
  }
  const res = psql(ctx, { file: f, args: ["-A", "-t"] });
  // Extraer el bloque JSON del inventario.
  const jsonMatch = res.stdout.match(/\[[\s\S]*\]/);
  let inventory = [];
  try { inventory = jsonMatch ? JSON.parse(jsonMatch[0]) : []; } catch { inventory = []; }
  const evalSd = evaluateSecurityDefiner(inventory);
  writeFileSync(join(dir, "security-definer.json"), JSON.stringify(inventory, null, 2) + "\n");
  if (evalSd.searchPathUnpinned.length > 0) {
    stop(STOP.E_SEARCH_PATH_UNPINNED, PHASE.SECURITY_DEFINER_CHECK, `search_path no fijado: ${evalSd.searchPathUnpinned.join(", ")}`, {
      FAILED_POLICY: evalSd.searchPathUnpinned[0],
      ACTUAL: evalSd.searchPathUnpinned.join(", "),
    });
  }
  if (!evalSd.ok) {
    stop(STOP.E_SECURITY_DEFINER_UNSAFE, PHASE.SECURITY_DEFINER_CHECK, `SECURITY DEFINER inseguro: ${JSON.stringify(evalSd.unsafe.slice(0, 3))}`, {
      FAILED_POLICY: evalSd.unsafe[0]?.identity ?? "-",
      ACTUAL: evalSd.unsafe.map((u) => `${u.identity}:${u.issue}`).join("; "),
    });
  }
  ctx.log.push(`security_definer=OK (${inventory.length} funciones evaluadas)`);
}

function rlsMatrix(ctx, dir) {
  const f = join(TESTS_SRC, "authz_negative.sql");
  if (!existsSync(f)) {
    stop(STOP.E_RLS_MATRIX_FAILED, PHASE.RLS_MATRIX, "authz_negative.sql ausente (matriz requerida)", {});
  }
  const res = psql(ctx, { file: f });
  const parsed = parseRlsMatrixOutput(res);
  // rls-matrix.csv
  const rows = [["assertion", "result"]];
  for (const p of parsed.passes) rows.push([JSON.stringify(p), "PASS"]);
  if (parsed.failLine) rows.push([JSON.stringify(parsed.failLine), "FAIL"]);
  ctx.rlsMatrixCsv = rows.map((r) => r.join(",")).join("\n") + "\n";

  if (!parsed.ok) {
    // Mapear la clase de fuga a un código específico.
    const line = (parsed.failLine || "").toLowerCase();
    let code = STOP.E_RLS_MATRIX_FAILED;
    if (line.includes("anon")) code = STOP.E_ANON_LEAK;
    else if (line.includes("rol") || line.includes("escal")) code = STOP.E_PRIVILEGE_ESCALATION;
    else if (line.includes("cliente") || line.includes("ticket de a") || line.includes("ajen")) code = STOP.E_CROSS_TENANT_LEAK;
    stop(code, PHASE.RLS_MATRIX, `matriz RLS negativa falló: ${parsed.failLine}`, {
      FAILED_ROLE: parsed.failedRole || "-",
      ACTUAL: parsed.failLine || "sin PASS suficientes",
    });
  }

  // Idempotencia de concurrencia (si existe).
  const idem = join(TESTS_SRC, "idempotency_concurrency.sql");
  if (existsSync(idem)) {
    const r2 = psql(ctx, { file: idem });
    if (r2.code !== 0) {
      stop(STOP.E_RLS_MATRIX_FAILED, PHASE.RLS_MATRIX, "idempotency_concurrency falló", { ACTUAL: redact(r2.stderr).slice(-400) });
    }
  }
  ctx.log.push(`rls_matrix=OK (${parsed.passes.length} aserciones PASS)`);
}

function contracts(ctx, dir) {
  const res = run("node", ["--experimental-strip-types", join(REPO_ROOT, "tools", "run-contract-tests.mjs"), REPO_ROOT], { timeout: 180000 });
  const out = redact(`${res.stdout}\n${res.stderr}`);
  writeFileSync(join(dir, "contract-results.txt"), out);
  if (res.code !== 0) {
    stop(STOP.E_CONTRACTS_FAILED, PHASE.CONTRACTS, "contratos .mjs fallaron", {
      FAILED_COMMAND: "node tools/run-contract-tests.mjs",
      ACTUAL: out.slice(-500),
    });
  }
  ctx.log.push("contracts=OK");
}

function teardown(ctx) {
  if (ctx.keepUp) { ctx.log.push("teardown=SKIP (--keep-up)"); return; }
  if (ctx.localStatus === "up") {
    run("supabase", ["stop", "--workdir", RUNTIME_DIR], { timeout: 120000 });
    ctx.localStatus = "stopped";
    ctx.log.push("teardown=OK (supabase local detenido)");
  }
}

// ---------------------------------------------------------------------------
// Escritura de artefactos finales.
// ---------------------------------------------------------------------------
function writeArtifacts(dir, ctx, report) {
  artifact(dir, "00_FINAL_RESULT.txt", renderReportText(report));

  const migCsv = ["migration,applied,reproducible"]
    .concat((ctx.migrationResults || ctx.migrations || []).map((m) =>
      typeof m === "string"
        ? `${m},${report.RESULT === "PASS"},unknown`
        : `${m.migration},${m.applied},${m.reproducible}`))
    .join("\n") + "\n";
  artifact(dir, "migration-results.csv", migCsv);

  artifact(dir, "rls-matrix.csv", ctx.rlsMatrixCsv || "assertion,result\n");
  artifact(dir, "schema-diff.txt", ctx.schemaDiff || "(sin diff capturado)\n");
  if (!existsSync(join(dir, "contract-results.txt"))) {
    artifact(dir, "contract-results.txt", "(contratos no ejecutados)\n");
  }
  artifact(dir, "harness.log", ctx.log.join("\n") + "\n");
  artifact(dir, "rollback-local-reset.md", rollbackDoc(ctx));
}

function rollbackDoc(ctx) {
  return [
    "# Rollback / Local Reset — TC-LOCAL-DB-RLS-HARNESS-01",
    "",
    "Este harness solo afecta un Supabase LOCAL efímero (Docker). No toca remoto.",
    "",
    "## Detener y limpiar el entorno local",
    "```bash",
    "supabase stop --workdir tools/local-db/.runtime",
    "# Elimizar contenedores/volúmenes del proyecto local si quedaron:",
    "supabase stop --workdir tools/local-db/.runtime --no-backup",
    "```",
    "",
    "## Re-aplicar migraciones desde cero (local)",
    "```bash",
    "supabase db reset --workdir tools/local-db/.runtime",
    "```",
    "",
    "## Limpiar scaffolding efímero",
    "```bash",
    "rm -rf tools/local-db/.runtime",
    "```",
    "",
    "## Qué NO hacer",
    "- No `supabase link`, `db push`, `db pull` ni psql contra host remoto.",
    "- No aplicar SQL a staging/producción.",
    "- No commit/push/PR/merge/deploy sin autorización explícita.",
    "",
    `branch=${ctx.branch || "?"}`,
    `head=${ctx.head || "?"}`,
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = { dryRun: false, keepUp: false, dbPort: 54329 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--keep-up") args.keepUp = true;
    else if (a === "--db-port") args.dbPort = Number(argv[++i]);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const ctx = { log: [], dbPort: args.dbPort, keepUp: args.keepUp, localStatus: "down" };
  const dir = makeArtifactsDir();
  ctx.artifactsDir = dir;

  let report;
  try {
    precheckHost(ctx);
    precheckRepo(ctx);
    precheckRemoteGuard(ctx);
    precheckScopeGuard(ctx);

    if (args.dryRun) {
      migrationsInventory(ctx);
      ctx.log.push(`dry_run=OK (${ctx.migrations.length} migraciones detectadas; sin ejecutar Docker)`);
      report = buildReport({
        STOP_REASON_CODE: STOP.OK,
        FAILED_PHASE: "-",
        LOCAL_SUPABASE_STATUS: "not-started(dry-run)",
        OUTPUT: dir,
        STOP_REASON_DETAIL: "dry-run: prechecks fail-closed superados",
      });
      writeArtifacts(dir, ctx, report);
      finish(report, dir, ctx);
      return;
    }

    scaffold(ctx);
    supabaseStart(ctx);
    migrationsInventory(ctx);
    dbResetApply(ctx);
    schemaCheck(ctx);
    idempotencyCheck(ctx);
    anonPrivilegeProbe(ctx);
    policyInventory(ctx, dir);
    securityDefinerCheck(ctx, dir);
    rlsMatrix(ctx, dir);
    contracts(ctx, dir);

    report = buildReport({
      STOP_REASON_CODE: STOP.OK,
      FAILED_PHASE: "-",
      LOCAL_SUPABASE_STATUS: ctx.localStatus,
      OUTPUT: dir,
      STOP_REASON_DETAIL: "todas las fases superadas",
    });
  } catch (e) {
    const fields = e instanceof HarnessStop ? e.fields : { STOP_REASON_CODE: STOP.E_INTERNAL, FAILED_PHASE: "UNKNOWN", STOP_REASON_DETAIL: redact(String(e.message)) };
    report = buildReport({ ...fields, LOCAL_SUPABASE_STATUS: ctx.localStatus, OUTPUT: dir });
  } finally {
    try { teardown(ctx); } catch { /* teardown best-effort */ }
    if (report) report.LOCAL_SUPABASE_STATUS = ctx.localStatus;
  }

  writeArtifacts(dir, ctx, report);
  finish(report, dir, ctx);
}

function finish(report, dir, ctx) {
  process.stdout.write("\n===== 00_FINAL_RESULT =====\n");
  process.stdout.write(renderReportText(report));
  process.stdout.write(`ARTIFACTS_DIR=${dir}\n`);
  process.exit(report.SCRIPT_EXIT_CODE);
}

// Export para pruebas del propio harness (no ejecuta main al importar).
export { parseArgs, redact, detectFailedMigration, rollbackDoc, INTERNAL_TABLES };

const isMain = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((e) => {
    const report = buildReport({ STOP_REASON_CODE: STOP.E_INTERNAL, FAILED_PHASE: "UNKNOWN", STOP_REASON_DETAIL: redact(String(e && e.message)) });
    process.stdout.write(renderReportText(report));
    process.exit(EXIT_CODES[STOP.E_INTERNAL]);
  });
}
