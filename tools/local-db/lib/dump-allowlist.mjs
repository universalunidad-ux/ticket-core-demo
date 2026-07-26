// TC-RECOVERY-P5-P9-CLOSE-05
// dump-allowlist.mjs — OWNER ÚNICO de la adjudicación de allowlist del dump (P6).
//
// Sustituye la guarda vacua que tenía run-recovery-v2.sh: sobre una TOC
// `--data-only` NUNCA aparecen entradas `SCHEMA - realtime`, así que un grep de
// FORBIDDEN_PATTERN contra esa TOC no podía fallar jamás. Aquí la validación es
// POSITIVA: se enumeran los objetos que REALMENTE se van a restaurar y se exige
// que todos pertenezcan a la allowlist; cualquier otro objeto aborta.
//
// Dos planos, ambos necesarios (uno solo no basta):
//   1. TOC  (`pg_restore -l`)            -> qué objetos se restaurarán.
//   2. CONTENIDO (`pg_restore -f -`)     -> qué sentencias contiene de verdad.
//      Los nombres de la TOC no revelan un `SET log_min_messages` embebido ni un
//      `GRANT`/`ALTER ... OWNER TO`; el contenido sí.
//
// SEGURIDAD: el escaneo de contenido es en STREAMING y NUNCA emite la línea que
// disparó un hallazgo — sólo la regla y el número de línea. Las filas del dump
// contienen PII y columnas sensibles (bitacora.detalle) y no deben tocar ni el
// stdout, ni un log, ni un artefacto.
//
// Uso como módulo (funciones puras, cubiertas por test/local-db/dump-allowlist.test.mjs).
// Uso como CLI:
//   node tools/local-db/lib/dump-allowlist.mjs --toc <toc.txt> --order <recovery-data-order.txt>
//   pg_restore --data-only -f - dump | node tools/local-db/lib/dump-allowlist.mjs \
//       --scan-content [--secret-patterns tools/secret-gate-patterns.txt]

import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";

export const ALLOWED_SCHEMAS = Object.freeze(["public", "app_private"]);

// En un restore `--data-only` sólo estos dos descriptores tienen sentido.
// Cualquier otro (ACL, FUNCTION, EXTENSION, TRIGGER, POLICY, SCHEMA…) significa
// que el dump NO es data-only y arrastra estructura o plataforma.
export const ALLOWED_TOC_TYPES = Object.freeze(["TABLE DATA", "SEQUENCE SET"]);

// Tablas efímeras excluidas por 03_DUMP_FILTERS.txt: si aparecen en la TOC, el
// dump se generó sin los filtros correctos.
export const EXCLUDED_TABLES = Object.freeze([
  "rate_limit_events", "edge_idempotency", "support_idempotency", "ticket_portal_logs",
]);

// Descriptores conocidos de pg_restore, ordenados de más largo a más corto para
// que "SEQUENCE SET" no se confunda con "SEQUENCE".
const TOC_DESCRIPTORS = [
  "MATERIALIZED VIEW DATA", "SEQUENCE OWNED BY", "DEFAULT ACL", "EVENT TRIGGER",
  "FK CONSTRAINT", "ROW SECURITY", "LARGE OBJECTS", "LARGE OBJECT", "TABLE DATA",
  "SEQUENCE SET", "MATERIALIZED VIEW", "PROCEDURE", "PUBLICATION", "EXTENSION",
  "AGGREGATE", "CONSTRAINT", "OPERATOR", "FUNCTION", "SCHEMA", "COMMENT",
  "TRIGGER", "SEQUENCE", "DEFAULT", "POLICY", "INDEX", "TABLE", "VIEW", "TYPE",
  "BLOBS", "ACL",
].sort((a, b) => b.length - a.length);

// ---------------------------------------------------------------------------
// PURO · Parseo de `pg_restore -l`.
// Formato de entrada: "<dumpId>; <catOid> <oid> <DESC> <schema> <name> <owner>".
// Las líneas que empiezan por ';' son comentarios del archivo.
// ---------------------------------------------------------------------------
export function parseRestoreToc(text) {
  const out = [];
  for (const raw of String(text || "").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith(";")) continue;
    const m = /^(\d+);\s+(\d+)\s+(\d+)\s+(\S.*)$/.exec(line);
    if (!m) { out.push({ raw: line, type: "UNPARSEABLE", schema: null, name: null }); continue; }
    const rest = m[4].trim();
    const type = TOC_DESCRIPTORS.find((d) => rest === d || rest.startsWith(d + " ")) || null;
    if (!type) { out.push({ raw: line, type: "UNKNOWN", schema: null, name: null }); continue; }
    const tail = rest.slice(type.length).trim().split(/\s+/).filter(Boolean);
    const [schema = null, ...others] = tail;
    const name = others.length > 1 ? others.slice(0, -1).join(" ") : (others[0] ?? null);
    out.push({ raw: line, dumpId: Number(m[1]), type, schema, name });
  }
  return out;
}

