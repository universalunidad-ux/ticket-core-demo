-- Ticket Core staging baseline 0012.
-- Preconditions: public.archivos_ticket is canonical and populated only with storage paths.
-- Rollback: COMPENSATING_MIGRATION_REQUIRED; legacy data is never dropped here.
begin;

create table public.ticket_archivos (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  nombre_archivo text not null,
  url_archivo text not null,
  mime_type text,
  subido_por uuid references public.perfiles(id) on delete set null,
  fecha_subida timestamptz not null default now(),
  tamano_bytes bigint,
  storage_path text,
  migrated_to_archivo_id uuid references public.archivos_ticket(id) on delete set null,
  migration_status text not null default 'pending'
    check (migration_status in ('pending', 'migrated', 'duplicate', 'invalid_signed_url', 'invalid_path'))
);

update public.ticket_archivos
set storage_path = url_archivo,
    migration_status = 'pending'
where storage_path is null
  and nullif(trim(url_archivo), '') is not null
  and url_archivo !~* '^https?://'
  and url_archivo ~ '^[0-9a-fA-F-]{36}/[^/].+$';

update public.ticket_archivos
set migration_status = case
  when url_archivo ~* '^https?://' then 'invalid_signed_url'
  else 'invalid_path'
end
where storage_path is null
  and migration_status = 'pending';

insert into public.archivos_ticket(
  ticket_id, origen, visibilidad, nombre_archivo, storage_path,
  mime_type, tamano_bytes, subido_por, creado_en, meta
)
select
  legacy.ticket_id,
  'legacy',
  'interna',
  legacy.nombre_archivo,
  legacy.storage_path,
  legacy.mime_type,
  legacy.tamano_bytes,
  legacy.subido_por,
  legacy.fecha_subida,
  jsonb_build_object('migrated_from', 'ticket_archivos', 'legacy_id', legacy.id)
from public.ticket_archivos legacy
where legacy.storage_path is not null
on conflict (ticket_id, storage_path) do nothing;

update public.ticket_archivos legacy
set migrated_to_archivo_id = canonical.id,
    migration_status = case
      when canonical.meta ->> 'legacy_id' = legacy.id::text then 'migrated'
      else 'duplicate'
    end
from public.archivos_ticket canonical
where canonical.ticket_id = legacy.ticket_id
  and canonical.storage_path = legacy.storage_path
  and legacy.storage_path is not null;

create view app_private.ticket_archivos_reconciliation
with (security_invoker = true)
as
select
  legacy.id as legacy_id,
  legacy.ticket_id,
  legacy.storage_path,
  legacy.migration_status,
  legacy.migrated_to_archivo_id,
  case
    when legacy.migration_status = 'invalid_signed_url' then 'durable_or_signed_url_requires_manual_path_recovery'
    when legacy.migration_status = 'invalid_path' then 'not_a_canonical_storage_path'
    when legacy.migrated_to_archivo_id is null then 'canonical_row_missing'
    else null
  end as orphan_reason
from public.ticket_archivos legacy;

alter table public.ticket_archivos enable row level security;
revoke all on table public.ticket_archivos from public, anon, authenticated;
grant all on table public.ticket_archivos to service_role;
grant select on table public.ticket_archivos to authenticated;

create policy ticket_archivos_admin_read on public.ticket_archivos
for select to authenticated
using (app_private.has_role(array['admin']));

create policy ticket_archivos_support_read on public.ticket_archivos
for select to authenticated
using (app_private.has_role(array['soporte']) and exists (
  select 1 from public.tickets t
  where t.id = ticket_archivos.ticket_id and t.asignado_a = (select auth.uid())
));

create index ix_ticket_archivos_ticket on public.ticket_archivos(ticket_id);
create index ix_ticket_archivos_subido_por on public.ticket_archivos(subido_por);
create index ix_ticket_archivos_migrated_to on public.ticket_archivos(migrated_to_archivo_id);

revoke all on app_private.ticket_archivos_reconciliation from public, anon, authenticated;
grant select on app_private.ticket_archivos_reconciliation to service_role;

comment on table public.ticket_archivos is
  'LEGACY_TRANSITION: read/reconcile only. No new writes after Edge cutover; never drop in this baseline.';

commit;
