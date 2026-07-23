export const SHA256_HEX_RE: RegExp = /^[0-9a-f]{64}$/;

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function effectiveMaxLength(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : fallback;
}

export function sanitizeEmailSubject(input: string, maxLength = 160): string {
  const limit = effectiveMaxLength(maxLength, 160);
  return input
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, limit);
}

const WINDOWS_RESERVED_NAME_RE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;

export function normalizeFileName(input: string, maxLength = 140): string {
  const limit = effectiveMaxLength(maxLength, 140);
  const basename = input.replaceAll("\\", "/").split("/").pop() || "";
  let normalized = basename
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[\u0000-\u001f\u007f]/gu, "")
    .replace(/\s+/gu, "_")
    .replace(/[^A-Za-z0-9._()-]/gu, "_")
    .replace(/_+/gu, "_")
    .replace(/\.{2,}/gu, ".")
    .replace(/^[._]+|[._]+$/gu, "");
  if (!normalized || normalized === "." || normalized === "..") normalized = "archivo";
  if (WINDOWS_RESERVED_NAME_RE.test(normalized)) normalized = `archivo_${normalized}`;
  normalized = normalized.slice(0, limit).replace(/[._]+$/gu, "");
  return normalized || "archivo".slice(0, limit) || "archivo";
}
