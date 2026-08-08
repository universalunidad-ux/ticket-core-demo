#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.argv[2] || ".");
const responder = readFileSync(
  resolve(root, "supabase/functions/estado-ticket-responder-ts/index.ts"),
  "utf8",
);
const compact = responder.replace(/\s+/gu, "");
const at = (token) => {
  const index = compact.indexOf(token.replace(/\s+/gu, ""));
  assert.notEqual(index, -1, `falta contrato CAP-07: ${token}`);
  return index;
};

assert.equal((responder.match(/form\.get\("reply_to"\)/gu) || []).length, 1);
for (const clientOwned of ["reply_preview", "reply_author", "reply_kind", "meta", "metadata"]) {
  assert.equal(
    responder.includes(`form.get("${clientOwned}")`),
    false,
    `el servidor no debe leer metadata manipulable ${clientOwned}`,
  );
}

const formData = at("await req.formData()");
const uuidGate = at("if(reply_to&&!PUBLIC_REPLY_UUID_RE.test(reply_to))");
const ticketLookup = at('.eq("folio",folio).eq("token_publico",token).maybeSingle()');
const rateLimit = at('rateLimit(sb,"portal_reply",`${ip}:${folio}`,PORTAL_REPLY_RATE_LIMIT,PORTAL_REPLY_RATE_WINDOW_MINUTES)');
const replyLookup = at('.select("id,ticket_id,visibilidad,autor_tipo,kind,texto").eq("id",reply_to).maybeSingle()');
const derived = at("derivePublicReplyMetadata(cited,t.id)");
const reopen = at('if(lower(t.estado)==="resuelto")');
const messageInsert = at('meta:{canal:"portal",folio,...replyMeta}');
assert.ok(formData < uuidGate && uuidGate < ticketLookup);
assert.ok(ticketLookup < rateLimit && rateLimit < replyLookup);
assert.ok(replyLookup < derived && derived < reopen && reopen < messageInsert);

assert.match(responder, /BODY_PRE_GUARD_BYTES=64\*1024\*1024/u);
assert.match(responder, /PORTAL_REPLY_RATE_LIMIT=8/u);
assert.match(responder, /PORTAL_REPLY_RATE_WINDOW_MINUTES=10/u);
assert.match(responder, /texto\.length>3000/u);
assert.match(responder, /files\.length>10/u);
assert.match(responder, /size>20\*1024\*1024/u);
assert.match(responder, /totalBytes>60\*1024\*1024/u);
assert.match(responder, /let replyMeta:Record<string,unknown>=\{\}/u);
assert.match(responder, /if\(reply_to\)\{/u);

console.log("CAP07_PUBLIC_REPLY_CONTRACT: PASS");
