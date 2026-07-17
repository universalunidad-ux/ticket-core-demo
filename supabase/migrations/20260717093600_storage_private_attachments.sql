-- STORAGE U5 · Contrato privado para adjuntos (soporte_adjuntos, certificados).
-- PREPARED_NOT_APPLIED. Aditiva/idempotente. Revisar en staging.

-- 1) Buckets privados con límite de tamaño y MIME allowlist (sin SVG/HTML ejecutable).
update storage.buckets
set public = false,
    file_size_limit = 20971520, -- 20 MB por archivo (coincide con el Edge)
    allowed_mime_types = array[
      'image/jpeg','image/png','image/webp','application/pdf',
      'text/xml','application/xml','application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv','text/plain','application/zip','application/x-zip-compressed'
    ]
where id in ('soporte_adjuntos','certificados');

-- 2) RLS de objetos. anon: sin policy => denegado. Escrituras: solo service_role
--    (el Edge sube con service_role); authenticated no inserta/borra directamente.
alter table storage.objects enable row level security;

-- Lectura de adjuntos de soporte: staff con alcance al ticket (carpeta = ticket.id).
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

-- Lectura de certificados: usuarios internos (permite createSignedUrl server-side).
drop policy if exists certificados_staff_read on storage.objects;
create policy certificados_staff_read
  on storage.objects for select to authenticated
  using (bucket_id = 'certificados' and public.is_internal_user());

-- 3) Compensación de huérfanos: elimina objetos de soporte_adjuntos sin metadata
--    asociada (ticket insert falló tras subir). DESTRUCTIVA: ejecutar en staging o
--    vía tarea programada supervisada. SECURITY DEFINER con search_path fijo.
create or replace function public.tc_delete_orphan_support_files(older_than interval default interval '24 hours')
returns integer
language plpgsql
security definer
set search_path = public, storage
as $$
declare deleted int;
begin
  with orphans as (
    select o.id from storage.objects o
    where o.bucket_id = 'soporte_adjuntos'
      and o.created_at < now() - older_than
      and not exists (select 1 from public.solicitud_archivos sa where sa.storage_path = o.name)
      and not exists (select 1 from public.archivos_ticket at where at.storage_path = o.name)
  )
  delete from storage.objects o using orphans x where o.id = x.id;
  get diagnostics deleted = row_count;
  return deleted;
end
$$;
revoke execute on function public.tc_delete_orphan_support_files(interval) from public, anon, authenticated;
