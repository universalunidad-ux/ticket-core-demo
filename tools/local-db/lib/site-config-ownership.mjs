// TC-RECOVERY-SITE-CONFIG-OWNERSHIP-01
// Owner único de la política de Recovery para public.site_config.
//
// SOURCE_DATA_OWNED: las migraciones crean un baseline completo de seis claves,
// pero public.manage_site_config(text,text) permite que el estado de la fuente
// cambie. Recovery conserva ese estado mediante sustitución transaccional; el
// seed del destino nunca gana por colisión ni se ignora silenciosamente.
//
// Privacidad: este módulo no registra claves ni valores. Los diagnósticos usan
// únicamente conteos y hashes SHA-256 estables de las claves.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_POLICY =
  "tools/local-db/site-config-ownership.json";

export function readPolicy(path = DEFAULT_POLICY) {
  const policy = JSON.parse(readFileSync(resolve(path), "utf8"));
  if (policy.classification !== "SOURCE_DATA_OWNED") {
    throw new Error("SITE_CONFIG_POLICY_CLASSIFICATION_INVALID");
  }
  if (policy.table !== "public.site_config" || policy.key_column !== "clave") {
    throw new Error("SITE_CONFIG_POLICY_TARGET_INVALID");
  }
  if (!Array.isArray(policy.source_owned_keys) || policy.source_owned_keys.length === 0) {
    throw new Error("SITE_CONFIG_POLICY_KEYS_EMPTY");
  }
  if (new Set(policy.source_owned_keys).size !== policy.source_owned_keys.length) {
    throw new Error("SITE_CONFIG_POLICY_KEYS_DUPLICATED");
  }
  if ((policy.environment_owned_keys || []).length !== 0) {
    throw new Error("SITE_CONFIG_POLICY_MIXED_KEYS_FORBIDDEN");
  }
  return Object.freeze({
    ...policy,
    source_owned_keys: Object.freeze([...policy.source_owned_keys]),
    environment_owned_keys: Object.freeze([]),
  });
}

export const hashKey = key =>
  createHash("sha256").update(String(key)).digest("hex");

function decodeCopyKey(raw) {
  if (!raw || raw === "\\N" || raw.includes("\\")) {
    throw new Error("SITE_CONFIG_COPY_KEY_ENCODING_UNSUPPORTED");
  }
  return raw;
}

export function parseSiteConfigCopy(sql) {
  const lines = String(sql || "").split(/\r?\n/);
  const headers = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (/^COPY public\.site_config \([^)]+\) FROM stdin;$/.test(lines[i])) {
      headers.push(i);
    }
  }
  if (headers.length !== 1) {
    throw new Error(`SITE_CONFIG_COPY_BLOCK_COUNT:${headers.length}`);
  }

  const start = headers[0];
  const columns = lines[start]
    .slice(lines[start].indexOf("(") + 1, lines[start].lastIndexOf(")"))
    .split(",")
    .map(value => value.trim());
  if (columns[0] !== "clave" || !columns.includes("valor")) {
    throw new Error("SITE_CONFIG_COPY_COLUMNS_INVALID");
  }

  let end = -1;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i] === "\\.") {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("SITE_CONFIG_COPY_UNTERMINATED");

  const rows = lines.slice(start + 1, end);
  if (rows.length === 0) throw new Error("SITE_CONFIG_COPY_EMPTY");
  const keys = rows.map(row => decodeCopyKey(row.split("\t", 1)[0]));
  return {
    columns,
    keys,
    copyBlock: lines.slice(start, end + 1).join("\n"),
  };
}

export function adjudicateKeys(keys, policy) {
  const expected = new Set(policy.source_owned_keys);
  const seen = new Set();
  const duplicates = [];
  for (const key of keys) {
    if (seen.has(key)) duplicates.push(key);
    seen.add(key);
  }
  const unknown = [...seen].filter(key => !expected.has(key));
  const missing = [...expected].filter(key => !seen.has(key));
  const overlap = [...seen].filter(key => expected.has(key));
  const result = {
    ok: duplicates.length === 0 && unknown.length === 0 && missing.length === 0,
    migrationKeyCount: expected.size,
    dumpKeyCount: seen.size,
    overlapKeyCount: overlap.length,
    unknownKeyCount: unknown.length,
    missingKeyCount: missing.length,
    duplicateKeyCount: duplicates.length,
    keyHashes: [...seen].map(hashKey).sort(),
    unknownKeyHashes: unknown.map(hashKey).sort(),
    missingKeyHashes: missing.map(hashKey).sort(),
  };
  return result;
}

