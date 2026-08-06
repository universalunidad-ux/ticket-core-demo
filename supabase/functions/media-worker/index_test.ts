// TC-DEB8FDCC-MEDIA-WORKER-V1-LOCAL-IMPLEMENTATION-28 · Commit B
//
// Pruebas puras del worker `media-worker/v1`. No requieren Docker, ni
// PostgreSQL, ni `supabase functions serve`: el handler recibe sus
// dependencias inyectadas y el procesamiento de imagen se ejerce de verdad
// contra magick-wasm.
//
//   deno task check   (typecheck)
//   deno task test    (ejecucion)

// Aserciones minimas locales: el worker no arrastra dependencias de test para
// no introducir imports flotantes en el runtime de Edge Functions.
function assert(condition: unknown, message = "assertion failed"): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals<T>(actual: T, expected: T, message?: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    throw new Error(`${message ?? "values differ"}\n  actual:   ${a}\n  expected: ${b}`);
  }
}

function assertStringIncludes(actual: string, needle: string, message?: string): void {
  if (!actual.includes(needle)) {
    throw new Error(`${message ?? "substring not found"}: ${needle}`);
  }
}

import {
  ImageMagick,
  initializeImageMagick,
  MagickColors,
  MagickFormat,
} from "@imagemagick/magick-wasm";
import {
  buildHandler,
  renderImageDerivatives,
  type RenderedDerivative,
  type WorkerDeps,
} from "./index.ts";
import {
  authorizeWorkerRequest,
  derivativeStoragePath,
  detectImageKind,
  mimeAgreesWithBytes,
  safeLogLine,
  sha256Hex,
  type DerivativePayload,
  type MediaJob,
  type QuarantineReason,
} from "../_shared/media-job-contract.ts";

const SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef";
const WRONG_SECRET = "ffffffffffffffffffffffffffffffffffffffffffffffff";

// ---------------------------------------------------------------------------
// Fixture de imagen real, generada en memoria (sin binarios en el repo).
// ---------------------------------------------------------------------------

let magickInitialised = false;
async function ensureMagick() {
  if (magickInitialised) return;
  await initializeImageMagick(
    await Deno.readFile(new URL("magick.wasm", import.meta.resolve("@imagemagick/magick-wasm"))),
  );
  magickInitialised = true;
}

async function makePng(width = 96, height = 64): Promise<Uint8Array> {
  await ensureMagick();
  let out: Uint8Array | null = null;
  ImageMagick.read(MagickColors.Fuchsia, width, height, (image) => {
    image.write(MagickFormat.Png, (bytes) => {
      out = new Uint8Array(bytes);
    });
  });
  if (!out) throw new Error("fixture generation failed");
  return out;
}

// ---------------------------------------------------------------------------
// Dobles de prueba
// ---------------------------------------------------------------------------

interface Recorder {
  completed: Array<{ job: MediaJob; derivatives: DerivativePayload[] }>;
  quarantined: Array<{ job: MediaJob; reason: QuarantineReason }>;
  failed: Array<{ job: MediaJob; code: string }>;
  logs: string[];
}

function baseJob(overrides: Partial<MediaJob> = {}): MediaJob {
  return {
    job_id: "11111111-1111-1111-1111-111111111111",
    lease_token: "22222222-2222-2222-2222-222222222222",
    adjunto_id: "33333333-3333-3333-3333-333333333333",
    job_tipo: "procesar_imagen",
    job_version: "media-worker/v1",
    source_checksum_sha256: "0".repeat(64),
    intentos: 1,
    max_intentos: 5,
    bucket_id: "soporte_adjuntos",
    storage_path: "44444444-4444-4444-4444-444444444444/sm/original.png",
    mime_declarado: "image/png",
    mime_detectado: "image/png",
    adjunto_tipo: "image",
    adjunto_estado: "procesando",
    tamano_bytes: 1024,
    adjunto_checksum_sha256: "0".repeat(64),
    ...overrides,
  };
}

