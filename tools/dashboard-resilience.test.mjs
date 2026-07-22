#!/usr/bin/env node
/* TC-U15A-2 — pruebas del módulo PURO de resiliencia del Dashboard.
   Cubre: clasificación de errores, paginación, guarda anti-stale, degradación parcial
   (conservar último resultado válido) y redacción de evidencia. Cero red, cero DOM. */
import assert from "node:assert/strict";
import {
  LOAD_ERROR_KINDS, classifyLoadError, describeLoadError,
  paginate, pageItems, createSequence, keepLastValid,
  evidenceView, evidenceStoragePath, internalMessagePreview,
  hasSensitiveLeak, cleanStoragePath,
} from "../app/shared/dashboard-resilience.js";

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`PASS ${name}`) } catch (error) { console.error(`FAIL ${name}: ${error.stack || error.message}`); process.exitCode = 1 } };

/* ---------- clasificación de errores ---------- */
test("clasificación: cada caso cae en su categoría (causa, no efecto)", () => {
  assert.equal(classifyLoadError({ code: "42501", message: "permission denied for table tickets" }), "PERMISSION_DENIED");
  assert.equal(classifyLoadError({ message: "new row violates row-level security policy" }), "RLS_DENIED");
  assert.equal(classifyLoadError({ code: "42703", message: 'column "requiere_supervision" does not exist' }), "MISSING_COLUMN");
  assert.equal(classifyLoadError({ code: "42P01", message: 'relation "v_janome_dashboard_agentes" does not exist' }), "MISSING_VIEW");
  assert.equal(classifyLoadError({ code: "PGRST205", message: "Could not find the table 'public.x' in the schema cache" }), "MISSING_VIEW");
  assert.equal(classifyLoadError({ message: "TypeError: Failed to fetch" }), "NETWORK_ERROR");
  assert.equal(classifyLoadError({ code: "57014", message: "canceling statement due to statement timeout" }), "TIMEOUT");
  assert.equal(classifyLoadError({ name: "AbortError", message: "aborted" }), "TIMEOUT");
  assert.equal(classifyLoadError({ message: "algo raro sin patrón" }), "UNKNOWN_ERROR");
  assert.equal(classifyLoadError(null), "UNKNOWN_ERROR");
});

test("clasificación: RLS se distingue de red, y timeout de red", () => {
  assert.notEqual(classifyLoadError({ message: "row-level security" }), classifyLoadError({ message: "Failed to fetch" }));
  assert.notEqual(classifyLoadError({ message: "statement timeout" }), classifyLoadError({ message: "NetworkError when attempting to fetch resource" }));
});

test("clasificación: todo tipo tiene mensaje administrativo no vacío", () => {
  for (const kind of LOAD_ERROR_KINDS) {
    const msg = describeLoadError(kind);
    assert.ok(typeof msg === "string" && msg.length > 0, `sin mensaje para ${kind}`);
    assert.ok(!hasSensitiveLeak(msg), `mensaje de ${kind} filtra dato sensible`);
  }
});

/* ---------- paginación ---------- */
test("paginación: acota página, calcula páginas y extremos", () => {
  assert.deepEqual(paginate({ total: 12, page: 0, size: 5 }), { total: 12, size: 5, pages: 3, page: 0, from: 0, to: 5, hasPrev: false, hasNext: true });
  assert.deepEqual(paginate({ total: 12, page: 2, size: 5 }), { total: 12, size: 5, pages: 3, page: 2, from: 10, to: 12, hasPrev: true, hasNext: false });
  assert.equal(paginate({ total: 12, page: 99, size: 5 }).page, 2, "página fuera de rango debe acotarse al último índice");
  assert.equal(paginate({ total: 0, page: 0, size: 5 }).pages, 1, "cero elementos => una página");
  assert.equal(paginate({ total: 12, page: -3, size: 5 }).page, 0, "página negativa => 0");
});

