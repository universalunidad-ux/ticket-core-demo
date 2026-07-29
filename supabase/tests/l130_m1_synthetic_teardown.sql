-- TC-L130-AUTHENTICATED-LOCAL-CLOSURE-01
-- LOCAL_ONLY · FAIL_CLOSED · EXACT RESERVED IDS
\set ON_ERROR_STOP on
\pset pager off

\if :{?client_a_uid}
\else
  \echo 'STOP=client_a_uid_REQUIRED'
  do $$ begin raise exception 'STOP=client_a_uid_REQUIRED' using errcode = '22023'; end $$;
\endif
\if :{?client_b_uid}
\else
  \echo 'STOP=client_b_uid_REQUIRED'
  do $$ begin raise exception 'STOP=client_b_uid_REQUIRED' using errcode = '22023'; end $$;
\endif
\if :{?support_uid}
\else
  \echo 'STOP=support_uid_REQUIRED'
  do $$ begin raise exception 'STOP=support_uid_REQUIRED' using errcode = '22023'; end $$;
\endif
\if :{?admin_uid}
\else
  \echo 'STOP=admin_uid_REQUIRED'
  do $$ begin raise exception 'STOP=admin_uid_REQUIRED' using errcode = '22023'; end $$;
\endif

begin;
select pg_advisory_xact_lock(hashtextextended('ticket-core-demo:l130:m1:seed', 0));

do $guard$
begin
  if exists (
    select 1 from public.clientes
    where id = any(array[
      'c1300000-0000-4000-8000-000000000001'::uuid,
      'c1300000-0000-4000-8000-000000000002'::uuid
    ])
      and nombre not like '[TC-L130-M1]%'
  ) or exists (
    select 1 from public.clientes_contactos
    where id = any(array[
      'd1300000-0000-4000-8000-000000000001'::uuid,
      'd1300000-0000-4000-8000-000000000002'::uuid
    ])
      and nombre not like '[TC-L130-M1]%'
  ) or exists (
    select 1 from public.tickets
    where id = any(array[
      'e1300000-0000-4000-8000-000000000001'::uuid,
      'e1300000-0000-4000-8000-000000000002'::uuid,
      'e1300000-0000-4000-8000-000000000003'::uuid,
      'e1300000-0000-4000-8000-000000000004'::uuid
    ])
      and folio not like 'TC-L130-%'
  ) then
    raise exception 'M1_TEARDOWN_SYNTHETIC_MARKER_MISMATCH';
  end if;
end
$guard$;

delete from public.tickets
where id = any(array[
  'e1300000-0000-4000-8000-000000000001'::uuid,
  'e1300000-0000-4000-8000-000000000002'::uuid,
  'e1300000-0000-4000-8000-000000000003'::uuid,
  'e1300000-0000-4000-8000-000000000004'::uuid
]);

delete from public.clientes_contactos
where id = any(array[
  'd1300000-0000-4000-8000-000000000001'::uuid,
  'd1300000-0000-4000-8000-000000000002'::uuid
])
  and auth_user_id = any(array[:'client_a_uid'::uuid, :'client_b_uid'::uuid]);

delete from public.clientes
where id = any(array[
  'c1300000-0000-4000-8000-000000000001'::uuid,
  'c1300000-0000-4000-8000-000000000002'::uuid
]);

delete from public.perfiles
where id = any(array[:'support_uid'::uuid, :'admin_uid'::uuid])
  and nombre like '[TC-L130-M1]%';

do $verify$
begin
  if exists (
    select 1 from public.tickets where folio like 'TC-L130-%'
  ) or exists (
    select 1 from public.clientes where nombre like '[TC-L130-M1]%'
  ) or exists (
    select 1 from public.clientes_contactos where origen_alta = 'l130_synthetic'
  ) or exists (
    select 1 from public.perfiles where nombre like '[TC-L130-M1]%'
  ) then
    raise exception 'M1_TEARDOWN_RESIDUAL_ROWS';
  end if;
end
$verify$;

commit;
\echo M1_TEARDOWN=PASS
\echo M1_RESIDUAL_ROWS=0