function makeDeps(options: {
  jobs?: MediaJob[];
  objects?: Map<string, Uint8Array>;
  downloadFails?: boolean;
  uploadConflictFor?: string;
  uploadFails?: boolean;
  renderThrows?: boolean;
  claimThrows?: boolean;
  secret?: string;
} = {}): { deps: WorkerDeps; rec: Recorder } {
  const rec: Recorder = { completed: [], quarantined: [], failed: [], logs: [] };
  const objects = options.objects ?? new Map<string, Uint8Array>();

  const deps: WorkerDeps = {
    // Se distingue "no se paso la opcion" de "se paso undefined a proposito".
    secret: Object.prototype.hasOwnProperty.call(options, "secret") ? options.secret : SECRET,
    workerId: "media-worker/v1:test",
    log: (line) => rec.logs.push(line),

    claimJobs: (limit) => {
      if (options.claimThrows) return Promise.reject(new Error("boom"));
      return Promise.resolve((options.jobs ?? []).slice(0, limit));
    },

    completeJob: (job, derivatives) => {
      rec.completed.push({ job, derivatives });
      return Promise.resolve();
    },
    quarantineJob: (job, reason) => {
      rec.quarantined.push({ job, reason });
      return Promise.resolve();
    },
    failJob: (job, code) => {
      rec.failed.push({ job, code });
      return Promise.resolve(job.intentos >= job.max_intentos ? "muerto" : "fallido");
    },

    downloadObject: (path) => {
      if (options.downloadFails) return Promise.resolve({ ok: false as const, missing: false });
      const bytes = objects.get(path);
      if (!bytes) return Promise.resolve({ ok: false as const, missing: true });
      return Promise.resolve({ ok: true as const, bytes });
    },

    uploadDerivative: (path, bytes) => {
      if (options.uploadFails) return Promise.resolve({ ok: false as const, conflict: false });
      if (options.uploadConflictFor && path.includes(options.uploadConflictFor)) {
        return Promise.resolve({ ok: false as const, conflict: true });
      }
      objects.set(path, bytes);
      return Promise.resolve({ ok: true as const });
    },

    renderDerivatives: (bytes) => {
      if (options.renderThrows) return Promise.reject(new Error("decode"));
      return renderImageDerivatives(bytes);
    },
  };

  return { deps, rec };
}

function post(headers: Record<string, string> = {}): Request {
  return new Request("http://internal/media-worker", { method: "POST", headers });
}

const authed = { "x-media-worker-key": SECRET };

function assertNoCors(response: Response) {
  for (const header of response.headers.keys()) {
    assert(
      !header.toLowerCase().startsWith("access-control-"),
      `response must not emit CORS header ${header}`,
    );
  }
}

// ---------------------------------------------------------------------------
// T01..T07  autenticacion y superficie del endpoint
// ---------------------------------------------------------------------------

Deno.test("T01 sin credencial: denegado", async () => {
  const { deps } = makeDeps();
  const response = await buildHandler(deps)(post());
  assertEquals(response.status, 401);
  assertEquals((await response.json()).error, "MEDIA_WORKER_CREDENTIAL_REQUIRED");
  assertNoCors(response);
});

Deno.test("T02 credencial incorrecta: denegado", async () => {
  const { deps, rec } = makeDeps({ jobs: [baseJob()] });
  const response = await buildHandler(deps)(post({ "x-media-worker-key": WRONG_SECRET }));
  assertEquals(response.status, 401);
  assertEquals((await response.json()).error, "MEDIA_WORKER_CREDENTIAL_INVALID");
  assertEquals(rec.completed.length, 0, "a denied request must never claim jobs");
});

