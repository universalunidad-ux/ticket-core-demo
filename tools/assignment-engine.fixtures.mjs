/* U14-A — fixtures deterministas del evaluador de asignación.
   Datos sintéticos: ningún nombre, empresa ni id proviene de datos reales.
   Orden de declaración DESORDENADO a propósito: el evaluador debe ordenar, no el fixture. */

export const AGENTS = [
  { id: 1, nombre: "Agente Alfa" },
  { id: 2, nombre: "Agente Beta" },
  { id: 3, nombre: "Agente Gamma", habilitado: false },
  { id: "u-4", nombre: "Agente Delta", habilitado: true },
];

export const RULES = [
  { id: 50, nombre: "Empresa demo", prioridad: 30, tipo_condicion: "empresa", valor: "Textiles Demo", agente_id: 2, activo: true },
  { id: 10, nombre: "Overlock a Alfa", prioridad: 10, tipo_condicion: "tipo_maquina", valor: "Overlock", agente_id: 1, activo: true },
  { id: 40, nombre: "Regla inactiva", prioridad: 1, tipo_condicion: "tipo_maquina", valor: "overlock", agente_id: 2, activo: false },
  { id: 20, nombre: "Garantia a Delta", prioridad: 20, tipo_condicion: "tipo_caso", valor: "garantia", agente_id: "u-4", activo: true },
  { id: 60, nombre: "Palabra clave urgente", prioridad: 40, tipo_condicion: "palabra_clave", valor: "urgente", agente_id: 1, activo: true },
  { id: 70, nombre: "Cliente nuevo a Beta", prioridad: 50, tipo_condicion: "cliente_nuevo", valor: null, agente_id: 2, activo: true },
  { id: 80, nombre: "Condicion fuera del contrato", prioridad: 2, tipo_condicion: "carga_de_trabajo", valor: "x", agente_id: 1, activo: true },
  { id: 90, nombre: "Valor vacio no es comodin", prioridad: 3, tipo_condicion: "empresa", valor: "   ", agente_id: 1, activo: true },
];

/* Empate de prioridad 15: el ganador debe ser el id menor (11), no el orden de declaración. */
export const TIE_RULES = [
  { id: 12, nombre: "Empate id mayor", prioridad: 15, tipo_condicion: "tipo_maquina", valor: "recta", agente_id: 2, activo: true },
  { id: 11, nombre: "Empate id menor", prioridad: 15, tipo_condicion: "tipo_maquina", valor: "recta", agente_id: 1, activo: true },
];

export const DISABLED_AGENT_RULES = [
  { id: 5, nombre: "Apunta a agente deshabilitado", prioridad: 5, tipo_condicion: "tipo_maquina", valor: "collaretera", agente_id: 3, activo: true },
  { id: 6, nombre: "Respaldo que NO debe ganar", prioridad: 6, tipo_condicion: "tipo_maquina", valor: "collaretera", agente_id: 1, activo: true },
];

export const UNKNOWN_AGENT_RULES = [
  { id: 7, nombre: "Apunta a agente inexistente", prioridad: 5, tipo_condicion: "empresa", valor: "fantasma", agente_id: 999, activo: true },
];

export const TICKETS = {
  overlock: { tipoMaquina: "Máquina Overlock industrial", tipoCaso: "Mantenimiento", empresa: "Textiles Demo" },
  /* Sin acentos a propósito: la comparación es case-insensitive pero NO normaliza diacríticos,
     igual que la vista previa vigente. Cambiar eso alteraría reglas ya configuradas. */
  garantia: { tipoMaquina: "Recta", tipoCaso: "Garantia y reclamo", empresa: "Otra Demo" },
  sinCoincidencia: { tipoMaquina: "Bordadora", tipoCaso: "Consulta", empresa: "Sin Regla SA" },
  clienteNuevo: { tipoMaquina: "Bordadora", tipoCaso: "Consulta", empresa: "Sin Regla SA", clienteNuevo: true },
  yaAsignado: { tipoMaquina: "Máquina Overlock industrial", tipoCaso: "Mantenimiento", empresa: "Textiles Demo", asignadoA: "u-4" },
  recta: { tipoMaquina: "Recta industrial", tipoCaso: "Consulta", empresa: "Demo" },
  collaretera: { tipoMaquina: "Collaretera", tipoCaso: "Consulta", empresa: "Demo" },
  fantasma: { tipoMaquina: "Recta", tipoCaso: "Consulta", empresa: "Fantasma SA" },
};
