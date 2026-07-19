-- SECURITY DEFINER PREFLIGHT · STAGING · REPORT_ONLY
-- No modifica funciones, grants, owners ni policies.
-- Ejecutar después de aplicar migraciones en staging:
--   psql "$STAGING_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/security_definer_preflight.sql

\set ON_ERROR_STOP on
\pset pager off

\echo 'SECURITY_DEFINER_PREFLIGHT_MODE=REPORT_ONLY'

with function_inventory as (
  select
    p.oid,
    format(
      '%I.%I(%s)',
      n.nspname,
      p.proname,
      pg_get_function_identity_arguments(p.oid)
    ) as identity,
    pg_get_userbyid(p.proowner) as owner,
    p.proconfig,
    coalesce(
      p.proconfig @> array['search_path=public']::text[],
      false
    ) as search_path_fixed,
    exists (
      select 1
      from aclexplode(
        coalesce(p.proacl, acldefault('f', p.proowner))
      ) acl
      where acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    ) as public_execute,
    exists (
      select 1
      from aclexplode(
        coalesce(p.proacl, acldefault('f', p.proowner))
      ) acl
      join pg_roles r on r.oid = acl.grantee
      where r.rolname = 'anon'
        and acl.privilege_type = 'EXECUTE'
    ) as anon_execute,
    exists (
      select 1
      from aclexplode(
        coalesce(p.proacl, acldefault('f', p.proowner))
      ) acl
      join pg_roles r on r.oid = acl.grantee
      where r.rolname = 'authenticated'
        and acl.privilege_type = 'EXECUTE'
    ) as authenticated_execute
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
)
select jsonb_pretty(
  coalesce(
    jsonb_agg(
      jsonb_build_object(
        'identity', identity,
        'owner', owner,
        'proconfig', proconfig,
        'search_path_fixed', search_path_fixed,
        'public_execute', public_execute,
        'anon_execute', anon_execute,
        'authenticated_execute', authenticated_execute
      )
      order by identity
    ),
    '[]'::jsonb
  )
) as security_definer_inventory
from function_inventory;

\echo 'SECURITY_DEFINER_FINDINGS'

with function_inventory as (
  select
    format(
      '%I.%I(%s)',
      n.nspname,
      p.proname,
      pg_get_function_identity_arguments(p.oid)
    ) as identity,
    coalesce(
      p.proconfig @> array['search_path=public']::text[],
      false
    ) as search_path_fixed,
    exists (
      select 1
      from aclexplode(
        coalesce(p.proacl, acldefault('f', p.proowner))
      ) acl
      where acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    ) as public_execute,
    exists (
      select 1
      from aclexplode(
        coalesce(p.proacl, acldefault('f', p.proowner))
      ) acl
      join pg_roles r on r.oid = acl.grantee
      where r.rolname = 'anon'
        and acl.privilege_type = 'EXECUTE'
    ) as anon_execute
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
)
select
  identity,
  search_path_fixed,
  public_execute,
  anon_execute
from function_inventory
where not search_path_fixed
   or public_execute
   or anon_execute
order by identity;

\echo 'SECURITY_DEFINER_PREFLIGHT_COMPLETE=YES'
