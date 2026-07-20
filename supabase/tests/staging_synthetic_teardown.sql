-- TICKET CORE · STAGING SYNTHETIC TEARDOWN V1
-- STAGING_ONLY · FAIL_CLOSED · MARKER_SCOPED
--
-- Elimina únicamente las filas creadas por staging_synthetic_seed.sql.
-- No elimina auth.users.
-- No elimina storage.objects: si existen adjuntos, se detiene y exige Storage API.
--
-- Ejecución futura, solo en staging:
--
-- psql "$STAGING_URL" -v ON_ERROR_STOP=1 \
--   -v environment=staging \
--   -v confirmation=TC_STAGING_TEARDOWN_V1 \
--   -v admin_uid=<UUID_AUTH_STAGING> \
--   -v supervisor_uid=<UUID_AUTH_STAGING> \
--   -v support_a_uid=<UUID_AUTH_STAGING> \
--   -v support_b_uid=<UUID_AUTH_STAGING> \
--   -f supabase/tests/staging_synthetic_teardown.sql

\set ON_ERROR_STOP on
\pset pager off

\if :{?environment}
\else
  \echo 'STOP=environment_REQUIRED'
  \quit 3
\endif

\if :{?confirmation}
\else
  \echo 'STOP=confirmation_REQUIRED'
  \quit 3
\endif

\if :{?admin_uid}
\else
  \echo 'STOP=admin_uid_REQUIRED'
  \quit 3
\endif

\if :{?supervisor_uid}
\else
  \echo 'STOP=supervisor_uid_REQUIRED'
  \quit 3
\endif

\if :{?support_a_uid}
\else
  \echo 'STOP=support_a_uid_REQUIRED'
  \quit 3
\endif

\if :{?support_b_uid}
\else
  \echo 'STOP=support_b_uid_REQUIRED'
  \quit 3
\endif

begin;

select pg_advisory_xact_lock(
  hashtextextended('ticket-core-demo:staging-seed:v1', 0)
);

select set_config('tc.seed_environment', :'environment', true);
select set_config('tc.seed_confirmation', :'confirmation', true);
select set_config('tc.admin_uid', :'admin_uid', true);
select set_config('tc.supervisor_uid', :'supervisor_uid', true);
select set_config('tc.support_a_uid', :'support_a_uid', true);
select set_config('tc.support_b_uid', :'support_b_uid', true);

do $guard$
declare
  user_ids uuid[] := array[
    current_setting('tc.admin_uid')::uuid,
    current_setting('tc.supervisor_uid')::uuid,
    current_setting('tc.support_a_uid')::uuid,
    current_setting('tc.support_b_uid')::uuid
  ];

  client_ids uuid[] := array[
    'a1000000-0000-4000-8000-000000000001'::uuid,
    'a1000000-0000-4000-8000-000000000002'::uuid
  ];

  ticket_ids uuid[] := array[
    'b1000000-0000-4000-8000-000000000001'::uuid,
    'b1000000-0000-4000-8000-000000000002'::uuid,
    'b1000000-0000-4000-8000-000000000003'::uuid
  ];

  ticket_path_ids text[] := array[
    'b1000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000002',
    'b1000000-0000-4000-8000-000000000003'
  ];

  has_storage boolean := false;
  target record;
begin
  if current_setting('tc.seed_environment') <> 'staging' then
    raise exception 'TEARDOWN_DENIED: environment must be staging'
      using errcode = '42501';
  end if;

  if current_setting('tc.seed_confirmation')
      <> 'TC_STAGING_TEARDOWN_V1' then
    raise exception 'TEARDOWN_DENIED: invalid confirmation'
      using errcode = '42501';
  end if;

  if (
    select count(distinct value)
    from unnest(user_ids) as ids(value)
  ) <> 4 then
    raise exception 'TEARDOWN_DENIED: user UUID values must be distinct'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.perfiles
    where id = any (user_ids)
      and coalesce(nombre, '') not like '[TC-STG]%'
  ) then
    raise exception
      'TEARDOWN_COLLISION: supplied profile UUID is not synthetic';
  end if;

  if exists (
    select 1
    from public.clientes
    where id = any (client_ids)
      and coalesce(nombre, '') not like '[TC-STG]%'
  ) then
    raise exception
      'TEARDOWN_COLLISION: reserved client UUID is not synthetic';
  end if;

  if exists (
    select 1
    from public.tickets
    where id = any (ticket_ids)
      and coalesce(folio, '') not like 'TC-STG-%'
  ) then
    raise exception
      'TEARDOWN_COLLISION: reserved ticket UUID is not synthetic';
  end if;

  if to_regclass('storage.objects') is not null then
    execute $sql$
      select exists (
        select 1
        from storage.objects
        where bucket_id = 'soporte_adjuntos'
          and split_part(name, '/', 1) = any ($1)
      )
    $sql$
    into has_storage
    using ticket_path_ids;

    if has_storage then
      raise exception
        'TEARDOWN_BLOCKED: remove synthetic Storage objects through Storage API first';
    end if;
  end if;

  for target in
    select *
    from (
      values
        ('ticket_eventos', 'ticket_id'),
        ('archivos_ticket', 'ticket_id'),
        ('ticket_archivos', 'ticket_id'),
        ('ticket_match_decisiones', 'ticket_id'),
        ('ticket_qr', 'ticket_id')
    ) as children(table_name, column_name)
  loop
    if exists (
      select 1
      from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = target.table_name
        and c.column_name = target.column_name
    ) then
      execute format(
        'delete from public.%I where %I = any ($1)',
        target.table_name,
        target.column_name
      )
      using ticket_ids;
    end if;
  end loop;

  if exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'bitacora'
      and c.column_name = 'usuario_id'
  ) then
    execute
      'delete from public.bitacora where usuario_id = any ($1)'
    using user_ids;
  end if;

  delete from public.tickets
  where id = any (ticket_ids)
    and folio like 'TC-STG-%';

  delete from public.clientes
  where id = any (client_ids)
    and nombre like '[TC-STG]%';

  delete from public.perfiles
  where id = any (user_ids)
    and nombre like '[TC-STG]%';

  if exists (
    select 1 from public.tickets where id = any (ticket_ids)
  ) then
    raise exception 'TEARDOWN_INCOMPLETE: synthetic tickets remain';
  end if;

  if exists (
    select 1 from public.clientes where id = any (client_ids)
  ) then
    raise exception 'TEARDOWN_INCOMPLETE: synthetic clients remain';
  end if;

  if exists (
    select 1 from public.perfiles where id = any (user_ids)
  ) then
    raise exception 'TEARDOWN_INCOMPLETE: synthetic profiles remain';
  end if;
end
$guard$;

commit;

\echo 'STAGING_SYNTHETIC_TEARDOWN=PASS'
\echo 'AUTH_USERS_MODIFIED=NO'
\echo 'STORAGE_MODIFIED=NO'
