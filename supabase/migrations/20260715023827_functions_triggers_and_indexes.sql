-- Ticket Core staging baseline 0010.
-- Preconditions: all 24 canonical tables exist.
-- Rollback: FULLY_REVERSIBLE after candidate RLS policies are removed first.
begin;

create function app_private.has_role(allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.perfiles p
    where p.id = (select auth.uid())
      and p.activo
      and p.rol = any(allowed_roles)
  );
$$;

comment on function app_private.has_role(text[]) is
  'SECURITY DEFINER is narrowly justified to avoid RLS recursion. Fixed search_path; reads only the caller profile.';
revoke all on function app_private.has_role(text[]) from public, anon;
grant execute on function app_private.has_role(text[]) to authenticated, service_role;

create function app_private.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if to_jsonb(new) ? 'updated_at' then
    new := jsonb_populate_record(new, jsonb_build_object('updated_at', now()));
  elsif to_jsonb(new) ? 'actualizado_en' then
    new := jsonb_populate_record(new, jsonb_build_object('actualizado_en', now()));
  end if;
  return new;
end;
$$;
revoke all on function app_private.touch_updated_at() from public, anon, authenticated;

create function app_private.sync_bitacora_actor()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_role text;
begin
  new.actor_id := coalesce(new.actor_id, new.usuario_id, (select auth.uid()));
  new.usuario_id := coalesce(new.usuario_id, new.actor_id);
  if new.actor_id is not null and new.actor_tipo = 'sistema' then
    select p.rol into actor_role from public.perfiles p where p.id = new.actor_id;
    if actor_role in ('admin', 'soporte') then
      new.actor_tipo := actor_role;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function app_private.sync_bitacora_actor() from public, anon, authenticated;

create function app_private.guard_ticket_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user = 'authenticated'
     and app_private.has_role(array['soporte'])
     and (
       new.id is distinct from old.id
       or new.cliente_id is distinct from old.cliente_id
       or new.contacto_id is distinct from old.contacto_id
       or new.solicitud_soporte_id is distinct from old.solicitud_soporte_id
       or new.asignado_a is distinct from old.asignado_a
       or new.creado_por is distinct from old.creado_por
       or new.folio is distinct from old.folio
       or new.token_publico is distinct from old.token_publico
       or new.token_publico_expira is distinct from old.token_publico_expira
     ) then
    raise exception 'support_cannot_change_ticket_ownership_or_public_token'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app_private.guard_ticket_update() from public, anon, authenticated;

create function public.next_ticket_folio(p_prefix text default 'EX')
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  normalized_prefix text := upper(trim(p_prefix));
  next_value bigint;
begin
  if normalized_prefix !~ '^[A-Z]{2,8}$' then
    raise exception 'invalid_folio_prefix' using errcode = '22023';
  end if;

  insert into public.ticket_folios(prefix, last_value)
  values (normalized_prefix, 1)
  on conflict (prefix) do update
    set last_value = public.ticket_folios.last_value + 1,
        updated_at = now()
  returning last_value into next_value;

  return normalized_prefix || '-' || lpad(next_value::text, 6, '0');
end;
$$;
revoke all on function public.next_ticket_folio(text) from public, anon, authenticated;
grant execute on function public.next_ticket_folio(text) to service_role;

