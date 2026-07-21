-- PREPARED_NOT_APPLIED
-- DO_NOT_APPLY_WITHOUT_STAGING_REVIEW
-- TC-U15C-D
-- TC-U15C-D2 HARDENING
-- request_hash calculado en servidor; fallos posteriores al reclamo hacen rollback
--
-- Consolidación transaccional de cliente/contacto para tickets.
-- Esta migración está preparada localmente y NO ha sido aplicada.

alter table public.tickets
  add column if not exists consolidacion_version bigint not null default 0;

do $constraint$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tickets_consolidacion_version_nonnegative_chk'
      and conrelid = 'public.tickets'::regclass
  ) then
    alter table public.tickets
      add constraint tickets_consolidacion_version_nonnegative_chk
      check (consolidacion_version >= 0);
  end if;
end
$constraint$;

create index if not exists idx_tickets_cliente_id_sugerido
  on public.tickets (cliente_id_sugerido);

create index if not exists idx_tickets_contacto_id
  on public.tickets (contacto_id);

create index if not exists idx_tickets_contacto_id_sugerido
  on public.tickets (contacto_id_sugerido);

drop function if exists public.tc_consolidar_cliente_ticket(
  uuid,
  text,
  bigint,
  text,
  text,
  uuid,
  uuid,
  jsonb,
  jsonb
);

