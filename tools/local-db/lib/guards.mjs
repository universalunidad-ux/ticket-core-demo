// TC-LOCAL-DB-RLS-HARNESS-01
// guards.mjs — Lógica pura, fail-closed y única del harness local.
//
// Este módulo NO ejecuta comandos ni toca la red. Contiene únicamente las
// decisiones de seguridad (¿es remoto?, ¿viola alcance?, ¿qué código de parada?)
// para que el orquestador (harness.mjs) y las pruebas (test/local-db) compartan
// exactamente la misma verdad. Regla base: ante la duda, DENEGAR.
//
// No se importa nada de red ni de fs con efectos: solo funciones puras.

// ---------------------------------------------------------------------------
// Taxonomía de códigos de parada (STOP_REASON_CODE).
// Todo fallo del harness debe mapear a UNO de estos códigos.
// ---------------------------------------------------------------------------
export const STOP = Object.freeze({
  OK: "OK",
  // Precondiciones del host
  E_HOST_NOT_MACOS: "E_HOST_NOT_MACOS",
  E_NODE_VERSION: "E_NODE_VERSION",
  E_DOCKER_MISSING: "E_DOCKER_MISSING",
  E_DOCKER_NOT_RUNNING: "E_DOCKER_NOT_RUNNING",
  E_SUPABASE_CLI_MISSING: "E_SUPABASE_CLI_MISSING",
  E_NOT_GIT_WORKTREE: "E_NOT_GIT_WORKTREE",
  E_WRONG_BRANCH: "E_WRONG_BRANCH",
  E_WRONG_HEAD: "E_WRONG_HEAD",
  // Guardas anti-remoto / anti-producción
  E_REMOTE_TARGET_DETECTED: "E_REMOTE_TARGET_DETECTED",
  E_REMOTE_ENV_PRESENT: "E_REMOTE_ENV_PRESENT",
  E_SUPABASE_LINKED_PROJECT: "E_SUPABASE_LINKED_PROJECT",
  // Guarda de alcance (scope)
  E_SCOPE_VIOLATION: "E_SCOPE_VIOLATION",
  // Fases de ejecución local
  E_SCAFFOLD_FAILED: "E_SCAFFOLD_FAILED",
  E_SUPABASE_START_FAILED: "E_SUPABASE_START_FAILED",
  E_RESET_FAILED: "E_RESET_FAILED",
  E_MIGRATION_FAILED: "E_MIGRATION_FAILED",
  E_MIGRATION_NOT_IDEMPOTENT: "E_MIGRATION_NOT_IDEMPOTENT",
  E_SCHEMA_DIFF: "E_SCHEMA_DIFF",
  E_POLICY_MISSING: "E_POLICY_MISSING",
  E_ANON_LEAK: "E_ANON_LEAK",
  E_PRIVILEGE_ESCALATION: "E_PRIVILEGE_ESCALATION",
  E_CROSS_TENANT_LEAK: "E_CROSS_TENANT_LEAK",
  E_RLS_MATRIX_FAILED: "E_RLS_MATRIX_FAILED",
  E_SECURITY_DEFINER_UNSAFE: "E_SECURITY_DEFINER_UNSAFE",
  E_SEARCH_PATH_UNPINNED: "E_SEARCH_PATH_UNPINNED",
  E_CONTRACTS_FAILED: "E_CONTRACTS_FAILED",
  // Genéricos
  E_INTERNAL: "E_INTERNAL",
});

