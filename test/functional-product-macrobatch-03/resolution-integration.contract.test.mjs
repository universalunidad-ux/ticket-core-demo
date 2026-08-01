import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = path => readFileSync(join(root, path), "utf8");
const html = read("app/ticket.html");
const ticket = read("app/ticket.js");
const workbench = read("app/shared/ticket-resolution-workbench.js");

test("detalle carga hoja y módulo del workbench", () => {
  assert.match(html, /ticket-resolution-workbench\.css\?v=frontend-final-20260716-01/);
  assert.match(ticket, /from"\.\/shared\/ticket-resolution-workbench\.js"/);
});

test("lanzador apunta al diálogo existente", () => {
  assert.match(html, /data-resolution-open[^>]+aria-controls="tkResolutionWorkbench"/);
  assert.match(html, /id="tkResolutionWorkbench"[^>]+role="dialog"/);
});

test("integración prepara el compositor sin enviar automáticamente", () => {
  assert.match(ticket, /onApplyMessage:applyResolutionMessage/);
  assert.match(ticket, /setComposerMode\(close\?"solucion":"seguimiento"/);
  assert.match(ticket, /field\.focus\(\)/);
  assert.doesNotMatch(workbench, /\.click\(\)|saveLog|from\("ticket_eventos"\)/);
});

test("encuesta de cierre selecciona solución y resuelto", () => {
  assert.match(ticket, /close\?"resuelto":""/);
  assert.match(workbench, /buildClosureSurvey/);
  assert.match(workbench, /surveyPrepared:\s*true/);
});

test("render actualiza el ticket activo sin remount", () => {
  assert.equal((ticket.match(/createResolutionWorkbench\(/g) || []).length, 1);
  assert.match(ticket, /resolutionWorkbench\?\.update\(\)/);
  assert.match(ticket, /if\(!root\|\|resolutionWorkbench\)return/);
});

test("ciclo de vida destruye listeners al salir", () => {
  assert.match(ticket, /resolutionWorkbench\?\.destroy\(\)/);
  assert.match(workbench, /controller\?\.abort\(\)/);
  assert.match(workbench, /\{\s*signal\s*\}/);
});

test("usa el owner global de diálogos para foco y Escape", () => {
  assert.match(ticket, /openDialogOwner:openDialog/);
  assert.match(ticket, /closeDialogOwner:closeDialog/);
  assert.match(workbench, /onCloseRequest:\s*close/);
  assert.doesNotMatch(workbench, /document\.addEventListener\("keydown"/);
});
