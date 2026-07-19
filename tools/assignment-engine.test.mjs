#!/usr/bin/env node
/* U14-A — pruebas unitarias del evaluador canónico. Cubre T-A04 T-A05 T-A06 T-A07 (matriz 05)
   y los negativos locales de A16 A18 A23. Cero red, cero SQL, cero Supabase. */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateAssignment, matchingRules, OUTCOME, REASON, CONDITION_TYPES } from "../app/shared/assignment-rules.js";
import { AGENTS, RULES, TIE_RULES, DISABLED_AGENT_RULES, UNKNOWN_AGENT_RULES, TICKETS } from "./assignment-engine.fixtures.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = path => readFileSync(join(root, path), "utf8");
let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log(`PASS ${name}`) } catch (error) { console.error(`FAIL ${name}: ${error.message}`); process.exitCode = 1 } };
const evaluate = (ticket, rules = RULES, agents = AGENTS) => evaluateAssignment({ ticket, rules, agents });
/* Barajado con LCG semilla fija: reproducible entre ejecuciones, a diferencia de Math.random. */
const shuffle = (list, seed) => { const out = [...list]; let s = seed; for (let i = out.length - 1; i > 0; i--) { s = (s * 1103515245 + 12345) % 2147483648; const j = s % (i + 1);[out[i], out[j]] = [out[j], out[i]] } return out };

