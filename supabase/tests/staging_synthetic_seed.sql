-- TICKET CORE · STAGING SYNTHETIC SEED V1
-- STAGING_ONLY · PERSISTENT_SYNTHETIC_DATA · IDEMPOTENT
--
-- Requisitos:
--   1. M01-M11 ya aplicadas en staging.
--   2. Cuatro usuarios sintéticos creados previamente en Supabase Auth staging.
--   3. Nunca usar UUID de usuarios reales.
--
-- Ejecución futura, solo en staging:
--
-- psql "$STAGING_URL" -v ON_ERROR_STOP=1 \
--   -v environment=staging \
--   -v confirmation=TC_STAGING_SYNTHETIC_V1 \
--   -v admin_uid=<UUID_AUTH_STAGING> \
--   -v supervisor_uid=<UUID_AUTH_STAGING> \
--   -v support_a_uid=<UUID_AUTH_STAGING> \
--   -v support_b_uid=<UUID_AUTH_STAGING> \
--   -f supabase/tests/staging_synthetic_seed.sql
--
-- Este archivo NO crea, actualiza ni elimina filas de auth.users.
-- Tampoco crea objetos en Storage.

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
  admin_uid uuid := current_setting('tc.admin_uid')::uuid;
  supervisor_uid uuid := current_setting('tc.supervisor_uid')::uuid;
  support_a_uid uuid := current_setting('tc.support_a_uid')::uuid;
  support_b_uid uuid := current_setting('tc.support_b_uid')::uuid;

  client_a constant uuid := 'a1000000-0000-4000-8000-000000000001';
  client_b constant uuid := 'a1000000-0000-4000-8000-000000000002';

  ticket_a constant uuid := 'b1000000-0000-4000-8000-000000000001';
  ticket_b constant uuid := 'b1000000-0000-4000-8000-000000000002';
  ticket_u constant uuid := 'b1000000-0000-4000-8000-000000000003';
begin
  if current_setting('tc.seed_environment') <> 'staging' then
    raise exception 'SEED_DENIED: environment must be staging'
      using errcode = '42501';
  end if;

  if current_setting('tc.seed_confirmation')
      <> 'TC_STAGING_SYNTHETIC_V1' then
    raise exception 'SEED_DENIED: invalid confirmation'
      using errcode = '42501';
  end if;

  if (
    select count(distinct value)
    from unnest(
      array[
        admin_uid,
        supervisor_uid,
        support_a_uid,
        support_b_uid
      ]
    ) as ids(value)
  ) <> 4 then
    raise exception 'SEED_DENIED: user UUID values must be distinct'
      using errcode = '22023';
  end if;

  if to_regclass('auth.users') is null then
    raise exception 'SEED_DENIED: auth.users unavailable';
  end if;

  if (
    select count(*)
    from auth.users
    where id = any (
      array[
        admin_uid,
        supervisor_uid,
        support_a_uid,
        support_b_uid
      ]
    )
  ) <> 4 then
    raise exception
      'SEED_DENIED: create all four synthetic Auth users first';
  end if;

  if exists (
    select 1
    from public.perfiles
    where id = any (
      array[
        admin_uid,
        supervisor_uid,
        support_a_uid,
        support_b_uid
      ]
    )
      and coalesce(nombre, '') not like '[TC-STG]%'
  ) then
    raise exception
      'SEED_COLLISION: one supplied profile UUID is not synthetic';
  end if;

  if exists (
    select 1
    from public.clientes
    where id = any (array[client_a, client_b])
      and coalesce(nombre, '') not like '[TC-STG]%'
  ) then
    raise exception
      'SEED_COLLISION: reserved client UUID contains non-synthetic data';
  end if;

  if exists (
    select 1
    from public.clientes
    where nombre in (
      '[TC-STG] Cliente Alfa',
      '[TC-STG] Cliente Beta'
    )
      and not (id = any (array[client_a, client_b]))
  ) then
    raise exception
      'SEED_COLLISION: synthetic client name belongs to another UUID';
  end if;

  if exists (
    select 1
    from public.tickets
    where id = any (array[ticket_a, ticket_b, ticket_u])
      and coalesce(folio, '') not like 'TC-STG-%'
  ) then
    raise exception
      'SEED_COLLISION: reserved ticket UUID contains non-synthetic data';
  end if;

  if exists (
    select 1
    from public.tickets
    where folio like 'TC-STG-%'
      and not (id = any (array[ticket_a, ticket_b, ticket_u]))
  ) then
    raise exception
      'SEED_COLLISION: synthetic folio exists under another UUID';
  end if;
