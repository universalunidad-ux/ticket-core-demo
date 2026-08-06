// TC-DEB8FDCC-MEDIA-WORKER-V1-LOCAL-IMPLEMENTATION-28 · Commit B
//
// Worker de media `media-worker/v1`.
//
// Endpoint EXCLUSIVAMENTE interno:
//   * `verify_jwt = false` en config.toml, autenticado por secreto compartido
//     `MEDIA_WORKER_SECRET` en el header `x-media-worker-key`;
//   * sin CORS: no se emite ninguna cabecera Access-Control-*, el preflight se
//     rechaza; ningun navegador puede alcanzarlo;
//   * rechaza claves publicables y JWT de usuario aunque el secreto sea valido;
//   * no se auto-invoca: una invocacion procesa un lote acotado y termina.
//
// Ejecucion acotada: 5 jobs por invocacion, lease de 120 s, errores aislados
// por job. La respuesta son conteos agregados, nunca datos del adjunto.
//
// Ningun camino marca un adjunto como 'listo' sin haber descargado el objeto,
// recalculado su SHA-256, revalidado los bytes magicos y producido derivados
// reales. La invariante final la fuerza la base:
// `public.tc_worker_complete_media_job` rechaza un conjunto de derivados vacio.

import {
  ImageMagick,
  initializeImageMagick,
  MagickFormat,
} from "@imagemagick/magick-wasm";
import {
  authorizeWorkerRequest,
  derivativeStoragePath,
  detectImageKind,
  MEDIA_REVIEW_MAX_EDGE,
  MEDIA_THUMBNAIL_MAX_EDGE,
  MEDIA_WORKER_BUCKET,
  MEDIA_WORKER_LEASE_SECONDS,
  MEDIA_WORKER_MAX_JOBS_PER_INVOCATION,
  MEDIA_WORKER_MAX_SOURCE_BYTES,
  mimeAgreesWithBytes,
  safeLogLine,
  sha256Hex,
  unsupportedKindReason,
  type DerivativePayload,
  type DerivativeType,
  type MediaJob,
  type QuarantineReason,
  type WorkerCounters,
} from "../_shared/media-job-contract.ts";

// ---------------------------------------------------------------------------
// Dependencias inyectables (permiten pruebas puras sin red ni Docker)
// ---------------------------------------------------------------------------

export interface WorkerDeps {
  secret: string | undefined;
  workerId: string;
  claimJobs(limit: number): Promise<MediaJob[]>;
  completeJob(job: MediaJob, derivatives: DerivativePayload[]): Promise<void>;
  quarantineJob(job: MediaJob, reason: QuarantineReason): Promise<void>;
  failJob(job: MediaJob, errorCode: string): Promise<string>;
  downloadObject(path: string): Promise<
    { ok: true; bytes: Uint8Array } | { ok: false; missing: boolean }
  >;
  uploadDerivative(path: string, bytes: Uint8Array): Promise<
    { ok: true } | { ok: false; conflict: boolean }
  >;
  renderDerivatives(bytes: Uint8Array): Promise<RenderedDerivative[]>;
  log(line: string): void;
}

export interface RenderedDerivative {
  tipo: DerivativeType;
  bytes: Uint8Array;
  ancho: number;
  alto: number;
}

/** Excepcion transitoria: reencola el job con backoff en vez de cuarentena. */
class TransientJobError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "TransientJobError";
  }
}

/** Rechazo determinista: cuarentena inmediata, sin consumir reintentos. */
class DeterministicRejection extends Error {
  constructor(public readonly reason: QuarantineReason) {
    super(reason);
    this.name = "DeterministicRejection";
  }
}

// ---------------------------------------------------------------------------
// Procesamiento de un job
// ---------------------------------------------------------------------------

