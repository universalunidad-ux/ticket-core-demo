#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildArtifacts, loadSource } from "./generate-requirement-traceability.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contractPath = join(root, "governance/governance-trace-contract.json");
const evidencePath = join(root, "docs/generated/GOVERNANCE_TRACE_EVIDENCE.json");
const REQUIRED_IDS = ["GOV-G0-003", "GOV-TRACE-001", "PROD170-002", "TC-U005", "TC-U078"];
const PROHIBITED_IDS = ["U0-A", "U0-B", "U0-C", "U0-D"];
const DISPOSITIONS = new Set(["PROMOTABLE_LOCAL", "CONTRACT_CLOSED_NO_DELTA", "PENDING_LEDGER_RECONCILIATION"]);

export function loadGovernanceContract(path = contractPath) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function loadGovernanceEvidence(path = evidencePath) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function safeRepositoryPath(path) {
  return typeof path === "string" && path.length > 0 && !path.startsWith("/") && !path.split("/").includes("..");
}

export function validateGovernanceContract(contract, source = loadSource(), repositoryRoot = root) {
  const failures = [];
  if (contract.schemaVersion !== 1) failures.push("SCHEMA_VERSION_INVALID");
  if (!/^[0-9a-f]{40}$/.test(contract.baseHead || "")) failures.push("BASE_HEAD_INVALID");
  if (JSON.stringify(contract.prohibitedRequirements) !== JSON.stringify(PROHIBITED_IDS)) failures.push("PROHIBITED_SCOPE_INVALID");
  const ids = (contract.requirements || []).map((row) => row.id);
  if (JSON.stringify(ids) !== JSON.stringify(REQUIRED_IDS)) failures.push("TARGET_SCOPE_INVALID");
  if (new Set(ids).size !== ids.length) failures.push("TARGET_ID_DUPLICATE");
  if (ids.some((id) => PROHIBITED_IDS.includes(id))) failures.push("U0_ROW_CLAIMED");

  const sourceArtifacts = buildArtifacts(source, source.base).traceability;
  const sourceById = new Map(sourceArtifacts.rows.map((row) => [row.id, row]));
  for (const row of contract.requirements || []) {
    const sourceRow = sourceById.get(row.id);
    if (!sourceRow) {
      failures.push(`SOURCE_ROW_MISSING:${row.id}`);
      continue;
    }
    if (!row.claim) failures.push(`CLAIM_MISSING:${row.id}`);
    if (!DISPOSITIONS.has(row.disposition)) failures.push(`DISPOSITION_INVALID:${row.id}`);
    if (row.sourceDecision !== sourceRow.decision) failures.push(`SOURCE_DECISION_DRIFT:${row.id}`);
    if (row.test !== sourceRow.test) failures.push(`TEST_OWNER_DRIFT:${row.id}`);
    if (row.expectedDelta !== sourceRow.proposedDelta) failures.push(`DELTA_DRIFT:${row.id}`);
    if (row.evidence !== "docs/generated/GOVERNANCE_TRACE_EVIDENCE.json") failures.push(`EVIDENCE_PATH_INVALID:${row.id}`);
    if (!Array.isArray(row.supportingTests)) failures.push(`SUPPORTING_TESTS_INVALID:${row.id}`);
    const paths = [...(row.implementationFiles || []), row.test, ...(row.supportingTests || [])];
    if (!Array.isArray(row.implementationFiles) || row.implementationFiles.length === 0) failures.push(`IMPLEMENTATION_FILES_MISSING:${row.id}`);
    for (const path of paths) {
      if (!safeRepositoryPath(path)) failures.push(`REPOSITORY_PATH_INVALID:${row.id}:${path}`);
      else if (!existsSync(join(repositoryRoot, path))) failures.push(`REPOSITORY_FILE_MISSING:${row.id}:${path}`);
    }
    if (row.disposition !== "PROMOTABLE_LOCAL" && row.expectedDelta !== 0) failures.push(`NON_PROMOTABLE_DELTA:${row.id}`);
  }
  return { ok: failures.length === 0, failures };
}

