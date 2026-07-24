-- PREPARED_NOT_APPLIED
-- DO_NOT_APPLY_WITHOUT_STAGING_REVIEW
-- TC-SEC-SD-GRANTS

revoke execute on function public.tc_current_role()
  from public, anon;
grant execute on function public.tc_current_role()
  to authenticated;

revoke execute on function public.tc_is_admin()
  from public, anon;
grant execute on function public.tc_is_admin()
  to authenticated;

revoke execute on function public.is_internal_user()
  from public, anon;
grant execute on function public.is_internal_user()
  to authenticated;

revoke execute on function public.tc_is_manager()
  from public, anon;
grant execute on function public.tc_is_manager()
  to authenticated;

revoke execute on function public.log_ticket_assignment_event()
  from public, anon, authenticated;

do $verify$
declare
  v_public_exposed integer;
  v_anon_unexpected integer;
begin
  if not has_function_privilege(
    'authenticated',
    'public.tc_current_role()',
    'EXECUTE'
  ) then
    raise exception 'tc_current_role authenticated EXECUTE missing';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.tc_is_admin()',
    'EXECUTE'
  ) then
    raise exception 'tc_is_admin authenticated EXECUTE missing';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.is_internal_user()',
    'EXECUTE'
  ) then
    raise exception 'is_internal_user authenticated EXECUTE missing';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.tc_is_manager()',
    'EXECUTE'
  ) then
    raise exception 'tc_is_manager authenticated EXECUTE missing';
  end if;

  if has_function_privilege(
    'anon',
    'public.log_ticket_assignment_event()',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.log_ticket_assignment_event()',
    'EXECUTE'
  ) then
    raise exception 'assignment trigger remains directly executable';
  end if;

  if not has_function_privilege(
    'anon',
    'public.get_ticket_portal(text,text)',
    'EXECUTE'
  ) then
    raise exception 'intentional portal anon access was removed';
  end if;

  select count(*)
    into v_public_exposed
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(
      coalesce(p.proacl, acldefault('f', p.proowner))
    ) a
    where n.nspname = 'public'
      and p.prosecdef
      and a.grantee = 0
      and a.privilege_type = 'EXECUTE';

  if v_public_exposed <> 0 then
    raise exception
      'PUBLIC-executable SECURITY DEFINER count=%',
      v_public_exposed;
  end if;

  select count(*)
    into v_anon_unexpected
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and has_function_privilege('anon', p.oid, 'EXECUTE')
      and not (
        p.proname = 'get_ticket_portal'
        and pg_get_function_identity_arguments(p.oid)
          = 'p_folio text, p_token text'
      );

  if v_anon_unexpected <> 0 then
    raise exception
      'unexpected anon SECURITY DEFINER count=%',
      v_anon_unexpected;
  end if;
end
$verify$;
