-- Ticket Core staging baseline 0006.
-- Preconditions: storage extension schema and tickets exist.
-- Rollback: COMPENSATING_MIGRATION_REQUIRED once objects exist.
begin;

create table public.archivos_ticket (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  solicitud_id uuid references public.solicitudes_soporte(id) on delete set null,
  origen text not null check (origen in ('solicitud', 'ticket', 'portal', 'interno', 'legacy')),
  visibilidad text not null default 'interna' check (visibilidad in ('publica', 'interna')),
  nombre_archivo text not null,
  storage_path text not null,
  mime_type text,
  tamano_bytes bigint check (tamano_bytes is null or tamano_bytes > 0),
  subido_por uuid references public.perfiles(id) on delete set null,
  creado_en timestamptz not null default now(),
  meta jsonb not null default '{}'::jsonb,
  unique (ticket_id, storage_path),
  check (storage_path !~* '^https?://'),
  check (storage_path ~ '^[0-9a-fA-F-]{36}/[^/].+$'),
  check (app_private.audit_detail_is_safe(meta))
);

comment on table public.archivos_ticket is
  'Canonical attachment metadata. Durable signed URLs are forbidden; only storage_path is persisted.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'soporte_adjuntos',
  'soporte_adjuntos',
  false,
  20971520,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/heic',
    'application/pdf', 'video/mp4', 'video/webm', 'video/quicktime'
  ]
);

commit;
