-- AUTHZ U4 · perfiles: RLS + bloqueo de auto-escalada de `rol`.
-- PREPARED_NOT_APPLIED. Aditiva/idempotente.

-- Dominio canónico del rol interno.
-- NULL representa acceso desactivado; no concede privilegios.
alter table public.perfiles
  alter column rol drop not null;
alter table public.perfiles
  drop constraint if exists perfiles_rol_check;
alter table public.perfiles
  add constraint perfiles_rol_check
  check (
    rol is null
    or rol = any (
      array[
        'admin'::text,
        'supervisor'::text,
        'ventas'::text,
        'soporte'::text
      ]
    )
  );

alter table public.perfiles enable row level security;

-- Trigger: solo un admin puede cambiar `rol`. Un usuario no puede escalar su rol
-- ni el de otros desde el Data API (publishable/authenticated).
create or replace function public.tc_prevent_rol_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.rol is distinct from old.rol and not public.tc_is_admin() then
    raise exception 'No autorizado para cambiar rol' using errcode = '42501';
  end if;
  return new;
end
$$;

drop trigger if exists trg_perfiles_rol_lock on public.perfiles;
create trigger trg_perfiles_rol_lock
  before update on public.perfiles
  for each row execute function public.tc_prevent_rol_escalation();

-- Lectura: el propio perfil o cualquiera si admin.
drop policy if exists perfiles_select_self on public.perfiles;
create policy perfiles_select_self
  on public.perfiles for select to authenticated
  using (id = (select auth.uid()) or public.tc_is_admin());

-- Update: propio perfil (el cambio de rol lo bloquea el trigger) o admin.
drop policy if exists perfiles_update_self on public.perfiles;
create policy perfiles_update_self
  on public.perfiles for update to authenticated
  using (id = (select auth.uid()) or public.tc_is_admin())
  with check (id = (select auth.uid()) or public.tc_is_admin());

-- Sin policy de INSERT/DELETE para authenticated/anon => denegado.
-- El aprovisionamiento de perfiles ocurre server-side (service_role bypassa RLS).
