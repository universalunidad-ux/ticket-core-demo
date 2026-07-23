// Contrato de subida PURO (sin Deno/npm): validación de tipos y firma de bytes.
// Compartido por el Edge y por pruebas unitarias (Node/Deno).
import { normalizeFileName, sha256Hex } from "./security-primitives.ts";

export const MAX_FILES = 5, MAX_IMG = 3, MAX_VID = 1, MAX_PDF = 1;
const MB = 1024 * 1024;
export const CAP_IMG = 5 * MB, CAP_PDF = 5 * MB, CAP_VID = 40 * MB, MAX_TOTAL_BYTES = 60 * MB;

export const ALLOWED_EXT = new Set(["jpg","jpeg","png","webp","heic","heif","mp4","mov","m4v","pdf"]);
export const ALLOWED_MIME = new Set([
  "image/jpeg","image/png","image/webp","image/heic","image/heif",
  "video/mp4","video/quicktime","video/x-m4v","application/pdf",
]);

export type Category = "image" | "video" | "pdf" | "other";
export const extCategory = (ext: string): Category =>
  ["jpg","jpeg","png","webp","heic","heif"].includes(ext) ? "image"
  : ["mp4","mov","m4v"].includes(ext) ? "video"
  : ext === "pdf" ? "pdf" : "other";

// Sniff por firma real (magic bytes) sobre los primeros ~16 bytes.
export const sniffCategory = (b: Uint8Array): "image" | "video" | "pdf" | "unknown" => {
  const a = (...xs: number[]) => xs.every((v, i) => b[i] === v);
  const ascii = (off: number, str: string) => [...str].every((c, i) => b[off + i] === c.charCodeAt(0));
  if (a(0xFF, 0xD8, 0xFF)) return "image";
  if (a(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)) return "image";
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "image";
  if (ascii(0, "%PDF")) return "pdf";
  if (ascii(4, "ftyp")) {
    const brand = String.fromCharCode(b[8] || 0, b[9] || 0, b[10] || 0, b[11] || 0);
    if (/heic|heix|hevc|mif1|heim|heis|msf1|heif/.test(brand)) return "image";
    return "video";
  }
  return "unknown";
};

export const capFor = (cat: Category): number =>
  cat === "image" ? CAP_IMG : cat === "video" ? CAP_VID : cat === "pdf" ? CAP_PDF : 0;

export const UPLOAD_CONTRACT_VERSION = "support-upload/v2" as const;

export type AllowedExtension = "jpg" | "jpeg" | "png" | "webp" | "heic" | "heif" | "mp4" | "mov" | "m4v" | "pdf";
export type AllowedMime = "image/jpeg" | "image/png" | "image/webp" | "image/heic" | "image/heif" | "video/mp4" | "video/quicktime" | "video/x-m4v" | "application/pdf";
export type DetectedFileType = "jpeg" | "png" | "webp" | "heic" | "heif" | "mp4" | "mov" | "m4v" | "pdf" | "unknown";
export type UploadErrorCode =
  | "UPLOAD_EXTENSION_NOT_ALLOWED" | "UPLOAD_MIME_NOT_ALLOWED"
  | "UPLOAD_EXTENSION_MIME_MISMATCH" | "UPLOAD_MAGIC_UNKNOWN"
  | "UPLOAD_MAGIC_EXTENSION_MISMATCH" | "UPLOAD_MAGIC_MIME_MISMATCH"
  | "UPLOAD_EMPTY" | "UPLOAD_FILE_TOO_LARGE"
  | "UPLOAD_FILE_COUNT_EXCEEDED" | "UPLOAD_CATEGORY_COUNT_EXCEEDED"
  | "UPLOAD_TOTAL_TOO_LARGE";
export type UploadIssue = Readonly<{ code: UploadErrorCode; fileIndex: number; field?: "name" | "mimeType" | "bytes" }>;
export type AttachmentInput = Readonly<{ name: string; mimeType: string; bytes: Uint8Array }>;
export type ValidatedAttachment = Readonly<{
  normalizedName: string; extension: AllowedExtension; mimeType: AllowedMime;
  detectedType: Exclude<DetectedFileType, "unknown">; category: Exclude<Category, "other">;
  size: number; contentSha256: string;
}>;
export type UploadResult<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; issues: readonly UploadIssue[] }>;
export type UploadTypeRule = Readonly<{
  extension: AllowedExtension;
  mimeTypes: readonly AllowedMime[];
  detectedType: Exclude<DetectedFileType, "unknown">;
  category: Exclude<Category, "other">;
}>;

