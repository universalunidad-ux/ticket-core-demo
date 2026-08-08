export const MEDIA_VIDEO_SHORT_LIMIT_MS = 15_000;
export const MEDIA_VIDEO_EXCEPTION_LIMIT_MS = 30_000;

export type MediaVideoAuthorization =
  | "segundo_video_15s"
  | "excepcion_30s";

export interface MediaVideoPolicyInput {
  durationMs: number;
  serverVideoOrdinal: number;
  authorizations?: readonly MediaVideoAuthorization[];
}

export interface MediaVideoPolicyResult {
  accepted: boolean;
  requiredAuthorizations: MediaVideoAuthorization[];
  maximumDurationMs: number;
  errorCode: string | null;
}

export function evaluateMediaVideoPolicy(
  input: MediaVideoPolicyInput,
): MediaVideoPolicyResult {
  if (
    !Number.isInteger(input.durationMs) ||
    input.durationMs <= 0 ||
    !Number.isInteger(input.serverVideoOrdinal) ||
    input.serverVideoOrdinal <= 0
  ) {
    return {
      accepted: false,
      requiredAuthorizations: [],
      maximumDurationMs: MEDIA_VIDEO_SHORT_LIMIT_MS,
      errorCode: "E_MEDIA_VIDEO_INPUT_INVALIDO",
    };
  }

  if (input.durationMs > MEDIA_VIDEO_EXCEPTION_LIMIT_MS) {
    return {
      accepted: false,
      requiredAuthorizations: [],
      maximumDurationMs: MEDIA_VIDEO_EXCEPTION_LIMIT_MS,
      errorCode: "E_MEDIA_DURACION_EXCEDIDA",
    };
  }

  const available = new Set(
    input.authorizations ?? [],
  );

  const required: MediaVideoAuthorization[] = [];

  if (input.serverVideoOrdinal > 1) {
    required.push("segundo_video_15s");
  }

  if (input.durationMs > MEDIA_VIDEO_SHORT_LIMIT_MS) {
    required.push("excepcion_30s");
  }

  const missing = required.filter(
    authorization => !available.has(authorization),
  );

  if (missing.length > 0) {
    return {
      accepted: false,
      requiredAuthorizations: missing,
      maximumDurationMs:
        input.durationMs > MEDIA_VIDEO_SHORT_LIMIT_MS
          ? MEDIA_VIDEO_EXCEPTION_LIMIT_MS
          : MEDIA_VIDEO_SHORT_LIMIT_MS,
      errorCode: "E_MEDIA_AUTORIZACION_NO_DISPONIBLE",
    };
  }

  return {
    accepted: true,
    requiredAuthorizations: required,
    maximumDurationMs:
      input.durationMs > MEDIA_VIDEO_SHORT_LIMIT_MS
        ? MEDIA_VIDEO_EXCEPTION_LIMIT_MS
        : MEDIA_VIDEO_SHORT_LIMIT_MS,
    errorCode: null,
  };
}
