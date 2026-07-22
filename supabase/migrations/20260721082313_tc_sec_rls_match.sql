-- PREPARED_NOT_APPLIED
-- DO_NOT_APPLY_WITHOUT_STAGING_REVIEW
-- TC-SEC-RLS-MATCH
--
-- Cierra el acceso permisivo directo a ticket_match_decisiones.
-- Las escrituras de consolidación pertenecen exclusivamente a
-- public.tc_consolidar_cliente_ticket.

alter table public.ticket_match_decisiones
  enable row level security;

drop policy if exists ticket_match_decisiones_insert_auth
  on public.ticket_match_decisiones;

drop policy if exists ticket_match_decisiones_select_auth
  on public.ticket_match_decisiones;

drop policy if exists ticket_match_decisiones_update_auth
  on public.ticket_match_decisiones;

drop policy if exists ticket_match_decisiones_admin_select_v1
  on public.ticket_match_decisiones;

create policy ticket_match_decisiones_admin_select_v1
  on public.ticket_match_decisiones
  for select
  to authenticated
  using (
    (select public.tc_current_role()) = 'admin'
  );

revoke all
  on table public.ticket_match_decisiones
  from public;

revoke all
  on table public.ticket_match_decisiones
  from anon;

revoke insert, update, delete
  on table public.ticket_match_decisiones
  from authenticated;

grant select
  on table public.ticket_match_decisiones
  to authenticated;

do $verify$
declare
  v_policy_count integer;
  v_unsafe_policy_count integer;
begin
  select count(*)
    into v_policy_count
    from pg_policies
    where schemaname = 'public'
      and tablename = 'ticket_match_decisiones';

  if v_policy_count <> 1 then
    raise exception
      'TC-SEC-RLS-MATCH expected one policy, found %',
      v_policy_count
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'ticket_match_decisiones'
      and policyname = 'ticket_match_decisiones_admin_select_v1'
      and cmd = 'SELECT'
      and roles @> array['authenticated']::name[]
      and coalesce(qual, '') like '%tc_current_role%'
      and coalesce(qual, '') like '%admin%'
  ) then
    raise exception
      'TC-SEC-RLS-MATCH admin select policy malformed'
      using errcode = 'P0001';
  end if;

  select count(*)
    into v_unsafe_policy_count
    from pg_policies
    where schemaname = 'public'
      and tablename = 'ticket_match_decisiones'
      and (
        cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
        or coalesce(qual, '') in ('true', '(true)')
        or coalesce(with_check, '') in ('true', '(true)')
      );

  if v_unsafe_policy_count <> 0 then
    raise exception
      'TC-SEC-RLS-MATCH unsafe policies remain: %',
      v_unsafe_policy_count
      using errcode = 'P0001';
  end if;

  if has_table_privilege(
    'authenticated',
    'public.ticket_match_decisiones',
    'INSERT'
  ) then
    raise exception
      'authenticated INSERT remains'
      using errcode = 'P0001';
  end if;

  if has_table_privilege(
    'authenticated',
    'public.ticket_match_decisiones',
    'UPDATE'
  ) then
    raise exception
      'authenticated UPDATE remains'
      using errcode = 'P0001';
  end if;

  if has_table_privilege(
    'authenticated',
    'public.ticket_match_decisiones',
    'DELETE'
  ) then
    raise exception
      'authenticated DELETE remains'
      using errcode = 'P0001';
  end if;

  if not has_table_privilege(
    'authenticated',
    'public.ticket_match_decisiones',
    'SELECT'
  ) then
    raise exception
      'authenticated SELECT missing'
      using errcode = 'P0001';
  end if;
end
$verify$;
