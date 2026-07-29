-- TC-L130-AUTHENTICATED-LOCAL-CLOSURE-01
-- LOCAL_ONLY · M1_CONTACT_AUTH_LINK_SINGLE_CLIENT · DETERMINISTIC SYNTHETIC DATA
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
select set_config('tc.l130.client_a_uid', :'client_a_uid', true);
select set_config('tc.l130.client_b_uid', :'client_b_uid', true);
select set_config('tc.l130.support_uid', :'support_uid', true);
select set_config('tc.l130.admin_uid', :'admin_uid', true);

do $guard$
declare
  actor_ids uuid[] := array[
    current_setting('tc.l130.client_a_uid')::uuid,
    current_setting('tc.l130.client_b_uid')::uuid,
    current_setting('tc.l130.support_uid')::uuid,
    current_setting('tc.l130.admin_uid')::uuid
  ];
begin
  if (select count(distinct value) from unnest(actor_ids) ids(value)) <> 4 then
    raise exception 'M1_SEED_ACTORS_NOT_DISTINCT' using errcode = '22023';
  end if;
  if (select count(*) from auth.users where id = any(actor_ids)) <> 4 then
    raise exception 'M1_SEED_AUTH_USERS_MISSING';
  end if;
  if exists (
    select 1 from public.clientes
    where id = any(array[
      'c1300000-0000-4000-8000-000000000001'::uuid,
      'c1300000-0000-4000-8000-000000000002'::uuid
    ])
  ) or exists (
    select 1 from public.clientes_contactos
    where id = any(array[
      'd1300000-0000-4000-8000-000000000001'::uuid,
      'd1300000-0000-4000-8000-000000000002'::uuid
    ])
  ) or exists (
    select 1 from public.tickets
    where id = any(array[
      'e1300000-0000-4000-8000-000000000001'::uuid,
      'e1300000-0000-4000-8000-000000000002'::uuid,
      'e1300000-0000-4000-8000-000000000003'::uuid,
      'e1300000-0000-4000-8000-000000000004'::uuid
    ])
  ) then
    raise exception 'M1_SEED_RESERVED_ID_COLLISION';
  end if;
end
$guard$;

insert into public.perfiles (id, nombre, rol, activo, tema)
values
  (:'support_uid'::uuid, '[TC-L130-M1] Soporte', 'soporte', true, 'light'),
  (:'admin_uid'::uuid, '[TC-L130-M1] Administrador', 'admin', true, 'light');

insert into public.clientes (id, nombre, correo, origen_registro, estatus, activo)
values
  (
    'c1300000-0000-4000-8000-000000000001',
    '[TC-L130-M1] Cliente A',
    'tc-l130-company-a@example.invalid',
    'ticket_core',
    'activo',
    true
  ),
  (
    'c1300000-0000-4000-8000-000000000002',
    '[TC-L130-M1] Cliente B',
    'tc-l130-company-b@example.invalid',
    'ticket_core',
    'activo',
    true
  );

insert into public.clientes_contactos (
  id, cliente_id, nombre, correo, es_principal, activo, origen_alta, auth_user_id
)
values
  (
    'd1300000-0000-4000-8000-000000000001',
    'c1300000-0000-4000-8000-000000000001',
    '[TC-L130-M1] Contacto A',
    'tc-l130-client-a@example.invalid',
    true,
    true,
    'l130_synthetic',
    :'client_a_uid'::uuid
  ),
  (
    'd1300000-0000-4000-8000-000000000002',
    'c1300000-0000-4000-8000-000000000002',
    '[TC-L130-M1] Contacto B',
    'tc-l130-client-b@example.invalid',
    true,
    true,
    'l130_synthetic',
    :'client_b_uid'::uuid
  );

insert into public.tickets (
  id, cliente_id, contacto_id, titulo, descripcion, prioridad, estado, tipo,
  asignado_a, origen, folio, contexto_adicional
)
values
  (
    'e1300000-0000-4000-8000-000000000001',
    'c1300000-0000-4000-8000-000000000001',
    'd1300000-0000-4000-8000-000000000001',
    '[TC-L130-M1] A abierto',
    'Dato sintético desechable',
    'media',
    'abierto',
    'soporte',
    :'support_uid'::uuid,
    'l130_synthetic',
    'TC-L130-A-OPEN',
    '[TC-L130-M1] baseline A open'
  ),
  (
    'e1300000-0000-4000-8000-000000000002',
    'c1300000-0000-4000-8000-000000000001',
    'd1300000-0000-4000-8000-000000000001',
    '[TC-L130-M1] A resuelto',
    'Dato sintético desechable',
    'baja',
    'resuelto',
    'soporte',
    :'support_uid'::uuid,
    'l130_synthetic',
    'TC-L130-A-DONE',
    '[TC-L130-M1] baseline A resolved'
  ),
  (
    'e1300000-0000-4000-8000-000000000003',
    'c1300000-0000-4000-8000-000000000002',
    'd1300000-0000-4000-8000-000000000002',
    '[TC-L130-M1] B abierto',
    'Dato sintético desechable',
    'media',
    'abierto',
    'soporte',
    :'support_uid'::uuid,
    'l130_synthetic',
    'TC-L130-B-OPEN',
    '[TC-L130-M1] baseline B open'
  ),
  (
    'e1300000-0000-4000-8000-000000000004',
    'c1300000-0000-4000-8000-000000000002',
    'd1300000-0000-4000-8000-000000000002',
    '[TC-L130-M1] B resuelto',
    'Dato sintético desechable',
    'baja',
    'resuelto',
    'soporte',
    null,
    'l130_synthetic',
    'TC-L130-B-DONE',
    '[TC-L130-M1] baseline B resolved'
  );

commit;

\echo M1_SEED=PASS
\echo M1_SEED_CLIENTS=2
\echo M1_SEED_CONTACTS=2
\echo M1_SEED_TICKETS=4
\echo M1_SEED_SUPPORT_ASSIGNED_TICKETS=3
\echo M1_SEED_UNASSIGNED_TICKETS=1
\echo M1_SEED_INTERNAL_ACTORS=2