test("T-A04 determinismo: 100 ejecuciones con entrada barajada dan el mismo resultado", () => {
  const baseline = JSON.stringify(evaluate(TICKETS.overlock));
  for (let i = 0; i < 100; i++) assert.equal(JSON.stringify(evaluateAssignment({ ticket: TICKETS.overlock, rules: shuffle(RULES, i + 1), agents: shuffle(AGENTS, i + 7) })), baseline, `divergencia en la iteración ${i}`);
  assert.equal(JSON.parse(baseline).ruleId, 10, "debe ganar la prioridad menor (10), no el orden de declaración");
});
test("T-A04 el evaluador no muta los arreglos del llamante", () => {
  const rules = [...RULES], agents = [...AGENTS], snapshot = JSON.stringify({ rules, agents });
  evaluateAssignment({ ticket: TICKETS.overlock, rules, agents });
  assert.equal(JSON.stringify({ rules, agents }), snapshot, "entrada mutada");
});
test("T-A05 empate de prioridad se desempata por id ascendente", () => {
  const forward = evaluate(TICKETS.recta, TIE_RULES);
  const reversed = evaluate(TICKETS.recta, [...TIE_RULES].reverse());
  assert.equal(forward.ruleId, 11); assert.equal(forward.agentId, "1");
  assert.deepEqual(reversed, forward, "el orden de entrada no puede alterar la ganadora");
});
test("T-A06 fallback explícito sin asignar cuando ninguna regla coincide", () => {
  const decision = evaluate(TICKETS.sinCoincidencia);
  assert.equal(decision.outcome, OUTCOME.UNASSIGNED); assert.equal(decision.reason, REASON.NO_RULE_MATCHED);
  assert.equal(decision.agentId, null); assert.equal(decision.ruleId, null);
});
test("T-A06 sin reglas activas el resultado es sin asignar y distinguible", () => {
  const decision = evaluate(TICKETS.overlock, RULES.map(r => ({ ...r, activo: false })));
  assert.equal(decision.outcome, OUTCOME.UNASSIGNED); assert.equal(decision.reason, REASON.NO_ACTIVE_RULES);
});
test("T-A07 toda decisión devuelve la explicación estructurada completa", () => {
  const claves = ["ruleId", "ruleName", "priority", "agentId", "matchedCondition", "reason", "outcome"];
  const casos = [evaluate(TICKETS.overlock), evaluate(TICKETS.sinCoincidencia), evaluate(TICKETS.yaAsignado), evaluate(TICKETS.collaretera, DISABLED_AGENT_RULES), evaluate(TICKETS.fantasma, UNKNOWN_AGENT_RULES)];
  for (const decision of casos) {
    assert.deepEqual(Object.keys(decision).sort(), [...claves].sort(), "faltan o sobran campos");
    assert.ok(Object.values(OUTCOME).includes(decision.outcome), `outcome no declarado: ${decision.outcome}`);
    assert.ok(Object.values(REASON).includes(decision.reason), `reason no declarado: ${decision.reason}`);
  }
  const ganadora = evaluate(TICKETS.overlock);
  assert.deepEqual(ganadora, { ruleId: 10, ruleName: "Overlock a Alfa", priority: 10, agentId: "1", matchedCondition: 'tipo_maquina contiene "overlock"', reason: REASON.RULE_MATCHED, outcome: OUTCOME.ASSIGNED });
});
test("A18 agente deshabilitado se rechaza y NO cae en la siguiente regla", () => {
  const decision = evaluate(TICKETS.collaretera, DISABLED_AGENT_RULES);
  assert.equal(decision.outcome, OUTCOME.UNASSIGNED); assert.equal(decision.reason, REASON.AGENT_DISABLED);
  assert.equal(decision.agentId, null, "nunca se expone el agente deshabilitado como destino");
  assert.equal(decision.ruleId, 5, "la regla culpable debe quedar nombrada");
});
test("A18 agente inexistente en el padrón se rechaza", () => {
  const decision = evaluate(TICKETS.fantasma, UNKNOWN_AGENT_RULES);
  assert.equal(decision.outcome, OUTCOME.UNASSIGNED); assert.equal(decision.reason, REASON.AGENT_UNKNOWN); assert.equal(decision.agentId, null);
});
test("A09 no se sobrescribe una asignación manual existente", () => {
  const decision = evaluate(TICKETS.yaAsignado);
  assert.equal(decision.outcome, OUTCOME.MANUAL_PRESERVED); assert.equal(decision.reason, REASON.MANUAL_ASSIGNMENT_PRESENT);
  assert.equal(decision.agentId, "u-4"); assert.equal(decision.ruleId, null, "una asignación manual no se atribuye a ninguna regla");
});
test("A03 condiciones fuera del contrato y valores vacíos nunca coinciden", () => {
  const matches = matchingRules({ ticket: TICKETS.overlock, rules: RULES }).map(m => m.rule.id);
  assert.ok(!matches.includes(80), "tipo_condicion fuera de CONDITION_TYPES debe descartarse");
  assert.ok(!matches.includes(90), "un valor vacío no puede comportarse como comodín");
  assert.ok(!matches.includes(40), "una regla inactiva nunca es candidata");
  assert.deepEqual(matches, [10, 50], "candidatas en orden de prioridad ascendente");
});
test("A03 cliente_nuevo solo coincide con el dato booleano explícito", () => {
  assert.equal(evaluate(TICKETS.sinCoincidencia).reason, REASON.NO_RULE_MATCHED, "sin el dato no se infiere cliente nuevo");
  const decision = evaluate(TICKETS.clienteNuevo);
  assert.equal(decision.ruleId, 70); assert.equal(decision.matchedCondition, "cliente_nuevo == true");
});
test("T-A01 el contrato COND del dashboard coincide con CONDITION_TYPES del evaluador", () => {
  const dash = read("app/dashboard.js");
  const bloque = dash.slice(dash.indexOf("const COND = ["), dash.indexOf("];", dash.indexOf("const COND = [")));
  const enUi = [...bloque.matchAll(/\["([a-z_]+)",/g)].map(m => m[1]);
  assert.deepEqual([...enUi].sort(), [...CONDITION_TYPES].sort(), "UI y evaluador divergen en el contrato de condiciones");
});
/* Discriminador de un evaluador paralelo: comparar tipo_condicion contra un NOMBRE LITERAL de
   condición equivale a decidir localmente si un ticket coincide. Comparar tipo_condicion contra
   una variable es otra responsabilidad (reglas sombreadas y duplicados, A05) y sigue permitida. */
test("evaluador canónico único: ninguna otra lógica de coincidencia fuera del módulo compartido", () => {
  const dash = read("app/dashboard.js");
  assert.ok(dash.includes('from "./shared/assignment-rules.js'), "dashboard debe delegar en el evaluador canónico");
  assert.equal((dash.match(/function rgSimula/g) || []).length, 1, "un solo rgSimula");
  const duplicados = readdirSync(join(root, "app")).filter(f => f.endsWith(".js")).filter(f => /tipo_condicion\s*===\s*["'`]/.test(read(join("app", f))));
  assert.deepEqual(duplicados, [], `evaluadores paralelos detectados: ${duplicados.join(", ")}`);
});
test("T-A02 la unidad no altera el estado declarado del motor", () => {
  assert.ok(read("app/dashboard.js").includes('data-engine-status="CONFIG_ONLY"'), "el motor sigue siendo CONFIG_ONLY hasta que exista ejecución server-side");
});

console.log(`ASSIGNMENT_ENGINE_TESTS: ${process.exitCode ? "FAIL" : "PASS"} (${passed} pruebas)`);
