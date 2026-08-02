import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const js = read("app/dashboard.js");
const html = read("app/dashboard.html");

test("agent summary loads from the bounded canonical SQL owner", () => {
  const load = js.slice(js.indexOf("async function loadAgentSummary()"), js.indexOf("/* ---------- cache breve"));
  assert.match(load, /if\(!CTX\.isAdmin\)return/);
  assert.match(load, /from\("v_janome_dashboard_agentes"\)\.select\("agente_id,nombre,rol"\)\.order\("nombre",\{ascending:true\}\)\.limit\(200\)/);
  assert.doesNotMatch(load, /from\("perfiles"\)/);
  assert.match(load, /\.range\(from,from\+499\)/);
});

test("loading empty error retry and last-known-good remain explicit", () => {
  assert.match(js, /box\.innerHTML='<div class="dash-skel"><\/div><div class="dash-skel"><\/div>'/);
  assert.match(js, /Sin agentes en el resumen\./);
  assert.match(js, /data-agent-retry>Reintentar/);
  assert.match(js, /Mostrando el último resumen válido/);
  assert.match(js, /keepLastValid\(AGENT_STATE/);
  assert.match(js, /addEventListener\("click",loadAgentSummary,\{once:true\}\)/);
});

test("modal, focus restoration, audit navigation and sensitive-data boundary remain", () => {
  assert.match(html, /id="dashAgentModal" role="dialog" aria-modal="true" aria-labelledby="dashAgentTitle"/);
  assert.match(js, /openDialog\("#dashAgentModal",\{trigger,initialFocus:"#dashAgentClose",fallbackFocus:trigger/);
  assert.match(js, /data-admin-audit-link href="bitacora-admin\.html"/);
  assert.doesNotMatch(js, /service_role|authorization\s*:\s*["'`]|bearer\s+/i);
});