export const UPLOAD_TYPE_RULES: readonly UploadTypeRule[] = Object.freeze([
  { extension: "jpg", mimeTypes: ["image/jpeg"], detectedType: "jpeg", category: "image" },
  { extension: "jpeg", mimeTypes: ["image/jpeg"], detectedType: "jpeg", category: "image" },
  { extension: "png", mimeTypes: ["image/png"], detectedType: "png", category: "image" },
  { extension: "webp", mimeTypes: ["image/webp"], detectedType: "webp", category: "image" },
  { extension: "heic", mimeTypes: ["image/heic"], detectedType: "heic", category: "image" },
  { extension: "heif", mimeTypes: ["image/heif"], detectedType: "heif", category: "image" },
  { extension: "mp4", mimeTypes: ["video/mp4"], detectedType: "mp4", category: "video" },
  { extension: "mov", mimeTypes: ["video/quicktime"], detectedType: "mov", category: "video" },
  { extension: "m4v", mimeTypes: ["video/x-m4v", "video/mp4"], detectedType: "m4v", category: "video" },
  { extension: "pdf", mimeTypes: ["application/pdf"], detectedType: "pdf", category: "pdf" },
].map((rule) => Object.freeze({ ...rule, mimeTypes: Object.freeze([...rule.mimeTypes]) })));

export const UPLOAD_ERROR_CODES: readonly UploadErrorCode[] = Object.freeze([
  "UPLOAD_EXTENSION_NOT_ALLOWED", "UPLOAD_MIME_NOT_ALLOWED",
  "UPLOAD_EXTENSION_MIME_MISMATCH", "UPLOAD_MAGIC_UNKNOWN",
  "UPLOAD_MAGIC_EXTENSION_MISMATCH", "UPLOAD_MAGIC_MIME_MISMATCH",
  "UPLOAD_EMPTY", "UPLOAD_FILE_TOO_LARGE", "UPLOAD_FILE_COUNT_EXCEEDED",
  "UPLOAD_CATEGORY_COUNT_EXCEEDED", "UPLOAD_TOTAL_TOO_LARGE",
]);

const allowedExtensions = new Set<AllowedExtension>(UPLOAD_TYPE_RULES.map((rule) => rule.extension));
const allowedMimes = new Set<AllowedMime>(UPLOAD_TYPE_RULES.flatMap((rule) => rule.mimeTypes));

export function extensionOf(name: string): AllowedExtension | null {
  const base = name.replaceAll("\\", "/").split("/").pop() || "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return null;
  const extension = base.slice(dot + 1).toLowerCase() as AllowedExtension;
  return allowedExtensions.has(extension) ? extension : null;
}

function asciiAt(bytes: Uint8Array, offset: number, value: string): boolean {
  return bytes.length >= offset + value.length && [...value].every((char, index) => bytes[offset + index] === char.charCodeAt(0));
}

export function detectFileType(bytes: Uint8Array): DetectedFileType {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 8 && [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a].every((value, index) => bytes[index] === value)) return "png";
  if (asciiAt(bytes, 0, "RIFF") && asciiAt(bytes, 8, "WEBP")) return "webp";
  if (asciiAt(bytes, 0, "%PDF")) return "pdf";
  if (!asciiAt(bytes, 4, "ftyp") || bytes.length < 12) return "unknown";
  const brand = String.fromCharCode(...bytes.slice(8, 12));
  if (["heic", "heix", "hevc", "hevx"].includes(brand)) return "heic";
  if (["mif1", "msf1", "heif", "heim", "heis"].includes(brand)) return "heif";
  if (["M4V ", "M4VH", "M4VP"].includes(brand)) return "m4v";
  if (brand === "qt  ") return "mov";
  if (["isom", "iso2", "avc1", "mp41", "mp42"].includes(brand)) return "mp4";
  return "unknown";
}

