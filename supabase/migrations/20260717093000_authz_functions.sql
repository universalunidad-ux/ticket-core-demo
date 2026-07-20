-- AUTHZ U4 · Funciones de autorización con search_path fijo (SECURITY DEFINER).
-- PREPARED_NOT_APPLIED: revisar en staging antes de aplicar. Aditiva/idempotente.
set check_function_bodies = off;

-- Rol del usuario actual (bypassa RLS de perfiles por ser SECURITY DEFINER).
create or replace function public.tc_current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.rol from public.perfiles p where p.id = (select auth.uid())
$$;

create or replace function public.tc_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.tc_current_role() = 'admin', false)
$$;

create or replace function public.tc_is_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.tc_current_role() = any (array['admin','supervisor']), false)
$$;

create or replace function public.is_internal_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.perfiles p
    where p.id = (select auth.uid())
      and p.rol = any (array['admin','supervisor','soporte','ventas'])
  )
$$;

-- Ejecutable por usuarios autenticados; nunca por anon.
revoke execute on function public.tc_current_role() from public, anon;
revoke execute on function public.tc_is_admin() from public, anon;
revoke execute on function public.tc_is_manager() from public, anon;
revoke execute on function public.is_internal_user() from public, anon;
grant execute on function public.tc_current_role() to authenticated;
grant execute on function public.tc_is_admin() to authenticated;
grant execute on function public.tc_is_manager() to authenticated;
grant execute on function public.is_internal_user() to authenticated;
