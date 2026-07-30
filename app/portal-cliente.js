import { esc, guardSession, logout, supabase } from "./supabase.js";

const identity = document.querySelector("#clientIdentity");
const status = document.querySelector("#clientStatus");
const list = document.querySelector("#clientTickets");
const logoutButton = document.querySelector("#clientLogout");

logoutButton?.addEventListener("click", () => logout("index.html"));

function deny(message) {
  document.body.dataset.authzState = "denied";
  identity.textContent = "Acceso no autorizado";
  status.innerHTML = `<div class="client-denied" role="alert">${esc(message)}</div>`;
  list.replaceChildren();
}

function ticketCard(ticket, events = []) {
  const article = document.createElement("article");
  article.className = "client-ticket";
  article.dataset.clientTicket = ticket.id;

  const title = document.createElement("h2");
  title.textContent = `${ticket.folio || "Sin folio"} · ${ticket.titulo || "Ticket"}`;
  const meta = document.createElement("p");
  meta.className = "client-ticket-meta";
  meta.textContent = `${ticket.estado || "abierto"} · ${ticket.prioridad || "media"}`;
  const description = document.createElement("p");
  description.textContent = ticket.descripcion || "Sin descripción.";

  const timeline = document.createElement("section");
  timeline.className = "client-ticket-events";
  timeline.setAttribute("aria-label", "Respuestas públicas");
  if (events.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "Sin respuestas públicas todavía.";
    timeline.append(empty);
  } else {
    for (const event of events) {
      const row = document.createElement("p");
      row.className = "client-ticket-event";
      const stamp = event.created_at
        ? new Date(event.created_at).toLocaleString("es-MX")
        : "Sin fecha";
      row.textContent = `${stamp} · ${event.texto || "Actualización sin texto."}`;
      timeline.append(row);
    }
  }

  article.append(title, meta, description, timeline);
  return article;
}

async function loadPortal() {
  const auth = await guardSession("index.html?next=portal-cliente.html");
  if (!auth) return;

  const { data: contact, error: contactError } = await supabase
    .from("clientes_contactos")
    .select("id,cliente_id,nombre,activo")
    .eq("auth_user_id", auth.user.id)
    .eq("activo", true)
    .maybeSingle();

  if (contactError || !contact) {
    deny("Tu identidad no tiene un contacto M1 activo. Solicita revisión a soporte.");
    return;
  }

  // Deliberadamente no se envía cliente_id. RLS resuelve ownership mediante
  // auth.uid() -> contacto activo -> cliente activo.
  const { data: tickets, error: ticketError } = await supabase
    .from("tickets")
    .select("id,folio,titulo,descripcion,estado,prioridad,fecha_actualizacion")
    .order("fecha_actualizacion", { ascending: false });

  if (ticketError) {
    deny("No fue posible consultar tus tickets autorizados.");
    return;
  }

  const ticketIds = tickets.map(ticket => ticket.id);
  let events = [];
  if (ticketIds.length > 0) {
    const { data: publicEvents, error: eventError } = await supabase
      .from("ticket_eventos")
      .select("id,ticket_id,kind,texto,created_at")
      .in("ticket_id", ticketIds)
      .eq("visibilidad", "publica")
      .order("created_at", { ascending: true });
    if (eventError) {
      deny("No fue posible consultar las respuestas públicas autorizadas.");
      return;
    }
    events = publicEvents || [];
  }
  const eventsByTicket = new Map();
  for (const event of events) {
    const rows = eventsByTicket.get(event.ticket_id) || [];
    rows.push(event);
    eventsByTicket.set(event.ticket_id, rows);
  }

  identity.textContent = `Sesión de ${contact.nombre}`;
  status.textContent = tickets.length
    ? `${tickets.length} ticket${tickets.length === 1 ? "" : "s"} disponible${tickets.length === 1 ? "" : "s"}.`
    : "No hay tickets disponibles.";
  list.replaceChildren(
    ...tickets.map(ticket => ticketCard(ticket, eventsByTicket.get(ticket.id) || [])),
  );
  document.body.dataset.authzState = "authorized";
}

loadPortal().catch(() => deny("No fue posible validar tu acceso."));
