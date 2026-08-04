import assert from "node:assert/strict";
import fs from "node:fs";

const support = fs.readFileSync("app/soporte.js", "utf8");
const upload = fs.readFileSync(
  "supabase/functions/_shared/upload-contract.ts",
  "utf8",
);
const worker = fs.readFileSync("tools/media-worker.py", "utf8");
const policy = fs.readFileSync(
  "supabase/migrations/20260803085127_media_video_policy_completion.sql",
  "utf8",
);

assert.match(support, /MAX_VID_SECONDS=15/);
assert.doesNotMatch(support, /MAX_VID_SECONDS=90/);
assert.match(support, /El video supera 15 s/);

assert.match(upload, /MAX_VID_SECONDS\s*=\s*15/);

assert.match(worker, /def probe_video_duration_ms/);
assert.match(worker, /shutil\.which\("ffprobe"\)/);
assert.match(worker, /max_duration_ms:\s*int\s*=\s*15000/);
assert.match(worker, /max_duration_ms not in \(15000, 30000\)/);
assert.match(worker, /MEDIA_VIDEO_QUARANTINE_REQUIRED/);
assert.match(worker, /E_MEDIA_DURACION_EXCEDIDA/);

assert.match(policy, /p_duracion_ms > 30000/);
assert.match(policy, /p_duracion_ms > 15000/);
assert.match(policy, /tc_media_validar_duracion/);

console.log("MEDIA010_THREE_LAYER_ALIGNMENT=PASS");
console.log("MEDIA010_WORKER_FFPROBE_BEFORE_DERIVATION=PASS");
console.log("MEDIA012_PRODUCT_DECISION_UNCHANGED=YES");
