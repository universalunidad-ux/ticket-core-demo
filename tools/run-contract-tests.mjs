#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(process.argv[2] || ".");
const killerId = process.argv[3] === "--kill" ? process.argv[4] : null;
const modulePath = (name) => join(root, "supabase/functions/_shared", name);
for (const name of ["support-catalog.ts", "security-primitives.ts", "upload-contract.ts", "support-contract.ts"]) {
  if (!existsSync(modulePath(name))) {
    console.error(`CONTRACT_TESTS: FAIL — falta ${name}`);
    process.exit(1);
  }
}

const catalog = await import(pathToFileURL(modulePath("support-catalog.ts")).href);
const primitives = await import(pathToFileURL(modulePath("security-primitives.ts")).href);
const upload = await import(pathToFileURL(modulePath("upload-contract.ts")).href);
const contract = await import(pathToFileURL(modulePath("support-contract.ts")).href);

const knownLabels = [...catalog.KNOWN_SUPPORT_SYSTEM_LABELS];
const machineLabel = knownLabels.find((label) => label.includes("Máquinas"));
const accessoryLabel = knownLabels.find((label) => label.includes("Accesorios"));
assert.ok(machineLabel && accessoryLabel, "el adaptador debe exponer máquinas y accesorios");

const baseDto = () => ({
  nombre: "Persona Segura",
  correo: "persona@example.com",
  telefono: "5512345678",
  categoria: "soporte",
  sistema: machineLabel,
  titulo: "Falla de costura",
  descripcion: "La máquina presenta una falla reproducible.",
  impacto: "media",
  canal: "correo",
  afecta_a: "solo_yo",
});

const parseOk = (input) => {
  const result = contract.parsePublicSupportDto(input);
  assert.equal(result.ok, true, result.ok ? "" : JSON.stringify(result.issues));
  return result.value;
};
const parseIssue = (input, code, field) => {
  const result = contract.parsePublicSupportDto(input);
  assert.equal(result.ok, false, `se esperaba ${code}`);
  assert.ok(result.issues.some((item) => item.code === code && (field === undefined || item.field === field)), JSON.stringify(result.issues));
};
const bytes = (...values) => new Uint8Array(values);
const iso = (brand, size = 12) => {
  const value = new Uint8Array(size);
  value.set(new TextEncoder().encode("ftyp"), 4);
  value.set(new TextEncoder().encode(brand), 8);
  return value;
};
const withSize = (signature, size) => {
  const value = new Uint8Array(size);
  value.set(signature.slice(0, Math.min(signature.length, size)));
  return value;
};
const signatures = {
  jpeg: bytes(0xff, 0xd8, 0xff, 0xe0),
  png: bytes(0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a),
  webp: new TextEncoder().encode("RIFF0000WEBP"),
  heic: iso("heic"), heif: iso("mif1"), mp4: iso("isom"), mov: iso("qt  "), m4v: iso("M4V "),
  pdf: new TextEncoder().encode("%PDF-1.7"),
};
const attachment = (name, mimeType, signature, size) => ({ name, mimeType, bytes: size === undefined ? signature : withSize(signature, size) });
const uploadOk = async (input) => {
  const result = await upload.validateAttachment(input);
  assert.equal(result.ok, true, result.ok ? "" : JSON.stringify(result.issues));
  return result.value;
};
const uploadIssue = async (input, code) => {
  const result = await upload.validateAttachment(input);
  assert.equal(result.ok, false, `se esperaba ${code}`);
  assert.ok(result.issues.some((item) => item.code === code), JSON.stringify(result.issues));
};
const batchIssue = async (inputs, code) => {
  const result = await upload.validateAttachmentBatch(inputs);
  assert.equal(result.ok, false, `se esperaba ${code}`);
  assert.ok(result.issues.some((item) => item.code === code), JSON.stringify(result.issues));
};

