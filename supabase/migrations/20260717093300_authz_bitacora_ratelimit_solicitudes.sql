-- AUTHZ U4 · bitácora/rate_limit/solicitudes/eventos/archivos/site_config.
-- PREPARED_NOT_APPLIED. Aditiva/idempotente.

-- Bitácora: solo admin lee. Escritura server-side (service_role bypassa RLS).
alter table public.bitacora enable row level security;
drop policy if exists bitacora_select_admin on public.bitacora;
create policy bitacora_select_admin
  on public.bitacora for select to authenticated
  using (public.tc_is_admin());

-- Rate limit: sin policies para anon/authenticated => denegado por completo.
-- Solo el Edge (service_role) lo lee/escribe.
alter table public.rate_limit_events enable row level security;

-- Solicitudes de soporte: manager ve todo; soporte via ticket asignado. Nada anon.
alter table public.solicitudes_soporte enable row level security;
drop policy if exists solicitudes_manager_select on public.solicitudes_soporte;
create policy solicitudes_manager_select
  on public.solicitudes_soporte for select to authenticated
  using (public.tc_is_manager());
drop policy if exists solicitudes_support_select_assigned on public.solicitudes_soporte;
create policy solicitudes_support_select_assigned
  on public.solicitudes_soporte for select to authenticated
  using (
    public.tc_current_role() = 'soporte'
    and exists (
      select 1 from public.tickets t
      where t.solicitud_soporte_id = solicitudes_soporte.id
        and t.asignado_a = (select auth.uid())
    )
  );

-- Eventos de ticket: staff interno con acceso al ticket. Timeline pública se sirve
-- por Edge con token (no por Data API anónimo).
alter table public.ticket_eventos enable row level security;
drop policy if exists ticket_eventos_staff_select on public.ticket_eventos;
create policy ticket_eventos_staff_select
  on public.ticket_eventos for select to authenticated
  using (
    exists (
      select 1 from public.tickets t
      where t.id = ticket_eventos.ticket_id
        and (public.tc_is_manager() or t.asignado_a = (select auth.uid()))
    )
  );

-- Archivos de ticket: mismo alcance que el ticket. Nada anon.
alter table public.archivos_ticket enable row level security;
drop policy if exists archivos_ticket_staff_select on public.archivos_ticket;
create policy archivos_ticket_staff_select
  on public.archivos_ticket for select to authenticated
  using (
    exists (
      select 1 from public.tickets t
      where t.id = archivos_ticket.ticket_id
        and (public.tc_is_manager() or t.asignado_a = (select auth.uid()))
    )
  );

-- site_config: lectura para autenticados (config-loader); escritura solo admin.
alter table public.site_config enable row level security;
drop policy if exists site_config_read on public.site_config;
create policy site_config_read
  on public.site_config for select to authenticated
  using (true);
drop policy if exists site_config_admin_write on public.site_config;
create policy site_config_admin_write
  on public.site_config for all to authenticated
  using (public.tc_is_admin())
  with check (public.tc_is_admin());
