import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
const src=readFileSync(new URL("../../app/tickets-assignment.js",import.meta.url),"utf8");

test("ticket libre abre con clic normal",()=>assert.match(src,/!current\?\.asignado_a[\s\S]*openAssign\(id, badge\)/));
test("ticket asignado muestra ayuda antes de reasignar",()=>assert.match(src,/Doble clic para reasignar/));
test("doble clic abre reasignación",()=>assert.match(src,/addEventListener\("dblclick"[\s\S]*openExplicitly/));
test("teclado Enter y espacio abren explícitamente",()=>{assert.match(src,/e\.key === "Enter"/);assert.match(src,/e\.key === " "/)});
test("touch tiene alternativa explícita",()=>assert.match(src,/pointer:coarse/));
test("busy deduplica la petición",()=>assert.match(src,/if\(BUSY\) return/));
test("UI optimista conserva snapshot y revierte en error",()=>{assert.match(src,/const previous =/);assert.match(src,/t\.asignado_a = previous\.asignado_a/);assert.match(src,/t\.asignado_en = previous\.asignado_en/)});
test("toast final incluye ticket y agente",()=>assert.match(src,/Ticket «\$\{t\.titulo[\s\S]*asignado a \$\{assignedLabel\(next\)\}/));
test("timers y observer tienen cleanup",()=>{assert.match(src,/pagehide/);assert.match(src,/OBS\?\.disconnect/);assert.match(src,/ASSIGN_HINT_TIMERS\.clear/)});
test("fallo no usa alert bloqueante",()=>assert.doesNotMatch(src,/\balert\(/));