export function formatAdjudication(result) {
  return [
    `MIGRATION_KEY_COUNT=${result.migrationKeyCount}`,
    `DUMP_KEY_COUNT=${result.dumpKeyCount}`,
    `OVERLAP_KEY_COUNT=${result.overlapKeyCount}`,
    `UNKNOWN_KEY_COUNT=${result.unknownKeyCount}`,
    `MISSING_KEY_COUNT=${result.missingKeyCount}`,
    `DUPLICATE_KEY_COUNT=${result.duplicateKeyCount}`,
    `KEY_HASHES=${result.keyHashes.join(",")}`,
    `UNKNOWN_KEY_HASHES=${result.unknownKeyHashes.join(",")}`,
    `MISSING_KEY_HASHES=${result.missingKeyHashes.join(",")}`,
  ].join("\n");
}

export function buildMainRestoreList(tocText) {
  const lines = String(tocText || "").split(/\r?\n/);
  let excluded = 0;
  const output = lines.map(line => {
    if (/^\d+;\s+\d+\s+\d+\s+TABLE DATA public site_config \S+\s*$/.test(line)) {
      excluded += 1;
      return `; SOURCE_DATA_OWNED_ATOMIC_RESTORE ${line}`;
    }
    return line;
  });
  if (excluded !== 1) {
    throw new Error(`SITE_CONFIG_TOC_ENTRY_COUNT:${excluded}`);
  }
  return { text: output.join("\n"), excluded };
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function exactKeyValidationSql(policy, prefix) {
  const keys = policy.source_owned_keys.map(sqlLiteral).join(", ");
  return `do $tc_site_config$
begin
  if (select count(*) from public.site_config) <> ${policy.source_owned_keys.length} then
    raise exception '${prefix}_COUNT_INVALID';
  end if;
  if exists (
    select 1 from public.site_config where clave not in (${keys})
  ) then
    raise exception '${prefix}_UNKNOWN_KEY';
  end if;
  if exists (
    select expected.clave
    from (values ${policy.source_owned_keys.map(key => `(${sqlLiteral(key)})`).join(", ")}) expected(clave)
    except
    select clave from public.site_config
  ) then
    raise exception '${prefix}_MISSING_KEY';
  end if;
end
$tc_site_config$;`;
}

export function buildBaselineValidationSql(policy) {
  return `\\set ON_ERROR_STOP on
${exactKeyValidationSql(policy, "SITE_CONFIG_BASELINE")}
\\echo SITE_CONFIG_BASELINE_VALIDATED=PASS
`;
}

export function buildAtomicRestoreSql(copySql, policy) {
  const parsed = parseSiteConfigCopy(copySql);
  const adjudication = adjudicateKeys(parsed.keys, policy);
  if (!adjudication.ok) {
    const error = new Error("SITE_CONFIG_SOURCE_KEYS_REJECTED");
    error.adjudication = adjudication;
    throw error;
  }
  return {
    sql: `\\set ON_ERROR_STOP on
begin;
delete from public.site_config;
${parsed.copyBlock}
${exactKeyValidationSql(policy, "SITE_CONFIG_SOURCE")}
commit;
\\echo SITE_CONFIG_ATOMIC_RESTORE=PASS
`,
    adjudication,
  };
}

function argValue(argv, flag, fallback = null) {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : fallback;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function fail(error) {
  const adjudication = error?.adjudication;
  process.stderr.write("SITE_CONFIG_OWNERSHIP=FAIL\n");
  process.stderr.write(`SITE_CONFIG_REASON=${String(error?.message || "UNKNOWN").replace(/[\r\n\t]+/g, " ")}\n`);
  if (adjudication) process.stderr.write(`${formatAdjudication(adjudication)}\n`);
  process.exit(4);
}

async function main() {
  const argv = process.argv.slice(2);
  const policy = readPolicy(argValue(argv, "--policy", DEFAULT_POLICY));
  if (argv.includes("--emit-baseline-sql")) {
    process.stdout.write(buildBaselineValidationSql(policy));
    return;
  }
  if (argv.includes("--build-restore-list")) {
    const toc = argValue(argv, "--toc");
    if (!toc) throw new Error("SITE_CONFIG_TOC_PATH_REQUIRED");
    const built = buildMainRestoreList(readFileSync(resolve(toc), "utf8"));
    process.stdout.write(built.text);
    process.stderr.write(`SITE_CONFIG_MAIN_RESTORE_EXCLUDED=${built.excluded}\n`);
    return;
  }
  if (argv.includes("--emit-atomic-sql")) {
    const built = buildAtomicRestoreSql(await readStdin(), policy);
    process.stdout.write(built.sql);
    process.stderr.write(`${formatAdjudication(built.adjudication)}\n`);
    process.stderr.write("SITE_CONFIG_SOURCE_KEYS=PASS\n");
    return;
  }
  throw new Error("SITE_CONFIG_ARGUMENT_INVALID");
}

if (process.argv[1]?.endsWith("/site-config-ownership.mjs")) {
  main().catch(fail);
}
