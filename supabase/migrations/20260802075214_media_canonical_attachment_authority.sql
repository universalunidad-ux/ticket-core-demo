-- TC-8166E-MT1-MEDIA-PIPELINE-LOCAL-01 · wagon 1
-- MEDIA-001 / TC-U064: additive canonical authority. Legacy tables remain
-- present and readable until the accumulated local E2E is green.
-- Rollback: compensating migration required after rows exist.
begin;

do $media_authority_dependencies$
begin
  if pg_catalog.to_regclass('public.tickets') is null
     or pg_catalog.to_regclass('public.archivos_ticket') is null
     or pg_catalog.to_regclass('public.ticket_archivos') is null
     or pg_catalog.to_regprocedure('public.tc_can_access_ticket(uuid)') is null
  then
    raise exception 'MEDIA_AUTHORITY_DEPENDENCY_MISSING' using errcode = '42P01';
  end if;
end
$media_authority_dependencies$;

create table public.adjuntos_ticket (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  solicitud_id uuid references public.solicitudes_soporte(id) on delete set null,
  bucket_id text not null default 'soporte_adjuntos'
    check (bucket_id = 'soporte_adjuntos'),
  storage_path text not null,
  nombre_original text not null,
  mime_declarado text not null,
  mime_detectado text not null,
  tipo text not null check (tipo in ('image', 'pdf', 'video')),
  tamano_bytes bigint not null check (tamano_bytes > 0),
  checksum_sha256 text not null check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  duracion_segundos numeric(8,3),
  visibilidad text not null default 'interna'
    check (visibilidad in ('publica', 'interna')),
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'procesando', 'listo', 'cuarentena', 'eliminado')),
  motivo_cuarentena text,
  idempotency_key text not null check (length(idempotency_key) between 16 and 200),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  origen text not null check (origen in ('solicitud', 'ticket', 'portal', 'interno', 'legacy')),
  subido_por uuid references public.perfiles(id) on delete set null,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  eliminado_en timestamptz,
  meta jsonb not null default '{}'::jsonb,
  unique (bucket_id, storage_path),
  unique (ticket_id, idempotency_key),
  check (storage_path !~* '^https?://'),
  check (storage_path ~ '^[0-9a-fA-F-]{36}/[^/].+$'),
  check ((tipo = 'video') = (duracion_segundos is not null)),
  check (duracion_segundos is null or duracion_segundos > 0),
  check ((estado = 'cuarentena') = (motivo_cuarentena is not null)),
  check ((estado = 'eliminado') = (eliminado_en is not null)),
  check (app_private.audit_detail_is_safe(meta))
);

comment on table public.adjuntos_ticket is
  'MEDIA canonical metadata authority. Persist paths and checksums, never signed URLs.';
comment on table public.archivos_ticket is
  'LEGACY_READ_COMPATIBILITY: no new media writer may target this table after the MT1 cutover.';
comment on table public.ticket_archivos is
  'LEGACY_READ_COMPATIBILITY: preserved until accumulated media E2E is green; no new writers.';

create index ix_adjuntos_ticket_ticket_created
  on public.adjuntos_ticket(ticket_id, creado_en);
create index ix_adjuntos_ticket_ready
  on public.adjuntos_ticket(ticket_id, visibilidad, creado_en)
  where estado = 'listo';
create index ix_adjuntos_ticket_checksum
  on public.adjuntos_ticket(checksum_sha256);

alter table public.adjuntos_ticket enable row level security;
revoke all on table public.adjuntos_ticket from public, anon, authenticated;
grant select on table public.adjuntos_ticket to authenticated;
grant all on table public.adjuntos_ticket to service_role;

create policy adjuntos_ticket_staff_select
  on public.adjuntos_ticket for select to authenticated
  using ((select public.tc_can_access_ticket(ticket_id)));

create policy adjuntos_ticket_client_select
  on public.adjuntos_ticket for select to authenticated
  using (
    estado = 'listo'
    and visibilidad = 'publica'
    and exists (
      select 1 from public.tickets t
      where t.id = adjuntos_ticket.ticket_id
        and t.cliente_id is not null
        and t.cliente_id = (select public.tc_current_client_id())
    )
  );

create view app_private.archivos_ticket_compat
with (security_invoker = true)
as
select
  a.id,
  a.ticket_id,
  a.solicitud_id,
  a.origen,
  a.visibilidad,
  a.nombre_original as nombre_archivo,
  a.storage_path,
  null::text as url_firma,
  a.mime_detectado as mime_type,
  a.tamano_bytes,
  a.subido_por,
  a.creado_en,
  a.meta || jsonb_build_object(
    'canonical_authority', 'adjuntos_ticket',
    'checksum_sha256', a.checksum_sha256,
    'estado', a.estado
  ) as meta
from public.adjuntos_ticket a
where a.estado <> 'eliminado';

revoke all on app_private.archivos_ticket_compat from public, anon, authenticated;
grant select on app_private.archivos_ticket_compat to service_role;

do $verify_media_authority$
begin
  if pg_catalog.to_regclass('public.adjuntos_ticket') is null
     or pg_catalog.to_regclass('app_private.archivos_ticket_compat') is null
  then
    raise exception 'MEDIA_AUTHORITY_VERIFY_MISSING';
  end if;
  if not pg_catalog.has_table_privilege('service_role', 'public.adjuntos_ticket', 'INSERT')
     or pg_catalog.has_table_privilege('authenticated', 'public.adjuntos_ticket', 'INSERT')
     or pg_catalog.has_table_privilege('anon', 'public.adjuntos_ticket', 'SELECT')
  then
    raise exception 'MEDIA_AUTHORITY_VERIFY_ACL';
  end if;
end
$verify_media_authority$;

commit;
