-- TC-BACKEND-SECURITY-MACROBATCH-01
-- REQUIREMENTS: TC-U010, TC-U012, TC-U013, TC-U033
-- PREPARED_NOT_APPLIED
-- STATIC_CONTRACT_ONLY: no PostgreSQL/Supabase runtime claim.
-- Rollback: compensating migration; never disable RLS.

begin;

-- Fail closed on the canonical M1 dependency and the tables this migration
-- protects. This prevents a partial application on an unrelated schema.
do $identity_guard$
begin
  if pg_catalog.to_regprocedure('public.tc_current_client_id()') is null
     or pg_catalog.to_regprocedure('public.tc_current_role()') is null
     or pg_catalog.to_regprocedure('public.tc_is_admin()') is null
     or pg_catalog.to_regprocedure('public.tc_is_manager()') is null
     or pg_catalog.to_regprocedure('public.tc_can_access_ticket(uuid)') is null
  then
    raise exception 'TC_BSM01_REQUIRED_AUTHZ_FUNCTION_MISSING'
      using errcode = '42883';
  end if;

  if pg_catalog.to_regclass('public.perfiles') is null
     or pg_catalog.to_regclass('public.archivos_ticket') is null
     or pg_catalog.to_regclass('public.ticket_archivos') is null
     or pg_catalog.to_regclass('public.tickets') is null
  then
    raise exception 'TC_BSM01_REQUIRED_TABLE_MISSING'
      using errcode = '42P01';
  end if;
end
$identity_guard$;

-- TC-U013: the two advisor-reported legacy functions are not present in a
-- fresh canonical schema, but may exist in the reconciled staging schema.
-- Pin every matching overload if present; invent no function or signature.
do $pin_legacy_search_path$
declare
  v_proc pg_catalog.regprocedure;
begin
  for v_proc in
    select p.oid::pg_catalog.regprocedure
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('norm_match', 'set_updated_at')
  loop
    execute pg_catalog.format(
      'alter function %s set search_path to pg_catalog, public',
      v_proc
    );
  end loop;
end
$pin_legacy_search_path$;

-- TC-U010 + TC-U033: profile reads remain self/admin only. Remove the
-- historical table-level UPDATE grant so authenticated users can mutate only
-- non-authorization columns. The role trigger remains defense in depth.
alter table public.perfiles enable row level security;

drop policy if exists perfiles_select_self on public.perfiles;
create policy perfiles_select_self
  on public.perfiles
  for select
  to authenticated
  using (
    id = (select auth.uid())
    or (select public.tc_is_admin())
  );

drop policy if exists perfiles_update_self on public.perfiles;
create policy perfiles_update_self
  on public.perfiles
  for update
  to authenticated
  using (
    id = (select auth.uid())
    or (select public.tc_is_admin())
  )
  with check (
    id = (select auth.uid())
    or (select public.tc_is_admin())
  );

revoke all on table public.perfiles from public, anon;
revoke insert, update, delete on table public.perfiles from authenticated;
grant select on table public.perfiles to authenticated;
grant update (nombre, tema, preferencias) on table public.perfiles
  to authenticated;

-- TC-U010: M1 clients can read metadata only for attachments belonging to
-- their own authorized tickets. No client INSERT/UPDATE/DELETE policy exists.
-- Internal staff retain ticket-scoped access through tc_can_access_ticket().
alter table public.archivos_ticket enable row level security;
alter table public.ticket_archivos enable row level security;

drop policy if exists archivos_ticket_staff_select
  on public.archivos_ticket;
create policy archivos_ticket_staff_select
  on public.archivos_ticket
  for select
  to authenticated
  using ((select public.tc_can_access_ticket(ticket_id)));

drop policy if exists archivos_ticket_client_owner_select
  on public.archivos_ticket;
create policy archivos_ticket_client_owner_select
  on public.archivos_ticket
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.tickets t
      where t.id = archivos_ticket.ticket_id
        and t.cliente_id is not null
        and t.cliente_id = (select public.tc_current_client_id())
    )
  );

drop policy if exists ticket_archivos_staff_select
  on public.ticket_archivos;
create policy ticket_archivos_staff_select
  on public.ticket_archivos
  for select
  to authenticated
  using ((select public.tc_can_access_ticket(ticket_id)));

drop policy if exists ticket_archivos_client_owner_select
  on public.ticket_archivos;
create policy ticket_archivos_client_owner_select
  on public.ticket_archivos
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.tickets t
      where t.id = ticket_archivos.ticket_id
        and t.cliente_id is not null
        and t.cliente_id = (select public.tc_current_client_id())
    )
  );

revoke all on table public.archivos_ticket from public, anon;
revoke all on table public.ticket_archivos from public, anon;
grant select on table public.archivos_ticket to authenticated;
grant select on table public.ticket_archivos to authenticated;

-- TC-U012: exact-signature ACL reconciliation. Trigger-only functions remain
-- non-callable. AuthZ lookup functions are callable only by authenticated.
revoke execute on function public.tc_current_role()
  from public, anon;