function issue(code: UploadErrorCode, fileIndex: number, field?: "name" | "mimeType" | "bytes"): UploadIssue {
  return Object.freeze({ code, fileIndex, ...(field ? { field } : {}) });
}

export async function validateAttachment(input: AttachmentInput, fileIndex = 0): Promise<UploadResult<ValidatedAttachment>> {
  const issues: UploadIssue[] = [];
  const extension = extensionOf(input.name);
  const mimeType = input.mimeType as AllowedMime;
  const mimeAllowed = allowedMimes.has(mimeType);
  const rule = extension ? UPLOAD_TYPE_RULES.find((candidate) => candidate.extension === extension) : undefined;
  if (!extension) issues.push(issue("UPLOAD_EXTENSION_NOT_ALLOWED", fileIndex, "name"));
  if (!mimeAllowed) issues.push(issue("UPLOAD_MIME_NOT_ALLOWED", fileIndex, "mimeType"));
  if (rule && mimeAllowed && !rule.mimeTypes.includes(mimeType)) issues.push(issue("UPLOAD_EXTENSION_MIME_MISMATCH", fileIndex, "mimeType"));
  if (input.bytes.length === 0) issues.push(issue("UPLOAD_EMPTY", fileIndex, "bytes"));
  const detectedType = detectFileType(input.bytes);
  if (input.bytes.length > 0 && detectedType === "unknown") issues.push(issue("UPLOAD_MAGIC_UNKNOWN", fileIndex, "bytes"));
  if (rule && detectedType !== "unknown" && rule.detectedType !== detectedType) issues.push(issue("UPLOAD_MAGIC_EXTENSION_MISMATCH", fileIndex, "bytes"));
  const magicMatchesMime = UPLOAD_TYPE_RULES.some((candidate) => candidate.detectedType === detectedType && candidate.mimeTypes.includes(mimeType));
  if (mimeAllowed && detectedType !== "unknown" && !magicMatchesMime) issues.push(issue("UPLOAD_MAGIC_MIME_MISMATCH", fileIndex, "bytes"));
  if (rule && input.bytes.length > capFor(rule.category)) issues.push(issue("UPLOAD_FILE_TOO_LARGE", fileIndex, "bytes"));
  if (issues.length > 0 || !extension || !rule || detectedType === "unknown" || !mimeAllowed) return Object.freeze({ ok: false, issues: Object.freeze(issues) });
  const value: ValidatedAttachment = Object.freeze({
    normalizedName: normalizeFileName(input.name), extension, mimeType,
    detectedType, category: rule.category, size: input.bytes.length,
    contentSha256: await sha256Hex(input.bytes),
  });
  return Object.freeze({ ok: true, value });
}

export async function validateAttachmentBatch(inputs: readonly AttachmentInput[]): Promise<UploadResult<readonly ValidatedAttachment[]>> {
  const issues: UploadIssue[] = [];
  if (inputs.length > MAX_FILES) issues.push(issue("UPLOAD_FILE_COUNT_EXCEEDED", -1));
  const categoryCounts: Record<Exclude<Category, "other">, number> = { image: 0, video: 0, pdf: 0 };
  let total = 0;
  inputs.forEach((input) => {
    total += input.bytes.length;
    const extension = extensionOf(input.name);
    if (extension) {
      const category = extCategory(extension);
      if (category !== "other") categoryCounts[category]++;
    }
  });
  if (categoryCounts.image > MAX_IMG || categoryCounts.video > MAX_VID || categoryCounts.pdf > MAX_PDF) {
    issues.push(issue("UPLOAD_CATEGORY_COUNT_EXCEEDED", -1));
  }
  if (total > MAX_TOTAL_BYTES) issues.push(issue("UPLOAD_TOTAL_TOO_LARGE", -1));
  const validated: ValidatedAttachment[] = [];
  for (let index = 0; index < inputs.length; index++) {
    const result = await validateAttachment(inputs[index], index);
    if (result.ok) validated.push(result.value);
    else issues.push(...result.issues);
  }
  if (issues.length > 0) return Object.freeze({ ok: false, issues: Object.freeze(issues) });
  return Object.freeze({ ok: true, value: Object.freeze(validated) });
}