Deno.test("T03 clave publicable rechazada aunque el secreto sea correcto", async () => {
  const { deps } = makeDeps();
  const response = await buildHandler(deps)(
    post({ ...authed, apikey: "sb_publishable_abcdefghijklmnop" }),
  );
  assertEquals(response.status, 401);
  assertEquals((await response.json()).error, "MEDIA_WORKER_PUBLISHABLE_KEY_REJECTED");
});

Deno.test("T04 JWT de usuario (anon/authenticated) rechazado", async () => {
  const jwt = (role: string) =>
    `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({ role })).replace(/=+$/, "")}.signature`;
  for (const role of ["anon", "authenticated"]) {
    const { deps } = makeDeps();
    const response = await buildHandler(deps)(
      post({ ...authed, authorization: `Bearer ${jwt(role)}` }),
    );
    assertEquals(response.status, 401);
    assertEquals((await response.json()).error, "MEDIA_WORKER_USER_JWT_REJECTED");
  }
});

Deno.test("T05 secreto no configurado: fail-closed", async () => {
  for (const secret of [undefined, "corto"]) {
    const { deps } = makeDeps({ secret });
    const response = await buildHandler(deps)(post(authed));
    assertEquals(response.status, 503);
    assertEquals((await response.json()).error, "MEDIA_WORKER_NOT_CONFIGURED");
  }
});

Deno.test("T06 sin CORS: preflight y metodos ajenos rechazados", async () => {
  const { deps } = makeDeps();
  const handler = buildHandler(deps);
  for (const method of ["OPTIONS", "GET", "PUT", "DELETE"]) {
    const response = await handler(
      new Request("http://internal/media-worker", { method, headers: authed }),
    );
    assertEquals(response.status, 405);
    assertNoCors(response);
  }
});

Deno.test("T07 anti-recursion: la invocacion no se auto-invoca", async () => {
  const { deps } = makeDeps();
  const response = await buildHandler(deps)(post({ ...authed, "x-media-worker-depth": "1" }));
  assertEquals(response.status, 400);
  assertEquals((await response.json()).error, "MEDIA_WORKER_RECURSION_REJECTED");
});

// ---------------------------------------------------------------------------
// T08  cola vacia
// ---------------------------------------------------------------------------

Deno.test("T08 cola vacia: PASS con conteos en cero", async () => {
  const { deps } = makeDeps({ jobs: [] });
  const response = await buildHandler(deps)(post(authed));
  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    version: "media-worker/v1",
    claimed: 0,
    completed: 0,
    quarantined: 0,
    failed: 0,
    empty: true,
  });
});

Deno.test("T09 lote acotado a 5 jobs por invocacion", async () => {
  const png = await makePng();
  const sha = await sha256Hex(png);
  const objects = new Map<string, Uint8Array>();
  const jobs: MediaJob[] = [];
  for (let i = 0; i < 9; i += 1) {
    const path = `4444444${i}-4444-4444-4444-444444444444/sm/o${i}.png`;
    objects.set(path, png);
    jobs.push(baseJob({
      job_id: `1111111${i}-1111-1111-1111-111111111111`,
      storage_path: path,
      source_checksum_sha256: sha,
      adjunto_checksum_sha256: sha,
    }));
  }
  const { deps } = makeDeps({ jobs, objects });
  const body = await (await buildHandler(deps)(post(authed))).json();
  assertEquals(body.claimed, 5, "a single invocation must claim at most five jobs");
  assertEquals(body.completed, 5);
});

// ---------------------------------------------------------------------------
// T10..T14  rechazos deterministas
// ---------------------------------------------------------------------------

Deno.test("T10 checksum incorrecto: cuarentena", async () => {
  const png = await makePng();
  const objects = new Map([["p/o.png", png]]);
  const job = baseJob({
    storage_path: "p/o.png",
    source_checksum_sha256: "a".repeat(64),
    adjunto_checksum_sha256: "a".repeat(64),
  });
  const { deps, rec } = makeDeps({ jobs: [job], objects });
  const body = await (await buildHandler(deps)(post(authed))).json();
  assertEquals(body.quarantined, 1);
  assertEquals(rec.quarantined[0].reason, "MEDIA_SOURCE_CHECKSUM_MISMATCH");
  assertEquals(rec.completed.length, 0, "a checksum mismatch must never complete");
});