create or replace function public.tc_consolidar_cliente_ticket(
  p_ticket_id uuid,
  p_action text,
  p_expected_version bigint,
  p_idempotency_key text,
  p_cliente_id uuid default null,
  p_contacto_id uuid default null,
  p_cliente jsonb default '{}'::jsonb,
  p_contacto jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_ticket public.tickets%rowtype;
  v_idempotency public.edge_idempotency%rowtype;
  v_idempotency_inserted integer := 0;
  v_request_hash text;
  v_response jsonb;
  v_operation_id uuid := gen_random_uuid();

  v_final_cliente_id uuid;
  v_final_contacto_id uuid;
  v_created_cliente boolean := false;
  v_created_contacto boolean := false;
  v_decision text := 'pendiente';
  v_decision_id uuid;

  v_cliente_nombre text;
  v_contacto_nombre text;
  v_contacto_correo text;
  v_contacto_telefono text;
begin
  if v_actor is null then
    raise exception 'authentication required'
      using errcode = '42501';
  end if;

  v_role := public.tc_current_role();

  if v_role is distinct from 'admin' then
    raise exception 'admin role required'
      using errcode = '42501';
  end if;

  if p_action is null or p_action not in (
    'associate_existing',
    'create_new',
    'discard_candidate',
    'postpone'
  ) then
    return jsonb_build_object(
      'ok', false,
      'status', 422,
      'code', 'INVALID_ACTION'
    );
  end if;

  if p_expected_version is null or p_expected_version < 0 then
    return jsonb_build_object(
      'ok', false,
      'status', 422,
      'code', 'INVALID_EXPECTED_VERSION'
    );
  end if;

  if nullif(trim(p_idempotency_key), '') is null
     or length(trim(p_idempotency_key)) < 8 then
    return jsonb_build_object(
      'ok', false,
      'status', 422,
      'code', 'INVALID_IDEMPOTENCY_KEY'
    );
  end if;

  v_request_hash := md5(
    jsonb_build_object(
      'ticket_id', p_ticket_id,
      'action', p_action,
      'expected_version', p_expected_version,
      'cliente_id', p_cliente_id,
      'contacto_id', p_contacto_id,
      'cliente', coalesce(p_cliente, '{}'::jsonb),
      'contacto', coalesce(p_contacto, '{}'::jsonb)
    )::text
  );

  insert into public.edge_idempotency (
    idempotency_key,
    action,
    resource_id,
    request_hash,
    status
  )
  values (
    trim(p_idempotency_key),
    'tc_consolidar_cliente_ticket',
    p_ticket_id,
    v_request_hash,
    'processing'
  )
  on conflict (idempotency_key) do nothing;

  get diagnostics v_idempotency_inserted = row_count;

  if v_idempotency_inserted = 0 then
    select *
      into v_idempotency
      from public.edge_idempotency
      where idempotency_key = trim(p_idempotency_key)
      for update;

    if not found then
      raise exception 'idempotency row disappeared'
        using errcode = 'P0001';
    end if;

    if v_idempotency.action is distinct from
         'tc_consolidar_cliente_ticket'
       or v_idempotency.resource_id is distinct from p_ticket_id
       or v_idempotency.request_hash is distinct from v_request_hash
    then
      return jsonb_build_object(
        'ok', false,
        'status', 409,
        'code', 'IDEMPOTENCY_PAYLOAD_MISMATCH'
      );
    end if;

    if v_idempotency.status = 'completed'
       and v_idempotency.response is not null then
      return v_idempotency.response ||
        jsonb_build_object('replayed', true);
    end if;

    return jsonb_build_object(
      'ok', false,
      'status', 409,
      'code', 'IDEMPOTENCY_IN_PROGRESS'
    );
  end if;

  select *
    into v_ticket
    from public.tickets
    where id = p_ticket_id
    for update;

  if not found then
    v_response := jsonb_build_object(
      'ok', false,
      'status', 404,
      'code', 'TICKET_NOT_FOUND'
    );

    raise exception 'TC_U15CD_LOGICAL_FAILURE'
      using errcode = 'P0001',
            detail = v_response::text;
  end if;

  if v_ticket.consolidacion_version <> p_expected_version then
    v_response := jsonb_build_object(
      'ok', false,
      'status', 409,
      'code', 'STALE_EXPECTED_VERSION',
      'expected_version', p_expected_version,
      'current_version', v_ticket.consolidacion_version
    );

    raise exception 'TC_U15CD_LOGICAL_FAILURE'
      using errcode = 'P0001',
            detail = v_response::text;
  end if;

  if v_ticket.estado in ('resuelto', 'cerrado') then
    v_response := jsonb_build_object(
      'ok', false,
      'status', 409,
      'code', 'TICKET_TERMINAL_STATE',
      'ticket_status', v_ticket.estado
    );

    raise exception 'TC_U15CD_LOGICAL_FAILURE'
      using errcode = 'P0001',
            detail = v_response::text;
  end if;

  if p_action <> 'postpone'
     and v_ticket.requiere_consolidacion is not true then
    v_response := jsonb_build_object(
      'ok', false,
      'status', 409,
      'code', 'CONSOLIDATION_ALREADY_RESOLVED',
      'current_version', v_ticket.consolidacion_version
    );

    raise exception 'TC_U15CD_LOGICAL_FAILURE'
      using errcode = 'P0001',
            detail = v_response::text;
  end if;

  v_final_contacto_id := v_ticket.contacto_id;

  if p_action = 'associate_existing' then
    if p_cliente_id is null then
      v_response := jsonb_build_object(
        'ok', false,
        'status', 422,
        'code', 'CLIENT_REQUIRED'
      );

      raise exception 'TC_U15CD_LOGICAL_FAILURE'
        using errcode = 'P0001',
              detail = v_response::text;
    end if;

    select id
      into v_final_cliente_id
      from public.clientes
      where id = p_cliente_id
        and activo is true;

    if not found then
      v_response := jsonb_build_object(
        'ok', false,
        'status', 422,
        'code', 'CLIENT_NOT_FOUND'
      );

      raise exception 'TC_U15CD_LOGICAL_FAILURE'
        using errcode = 'P0001',
              detail = v_response::text;
    end if;

    if p_contacto_id is not null then
      select id
        into v_final_contacto_id
        from public.clientes_contactos
        where id = p_contacto_id
          and cliente_id = v_final_cliente_id
          and activo is true;

      if not found then
        v_response := jsonb_build_object(
          'ok', false,
          'status', 422,
          'code', 'CONTACT_NOT_OWNED_BY_CLIENT'
        );

        raise exception 'TC_U15CD_LOGICAL_FAILURE'
          using errcode = 'P0001',
                detail = v_response::text;
      end if;
    end if;

    v_decision := 'aceptado';

  elsif p_action = 'create_new' then
    if p_cliente_id is not null then
      select id
        into v_final_cliente_id
        from public.clientes
        where id = p_cliente_id
          and activo is true;

      if not found then
        v_response := jsonb_build_object(
          'ok', false,
          'status', 422,
          'code', 'CLIENT_NOT_FOUND'
        );

        raise exception 'TC_U15CD_LOGICAL_FAILURE'
          using errcode = 'P0001',
                detail = v_response::text;
      end if;
    else
      v_cliente_nombre := coalesce(
        nullif(trim(coalesce(p_cliente->>'nombre', '')), ''),
        nullif(trim(coalesce(v_ticket.empresa_capturada, '')), '')
      );

      if v_cliente_nombre is null then
        v_response := jsonb_build_object(
          'ok', false,
          'status', 422,
          'code', 'CLIENT_NAME_REQUIRED'
        );

        raise exception 'TC_U15CD_LOGICAL_FAILURE'
          using errcode = 'P0001',
                detail = v_response::text;
      end if;

      insert into public.clientes (
        nombre,
        telefono,
        correo,
        origen_registro,
        creado_por,
        activo,
        requiere_revision,
        calidad_datos
      )
      values (
        v_cliente_nombre,
        nullif(trim(coalesce(p_cliente->>'telefono', '')), ''),
        nullif(trim(coalesce(p_cliente->>'correo', '')), ''),
        'ticket_core',
        v_actor,
        true,
        false,
        'validado'
      )
      returning id into v_final_cliente_id;

      v_created_cliente := true;
    end if;

    if p_contacto_id is not null then
      select id
        into v_final_contacto_id
        from public.clientes_contactos
        where id = p_contacto_id
          and cliente_id = v_final_cliente_id
          and activo is true;

      if not found then
        v_response := jsonb_build_object(
          'ok', false,
          'status', 422,
          'code', 'CONTACT_NOT_OWNED_BY_CLIENT'
        );

        raise exception 'TC_U15CD_LOGICAL_FAILURE'
          using errcode = 'P0001',
                detail = v_response::text;
      end if;
    else
      v_contacto_nombre := coalesce(
        nullif(trim(coalesce(p_contacto->>'nombre', '')), ''),
        nullif(trim(coalesce(v_ticket.nombre_capturado, '')), '')
      );

      v_contacto_correo := coalesce(
        nullif(trim(coalesce(p_contacto->>'correo', '')), ''),
        nullif(trim(coalesce(v_ticket.correo_capturado, '')), '')
      );

      v_contacto_telefono := coalesce(
        nullif(trim(coalesce(p_contacto->>'telefono', '')), ''),
        nullif(trim(coalesce(v_ticket.telefono_capturado, '')), '')
      );

      if v_ticket.contacto_id is not null
         and v_contacto_nombre is not null then
        v_response := jsonb_build_object(
          'ok', false,
          'status', 422,
          'code', 'CONTACT_OVERWRITE_NOT_ALLOWED'
        );

        raise exception 'TC_U15CD_LOGICAL_FAILURE'
          using errcode = 'P0001',
                detail = v_response::text;
      end if;

      if v_contacto_nombre is not null then
        insert into public.clientes_contactos (
          cliente_id,
          nombre,
          correo,
          telefono,
          origen_alta,
          activo
        )
        values (
          v_final_cliente_id,
          v_contacto_nombre,
          v_contacto_correo,
          v_contacto_telefono,
          'ticket_consolidacion',
          true
        )
        returning id into v_final_contacto_id;

        v_created_contacto := true;
      end if;
    end if;

    if v_created_cliente then
      v_decision := 'creado_cliente';
    elsif v_created_contacto then
      v_decision := 'creado_contacto';
    else
      v_decision := 'aceptado';
    end if;

  elsif p_action = 'discard_candidate' then
    v_final_cliente_id := v_ticket.cliente_id;
    v_final_contacto_id := v_ticket.contacto_id;
    v_decision := 'ignorado';

  elsif p_action = 'postpone' then
    v_final_cliente_id := v_ticket.cliente_id;
    v_final_contacto_id := v_ticket.contacto_id;
    v_decision := 'pendiente';
  end if;

  if p_action in ('associate_existing', 'create_new')
     and v_ticket.contacto_id is not null
     and v_final_contacto_id is distinct from v_ticket.contacto_id then
    v_response := jsonb_build_object(
      'ok', false,
      'status', 422,
      'code', 'CONTACT_OVERWRITE_NOT_ALLOWED'
    );

    raise exception 'TC_U15CD_LOGICAL_FAILURE'
      using errcode = 'P0001',
            detail = v_response::text;
  end if;

  if p_action in ('associate_existing', 'create_new') then
    update public.tickets
      set cliente_id = v_final_cliente_id,
          contacto_id = v_final_contacto_id,
          cliente_id_sugerido = null,
          contacto_id_sugerido = null,
          match_confirmado = true,
          contacto_confirmado = (v_final_contacto_id is not null),
          contacto_es_nuevo = v_created_contacto,
          requiere_consolidacion = false,
          consolidacion_version = consolidacion_version + 1
      where id = p_ticket_id;

  elsif p_action = 'discard_candidate' then
    update public.tickets
      set cliente_id_sugerido = null,
          contacto_id_sugerido = null,
          match_confirmado = false,
          contacto_confirmado = false,
          contacto_es_nuevo = false,
          requiere_consolidacion = false,
          consolidacion_version = consolidacion_version + 1
      where id = p_ticket_id;

  else
    update public.tickets
      set requiere_consolidacion = true,
          consolidacion_version = consolidacion_version + 1
      where id = p_ticket_id;
  end if;

  with latest as (
    select id
    from public.ticket_match_decisiones
    where ticket_id = p_ticket_id
    order by creado_en desc
    limit 1
  )
  update public.ticket_match_decisiones d
    set decision = v_decision,
        decidido_por = case
          when p_action = 'postpone' then d.decidido_por
          else v_actor
        end,
        decidido_en = case
          when p_action = 'postpone' then d.decidido_en
          else now()
        end,
        actualizado_en = now(),
        cliente_id_sugerido = case
          when p_action = 'postpone' then d.cliente_id_sugerido
          else v_final_cliente_id
        end,
        contacto_id_sugerido = case
          when p_action = 'postpone' then d.contacto_id_sugerido
          else v_final_contacto_id
        end,
        razones = coalesce(d.razones, '[]'::jsonb) ||
          jsonb_build_array(
            jsonb_build_object(
              'action', p_action,
              'operation_id', v_operation_id,
              'actor_id', v_actor,
              'at', now()
            )
          )
    where d.id in (select id from latest)
    returning d.id into v_decision_id;

  if v_decision_id is null then
    insert into public.ticket_match_decisiones (
      ticket_id,
      empresa_capturada,
      nombre_capturado,
      correo_capturado,
      telefono_capturado,
      cliente_id_sugerido,
      contacto_id_sugerido,
      decision,
      decidido_por,
      decidido_en,
      razones
    )
    values (
      p_ticket_id,
      v_ticket.empresa_capturada,
      v_ticket.nombre_capturado,
      v_ticket.correo_capturado,
      v_ticket.telefono_capturado,
      v_final_cliente_id,
      v_final_contacto_id,
      v_decision,
      case when p_action = 'postpone' then null else v_actor end,
      case when p_action = 'postpone' then null else now() end,
      jsonb_build_array(
        jsonb_build_object(
          'action', p_action,
          'operation_id', v_operation_id,
          'actor_id', v_actor,
          'at', now()
        )
      )
    )
    returning id into v_decision_id;
  end if;

  insert into public.ticket_eventos (
    ticket_id,
    autor_tipo,
    visibilidad,
    kind,
    texto,
    created_by,
    meta
  )
  values (
    p_ticket_id,
    'sistema',
    'interna',
    'sistema',
    'Decisión de consolidación registrada',
    v_actor,
    jsonb_build_object(
      'event', 'ticket_consolidation',
      'action', p_action,
      'operation_id', v_operation_id,
      'idempotency_key', trim(p_idempotency_key),
      'cliente_id', v_final_cliente_id,
      'contacto_id', v_final_contacto_id,
      'previous_version', v_ticket.consolidacion_version,
      'new_version', v_ticket.consolidacion_version + 1
    )
  );

  insert into public.bitacora (
    usuario_id,
    accion,
    documento_id,
    cliente_id,
    detalle,
    visibilidad,
    tipo
  )
  values (
    v_actor,
    'ticket_consolidacion',
    v_ticket.documento_id,
    v_final_cliente_id,
    jsonb_build_object(
      'ticket_id', p_ticket_id,
      'action', p_action,
      'operation_id', v_operation_id,
      'idempotency_key', trim(p_idempotency_key),
      'decision_id', v_decision_id,
      'cliente_id', v_final_cliente_id,
      'contacto_id', v_final_contacto_id,
      'previous_version', v_ticket.consolidacion_version,
      'new_version', v_ticket.consolidacion_version + 1
    ),
    'interna',
    'nota_interna'
  );

  v_response := jsonb_build_object(
    'ok', true,
    'status', 200,
    'code', 'CONSOLIDATION_COMPLETED',
    'replayed', false,
    'operation_id', v_operation_id,
    'ticket_id', p_ticket_id,
    'action', p_action,
    'cliente_id', v_final_cliente_id,
    'contacto_id', v_final_contacto_id,
    'decision_id', v_decision_id,
    'ticket_version', v_ticket.consolidacion_version + 1
  );

  update public.edge_idempotency
    set status = 'completed',
        response = v_response,
        error = null,
        updated_at = now()
    where idempotency_key = trim(p_idempotency_key);

  return v_response;
end
$function$;

revoke execute on function public.tc_consolidar_cliente_ticket(uuid, text, bigint, text, uuid, uuid, jsonb, jsonb) from public;
revoke execute on function public.tc_consolidar_cliente_ticket(uuid, text, bigint, text, uuid, uuid, jsonb, jsonb) from anon;
grant execute on function public.tc_consolidar_cliente_ticket(uuid, text, bigint, text, uuid, uuid, jsonb, jsonb) to authenticated;