async function runKiller(id) {
  const killers = {
    M01: () => parseIssue({ ...baseDto(), intruso: "x" }, "DTO_UNKNOWN_PROPERTY", "intruso"),
    M02: () => parseIssue({ ...baseDto(), ticket_id: "x" }, "DTO_SERVER_OWNED_PROPERTY", "ticket_id"),
    M03: () => assert.equal(catalog.isSupportCategory("ventas"), false),
    M04: () => assert.equal(catalog.isSupportImpact("critica"), false),
    M05: () => assert.equal(catalog.parseSupportSystem("Sistema inventado"), null),
    M06: () => parseIssue({ ...baseDto(), correo: "a@b" }, "DTO_EMAIL_INVALID", "correo"),
    M07: () => parseIssue({ ...baseDto(), telefono: "55123456789" }, "DTO_PHONE_INVALID", "telefono"),
    M08: () => parseIssue({ ...baseDto(), horario_desde: "09:00" }, "DTO_TIME_PAIR_REQUIRED"),
    M09: () => parseIssue({ ...baseDto(), nombre: "Nombre\ninyectado" }, "DTO_TEXT_CONTROL_CHAR", "nombre"),
    M10: () => assert.equal(JSON.parse(contract.serializeCanonicalSupportSubmission(contract.canonicalSupportSubmission(parseOk(baseDto()), []))).version, "support-submit/v1"),
    M11: async () => assert.match(await primitives.sha256Hex("abc"), primitives.SHA256_HEX_RE),
    M12: async () => uploadIssue(attachment("foto.jpg", "image/png", signatures.png), "UPLOAD_EXTENSION_MIME_MISMATCH"),
    M13: async () => uploadIssue(attachment("foto.png", "image/png", signatures.jpeg), "UPLOAD_MAGIC_EXTENSION_MISMATCH"),
    M14: () => assert.equal(primitives.normalizeFileName("carpeta/seguro.pdf"), "seguro.pdf"),
    M15: () => assert.equal(primitives.escapeHtml("<&"), "&lt;&amp;"),
    M16: () => assert.equal(/[\r\n]/u.test(primitives.sanitizeEmailSubject("A\r\nB")), false),
  };
  assert.ok(killers[id], `mutante desconocido: ${id}`);
  await killers[id]();
  console.log(`KILLER_VECTOR: PASS (${id})`);
}

if (killerId) {
  await runKiller(killerId);
  process.exit(0);
}

let positive = 0;
let negative = 0;
const pos = async (name, fn) => { await fn(); positive++; };
const neg = async (name, fn) => { await fn(); negative++; };

// 29 positivos: catálogo, DTO y representación canónica.
await pos("categoría", () => assert.equal(catalog.isSupportCategory("soporte"), true));
for (const value of ["baja", "media", "alta"]) await pos(`impacto ${value}`, () => assert.equal(catalog.isSupportImpact(value), true));
for (const value of ["correo", "whatsapp"]) await pos(`canal ${value}`, () => assert.equal(catalog.isSupportChannel(value), true));
for (const value of ["solo_yo", "varios", "todos", "no_se"]) await pos(`afecta ${value}`, () => assert.equal(catalog.isSupportAffected(value), true));
for (const value of ["", "sin_cambio", "no_se"]) await pos(`cambio ${value}`, () => assert.equal(catalog.isSupportLastChange(value), true));
await pos("sistema máquina", () => assert.equal(catalog.parseSupportSystem(machineLabel)?.kind, "catalog"));
await pos("sistema accesorio", () => assert.equal(catalog.parseSupportSystem(accessoryLabel)?.kind, "catalog"));
await pos("sistema otro", () => assert.deepEqual(catalog.parseSupportSystem("Otro:  Modelo   especial "), { kind: "other", label: "Otro: Modelo especial" }));
await pos("DTO mínimo", () => assert.equal(Object.keys(parseOk(baseDto())).length, 20));
await pos("DTO completo", () => {
  const dto = parseOk({ ...baseDto(), empresa: "Empresa", objetivo: "Reparar", descripcion: "Primera línea\r\nSegunda línea con suficiente detalle.", desde_cuando: "Ayer", cambio_previo: "sin_cambio", horario_desde: "09:00", horario_hasta: "17:00", horario_notas: "Recepción", horario_disponible: "09:00–17:00 · Recepción", contexto_extra: "Detalle", remote_access: "AnyDesk bajo cita" });
  assert.equal(dto.empresa, "Empresa");
  assert.equal(dto.descripcion.includes("\r"), false);
});
await pos("NFKC y espacios", () => assert.equal(parseOk({ ...baseDto(), nombre: "  Jo\u0301se   Pérez  " }).nombre, "Jóse Pérez"));
for (const value of ["a@b.mx", "nombre.apellido+tag@example.com", "USUARIO@EXAMPLE.COM"]) await pos(`correo ${value}`, () => assert.equal(parseOk({ ...baseDto(), correo: value }).correo, value.toLowerCase()));
for (const value of ["5512345678", "0000000000"]) await pos(`teléfono ${value}`, () => assert.equal(parseOk({ ...baseDto(), telefono: value }).telefono, value));
await pos("horario vacío", () => assert.equal(parseOk(baseDto()).horario_disponible, ""));
await pos("horario diurno", () => assert.equal(parseOk({ ...baseDto(), horario_desde: "09:00", horario_hasta: "17:00", horario_disponible: "09:00–17:00" }).horario_hasta, "17:00"));
await pos("horario nocturno", () => assert.equal(parseOk({ ...baseDto(), horario_desde: "22:00", horario_hasta: "06:00", horario_disponible: "22:00–06:00" }).horario_hasta, "06:00"));
await pos("orden de inserción", async () => {
  const a = parseOk(baseDto());
  const b = parseOk(Object.fromEntries(Object.entries(baseDto()).reverse()));
  const first = await uploadOk(attachment("a.jpg", "image/jpeg", signatures.jpeg));
  const second = await uploadOk(attachment("a.pdf", "application/pdf", signatures.pdf));
  assert.equal(await contract.fingerprintSupportSubmission(a, [first, second]), await contract.fingerprintSupportSubmission(b, [second, first]));
});
await pos("versión canónica", () => assert.equal(JSON.parse(contract.serializeCanonicalSupportSubmission(contract.canonicalSupportSubmission(parseOk(baseDto()), []))).version, "support-submit/v1"));