Deno.test("T11 magic bytes incorrectos: cuarentena", async () => {
  const notAnImage = new TextEncoder().encode("%PDF-1.7 this is not a png at all");
  const sha = await sha256Hex(notAnImage);
  const objects = new Map([["p/o.png", notAnImage]]);
  const job = baseJob({
    storage_path: "p/o.png",
    source_checksum_sha256: sha,
    adjunto_checksum_sha256: sha,
  });
  const { deps, rec } = makeDeps({ jobs: [job], objects });
  const body = await (await buildHandler(deps)(post(authed))).json();
  assertEquals(body.quarantined, 1);
  assertEquals(rec.quarantined[0].reason, "MEDIA_SIGNATURE_OR_MIME_REJECTED");
});

Deno.test("T12 MIME contradictorio con los bytes: cuarentena", async () => {
  const png = await makePng();
  const sha = await sha256Hex(png);
  const objects = new Map([["p/o.png", png]]);
  // Bytes PNG reales pero la subida declaro image/jpeg.
  const job = baseJob({
    storage_path: "p/o.png",
    source_checksum_sha256: sha,
    adjunto_checksum_sha256: sha,
    mime_declarado: "image/jpeg",
    mime_detectado: "image/png",
  });
  const { deps, rec } = makeDeps({ jobs: [job], objects });
  await buildHandler(deps)(post(authed));
  assertEquals(rec.quarantined[0].reason, "MEDIA_SIGNATURE_OR_MIME_REJECTED");
});

Deno.test("T13 objeto ausente: cuarentena, no reintento infinito", async () => {
  const job = baseJob({ storage_path: "p/missing.png" });
  const { deps, rec } = makeDeps({ jobs: [job], objects: new Map() });
  await buildHandler(deps)(post(authed));
  assertEquals(rec.quarantined[0].reason, "MEDIA_OBJECT_MISSING");
  assertEquals(rec.failed.length, 0);
});

Deno.test("T14 PDF y video no se fingen: cuarentena explicita", async () => {
  for (const [tipo, reason] of [
    ["pdf", "MEDIA_UNSUPPORTED_KIND_PDF"],
    ["video", "MEDIA_UNSUPPORTED_KIND_VIDEO"],
  ] as const) {
    const job = baseJob({ adjunto_tipo: tipo });
    const { deps, rec } = makeDeps({ jobs: [job] });
    const body = await (await buildHandler(deps)(post(authed))).json();
    assertEquals(body.quarantined, 1, `${tipo} must be quarantined`);
    assertEquals(body.completed, 0, `${tipo} must never be completed`);
    assertEquals(rec.quarantined[0].reason, reason);
  }
});

Deno.test("T15 fallo de decodificacion: cuarentena", async () => {
  const png = await makePng();
  const sha = await sha256Hex(png);
  const job = baseJob({
    storage_path: "p/o.png",
    source_checksum_sha256: sha,
    adjunto_checksum_sha256: sha,
  });
  const { deps, rec } = makeDeps({
    jobs: [job],
    objects: new Map([["p/o.png", png]]),
    renderThrows: true,
  });
  await buildHandler(deps)(post(authed));
  assertEquals(rec.quarantined[0].reason, "MEDIA_DECODE_FAILED");
});

// ---------------------------------------------------------------------------
// T16..T18  camino feliz con procesamiento real
// ---------------------------------------------------------------------------