async function processImageJob(
  job: MediaJob,
  deps: WorkerDeps,
): Promise<DerivativePayload[]> {
  if (job.tamano_bytes > MEDIA_WORKER_MAX_SOURCE_BYTES) {
    throw new DeterministicRejection("MEDIA_SIZE_LIMIT_EXCEEDED");
  }

  const download = await deps.downloadObject(job.storage_path);
  if (!download.ok) {
    if (download.missing) throw new DeterministicRejection("MEDIA_OBJECT_MISSING");
    throw new TransientJobError("MEDIA_STORAGE_DOWNLOAD_FAILED");
  }
  const source = download.bytes;

  if (source.length > MEDIA_WORKER_MAX_SOURCE_BYTES) {
    throw new DeterministicRejection("MEDIA_SIZE_LIMIT_EXCEEDED");
  }

  // 1. Checksum contra AMBAS autoridades: el job y el adjunto canonico.
  const actual = await sha256Hex(source);
  if (
    actual !== job.source_checksum_sha256 ||
    actual !== job.adjunto_checksum_sha256
  ) {
    throw new DeterministicRejection("MEDIA_SOURCE_CHECKSUM_MISMATCH");
  }

  // 2. Bytes magicos y conciliacion de MIME, revalidados desde cero.
  const kind = detectImageKind(source);
  if (!kind) throw new DeterministicRejection("MEDIA_SIGNATURE_OR_MIME_REJECTED");
  if (!mimeAgreesWithBytes(kind, job.mime_declarado, job.mime_detectado)) {
    throw new DeterministicRejection("MEDIA_SIGNATURE_OR_MIME_REJECTED");
  }

  // 3. Procesamiento real.
  let rendered: RenderedDerivative[];
  try {
    rendered = await deps.renderDerivatives(source);
  } catch {
    throw new DeterministicRejection("MEDIA_DECODE_FAILED");
  }
  if (rendered.length === 0) {
    throw new DeterministicRejection("MEDIA_DECODE_FAILED");
  }

  // 4. Subida idempotente con ruta determinista y upsert=false.
  const derivatives: DerivativePayload[] = [];
  for (const artifact of rendered) {
    const path = derivativeStoragePath(
      job.storage_path,
      job.adjunto_id,
      job.source_checksum_sha256,
      artifact.tipo,
    );
    const checksum = await sha256Hex(artifact.bytes);
    const upload = await deps.uploadDerivative(path, artifact.bytes);
    if (!upload.ok) {
      if (!upload.conflict) throw new TransientJobError("MEDIA_STORAGE_UPLOAD_FAILED");
      // Ya existe: se reutiliza solo si su checksum coincide.
      const existing = await deps.downloadObject(path);
      if (!existing.ok) throw new TransientJobError("MEDIA_STORAGE_REREAD_FAILED");
      const existingChecksum = await sha256Hex(existing.bytes);
      if (existingChecksum !== checksum) {
        throw new DeterministicRejection("MEDIA_DERIVATIVE_CHECKSUM_CONFLICT");
      }
    }
    derivatives.push({
      tipo: artifact.tipo,
      storage_path: path,
      mime_type: "image/webp",
      tamano_bytes: artifact.bytes.length,
      checksum_sha256: checksum,
      ancho: artifact.ancho,
      alto: artifact.alto,
    });
  }

  return derivatives;
}

