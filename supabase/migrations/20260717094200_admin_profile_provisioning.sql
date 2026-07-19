-- AUTHZ V2 · Canal administrativo confiable para perfiles. PREPARED_NOT_APPLIED.
-- Mantiene bloqueada la escritura de `rol` desde el navegador, pero permite el
-- aprovisionamiento server-side (service_role) y RPC admin. La decisión NO depende
-- solo del texto del JWT: se ancla también en el rol REAL de base (current_user).

create or replace function public.tc_prevent_rol_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_backend boolean := (select current_user) in
    ('service_role','postgres','supabase_admin','supabase_auth_admin');
begin
  -- Cambiar `rol` requiere: sesión backend (service_role/definer) O admin autenticado.
  if new.rol is distinct from old.rol and not (is_backend or public.tc_is_admin()) then
    raise exception 'No autorizado para cambiar rol' using errcode = '42501';
  end if;
  return new;
end
$$;

-- Trigger-only: CREATE OR REPLACE conserva ACL, pero se declara nuevamente
-- para que esta migración sea autocontenida y auditable.
revoke execute on function public.tc_prevent_rol_escalation()
  from public, anon, authenticated;

-- RPC admin: crear perfil (aprovisionamiento). Solo un admin autenticado puede llamar.
create or replace function public.admin_create_profile(p_id uuid, p_rol text, p_nombre text default null)
returns public.perfiles
language plpgsql
security definer
set search_path = public
as $$
declare row public.perfiles;
begin
  if not public.tc_is_admin() then
    raise exception 'Solo admin' using errcode = '42501';
  end if;
  if p_rol is null or p_rol <> all (array['admin','supervisor','ventas','soporte']) then
    raise exception 'rol inválido' using errcode = '22023';
  end if;
  insert into public.perfiles (id, rol, nombre, tema)
  values (p_id, p_rol, p_nombre, 'light')
  on conflict (id) do update set rol = excluded.rol, nombre = coalesce(excluded.nombre, public.perfiles.nombre)
  returning * into row;
  return row;
end
$$;

-- RPC admin: cambiar rol.
create or replace function public.admin_set_rol(p_id uuid, p_rol text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.tc_is_admin() then
    raise exception 'Solo admin' using errcode = '42501';
  end if;
  if p_rol is null or p_rol <> all (array['admin','supervisor','ventas','soporte']) then
    raise exception 'rol inválido' using errcode = '22023';
  end if;
  update public.perfiles set rol = p_rol where id = p_id;
end
$$;

-- RPC admin: desactivar acceso (rol NULL => sin acceso interno; getProfile() lo trata
-- como "sin acceso autorizado" y las funciones authz devuelven false).
create or replace function public.admin_disable_access(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.tc_is_admin() then
    raise exception 'Solo admin' using errcode = '42501';
  end if;
  update public.perfiles set rol = null where id = p_id;
end
$$;

-- Estas RPC solo son ejecutables por usuarios autenticados (gate interno = admin).
revoke execute on function public.admin_create_profile(uuid,text,text) from public, anon;
revoke execute on function public.admin_set_rol(uuid,text) from public, anon;
revoke execute on function public.admin_disable_access(uuid) from public, anon;
grant execute on function public.admin_create_profile(uuid,text,text) to authenticated;
grant execute on function public.admin_set_rol(uuid,text) to authenticated;
grant execute on function public.admin_disable_access(uuid) to authenticated;