Deno.test("T16 imagen valida: thumbnail real, derivados con checksum, job completado", async () => {
  const png = await makePng(400, 300);
  const sha = await sha256Hex(png);
  const objects = new Map([["p/o.png", png]]);
  const job = baseJob({
    storage_path: "p/o.png",
    source_checksum_sha256: sha,
    adjunto_checksum_sha256: sha,
  });
  const { deps, rec } = makeDeps({ jobs: [job], objects });

  const body = await (await buildHandler(deps)(post(authed))).json();
  assertEquals(body.completed, 1);
  assertEquals(body.quarantined, 0);
  assertEquals(body.failed, 0);

  const derivatives = rec.completed[0].derivatives;
  assertEquals(derivatives.length, 2);
  const thumb = derivatives.find((d) => d.tipo === "thumbnail_webp")!;
  const review = derivatives.find((d) => d.tipo === "review_webp")!;
  assert(thumb, "a real thumbnail must be produced");
  assert(review, "a review derivative must be produced");

  for (const derivative of derivatives) {
    assertEquals(derivative.mime_type, "image/webp");
    assert(/^[0-9a-f]{64}$/.test(derivative.checksum_sha256), "derivative checksum must be sha256");
    assert(derivative.tamano_bytes > 0, "derivative must not be empty");

    // El objeto realmente subido debe existir y su checksum coincidir.
    const stored = objects.get(derivative.storage_path);
    assert(stored, "derivative object must be persisted");
    assertEquals(await sha256Hex(stored!), derivative.checksum_sha256);

    // Y ser un WebP de verdad (RIFF....WEBP).
    assertEquals(new TextDecoder().decode(stored!.slice(0, 4)), "RIFF");
    assertEquals(new TextDecoder().decode(stored!.slice(8, 12)), "WEBP");
  }

  // El thumbnail esta realmente reducido.
  assert(thumb.ancho! <= 320 && thumb.alto! <= 320, "thumbnail must be bounded to 320px");
  assert(thumb.tamano_bytes < review.tamano_bytes, "thumbnail must be smaller than review");
});

Deno.test("T17 idempotencia: segunda invocacion reutiliza el derivado identico", async () => {
  const png = await makePng(200, 200);
  const sha = await sha256Hex(png);
  const objects = new Map([["p/o.png", png]]);
  const job = baseJob({
    storage_path: "p/o.png",
    source_checksum_sha256: sha,
    adjunto_checksum_sha256: sha,
  });

  const first = makeDeps({ jobs: [job], objects });
  await buildHandler(first.deps)(post(authed));
  const firstPaths = first.rec.completed[0].derivatives.map((d) => d.storage_path).sort();
  const objectCount = objects.size;

  // Segunda pasada: la subida choca porque el objeto ya existe (upsert=false).
  const second = makeDeps({ jobs: [job], objects, uploadConflictFor: "/derived/" });
  const body = await (await buildHandler(second.deps)(post(authed))).json();

  assertEquals(body.completed, 1, "an identical replay must still complete");
  assertEquals(body.quarantined, 0);
  const secondPaths = second.rec.completed[0].derivatives.map((d) => d.storage_path).sort();
  assertEquals(secondPaths, firstPaths, "derivative paths must be deterministic");
  assertEquals(objects.size, objectCount, "a replay must not create new objects");
});

Deno.test("T18 derivado existente con checksum distinto: cuarentena, nunca sobrescritura", async () => {
  const png = await makePng(200, 200);
  const sha = await sha256Hex(png);
  const objects = new Map([["p/o.png", png]]);
  const job = baseJob({
    storage_path: "p/o.png",
    source_checksum_sha256: sha,
    adjunto_checksum_sha256: sha,
  });
  // Se planta un objeto ajeno en la ruta derivada esperada.
  const collidingPath = derivativeStoragePath("p/o.png", job.adjunto_id, sha, "review_webp");
  objects.set(collidingPath, new TextEncoder().encode("contenido ajeno"));

  const { deps, rec } = makeDeps({ jobs: [job], objects, uploadConflictFor: "/derived/" });
  await buildHandler(deps)(post(authed));

  assertEquals(rec.quarantined[0].reason, "MEDIA_DERIVATIVE_CHECKSUM_CONFLICT");
  assertEquals(
    new TextDecoder().decode(objects.get(collidingPath)!),
    "contenido ajeno",
    "a conflicting derivative must never be overwritten",
  );
});

