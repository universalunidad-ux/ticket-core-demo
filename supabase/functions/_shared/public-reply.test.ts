import assert from "node:assert/strict";
import test from "node:test";

import {
  derivePublicReplyMetadata,
  PUBLIC_REPLY_REFERENCE_ERROR,
  PUBLIC_REPLY_UUID_RE,
  sanitizePublicReplyPreview,
  sanitizePublicReplyText,
} from "./public-reply.ts";

const TICKET_A = "0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d";
const TICKET_B = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const MESSAGE_ID = "2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d";

const cited = (overrides = {}) => ({
  id: MESSAGE_ID,
  ticket_id: TICKET_A,
  visibilidad: "publica",
  autor_tipo: "Soporte",
  kind: "mensaje",
  texto: "Respuesta útil",
  ...overrides,
});

test("acepta UUID canónico y rechaza reply_to inválido", () => {
  assert.equal(PUBLIC_REPLY_UUID_RE.test(MESSAGE_ID), true);
  assert.equal(PUBLIC_REPLY_UUID_RE.test("no-es-uuid"), false);
  assert.equal(PUBLIC_REPLY_UUID_RE.test("00000000-0000-0000-0000-000000000000"), false);
});

test("deriva metadata de un mensaje público del mismo ticket", () => {
  assert.deepEqual(derivePublicReplyMetadata(cited(), TICKET_A), {
    reply_to: MESSAGE_ID,
    reply_preview: "Respuesta útil",
    reply_author: "soporte",
    reply_kind: "mensaje",
  });
});

test("rechaza referencias cruzadas entre tickets", () => {
  assert.equal(derivePublicReplyMetadata(cited({ ticket_id: TICKET_B }), TICKET_A), null);
});

test("rechaza mensajes internos como citas públicas", () => {
  assert.equal(derivePublicReplyMetadata(cited({ visibilidad: "interna" }), TICKET_A), null);
});

test("reply_to inexistente tiene resultado determinista", () => {
  assert.equal(derivePublicReplyMetadata(null, TICKET_A), null);
  assert.equal(PUBLIC_REPLY_REFERENCE_ERROR, "El mensaje citado no existe o no es público");
});

test("limpia líneas @thumb y el prefijo visual del body", () => {
  assert.equal(
    sanitizePublicReplyText("↪ Soporte · hoy\r\n@thumb https://signed.invalid/x\r\nRespuesta nueva"),
    "Soporte · hoy\nRespuesta nueva",
  );
  assert.equal(sanitizePublicReplyText("Hola\n  @THUMB secreto\nMundo"), "Hola\nMundo");
});

test("la metadata manipulada no participa en la derivación", () => {
  const event = cited({
    texto: "↪ metadata falsa\n@thumb https://signed.invalid/x\nTexto confiable",
    reply_preview: "CLIENTE MANIPULADO",
    reply_author: "admin",
  });
  assert.deepEqual(derivePublicReplyMetadata(event, TICKET_A), {
    reply_to: MESSAGE_ID,
    reply_preview: "Texto confiable",
    reply_author: "soporte",
    reply_kind: "mensaje",
  });
});

test("preview elimina marcadores, normaliza espacios, limita a 160 y conserva fallback", () => {
  assert.equal(sanitizePublicReplyPreview("↪ Cita\n@thumb secreto\n  texto   útil "), "texto útil");
  assert.equal(sanitizePublicReplyPreview("x".repeat(200)).length, 160);
  assert.equal(derivePublicReplyMetadata(cited({ texto: "@thumb secreto" }), TICKET_A)?.reply_preview, "(archivo adjunto)");
});

test("respuesta sin reply_to conserva body canónico", () => {
  assert.equal(sanitizePublicReplyText("  Respuesta normal\r\nsegunda línea  "), "Respuesta normal\nsegunda línea");
});
