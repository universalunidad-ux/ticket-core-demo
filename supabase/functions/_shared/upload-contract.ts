// Contrato de subida PURO (sin Deno/npm): validación de tipos y firma de bytes.
// Compartido por el Edge y por pruebas unitarias (Node/Deno).
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