// ---------------------------------------------------------------------------
// T19..T21  fallos transitorios y aislamiento
// ---------------------------------------------------------------------------

Deno.test("T19 fallo transitorio de storage: reintento, no cuarentena", async () => {
  const job = baseJob({ storage_path: "p/o.png" });
  const { deps, rec } = makeDeps({ jobs: [job], downloadFails: true });
  const body = await (await buildHandler(deps)(post(authed))).json();
  assertEquals(body.failed, 1);
  assertEquals(body.quarantined, 0);
  assertEquals(rec.failed[0].code, "MEDIA_STORAGE_DOWNLOAD_FAILED");
});

Deno.test("T20 dead-letter: el ultimo intento devuelve 'muerto'", async () => {
  const job = baseJob({ intentos: 5, max_intentos: 5, storage_path: "p/o.png" });
  const { deps, rec } = makeDeps({ jobs: [job], downloadFails: true });
  await buildHandler(deps)(post(authed));
  assertEquals(rec.failed.length, 1);
  const logged = rec.logs.find((l) => l.includes("outcome=failed"))!;
  assertStringIncludes(logged, "state=muerto");
});

Deno.test("T21 errores por job aislados: un job malo no cancela el lote", async () => {
  const png = await makePng();
  const sha = await sha256Hex(png);
  const objects = new Map([["p/good.png", png]]);
  const good = baseJob({
    job_id: "aaaaaaaa-1111-1111-1111-111111111111",
    storage_path: "p/good.png",
    source_checksum_sha256: sha,
    adjunto_checksum_sha256: sha,
  });
  const missing = baseJob({
    job_id: "bbbbbbbb-1111-1111-1111-111111111111",
    storage_path: "p/gone.png",
  });
  const pdf = baseJob({ job_id: "cccccccc-1111-1111-1111-111111111111", adjunto_tipo: "pdf" });

  const { deps } = makeDeps({ jobs: [missing, good, pdf], objects });
  const body = await (await buildHandler(deps)(post(authed))).json();
  assertEquals(body.claimed, 3);
  assertEquals(body.completed, 1);
  assertEquals(body.quarantined, 2);
  assertEquals(body.failed, 0);
});

Deno.test("T22 fallo al reclamar: 503, sin efectos", async () => {
  const { deps, rec } = makeDeps({ claimThrows: true });
  const response = await buildHandler(deps)(post(authed));
  assertEquals(response.status, 503);
  assertEquals((await response.json()).error, "MEDIA_WORKER_CLAIM_FAILED");
  assertEquals(rec.completed.length + rec.quarantined.length + rec.failed.length, 0);
});

// ---------------------------------------------------------------------------
// T23..T26  contrato puro
// ---------------------------------------------------------------------------

Deno.test("T23 ruta derivada determinista, versionada e idempotente", () => {
  const sha = "abcdef0123456789".repeat(4);
  const a = derivativeStoragePath("uuid-prefix/sm/o.png", "adj-1", sha, "thumbnail_webp");
  const b = derivativeStoragePath("uuid-prefix/sm/o.png", "adj-1", sha, "thumbnail_webp");
  assertEquals(a, b, "the same inputs must always yield the same path");
  assertStringIncludes(a, "uuid-prefix/derived/");
  assertStringIncludes(a, "media-worker-v1");
  assertStringIncludes(a, "abcdef0123456789");
  assertStringIncludes(a, "thumbnail_webp");
  assert(
    a !== derivativeStoragePath("uuid-prefix/sm/o.png", "adj-1", sha, "review_webp"),
    "different derivative types must not collide",
  );
});