// ---------------------------------------------------------------------------
// PURO · Lista de tablas realmente autorizadas, leída de recovery-data-order.txt.
// La allowlist NO se reescribe aquí: recovery-data-order.txt sigue siendo su
// fuente de verdad y este módulo la consume (no la duplica).
// ---------------------------------------------------------------------------
export function parseAllowedTables(orderText) {
  const allowed = [];
  for (const raw of String(orderText || "").split("\n")) {
    const m = /^\s*\d+\s+public\.(\w+)/.exec(raw);
    if (m) allowed.push(m[1]);
  }
  return allowed;
}

// ---------------------------------------------------------------------------
// PURO · Adjudicación. Devuelve violaciones estructuradas; el veredicto es
// fail-closed: sin entradas de datos NO hay nada que restaurar y eso también es
// una violación (un dump vacío no puede "pasar" una allowlist por defecto).
// ---------------------------------------------------------------------------
export function adjudicateToc(entries, { allowedTables }) {
  const violations = [];
  const restored = [];
  const allowed = new Set(allowedTables || []);

  for (const e of entries) {
    if (!ALLOWED_TOC_TYPES.includes(e.type)) {
      violations.push({ reason: "TYPE_NOT_ALLOWED", type: e.type, object: `${e.schema ?? "?"}.${e.name ?? "?"}` });
      continue;
    }
    if (!ALLOWED_SCHEMAS.includes(e.schema)) {
      violations.push({ reason: "SCHEMA_NOT_ALLOWED", type: e.type, object: `${e.schema ?? "?"}.${e.name ?? "?"}` });
      continue;
    }
    if (e.type === "TABLE DATA") {
      if (EXCLUDED_TABLES.includes(e.name)) {
        violations.push({ reason: "TABLE_EXCLUDED_BY_FILTERS", type: e.type, object: `${e.schema}.${e.name}` });
        continue;
      }
      if (e.schema === "public" && !allowed.has(e.name)) {
        violations.push({ reason: "TABLE_NOT_IN_ALLOWLIST", type: e.type, object: `${e.schema}.${e.name}` });
        continue;
      }
      restored.push(`${e.schema}.${e.name}`);
    }
  }

  if (restored.length === 0) {
    violations.push({ reason: "NO_TABLE_DATA_ENTRIES", type: "-", object: "-" });
  }
  return { ok: violations.length === 0, restored, violations };
}