revoke execute on function public.tc_is_admin()
  from public, anon;
revoke execute on function public.tc_is_manager()
  from public, anon;
revoke execute on function public.tc_can_access_ticket(uuid)
  from public, anon;
revoke execute on function public.tc_current_client_id()
  from public, anon;

grant execute on function public.tc_current_role()
  to authenticated;
grant execute on function public.tc_is_admin()
  to authenticated;
grant execute on function public.tc_is_manager()
  to authenticated;
grant execute on function public.tc_can_access_ticket(uuid)
  to authenticated;
grant execute on function public.tc_current_client_id()
  to authenticated;

revoke execute on function public.tc_prevent_rol_escalation()
  from public, anon, authenticated;

-- Postconditions: exact ACL, policy uniqueness, no unsafe profile DML and no
-- remaining mutable search_path for the two advisor-reported function names.
do $verify_bsm01$
declare
  v_bad text;
  v_policy_count integer;
begin
  select pg_catalog.string_agg(
    p.oid::pg_catalog.regprocedure::text,
    ', ' order by p.oid::pg_catalog.regprocedure::text
  )
  into v_bad
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('norm_match', 'set_updated_at')
    and not (
      coalesce(p.proconfig, array[]::text[])
      @> array['search_path=pg_catalog, public']::text[]
    );

  if v_bad is not null then
    raise exception 'TC_BSM01_MUTABLE_SEARCH_PATH_REMAINS: %', v_bad
      using errcode = '55000';
  end if;

  if pg_catalog.has_table_privilege(
       'authenticated', 'public.perfiles', 'INSERT'
     )
     or pg_catalog.has_table_privilege(
       'authenticated', 'public.perfiles', 'DELETE'
     )
     or pg_catalog.has_column_privilege(
       'authenticated', 'public.perfiles', 'rol', 'UPDATE'
     )
  then
    raise exception 'TC_BSM01_PROFILE_PRIVILEGE_OVERGRANT'
      using errcode = '42501';
  end if;

  if not pg_catalog.has_column_privilege(
    'authenticated', 'public.perfiles', 'nombre', 'UPDATE'
  ) then
    raise exception 'TC_BSM01_PROFILE_SAFE_UPDATE_MISSING'
      using errcode = '42501';
  end if;

  select count(*)
  into v_policy_count
  from pg_catalog.pg_policies
  where schemaname = 'public'
    and (
      (tablename = 'perfiles'
       and policyname in ('perfiles_select_self', 'perfiles_update_self'))
      or
      (tablename = 'archivos_ticket'
       and policyname in (
         'archivos_ticket_staff_select',
         'archivos_ticket_client_owner_select'
       ))
      or
      (tablename = 'ticket_archivos'
       and policyname in (
         'ticket_archivos_staff_select',
         'ticket_archivos_client_owner_select'
       ))
    );

  if v_policy_count <> 6 then
    raise exception 'TC_BSM01_POLICY_SET_INVALID: %', v_policy_count
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename in ('perfiles', 'archivos_ticket', 'ticket_archivos')
      and (
        coalesce(qual, '') in ('true', '(true)')
        or coalesce(with_check, '') in ('true', '(true)')
      )
  ) then
    raise exception 'TC_BSM01_ALWAYS_TRUE_POLICY'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from (
      values
        ('public.tc_current_role()'),
        ('public.tc_is_admin()'),
        ('public.tc_is_manager()'),
        ('public.tc_can_access_ticket(uuid)'),
        ('public.tc_current_client_id()')
    ) expected(signature)
    where not pg_catalog.has_function_privilege(
      'authenticated',
      pg_catalog.to_regprocedure(expected.signature),
      'EXECUTE'
    )
      or pg_catalog.has_function_privilege(
        'anon',
        pg_catalog.to_regprocedure(expected.signature),
        'EXECUTE'
      )
  ) then
    raise exception 'TC_BSM01_AUTHZ_FUNCTION_ACL_INVALID'
      using errcode = '42501';
  end if;

  if pg_catalog.has_function_privilege(
    'authenticated',
    'public.tc_prevent_rol_escalation()',
    'EXECUTE'
  ) then
    raise exception 'TC_BSM01_TRIGGER_FUNCTION_EXECUTABLE'
      using errcode = '42501';
  end if;

  select pg_catalog.string_agg(
    p.oid::pg_catalog.regprocedure::text,
    ', ' order by p.oid::pg_catalog.regprocedure::text
  )
  into v_bad
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  cross join lateral pg_catalog.aclexplode(
    coalesce(
      p.proacl,
      pg_catalog.acldefault('f', p.proowner)
    )
  ) a
  where n.nspname = 'public'
    and p.prosecdef
    and a.grantee = 0
    and a.privilege_type = 'EXECUTE';

  if v_bad is not null then
    raise exception 'TC_BSM01_PUBLIC_SECURITY_DEFINER: %', v_bad
      using errcode = '42501';
  end if;
end
$verify_bsm01$;

commit;