Deno.test("T24 deteccion de firma por bytes, no por extension", async () => {
  assertEquals(detectImageKind(await makePng()), "png");
  assertEquals(detectImageKind(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), "jpeg");
  assertEquals(
    detectImageKind(new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50])),
    "webp",
  );
  assertEquals(detectImageKind(new TextEncoder().encode("%PDF-1.7")), null);
  assertEquals(detectImageKind(new Uint8Array(0)), null);
});

Deno.test("T25 conciliacion de MIME estricta", () => {
  assert(mimeAgreesWithBytes("png", "image/png", "image/png"));
  assert(mimeAgreesWithBytes("png", "image/png; charset=binary", "IMAGE/PNG"));
  assert(!mimeAgreesWithBytes("png", "image/jpeg", "image/png"));
  assert(!mimeAgreesWithBytes("png", "image/png", "application/pdf"));
  assert(!mimeAgreesWithBytes("jpeg", "image/png", "image/png"));
});

Deno.test("T26 los logs no filtran secretos ni datos sensibles", async () => {
  const png = await makePng();
  const sha = await sha256Hex(png);
  const job = baseJob({
    storage_path: "p/o.png",
    source_checksum_sha256: sha,
    adjunto_checksum_sha256: sha,
  });
  const { deps, rec } = makeDeps({ jobs: [job], objects: new Map([["p/o.png", png]]) });
  await buildHandler(deps)(post({ ...authed, authorization: `Bearer ${SECRET}` }));

  const joined = rec.logs.join("\n");
  assert(!joined.includes(SECRET), "the shared secret must never be logged");
  assert(!joined.includes("original.png"), "file names must never be logged");
  assert(!joined.includes("Bearer"), "authorization material must never be logged");
  assertStringIncludes(joined, "event=media_worker_batch");

  // La funcion de redaccion neutraliza cualquier valor no opaco.
  const redacted = safeLogLine("probe", { token: "abc def@example.com", job: "abc-123" });
  assertStringIncludes(redacted, "token=[redacted]");
  assertStringIncludes(redacted, "job=abc-123");
});

Deno.test("T27 el catalogo de cuarentena coincide con el contrato SQL", async () => {
  const migrations = "../../migrations";
  const dir = new URL(migrations + "/", import.meta.url);
  let sql = "";
  for await (const entry of Deno.readDir(dir)) {
    if (entry.name.endsWith("_media_worker_v1_atomic_contract.sql")) {
      sql = await Deno.readTextFile(new URL(entry.name, dir));
    }
  }
  assert(sql.length > 0, "migration not found");
  const { QUARANTINE_REASONS } = await import("../_shared/media-job-contract.ts");
  for (const reason of QUARANTINE_REASONS) {
    assertStringIncludes(sql, `'${reason}'`);
  }
});

Deno.test("T28 authorizeWorkerRequest es exhaustiva", () => {
  const h = (init: Record<string, string>) => new Headers(init);
  assertEquals(authorizeWorkerRequest(h({}), SECRET).ok, false);
  assertEquals(authorizeWorkerRequest(h({ "x-media-worker-key": SECRET }), SECRET).ok, true);
  assertEquals(authorizeWorkerRequest(h({ "x-media-worker-key": "" }), SECRET).ok, false);
  assertEquals(
    authorizeWorkerRequest(h({ "x-media-worker-key": SECRET + "x" }), SECRET).ok,
    false,
    "a longer prefix-matching credential must be rejected",
  );
});

// Guarda de tipos: el resultado del render cumple el contrato declarado.
Deno.test("T29 el render produce exactamente review y thumbnail", async () => {
  const rendered: RenderedDerivative[] = await renderImageDerivatives(await makePng(500, 250));
  assertEquals(rendered.map((r) => r.tipo).sort(), ["review_webp", "thumbnail_webp"]);
  for (const artifact of rendered) {
    assert(artifact.bytes.length > 0);
    assert(artifact.ancho > 0 && artifact.alto > 0);
  }
});