test("paginación: 5 por página es el tamaño de Supervisión", () => {
  const items = Array.from({ length: 13 }, (_, i) => i);
  assert.deepEqual(pageItems(items, 0, 5), [0, 1, 2, 3, 4]);
  assert.deepEqual(pageItems(items, 2, 5), [10, 11, 12]);
  assert.equal(pageItems(items, 0, 5).length <= 5, true);
});

/* ---------- guarda anti-stale ---------- */
test("stale: sólo la última carga aplica su resultado", () => {
  const seq = createSequence();
  const a = seq.next(); // carga A
  const b = seq.next(); // carga B (posterior)
  assert.equal(seq.isCurrent(a), false, "A quedó obsoleta al iniciar B");
  assert.equal(seq.isCurrent(b), true, "B es la vigente");
  seq.next(); // C
  assert.equal(seq.isCurrent(b), false, "B quedó obsoleta al iniciar C");
});

/* ---------- degradación parcial ---------- */
test("degradación: éxito adopta el nuevo valor y limpia error", () => {
  const s = keepLastValid({ value: null }, { ok: true, value: [1, 2, 3] });
  assert.deepEqual(s.value, [1, 2, 3]);
  assert.equal(s.error, null);
  assert.equal(s.stale, false);
});

test("degradación: falla conserva el último valor válido y marca stale + tipo", () => {
  const good = keepLastValid({ value: null }, { ok: true, value: ["perfil"] });
  const afterFail = keepLastValid(good, { ok: false, error: { message: "Failed to fetch" } });
  assert.deepEqual(afterFail.value, ["perfil"], "no se destruye la sección con datos válidos previos");
  assert.equal(afterFail.stale, true);
  assert.equal(afterFail.error, "NETWORK_ERROR");
});

test("degradación: falla sin datos previos no inventa nada", () => {
  const s = keepLastValid({ value: null }, { ok: false, errorKind: "RLS_DENIED" });
  assert.equal(s.value, null, "nunca inventa conteos ni filas");
  assert.equal(s.stale, false);
  assert.equal(s.error, "RLS_DENIED");
});

/* ---------- redacción de evidencia ---------- */
test("evidencia: nunca expone URL firmada, token ni @thumb", () => {
  const meta = {
    content_type: "image",
    ref_archivo_meta: { storage_path: "soporte/abc@thumb", nombre_archivo: "recibo@thumb.jpg", tamano_bytes: 2048 },
    comentario: "Revisar https://x.co/sign/abc?token=eyJabc123&X-Amz-Signature=zz",
  };
  const view = evidenceView(meta, { prettyBytes: n => `${Math.round(n / 1024)} KB` });
  assert.equal(view.kind, "image");
  assert.equal(view.hasImage, true);
  assert.ok(!/@thumb/i.test(view.fileName), "el nombre visible no debe contener @thumb");
  assert.ok(!hasSensitiveLeak(view.fileName), "el nombre visible no filtra secretos");
  assert.equal(view.fileSize, "2 KB");
  /* El texto interno con URL/token/JWT se descarta por completo. */
  assert.equal(internalMessagePreview(meta), "");
  /* El storage_path (uso interno para firmar) se limpia de @thumb y no se renderiza. */
  assert.equal(evidenceStoragePath(meta), "soporte/abc");
  assert.equal(cleanStoragePath("soporte/abc@thumb"), "soporte/abc");
});

test("evidencia: sin adjunto produce estado vacío, no imagen rota", () => {
  const view = evidenceView({ content_type: "text", comentario: "Se requiere apoyo con la garantía" });
  assert.equal(view.kind, "text");
  assert.equal(view.hasImage, false);
  assert.equal(internalMessagePreview({ content_type: "text", comentario: "Se requiere apoyo con la garantía" }), "Se requiere apoyo con la garantía");
  const none = evidenceView({});
  assert.equal(none.kind, "none");
  assert.equal(none.hasImage, false);
});

if (!process.exitCode) console.log(`DASHBOARD_RESILIENCE_TESTS=PASS (${passed})`);
