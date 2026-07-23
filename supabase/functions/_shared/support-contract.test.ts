import { assert, assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { KNOWN_SUPPORT_SYSTEM_LABELS } from "./support-catalog.ts";
import {
  PUBLIC_SUPPORT_FIELDS,
  SERVER_OWNED_FIELDS,
  canonicalSupportSubmission,
  fingerprintSupportSubmission,
  parsePublicSupportDto,
  serializeCanonicalSupportSubmission,
} from "./support-contract.ts";

const minimal = () => ({
  nombre: "Persona Segura",
  correo: "PERSONA@example.com",
  telefono: "5512345678",
  categoria: "soporte",
  sistema: [...KNOWN_SUPPORT_SYSTEM_LABELS][0],
  titulo: "Falla reproducible",
  descripcion: "La máquina presenta una falla reproducible.",
  impacto: "media",
  canal: "correo",
  afecta_a: "solo_yo",
});

Deno.test("DTO cerrado materializa veinte campos", () => {
  const result = parsePublicSupportDto(minimal());
  assert(result.ok);
  if (result.ok) {
    assertEquals(Object.keys(result.value), PUBLIC_SUPPORT_FIELDS);
    assertEquals(result.value.correo, "persona@example.com");
    assertEquals(result.value.empresa, null);
  }
});

Deno.test("server-owned se rechaza con código estable", () => {
  assertEquals(SERVER_OWNED_FIELDS.length, 37);
  const result = parsePublicSupportDto({ ...minimal(), ticket_id: "controlado" });
  assertEquals(result.ok, false);
  if (!result.ok) assert(result.issues.some((issue) => issue.code === "DTO_SERVER_OWNED_PROPERTY" && issue.field === "ticket_id"));
});

Deno.test("canon v1 y fingerprint no dependen del orden de entrada", async () => {
  const left = parsePublicSupportDto(minimal());
  const right = parsePublicSupportDto(Object.fromEntries(Object.entries(minimal()).reverse()));
  assert(left.ok && right.ok);
  if (!left.ok || !right.ok) return;
  const serialized = serializeCanonicalSupportSubmission(canonicalSupportSubmission(left.value, []));
  assertEquals(JSON.parse(serialized).version, "support-submit/v1");
  assertEquals(await fingerprintSupportSubmission(left.value, []), await fingerprintSupportSubmission(right.value, []));
  assertMatch(await fingerprintSupportSubmission(left.value, []), /^[0-9a-f]{64}$/);
});