// ---------------------------------------------------------------------------
// PURO · Reglas de contenido. Se evalúan línea a línea sobre la salida SQL de
// `pg_restore --data-only -f -`.
//
// Un dump data-only legítimo sólo contiene: comentarios, `SET`/`SELECT
// pg_catalog.set_config` de sesión, `COPY public|app_private.…`, filas, `\.`,
// y `setval`. Cualquier DDL, GRANT, cambio de owner o referencia a un schema de
// plataforma es una violación.
// ---------------------------------------------------------------------------
export const CONTENT_RULES = Object.freeze([
  { rule: "SUSET_GUC", re: /\b(?:SET|set_config\s*\(\s*')\s*'?(log_min_messages|session_replication_role|lc_messages)\b/i },
  { rule: "DDL_OBJECT", re: /^\s*(?:CREATE|ALTER|DROP)\s+(?:EXTENSION|SCHEMA|FUNCTION|PROCEDURE|TRIGGER|POLICY|ROLE|PUBLICATION|SUBSCRIPTION|EVENT\s+TRIGGER|TYPE|VIEW|SEQUENCE|INDEX)\b/i },
  { rule: "PRIVILEGE_CHANGE", re: /^\s*(?:GRANT|REVOKE)\b/i },
  { rule: "OWNER_CHANGE", re: /\bOWNER\s+TO\b/i },
  { rule: "TRIGGER_ALL", re: /\b(?:DISABLE|ENABLE)\s+TRIGGER\s+ALL\b/i },
  { rule: "SECURITY_DEFINER", re: /\bSECURITY\s+DEFINER\b/i },
  { rule: "PLATFORM_SCHEMA", re: /\b(?:COPY|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:realtime|_realtime|vault|pgsodium|graphql|graphql_public|supabase_functions|auth|storage|extensions|supabase_migrations)\./i },
  { rule: "COPY_OUT_OF_ALLOWLIST", re: /^\s*COPY\s+(?!(?:public|app_private)\.)/i },
  { rule: "EXCLUDED_TABLE_DATA", re: new RegExp(`^\\s*COPY\\s+public\\.(?:${EXCLUDED_TABLES.join("|")})\\b`, "i") },
]);

// PURO · Evalúa UNA línea. Devuelve el nombre de la regla violada o null.
// NUNCA devuelve la línea: el llamador sólo puede reportar regla + número.
export function scanContentLine(line) {
  for (const { rule, re } of CONTENT_RULES) if (re.test(line)) return rule;
  return null;
}

// PURO · Compila los patrones del secret gate (formato ERE, uno por línea).
export function compileSecretPatterns(text) {
  return String(text || "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((src, i) => {
      try { return { id: `SECRET_PATTERN_${i + 1}`, re: new RegExp(src.replace(/\[:cntrl:\]/g, "\\x00-\\x1f").replace(/\[:space:\]/g, "\\s"), "i") }; }
      catch { return null; }
    })
    .filter(Boolean);
}

// PURO · Acumulador de hallazgos. Sólo guarda regla + primera línea + conteo.
export function newScanState() {
  return { lines: 0, findings: new Map(), copyTables: new Set() };
}

export function scanLineInto(state, line, secretPatterns = []) {
  state.lines += 1;
  const copy = /^\s*COPY\s+([A-Za-z_][\w]*\.[A-Za-z_][\w]*)/i.exec(line);
  if (copy) state.copyTables.add(copy[1].toLowerCase());
  const rule = scanContentLine(line);
  if (rule) bump(state, rule);
  for (const p of secretPatterns) if (p.re.test(line)) { bump(state, p.id); break; }
  return state;
}

function bump(state, rule) {
  const cur = state.findings.get(rule);
  if (cur) cur.count += 1;
  else state.findings.set(rule, { count: 1, firstLine: state.lines });
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function fail(code, detail) {
  process.stdout.write(`DUMP_ALLOWLIST=FAIL\nDUMP_ALLOWLIST_REASON=${code}\nDUMP_ALLOWLIST_DETAIL=${detail}\n`);
  process.exit(4);
}

function cliToc(tocPath, orderPath) {
  const entries = parseRestoreToc(readFileSync(tocPath, "utf8"));
  const allowedTables = parseAllowedTables(readFileSync(orderPath, "utf8"));
  if (allowedTables.length === 0) fail("EMPTY_ALLOWLIST", "recovery-data-order.txt no declara ninguna tabla");
  const v = adjudicateToc(entries, { allowedTables });
  process.stdout.write(`TOC_ENTRIES=${entries.length}\nTOC_RESTORED_TABLES=${v.restored.length}\n`);
  for (const t of v.restored) process.stdout.write(`RESTORES=${t}\n`);
  if (!v.ok) {
    for (const x of v.violations) process.stdout.write(`VIOLATION=${x.reason}\t${x.type}\t${x.object}\n`);
    fail("TOC_OUT_OF_ALLOWLIST", `${v.violations.length} violacion(es)`);
  }
  process.stdout.write("DUMP_ALLOWLIST=PASS\n");
}

async function cliScanContent(secretPatternsPath) {
  const secretPatterns = secretPatternsPath
    ? compileSecretPatterns(readFileSync(secretPatternsPath, "utf8"))
    : [];
  const state = newScanState();
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) scanLineInto(state, line, secretPatterns);

  process.stdout.write(`CONTENT_LINES=${state.lines}\n`);
  for (const t of [...state.copyTables].sort()) process.stdout.write(`CONTENT_COPY_TABLE=${t}\n`);
  const outOfScope = [...state.copyTables].filter((t) => !ALLOWED_SCHEMAS.includes(t.split(".")[0]));
  for (const t of outOfScope) process.stdout.write(`CONTENT_VIOLATION=COPY_OUT_OF_ALLOWLIST\t${t}\n`);
  // Sólo regla + primera línea: jamás el texto que disparó el hallazgo.
  for (const [rule, info] of state.findings) {
    process.stdout.write(`CONTENT_VIOLATION=${rule}\tcount=${info.count}\tfirst_line=${info.firstLine}\n`);
  }
  if (state.lines === 0) fail("EMPTY_CONTENT", "pg_restore no emitio ninguna linea");
  if (state.findings.size > 0 || outOfScope.length > 0) {
    fail("CONTENT_FORBIDDEN_PATTERN", `${state.findings.size + outOfScope.length} regla(s) violada(s); contenido NO impreso`);
  }
  process.stdout.write("DUMP_CONTENT_SCAN=PASS\n");
}

function isMain() {
  if (!process.argv[1]) return false;
  try { return new URL(`file://${process.argv[1]}`).pathname.endsWith("/dump-allowlist.mjs"); }
  catch { return false; }
}

if (isMain()) {
  const argv = process.argv.slice(2);
  const get = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
  if (argv.includes("--scan-content")) {
    await cliScanContent(get("--secret-patterns"));
  } else {
    const toc = get("--toc"); const order = get("--order");
    if (!toc || !order) fail("BAD_ARGS", "uso: --toc <f> --order <f> | --scan-content");
    cliToc(toc, order);
  }
}