// Mapa código -> exit code del proceso. 0 sólo para OK.
// Rango 10-49 precondiciones, 50-69 remoto/scope, 70-99 fases.
export const EXIT_CODES = Object.freeze({
  [STOP.OK]: 0,
  [STOP.E_HOST_NOT_MACOS]: 10,
  [STOP.E_NODE_VERSION]: 11,
  [STOP.E_DOCKER_MISSING]: 12,
  [STOP.E_DOCKER_NOT_RUNNING]: 13,
  [STOP.E_SUPABASE_CLI_MISSING]: 14,
  [STOP.E_NOT_GIT_WORKTREE]: 15,
  [STOP.E_WRONG_BRANCH]: 16,
  [STOP.E_WRONG_HEAD]: 17,
  [STOP.E_REMOTE_TARGET_DETECTED]: 50,
  [STOP.E_REMOTE_ENV_PRESENT]: 51,
  [STOP.E_SUPABASE_LINKED_PROJECT]: 52,
  [STOP.E_SCOPE_VIOLATION]: 55,
  [STOP.E_SCAFFOLD_FAILED]: 70,
  [STOP.E_SUPABASE_START_FAILED]: 71,
  [STOP.E_RESET_FAILED]: 72,
  [STOP.E_MIGRATION_FAILED]: 73,
  [STOP.E_MIGRATION_NOT_IDEMPOTENT]: 74,
  [STOP.E_SCHEMA_DIFF]: 75,
  [STOP.E_POLICY_MISSING]: 76,
  [STOP.E_ANON_LEAK]: 77,
  [STOP.E_PRIVILEGE_ESCALATION]: 78,
  [STOP.E_CROSS_TENANT_LEAK]: 79,
  [STOP.E_RLS_MATRIX_FAILED]: 80,
  [STOP.E_SECURITY_DEFINER_UNSAFE]: 81,
  [STOP.E_SEARCH_PATH_UNPINNED]: 82,
  [STOP.E_CONTRACTS_FAILED]: 83,
  [STOP.E_INTERNAL]: 99,
});

// Fases nombradas (FAILED_PHASE).
export const PHASE = Object.freeze({
  PRECHECK_HOST: "PRECHECK_HOST",
  PRECHECK_REPO: "PRECHECK_REPO",
  PRECHECK_REMOTE_GUARD: "PRECHECK_REMOTE_GUARD",
  PRECHECK_SCOPE_GUARD: "PRECHECK_SCOPE_GUARD",
  SCAFFOLD: "SCAFFOLD",
  SUPABASE_START: "SUPABASE_START",
  DB_RESET_APPLY: "DB_RESET_APPLY",
  MIGRATIONS_ORDERED: "MIGRATIONS_ORDERED",
  SCHEMA_CHECK: "SCHEMA_CHECK",
  IDEMPOTENCY_CHECK: "IDEMPOTENCY_CHECK",
  POLICY_INVENTORY: "POLICY_INVENTORY",
  SECURITY_DEFINER_CHECK: "SECURITY_DEFINER_CHECK",
  RLS_MATRIX: "RLS_MATRIX",
  CONTRACTS: "CONTRACTS",
  REPORT: "REPORT",
  DONE: "DONE",
});

// ---------------------------------------------------------------------------
// Allowlist de hosts locales. Cualquier host fuera de esta lista => REMOTO.
// ---------------------------------------------------------------------------
export const LOCAL_HOST_ALLOWLIST = Object.freeze([
  "127.0.0.1",
  "localhost",
  "::1",
  "[::1]",
  "0.0.0.0",
  "host.docker.internal",
]);

// Sufijos/fragmentos que marcan un host como remoto gestionado (Supabase/nube).
const REMOTE_HOST_MARKERS = Object.freeze([
  "supabase.co",
  "supabase.com",
  "supabase.in",
  "supabase.net",
  "pooler.supabase.com",
  "amazonaws.com",
  "rds.amazonaws.com",
  "neon.tech",
  "render.com",
  "railway.app",
  "fly.dev",
]);

/**
 * ¿El hostname corresponde a un destino local permitido?
 * Estricto: normaliza, quita corchetes IPv6 y compara contra la allowlist.
 */
export function isLocalHost(hostname) {
  if (typeof hostname !== "string" || hostname.trim() === "") return false;
  const h = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (LOCAL_HOST_ALLOWLIST.map((x) => x.replace(/^\[|\]$/g, "")).includes(h)) {
    return true;
  }
  // 127.0.0.0/8 loopback explícito.
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  return false;
}

/**
 * Extrae el hostname de una cadena de conexión (URL o DSN de libpq).
 * Devuelve null si no se puede determinar (se trata como sospechoso aguas arriba).
 */
