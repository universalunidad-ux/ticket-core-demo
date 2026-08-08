-- Ticket Core staging baseline 0007.
-- Preconditions: tickets and client tables exist.
-- Rollback: FULLY_REVERSIBLE (private diagnostic view only).
begin;

create view app_private.pending_ticket_consolidation
with (security_invoker = true)
as
select
  t.id as ticket_id,
  t.folio,
  t.cliente_id,
  t.contacto_id,
  t.cliente_id_sugerido,
  t.contacto_id_sugerido,
  t.match_nivel,
  t.match_score,
  t.fecha_creacion
from public.tickets t
where t.requiere_consolidacion = true;

revoke all on app_private.pending_ticket_consolidation from public, anon, authenticated;
grant select on app_private.pending_ticket_consolidation to service_role;

comment on view app_private.pending_ticket_consolidation is
  'Metadata-only queue; consolidation is performed later by a transactional RPC with idempotency.';

commit;
