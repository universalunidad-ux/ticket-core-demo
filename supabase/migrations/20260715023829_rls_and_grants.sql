-- Ticket Core staging baseline 0011.
-- Preconditions: functions/triggers migration applied.
-- Rollback: COMPENSATING_MIGRATION_REQUIRED; never disable RLS as rollback.
begin;

do $enable_rls$
declare
  table_name text;
begin
  foreach table_name in array array[
    'archivos_ticket','avisos_globales','bitacora','cliente_accesos','cliente_aliases',
    'cliente_sistemas','clientes','clientes_contactos','clientes_contacto_historial',
    'edge_idempotency','perfiles','rate_limit_events','reglas_asignacion','solicitud_archivos',
    'solicitudes_alta','solicitudes_registro','solicitudes_soporte','ticket_eventos',
    'ticket_folios','ticket_match_decisiones','ticket_portal_logs','ticket_respuestas_rapidas',
    'tickets','site_config'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from public, anon, authenticated', table_name);
    execute format('grant all on table public.%I to service_role', table_name);
  end loop;
end;
$enable_rls$;

revoke all on sequence public.rate_limit_events_id_seq from public, anon, authenticated;
grant usage, select on sequence public.rate_limit_events_id_seq to service_role;

grant select on table public.site_config, public.avisos_globales to anon;

grant select on table
  public.archivos_ticket, public.avisos_globales, public.bitacora,
  public.cliente_accesos, public.cliente_aliases, public.cliente_sistemas,
  public.clientes, public.clientes_contactos, public.clientes_contacto_historial,
  public.perfiles, public.reglas_asignacion, public.solicitud_archivos,
  public.solicitudes_alta, public.solicitudes_registro, public.solicitudes_soporte,
  public.ticket_eventos, public.ticket_folios, public.ticket_match_decisiones,
  public.ticket_portal_logs, public.ticket_respuestas_rapidas, public.tickets,
  public.site_config, public.rate_limit_events, public.edge_idempotency
to authenticated;

grant update (nombre, tema, preferencias) on public.perfiles to authenticated;

do $admin_policies$
declare
  table_name text;
begin
  foreach table_name in array array[
    'archivos_ticket','avisos_globales','cliente_accesos','cliente_aliases','cliente_sistemas',
    'clientes','clientes_contactos','clientes_contacto_historial','reglas_asignacion',
    'solicitud_archivos','solicitudes_alta','solicitudes_registro','solicitudes_soporte',
    'ticket_eventos','ticket_match_decisiones','ticket_respuestas_rapidas','tickets','site_config'
  ] loop
    execute format(
      'create policy admin_select on public.%I for select to authenticated using (app_private.has_role(array[''admin'']))',
      table_name
    );
  end loop;
end;
$admin_policies$;

create policy profiles_admin_select on public.perfiles
for select to authenticated
using (app_private.has_role(array['admin']));

create policy profiles_admin_safe_update on public.perfiles
for update to authenticated
using (app_private.has_role(array['admin']))
with check (app_private.has_role(array['admin']));

create policy profiles_team_select on public.perfiles
for select to authenticated
using (id = (select auth.uid()) or app_private.has_role(array['admin','soporte']));

create policy profiles_self_update on public.perfiles
for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create policy tickets_support_select on public.tickets
for select to authenticated
using (app_private.has_role(array['soporte']) and asignado_a = (select auth.uid()));

create policy clientes_support_scope on public.clientes
for select to authenticated
using (app_private.has_role(array['soporte']) and exists (
  select 1 from public.tickets t where t.cliente_id = clientes.id and t.asignado_a = (select auth.uid())
));

create policy contactos_support_scope on public.clientes_contactos
for select to authenticated
using (app_private.has_role(array['soporte']) and exists (
  select 1 from public.tickets t where t.cliente_id = clientes_contactos.cliente_id and t.asignado_a = (select auth.uid())
));

create policy contacto_historial_support_scope on public.clientes_contacto_historial
for select to authenticated
using (app_private.has_role(array['soporte']) and exists (
  select 1 from public.tickets t where t.cliente_id = clientes_contacto_historial.cliente_id and t.asignado_a = (select auth.uid())
));

create policy aliases_support_scope on public.cliente_aliases
for select to authenticated
using (app_private.has_role(array['soporte']) and exists (
  select 1 from public.tickets t where t.cliente_id = cliente_aliases.cliente_id and t.asignado_a = (select auth.uid())
));

create policy sistemas_support_scope on public.cliente_sistemas
for select to authenticated
using (app_private.has_role(array['soporte']) and exists (
  select 1 from public.tickets t where t.cliente_id = cliente_sistemas.cliente_id and t.asignado_a = (select auth.uid())
));

create policy accesos_support_scope on public.cliente_accesos
for select to authenticated
using (
  activo and (expira_en is null or expira_en > now())
  and app_private.has_role(array['soporte'])
  and exists (
    select 1 from public.tickets t where t.cliente_id = cliente_accesos.cliente_id and t.asignado_a = (select auth.uid())
  )
);

create policy solicitudes_support_scope on public.solicitudes_soporte
for select to authenticated
using (app_private.has_role(array['soporte']) and exists (
  select 1 from public.tickets t where t.id = solicitudes_soporte.ticket_id and t.asignado_a = (select auth.uid())
));

create policy solicitud_archivos_support_scope on public.solicitud_archivos
for select to authenticated
using (app_private.has_role(array['soporte']) and exists (
  select 1
  from public.solicitudes_soporte s
  join public.tickets t on t.id = s.ticket_id
  where s.id = solicitud_archivos.solicitud_id and t.asignado_a = (select auth.uid())
));

create policy eventos_support_scope on public.ticket_eventos
for select to authenticated
using (app_private.has_role(array['soporte']) and exists (
  select 1 from public.tickets t where t.id = ticket_eventos.ticket_id and t.asignado_a = (select auth.uid())
));

create policy archivos_support_scope on public.archivos_ticket
for select to authenticated
using (app_private.has_role(array['soporte']) and exists (
  select 1 from public.tickets t where t.id = archivos_ticket.ticket_id and t.asignado_a = (select auth.uid())
));

create policy match_support_scope on public.ticket_match_decisiones
for select to authenticated
using (app_private.has_role(array['soporte']) and exists (
  select 1 from public.tickets t where t.id = ticket_match_decisiones.ticket_id and t.asignado_a = (select auth.uid())
));

create policy quick_replies_support_select on public.ticket_respuestas_rapidas
for select to authenticated
using (app_private.has_role(array['soporte']) and activo);

create policy assignment_rules_support_select on public.reglas_asignacion
for select to authenticated
using (app_private.has_role(array['soporte']) and activo and eliminado_en is null);

create policy public_site_config_anon_select on public.site_config
for select to anon
using (publico and activo and clave in (
  'soporte.hero.kicker','soporte.hero.titulo','soporte.ayuda.titulo',
  'soporte.evidencia.hint','estado.reply.titulo','estado.reply.hint'
));

create policy public_site_config_authenticated_select on public.site_config
for select to authenticated
using (publico and activo and clave in (
  'soporte.hero.kicker','soporte.hero.titulo','soporte.ayuda.titulo',
  'soporte.evidencia.hint','estado.reply.titulo','estado.reply.hint'
));

create policy public_active_notices_anon_select on public.avisos_globales
for select to anon
using (
  activo and mostrar_en_soporte
  and (starts_at is null or starts_at <= now())
  and (ends_at is null or ends_at > now())
);

create policy public_active_notices_authenticated_select on public.avisos_globales
for select to authenticated
using (
  activo and mostrar_en_soporte
  and (starts_at is null or starts_at <= now())
  and (ends_at is null or ends_at > now())
);

create policy bitacora_admin_select on public.bitacora
for select to authenticated
using (app_private.has_role(array['admin']));

create policy bitacora_support_own_select on public.bitacora
for select to authenticated
using (app_private.has_role(array['soporte']) and actor_id = (select auth.uid()));

create policy portal_logs_admin_select on public.ticket_portal_logs
for select to authenticated
using (app_private.has_role(array['admin']));

create policy rate_limits_admin_select on public.rate_limit_events
for select to authenticated
using (app_private.has_role(array['admin']));

create policy idempotency_admin_select on public.edge_idempotency
for select to authenticated
using (app_private.has_role(array['admin']));

create policy folios_admin_select on public.ticket_folios
for select to authenticated
using (app_private.has_role(array['admin']));

create policy soporte_adjuntos_select on storage.objects
for select to authenticated
using (
  bucket_id = 'soporte_adjuntos'
  and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
  and (
    app_private.has_role(array['admin'])
    or exists (
      select 1 from public.tickets t
      where t.id = case
        when (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
        then ((storage.foldername(name))[1])::uuid
        else null
      end
        and t.asignado_a = (select auth.uid())
    )
  )
);

commit;
