-- TC-RLS-ROLE-ESCALATION-FIX-01
--
-- Corrige owner confusion en tc_prevent_rol_escalation():
-- una función SECURITY DEFINER no puede usar current_user como identidad
-- del llamador, porque current_user se convierte en el owner de la función.
--
-- Autoridades permitidas:
--   1. service_role acreditado por la claim verificada de Supabase;
--   2. usuario autenticado cuyo perfil canónico sea admin.
--
-- No concede autoridad a postgres, supabase_admin ni session_user.

create or replace function public.tc_prevent_rol_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $tc_role_guard$
declare
  caller_is_service_role boolean :=
    coalesce(
      (select auth.role()) = 'service_role',
      false
    );
begin
  if new.rol is distinct from old.rol
     and not (
       caller_is_service_role
       or public.tc_is_admin()
     )
  then
    raise exception
      'No autorizado para cambiar rol'
      using errcode = '42501';
  end if;

  return new;
end
$tc_role_guard$;

revoke all
on function public.tc_prevent_rol_escalation()
from public, anon, authenticated;

do $tc_verify_role_guard$
declare
  function_definition text;
  function_is_security_definer boolean;
  function_config text[];
begin
  select
    pg_catalog.pg_get_functiondef(proc.oid),
    proc.prosecdef,
    proc.proconfig
  into
    function_definition,
    function_is_security_definer,
    function_config
  from pg_catalog.pg_proc proc
  join pg_catalog.pg_namespace namespace
    on namespace.oid = proc.pronamespace
  where namespace.nspname = 'public'
    and proc.proname = 'tc_prevent_rol_escalation'
    and pg_catalog.pg_get_function_identity_arguments(
      proc.oid
    ) = '';

  if function_definition is null then
    raise exception
      'TC_ROLE_GUARD_VERIFY_MISSING';
  end if;

  if not function_is_security_definer then
    raise exception
      'TC_ROLE_GUARD_VERIFY_NOT_SECURITY_DEFINER';
  end if;

  if not (
    coalesce(function_config, array[]::text[])
    @> array['search_path=public']::text[]
  ) then
    raise exception
      'TC_ROLE_GUARD_VERIFY_SEARCH_PATH';
  end if;

  if function_definition ~*
     '(^|[^a-z_])(current_user|session_user)([^a-z_]|$)'
  then
    raise exception
      'TC_ROLE_GUARD_VERIFY_CALLER_IDENTITY_CONFUSION';
  end if;

  if position(
    'auth.role()'
    in lower(function_definition)
  ) = 0 then
    raise exception
      'TC_ROLE_GUARD_VERIFY_SERVICE_ROLE_SOURCE';
  end if;

  if position(
    'service_role'
    in lower(function_definition)
  ) = 0 then
    raise exception
      'TC_ROLE_GUARD_VERIFY_SERVICE_ROLE_MISSING';
  end if;

  if position(
    'public.tc_is_admin()'
    in lower(function_definition)
  ) = 0 then
    raise exception
      'TC_ROLE_GUARD_VERIFY_ADMIN_GATE_MISSING';
  end if;

  if position(
    '42501'
    in function_definition
  ) = 0 then
    raise exception
      'TC_ROLE_GUARD_VERIFY_SQLSTATE_MISSING';
  end if;
end
$tc_verify_role_guard$;
