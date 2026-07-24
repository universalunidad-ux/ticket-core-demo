// TC-LOCAL-DB-RLS-HARNESS-01
// parse.mjs — Parsers puros de salidas de herramientas externas.
// Sin efectos: reciben texto, devuelven estructuras. Testeables en sandbox.

import { classifyTarget } from "./guards.mjs";

/**
 * Extrae la DB URL local desde la salida de `supabase status`.
 * Devuelve { url, host, classification } o null si no aparece.
 * Fail-closed: si la URL no es LOCAL, classification === "REMOTE".
 */
export function parseSupabaseStatusDbUrl(statusText) {
  if (typeof statusText !== "string") return null;

  // Preferencia: salida estructurada de `supabase status -o env`.
  // Se mantienen fallbacks para versiones anteriores y salida pretty.
  const patterns = [
    /(?:^|\n)\s*(?:DB_URL|DATABASE_URL)\s*=\s*"([^"]+)"/i,
    /(?:^|\n)\s*(?:DB_URL|DATABASE_URL)\s*=\s*'([^']+)'/i,
    /(?:^|\n)\s*(?:DB_URL|DATABASE_URL)\s*=\s*([^\s]+)/i,
    /DB URL:\s*(\S+)/i,
    /(?:^|\n)\s*[│|]?\s*(?:DB URL|URL)\s*[│|]\s*(postgres(?:ql)?:\/\/[^\s│|]+)/i,
  ];

  let url = null;

  for (const pattern of patterns) {
    const match = statusText.match(pattern);

    if (match?.[1]) {
      url = match[1].trim();
      break;
    }
  }

  if (!url) return null;

  const c = classifyTarget(url);

  return {
    url,
    host: c.host,
    classification: c.classification,
    reason: c.reason,
  };
}

/**
 * Lista migraciones .sql en orden lexicográfico (timestamp-prefijado).
 * Recibe un array de nombres de archivo (no toca fs).
 */
export function orderMigrations(fileNames = []) {
  return fileNames
    .filter((n) => typeof n === "string" && /^\d{14}_.*\.sql$/.test(n))
    .slice()
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Interpreta la salida psql de una matriz RLS negativa (authz_negative.sql).
 * - psql con ON_ERROR_STOP aborta (exit!=0) ante `raise exception 'FAIL...'`.
 * - Cada aserción ok emite `NOTICE:  PASS: ...`.
 * @param {{stdout:string, stderr:string, code:number}} res
 * @returns {{ok:boolean, passes:string[], failLine:string|null, failedRole:string|null}}
 */
export function parseRlsMatrixOutput(res = {}) {
  const text = `${res.stdout || ""}\n${res.stderr || ""}`;
  const passes = [];
  const passRe = /PASS:\s*(.+)/g;
  let mm;
  while ((mm = passRe.exec(text)) !== null) passes.push(mm[1].trim());

  const failMatch = text.match(/FAIL[^\n]*/i);
  const failLine = failMatch ? failMatch[0].trim() : null;

  // Heurística de rol implicado (para FAILED_ROLE).
  let failedRole = null;
  if (failLine) {
    const roleHit = failLine.match(/\b(anon|soporte|supervisor|admin|authenticated|cliente)\b/i);
    if (roleHit) failedRole = roleHit[1].toLowerCase();
  }

  const ok = (res.code === 0) && !failLine;
  return { ok, passes, failLine, failedRole };
}

/**
 * Interpreta el inventario SECURITY DEFINER (security_definer_preflight.sql).
 * Recibe el JSON (array) del bloque security_definer_inventory.
 * Falla si alguna función NO tiene search_path fijo, o expone EXECUTE a
 * PUBLIC / anon, salvo el anon intencional de get_ticket_portal.
 * @returns {{ok:boolean, unsafe:Array, searchPathUnpinned:Array}}
 */
export function evaluateSecurityDefiner(inventory = []) {
  const unsafe = [];
  const searchPathUnpinned = [];
  const intentionalAnon = (identity) =>
    typeof identity === "string" && identity.startsWith("public.get_ticket_portal(");

  for (const fn of Array.isArray(inventory) ? inventory : []) {
    const id = fn.identity || "(desconocida)";
    if (fn.search_path_fixed === false) {
      searchPathUnpinned.push(id);
      unsafe.push({ identity: id, issue: "search_path_no_fijado" });
    }
    if (fn.public_execute === true) {
      unsafe.push({ identity: id, issue: "execute_publico" });
    }
    if (fn.anon_execute === true && !intentionalAnon(id)) {
      unsafe.push({ identity: id, issue: "execute_anon_no_intencional" });
    }
  }
  return { ok: unsafe.length === 0, unsafe, searchPathUnpinned };
}

/**
 * Interpreta un snapshot de pg_policies para detectar tablas internas que
 * quedaron SIN RLS o SIN ninguna policy (posible fuga). Recibe:
 *  - rlsRows: [{tablename, rowsecurity(bool)}...] de pg_tables/pg_class
 *  - expectedTables: nombres que DEBEN tener RLS activo.
 * @returns {{ok:boolean, missingRls:string[]}}
 */
export function evaluateRlsEnabled(rlsRows = [], expectedTables = []) {
  const byName = new Map();
  for (const r of rlsRows) byName.set(r.tablename, r.rowsecurity === true || r.rowsecurity === "true");
  const missingRls = [];
  for (const t of expectedTables) {
    if (byName.get(t) !== true) missingRls.push(t);
  }
  return { ok: missingRls.length === 0, missingRls };
}
