import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const handler = readFileSync(
  new URL(
    "../../supabase/functions/ticket-escalar-admin/index.ts",
    import.meta.url,
  ),
  "utf8",
);

const edge = readFileSync(
  new URL(
    "../../tools/l130-authenticated-qa/edge-contract-http.mjs",
    import.meta.url,
  ),
  "utf8",
);

const block = handler.match(
  /async function bitacoraSafe\([^)]*\)\s*\{[\s\S]*?\.from\("bitacora"\)\.insert\(\{([\s\S]*?)\}\);/,
)?.[1];

test("bitacoraSafe conserva owner único", () => {
  assert.ok(block);

  assert.equal(
    (
      handler.match(
        /async function bitacoraSafe\(/g,
      ) || []
    ).length,
    1,
  );
});

test("bitacoraSafe no envía fecha generated", () => {
  assert.doesNotMatch(block, /\bfecha\s*:/);
});

test("bitacoraSafe usa tipo nota_interna", () => {
  assert.match(
    block,
    /\btipo:\s*"nota_interna"/,
  );

  assert.doesNotMatch(
    block,
    /\btipo:\s*"sistema"/,
  );
});

test("runtime verifica la fila antes del PASS B130", () => {
  const query = edge.indexOf(
    "where accion = 'ticket_supervision_escalada'",
  );

  const guard = edge.indexOf(
    'b131BitacoraProbe !== "1|0"',
  );

  const auditPass = edge.indexOf(
    "ESCALATION_BITACORA_WRITTEN=PASS",
  );

  const b130Pass = edge.indexOf(
    "B130_003_EDGE_E2E=PASS",
  );

  assert.ok(query >= 0);
  assert.ok(guard > query);
  assert.ok(auditPass > guard);
  assert.ok(b130Pass > auditPass);
});

test("runtime exige fecha derivada de created_at", () => {
  assert.match(
    edge,
    /fecha is distinct from created_at/,
  );
});

test("runtime falla si la auditoría no existe", () => {
  assert.match(
    edge,
    /E_ESCALATION_BITACORA_NOT_WRITTEN/,
  );
});

test("runtime usa el contenedor local existente", () => {
  assert.match(
    edge,
    /"docker"[\s\S]*"exec"[\s\S]*dbCid[\s\S]*"psql"/,
  );
});
