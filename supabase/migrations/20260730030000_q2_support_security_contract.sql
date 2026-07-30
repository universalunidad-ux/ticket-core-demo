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
begin
  foreach signature in array array[
    'public.support_idem_claim(text,text)',
    'public.support_idem_finish(text,text,jsonb)',
    'public.support_idem_cleanup()'
  ] loop
    foreach role_name in array array['PUBLIC', 'anon', 'authenticated'] loop
      if pg_catalog.has_function_privilege(role_name, signature, 'EXECUTE') then
        raise exception 'Q2_SUPPORT_ACL_FORBIDDEN:%:%', signature, role_name;
      end if;
    end loop;
    if not pg_catalog.has_function_privilege(
      'service_role', signature, 'EXECUTE'
    ) then
      raise exception 'Q2_SUPPORT_ACL_SERVICE_ROLE_MISSING:%', signature;
    end if;
  end loop;
end
$verify_q2_support_acl$;

commit;
