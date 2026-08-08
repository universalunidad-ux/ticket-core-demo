-- TC-8166E-MT1-MEDIA-PIPELINE-LOCAL-01 · wagon 2
-- MEDIA-002 / MEDIA-003 / MEDIA-004 / MEDIA-006
begin;

create table public.derivados_adjuntos (
  id uuid primary key default gen_random_uuid(),
  adjunto_id uuid not null references public.adjuntos_ticket(id) on delete cascade,
  tipo text not null check (tipo in ('review_webp', 'thumbnail_webp', 'pdf_poster_webp', 'video_proxy_720p', 'video_poster_webp', 'video_contact_sheet_webp')),
  version text not null default 'media-worker/v1',
  bucket_id text not null default 'soporte_adjuntos' check (bucket_id = 'soporte_adjuntos'),
  storage_path text not null,
  mime_type text not null,
  tamano_bytes bigint not null check (tamano_bytes > 0),
  checksum_sha256 text not null check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  source_checksum_sha256 text not null check (source_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  ancho integer check (ancho is null or ancho > 0),
  alto integer check (alto is null or alto > 0),
  creado_en timestamptz not null default now(),
  unique (adjunto_id, tipo, version, source_checksum_sha256),
  unique (bucket_id, storage_path),
  check (storage_path !~* '^https?://')
);

create table public.trabajos_adjuntos (
  id uuid primary key default gen_random_uuid(),
  adjunto_id uuid not null references public.adjuntos_ticket(id) on delete cascade,
  tipo text not null check (tipo in ('procesar_imagen', 'procesar_pdf', 'procesar_video', 'verificar_checksum', 'eliminar')),
  version text not null default 'media-worker/v1',
  source_checksum_sha256 text not null check (source_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'ejecutando', 'completado', 'fallido', 'muerto')),
  intentos integer not null default 0 check (intentos between 0 and 12),
  max_intentos integer not null default 5 check (max_intentos between 1 and 12),
  disponible_en timestamptz not null default now(),
  lease_token uuid,
  lease_expira_en timestamptz,
  ultimo_error_codigo text,
  ultimo_error_detalle text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  completado_en timestamptz,
  unique (adjunto_id, tipo, version, source_checksum_sha256),
  check ((estado = 'ejecutando') = (lease_token is not null and lease_expira_en is not null)),
  check (estado <> 'completado' or completado_en is not null)
);

create index ix_trabajos_adjuntos_claim
  on public.trabajos_adjuntos(disponible_en, creado_en)
  where estado in ('pendiente', 'fallido');

alter table public.derivados_adjuntos enable row level security;
alter table public.trabajos_adjuntos enable row level security;
revoke all on public.derivados_adjuntos, public.trabajos_adjuntos from public, anon, authenticated;
grant select on public.derivados_adjuntos to authenticated;
grant all on public.derivados_adjuntos, public.trabajos_adjuntos to service_role;

create policy derivados_adjuntos_ticket_select
  on public.derivados_adjuntos for select to authenticated
  using (exists (
    select 1 from public.adjuntos_ticket a
    where a.id = derivados_adjuntos.adjunto_id
      and a.estado = 'listo'
      and (select public.tc_can_access_ticket(a.ticket_id))
  ));

create or replace function app_private.tc_claim_media_job(
  p_worker_id text,
  p_lease_seconds integer default 120
)
returns table (
  job_id uuid,
  lease_token uuid,
  adjunto_id uuid,
  tipo text,
  version text,
  source_checksum_sha256 text,
  intentos integer
)
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_job public.trabajos_adjuntos%rowtype;
  v_token uuid := gen_random_uuid();
begin
  if nullif(trim(p_worker_id), '') is null or p_lease_seconds not between 15 and 900 then
    raise exception 'MEDIA_JOB_CLAIM_INVALID';
  end if;

  select * into v_job
  from public.trabajos_adjuntos j
  where (
      j.estado in ('pendiente', 'fallido') and j.disponible_en <= now()
    ) or (
      j.estado = 'ejecutando' and j.lease_expira_en < now()
    )
  order by j.creado_en
  for update skip locked
  limit 1;

  if not found then return; end if;

  update public.trabajos_adjuntos j
  set estado = 'ejecutando',
      intentos = j.intentos + 1,
      lease_token = v_token,
      lease_expira_en = now() + make_interval(secs => p_lease_seconds),
      actualizado_en = now(),
      ultimo_error_codigo = null,
      ultimo_error_detalle = null
  where j.id = v_job.id
  returning j.id, j.lease_token, j.adjunto_id, j.tipo, j.version,
            j.source_checksum_sha256, j.intentos
  into job_id, lease_token, adjunto_id, tipo, version,
       source_checksum_sha256, intentos;
  return next;
end
$function$;

create or replace function app_private.tc_complete_media_job(
  p_job_id uuid,
  p_lease_token uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
begin
  update public.trabajos_adjuntos
  set estado = 'completado', lease_token = null, lease_expira_en = null,
      completado_en = now(), actualizado_en = now()
  where id = p_job_id and estado = 'ejecutando' and lease_token = p_lease_token;
  if not found then raise exception 'MEDIA_JOB_LEASE_MISMATCH'; end if;
end
$function$;

create or replace function app_private.tc_fail_media_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_error_code text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
begin
  update public.trabajos_adjuntos
  set estado = case when intentos >= max_intentos then 'muerto' else 'fallido' end,
      disponible_en = now() + make_interval(secs => least(3600, 5 * (2 ^ greatest(intentos - 1, 0))::integer)),
      lease_token = null, lease_expira_en = null,
      ultimo_error_codigo = left(coalesce(p_error_code, 'MEDIA_WORKER_ERROR'), 120),
      actualizado_en = now()
  where id = p_job_id and estado = 'ejecutando' and lease_token = p_lease_token;
  if not found then raise exception 'MEDIA_JOB_LEASE_MISMATCH'; end if;
end
$function$;

revoke execute on function app_private.tc_claim_media_job(text, integer) from public, anon, authenticated;
revoke execute on function app_private.tc_complete_media_job(uuid, uuid) from public, anon, authenticated;
revoke execute on function app_private.tc_fail_media_job(uuid, uuid, text) from public, anon, authenticated;
grant execute on function app_private.tc_claim_media_job(text, integer) to service_role;
grant execute on function app_private.tc_complete_media_job(uuid, uuid) to service_role;
grant execute on function app_private.tc_fail_media_job(uuid, uuid, text) to service_role;

commit;