async function runJob(job: MediaJob, deps: WorkerDeps, counters: WorkerCounters) {
  try {
    // PDF y video no se fingen: no hay procesador real y seguro todavia, de
    // modo que se rechazan de forma explicita y documentada en vez de quedar
    // eternamente en 'procesando'.
    const unsupported = unsupportedKindReason(job.adjunto_tipo);
    if (unsupported) throw new DeterministicRejection(unsupported);

    const derivatives = await processImageJob(job, deps);
    await deps.completeJob(job, derivatives);
    counters.completed += 1;
    deps.log(safeLogLine("media_worker_job", {
      job: job.job_id,
      outcome: "completed",
      derivatives: derivatives.length,
    }));
  } catch (error) {
    if (error instanceof DeterministicRejection) {
      try {
        await deps.quarantineJob(job, error.reason);
        counters.quarantined += 1;
        deps.log(safeLogLine("media_worker_job", {
          job: job.job_id,
          outcome: "quarantined",
          reason: error.reason,
        }));
      } catch {
        counters.failed += 1;
        deps.log(safeLogLine("media_worker_job", {
          job: job.job_id,
          outcome: "quarantine_failed",
        }));
      }
      return;
    }

    const code = error instanceof TransientJobError ? error.code : "MEDIA_WORKER_UNEXPECTED";
    try {
      const state = await deps.failJob(job, code);
      counters.failed += 1;
      deps.log(safeLogLine("media_worker_job", {
        job: job.job_id,
        outcome: "failed",
        code,
        state,
      }));
    } catch {
      counters.failed += 1;
      deps.log(safeLogLine("media_worker_job", { job: job.job_id, outcome: "fail_rpc_failed" }));
    }
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  // Sin CORS por diseno: ningun Access-Control-*, ningun Vary: Origin.
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export function buildHandler(deps: WorkerDeps) {
  return async function handler(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") {
      return jsonResponse(405, { error: "MEDIA_WORKER_PREFLIGHT_NOT_SUPPORTED" });
    }
    if (request.method !== "POST") {
      return jsonResponse(405, { error: "MEDIA_WORKER_METHOD_NOT_ALLOWED" });
    }

    const decision = authorizeWorkerRequest(request.headers, deps.secret);
    if (!decision.ok) {
      deps.log(safeLogLine("media_worker_auth", { outcome: "denied", code: decision.code }));
      return jsonResponse(decision.status, { error: decision.code });
    }

    const counters: WorkerCounters = {
      claimed: 0,
      completed: 0,
      quarantined: 0,
      failed: 0,
      empty: true,
    };

    let jobs: MediaJob[];
    try {
      jobs = await deps.claimJobs(MEDIA_WORKER_MAX_JOBS_PER_INVOCATION);
    } catch {
      deps.log(safeLogLine("media_worker_claim", { outcome: "failed" }));
      return jsonResponse(503, { error: "MEDIA_WORKER_CLAIM_FAILED" });
    }

    counters.claimed = jobs.length;
    counters.empty = jobs.length === 0;

    // Errores por job aislados: el lote nunca se cancela por uno malo.
    for (const job of jobs) {
      await runJob(job, deps, counters);
    }

    deps.log(safeLogLine("media_worker_batch", {
      claimed: counters.claimed,
      completed: counters.completed,
      quarantined: counters.quarantined,
      failed: counters.failed,
      empty: counters.empty,
    }));

    return jsonResponse(200, {
      version: "media-worker/v1",
      claimed: counters.claimed,
      completed: counters.completed,
      quarantined: counters.quarantined,
      failed: counters.failed,
      empty: counters.empty,
    });
  };
}

// ---------------------------------------------------------------------------
// Dependencias reales
// ---------------------------------------------------------------------------

let magickReady: Promise<void> | null = null;

function ensureMagick(): Promise<void> {
  if (!magickReady) {
    magickReady = (async () => {
      const wasm = await Deno.readFile(
        new URL("magick.wasm", import.meta.resolve("@imagemagick/magick-wasm")),
      );
      await initializeImageMagick(wasm);
    })();
  }
  return magickReady;
}

function encodeWebp(
  source: Uint8Array,
  maxEdge: number,
  quality: number,
  tipo: DerivativeType,
): RenderedDerivative {
  let result: RenderedDerivative | null = null;
  ImageMagick.read(source, (image) => {
    const longest = Math.max(image.width, image.height);
    if (longest > maxEdge) {
      const scale = maxEdge / longest;
      image.resize(
        Math.max(1, Math.round(image.width * scale)),
        Math.max(1, Math.round(image.height * scale)),
      );
    }
    image.strip();
    image.quality = quality;
    const width = image.width;
    const height = image.height;
    image.write(MagickFormat.WebP, (bytes) => {
      result = { tipo, bytes: new Uint8Array(bytes), ancho: width, alto: height };
    });
  });
  if (!result) throw new Error("MEDIA_DECODE_FAILED");
  return result;
}

export async function renderImageDerivatives(source: Uint8Array): Promise<RenderedDerivative[]> {
  await ensureMagick();
  return [
    encodeWebp(source, MEDIA_REVIEW_MAX_EDGE, 82, "review_webp"),
    encodeWebp(source, MEDIA_THUMBNAIL_MAX_EDGE, 75, "thumbnail_webp"),
  ];
}

export function defaultDeps(): WorkerDeps {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const secret = Deno.env.get("MEDIA_WORKER_SECRET");
  const workerId = `media-worker/v1:${Deno.env.get("SB_REGION") ?? "local"}`;

  const serviceHeaders = () => ({
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
  });

  async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { ...serviceHeaders(), "content-type": "application/json" },
      body: JSON.stringify(args),
    });
    if (!response.ok) {
      // El cuerpo puede contener detalle de la base: no se propaga ni se loguea.
      await response.body?.cancel();
      throw new Error(`RPC_${name.toUpperCase()}_${response.status}`);
    }
    return await response.json() as T;
  }

  return {
    secret,
    workerId,
    log: (line) => console.log(line),

    claimJobs: (limit) =>
      rpc<MediaJob[]>("tc_worker_claim_media_jobs", {
        p_worker_id: workerId,
        p_lease_seconds: MEDIA_WORKER_LEASE_SECONDS,
        p_limit: limit,
      }),

    completeJob: (job, derivatives) =>
      rpc<null>("tc_worker_complete_media_job", {
        p_job_id: job.job_id,
        p_lease_token: job.lease_token,
        p_derivados: derivatives,
      }).then(() => undefined),

    quarantineJob: (job, reason) =>
      rpc<null>("tc_worker_quarantine_media_job", {
        p_job_id: job.job_id,
        p_lease_token: job.lease_token,
        p_motivo_codigo: reason,
      }).then(() => undefined),

    failJob: (job, errorCode) =>
      rpc<string>("tc_worker_fail_media_job", {
        p_job_id: job.job_id,
        p_lease_token: job.lease_token,
        p_error_code: errorCode,
      }),

    async downloadObject(path) {
      const response = await fetch(
        `${supabaseUrl}/storage/v1/object/${MEDIA_WORKER_BUCKET}/${path}`,
        { headers: serviceHeaders() },
      );
      if (response.status === 404) {
        await response.body?.cancel();
        return { ok: false, missing: true };
      }
      if (!response.ok) {
        await response.body?.cancel();
        return { ok: false, missing: false };
      }
      return { ok: true, bytes: new Uint8Array(await response.arrayBuffer()) };
    },

    async uploadDerivative(path, bytes) {
      const response = await fetch(
        `${supabaseUrl}/storage/v1/object/${MEDIA_WORKER_BUCKET}/${path}`,
        {
          method: "POST",
          headers: {
            ...serviceHeaders(),
            "content-type": "image/webp",
            "x-upsert": "false",
          },
          body: bytes as BodyInit,
        },
      );
      if (response.ok) {
        await response.body?.cancel();
        return { ok: true };
      }
      const conflict = response.status === 409;
      await response.body?.cancel();
      return { ok: false, conflict };
    },

    renderDerivatives: renderImageDerivatives,
  };
}

if (import.meta.main) {
  Deno.serve(buildHandler(defaultDeps()));
}