export function buildGovernanceEvidence(contract, closureCommit, source = loadSource()) {
  const validation = validateGovernanceContract(contract, source);
  if (!validation.ok) throw new Error(validation.failures.join(","));
  if (!/^[0-9a-f]{40}$/.test(closureCommit || "")) throw new Error("CLOSURE_COMMIT_INVALID");
  return {
    schemaVersion: 1,
    unit: contract.unit,
    baseHead: contract.baseHead,
    closureCommit,
    logicalDelta: "PENDING_LEDGER_RECONCILIATION",
    u0RowsClaimed: false,
    rows: contract.requirements.map((row) => ({
      requirement: row.id,
      claim: row.claim,
      files: row.implementationFiles,
      test: row.test,
      supportingTests: row.supportingTests,
      commit: closureCommit,
      evidence: row.evidence,
      disposition: row.disposition,
      proposedDelta: row.expectedDelta
    }))
  };
}

function git(repositoryRoot, args) {
  return spawnSync("git", args, { cwd: repositoryRoot, encoding: "utf8" });
}

export function verifyRepositoryProvenance(contract, evidence, repositoryRoot = root) {
  const failures = [];
  const top = git(repositoryRoot, ["rev-parse", "--show-toplevel"]);
  if (top.status !== 0 || resolve(top.stdout.trim()) !== resolve(repositoryRoot)) failures.push("REPOSITORY_ROOT_INVALID");
  for (const [label, commit] of [["BASE", contract.baseHead], ["CLOSURE", evidence.closureCommit]]) {
    const ancestor = git(repositoryRoot, ["merge-base", "--is-ancestor", commit, "HEAD"]);
    if (ancestor.status !== 0) failures.push(`${label}_COMMIT_NOT_ANCESTOR`);
  }
  for (const row of evidence.rows || []) {
    if (row.commit !== evidence.closureCommit) failures.push(`ROW_COMMIT_DRIFT:${row.requirement}`);
    for (const path of [...(row.files || []), row.test, ...(row.supportingTests || [])]) {
      const tracked = git(repositoryRoot, ["ls-files", "--error-unmatch", path]);
      if (tracked.status !== 0) failures.push(`FILE_NOT_TRACKED:${row.requirement}:${path}`);
      const atCommit = git(repositoryRoot, ["cat-file", "-e", `${row.commit}:${path}`]);
      if (atCommit.status !== 0) failures.push(`FILE_ABSENT_AT_COMMIT:${row.requirement}:${path}`);
    }
  }
  const contractRelative = relative(repositoryRoot, contractPath);
  const generatorRelative = relative(repositoryRoot, fileURLToPath(import.meta.url));
  for (const path of [contractRelative, generatorRelative, "tools/governance-trace-contract.test.mjs"]) {
    const atClosure = git(repositoryRoot, ["cat-file", "-e", `${evidence.closureCommit}:${path}`]);
    if (atClosure.status !== 0) failures.push(`CLOSURE_FILE_ABSENT:${path}`);
  }
  return { ok: failures.length === 0, failures };
}

function main(argv) {
  let output = evidencePath;
  let closureCommit = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--commit") closureCommit = argv[++i];
    else if (argv[i] === "--output") output = resolve(argv[++i]);
    else throw new Error(`ARGUMENT_INVALID:${argv[i]}`);
  }
  const evidence = buildGovernanceEvidence(loadGovernanceContract(), closureCommit);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`GOVERNANCE_TRACE_ROWS=${evidence.rows.length}`);
  console.log(`PROMOTABLE_ROWS=${evidence.rows.filter((row) => row.disposition === "PROMOTABLE_LOCAL").map((row) => row.requirement).join(",")}`);
  console.log("LOGICAL_DELTA=PENDING_LEDGER_RECONCILIATION");
  console.log("GOVERNANCE_TRACE_GENERATION=PASS");
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) main(process.argv.slice(2));
