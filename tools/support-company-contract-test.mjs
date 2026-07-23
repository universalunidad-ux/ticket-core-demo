import assert from "node:assert/strict";
import fs from "node:fs";

const contract = await import(new URL("../supabase/functions/_shared/support-contract.ts", import.meta.url));
const edge = fs.readFileSync(new URL("../supabase/functions/support-submit-secure/index.ts", import.meta.url), "utf8");
const ownerSource = fs.readFileSync(new URL("../supabase/functions/_shared/support-contract.ts", import.meta.url), "utf8");

const baseDto = () => ({
  nombre: "Ana Segura",
  empresa: null,
  correo: "ana@example.com",
  telefono: "5512345678",
  categoria: "soporte",
  sistema: "Otro: Modelo local",
  titulo: "La máquina no enciende",
  descripcion: "Detalle suficiente para una solicitud local.",
  impacto: "media",
  canal: "correo",
  afecta_a: "solo_yo",
});
const parseOk = (value) => {
  const result = contract.parsePublicSupportDto(value);
  assert.equal(result.ok, true, result.ok ? "" : JSON.stringify(result.issues));
  return result.value;
};
const expectIssue = (value, code, field = "empresa") => {
  const result = contract.parsePublicSupportDto(value);
  assert.equal(result.ok, false, `se esperaba ${code}`);
  assert.ok(result.issues.some((issue) => issue.code === code && issue.field === field), JSON.stringify(result.issues));
};

assert.equal(parseOk({ ...baseDto(), empresa: "  Taller Norte  " }).empresa, "Taller Norte");
assert.equal(parseOk({ ...baseDto(), empresa: null }).empresa, null);
const withoutCompany = baseDto();
delete withoutCompany.empresa;
assert.equal(parseOk(withoutCompany).empresa, null);
assert.equal(parseOk({ ...baseDto(), empresa: "E".repeat(160) }).empresa.length, 160);
expectIssue({ ...baseDto(), empresa: "E".repeat(161) }, "DTO_TEXT_TOO_LONG");
expectIssue({ ...baseDto(), empresa: 123 }, "DTO_INVALID_TYPE");
expectIssue({ ...baseDto(), empresa: "" }, "DTO_TEXT_EMPTY");

assert.match(ownerSource, /case "empresa": value\[field\] = textValue\(raw, field, issues, \{ max: 160, nullable: true \}\);/u);
assert.match(edge, /const dtoResult=parsePublicSupportDto\(parsedPayload\);/u);
assert.match(edge, /const dto:PublicSupportDto=dtoResult\.value;/u);
assert.match(edge, /\bempresa=dto\.empresa\b/u);
assert.doesNotMatch(edge, /\b(?:payload|parsedPayload)\??\.empresa\b/u);
assert.doesNotMatch(edge, /sanitize\s*\(\s*(?:payload|parsedPayload)\??\.empresa/u);
assert.match(edge, /matchCliente\(empresa\|\|"",correo,telefono\)/u);
assert.match(edge, /empresa:empresa\|\|null/u);

console.log("SUPPORT_COMPANY_CONTRACT_TEST: PASS (DTO nullable + max=160 + type + executable wiring)");
