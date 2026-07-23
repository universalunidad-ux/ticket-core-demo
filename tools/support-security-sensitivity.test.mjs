#!/usr/bin/env node
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(process.argv[2] || ".");
const files = [
  "app/janome/janome_catalogo.js",
  "supabase/functions/_shared/support-catalog.ts",
  "supabase/functions/_shared/security-primitives.ts",
  "supabase/functions/_shared/upload-contract.ts",
  "supabase/functions/_shared/support-contract.ts",
  "tools/run-contract-tests.mjs",
];

const mutants = [
  { id: "M01", file: "supabase/functions/_shared/support-contract.ts", from: "if (unknownKeys.length > 0) {", to: "if (false && unknownKeys.length > 0) {" },
  { id: "M02", file: "supabase/functions/_shared/support-contract.ts", from: "issues.push(frozenIssue(\"DTO_SERVER_OWNED_PROPERTY\", key))", to: "issues.push(frozenIssue(\"DTO_UNKNOWN_PROPERTY\", key))" },
  { id: "M03", file: "supabase/functions/_shared/support-catalog.ts", from: "return typeof v === \"string\" && (SUPPORT_CATEGORIES as readonly string[]).includes(v);", to: "return typeof v === \"string\";" },
  { id: "M04", file: "supabase/functions/_shared/support-catalog.ts", from: "return typeof v === \"string\" && (SUPPORT_IMPACTS as readonly string[]).includes(v);", to: "return typeof v === \"string\";" },
  { id: "M05", file: "supabase/functions/_shared/support-catalog.ts", from: "if (!v.startsWith(\"Otro: \")) return null;", to: "if (!v.startsWith(\"Otro: \")) return Object.freeze({ kind: \"other\", label: v });" },
  { id: "M06", file: "supabase/functions/_shared/support-contract.ts", from: "const domainOk = labels.length >= 2 && labels.every", to: "const domainOk = labels.length >= 1 && labels.every" },
  { id: "M07", file: "supabase/functions/_shared/support-contract.ts", from: "if (!/^\\d{10}$/u.test(raw)) {", to: "if (!/^\\d{10,}$/u.test(raw)) {" },
  { id: "M08", file: "supabase/functions/_shared/support-contract.ts", from: "if ((from === null) !== (to === null) ||", to: "if (false ||" },
  { id: "M09", file: "supabase/functions/_shared/support-contract.ts", from: "if (controlRe.test(controlInput)) {", to: "if (false && controlRe.test(controlInput)) {" },
  { id: "M10", file: "supabase/functions/_shared/support-contract.ts", from: "version: canonical.version,", to: "version: undefined," },
  { id: "M11", file: "supabase/functions/_shared/security-primitives.ts", from: ").join(\"\");", to: ").join(\"\").slice(0, 32);" },
  { id: "M12", file: "supabase/functions/_shared/upload-contract.ts", from: "if (rule && mimeAllowed && !rule.mimeTypes.includes(mimeType))", to: "if (false && rule && mimeAllowed && !rule.mimeTypes.includes(mimeType))" },
  { id: "M13", file: "supabase/functions/_shared/upload-contract.ts", from: "rule.detectedType !== detectedType", to: "rule.category !== (detectedType === \"pdf\" ? \"pdf\" : [\"mp4\", \"mov\", \"m4v\"].includes(detectedType) ? \"video\" : \"image\")" },
  { id: "M14", file: "supabase/functions/_shared/security-primitives.ts", from: "const basename = input.replaceAll(\"\\\\\", \"/\").split(\"/\").pop() || \"\";", to: "const basename = input;" },
  { id: "M15", file: "supabase/functions/_shared/security-primitives.ts", from: ".replaceAll(\"&\", \"&amp;\")", to: ".replaceAll(\"&\", \"&\")" },
  { id: "M16", file: "supabase/functions/_shared/security-primitives.ts", from: ".normalize(\"NFKC\")\n    .replace(/[\\u0000-\\u001f\\u007f]/gu, \"\")\n    .replace(/\\s+/gu, \" \")", to: ".normalize(\"NFKC\")\n    .replace(/[\\u0000-\\u001f\\u007f]/gu, \"$&\")\n    .replace(/[^\\s\\S]/gu, \" \")" },
];

let killed = 0;
for (const mutant of mutants) {
  const sandbox = mkdtempSync(join(tmpdir(), `support-security-${mutant.id}-`));
  try {
    for (const relative of files) {
      const destination = join(sandbox, relative);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(join(root, relative), destination);
    }
    const target = join(sandbox, mutant.file);
    const source = readFileSync(target, "utf8");
    const occurrences = source.split(mutant.from).length - 1;
    assert.equal(occurrences, 1, `${mutant.id}: mutation anchor count=${occurrences}`);
    writeFileSync(target, source.replace(mutant.from, mutant.to));
    const result = spawnSync(process.execPath, ["--experimental-strip-types", join(sandbox, "tools/run-contract-tests.mjs"), sandbox, "--kill", mutant.id], {
      cwd: sandbox,
      encoding: "utf8",
    });
    if (result.status === 0) {
      process.stderr.write(result.stdout || "");
      process.stderr.write(result.stderr || "");
      throw new Error(`${mutant.id}: SURVIVED`);
    }
    killed++;
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

assert.equal(killed, 16);
console.log(`SENSITIVITY_TESTS: PASS (mutants=16 killed=${killed})`);
