-- TC-EDGE-IDEMPOTENCY-ACL-CLOSE-01
--
-- Reconciliación aditiva de la ACL efectiva de public.edge_idempotency.
-- No modifica columnas, índices, constraints, RLS, policies ni funciones.
--
-- Contrato:
--   PUBLIC        = sin privilegios
--   anon          = sin privilegios
--   authenticated = sin privilegios directos ni efectivos
--   service_role  = SELECT, INSERT, UPDATE únicamente

begin;

do $precheck$
begin
  if to_regclass('public.edge_idempotency') is null then
    raise exception
      'public.edge_idempotency no existe';
  end if;
end
$precheck$;

revoke all privileges
  on table public.edge_idempotency
  from public, anon, authenticated, service_role;

grant select, insert, update
  on table public.edge_idempotency
  to service_role;

do $verify$
declare
  v_public_acl_count integer;
begin
  select count(*)
    into v_public_acl_count
  from pg_class c
  join pg_namespace n
    on n.oid = c.relnamespace
  cross join lateral aclexplode(
    coalesce(
      c.relacl,
      acldefault('r', c.relowner)
    )
  ) acl
  where n.nspname = 'public'
    and c.relname = 'edge_idempotency'
    and acl.grantee = 0;

  if v_public_acl_count <> 0 then
    raise exception
      'PUBLIC conserva privilegios en edge_idempotency';
  end if;

  if has_table_privilege(
    'anon',
    'public.edge_idempotency',
    'SELECT'
  ) or has_table_privilege(
    'anon',
    'public.edge_idempotency',
    'INSERT'
  ) or has_table_privilege(
    'anon',
    'public.edge_idempotency',
    'UPDATE'
  ) or has_table_privilege(
    'anon',
    'public.edge_idempotency',
    'DELETE'
  ) then
    raise exception
      'anon conserva privilegios en edge_idempotency';
  end if;

  if has_table_privilege(
    'authenticated',
    'public.edge_idempotency',
    'SELECT'
  ) or has_table_privilege(
    'authenticated',
    'public.edge_idempotency',
    'INSERT'
  ) or has_table_privilege(
    'authenticated',
    'public.edge_idempotency',
    'UPDATE'
  ) or has_table_privilege(
    'authenticated',
    'public.edge_idempotency',
    'DELETE'
  ) then
    raise exception
      'authenticated conserva privilegios en edge_idempotency';
  end if;

  if not has_table_privilege(
    'service_role',
    'public.edge_idempotency',
    'SELECT'
  ) or not has_table_privilege(
    'service_role',
    'public.edge_idempotency',
    'INSERT'
  ) or not has_table_privilege(
    'service_role',
    'public.edge_idempotency',
    'UPDATE'
  ) then
    raise exception
      'service_role perdió SELECT/INSERT/UPDATE';
  end if;

  if has_table_privilege(
    'service_role',
    'public.edge_idempotency',
    'DELETE'
  ) or has_table_privilege(
    'service_role',
    'public.edge_idempotency',
    'TRUNCATE'
  ) or has_table_privilege(
    'service_role',
    'public.edge_idempotency',
    'REFERENCES'
  ) or has_table_privilege(
    'service_role',
    'public.edge_idempotency',
    'TRIGGER'
  ) then
    raise exception
      'service_role conserva privilegios fuera del contrato mínimo';
  end if;
end
$verify$;

commit;
