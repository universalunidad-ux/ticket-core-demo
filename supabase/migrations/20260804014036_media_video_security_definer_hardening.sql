-- MEDIA-010 / MEDIA-011 / MEDIA-012
--
-- Endurecimiento posterior de las funciones SECURITY DEFINER.
-- Todas las referencias de tablas y funciones propias ya están calificadas
-- por esquema; pg_catalog cubre los built-ins utilizados.

begin;

alter function public.tc_media_otorgar_autorizacion(
  uuid,
  text,
  timestamptz,
  text
)
set search_path to pg_catalog, public;

alter function public.tc_media_consumir_autorizacion(
  uuid,
  uuid,
  text
)
set search_path to pg_catalog, public;

alter function public.tc_media_validar_duracion(
  uuid,
  uuid,
  integer
)
set search_path to pg_catalog, public;

alter function public.tc_media_revocar_autorizacion(
  uuid
)
set search_path to pg_catalog, public;

-- Reconstruir ACL de forma explícita y determinista.

revoke all
on function public.tc_media_otorgar_autorizacion(
  uuid,
  text,
  timestamptz,
  text
)
from public, anon, authenticated, service_role;

grant execute
on function public.tc_media_otorgar_autorizacion(
  uuid,
  text,
  timestamptz,
  text
)
to service_role;

revoke all
on function public.tc_media_consumir_autorizacion(
  uuid,
  uuid,
  text
)
from public, anon, authenticated, service_role;

grant execute
on function public.tc_media_consumir_autorizacion(
  uuid,
  uuid,
  text
)
to authenticated, service_role;

revoke all
on function public.tc_media_validar_duracion(
  uuid,
  uuid,
  integer
)
from public, anon, authenticated, service_role;

grant execute
on function public.tc_media_validar_duracion(
  uuid,
  uuid,
  integer
)
to authenticated, service_role;

revoke all
on function public.tc_media_revocar_autorizacion(
  uuid
)
from public, anon, authenticated, service_role;

grant execute
on function public.tc_media_revocar_autorizacion(
  uuid
)
to service_role;

commit;
