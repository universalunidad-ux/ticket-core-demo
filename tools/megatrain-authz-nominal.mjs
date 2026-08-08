#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const evidenceFlag = process.argv.indexOf("--evidence-dir");
if (evidenceFlag < 0 || !process.argv[evidenceFlag + 1]) throw new Error("EVIDENCE_DIR_REQUIRED");
const evidence = resolve(process.argv[evidenceFlag + 1]);
mkdirSync(evidence, { recursive: true });
const runtime = join(root, "tools/local-db/.runtime");
const project = "tc_megatrain_authz";
const container = `supabase_db_${project}`;
const env = { ...process.env };
for (const key of ["DATABASE_URL","SUPABASE_DB_URL","SUPABASE_URL","POSTGRES_URL","SUPABASE_HOST","PGHOST","SUPABASE_ACCESS_TOKEN","SUPABASE_PROJECT_REF"]) delete env[key];

const redact = value => String(value || "")
  .replace(/postgresql:\/\/[^@\s]+@/gi, "postgresql://[REDACTED]@")
  .replace(/\beyJ[A-Za-z0-9._-]{30,}\b/g, "[REDACTED_JWT]")
  .replace(/(SERVICE_ROLE_KEY|ANON_KEY|PASSWORD)=\S+/gi, "$1=[REDACTED]");
const run = (command, args, timeout = 600000) => spawnSync(command, args, { cwd: root, env, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout });
const requireOk = (label, result) => {
  const output = redact(`${result.stdout || ""}${result.stderr || ""}`);
  writeFileSync(join(evidence, `${label}.log`), `COMMAND=${label}\nEXIT_CODE=${result.status}\n${output}`);
  if (result.status !== 0) throw new Error(`${label}_FAILED:${output.slice(-1200)}`);
  return output;
};

let started = false;
let result = "FAIL";
let teardown = "FAIL";
let firstFailure = "";
try {
  const bootstrap = run("node", ["tools/local-db/lib/bootstrap.mjs","--project-id",project,"--db-port","56440","--runtime-dir",runtime,"--reset-runtime"], 900000);
  requireOk("bootstrap", bootstrap);
  started = true;
  requireOk("migrations", run("supabase", ["db","reset","--workdir",runtime], 900000));
  requireOk("fixture-copy", run("docker", ["cp",join(root,"test/megatrain-authz/nominal-matrix.sql"),`${container}:/tmp/megatrain-authz.sql`], 120000));
  const matrix = requireOk("authz-nominal", run("docker", ["exec",container,"psql","-U","postgres","-d","postgres","-X","-v","ON_ERROR_STOP=1","-f","/tmp/megatrain-authz.sql"], 300000));
  for (const marker of ["AUTHZ_NOMINAL_MATRIX=PASS","AUTHZ_TABLES=7","AUTHZ_NEGATIVE_CASES=16","AUTHZ_MUTANTS=8"]) {
    if (!matrix.includes(marker)) throw new Error(`MARKER_MISSING:${marker}`);
  }
  const policySql = "select coalesce(json_agg(row_to_json(p)),'[]'::json)::text from (select schemaname,tablename,policyname,cmd,permissive,roles from pg_policies where schemaname='public' order by tablename,policyname) p";
  const policyExport = run("docker", ["exec",container,"psql","-U","postgres","-d","postgres","-X","-Aqt","-c",policySql], 120000);
  requireOk("policy-snapshot-export", policyExport);
  const policySnapshot = join(evidence, "policy_snapshot.json");
  writeFileSync(policySnapshot, String(policyExport.stdout || "").trim() + "\n");
  const policyGate = spawnSync("node", ["tools/policy-inventory-gate.mjs","."], {
    cwd: root,
    env: { ...env, POLICY_SNAPSHOT: policySnapshot },
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeout: 120000,
  });
  requireOk("policy-inventory-gate", policyGate);
  const residualSql = "select (select count(*) from auth.users where raw_user_meta_data->>'fixture'='megatrain') || ',' || (select count(*) from public.tickets where folio like 'MEGA-%')";
  const residual = requireOk("residuals", run("docker", ["exec",container,"psql","-U","postgres","-d","postgres","-X","-Aqt","-c",residualSql], 120000));
  if (!residual.trim().endsWith("0,0")) throw new Error(`RESIDUALS_NONZERO:${residual.trim()}`);
  result = "PASS";
} catch (error) {
  firstFailure = redact(error?.message || error);
} finally {
  if (started || existsSync(runtime)) {
    const stop = run("node", ["tools/local-db/lib/bootstrap.mjs","--project-id",project,"--runtime-dir",runtime,"--stop","--remove-runtime"], 300000);
    writeFileSync(join(evidence,"teardown.log"), `EXIT_CODE=${stop.status}\n${redact(`${stop.stdout || ""}${stop.stderr || ""}`)}`);
    if (stop.status !== 0) { result = "FAIL"; firstFailure ||= "TEARDOWN_FAILED"; }
  }
  const remaining = run("docker", ["ps","-a","--filter",`name=${project}`,"--format","{{.Names}}"], 120000);
  const residue = String(remaining.stdout || "").trim();
  if (remaining.status !== 0 || residue) { result = "FAIL"; firstFailure ||= `CONTAINER_RESIDUAL:${residue}`; }
  else teardown = "PASS";
  writeFileSync(join(evidence,"00-authz-runtime.txt"), [
    `AUTHZ_NOMINAL_MATRIX=${result}`,
    `AUTHZ_TABLES=${result === "PASS" ? 7 : 0}`,
    `AUTHZ_NEGATIVE_CASES=${result === "PASS" ? 16 : 0}`,
    `AUTHZ_MUTANTS=${result === "PASS" ? 8 : 0}`,
    `RESIDUAL_ROWS=${result === "PASS" ? 0 : "UNKNOWN"}`,
    `RESIDUAL_USERS=${result === "PASS" ? 0 : "UNKNOWN"}`,
    `TEARDOWN=${teardown}`,
    `FIRST_FAILURE=${firstFailure || "NONE"}`,
  ].join("\n") + "\n");
}
console.log(`AUTHZ_NOMINAL_MATRIX=${result}`);
console.log(`AUTHZ_TABLES=${result === "PASS" ? 7 : 0}`);
console.log(`AUTHZ_NEGATIVE_CASES=${result === "PASS" ? 16 : 0}`);
console.log(`AUTHZ_MUTANTS=${result === "PASS" ? 8 : 0}`);
console.log(`TEARDOWN=${teardown}`);
if (firstFailure) console.error(`FIRST_FAILURE=${firstFailure}`);
process.exit(result === "PASS" ? 0 : 1);