export function extractHost(connectionString) {
  if (typeof connectionString !== "string") return null;
  const raw = connectionString.trim();
  if (raw === "") return null;

  // Admite formatos URL PostgreSQL y DSN por pares clave-valor.
  const urlMatch = raw.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//);
  if (urlMatch) {
    try {
      // URL no acepta esquema postgres directamente en todos los runtimes;
      // normalizamos a http para parsear authority de forma segura.
      const normalized = raw.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, "http://");
      const u = new URL(normalized);
      return u.hostname || null;
    } catch {
      return null;
    }
  }

  // Formato DSN key=value: host=... o hostaddr=...
  const kv = raw.match(/\bhost(?:addr)?\s*=\s*("([^"]*)"|'([^']*)'|([^\s]+))/i);
  if (kv) {
    return (kv[2] ?? kv[3] ?? kv[4] ?? "").trim() || null;
  }
  return null;
}

/**
 * Clasifica una cadena de conexión como LOCAL o REMOTO (fail-closed).
 * - Vacío/indeterminado => REMOTO (no se puede probar que es local).
 * - Marcador de nube conocido => REMOTO.
 * - Host fuera de la allowlist => REMOTO.
 * @returns {{classification: "LOCAL"|"REMOTE", host: string|null, reason: string}}
 */
export function classifyTarget(connectionString) {
  if (typeof connectionString !== "string" || connectionString.trim() === "") {
    return { classification: "REMOTE", host: null, reason: "target_vacio_o_indeterminado" };
  }
  const lower = connectionString.toLowerCase();
  for (const marker of REMOTE_HOST_MARKERS) {
    if (lower.includes(marker)) {
      return { classification: "REMOTE", host: extractHost(connectionString), reason: `marcador_remoto:${marker}` };
    }
  }
  const host = extractHost(connectionString);
  if (host === null) {
    return { classification: "REMOTE", host: null, reason: "host_indeterminado" };
  }
  if (isLocalHost(host)) {
    return { classification: "LOCAL", host, reason: "host_en_allowlist" };
  }
  return { classification: "REMOTE", host, reason: "host_fuera_de_allowlist" };
}

/**
 * Revisa variables de entorno en busca de destinos remotos o proyectos ligados.
 * Cualquier señal remota => bloquea. Devuelve el primer hallazgo bloqueante.
 * @param {Record<string,string|undefined>} env
 */
