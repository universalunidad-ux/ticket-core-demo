-- MEDIA-010 / MEDIA-011 / MEDIA-012
--
-- Completa de forma aditiva la política autoritativa de video.
-- No confía en el ordinal enviado por frontend:
-- el servidor lo calcula dentro de una transacción bloqueada por ticket.

create table if not exists public.autorizaciones_video (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null,
  tipo text not null,
  segundos_max integer not null,
  motivo text not null,
  creada_por uuid,
  creada_en timestamptz not null default clock_timestamp(),
  expira_en timestamptz not null,
  revocada_en timestamptz,
  consumida_en timestamptz,
  consumida_por_adjunto_id uuid
);

alter table public.autorizaciones_video
  add column if not exists id uuid
    default gen_random_uuid();

alter table public.autorizaciones_video
  add column if not exists ticket_id uuid;

alter table public.autorizaciones_video
  add column if not exists tipo text;

alter table public.autorizaciones_video
  add column if not exists segundos_max integer;

alter table public.autorizaciones_video
  add column if not exists motivo text;

alter table public.autorizaciones_video
  add column if not exists creada_por uuid;

alter table public.autorizaciones_video
  add column if not exists creada_en timestamptz
    default clock_timestamp();

alter table public.autorizaciones_video
  add column if not exists expira_en timestamptz;

alter table public.autorizaciones_video
  add column if not exists revocada_en timestamptz;

alter table public.autorizaciones_video
  add column if not exists consumida_en timestamptz;

alter table public.autorizaciones_video
  add column if not exists consumida_por_adjunto_id uuid;

create table if not exists public.media_video_registro (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null,
  adjunto_id uuid not null,
  ordinal_servidor integer not null,
  duracion_ms integer not null,
  registrada_en timestamptz not null default clock_timestamp(),
  unique (adjunto_id),
  unique (ticket_id, ordinal_servidor)
);

create unique index if not exists
  uq_autorizaciones_video_abierta
on public.autorizaciones_video (
  ticket_id,
  tipo
)
where consumida_en is null
  and revocada_en is null;

create unique index if not exists
  uq_autorizacion_consumida_adjunto_tipo
on public.autorizaciones_video (
  consumida_por_adjunto_id,
  tipo
)
where consumida_por_adjunto_id is not null;

create index if not exists
  ix_media_video_registro_ticket
on public.media_video_registro (
  ticket_id,
  ordinal_servidor
);

alter table public.autorizaciones_video
  enable row level security;

alter table public.media_video_registro
  enable row level security;

revoke all
  on table public.autorizaciones_video
  from anon, authenticated;

revoke all
  on table public.media_video_registro
  from anon, authenticated;

