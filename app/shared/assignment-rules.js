/* U14-A — evaluador canónico y determinista de reglas de asignación.
   Propietario ÚNICO de la decisión "qué regla gana". Puro: sin DOM, sin red, sin Supabase,
   sin reloj ni aleatoriedad. Consumido por la vista previa del dashboard y por los fixtures
   locales; en U14-B lo reutiliza el motor server-side. NO debe existir un segundo evaluador.
   No describe ni asume el esquema remoto de reglas_asignacion: consume las columnas que la
   UI ya lee hoy (id, nombre, prioridad, tipo_condicion, valor, agente_id, activo). */

export const CONDITION_TYPES = ["tipo_maquina", "tipo_caso", "empresa", "palabra_clave", "cliente_nuevo"];
export const OUTCOME = { ASSIGNED: "assigned", UNASSIGNED: "unassigned", MANUAL_PRESERVED: "manual_preserved" };
export const REASON = {
  MANUAL_ASSIGNMENT_PRESENT: "MANUAL_ASSIGNMENT_PRESENT",
  NO_ACTIVE_RULES: "NO_ACTIVE_RULES",
  NO_RULE_MATCHED: "NO_RULE_MATCHED",
  RULE_MATCHED: "RULE_MATCHED",
  AGENT_UNKNOWN: "AGENT_UNKNOWN",
  AGENT_DISABLED: "AGENT_DISABLED",
};

const norm = value => String(value == null ? "" : value).trim().toLowerCase();
const idKey = value => String(value == null ? "" : value).trim();
const TICKET_FIELD = { tipo_maquina: "tipoMaquina", tipo_caso: "tipoCaso", empresa: "empresa" };
const KEYWORD_FIELDS = ["tipo_maquina", "tipo_caso", "empresa"];

/* Desempate estable por id ascendente: numérico cuando ambos ids son numéricos, lexicográfico
   en el resto. No se asume el tipo del id remoto (puede ser bigint o uuid). */
const cmpId = (a, b) => {
  const x = Number(a), y = Number(b);
  if (Number.isFinite(x) && Number.isFinite(y) && x !== y) return x - y;
  const ka = idKey(a), kb = idKey(b);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
};
const prioOf = rule => { const p = Number(rule.prioridad); return Number.isFinite(p) ? p : Number.MAX_SAFE_INTEGER; };
const cmpRule = (a, b) => (prioOf(a) - prioOf(b)) || cmpId(a.id, b.id);

/* Devuelve la condición coincidente como texto estable, o null. Un valor vacío NUNCA es comodín:
   String.includes("") sería siempre verdadero y volvería la regla no determinista en la práctica. */
const matchCondition = (rule, ticket) => {
  const tipo = rule.tipo_condicion;
  if (tipo === "cliente_nuevo") return ticket.clienteNuevo === true ? "cliente_nuevo == true" : null;
  const valor = norm(rule.valor);
  if (!valor) return null;
  if (tipo === "palabra_clave") {
    const hit = KEYWORD_FIELDS.find(field => norm(ticket[TICKET_FIELD[field]]).includes(valor));
    return hit ? `palabra_clave "${valor}" en ${hit}` : null;
  }
  const field = TICKET_FIELD[tipo];
  if (!field) return null;
  return norm(ticket[field]).includes(valor) ? `${tipo} contiene "${valor}"` : null;
};

/* Reglas candidatas: solo activas, solo condiciones del contrato cerrado, ordenadas por
   prioridad ascendente y desempatadas por id. Copia: nunca muta el arreglo del llamante. */
export const activeRulesInOrder = rules =>
  (Array.isArray(rules) ? rules : []).filter(r => r && r.activo === true && CONDITION_TYPES.includes(r.tipo_condicion)).sort(cmpRule);

export const matchingRules = ({ ticket = {}, rules = [] } = {}) =>
  activeRulesInOrder(rules).map(rule => ({ rule, matchedCondition: matchCondition(rule, ticket) })).filter(m => m.matchedCondition);

const decide = fields => ({ ruleId: null, ruleName: null, priority: null, agentId: null, matchedCondition: null, ...fields });

export function evaluateAssignment({ ticket = {}, rules = [], agents = [] } = {}) {
  const manual = idKey(ticket.asignadoA);
  if (manual) return decide({ agentId: manual, reason: REASON.MANUAL_ASSIGNMENT_PRESENT, outcome: OUTCOME.MANUAL_PRESERVED });
  if (!activeRulesInOrder(rules).length) return decide({ reason: REASON.NO_ACTIVE_RULES, outcome: OUTCOME.UNASSIGNED });
  const winner = matchingRules({ ticket, rules })[0];
  if (!winner) return decide({ reason: REASON.NO_RULE_MATCHED, outcome: OUTCOME.UNASSIGNED });
  const { rule, matchedCondition } = winner;
  const base = { ruleId: rule.id ?? null, ruleName: rule.nombre ?? null, priority: Number.isFinite(Number(rule.prioridad)) ? Number(rule.prioridad) : null, matchedCondition };
  const agentId = idKey(rule.agente_id);
  const agent = (Array.isArray(agents) ? agents : []).find(a => a && idKey(a.id) && idKey(a.id) === agentId);
  /* La primera regla coincidente gana SIEMPRE. Si su destino no es elegible el resultado es
     "sin asignar" nombrando la regla culpable, nunca la siguiente regla: deshabilitar un agente
     no debe reencaminar tickets silenciosamente hacia otro. Fallback declarado = sin asignar. */
  if (!agentId || !agent) return decide({ ...base, reason: REASON.AGENT_UNKNOWN, outcome: OUTCOME.UNASSIGNED });
  if (agent.habilitado === false) return decide({ ...base, reason: REASON.AGENT_DISABLED, outcome: OUTCOME.UNASSIGNED });
  return decide({ ...base, agentId, reason: REASON.RULE_MATCHED, outcome: OUTCOME.ASSIGNED });
}
