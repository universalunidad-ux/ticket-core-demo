/* TC-U15A-1 — contrato canónico de ALCANCE (scope) de la mesa de Tickets.
   Propietario ÚNICO de la decisión "qué tickets ve el usuario": all | mine | unassigned.
   Puro: sin DOM, sin red, sin Supabase, sin reloj ni aleatoriedad. Consumido por
   tickets.js (consulta REST + UI) y por el selector de vista (tickets-assignment.js).
   NO debe existir un segundo resolutor de scope.
   La seguridad real vive en RLS (tickets_support_select_assigned / tickets_manager_select);
   esto sólo normaliza la intención ANTES de consultar y evita que la URL fuerce un alcance
   no autorizado. No amplía permisos: es una segunda barrera del lado del cliente. */

export const TICKET_SCOPES = ["all", "mine", "unassigned"];
export const DEFAULT_ADMIN_SCOPE = "all";
export const DEFAULT_SUPPORT_SCOPE = "mine";

/* Roles con capacidad de administración de la mesa (pueden usar all/unassigned).
   Alineado con nav-interna.js y ticket.js: admin, owner, administrador. */
const ADMIN_ROLES = ["admin", "owner", "administrador"];

const norm = value => String(value == null ? "" : value).trim().toLowerCase();

export const isAdminRole = rol => ADMIN_ROLES.includes(norm(rol));

/* Normaliza el scope solicitado al efectivo según capacidad del usuario.
   - No admin (soporte incluido): SIEMPRE "mine". No puede forzar all/unassigned,
     ni siquiera manipulando ?scope= en la URL.
   - Admin/owner/administrador: respeta all|mine|unassigned; cualquier otro valor => "all". */
export const resolveTicketScope = (requested, { isAdmin = false } = {}) => {
  if (!isAdmin) return DEFAULT_SUPPORT_SCOPE;
  const r = norm(requested);
  return TICKET_SCOPES.includes(r) ? r : DEFAULT_ADMIN_SCOPE;
};

/* Filtro PostgREST sobre asignado_a para el scope EFECTIVO ya resuelto.
   Devuelve null cuando no se debe filtrar por asignado_a (scope=all).
   Se aplica en la CONSULTA, no después de descargar registros. */
export const scopeAssignedFilter = (scope, userId) => {
  if (scope === "mine") return `eq.${userId}`;
  if (scope === "unassigned") return "is.null";
  return null; // all
};

/* Predicado en memoria equivalente al filtro de consulta. Segunda barrera para
   métricas/pruebas; el filtro real ya se aplicó en la consulta Supabase. */
export const ticketMatchesScope = (ticket, scope, userId) => {
  const assigned = ticket && ticket.asignado_a != null ? ticket.asignado_a : null;
  if (scope === "mine") return String(assigned || "") === String(userId || "");
  if (scope === "unassigned") return assigned == null || assigned === "";
  return true; // all
};

/* Etiqueta visible del scope (texto sincronizado con el selector). */
export const scopeLabel = scope =>
  scope === "unassigned" ? "Sin asignar" : scope === "mine" ? "Mis tickets" : "Todos";