create or replace function public.tc_media_otorgar_autorizacion(
  p_ticket_id uuid,
  p_tipo text,
  p_expira_en timestamptz,
  p_motivo text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_segundos_max integer;
  v_id uuid;
begin
  v_role := coalesce(
    auth.jwt() ->> 'app_role',
    auth.jwt() ->> 'role',
    ''
  );

  if v_role not in ('admin', 'service_role') then
    raise exception using
      errcode = '42501',
      message = 'E_MEDIA_AUTORIZACION_ADMIN_REQUERIDA';
  end if;

  if p_tipo = 'segundo_video_15s' then
    v_segundos_max := 15;
  elsif p_tipo = 'excepcion_30s' then
    v_segundos_max := 30;
  else
    raise exception using
      errcode = '22023',
      message = 'E_MEDIA_AUTORIZACION_TIPO_INVALIDO';
  end if;

  if p_expira_en <= clock_timestamp() then
    raise exception using
      errcode = '22023',
      message = 'E_MEDIA_AUTORIZACION_EXPIRACION_INVALIDA';
  end if;

  if length(btrim(p_motivo)) < 3 then
    raise exception using
      errcode = '22023',
      message = 'E_MEDIA_AUTORIZACION_MOTIVO_INVALIDO';
  end if;

  insert into public.autorizaciones_video (
    ticket_id,
    tipo,
    segundos_max,
    motivo,
    creada_por,
    expira_en
  )
  values (
    p_ticket_id,
    p_tipo,
    v_segundos_max,
    btrim(p_motivo),
    auth.uid(),
    p_expira_en
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.tc_media_consumir_autorizacion(
  p_ticket_id uuid,
  p_adjunto_id uuid,
  p_tipo text
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_segundos_max integer;
begin
  with candidata as (
    select id
    from public.autorizaciones_video
    where ticket_id = p_ticket_id
      and tipo = p_tipo
      and consumida_en is null
      and revocada_en is null
      and expira_en > clock_timestamp()
    order by creada_en, id
    for update skip locked
    limit 1
  )
  update public.autorizaciones_video autorizacion
  set
    consumida_en = clock_timestamp(),
    consumida_por_adjunto_id = p_adjunto_id
  from candidata
  where autorizacion.id = candidata.id
    and autorizacion.consumida_en is null
    and autorizacion.revocada_en is null
  returning autorizacion.segundos_max
    into v_segundos_max;

  if v_segundos_max is null then
    raise exception using
      errcode = 'P0001',
      message = 'E_MEDIA_AUTORIZACION_NO_DISPONIBLE';
  end if;

  return v_segundos_max;
end;
$$;

create or replace function public.tc_media_validar_duracion(
  p_ticket_id uuid,
  p_adjunto_id uuid,
  p_duracion_ms integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ordinal integer;
  v_limite integer;
begin
  if p_duracion_ms <= 0 then
    raise exception using
      errcode = '22023',
      message = 'E_MEDIA_VIDEO_INPUT_INVALIDO';
  end if;

  -- Debe ocurrir antes de consumir cualquier autorización.
  if p_duracion_ms > 30000 then
    raise exception using
      errcode = '22023',
      message = 'E_MEDIA_DURACION_EXCEDIDA';
  end if;

  -- Serializa todos los registros de video del mismo ticket.
  perform pg_advisory_xact_lock(
    hashtextextended(
      p_ticket_id::text,
      18264011
    )
  );

  select count(*)::integer + 1
    into v_ordinal
  from public.media_video_registro
  where ticket_id = p_ticket_id;

  if v_ordinal > 1 then
    v_limite :=
      public.tc_media_consumir_autorizacion(
        p_ticket_id,
        p_adjunto_id,
        'segundo_video_15s'
      );

    if v_limite <> 15 then
      raise exception using
        errcode = 'P0001',
        message = 'E_MEDIA_AUTORIZACION_LIMITE_INVALIDO';
    end if;
  end if;

  if p_duracion_ms > 15000 then
    v_limite :=
      public.tc_media_consumir_autorizacion(
        p_ticket_id,
        p_adjunto_id,
        'excepcion_30s'
      );

    if v_limite <> 30 then
      raise exception using
        errcode = 'P0001',
        message = 'E_MEDIA_AUTORIZACION_LIMITE_INVALIDO';
    end if;
  end if;

  insert into public.media_video_registro (
    ticket_id,
    adjunto_id,
    ordinal_servidor,
    duracion_ms
  )
  values (
    p_ticket_id,
    p_adjunto_id,
    v_ordinal,
    p_duracion_ms
  );

  return jsonb_build_object(
    'accepted', true,
    'server_video_ordinal', v_ordinal,
    'duration_ms', p_duracion_ms,
    'maximum_duration_ms',
      case
        when p_duracion_ms > 15000 then 30000
        else 15000
      end
  );
end;
$$;

create or replace function public.tc_media_revocar_autorizacion(
  p_autorizacion_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
begin
  v_role := coalesce(
    auth.jwt() ->> 'app_role',
    auth.jwt() ->> 'role',
    ''
  );

  if v_role not in ('admin', 'service_role') then
    raise exception using
      errcode = '42501',
      message = 'E_MEDIA_AUTORIZACION_ADMIN_REQUERIDA';
  end if;

  update public.autorizaciones_video
  set revocada_en = clock_timestamp()
  where id = p_autorizacion_id
    and consumida_en is null
    and revocada_en is null;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'E_MEDIA_AUTORIZACION_NO_REVOCABLE';
  end if;
end;
$$;

revoke all
  on function public.tc_media_otorgar_autorizacion(
    uuid,
    text,
    timestamptz,
    text
  )
  from public, anon, authenticated;

revoke all
  on function public.tc_media_consumir_autorizacion(
    uuid,
    uuid,
    text
  )
  from public, anon;

revoke all
  on function public.tc_media_validar_duracion(
    uuid,
    uuid,
    integer
  )
  from public, anon;

revoke all
  on function public.tc_media_revocar_autorizacion(uuid)
  from public, anon, authenticated;

grant execute
  on function public.tc_media_consumir_autorizacion(
    uuid,
    uuid,
    text
  )
  to authenticated, service_role;

grant execute
  on function public.tc_media_validar_duracion(
    uuid,
    uuid,
    integer
  )
  to authenticated, service_role;

grant execute
  on function public.tc_media_otorgar_autorizacion(
    uuid,
    text,
    timestamptz,
    text
  )
  to service_role;

grant execute
  on function public.tc_media_revocar_autorizacion(uuid)
  to service_role;
