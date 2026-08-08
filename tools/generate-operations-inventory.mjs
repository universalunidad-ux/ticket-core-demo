#!/usr/bin/env node
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = join(root, "governance/operations-contract.json");
const REQUIRED_SECTIONS = ["diagnose", "contain", "recover", "verify", "evidence"];

export function loadOperations(path = sourcePath) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function validateOperations(source) {
  const failures = [];
  if (source.schemaVersion !== 1) failures.push("SCHEMA_VERSION_INVALID");
  if (!Array.isArray(source.runbooks) || source.runbooks.length < 3) failures.push("RUNBOOK_INVENTORY_INCOMPLETE");
  const ids = new Set();
  for (const runbook of source.runbooks || []) {
    if (!runbook.id || ids.has(runbook.id)) failures.push(`RUNBOOK_ID_DUPLICATE_OR_MISSING:${runbook.id || "EMPTY"}`);
    ids.add(runbook.id);
    if (!runbook.trigger) failures.push(`RUNBOOK_TRIGGER_MISSING:${runbook.id}`);
    for (const section of REQUIRED_SECTIONS) {
      if (!Array.isArray(runbook[section]) || runbook[section].length < 2) failures.push(`RUNBOOK_SECTION_INCOMPLETE:${runbook.id}:${section}`);
    }
  }
  const allowed = new Set(source.logContract?.allowedFields || []);
  for (const required of ["timestamp", "unit", "phase", "scenario", "step", "result", "code", "head"]) {
    if (!allowed.has(required)) failures.push(`LOG_FIELD_MISSING:${required}`);
  }
  if ((source.logContract?.forbiddenKeyPatterns || []).length < 8) failures.push("LOG_FORBIDDEN_KEYS_INCOMPLETE");
  return { ok: failures.length === 0, failures };
}

export function sanitizeEvent(source, event) {
  const validation = validateOperations(source);
  if (!validation.ok) throw new Error(validation.failures.join(","));
  const forbidden = source.logContract.forbiddenKeyPatterns.map((pattern) => new RegExp(pattern, "i"));
  for (const key of Object.keys(event)) {
    if (forbidden.some((pattern) => pattern.test(key))) throw new Error(`FORBIDDEN_LOG_FIELD:${key}`);
    if (!source.logContract.allowedFields.includes(key)) throw new Error(`UNKNOWN_LOG_FIELD:${key}`);
  }
  if (!source.logContract.results.includes(event.result)) throw new Error("LOG_RESULT_INVALID");
  if (!/^[0-9a-f]{40}$/.test(event.head || "")) throw new Error("LOG_HEAD_INVALID");
  return Object.fromEntries(source.logContract.allowedFields.filter((key) => key in event).map((key) => [key, event[key]]));
}

export function renderOperations(source) {
  const validation = validateOperations(source);
  if (!validation.ok) throw new Error(validation.failures.join(","));
  const lines = [
    "# Local operations runbooks",
    "",
    "> Generated from `governance/operations-contract.json` by `tools/generate-operations-inventory.mjs`; do not edit manually. These procedures authorize local-only actions.",
    ""
  ];
  for (const runbook of source.runbooks) {
    lines.push(`## ${runbook.id} — ${runbook.title}`, "", `Trigger: ${runbook.trigger}`, "");
    for (const section of REQUIRED_SECTIONS) {
      lines.push(`### ${section[0].toUpperCase()}${section.slice(1)}`, "");
      runbook[section].forEach((item, index) => lines.push(`${index + 1}. ${item}`));
      lines.push("");
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function main(argv) {
  let outDir = join(root, "docs/generated");
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out-dir") outDir = resolve(argv[++i]);
    else throw new Error(`ARGUMENT_INVALID:${argv[i]}`);
  }
  const source = loadOperations();
  const validation = validateOperations(source);
  if (!validation.ok) throw new Error(validation.failures.join(","));
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "LOCAL_OPERATIONS_RUNBOOKS.md"), renderOperations(source));
  writeFileSync(join(outDir, "operations-inventory.json"), `${JSON.stringify({ schemaVersion: 1, runbooks: source.runbooks.map(({ id, title, evidence }) => ({ id, title, evidence })) }, null, 2)}\n`);
  console.log(`RUNBOOK_COUNT=${source.runbooks.length}`);
  console.log("OPERATIONS_INVENTORY=PASS");
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) main(process.argv.slice(2));
