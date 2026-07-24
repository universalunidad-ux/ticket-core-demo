-- TC-SECURITY-DEFINER-SEARCH-PATH
-- PREPARED_NOT_APPLIED
-- DO_NOT_APPLY_WITHOUT_STAGING_REVIEW
--
-- Endurece las funciones SECURITY DEFINER detectadas por el harness.
-- No redefine sus cuerpos ni modifica sus grants explícitos legítimos.
-- Falla si algún rol no confiable puede crear objetos en los esquemas
-- incluidos en el search_path.

begin;

do $trust_boundary$
declare
  v_untrusted text;
begin
  select string_agg(
    format(
      '%I:%s',
      candidate.schema_name,
      candidate.grantee_name
    ),
    ', '
    order by
      candidate.schema_name,
      candidate.grantee_name
  )
  into v_untrusted
  from (
    select distinct
      namespace.nspname as schema_name,
      case
        when expanded.grantee = 0
          then 'PUBLIC'
        else role_name.rolname
      end as grantee_name
    from pg_catalog.pg_namespace namespace
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        namespace.nspacl,
        pg_catalog.acldefault(
          'n',
          namespace.nspowner
        )
      )
    ) expanded
    left join pg_catalog.pg_roles role_name
      on role_name.oid = expanded.grantee
    where namespace.nspname = 'public'
      and expanded.privilege_type = 'CREATE'
      and (
        expanded.grantee = 0
        or role_name.rolname in (
          'anon',
          'authenticated'
        )
      )
  ) candidate;

  if v_untrusted is not null then
    raise exception
      'TC_SD_UNTRUSTED_SCHEMA_CREATE: %',
      v_untrusted
      using errcode = '42501';
  end if;
end
$trust_boundary$;

do $pin_security_definers$
declare
  v_signature text;
  v_function pg_catalog.regprocedure;
  v_search_path_pinned boolean;
  v_anon_execute boolean;
  v_public_execute boolean;
begin
  foreach v_signature in array array[
    'public.manage_assignment_rule(text,uuid,jsonb)',
    'public.manage_site_config(text,text)',
    'public.manage_ticket_assignment(uuid,uuid,text,text,timestamptz)',
    'public.tc_consolidar_cliente_ticket(uuid,text,bigint,text,uuid,uuid,jsonb,jsonb)'
  ]
  loop
    v_function :=
      pg_catalog.to_regprocedure(v_signature);

    if v_function is null then
      raise exception
        'TC_SD_FUNCTION_MISSING: %',
        v_signature
        using errcode = '42883';
    end if;

    execute pg_catalog.format(
      'alter function %s set search_path '
      'to public',
      v_function
    );

    execute pg_catalog.format(
      'revoke execute on function %s '
      'from public, anon',
      v_function
    );

    select
      (
        'search_path=public'
        = any(
          coalesce(
            function_row.proconfig,
            array[]::text[]
          )
        )
      ),
      pg_catalog.has_function_privilege(
        'anon',
        function_row.oid,
        'EXECUTE'
      ),
      exists (
        select 1
        from pg_catalog.aclexplode(
          coalesce(
            function_row.proacl,
            pg_catalog.acldefault(
              'f',
              function_row.proowner
            )
          )
        ) function_acl
        where function_acl.grantee = 0
          and function_acl.privilege_type = 'EXECUTE'
      )
    into
      v_search_path_pinned,
      v_anon_execute,
      v_public_execute
    from pg_catalog.pg_proc function_row
    where function_row.oid = v_function;

    if not coalesce(v_search_path_pinned, false) then
      raise exception
        'TC_SD_SEARCH_PATH_NOT_PINNED: %',
        v_function
        using errcode = '55000';
    end if;

    if coalesce(v_anon_execute, false) then
      raise exception
        'TC_SD_ANON_EXECUTE_REMAINS: %',
        v_function
        using errcode = '42501';
    end if;

    if coalesce(v_public_execute, false) then
      raise exception
        'TC_SD_PUBLIC_EXECUTE_REMAINS: %',
        v_function
        using errcode = '42501';
    end if;
  end loop;
end
$pin_security_definers$;

commit;
