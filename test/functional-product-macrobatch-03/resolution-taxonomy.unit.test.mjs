import assert from "node:assert/strict";
import test from "node:test";
import {
  MACHINE_FAILURE_TAXONOMY,
  buildClosureSurvey,
  buildNextStepMessage,
  classifyMachineFailure,
  resolutionProgress,
  sanitizeResolutionState,
} from "../../app/shared/ticket-resolution-workbench.js";

test("la taxonomía tiene ids únicos y pasos accionables", () => {
  assert.equal(new Set(MACHINE_FAILURE_TAXONOMY.map(item => item.id)).size, MACHINE_FAILURE_TAXONOMY.length);
  assert.ok(MACHINE_FAILURE_TAXONOMY.every(item => item.label && item.evidence && item.steps.length === 3));
});

test("clasifica hilo y tensión ignorando acentos", () => {
  const result = classifyMachineFailure({ titulo: "Tensión irregular", descripcion: "El hilo se enreda" });
  assert.equal(result.id, "thread");
  assert.equal(result.confidence, "alta");
});

test("clasifica aguja con confianza media", () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(classifyMachineFailure({ descripcion: "Se rompe la aguja" })).filter(([key]) => ["id", "confidence"].includes(key))),
    { id: "needle", confidence: "media" },
  );
});

test("clasifica pantalla y código como electrónico", () => {
  assert.equal(classifyMachineFailure({ titulo: "Código en pantalla" }).id, "electronic");
});

test("usa categoría por confirmar cuando no hay señales", () => {
  assert.equal(classifyMachineFailure({ titulo: "Necesito ayuda" }).id, "other");
});

test("sanitiza categoría, hallazgo y pasos ajenos", () => {
  const state = sanitizeResolutionState({
    category: "thread",
    finding: `  ${"x".repeat(700)}  `,
    completed: ["Confirmar hilo, aguja y tela", "paso inventado"],
  });
  assert.equal(state.finding.length, 500);
  assert.deepEqual(state.completed, ["Confirmar hilo, aguja y tela"]);
});

test("deduplica pasos completados", () => {
  const step = "Confirmar hilo, aguja y tela";
  assert.deepEqual(sanitizeResolutionState({ category: "thread", completed: [step, step] }).completed, [step]);
});

test("progreso exige todos los pasos y un hallazgo", () => {
  const steps = MACHINE_FAILURE_TAXONOMY.find(item => item.id === "thread").steps;
  assert.equal(resolutionProgress({ category: "thread", completed: steps }).readyForSurvey, false);
  assert.equal(resolutionProgress({ category: "thread", completed: steps, finding: "Muestra uniforme" }).readyForSurvey, true);
});

test("siguiente paso incluye evidencia concreta", () => {
  const text = buildNextStepMessage({ state: { category: "motion", completed: [] } });
  assert.match(text, /Detener operación/);
  assert.match(text, /Video corto/);
});

test("encuesta incorpora folio, hallazgo y escala", () => {
  const text = buildClosureSurvey({
    ticket: { folio: "TC-42" },
    state: { category: "needle", finding: "Aguja corregida" },
    clientName: "María",
  });
  assert.match(text, /María/);
  assert.match(text, /TC-42/);
  assert.match(text, /Aguja corregida/);
  assert.match(text, /1 al 5/);
});
