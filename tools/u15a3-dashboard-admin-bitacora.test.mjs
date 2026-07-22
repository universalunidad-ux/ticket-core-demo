import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const read = file => fs.readFileSync(
  path.join(root, file),
  "utf8",
);

const dashboardHtml = read("app/dashboard.html");
const dashboardCss = read("app/dashboard.css");
const dashboardJs = read("app/dashboard.js");
const bitacoraJs = read("app/bitacora-admin.js");
const ticketsJs = read("app/tickets.js");
const workflow = read(".github/workflows/frontend-gates.yml");

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

test("KPI rail permanece en una sola fila con overflow propio", () => {
  assert.match(
    dashboardCss,
    /\.kpi-rail\{[^}]*display:flex;[^}]*overflow-x:auto;/,
  );

  assert.match(
    dashboardCss,
    /\.kpi-rail>\.kpi\{[^}]*flex:0 0/,
  );

  assert.match(dashboardHtml, /id="kpiRailPrev"/);
  assert.match(dashboardHtml, /id="kpiRailNext"/);
});

test("Actividad reciente conserva exactamente siete elementos", () => {
  assert.match(dashboardJs, /const ACT_PAGE_SIZE = 7;/);

  assert.match(
    dashboardJs,
    /\.range\(ACT_PAGE \* ACT_PAGE_SIZE,\s*ACT_PAGE \* ACT_PAGE_SIZE \+ ACT_PAGE_SIZE\)/,
  );

  assert.match(
    dashboardJs,
    /\.slice\(0,\s*ACT_PAGE_SIZE\)/,
  );
});

test("tabs administrativas preservan scroll e historial", () => {
  assert.match(
    dashboardJs,
    /history\.replaceState\(null,\s*"",\s*admHash\(tab\)\)/,
  );

  assert.match(
    dashboardJs,
    /\.focus\(\{\s*preventScroll:\s*true\s*\}\)/,
  );

  assert.doesNotMatch(
    dashboardJs,
    /^\s*location\.hash\s*=/m,
  );
});

test("KPI administrativos usan enlaces y origen explícitos", () => {
  const required = [
    "from=dashboard&scope=all&state=abierto",
    "from=dashboard&scope=all&state=en_proceso",
    "from=dashboard&scope=all&state=esperando_cliente",
    "from=dashboard&scope=all&state=resuelto",
    "from=dashboard&scope=unassigned",
    "from=dashboard&scope=all&kpi=urgent",
    "from=dashboard&scope=all&kpi=first_response_overdue",
    "from=dashboard&scope=all&kpi=sla_overdue",
  ];

  for (const contract of required) {
    assert.ok(
      dashboardJs.includes(contract),
      `Falta enlace KPI: ${contract}`,
    );
  }
});

test("KPI de soporte conservan scope mine", () => {
  const required = [
    "from=dashboard&scope=mine&state=abierto",
    "from=dashboard&scope=mine&kpi=waiting",
    "from=dashboard&scope=mine&kpi=urgent",
    "from=dashboard&scope=mine&kpi=resolved",
  ];

  for (const contract of required) {
    assert.ok(
      dashboardJs.includes(contract),
      `Falta scope mine: ${contract}`,
    );
  }
});

test("bandeja del Dashboard declara origen explícito", () => {
  assert.match(
    dashboardHtml,
    /href="tickets\.html\?from=dashboard" id="dashHeroBandeja"/,
  );

  assert.match(
    dashboardHtml,
    /href="tickets\.html\?from=dashboard&amp;scope=mine">Ir a mi bandeja/,
  );
});

test("Tickets presenta contexto por scope sin ampliar permisos", () => {
  assert.match(
    ticketsJs,
    /const scope=url\.searchParams\.get\("scope"\)/,
  );

  assert.match(
    ticketsJs,
    /scope==="mine"/,
  );

  assert.match(
    ticketsJs,
    /scope==="unassigned"/,
  );

  assert.match(
    ticketsJs,
    /document\.body\.dataset\.fromDashboard=fromDashboard\?"1":"0"/,
  );
});

test("nomenclatura SLA queda completa y coherente", () => {
  assert.ok(
    dashboardJs.includes("SLA 1ª respuesta<br>vencida"),
  );

  assert.ok(
    dashboardJs.includes("SLA resolución<br>vencida"),
  );

  assert.ok(
    ticketsJs.includes(
      'first_response_overdue:"SLA 1ª respuesta vencida"',
    ),
  );

  assert.ok(
    ticketsJs.includes(
      'sla_overdue:"SLA resolución vencida"',
    ),
  );
});

test("Bitácora independiente queda fijada en diez por página", () => {
  assert.match(
    bitacoraJs,
    /createLogView\(document\.querySelector\("#bitacoraView"\),\{pageSize:10\}\)/,
  );

  assert.doesNotMatch(bitacoraJs, /pageSize:25/);

  assert.match(
    dashboardJs,
    /size=10;const sizeField=/,
  );

  assert.match(
    dashboardJs,
    /\.range\(page \* size,\s*\(page \+ 1\) \* size - 1\)/,
  );
});

test("la prueba U15A-3 queda registrada en CI", () => {
  assert.match(
    workflow,
    /node tools\/u15a3-dashboard-admin-bitacora\.test\.mjs/,
  );
});

console.log(
  `U15A3_DASHBOARD_ADMIN_BITACORA_TESTS=PASS (${passed})`,
);
