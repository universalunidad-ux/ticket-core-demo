import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const dashboardJs = fs.readFileSync(
  path.join(root, "app/dashboard.js"),
  "utf8",
);

const dashboardHtml = fs.readFileSync(
  path.join(root, "app/dashboard.html"),
  "utf8",
);

const workflow = fs.readFileSync(
  path.join(root, ".github/workflows/frontend-gates.yml"),
  "utf8",
);

let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test("roles: utiliza el helper canónico admin/owner/administrador", () => {
  assert.match(
    dashboardJs,
    /import\s*\{\s*isAdminRole\s*\}\s*from\s*["']\.\/shared\/ticket-scope\.js[^"']*["']/,
  );

  assert.match(
    dashboardJs,
    /CTX\.isAdmin\s*=\s*isAdminRole\(ctx\.rol\)/,
  );

  assert.doesNotMatch(
    dashboardJs,
    /\["admin",\s*"jefe",\s*"owner",\s*"administrador"\]\.includes\(ctx\.rol\)/,
  );
});

test("métricas: existe una definición única con las nueve métricas", () => {
  const block = dashboardJs.match(
    /const AGENT_METRICS\s*=\s*\[(.*?)\n\s*\];/s,
  )?.[1];

  assert.ok(block, "No se encontró AGENT_METRICS");

  const keys = [...block.matchAll(/\{key:"([A-Z_]+)"/g)]
    .map(match => match[1]);

  assert.deepEqual(keys, [
    "ACTIVE",
    "OPEN",
    "IN_PROGRESS",
    "WAITING_CUSTOMER",
    "CLOSED_RESOLVED",
    "HIGH_URGENT",
    "FIRST_RESPONSE_BREACHED",
    "RESOLUTION_BREACHED",
    "SUPERVISION_PENDING",
  ]);
});

test("consistencia: contador y modal reutilizan agentMetricRows", () => {
  assert.match(
    dashboardJs,
    /const agentMetricRows=.*?\.filter\(metric\.match\)/s,
  );

  assert.match(
    dashboardJs,
    /agentMetricRows\(row,def\)\.length/,
  );

  assert.match(
    dashboardJs,
    /const rows=agentMetricRows\(agent,metric\)/,
  );
});

test("paginación: el modal usa exactamente diez tickets por página", () => {
  assert.match(
    dashboardJs,
    /const AGENT_PAGE_SIZE=10;/,
  );

  assert.match(
    dashboardJs,
    /rows\.slice\(safePage\*AGENT_PAGE_SIZE,\(safePage\+1\)\*AGENT_PAGE_SIZE\)/,
  );

  assert.match(
    dashboardJs,
    /dashAgentPrev.*disabled=safePage===0/s,
  );

  assert.match(
    dashboardJs,
    /dashAgentNext.*disabled=safePage>=pages-1/s,
  );
});

test("degradación: diferencia cero real de dato no disponible", () => {
  assert.match(
    dashboardJs,
    /const known=Array\.isArray\(row\?\.tickets\)/,
  );

  assert.match(
    dashboardJs,
    /known\?count:"—"/,
  );

  assert.match(
    dashboardJs,
    /\$\{known\?"":" disabled"\}/,
  );
});

test("resiliencia: conserva último valor y evita stale responses", () => {
  assert.match(
    dashboardJs,
    /let AGENT_STATE=\{value:null,error:null,stale:false\}/,
  );

  assert.match(
    dashboardJs,
    /const agentSeq=createSequence\(\)/,
  );

  assert.match(
    dashboardJs,
    /keepLastValid/,
  );
});

test("autorización: soporte no puede abrir métricas globales", () => {
  assert.match(
    dashboardJs,
    /function openAgentMetric\([^)]*\)\{\s*if\(!CTX\.isAdmin\)return;/,
  );

  assert.match(
    dashboardJs,
    /document\.body\.dataset\.accessRole=CTX\.isAdmin\?"admin":"soporte"/,
  );
});

test("diálogo: el modal de agentes conserva semántica accesible", () => {
  const modal = dashboardHtml.match(
    /<[^>]+id="dashAgentModal"[^>]*>/,
  )?.[0];

  assert.ok(modal, "No existe #dashAgentModal");
  assert.match(modal, /role="dialog"/);
  assert.match(modal, /aria-modal="true"/);
  assert.match(modal, /aria-labelledby="[^"]+"/);

  assert.match(dashboardHtml, /id="dashAgentClose"/);
  assert.match(dashboardHtml, /id="dashAgentPrev"/);
  assert.match(dashboardHtml, /id="dashAgentNext"/);
});

test("CI: la prueba de agentes queda registrada en frontend-gates", () => {
  assert.match(
    workflow,
    /node tools\/u15a2-agent-summary\.test\.mjs/,
  );
});

console.log(`U15A2_AGENT_SUMMARY_TESTS=PASS (${passed})`);
