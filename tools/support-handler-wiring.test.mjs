#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(process.argv[2] || ".");
const ownerPath = join(root, "supabase/functions/_shared/support-request-contract.ts");
const handlerPath = join(root, "supabase/functions/support-submit-secure/index.ts");
const callerPath = join(root, "app/soporte.js");
const htmlPath = join(root, "app/soporte.html");
const owner = await import(pathToFileURL(ownerPath).href);
const handlerSource = readFileSync(handlerPath, "utf8");
const callerSource = readFileSync(callerPath, "utf8");
const htmlSource = readFileSync(htmlPath, "utf8");
let positive = 0;
let negative = 0;

const pos = async (name, fn) => {
  await fn();
  positive++;
  assert.ok(name);
};
const neg = async (name, fn) => {
  await fn();
  negative++;
  assert.ok(name);
};
const allowedOrigins = new Set(["https://allowed.example"]);
const headers = (extra = {}) => new Headers({
  origin: "https://allowed.example",
  "content-type": "multipart/form-data; boundary=valid-boundary",
  ...extra,
});
const expectCode = (result, code) => {
  assert.equal(result.ok, false, `se esperaba ${code}`);
  assert.equal(result.code, code);
};
const inspectOk = (value) => {
  const result = owner.inspectSupportRequestHeaders(value, allowedOrigins, 1024);
  assert.equal(result.ok, true, result.ok ? "" : result.code);
  return result.value;
};
const multipartBytes = async (entries) => {
  const form = new FormData();
  for (const [name, value, filename] of entries) {
    if (filename) form.append(name, value, filename);
    else form.append(name, value);
  }
  const request = new Request("http://multipart.local/", { method: "POST", body: form });
  return {
    bytes: new Uint8Array(await request.arrayBuffer()),
    contentType: request.headers.get("content-type"),
  };
};
const parseMultipart = async (entries) => {
  const input = await multipartBytes(entries);
  return owner.parseSupportMultipartBody(input.bytes, input.contentType);
};
const turnstile = (overrides = {}) => ({
  success: true,
  hostname: "allowed.example",
  action: "support_submit",
  challenge_ts: new Date(1_000_000).toISOString(),
  ...overrides,
});
const expectedTurnstile = (nowMs = 1_000_000) => ({
  hostname: "allowed.example",
  action: owner.SUPPORT_TURNSTILE_ACTION,
  nowMs,
});
const marker = "// VALIDATION_BARRIER_REACHED";
const handlerStart = handlerSource.indexOf("export const handler");
const markerIndex = handlerSource.indexOf(marker, handlerStart);
const beforeBarrier = handlerSource.slice(handlerStart, markerIndex);
const afterBarrier = handlerSource.slice(markerIndex + marker.length);
const writePatterns = [
  /\brateLimit\s*\(/u, /\blogSecurity\s*\(/u, /\bsb\.rpc\s*\(/u,
  /\.insert\s*\(/u, /\.update\s*\(/u, /\.delete\s*\(/u,
  /\.upload\s*\(/u, /\.remove\s*\(/u, /\bgetNextFolio\s*\(/u,
  /\baddTicketEvento\s*\(/u, /\baddArchivoTicket\s*\(/u,
];
const publicFields = [
  "nombre", "empresa", "correo", "telefono", "categoria", "sistema", "objetivo",
  "titulo", "descripcion", "impacto", "canal", "desde_cuando", "afecta_a",
  "cambio_previo", "horario_disponible", "horario_desde", "horario_hasta",
  "horario_notas", "contexto_extra", "remote_access",
];
const serverOwnedCallerFields = [
  "cliente_id", "contacto_id", "cliente_id_confirmado", "contacto_id_confirmado",
  "empresa_confirmada", "contacto_confirmado", "contacto_es_nuevo",
  "cliente_id_sugerido", "contacto_id_sugerido", "match_nivel", "match_score",
];

await pos("P01 headers exactos", () => assert.equal(inspectOk(headers()).boundary, "valid-boundary"));
await pos("P02 media case-insensitive y boundary quoted", () => {
  const result = owner.inspectSupportRequestHeaders(headers({ "content-type": 'Multipart/Form-Data; boundary="Quoted_1"' }), allowedOrigins, 1024);
  assert.equal(result.ok && result.value.boundary, "Quoted_1");
});
await pos("P03 Content-Encoding identity", () => assert.equal(inspectOk(headers({ "content-encoding": "identity" })).hostname, "allowed.example"));
await pos("P04 stream en límite", async () => {
  const result = await owner.readBoundedRequestBody(new Blob(["1234"]).stream(), 4);
  assert.equal(result.ok && result.value.byteLength, 4);
});
await pos("P05 multipart sin archivos", async () => {
  const result = await parseMultipart([["payload", "{}"], ["turnstile_token", "token"]]);
  assert.equal(result.ok && result.value.files.length, 0);
});
await pos("P06 multipart archivos contiguos", async () => {
  const result = await parseMultipart([
    ["payload", "{}"], ["turnstile_token", "token"],
    ["file_0", new Blob(["a"], { type: "image/jpeg" }), "a.jpg"],
    ["file_1", new Blob(["b"], { type: "application/pdf" }), "b.pdf"],
  ]);
  assert.equal(result.ok && result.value.files.length, 2);
});
await pos("P07 honeypots reconocidos vacíos", async () => {
  const result = await parseMultipart([["payload", "{}"], ["turnstile_token", "token"], ["website", ""], ["hp_field", ""]]);
  assert.equal(result.ok && result.value.honeypot, "");
});
await pos("P08 Siteverify exacto", () => assert.equal(owner.validateTurnstileSiteverify(turnstile(), expectedTurnstile()).ok, true));
await pos("P09 edad exacta", () => assert.equal(owner.validateTurnstileSiteverify(turnstile(), expectedTurnstile(1_300_000)).ok, true));
await pos("P10 skew exacto", () => assert.equal(owner.validateTurnstileSiteverify(turnstile(), expectedTurnstile(970_000)).ok, true));
await pos("P11 DTO owner conectado", () => assert.match(beforeBarrier, /parsePublicSupportDto\s*\(\s*parsedPayload\s*\)/u));
await pos("P12 upload owner conectado", () => assert.match(beforeBarrier, /validateAttachmentBatch\s*\(\s*attachmentInputs\s*\)/u));
await pos("P13 HTML y subject owners conectados", () => {
  assert.match(handlerSource, /escapeHtml\s*\(/u);
  assert.match(handlerSource, /subject\s*:\s*sanitizeEmailSubject\s*\(/u);
  assert.match(htmlSource, /class="cf-turnstile"[^>]*data-action="support_submit"/u);
});
await pos("P14 barrera única y writes cero", () => {
  assert.equal(handlerSource.split(marker).length - 1, 1);
  assert.match(beforeBarrier, /if\(req\.method!=="POST"\)/u);
  assert.equal(writePatterns.filter((pattern) => pattern.test(beforeBarrier)).length, 0);
  const order = ["inspectSupportRequestHeaders", "readBoundedRequestBody", "parseSupportMultipartBody", "parsePublicSupportDto", "arrayBuffer", "validateAttachmentBatch", "verifyTurnstile"];
  let cursor = -1;
  for (const token of order) {
    const next = beforeBarrier.indexOf(token, cursor + 1);
    assert.ok(next > cursor, `${token} fuera de orden`);
    cursor = next;
  }
  assert.match(afterBarrier, /^\s*validationBarrierReached=true;\s*const rlOk=await rateLimit/u);
});
await pos("P15 caller transmite 20 campos", () => {
  const payloadLine = callerSource.match(/const publicPayload=\(\)=>\(\{([^\n]+)\}\);/u)?.[1] || "";
  const payloadKeys = [...payloadLine.matchAll(/(?:^|,)([a-z_]+):/gu)].map((match) => match[1]);
  const deletionBlock = callerSource.match(/\[\s*"cliente_id"[\s\S]*?\]\.forEach\(key=>delete payload\[key\]\);/u)?.[0] || "";
  const deleted = serverOwnedCallerFields.filter((field) => deletionBlock.includes(`"${field}"`));
  assert.deepEqual([...new Set(payloadKeys.filter((key) => !deleted.includes(key)))].sort(), [...publicFields].sort());
});
await pos("P16 FormData e idempotencia intactos", () => {
  assert.match(callerSource, /fd\.append\("turnstile_token",TURNSTILE_TOKEN\)/u);
  assert.match(callerSource, /fd\.append\("payload",JSON\.stringify\(payload\)\)/u);
  assert.match(callerSource, /fd\.append\(`file_\$\{i\}`/u);
  assert.match(callerSource, /headers:\{"Idempotency-Key":ST\.idemKey\}/u);
});
await pos("P17 éxito exacto", () => {
  const result = spawnSync(process.execPath, [join(root, "tools/edge-anon-response-gate.mjs"), root], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const resp = handlerSource.match(/const resp:PublicSuccessResponse=\{([^}]+)\}/u)?.[1] || "";
  assert.deepEqual(resp.split(",").map((item) => item.trim().split(":")[0]).sort(), ["folio", "ok", "status", "token_publico"]);
});
await pos("P18 correo dinámico escapado", () => {
  const template = handlerSource.match(/html:`([\s\S]*?)`,\s*\}\)\.catch/u)?.[1] || "";
  const interpolations = [...template.matchAll(/\$\{([^}]+)\}/gu)].map((match) => match[1]);
  assert.ok(interpolations.length >= 6);
  assert.ok(interpolations.every((value) => /^escapeHtml\(/u.test(value)));
});

await neg("N01 Origin ausente", () => expectCode(owner.inspectSupportRequestHeaders(new Headers({ "content-type": "multipart/form-data; boundary=x" }), allowedOrigins, 1024), "ORIGIN_REQUIRED"));
await neg("N02 Origin lookalike", () => {
  for (const origin of ["https://allowed.example.evil", "https://evil-allowed.example"]) {
    expectCode(owner.inspectSupportRequestHeaders(headers({ origin }), allowedOrigins, 1024), "ORIGIN_NOT_ALLOWED");
  }
});
await neg("N03 Content-Type ausente", () => expectCode(owner.inspectSupportRequestHeaders(new Headers({ origin: "https://allowed.example" }), allowedOrigins, 1024), "CONTENT_TYPE_REQUIRED"));
await neg("N04 JSON no soportado", () => expectCode(owner.inspectSupportRequestHeaders(headers({ "content-type": "application/json" }), allowedOrigins, 1024), "CONTENT_TYPE_UNSUPPORTED"));
await neg("N05 substring multipart", () => expectCode(owner.inspectSupportRequestHeaders(headers({ "content-type": "text/plain; note=multipart/form-data" }), allowedOrigins, 1024), "CONTENT_TYPE_UNSUPPORTED"));
await neg("N06 boundary ausente", () => expectCode(owner.inspectSupportRequestHeaders(headers({ "content-type": "multipart/form-data" }), allowedOrigins, 1024), "MULTIPART_BOUNDARY_REQUIRED"));
await neg("N07 boundary duplicado", () => expectCode(owner.inspectSupportRequestHeaders(headers({ "content-type": "multipart/form-data; boundary=a; boundary=b" }), allowedOrigins, 1024), "MULTIPART_BOUNDARY_INVALID"));
await neg("N08 boundary vacío", () => expectCode(owner.inspectSupportRequestHeaders(headers({ "content-type": 'multipart/form-data; boundary=""' }), allowedOrigins, 1024), "MULTIPART_BOUNDARY_INVALID"));
await neg("N09 boundary 71", () => expectCode(owner.inspectSupportRequestHeaders(headers({ "content-type": `multipart/form-data; boundary=${"a".repeat(71)}` }), allowedOrigins, 1024), "MULTIPART_BOUNDARY_INVALID"));
await neg("N10 boundary control", () => expectCode(owner.inspectSupportRequestHeaders(headers({ "content-type": 'multipart/form-data; boundary="bad boundary"' }), allowedOrigins, 1024), "MULTIPART_BOUNDARY_INVALID"));
await neg("N11 gzip", () => expectCode(owner.inspectSupportRequestHeaders(headers({ "content-encoding": "gzip" }), allowedOrigins, 1024), "CONTENT_ENCODING_UNSUPPORTED"));
await neg("N12 encoding lista", () => expectCode(owner.inspectSupportRequestHeaders(headers({ "content-encoding": "br, gzip" }), allowedOrigins, 1024), "CONTENT_ENCODING_UNSUPPORTED"));
await neg("N13 Content-Length inválido", () => {
  for (const length of ["NaN", "+1", "1.5", "01"]) expectCode(owner.inspectSupportRequestHeaders(headers({ "content-length": length }), allowedOrigins, 1024), "CONTENT_LENGTH_INVALID");
});
await neg("N14 Content-Length excedido", () => expectCode(owner.inspectSupportRequestHeaders(headers({ "content-length": "1025" }), allowedOrigins, 1024), "BODY_TOO_LARGE"));
await neg("N15 stream real excedido", async () => expectCode(await owner.readBoundedRequestBody(new Blob(["12345"]).stream(), 4), "BODY_TOO_LARGE"));
await neg("N16 stream falla", async () => {
  const stream = new ReadableStream({ pull(controller) { controller.error(new Error("boom")); } });
  expectCode(await owner.readBoundedRequestBody(stream, 4), "BODY_READ_FAILED");
});
await neg("N17 multipart malformado", async () => expectCode(await owner.parseSupportMultipartBody(new TextEncoder().encode("bad"), "multipart/form-data; boundary=x"), "MULTIPART_INVALID"));
await neg("N18 payload ausente", async () => expectCode(await parseMultipart([["turnstile_token", "token"]]), "MULTIPART_FIELDS_INVALID"));
await neg("N19 payload duplicado", async () => expectCode(await parseMultipart([["payload", "{}"], ["payload", "{}"], ["turnstile_token", "token"]]), "MULTIPART_FIELDS_INVALID"));
await neg("N20 token duplicado", async () => expectCode(await parseMultipart([["payload", "{}"], ["turnstile_token", "a"], ["turnstile_token", "b"]]), "MULTIPART_FIELDS_INVALID"));
await neg("N21 part desconocida", async () => expectCode(await parseMultipart([["payload", "{}"], ["turnstile_token", "token"], ["rogue", "x"]]), "MULTIPART_FIELDS_INVALID"));
await neg("N22 gap de archivos", async () => expectCode(await parseMultipart([["payload", "{}"], ["turnstile_token", "token"], ["file_1", new Blob(["x"]), "x.jpg"]]), "MULTIPART_FIELDS_INVALID"));
await neg("N23 file_5", async () => expectCode(await parseMultipart([["payload", "{}"], ["turnstile_token", "token"], ["file_5", new Blob(["x"]), "x.jpg"]]), "MULTIPART_FIELDS_INVALID"));
await neg("N24 file string", async () => expectCode(await parseMultipart([["payload", "{}"], ["turnstile_token", "token"], ["file_0", "x"]]), "MULTIPART_FIELDS_INVALID"));
await neg("N25 payload acotado", () => assert.match(beforeBarrier, /rawPayload\.length>200000/u));
await neg("N26 JSON fail-closed", () => assert.match(beforeBarrier, /JSON\.parse\(rawPayload\)\}catch\{return json\(\{message:requestErrorMessage\("PAYLOAD_JSON_INVALID"\)/u));
await neg("N27 claves server-owned rechazadas", () => assert.match(beforeBarrier, /parsePublicSupportDto\s*\(\s*parsedPayload\s*\)/u));
await neg("N28 claves desconocidas no stripped", () => assert.doesNotMatch(beforeBarrier, /delete\s+parsedPayload|pick\s*\(\s*parsedPayload/u));
await neg("N29 extensión MIME owner", () => assert.match(beforeBarrier, /validateAttachmentBatch/u));
await neg("N30 magic extensión antes de writes", () => assert.ok(beforeBarrier.indexOf("validateAttachmentBatch") < markerIndex));
await neg("N31 magic MIME antes de writes", () => assert.doesNotMatch(afterBarrier, /sniffCategory|detectFileType|validateAttachmentBatch/u));
await neg("N32 token estricto", () => assert.match(handlerSource, /!token\|\|token\.length>TURNSTILE_TOKEN_MAX_LENGTH/u));
await neg("N33 timeout Siteverify", () => {
  assert.equal(owner.TURNSTILE_FETCH_TIMEOUT_MS, 5000);
  assert.match(handlerSource, /setTimeout\(\(\)=>controller\.abort\(\),TURNSTILE_FETCH_TIMEOUT_MS\)/u);
});
await neg("N34 HTTP y JSON Siteverify", () => {
  assert.match(handlerSource, /if\(!res\.ok\)return\{ok:false,code:"TURNSTILE_UNAVAILABLE"\}/u);
  assert.match(handlerSource, /try\{value=await res\.json\(\)\}catch/u);
});
await neg("N35 success false", () => expectCode(owner.validateTurnstileSiteverify(turnstile({ success: false }), expectedTurnstile()), "TURNSTILE_REJECTED"));
await neg("N36 hostname mismatch", () => expectCode(owner.validateTurnstileSiteverify(turnstile({ hostname: "evil.example" }), expectedTurnstile()), "TURNSTILE_HOSTNAME_MISMATCH"));
await neg("N37 action mismatch", () => expectCode(owner.validateTurnstileSiteverify(turnstile({ action: "login" }), expectedTurnstile()), "TURNSTILE_ACTION_MISMATCH"));
await neg("N38 timestamp inválido/futuro", () => {
  expectCode(owner.validateTurnstileSiteverify(turnstile({ challenge_ts: "not-a-date" }), expectedTurnstile()), "TURNSTILE_TIMESTAMP_INVALID");
  expectCode(owner.validateTurnstileSiteverify(turnstile(), expectedTurnstile(969_999)), "TURNSTILE_TIMESTAMP_INVALID");
});
await neg("N39 expirado", () => expectCode(owner.validateTurnstileSiteverify(turnstile(), expectedTurnstile(1_300_001)), "TURNSTILE_EXPIRED"));
await neg("N40 respuesta sin CRM", () => {
  assert.match(handlerSource, /type PublicSuccessResponse=Readonly<\{ok:true;folio:string;token_publico:string;status:"ticket_creado"\}>/u);
  assert.match(handlerSource, /isPublicSuccessResponse\(c\.response\)/u);
});
await neg("N41 correo sin raw dinámico", () => {
  const template = handlerSource.match(/html:`([\s\S]*?)`,\s*\}\)\.catch/u)?.[1] || "";
  assert.doesNotMatch(template, /\$\{(?:folio|titulo|sistema|magic_link|availableUntil|consolidationCopy)\}/u);
});
await neg("N42 ningún write antes de barrera", () => assert.equal(writePatterns.filter((pattern) => pattern.test(beforeBarrier)).length, 0));

assert.equal(positive, 18, `positive=${positive}`);
assert.equal(negative, 42, `negative=${negative}`);
console.log(`HANDLER_WIRING_TESTS: PASS (positive=${positive} negative=${negative} sensitivity=18)`);
