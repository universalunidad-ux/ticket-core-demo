begin;

-- Canonical read-only owner for the administrative agent summary.
-- security_invoker keeps the underlying perfiles/tickets RLS in force, while
-- the explicit role predicate makes direct Data API access fail closed for
-- authenticated non-admin actors.
create view public.v_janome_dashboard_agentes
with (security_invoker = true)
as
select
  p.id as agente_id,
  p.nombre,
  p.rol,
  count(t.id)::bigint as total_tickets,
  count(t.id) filter (where t.estado not in ('resuelto', 'cerrado')) as activos,
  count(t.id) filter (where t.estado = 'abierto') as abiertos,
  count(t.id) filter (where t.estado = 'en_proceso') as en_proceso,
  count(t.id) filter (where t.estado = 'esperando_cliente') as esperando_cliente,
  count(t.id) filter (where t.estado in ('resuelto', 'cerrado')) as cerrados_resueltos,
  count(t.id) filter (where t.prioridad in ('alta', 'urgente')) as alta_urgente,
  count(t.id) filter (where t.sla_breached_first_response) as sla_primera_respuesta_vencida,
  count(t.id) filter (where t.sla_breached_resolution) as sla_resolucion_vencida,
  count(t.id) filter (where t.requiere_supervision) as supervision_pendiente
from public.perfiles p
left join public.tickets t on t.asignado_a = p.id
where p.rol = 'soporte'
  and p.activo
  and app_private.has_role(array['admin'])
group by p.id, p.nombre, p.rol;

revoke all on table public.v_janome_dashboard_agentes
  from public, anon, authenticated;
grant select on table public.v_janome_dashboard_agentes
  to authenticated, service_role;

comment on view public.v_janome_dashboard_agentes is
  'Admin-only aggregate for dashboard agent metrics; security_invoker preserves underlying RLS.';

do $agent_dashboard_postconditions$
declare
  view_options text[];
  view_sql text;
begin
  select c.reloptions, pg_get_viewdef(c.oid, true)
  into view_options, view_sql
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'v_janome_dashboard_agentes'
    and c.relkind = 'v';

  if view_options is null or not ('security_invoker=true' = any(view_options)) then
    raise exception 'TC_AGENT_DASHBOARD_VIEW_NOT_SECURITY_INVOKER'
      using errcode = '42501';
  end if;

  if position('app_private.has_role' in coalesce(view_sql, '')) = 0 then
    raise exception 'TC_AGENT_DASHBOARD_ADMIN_GUARD_MISSING'
      using errcode = '42501';
  end if;

  if has_table_privilege('anon', 'public.v_janome_dashboard_agentes', 'select') then
    raise exception 'TC_AGENT_DASHBOARD_ANON_SELECT_EXPOSED'
      using errcode = '42501';
  end if;

  if not has_table_privilege('authenticated', 'public.v_janome_dashboard_agentes', 'select') then
    raise exception 'TC_AGENT_DASHBOARD_AUTHENTICATED_GRANT_MISSING'
      using errcode = '42501';
  end if;
end;
$agent_dashboard_postconditions$;

commit;
