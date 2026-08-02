-- TC-8166E-MT1-MEDIA-PIPELINE-LOCAL-01 · wagon 3
-- MEDIA-005 / MEDIA-010 / MEDIA-011 / MEDIA-012
begin;

create table public.autorizaciones_video (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  max_duracion_segundos numeric(8,3) not null check (max_duracion_segundos > 0 and max_duracion_segundos <= 30),
  permite_segundo_video boolean not null default false,
  motivo text not null check (length(trim(motivo)) between 3 and 500),
  autorizado_por uuid not null references public.perfiles(id) on delete restrict,
  creado_en timestamptz not null default now(),
  expira_en timestamptz not null,
  consumido_en timestamptz,
  consumido_por_adjunto uuid,
  check (expira_en > creado_en),
  check ((consumido_en is null) = (consumido_por_adjunto is null))
);

alter table public.adjuntos_ticket
  add column autorizacion_video_id uuid
  references public.autorizaciones_video(id) on delete restrict;
alter table public.autorizaciones_video
  add constraint autorizaciones_video_consumed_attachment_fk
  foreign key (consumido_por_adjunto) references public.adjuntos_ticket(id)
  on delete set null deferrable initially deferred;

create unique index ux_autorizacion_video_single_consumption
  on public.autorizaciones_video(consumido_por_adjunto)
  where consumido_por_adjunto is not null;
create index ix_autorizaciones_video_available
  on public.autorizaciones_video(ticket_id, expira_en)
  where consumido_en is null;

alter table public.autorizaciones_video enable row level security;
revoke all on public.autorizaciones_video from public, anon, authenticated;
grant all on public.autorizaciones_video to service_role;

create or replace function public.tc_claim_media_upload(
  p_ticket_id uuid,
  p_solicitud_id uuid,
  p_storage_path text,
  p_nombre_original text,
  p_mime_declarado text,
  p_mime_detectado text,
  p_tipo text,
  p_tamano_bytes bigint,
  p_checksum_sha256 text,
  p_duracion_segundos numeric,
  p_visibilidad text,
  p_idempotency_key text,
  p_request_hash text,
  p_origen text,
  p_subido_por uuid default null
)
returns table(adjunto_id uuid, canonical_storage_path text, created boolean)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_existing public.adjuntos_ticket%rowtype;
  v_id uuid := gen_random_uuid();
  v_video_count integer := 0;
  v_authorization public.autorizaciones_video%rowtype;
  v_job_type text;
begin
  if p_checksum_sha256 !~ '^[0-9a-f]{64}$'
     or p_request_hash !~ '^[0-9a-f]{64}$'
     or length(p_idempotency_key) not between 16 and 200
     or p_tipo not in ('image', 'pdf', 'video')
     or p_tamano_bytes <= 0
  then raise exception 'MEDIA_UPLOAD_CLAIM_INVALID'; end if;

  select * into v_existing
  from public.adjuntos_ticket
  where ticket_id = p_ticket_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> p_request_hash then
      raise exception 'TC_IDEMPOTENCY_KEY_REUSED';
    end if;
    return query select v_existing.id, v_existing.storage_path, false;
    return;
  end if;

  perform pg_advisory_xact_lock(pg_catalog.hashtextextended(p_ticket_id::text, 8166));

  if p_tipo = 'video' then
    if p_duracion_segundos is null or p_duracion_segundos <= 0 or p_duracion_segundos > 30 then
      raise exception 'MEDIA_VIDEO_DURATION_REJECTED';
    end if;
    select count(*) into v_video_count
    from public.adjuntos_ticket
    where ticket_id = p_ticket_id and tipo = 'video' and estado <> 'eliminado';

    if p_duracion_segundos > 15 or v_video_count >= 1 then
      select * into v_authorization
      from public.autorizaciones_video a
      where a.ticket_id = p_ticket_id
        and a.consumido_en is null
        and a.expira_en > now()
        and a.max_duracion_segundos >= p_duracion_segundos
        and (v_video_count = 0 or a.permite_segundo_video)
      order by a.expira_en, a.creado_en
      for update skip locked
      limit 1;
      if not found then raise exception 'MEDIA_VIDEO_AUTHORIZATION_REQUIRED'; end if;
    end if;
  elsif p_duracion_segundos is not null then
    raise exception 'MEDIA_NON_VIDEO_DURATION_FORBIDDEN';
  end if;

  insert into public.adjuntos_ticket(
    id, ticket_id, solicitud_id, storage_path, nombre_original,
    mime_declarado, mime_detectado, tipo, tamano_bytes, checksum_sha256,
    duracion_segundos, visibilidad, estado, idempotency_key, request_hash,
    origen, subido_por, autorizacion_video_id
  ) values (
    v_id, p_ticket_id, p_solicitud_id, p_storage_path, p_nombre_original,
    p_mime_declarado, p_mime_detectado, p_tipo, p_tamano_bytes, p_checksum_sha256,
    p_duracion_segundos, p_visibilidad, 'pendiente', p_idempotency_key, p_request_hash,
    p_origen, p_subido_por, v_authorization.id
  );

  if v_authorization.id is not null then
    update public.autorizaciones_video
    set consumido_en = now(), consumido_por_adjunto = v_id
    where id = v_authorization.id and consumido_en is null;
    if not found then raise exception 'MEDIA_VIDEO_AUTHORIZATION_RACE'; end if;
  end if;

  v_job_type := case p_tipo when 'image' then 'procesar_imagen' when 'pdf' then 'procesar_pdf' else 'procesar_video' end;
  insert into public.trabajos_adjuntos as queued_job(adjunto_id, tipo, source_checksum_sha256)
  values (v_id, v_job_type, p_checksum_sha256)
  on conflict on constraint trabajos_adjuntos_adjunto_id_tipo_version_source_checksum_s_key do nothing;

  return query select v_id, p_storage_path, true;
end
$function$;

create or replace function public.tc_abort_media_upload(
  p_adjunto_id uuid,
  p_request_hash text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare v_authorization uuid;
begin
  select autorizacion_video_id into v_authorization
  from public.adjuntos_ticket
  where id = p_adjunto_id and request_hash = p_request_hash and estado = 'pendiente'
  for update;
  if not found then return false; end if;
  delete from public.adjuntos_ticket where id = p_adjunto_id;
  if v_authorization is not null then
    update public.autorizaciones_video
    set consumido_en = null, consumido_por_adjunto = null
    where id = v_authorization and consumido_por_adjunto = p_adjunto_id;
  end if;
  return true;
end
$function$;

create or replace function public.tc_finalize_media_upload(
  p_adjunto_id uuid,
  p_request_hash text
)
returns boolean
language sql
security definer
set search_path = pg_catalog, public
as $function$
  update public.adjuntos_ticket
  set estado = 'procesando', actualizado_en = now()
  where id = p_adjunto_id and request_hash = p_request_hash and estado = 'pendiente'
  returning true
$function$;

revoke execute on function public.tc_claim_media_upload(uuid, uuid, text, text, text, text, text, bigint, text, numeric, text, text, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.tc_abort_media_upload(uuid, text) from public, anon, authenticated;
revoke execute on function public.tc_finalize_media_upload(uuid, text) from public, anon, authenticated;
grant execute on function public.tc_claim_media_upload(uuid, uuid, text, text, text, text, text, bigint, text, numeric, text, text, text, text, uuid) to service_role;
grant execute on function public.tc_abort_media_upload(uuid, text) to service_role;
grant execute on function public.tc_finalize_media_upload(uuid, text) to service_role;

commit;
