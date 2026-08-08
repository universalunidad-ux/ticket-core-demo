-- TC-Q2-B130-003 canonical support security contract.
-- Additive only: historical migrations remain immutable.
begin;

create or replace function public.support_idem_claim(p_key text, p_fingerprint text)
returns table(claimed boolean, status text, response jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.support_idempotency;
begin
  if nullif(btrim(p_key), '') is null
    or char_length(p_key) > 120
    or p_fingerprint !~ '^[a-f0-9]{64}$'
  then
    raise exception 'TC_IDEMPOTENCY_INPUT_INVALID' using errcode = '22023';
  end if;

  insert into public.support_idempotency(key, fingerprint, status, expires_at)
  values (p_key, p_fingerprint, 'processing', now() + interval '1 day');
  return query select true, 'processing'::text, null::jsonb;
exception
  when unique_violation then
    select * into strict existing
    from public.support_idempotency
    where key = p_key
    for update;

    if existing.fingerprint <> p_fingerprint then
      raise exception 'TC_IDEMPOTENCY_KEY_REUSED'
        using errcode = 'P0001', detail = 'fingerprint_mismatch';
    end if;

    if existing.status = 'failed' or existing.expires_at < now() then
      update public.support_idempotency
      set status = 'processing',
          created_at = now(),
          expires_at = now() + interval '1 day',
          response = null
      where key = p_key;
      return query select true, 'processing'::text, null::jsonb;
    end if;

    return query select false, existing.status, existing.response;
end
$$;

revoke execute on function public.support_idem_claim(text,text)
  from public, anon, authenticated;
revoke execute on function public.support_idem_finish(text,text,jsonb)
  from public, anon, authenticated;
revoke execute on function public.support_idem_cleanup()
  from public, anon, authenticated;

grant execute on function public.support_idem_claim(text,text)
  to service_role;
grant execute on function public.support_idem_finish(text,text,jsonb)
  to service_role;
grant execute on function public.support_idem_cleanup()
  to service_role;

do $verify_q2_support_acl$
declare
  signature text;
  role_name text;
  function_oid oid;
  role_oid oid;
  service_role_oid oid;
  has_direct_service_role_grant boolean;
begin
  select oid
  into service_role_oid
  from pg_catalog.pg_roles
  where rolname = 'service_role';

  if service_role_oid is null then
    raise exception 'Q2_SUPPORT_ACL_ROLE_MISSING:service_role';
  end if;

  foreach signature in array array[
    'public.support_idem_claim(text,text)',
    'public.support_idem_finish(text,text,jsonb)',
    'public.support_idem_cleanup()'
  ] loop
    function_oid := pg_catalog.to_regprocedure(signature)::oid;

    if function_oid is null then
      raise exception 'Q2_SUPPORT_ACL_FUNCTION_MISSING:%', signature;
    end if;

    foreach role_name in array array['anon', 'authenticated'] loop
      select oid
      into role_oid
      from pg_catalog.pg_roles
      where rolname = role_name;

      if role_oid is null then
        raise exception 'Q2_SUPPORT_ACL_ROLE_MISSING:%', role_name;
      end if;

      if pg_catalog.has_function_privilege(
        role_oid, function_oid, 'EXECUTE'
      ) then
        raise exception 'Q2_SUPPORT_ACL_FORBIDDEN:%:%', signature, role_name;
      end if;
    end loop;

    if pg_catalog.has_function_privilege(
      'public', function_oid, 'EXECUTE'
    ) then
      raise exception 'Q2_SUPPORT_ACL_FORBIDDEN:%:PUBLIC', signature;
    end if;

    if not pg_catalog.has_function_privilege(
      service_role_oid, function_oid, 'EXECUTE'
    ) then
      raise exception 'Q2_SUPPORT_ACL_SERVICE_ROLE_MISSING:%', signature;
    end if;

    select exists (
      select 1
      from pg_catalog.pg_proc as p
      cross join lateral pg_catalog.aclexplode(
        coalesce(
          p.proacl,
          pg_catalog.acldefault('f', p.proowner)
        )
      ) as acl
      where p.oid = function_oid
        and acl.grantee = service_role_oid
        and acl.privilege_type = 'EXECUTE'
    )
    into has_direct_service_role_grant;

    if not has_direct_service_role_grant then
      raise exception 'Q2_SUPPORT_ACL_SERVICE_ROLE_DIRECT_GRANT_MISSING:%',
        signature;
    end if;
  end loop;
end
$verify_q2_support_acl$;

commit;