export function inspectEnvForRemote(env = {}) {
  const findings = [];
  const urlVars = [
    "DATABASE_URL",
    "SUPABASE_DB_URL",
    "SUPABASE_URL",
    "POSTGRES_URL",
    "PGHOST",
    "SUPABASE_HOST",
  ];
  for (const key of urlVars) {
    const val = env[key];
    if (typeof val !== "string" || val.trim() === "") continue;
    // PGHOST/SUPABASE_HOST son sólo host; los demás son URLs/DSN.
    const asTarget = key === "PGHOST" || key === "SUPABASE_HOST" ? `postgres://x@${val}:5432/db` : val;
    const c = classifyTarget(asTarget);
    if (c.classification === "REMOTE") {
      findings.push({ code: STOP.E_REMOTE_ENV_PRESENT, var: key, host: c.host, reason: c.reason });
    }
  }
  // Un access token de Supabase habilita operaciones contra la nube: bloquea por defecto.
  if (typeof env.SUPABASE_ACCESS_TOKEN === "string" && env.SUPABASE_ACCESS_TOKEN.trim() !== "") {
    findings.push({ code: STOP.E_SUPABASE_LINKED_PROJECT, var: "SUPABASE_ACCESS_TOKEN", host: null, reason: "access_token_presente" });
  }
  if (typeof env.SUPABASE_PROJECT_REF === "string" && env.SUPABASE_PROJECT_REF.trim() !== "") {
    findings.push({ code: STOP.E_SUPABASE_LINKED_PROJECT, var: "SUPABASE_PROJECT_REF", host: null, reason: "project_ref_presente" });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Guarda de alcance (scope): qué rutas puede tocar el harness.
// ---------------------------------------------------------------------------
export const ALLOWED_WRITE_PREFIXES = Object.freeze(["tools/local-db/", "test/local-db/"]);

export const PROTECTED_PREFIXES = Object.freeze([
  "supabase/migrations/",
  "supabase/functions/",
  "app/",
]);

export const PROTECTED_EXACT = Object.freeze([
  "tools/run-contract-tests.mjs",
  "tools/canonical-source.json",
]);

/** Normaliza a ruta relativa POSIX sin ./ inicial. */
export function normalizeRepoPath(p) {
  if (typeof p !== "string") return "";
  return p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

/**
 * ¿La escritura en `path` está permitida por el alcance del ticket?
 * Fail-closed: sólo permite bajo ALLOWED_WRITE_PREFIXES y nunca en protegidos.
 * @returns {{allowed: boolean, code: string|null, reason: string}}
 */
export function isWriteAllowed(path) {
  const rel = normalizeRepoPath(path);
  if (rel === "") {
    return { allowed: false, code: STOP.E_SCOPE_VIOLATION, reason: "ruta_vacia" };
  }
  if (rel.includes("..")) {
    return { allowed: false, code: STOP.E_SCOPE_VIOLATION, reason: "traversal" };
  }
  if (PROTECTED_EXACT.includes(rel)) {
    return { allowed: false, code: STOP.E_SCOPE_VIOLATION, reason: `protegido_exacto:${rel}` };
  }
  for (const pre of PROTECTED_PREFIXES) {
    if (rel.startsWith(pre)) {
      return { allowed: false, code: STOP.E_SCOPE_VIOLATION, reason: `protegido_prefijo:${pre}` };
    }
  }
  if (rel.startsWith(".github/workflows/")) {
    return { allowed: false, code: STOP.E_SCOPE_VIOLATION, reason: "workflow" };
  }
  for (const pre of ALLOWED_WRITE_PREFIXES) {
    if (rel.startsWith(pre)) {
      return { allowed: true, code: null, reason: `permitido:${pre}` };
    }
  }
  return { allowed: false, code: STOP.E_SCOPE_VIOLATION, reason: "fuera_de_alcance" };
}

/**
 * Verifica una lista de rutas modificadas (p.ej. de `git status`).
 * @returns {{ok: boolean, violations: Array}}
 */
export function checkScope(changedPaths = []) {
  const violations = [];
  for (const p of changedPaths) {
    const r = isWriteAllowed(p);
    if (!r.allowed) violations.push({ path: normalizeRepoPath(p), ...r });
  }
  return { ok: violations.length === 0, violations };
}

// ---------------------------------------------------------------------------
// Precondiciones simples de host.
// ---------------------------------------------------------------------------
/** Node mayor >= min (default 22). */
export function checkNodeMajor(versionString, min = 22) {
  const m = String(versionString || "").match(/v?(\d+)\./);
  if (!m) return { ok: false, code: STOP.E_NODE_VERSION, actual: versionString, expected: `>=${min}` };
  const major = Number(m[1]);
  return major >= min
    ? { ok: true, code: STOP.OK, actual: major, expected: `>=${min}` }
    : { ok: false, code: STOP.E_NODE_VERSION, actual: major, expected: `>=${min}` };
}

/** platform === 'darwin' (macOS). */
export function checkMacOS(platform) {
  return platform === "darwin"
    ? { ok: true, code: STOP.OK, actual: platform, expected: "darwin" }
    : { ok: false, code: STOP.E_HOST_NOT_MACOS, actual: platform, expected: "darwin" };
}

// ---------------------------------------------------------------------------
// Builder del reporte estructurado. Campos EXACTOS pedidos por el ticket.
// ---------------------------------------------------------------------------
export const REPORT_FIELDS = Object.freeze([
  "RESULT",
  "SCRIPT_EXIT_CODE",
  "UNIT",
  "FAILED_PHASE",
  "STOP_REASON_CODE",
  "STOP_REASON_DETAIL",
  "FAILED_COMMAND",
  "EXPECTED",
  "ACTUAL",
  "FAILED_MIGRATION",
  "FAILED_POLICY",
  "FAILED_ROLE",
  "LOCAL_SUPABASE_STATUS",
  "SAFE_RECOVERY_ACTION",
  "DO_NOT_RUN",
  "OUTPUT",
]);

export const UNIT = "TC-LOCAL-DB-RLS-HARNESS-01";

/**
 * Construye el objeto de reporte con TODOS los campos presentes (fail-closed:
 * campos desconocidos quedan explícitos como "-" o "n/a", nunca ausentes).
 */
export function buildReport(partial = {}) {
  const stop = partial.STOP_REASON_CODE ?? (partial.ok ? STOP.OK : STOP.E_INTERNAL);
  const isOk = stop === STOP.OK;
  const exit = partial.SCRIPT_EXIT_CODE ?? EXIT_CODES[stop] ?? EXIT_CODES[STOP.E_INTERNAL];
  const base = {
    RESULT: isOk ? "PASS" : "FAIL",
    SCRIPT_EXIT_CODE: exit,
    UNIT,
    FAILED_PHASE: isOk ? "-" : (partial.FAILED_PHASE ?? PHASE.DONE),
    STOP_REASON_CODE: stop,
    STOP_REASON_DETAIL: partial.STOP_REASON_DETAIL ?? (isOk ? "-" : "sin_detalle"),
    FAILED_COMMAND: partial.FAILED_COMMAND ?? "-",
    EXPECTED: partial.EXPECTED ?? "-",
    ACTUAL: partial.ACTUAL ?? "-",
    FAILED_MIGRATION: partial.FAILED_MIGRATION ?? "-",
    FAILED_POLICY: partial.FAILED_POLICY ?? "-",
    FAILED_ROLE: partial.FAILED_ROLE ?? "-",
    LOCAL_SUPABASE_STATUS: partial.LOCAL_SUPABASE_STATUS ?? "unknown",
    SAFE_RECOVERY_ACTION: partial.SAFE_RECOVERY_ACTION ?? defaultRecovery(stop),
    DO_NOT_RUN: partial.DO_NOT_RUN ?? "push | PR | merge | deploy | supabase remoto | psql remoto",
    OUTPUT: partial.OUTPUT ?? "-",
  };
  return base;
}

/** Acción de recuperación segura por código. Nunca sugiere acciones remotas. */
export function defaultRecovery(code) {
  switch (code) {
    case STOP.OK:
      return "ninguna";
    case STOP.E_DOCKER_NOT_RUNNING:
    case STOP.E_DOCKER_MISSING:
      return "iniciar Docker Desktop y reintentar (solo local)";
    case STOP.E_SUPABASE_CLI_MISSING:
      return "instalar Supabase CLI (brew install supabase/tap/supabase)";
    case STOP.E_REMOTE_TARGET_DETECTED:
    case STOP.E_REMOTE_ENV_PRESENT:
    case STOP.E_SUPABASE_LINKED_PROJECT:
      return "eliminar env/target remotos del shell y reintentar; NO ejecutar contra remoto";
    case STOP.E_SCOPE_VIOLATION:
      return "revertir cambios fuera de tools/local-db y test/local-db";
    case STOP.E_MIGRATION_FAILED:
    case STOP.E_MIGRATION_NOT_IDEMPOTENT:
    case STOP.E_SCHEMA_DIFF:
      return "supabase stop local + revisar migración señalada; ver rollback-local-reset.md";
    case STOP.E_RLS_MATRIX_FAILED:
    case STOP.E_ANON_LEAK:
    case STOP.E_PRIVILEGE_ESCALATION:
    case STOP.E_CROSS_TENANT_LEAK:
    case STOP.E_POLICY_MISSING:
      return "NO promover a staging; corregir policy/migración y re-ejecutar harness local";
    case STOP.E_SECURITY_DEFINER_UNSAFE:
    case STOP.E_SEARCH_PATH_UNPINNED:
      return "fijar search_path y revocar EXECUTE público/anon en la función señalada";
    default:
      return "detener; revisar 00_FINAL_RESULT.txt y logs locales";
  }
}

/** Serializa el reporte a texto plano KEY=VALUE (para 00_FINAL_RESULT.txt). */
export function renderReportText(report) {
  return REPORT_FIELDS.map((k) => `${k}=${report[k]}`).join("\n") + "\n";
}
