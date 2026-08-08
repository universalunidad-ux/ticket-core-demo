import { sha256Hex } from "./security-primitives.ts";
import { validateAttachment, type AttachmentInput, type ValidatedAttachment } from "./upload-contract.ts";

export type MediaPolicyCode =
  | "MEDIA_CHECKSUM_REQUIRED"
  | "MEDIA_CHECKSUM_MISMATCH"
  | "MEDIA_SIGNATURE_OR_MIME_REJECTED"
  | "MEDIA_VIDEO_DURATION_UNREADABLE"
  | "MEDIA_VIDEO_DURATION_REJECTED";

export type AuthoritativeMedia = Readonly<{
  metadata: ValidatedAttachment;
  durationSeconds: number | null;
}>;

const u32 = (bytes: Uint8Array, offset: number): number =>
  ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;

const u64 = (bytes: Uint8Array, offset: number): number =>
  u32(bytes, offset) * 0x1_0000_0000 + u32(bytes, offset + 4);

export function parseIsoBmffDurationSeconds(bytes: Uint8Array): number | null {
  const mvhd = [0x6d, 0x76, 0x68, 0x64];
  for (let index = 4; index + 36 <= bytes.length; index++) {
    if (!mvhd.every((value, part) => bytes[index + part] === value)) continue;
    const version = bytes[index + 4];
    const timescaleOffset = version === 1 ? index + 24 : index + 16;
    const durationOffset = version === 1 ? index + 28 : index + 20;
    if (durationOffset + (version === 1 ? 8 : 4) > bytes.length) return null;
    const timescale = u32(bytes, timescaleOffset);
    const duration = version === 1 ? u64(bytes, durationOffset) : u32(bytes, durationOffset);
    if (!timescale || !duration) return null;
    const seconds = duration / timescale;
    return Number.isFinite(seconds) && seconds > 0 ? Number(seconds.toFixed(3)) : null;
  }
  return null;
}

export async function validateAuthoritativeMedia(
  input: AttachmentInput,
  declaredChecksum: string,
): Promise<Readonly<{ ok: true; value: AuthoritativeMedia } | { ok: false; code: MediaPolicyCode }>> {
  if (!/^[0-9a-f]{64}$/.test(declaredChecksum)) return { ok: false, code: "MEDIA_CHECKSUM_REQUIRED" };
  const base = await validateAttachment(input);
  if (!base.ok) return { ok: false, code: "MEDIA_SIGNATURE_OR_MIME_REJECTED" };
  if (base.value.contentSha256 !== declaredChecksum || await sha256Hex(input.bytes) !== declaredChecksum) {
    return { ok: false, code: "MEDIA_CHECKSUM_MISMATCH" };
  }
  if (base.value.category !== "video") return { ok: true, value: { metadata: base.value, durationSeconds: null } };
  const durationSeconds = parseIsoBmffDurationSeconds(input.bytes);
  if (durationSeconds === null) return { ok: false, code: "MEDIA_VIDEO_DURATION_UNREADABLE" };
  if (durationSeconds > 30) return { ok: false, code: "MEDIA_VIDEO_DURATION_REJECTED" };
  return { ok: true, value: { metadata: base.value, durationSeconds } };
}