create function app_private.claim_edge_idempotency(
  p_action text,
  p_key text,
  p_request_hash text,
  p_resource_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  existing public.edge_idempotency;
  claimed boolean := false;
begin
  if p_key is null or char_length(p_key) not between 16 and 200 then
    raise exception 'TC_IDEMPOTENCY_KEY_REQUIRED' using errcode = '22023';
  end if;
  if p_request_hash is null or p_request_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'TC_IDEMPOTENCY_HASH_INVALID' using errcode = '22023';
  end if;

  insert into public.edge_idempotency(idempotency_key, action, resource_id, request_hash)
  values (p_key, p_action, p_resource_id, p_request_hash)
  on conflict (idempotency_key) do nothing
  returning true into claimed;

  select * into existing
  from public.edge_idempotency
  where idempotency_key = p_key
  for update;

  if existing.action <> p_action or existing.request_hash <> p_request_hash then
    raise exception 'TC_IDEMPOTENCY_KEY_REUSED' using errcode = '23505';
  end if;

  if not coalesce(claimed, false)
     and (existing.status = 'failed' or existing.expires_at <= now()) then
    update public.edge_idempotency
    set status = 'processing', response = null, error = null,
        resource_id = coalesce(p_resource_id, resource_id),
        updated_at = now(), expires_at = now() + interval '24 hours'
    where idempotency_key = p_key
    returning * into existing;
    claimed := true;
  end if;

  return jsonb_build_object(
    'status', existing.status,
    'resource_id', existing.resource_id,
    'response', existing.response,
    'claimed', coalesce(claimed, false),
    'is_replay', not coalesce(claimed, false)
  );
end;
$$;
revoke all on function app_private.claim_edge_idempotency(text, text, text, uuid) from public, anon, authenticated;
grant execute on function app_private.claim_edge_idempotency(text, text, text, uuid) to service_role;

create function app_private.complete_edge_idempotency(
  p_key text,
  p_status text,
  p_resource_id uuid,
  p_response jsonb default null,
  p_error text default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_status not in ('completed', 'failed') then
    raise exception 'invalid_idempotency_terminal_status' using errcode = '22023';
  end if;
  update public.edge_idempotency
  set status = p_status,
      resource_id = coalesce(p_resource_id, resource_id),
      response = p_response,
      error = left(p_error, 500),
      updated_at = now()
  where idempotency_key = p_key;
  if not found then
    raise exception 'idempotency_key_not_claimed' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function app_private.complete_edge_idempotency(text, text, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function app_private.complete_edge_idempotency(text, text, uuid, jsonb, text) to service_role;

create function public.manage_assignment_rule(
  p_operation text,
  p_rule_id uuid default null,
  p_payload jsonb default '{}'::jsonb
)
returns public.reglas_asignacion
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.reglas_asignacion;
  actor uuid := (select auth.uid());
begin
  if not app_private.has_role(array['admin']) then
    raise exception 'admin_required' using errcode = '42501';
  end if;

  if p_operation = 'create' then
    insert into public.reglas_asignacion(
      nombre, prioridad, tipo_condicion, valor, agente_id, activo,
      creado_por, actualizado_por
    ) values (
      nullif(trim(p_payload->>'nombre'), ''),
      coalesce((p_payload->>'prioridad')::integer, 100),
      p_payload->>'tipo_condicion',
      nullif(trim(p_payload->>'valor'), ''),
      (p_payload->>'agente_id')::uuid,
      coalesce((p_payload->>'activo')::boolean, true),
      actor, actor
    ) returning * into result;
  elsif p_operation = 'update' then
    update public.reglas_asignacion r
    set nombre = coalesce(nullif(trim(p_payload->>'nombre'), ''), r.nombre),
        prioridad = coalesce((p_payload->>'prioridad')::integer, r.prioridad),
        tipo_condicion = coalesce(p_payload->>'tipo_condicion', r.tipo_condicion),
        valor = case when p_payload ? 'valor' then nullif(trim(p_payload->>'valor'), '') else r.valor end,
        agente_id = coalesce((p_payload->>'agente_id')::uuid, r.agente_id),
        activo = coalesce((p_payload->>'activo')::boolean, r.activo),
        actualizado_por = actor
    where r.id = p_rule_id and r.eliminado_en is null
    returning * into result;
  elsif p_operation = 'deactivate' then
    update public.reglas_asignacion r
    set activo = false, eliminado_en = now(), eliminado_por = actor, actualizado_por = actor
    where r.id = p_rule_id and r.eliminado_en is null
    returning * into result;
  else
    raise exception 'unsupported_rule_operation' using errcode = '22023';
  end if;

  if result.id is null then
    raise exception 'assignment_rule_not_found' using errcode = 'P0002';
  end if;
  return result;
end;
$$;
comment on function public.manage_assignment_rule(text, uuid, jsonb) is
  'SECURITY DEFINER is restricted to canonical admin profiles and is the only browser-callable assignment-rule mutation surface.';
revoke all on function public.manage_assignment_rule(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.manage_assignment_rule(text, uuid, jsonb) to authenticated;

create function public.manage_site_config(p_clave text, p_valor text)
returns public.site_config
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.site_config;
  previous_value text;
  actor uuid := (select auth.uid());
begin
  if not app_private.has_role(array['admin']) then
    raise exception 'admin_required' using errcode = '42501';
  end if;

  select valor into previous_value
  from public.site_config
  where clave = p_clave
  for update;
  if not found then
    raise exception 'site_config_key_not_allowed' using errcode = '22023';
  end if;

  update public.site_config
  set valor = p_valor, actualizado_por = actor
  where clave = p_clave
  returning * into result;

  insert into public.bitacora(
    actor_id, accion, entidad_tipo, resumen, detalle
  ) values (
    actor, 'site_config_update', 'site_config', 'Configuración pública actualizada',
    jsonb_build_object('clave', p_clave, 'antes', previous_value, 'despues', result.valor)
  );
  return result;
end;
$$;
comment on function public.manage_site_config(text, text) is
  'Admin-only transactional text update with audit; HTML/script is rejected by the table constraint.';
revoke all on function public.manage_site_config(text, text) from public, anon, authenticated;
grant execute on function public.manage_site_config(text, text) to authenticated;

create function app_private.audit_assignment_rule_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  action_name text;
begin
  action_name := case
    when tg_op = 'INSERT' then 'regla_asignacion_creada'
    when old.eliminado_en is null and new.eliminado_en is not null then 'regla_asignacion_desactivada'
    else 'regla_asignacion_actualizada'
  end;
  insert into public.bitacora(
    actor_id, actor_tipo, accion, entidad_tipo, entidad_id, resumen, detalle
  ) values (
    coalesce(new.actualizado_por, new.creado_por, (select auth.uid())),
    'admin', action_name, 'regla_asignacion', new.id,
    left(new.nombre, 500),
    jsonb_build_object('prioridad', new.prioridad, 'tipo_condicion', new.tipo_condicion, 'activo', new.activo)
  );
  return new;
end;
$$;
revoke all on function app_private.audit_assignment_rule_change() from public, anon, authenticated;

create function public.manage_ticket_assignment(
  p_ticket_id uuid,
  p_assigned_to uuid,
  p_idempotency_key text,
  p_request_hash text,
  p_expected_fecha_actualizacion timestamptz
)
returns public.tickets
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.tickets;
  current_ticket public.tickets;
  claim jsonb;
  actor uuid := (select auth.uid());
  request_role text := coalesce(
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
    ''
  );
begin
  -- request.jwt.claims.role is the signed system role claim, never user_metadata.
  if request_role <> 'service_role'
     and not app_private.has_role(array['admin']) then
    raise exception 'admin_or_edge_required' using errcode = '42501';
  end if;
  claim := app_private.claim_edge_idempotency('asignar_ticket', p_idempotency_key, p_request_hash, p_ticket_id);
  if claim->>'status' = 'completed' then
    select * into result from public.tickets where id = p_ticket_id;
    return result;
  end if;
  if coalesce((claim->>'claimed')::boolean, false) is not true then
    raise exception 'TC_IDEMPOTENCY_IN_PROGRESS' using errcode = '55000';
  end if;
  select * into current_ticket from public.tickets where id = p_ticket_id for update;
  if current_ticket.id is null then raise exception 'ticket_not_found' using errcode = 'P0002'; end if;
  if p_expected_fecha_actualizacion is null
     or current_ticket.fecha_actualizacion is distinct from p_expected_fecha_actualizacion then
    raise exception 'TC_ASSIGNMENT_VERSION_CONFLICT' using errcode = '40001';
  end if;
  if p_assigned_to is not null and not exists (
    select 1 from public.perfiles p
    where p.id = p_assigned_to and p.activo and p.rol in ('admin', 'soporte')
  ) then
    raise exception 'invalid_or_inactive_assignee' using errcode = '23503';
  end if;
  update public.tickets
  set asignado_a = p_assigned_to,
      asignado_en = now(),
      fecha_actualizacion = now()
  where id = p_ticket_id
  returning * into result;
  if result.id is null then raise exception 'ticket_not_found' using errcode = 'P0002'; end if;
  insert into public.ticket_eventos(ticket_id, autor_tipo, visibilidad, kind, texto, meta)
  values (p_ticket_id, 'sistema', 'interna', 'asignacion', 'Ticket asignado.',
    jsonb_build_object('idempotency_key', p_idempotency_key, 'asignado_a', p_assigned_to));
  insert into public.bitacora(actor_id, accion, entidad_tipo, entidad_id, resumen, detalle)
  values (
    actor, 'ticket_asignado', 'ticket', p_ticket_id, 'Asignación de ticket actualizada',
    jsonb_build_object(
      'asignado_a', p_assigned_to,
      'asignado_anterior', current_ticket.asignado_a,
      'expected_fecha_actualizacion', p_expected_fecha_actualizacion
    )
  );
  perform app_private.complete_edge_idempotency(p_idempotency_key, 'completed', p_ticket_id,
    jsonb_build_object('ticket_id', p_ticket_id, 'asignado_a', p_assigned_to, 'fecha_actualizacion', result.fecha_actualizacion), null);
  return result;
end;
$$;
comment on function public.manage_ticket_assignment(uuid, uuid, text, text, timestamptz) is
  'SECURITY DEFINER is justified for one transactional assignment API; it validates admin/service_role and has a fixed search_path.';
revoke all on function public.manage_ticket_assignment(uuid, uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.manage_ticket_assignment(uuid, uuid, text, text, timestamptz) to authenticated, service_role;

create function public.consolidate_ticket_client(
  p_ticket_id uuid,
  p_cliente_id uuid,
  p_contacto_id uuid,
  p_idempotency_key text,
  p_request_hash text
)
returns public.tickets
language plpgsql
security invoker
set search_path = ''
as $$
declare
  result public.tickets;
  claim jsonb;
begin
  if current_user <> 'service_role' then
    raise exception 'edge_only' using errcode = '42501';
  end if;
  if p_contacto_id is not null and not exists (
    select 1 from public.clientes_contactos c where c.id = p_contacto_id and c.cliente_id = p_cliente_id
  ) then
    raise exception 'contact_does_not_belong_to_client' using errcode = '23503';
  end if;
  claim := app_private.claim_edge_idempotency('consolidar_cliente', p_idempotency_key, p_request_hash, p_ticket_id);
  if claim->>'status' = 'completed' then
    select * into result from public.tickets where id = p_ticket_id;
    return result;
  end if;
  if coalesce((claim->>'claimed')::boolean, false) is not true then
    raise exception 'TC_IDEMPOTENCY_IN_PROGRESS' using errcode = '55000';
  end if;
  if not exists (
    select 1 from public.tickets where id = p_ticket_id and requiere_consolidacion
  ) then
    raise exception 'ticket_not_pending_consolidation' using errcode = '55000';
  end if;
  update public.tickets
  set cliente_id = p_cliente_id,
      contacto_id = p_contacto_id,
      requiere_consolidacion = false,
      match_confirmado = true,
      contacto_confirmado = (p_contacto_id is not null),
      fecha_actualizacion = now()
  where id = p_ticket_id
  returning * into result;
  if result.id is null then raise exception 'ticket_not_found' using errcode = 'P0002'; end if;
  update public.solicitudes_soporte
  set cliente_id = p_cliente_id,
      contacto_id = p_contacto_id,
      requiere_consolidacion = false,
      actualizado_en = now()
  where id = result.solicitud_soporte_id;
  insert into public.ticket_eventos(ticket_id, autor_tipo, visibilidad, kind, texto, meta)
  values (p_ticket_id, 'sistema', 'interna', 'consolidacion', 'Cliente consolidado.',
    jsonb_build_object('idempotency_key', p_idempotency_key, 'cliente_id', p_cliente_id, 'contacto_id', p_contacto_id));
  insert into public.bitacora(accion, entidad_tipo, entidad_id, cliente_id, resumen, detalle)
  values (
    'consolidacion_confirmar_asociacion', 'ticket', p_ticket_id, p_cliente_id,
    'Cliente y contacto consolidados',
    jsonb_build_object('ticket_id', p_ticket_id, 'cliente_id', p_cliente_id, 'contacto_id', p_contacto_id)
  );
  perform app_private.complete_edge_idempotency(p_idempotency_key, 'completed', p_ticket_id,
    jsonb_build_object('ticket_id', p_ticket_id), null);
  return result;
end;
$$;
revoke all on function public.consolidate_ticket_client(uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.consolidate_ticket_client(uuid, uuid, uuid, text, text) to service_role;

create function app_private.audit_support_consent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.consentimiento_aceptado is true
     and old.estatus is distinct from 'ticket_creado'
     and new.estatus = 'ticket_creado' then
    insert into public.bitacora(
      actor_tipo, accion, entidad_tipo, entidad_id, resumen, detalle, request_id
    ) values (
      'anon', 'consentimiento_registrado', 'solicitud_soporte', new.id,
      'Consentimiento de solicitud pública registrado',
      jsonb_build_object(
        'consentimiento_en', new.consentimiento_en,
        'consentimiento_version', new.consentimiento_version,
        'privacidad_version', new.privacidad_version,
        'consentimiento_origen', new.consentimiento_origen
      ),
      new.id
    );
  end if;
  return new;
end;
$$;
comment on function app_private.audit_support_consent() is
  'Writes immutable versioned consent evidence when an intake transitions to ticket_creado.';
revoke all on function app_private.audit_support_consent() from public, anon, authenticated, service_role;

create trigger trg_perfiles_updated_at before update on public.perfiles
for each row execute function app_private.touch_updated_at();
create trigger trg_clientes_updated_at before update on public.clientes
for each row execute function app_private.touch_updated_at();
create trigger trg_contactos_updated_at before update on public.clientes_contactos
for each row execute function app_private.touch_updated_at();
create trigger trg_solicitudes_soporte_updated_at before update on public.solicitudes_soporte
for each row execute function app_private.touch_updated_at();
create trigger trg_reglas_updated_at before update on public.reglas_asignacion
for each row execute function app_private.touch_updated_at();
create trigger trg_site_config_updated_at before update on public.site_config
for each row execute function app_private.touch_updated_at();
create trigger trg_avisos_updated_at before update on public.avisos_globales
for each row execute function app_private.touch_updated_at();
create trigger trg_edge_idempotency_updated_at before update on public.edge_idempotency
for each row execute function app_private.touch_updated_at();
create trigger trg_bitacora_actor before insert on public.bitacora
for each row execute function app_private.sync_bitacora_actor();
create trigger trg_guard_ticket_update before update on public.tickets
for each row execute function app_private.guard_ticket_update();
create trigger trg_assignment_rule_audit after insert or update on public.reglas_asignacion
for each row execute function app_private.audit_assignment_rule_change();
create trigger trg_support_consent_audit after update of estatus on public.solicitudes_soporte
for each row execute function app_private.audit_support_consent();

create unique index ux_contacto_principal_por_cliente
  on public.clientes_contactos(cliente_id) where es_principal and activo;
create index ix_contactos_cliente on public.clientes_contactos(cliente_id);
create index ix_contactos_correo_lower on public.clientes_contactos(lower(correo)) where correo is not null;
create index ix_cliente_aliases_norm on public.cliente_aliases(alias_norm) where activo;
create index ix_cliente_aliases_cliente on public.cliente_aliases(cliente_id);
create index ix_cliente_sistemas_cliente on public.cliente_sistemas(cliente_id);
create index ix_cliente_accesos_cliente on public.cliente_accesos(cliente_id);
create index ix_solicitudes_soporte_created on public.solicitudes_soporte(created_at desc);
create index ix_solicitud_archivos_solicitud on public.solicitud_archivos(solicitud_id);
create index ix_tickets_cliente on public.tickets(cliente_id);
create index ix_tickets_asignado_estado on public.tickets(asignado_a, estado, fecha_actualizacion desc);
create index ix_tickets_estado on public.tickets(estado, prioridad, fecha_creacion desc);
create index ix_ticket_eventos_timeline on public.ticket_eventos(ticket_id, created_at, id);
create unique index ux_ticket_eventos_idempotency
  on public.ticket_eventos(ticket_id, idempotency_key) where idempotency_key is not null;
create index ix_archivos_ticket_ticket on public.archivos_ticket(ticket_id, creado_en);
create index ix_ticket_portal_logs_ticket_time on public.ticket_portal_logs(ticket_id, created_at desc);
create index ix_rate_limit_scope_key_time on public.rate_limit_events(scope, key_hash, created_at desc);
create index ix_bitacora_entidad on public.bitacora(entidad_tipo, entidad_id, created_at desc);
create index ix_bitacora_actor on public.bitacora(actor_id, created_at desc);
create index ix_reglas_vigentes on public.reglas_asignacion(prioridad, created_at) where eliminado_en is null and activo;
create index ix_edge_idempotency_expiry on public.edge_idempotency(expires_at);

-- PostgreSQL does not create indexes for referencing FK columns. These indexes
-- keep joins, RLS scope checks and parent deletes from scanning whole tables.
create index ix_clientes_creado_por on public.clientes(creado_por);
create index ix_contacto_historial_contacto on public.clientes_contacto_historial(contacto_id);
create index ix_contacto_historial_cliente on public.clientes_contacto_historial(cliente_id);
create index ix_cliente_aliases_creado_por on public.cliente_aliases(creado_por);
create index ix_cliente_sistemas_actualizado_por on public.cliente_sistemas(actualizado_por);
create index ix_cliente_accesos_contacto on public.cliente_accesos(contacto_id);
create index ix_cliente_accesos_actualizado_por on public.cliente_accesos(actualizado_por);
create index ix_solicitudes_alta_cliente on public.solicitudes_alta(cliente_id);
create index ix_solicitudes_alta_contacto on public.solicitudes_alta(contacto_id);
create index ix_solicitudes_alta_cliente_sugerido on public.solicitudes_alta(cliente_id_sugerido);
create index ix_solicitudes_alta_contacto_sugerido on public.solicitudes_alta(contacto_id_sugerido);
create index ix_solicitudes_registro_cliente on public.solicitudes_registro(cliente_id);
create index ix_solicitudes_registro_contacto on public.solicitudes_registro(contacto_id);
create index ix_solicitudes_registro_cliente_sugerido on public.solicitudes_registro(cliente_id_sugerido);
create index ix_solicitudes_registro_contacto_sugerido on public.solicitudes_registro(contacto_id_sugerido);
create index ix_solicitudes_soporte_cliente on public.solicitudes_soporte(cliente_id);
create index ix_solicitudes_soporte_contacto on public.solicitudes_soporte(contacto_id);
create index ix_solicitudes_soporte_cliente_sugerido on public.solicitudes_soporte(cliente_id_sugerido);
create index ix_solicitudes_soporte_contacto_sugerido on public.solicitudes_soporte(contacto_id_sugerido);
create index ix_solicitudes_soporte_ticket on public.solicitudes_soporte(ticket_id);
create index ix_tickets_contacto on public.tickets(contacto_id);
create index ix_tickets_creado_por on public.tickets(creado_por);
create index ix_tickets_cliente_sugerido on public.tickets(cliente_id_sugerido);
create index ix_tickets_contacto_sugerido on public.tickets(contacto_id_sugerido);
create index ix_tickets_revisado_por on public.tickets(revisado_por);
create index ix_ticket_eventos_created_by on public.ticket_eventos(created_by);
create index ix_respuestas_rapidas_cliente on public.ticket_respuestas_rapidas(cliente_id);
create index ix_respuestas_rapidas_contacto on public.ticket_respuestas_rapidas(contacto_id);
create index ix_match_ticket on public.ticket_match_decisiones(ticket_id);
create index ix_match_solicitud on public.ticket_match_decisiones(solicitud_soporte_id);
create index ix_match_cliente_sugerido on public.ticket_match_decisiones(cliente_id_sugerido);
create index ix_match_contacto_sugerido on public.ticket_match_decisiones(contacto_id_sugerido);
create index ix_match_decidido_por on public.ticket_match_decisiones(decidido_por);
create index ix_archivos_ticket_solicitud on public.archivos_ticket(solicitud_id);
create index ix_archivos_ticket_subido_por on public.archivos_ticket(subido_por);
create index ix_reglas_agente on public.reglas_asignacion(agente_id);
create index ix_reglas_creado_por on public.reglas_asignacion(creado_por);
create index ix_reglas_actualizado_por on public.reglas_asignacion(actualizado_por);
create index ix_reglas_eliminado_por on public.reglas_asignacion(eliminado_por);
create index ix_site_config_actualizado_por on public.site_config(actualizado_por);
create index ix_avisos_created_by on public.avisos_globales(created_by);
create index ix_bitacora_usuario on public.bitacora(usuario_id);
create index ix_bitacora_cliente on public.bitacora(cliente_id);

commit;
