import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
const read=p=>readFileSync(new URL(`../../${p}`,import.meta.url),"utf8");
const tickets=read("app/tickets.js"),ticket=read("app/ticket.js"),core=read("app/cliente.core.js"),ui=read("app/cliente.ui.js");

test("KPI espera usa el mismo helper canónico probado",()=>assert.match(tickets,/setTxt\("mWait",waitingTicketRows\(/));
test("filtro espera selecciona sólo esperando_cliente",()=>assert.match(tickets,/FILTER\.state!=="esperando_cliente"/));
test("métricas respetan filtros combinados",()=>assert.match(tickets,/const tkMetricRows=\(\)=>tkHasActiveFilter\(\)\?filtered\(\):TK/));
test("timeout recuperable mantiene loading y muestra estado intermedio",()=>{assert.match(tickets,/fetchTicketsWithRecovery/);assert.match(tickets,/Seguimos recuperando sus tickets/);assert.match(tickets,/TICKETS_REST_FINAL_ERROR/)});
test("respuestas rápidas del ticket usan usted",()=>{assert.match(ticket,/por favor comparta/);assert.doesNotMatch(ticket,/compártenos|comparte comprobante/)});
test("respuestas del tablero usan usted",()=>{assert.match(tickets,/por favor comparta el modelo exacto/);assert.match(tickets,/Por favor envíe una foto clara/)});
test("actividad de tickets se carga junto a los tickets",()=>{assert.match(core,/eventsByTicket/);assert.match(core,/detalle,fecha,usuario_id/)});
test("nota interna tiene etiqueta distinta",()=>assert.match(ui,/ticket_nota:"Nota interna"/));
test("eventos se agrupan dentro de la tarjeta del ticket",()=>assert.match(ui,/cf-ticket-events/));
test("bitácora global excluye eventos propios de ticket",()=>{assert.match(ui,/rows\.filter\(row => !isTicketEvent\(row\)\)/);assert.match(ui,/actividad propia de tickets aparece agrupada/)});
