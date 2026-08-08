#!/usr/bin/env node
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(process.argv[2] || ".");
const files = [
  "supabase/functions/_shared/support-request-contract.ts",
  "supabase/functions/support-submit-secure/index.ts",
  "app/soporte.js",
  "app/soporte.html",
  "tools/support-handler-wiring.test.mjs",
  "tools/edge-anon-response-gate.mjs",
];
const mutants = [
  { id: "M01", file: "supabase/functions/support-submit-secure/index.ts", from: 'if(req.method!=="POST")return json({message:"Method not allowed",code:"METHOD_NOT_ALLOWED"},405);', to: 'if(false)return json({message:"Method not allowed",code:"METHOD_NOT_ALLOWED"},405);' },
  { id: "M02", file: "supabase/functions/_shared/support-request-contract.ts", from: 'if (!origin) return fail("ORIGIN_REQUIRED");', to: 'if (false && !origin) return fail("ORIGIN_REQUIRED");' },
  { id: "M03", file: "supabase/functions/_shared/support-request-contract.ts", from: 'if (parts.shift()?.toLowerCase() !== "multipart/form-data") return fail("CONTENT_TYPE_UNSUPPORTED");', to: 'if (false) return fail("CONTENT_TYPE_UNSUPPORTED");' },
  { id: "M04", file: "supabase/functions/_shared/support-request-contract.ts", from: "{1,70}", to: "{1,700}" },
  { id: "M05", file: "supabase/functions/_shared/support-request-contract.ts", from: 'if (encoding !== null && encoding.trim().toLowerCase() !== "identity") {', to: 'if (false && encoding !== null && encoding.trim().toLowerCase() !== "identity") {' },
  { id: "M06", file: "supabase/functions/_shared/support-request-contract.ts", from: "if (total > maxBodyBytes) {", to: "if (false && total > maxBodyBytes) {" },
  { id: "M07", file: "supabase/functions/_shared/support-request-contract.ts", from: 'if (!match || typeof value === "string" || indexedFiles.has(Number(match[1]))) {', to: 'if (typeof value === "string" || indexedFiles.has(Number(match[1]))) {' },
  { id: "M08", file: "supabase/functions/support-submit-secure/index.ts", from: "const dtoResult=parsePublicSupportDto(parsedPayload);", to: "const dtoResult={ok:true,value:parsedPayload as PublicSupportDto};" },
  { id: "M09", file: "app/soporte.js", from: '"match_score"\n  ].forEach(key=>delete payload[key]);', to: '"match_score_disabled"\n  ].forEach(key=>delete payload[key]);' },
  { id: "M10", file: "supabase/functions/support-submit-secure/index.ts", from: "const attachmentResult=await validateAttachmentBatch(attachmentInputs);", to: "const attachmentResult={ok:true,value:[] as readonly ValidatedAttachment[]};" },
  { id: "M11", file: "supabase/functions/support-submit-secure/index.ts", from: 'try{\n    // VALIDATION_BARRIER_REACHED\n    validationBarrierReached=true;\n    const rlOk=await rateLimit("support_submit",ip,5,10);', to: 'try{\n    const rlOk=await rateLimit("support_submit",ip,5,10);\n    // VALIDATION_BARRIER_REACHED\n    validationBarrierReached=true;' },
  { id: "M12", file: "supabase/functions/_shared/support-request-contract.ts", from: 'response.hostname !== expected.hostname', to: 'response.hostname !== response.hostname' },
  { id: "M13", file: "supabase/functions/_shared/support-request-contract.ts", from: 'response.action !== expected.action', to: 'response.action !== response.action' },
  { id: "M14", file: "supabase/functions/_shared/support-request-contract.ts", from: "expected.nowMs - challengeMs > TURNSTILE_MAX_AGE_MS", to: "expected.nowMs - challengeMs > Number.POSITIVE_INFINITY" },
  { id: "M15", file: "supabase/functions/_shared/support-request-contract.ts", from: "export const TURNSTILE_FETCH_TIMEOUT_MS = 5_000;", to: "export const TURNSTILE_FETCH_TIMEOUT_MS = 50_000;" },
  { id: "M16", file: "supabase/functions/support-submit-secure/index.ts", from: "${escapeHtml(titulo)}", to: "${titulo}" },
  { id: "M17", file: "supabase/functions/support-submit-secure/index.ts", from: "subject:sanitizeEmailSubject(`Recibimos su solicitud ${folio}`)", to: "subject:`Recibimos su solicitud ${folio}`" },
  { id: "M18", file: "supabase/functions/support-submit-secure/index.ts", from: 'const resp:PublicSuccessResponse={ok:true,folio,token_publico,status:"ticket_creado"};', to: 'const resp={ok:true,folio,token_publico,status:"ticket_creado",ticket_id:ticket.id};' },
];

let killed = 0;
for (const mutant of mutants) {
  const sandbox = mkdtempSync(join(tmpdir(), `support-handler-${mutant.id}-`));
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
    const result = spawnSync(process.execPath, [
      "--experimental-strip-types",
      join(sandbox, "tools/support-handler-wiring.test.mjs"),
      sandbox,
    ], { cwd: sandbox, encoding: "utf8" });
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

assert.equal(killed, 18);
console.log(`HANDLER_WIRING_SENSITIVITY: PASS (mutants=18 killed=${killed})`);