// 10 positivos: primitivos de seguridad.
await pos("SHA vacío", async () => assert.equal(await primitives.sha256Hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"));
await pos("SHA abc", async () => assert.equal(await primitives.sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"));
await pos("SHA string bytes", async () => assert.equal(await primitives.sha256Hex("á"), await primitives.sha256Hex(new TextEncoder().encode("á"))));
await pos("HTML especiales", () => assert.equal(primitives.escapeHtml(`&<>"'`), "&amp;&lt;&gt;&quot;&#39;"));
await pos("HTML Unicode", () => assert.equal(primitives.escapeHtml("Máquina ✓"), "Máquina ✓"));
await pos("subject normal", () => assert.equal(primitives.sanitizeEmailSubject("  Soporte   Janome "), "Soporte Janome"));
await pos("subject CRLF", () => assert.equal(primitives.sanitizeEmailSubject("Asunto\r\nBcc: x"), "AsuntoBcc: x"));
await pos("filename seguro", () => assert.equal(primitives.normalizeFileName("evidencia-final_1.pdf"), "evidencia-final_1.pdf"));
await pos("filename basename", () => assert.equal(primitives.normalizeFileName("C:\\temporal\\evidencia.pdf"), "evidencia.pdf"));
await pos("filename diacríticos", () => assert.equal(primitives.normalizeFileName("máquina dañada.png"), "maquina_danada.png"));

// 15 positivos: matriz exacta de adjuntos, límites y batch.
for (const [name, mime, signature, detected] of [
  ["a.jpg", "image/jpeg", signatures.jpeg, "jpeg"], ["a.jpeg", "image/jpeg", signatures.jpeg, "jpeg"],
  ["a.png", "image/png", signatures.png, "png"], ["a.webp", "image/webp", signatures.webp, "webp"],
  ["a.heic", "image/heic", signatures.heic, "heic"], ["a.heif", "image/heif", signatures.heif, "heif"],
  ["a.mp4", "video/mp4", signatures.mp4, "mp4"], ["a.mov", "video/quicktime", signatures.mov, "mov"],
  ["a.m4v", "video/x-m4v", signatures.m4v, "m4v"], ["b.m4v", "video/mp4", signatures.m4v, "m4v"],
  ["a.pdf", "application/pdf", signatures.pdf, "pdf"],
]) await pos(`adjunto ${name}/${mime}`, async () => assert.equal((await uploadOk(attachment(name, mime, signature))).detectedType, detected));
await pos("límite IMG", async () => assert.equal((await uploadOk(attachment("a.jpg", "image/jpeg", signatures.jpeg, upload.CAP_IMG))).size, upload.CAP_IMG));
await pos("límite PDF", async () => assert.equal((await uploadOk(attachment("a.pdf", "application/pdf", signatures.pdf, upload.CAP_PDF))).size, upload.CAP_PDF));
await pos("límite VID", async () => assert.equal((await uploadOk(attachment("a.mp4", "video/mp4", signatures.mp4, upload.CAP_VID))).size, upload.CAP_VID));
await pos("batch válido", async () => assert.equal((await upload.validateAttachmentBatch([attachment("a.jpg", "image/jpeg", signatures.jpeg), attachment("a.pdf", "application/pdf", signatures.pdf)])).ok, true));

// 166 negativos en el orden de la matriz canónica.
for (const value of [null, [], "x", 1]) await neg("DTO no objeto", () => parseIssue(value, "DTO_NOT_PLAIN_OBJECT"));
await neg("clave desconocida", () => parseIssue({ ...baseDto(), desconocida: "x" }, "DTO_UNKNOWN_PROPERTY", "desconocida"));
for (const field of contract.SERVER_OWNED_FIELDS) await neg(`server-owned ${field}`, () => parseIssue({ ...baseDto(), [field]: null }, "DTO_SERVER_OWNED_PROPERTY", field));
for (const field of contract.REQUIRED_PUBLIC_SUPPORT_FIELDS) await neg(`faltante ${field}`, () => { const value = baseDto(); delete value[field]; parseIssue(value, "DTO_MISSING_PROPERTY", field); });
for (const field of contract.PUBLIC_SUPPORT_FIELDS) await neg(`tipo ${field}`, () => parseIssue({ ...baseDto(), [field]: 123 }, "DTO_INVALID_TYPE", field));
await neg("nombre vacío", () => parseIssue({ ...baseDto(), nombre: " " }, "DTO_TEXT_EMPTY", "nombre"));
await neg("título mínimo", () => parseIssue({ ...baseDto(), titulo: "cinco" }, "DTO_TEXT_TOO_SHORT", "titulo"));
await neg("descripción mínima", () => parseIssue({ ...baseDto(), descripcion: "muy corta" }, "DTO_TEXT_TOO_SHORT", "descripcion"));
await neg("sistema vacío", () => parseIssue({ ...baseDto(), sistema: "" }, "DTO_TEXT_EMPTY", "sistema"));
for (const [field, max] of [["nombre",80],["empresa",160],["objetivo",300],["titulo",120],["descripcion",3000],["desde_cuando",160],["horario_disponible",160],["horario_notas",140],["contexto_extra",3000],["remote_access",120]]) {
  await neg(`máximo ${field}`, () => parseIssue({ ...baseDto(), [field]: "x".repeat(max + 1) }, "DTO_TEXT_TOO_LONG", field));
}
for (const field of ["nombre","empresa","objetivo","titulo","descripcion","desde_cuando","horario_notas","contexto_extra"]) {
  await neg(`control ${field}`, () => parseIssue({ ...baseDto(), [field]: "texto\u0000control" }, "DTO_TEXT_CONTROL_CHAR", field));
}
for (const [field, code] of [["categoria","DTO_CATEGORY_INVALID"],["impacto","DTO_IMPACT_INVALID"],["canal","DTO_CHANNEL_INVALID"],["afecta_a","DTO_AFFECTS_INVALID"],["cambio_previo","DTO_LAST_CHANGE_INVALID"]]) {
  await neg(`enum ${field}`, () => parseIssue({ ...baseDto(), [field]: "invalido" }, code, field));
}
await neg("sistema desconocido", () => parseIssue({ ...baseDto(), sistema: "Janome inventada" }, "DTO_SYSTEM_INVALID", "sistema"));
await neg("fallback genérico", () => parseIssue({ ...baseDto(), sistema: "Otro / no aparece en la lista" }, "DTO_SYSTEM_INVALID", "sistema"));
await neg("catálogo adulterado", () => parseIssue({ ...baseDto(), sistema: `${machineLabel} ` }, "DTO_SYSTEM_INVALID", "sistema"));
for (const email of [" a@b.mx", "a@@b.mx", "@b.mx", "a@", "a..b@c.mx", ".a@c.mx", "a@localhost", "a@-dominio.mx"]) {
  await neg(`correo ${email}`, () => parseIssue({ ...baseDto(), correo: email }, "DTO_EMAIL_INVALID", "correo"));
}
for (const phone of ["abcdefghij", "551234567", "55123456789", "+525512345678", "55 1234 5678"]) {
  await neg(`teléfono ${phone}`, () => parseIssue({ ...baseDto(), telefono: phone }, "DTO_PHONE_INVALID", "telefono"));
}
await neg("sólo desde", () => parseIssue({ ...baseDto(), horario_desde: "09:00" }, "DTO_TIME_PAIR_REQUIRED"));
await neg("sólo hasta", () => parseIssue({ ...baseDto(), horario_hasta: "17:00" }, "DTO_TIME_PAIR_REQUIRED"));
await neg("formato desde", () => parseIssue({ ...baseDto(), horario_desde: "9:00", horario_hasta: "17:00" }, "DTO_TIME_INVALID", "horario_desde"));
await neg("formato hasta", () => parseIssue({ ...baseDto(), horario_desde: "09:00", horario_hasta: "17:0" }, "DTO_TIME_INVALID", "horario_hasta"));
await neg("hora desde", () => parseIssue({ ...baseDto(), horario_desde: "24:00", horario_hasta: "17:00" }, "DTO_TIME_INVALID", "horario_desde"));
await neg("summary", () => parseIssue({ ...baseDto(), horario_desde: "09:00", horario_hasta: "17:00", horario_disponible: "otro" }, "DTO_TIME_SUMMARY_MISMATCH"));

await neg("filename vacío", () => assert.equal(primitives.normalizeFileName(""), "archivo"));
await neg("filename control", () => assert.equal(/[\u0000-\u001f\u007f]/u.test(primitives.normalizeFileName("a\u0000.pdf")), false));
await neg("filename traversal", () => assert.equal(primitives.normalizeFileName("../../seguro.pdf"), "seguro.pdf"));
await neg("filename dot", () => assert.equal(primitives.normalizeFileName(".."), "archivo"));
await neg("filename reservado", () => assert.equal(primitives.normalizeFileName("CON.txt").startsWith("archivo_"), true));
await neg("filename largo", () => assert.ok(primitives.normalizeFileName(`${"a".repeat(200)}.pdf`).length <= 140));
await neg("subject CR", () => assert.equal(primitives.sanitizeEmailSubject("a\rb").includes("\r"), false));
await neg("subject LF", () => assert.equal(primitives.sanitizeEmailSubject("a\nb").includes("\n"), false));
await neg("subject control", () => assert.equal(/[\u0000-\u001f\u007f]/u.test(primitives.sanitizeEmailSubject("a\u0000b")), false));
await neg("subject largo", () => assert.equal(primitives.sanitizeEmailSubject("x".repeat(200)).length, 160));
await neg("HTML sin raw", () => assert.equal(primitives.escapeHtml(`&<>"'`), "&amp;&lt;&gt;&quot;&#39;"));
await neg("avalancha SHA", async () => { const a = await primitives.sha256Hex("abc"); const b = await primitives.sha256Hex("abd"); assert.match(a, primitives.SHA256_HEX_RE); assert.notEqual(a, b); });

for (const ext of ["exe","svg","html","zip"]) await neg(`extensión ${ext}`, () => uploadIssue(attachment(`a.${ext}`, "image/jpeg", signatures.jpeg), "UPLOAD_EXTENSION_NOT_ALLOWED"));
for (const mime of ["application/zip","image/svg+xml","text/html","application/octet-stream"]) await neg(`MIME ${mime}`, () => uploadIssue(attachment("a.jpg", mime, signatures.jpeg), "UPLOAD_MIME_NOT_ALLOWED"));
for (const [name,mime,signature] of [["a.jpg","image/png",signatures.png],["a.png","image/jpeg",signatures.jpeg],["a.pdf","image/jpeg",signatures.jpeg],["a.mov","video/mp4",signatures.mp4],["a.mp4","video/quicktime",signatures.mov]]) {
  await neg("ext MIME", () => uploadIssue(attachment(name,mime,signature), "UPLOAD_EXTENSION_MIME_MISMATCH"));
}
await neg("magic desconocido", () => uploadIssue(attachment("a.jpg","image/jpeg",new TextEncoder().encode("not image")), "UPLOAD_MAGIC_UNKNOWN"));
for (const [name,mime,signature] of [["a.jpg","image/jpeg",signatures.png],["a.png","image/png",signatures.jpeg],["a.heic","image/heic",signatures.heif],["a.mp4","video/mp4",signatures.m4v],["a.pdf","application/pdf",signatures.jpeg]]) {
  await neg("ext magic", () => uploadIssue(attachment(name,mime,signature), "UPLOAD_MAGIC_EXTENSION_MISMATCH"));
}
for (const [name,mime,signature] of [["a.jpg","image/jpeg",signatures.png],["a.png","image/png",signatures.jpeg],["a.heic","image/heic",signatures.heif],["a.mp4","video/mp4",signatures.mov],["a.pdf","application/pdf",signatures.jpeg]]) {
  await neg("MIME magic", () => uploadIssue(attachment(name,mime,signature), "UPLOAD_MAGIC_MIME_MISMATCH"));
}
await neg("adjunto vacío", () => uploadIssue(attachment("a.jpg","image/jpeg",new Uint8Array()), "UPLOAD_EMPTY"));
await neg("IMG grande", () => uploadIssue(attachment("a.jpg","image/jpeg",signatures.jpeg,upload.CAP_IMG+1), "UPLOAD_FILE_TOO_LARGE"));
await neg("PDF grande", () => uploadIssue(attachment("a.pdf","application/pdf",signatures.pdf,upload.CAP_PDF+1), "UPLOAD_FILE_TOO_LARGE"));
await neg("VID grande", () => uploadIssue(attachment("a.mp4","video/mp4",signatures.mp4,upload.CAP_VID+1), "UPLOAD_FILE_TOO_LARGE"));
await neg("batch count", () => batchIssue(Array.from({length:6},(_,i)=>attachment(`${i}.jpg`,"image/jpeg",signatures.jpeg)), "UPLOAD_FILE_COUNT_EXCEEDED"));
await neg("batch imágenes", () => batchIssue(Array.from({length:4},(_,i)=>attachment(`${i}.jpg`,"image/jpeg",signatures.jpeg)), "UPLOAD_CATEGORY_COUNT_EXCEEDED"));
await neg("batch videos", () => batchIssue([attachment("a.mp4","video/mp4",signatures.mp4),attachment("b.mov","video/quicktime",signatures.mov)], "UPLOAD_CATEGORY_COUNT_EXCEEDED"));
await neg("batch pdf", () => batchIssue([attachment("a.pdf","application/pdf",signatures.pdf),attachment("b.pdf","application/pdf",signatures.pdf)], "UPLOAD_CATEGORY_COUNT_EXCEEDED"));
await neg("batch total", () => batchIssue([
  attachment("v.mp4","video/mp4",signatures.mp4,upload.CAP_VID),
  ...Array.from({length:4},(_,i)=>attachment(`${i}.jpg`,"image/jpeg",signatures.jpeg,upload.CAP_IMG)),
  attachment("a.pdf","application/pdf",signatures.pdf,upload.CAP_PDF),
], "UPLOAD_TOTAL_TOO_LARGE"));

assert.equal(positive, 54, `positive=${positive}`);
assert.equal(negative, 166, `negative=${negative}`);
const sensitivity = spawnSync(process.execPath, [join(root, "tools/support-security-sensitivity.test.mjs"), root], { cwd: root, encoding: "utf8" });
if (sensitivity.stdout) process.stdout.write(sensitivity.stdout);
if (sensitivity.stderr) process.stderr.write(sensitivity.stderr);
assert.equal(sensitivity.status, 0, "sensitivity gate");
const antiabuse = spawnSync(process.execPath, ["--experimental-strip-types", join(root, "tools/edge-public-responder-antiabuse-contract.test.mjs"), root], { cwd: root, encoding: "utf8" });
if (antiabuse.stdout) process.stdout.write(antiabuse.stdout);
if (antiabuse.stderr) process.stderr.write(antiabuse.stderr);
assert.equal(antiabuse.status, 0, "edge public responder antiabuse gate");
console.log(`CONTRACT_TESTS: PASS (positive=${positive} negative=${negative} sensitivity=16)`);