end
$guard$;

insert into public.perfiles (id, rol, nombre, tema)
values
  (
    current_setting('tc.admin_uid')::uuid,
    'admin',
    '[TC-STG] Admin',
    'light'
  ),
  (
    current_setting('tc.supervisor_uid')::uuid,
    'supervisor',
    '[TC-STG] Supervisor',
    'light'
  ),
  (
    current_setting('tc.support_a_uid')::uuid,
    'soporte',
    '[TC-STG] Soporte A',
    'light'
  ),
  (
    current_setting('tc.support_b_uid')::uuid,
    'soporte',
    '[TC-STG] Soporte B',
    'light'
  )
on conflict (id) do update
set
  rol = excluded.rol,
  nombre = excluded.nombre,
  tema = excluded.tema;

insert into public.clientes (id, nombre, origen_registro)
values
  (
    'a1000000-0000-4000-8000-000000000001',
    '[TC-STG] Cliente Alfa',
    'ticket_core'
  ),
  (
    'a1000000-0000-4000-8000-000000000002',
    '[TC-STG] Cliente Beta',
    'alta_interna'
  )
on conflict (id) do update
set
  nombre = excluded.nombre,
  origen_registro = excluded.origen_registro;

insert into public.tickets (
  id,
  cliente_id,
  asignado_a,
  titulo,
  estado,
  prioridad,
  folio
)
values
  (
    'b1000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001',
    current_setting('tc.support_a_uid')::uuid,
    '[TC-STG] Ticket asignado a Soporte A',
    'abierto',
    'media',
    'TC-STG-A-001'
  ),
  (
    'b1000000-0000-4000-8000-000000000002',
    'a1000000-0000-4000-8000-000000000002',
    current_setting('tc.support_b_uid')::uuid,
    '[TC-STG] Ticket asignado a Soporte B',
    'abierto',
    'alta',
    'TC-STG-B-001'
  ),
  (
    'b1000000-0000-4000-8000-000000000003',
    'a1000000-0000-4000-8000-000000000002',
    null,
    '[TC-STG] Ticket sin asignar',
    'abierto',
    'baja',
    'TC-STG-U-001'
  )
on conflict (id) do update
set
  cliente_id = excluded.cliente_id,
  asignado_a = excluded.asignado_a,
  titulo = excluded.titulo,
  estado = excluded.estado,
  prioridad = excluded.prioridad,
  folio = excluded.folio;

select jsonb_pretty(
  jsonb_build_object(
    'seed', 'TC_STAGING_SYNTHETIC_V1',
    'profiles', (
      select count(*)
      from public.perfiles
      where nombre like '[TC-STG]%'
    ),
    'clients', (
      select count(*)
      from public.clientes
      where id in (
        'a1000000-0000-4000-8000-000000000001',
        'a1000000-0000-4000-8000-000000000002'
      )
    ),
    'tickets', (
      select count(*)
      from public.tickets
      where folio like 'TC-STG-%'
    )
  )
) as staging_synthetic_seed_summary;

commit;

\echo 'STAGING_SYNTHETIC_SEED=PASS'
\echo 'AUTH_USERS_MODIFIED=NO'
\echo 'STORAGE_MODIFIED=NO'
