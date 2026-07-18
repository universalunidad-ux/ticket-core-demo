-- STORAGE V2 · Contrato privado para adjuntos. PREPARED_NOT_APPLIED. Aditiva.
-- MIME alineado al contrato REAL de la UI (imágenes + video + PDF; sin zip/xml/excel).

-- 1) Buckets privados: crear si faltan (INSERT ... ON CONFLICT) con límites y MIME.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('soporte_adjuntos','soporte_adjuntos', false, 41943040, array[
  'image/jpeg','image/png','image/webp','image/heic','image/heif',
  'video/mp4','video/quicktime','video/x-m4v','application/pdf'
])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('certificados','certificados', false, 20971520, array['application/pdf'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- 2) RLS de objetos. anon: sin policy => denegado. Escritura: solo service_role.
alter table storage.objects enable row level security;

-- Lectura de adjuntos: staff con alcance al ticket (la 1ª carpeta del path = ticket.id,
-- exactamente como sube el Edge: `${ticket.id}/...`).
drop policy if exists soporte_adjuntos_staff_read on storage.objects;
create policy soporte_adjuntos_staff_read
  on storage.objects for select to authenticated
  using (
    bucket_id = 'soporte_adjuntos'
    and exists (
      select 1 from public.tickets t
      where t.id::text = split_part(name, '/', 1)
        and (public.tc_is_manager() or t.asignado_a = (select auth.uid()))
    )
  );

drop policy if exists certificados_staff_read on storage.objects;
create policy certificados_staff_read
  on storage.objects for select to authenticated
  using (bucket_id = 'certificados' and public.is_internal_user());

-- 3) Detección de huérfanos (solo lectura). La ELIMINACIÓN se hace vía Storage API
--    remove() desde la Edge Function support-orphan-cleanup / job admin: borrar de
--    storage.objects NO elimina el archivo físico, por eso NO se hace en SQL.
create or replace view public.v_support_orphan_objects as
  select o.name as storage_path, o.created_at
  from storage.objects o
  where o.bucket_id = 'soporte_adjuntos'
    and not exists (select 1 from public.solicitud_archivos sa where sa.storage_path = o.name)
    and not exists (select 1 from public.archivos_ticket a where a.storage_path = o.name);
revoke all on public.v_support_orphan_objects from anon, authenticated;

-- 4) Retirar el borrado directo previo (no elimina el archivo físico real).
drop function if exists public.tc_delete_orphan_support_files(interval);
