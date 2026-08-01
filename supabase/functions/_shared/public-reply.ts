export const PUBLIC_REPLY_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export const PUBLIC_REPLY_REFERENCE_ERROR =
  "El mensaje citado no existe o no es público";

export type PublicReplyEvent = {
  id: unknown;
  ticket_id: unknown;
  visibilidad: unknown;
  autor_tipo: unknown;
  kind: unknown;
  texto: unknown;
};

export type PublicReplyMetadata = {
  reply_to: string;
  reply_preview: string;
  reply_author: string;
  reply_kind: string;
};

const normalizedLines = (value: unknown) =>
  String(value ?? "").replace(/\r\n?/gu, "\n").split("\n");

const isThumbLine = (line: string) => /^\s*@thumb(?:\s|$)/iu.test(line);

export const sanitizePublicReplyText = (value: unknown) => {
  const lines = normalizedLines(value).filter((line) => !isThumbLine(line));
  const firstContent = lines.findIndex((line) => line.trim().length > 0);
  if (firstContent >= 0) lines[firstContent] = lines[firstContent].replace(/^\s*↪\s*/u, "");
  return lines.join("\n").trim();
};

export const sanitizePublicReplyPreview = (value: unknown) =>
  normalizedLines(value)
    .filter((line) => !isThumbLine(line) && !/^\s*↪(?:\s|$)/u.test(line))
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 160);

export const derivePublicReplyMetadata = (
  event: PublicReplyEvent | null | undefined,
  ticketId: unknown,
): PublicReplyMetadata | null => {
  if (
    !event ||
    String(event.ticket_id ?? "") !== String(ticketId ?? "") ||
    String(event.visibilidad ?? "").trim().toLowerCase() !== "publica"
  ) return null;

  const id = String(event.id ?? "").trim();
  if (!PUBLIC_REPLY_UUID_RE.test(id)) return null;

  return {
    reply_to: id,
    reply_preview: sanitizePublicReplyPreview(event.texto) || "(archivo adjunto)",
    reply_author: String(event.autor_tipo ?? "").trim().toLowerCase() || "sistema",
    reply_kind: String(event.kind ?? "").trim() || "mensaje",
  };
};
