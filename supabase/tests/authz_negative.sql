-- ============================================================================
-- AUTHZ · Pruebas RLS ejecutables (STAGING). Ejecutar:
--   psql "$STAGING_URL" -v ON_ERROR_STOP=1 -f supabase/tests/authz_negative.sql
-- Crea fixtures sintéticos dentro de una transacción y hace ROLLBACK al final
-- (no persiste). Simula sesiones Supabase con request.jwt.claims.sub.
-- NOTA: ajustar columnas NOT NULL a las del esquema real de staging si difiere.
-- Estado local: BLOCKED_REMOTE / TEST_HARNESS_FIXED_BUT_NOT_EXECUTED (sin PG).
-- ============================================================================
\set ON_ERROR_STOP on
begin;

-- Simular una sesión autenticada (uid pasado como ARGUMENTO, no como var psql).
create or replace function pg_temp.act(uid uuid)
returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid::text, 'role', 'authenticated')::text, true);
end $$;
create or replace function pg_temp.act_anon()
returns void language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
end $$;
-- TC_SERVICE_ROLE_HELPER_BEGIN
create or replace function pg_temp.act_service()
returns void
language plpgsql
as $$
begin
  perform set_config(
    'role',
    'service_role',
    true
  );

  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'role',
      'service_role'
    )::text,
    true
  );
end
$$;

create or replace function pg_temp.reset_su()
returns void language plpgsql as $$
begin perform set_config('role', 'postgres', true); end $$;

-- ---- Fixtures (como superusuario; RLS se prueba luego cambiando de rol) --------
-- TC_LOCAL_AUTH_FIXTURES_BEGIN
--
-- public.perfiles.id y tickets.asignado_a dependen de auth.users.id.
-- No se crean identities ni contraseñas porque la matriz simula auth.uid()
-- mediante request.jwt.claims y revierte toda la transacción al terminar.
insert into auth.users (
  id,
  aud,
  role,
  email,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '11111111-1111-1111-1111-111111111111',
    'authenticated',
    'authenticated',
    'tc-local-admin@example.invalid',
    now(),
    '{"provider":"email","providers":["email"],"fixture":"tc-local-db"}'::jsonb,
    '{"fixture":"tc-local-db","persona":"admin"}'::jsonb,
    now(),
    now()
  ),
  (
    '22222222-2222-2222-2222-222222222222',
    'authenticated',
    'authenticated',
    'tc-local-supervisor@example.invalid',
    now(),
    '{"provider":"email","providers":["email"],"fixture":"tc-local-db"}'::jsonb,
    '{"fixture":"tc-local-db","persona":"supervisor"}'::jsonb,
    now(),
    now()
  ),
  (
    '33333333-3333-3333-3333-333333333333',
    'authenticated',
    'authenticated',
    'tc-local-support-a@example.invalid',
    now(),
    '{"provider":"email","providers":["email"],"fixture":"tc-local-db"}'::jsonb,
    '{"fixture":"tc-local-db","persona":"support-a"}'::jsonb,
    now(),
    now()
  ),
  (
    '44444444-4444-4444-4444-444444444444',
    'authenticated',
    'authenticated',
    'tc-local-support-b@example.invalid',
    now(),
    '{"provider":"email","providers":["email"],"fixture":"tc-local-db"}'::jsonb,
    '{"fixture":"tc-local-db","persona":"support-b"}'::jsonb,
    now(),
    now()
  ),
  (
    '55555555-5555-5555-5555-555555555555',
    'authenticated',
    'authenticated',
    'tc-local-no-profile@example.invalid',
    now(),
    '{"provider":"email","providers":["email"],"fixture":"tc-local-db"}'::jsonb,
    '{"fixture":"tc-local-db","persona":"no-profile"}'::jsonb,
    now(),
    now()
  )
on conflict (id) do nothing;

do $fixture_auth_users$
declare
  missing_users text;
begin
  select string_agg(
    expected.id::text,
    ', '
    order by expected.id::text
  )
  into missing_users
  from (
    values
      ('11111111-1111-1111-1111-111111111111'::uuid),
      ('22222222-2222-2222-2222-222222222222'::uuid),
      ('33333333-3333-3333-3333-333333333333'::uuid),
      ('44444444-4444-4444-4444-444444444444'::uuid),
      ('55555555-5555-5555-5555-555555555555'::uuid)
  ) expected(id)
  left join auth.users auth_user
    on auth_user.id = expected.id
  where auth_user.id is null;

  if missing_users is not null then
    raise exception
      'TC_FIXTURE_AUTH_USERS_MISSING: %',
      missing_users
      using errcode = '23503';
  end if;

  if exists (
    select 1
    from public.perfiles profile
    where profile.id = any (
      array[
        '11111111-1111-1111-1111-111111111111'::uuid,
        '22222222-2222-2222-2222-222222222222'::uuid,
        '33333333-3333-3333-3333-333333333333'::uuid,
        '44444444-4444-4444-4444-444444444444'::uuid
      ]
    )
  ) then
    raise exception
      'TC_FIXTURE_PROFILE_COLLISION'
      using errcode = '23505';
  end if;

  raise notice
    'FIXTURE PASS: 5 auth.users sintéticos disponibles';
end
$fixture_auth_users$;

-- TC_LOCAL_AUTH_FIXTURES_READY
insert into public.perfiles (id, rol, nombre, tema) values
 ('11111111-1111-1111-1111-111111111111','admin','Admin Uno','light'),
 ('22222222-2222-2222-2222-222222222222','supervisor','Super Uno','light'),
 ('33333333-3333-3333-3333-333333333333','soporte','Soporte A','light'),
 ('44444444-4444-4444-4444-444444444444','soporte','Soporte B','light')
on conflict (id) do nothing;
-- Usuario 55555555 = autenticado SIN perfil (sin acceso autorizado).

insert into public.clientes (id, nombre, origen_registro) values
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Cliente Uno','ticket_core'),
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','Cliente Alta Interna','alta_interna')
on conflict (id) do nothing;

insert into public.tickets (id, cliente_id, asignado_a, titulo, estado, prioridad, folio) values
 ('ce111111-1111-1111-1111-111111111111','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','33333333-3333-3333-3333-333333333333','Ticket A','abierto','media','EX-A1'),
 ('ce222222-2222-2222-2222-222222222222','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', null,'Ticket sin asignar','abierto','media','EX-U1')
on conflict (id) do nothing;

insert into public.bitacora (usuario_id, accion, tipo, visibilidad) values
 ('11111111-1111-1111-1111-111111111111','seed','nota_interna','interna');

-- ---- 1) ROLE_ESCALATION (negativa): Soporte A no puede cambiar su rol ----------
select pg_temp.act('33333333-3333-3333-3333-333333333333');
do $$
begin
  begin
    update public.perfiles set rol='admin' where id='33333333-3333-3333-3333-333333333333';
    raise exception 'FAIL role-escalation: soporte cambió su rol';
  exception when sqlstate '42501' then
    raise notice 'PASS: escalada de rol bloqueada';
  end;
end $$;
select pg_temp.reset_su();


-- TC_SERVICE_ROLE_ROLE_GUARD_BEGIN
-- service_role conserva el canal de aprovisionamiento, pero el cambio se
-- revierte dentro de una subtransacción para no alterar los demás escenarios.
select pg_temp.act_service();

do $tc_service_role_guard$
declare
  observed_role text;
begin
  begin
    update public.perfiles
    set rol = 'ventas'
    where id =
      '44444444-4444-4444-4444-444444444444';

    select profile.rol
    into observed_role
    from public.perfiles profile
    where profile.id =
      '44444444-4444-4444-4444-444444444444';

    if observed_role is distinct from 'ventas' then
      raise exception
        'FAIL: service_role no pudo administrar rol (rol=%)',
        coalesce(observed_role, 'NULL');
    end if;

    raise exception
      'TC_SERVICE_ROLE_ASSERTION_ROLLBACK'
      using errcode = 'P0001';

  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'TC_SERVICE_ROLE_ASSERTION_ROLLBACK' then
        raise;
      end if;

      raise notice
        'PASS: service_role administra rol sin persistir cambio';
  end;
end
$tc_service_role_guard$;

select pg_temp.reset_su();
-- TC_SERVICE_ROLE_ROLE_GUARD_END

-- ---- 2) TICKETS scope (positiva+negativa): A ve su ticket; B no lo ve ----------
select pg_temp.act('33333333-3333-3333-3333-333333333333');
do $$
declare n int;
begin
  select count(*) into n from public.tickets where id='ce111111-1111-1111-1111-111111111111';
  if n <> 1 then raise exception 'FAIL: Soporte A no ve su ticket asignado (n=%)', n; end if;
  raise notice 'PASS: A ve su ticket asignado';
end $$;
select pg_temp.reset_su();

select pg_temp.act('44444444-4444-4444-4444-444444444444');
do $$
declare n int;
begin
  select count(*) into n from public.tickets where id='ce111111-1111-1111-1111-111111111111';
  if n <> 0 then raise exception 'FAIL (canario anti-permisivo): Soporte B ve el ticket de A (n=%)', n; end if;
  raise notice 'PASS: B no ve el ticket de A';
end $$;
select pg_temp.reset_su();

-- ---- 3) MANAGER (positiva): supervisor ve todos los tickets --------------------
select pg_temp.act('22222222-2222-2222-2222-222222222222');
do $$
declare n int;
begin
  select count(*) into n from public.tickets where id in
    ('ce111111-1111-1111-1111-111111111111','ce222222-2222-2222-2222-222222222222');
  if n <> 2 then raise exception 'FAIL: supervisor no ve todos los tickets (n=%)', n; end if;
  raise notice 'PASS: supervisor ve todos';
end $$;
select pg_temp.reset_su();

-- ---- 3B) CLIENTE ORIGIN-ONLY: supervisor ve alta interna sin ticket ------------
select pg_temp.act('22222222-2222-2222-2222-222222222222');
do $$
declare n int;
begin
  select count(*) into n
  from public.clientes
  where id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  if n <> 1 then
    raise exception 'FAIL: supervisor no ve cliente alta_interna sin ticket (n=%)', n;
  end if;

  raise notice 'PASS: supervisor ve cliente alta_interna sin ticket';
end $$;
select pg_temp.reset_su();

-- ---- 3C) CLIENTE ORIGIN-ONLY: soporte no hereda acceso sin ticket asignado -----
select pg_temp.act('33333333-3333-3333-3333-333333333333');
do $$
declare n int;
begin
  select count(*) into n
  from public.clientes
  where id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  if n <> 0 then
    raise exception 'FAIL: soporte ve cliente sin ticket asignado (n=%)', n;
  end if;

  raise notice 'PASS: soporte no ve cliente sin ticket asignado';
end $$;
select pg_temp.reset_su();

-- ---- 4) BITACORA (negativa): soporte no lee bitácora ---------------------------
select pg_temp.act('33333333-3333-3333-3333-333333333333');
do $$
declare n int;
begin
  select count(*) into n from public.bitacora;
  if n <> 0 then raise exception 'FAIL: soporte leyó bitacora (n=%)', n; end if;
  raise notice 'PASS: bitacora oculta a soporte';
end $$;
select pg_temp.reset_su();

-- ---- 5) BITACORA (positiva): admin lee bitácora (>=1) --------------------------
select pg_temp.act('11111111-1111-1111-1111-111111111111');
do $$
declare n int;
begin
  select count(*) into n from public.bitacora;
  if n < 1 then raise exception 'FAIL: admin no lee bitacora (n=%)', n; end if;
  raise notice 'PASS: admin lee bitacora';
end $$;
select pg_temp.reset_su();

-- ---- 6) AUTHENTICATED sin perfil (negativa): sin acceso interno ----------------
select pg_temp.act('55555555-5555-5555-5555-555555555555');
do $$
declare n int;
begin
  select count(*) into n from public.tickets;
  if n <> 0 then raise exception 'FAIL: usuario sin perfil ve tickets (n=%)', n; end if;
  raise notice 'PASS: usuario sin perfil sin acceso';
end $$;
select pg_temp.reset_su();

-- ---- 7) ANON (negativa): sin acceso a tablas internas --------------------------
select pg_temp.act_anon();
do $$
declare n int;
begin
  begin
    select count(*) into n from public.tickets;
    if n <> 0 then raise exception 'FAIL: anon ve tickets (n=%)', n; end if;
    raise notice 'PASS: anon sin tickets';
  exception when insufficient_privilege then
    raise notice 'PASS: anon sin privilegio (revocado)';
  end;
end $$;
select pg_temp.reset_su();

-- ---- 8) WRITE CONTRACT (positiva): A inserta evento en su ticket ---------------
select pg_temp.act('33333333-3333-3333-3333-333333333333');
do $$
begin
  insert into public.ticket_eventos (ticket_id, autor_tipo, visibilidad, kind, texto)
  values ('ce111111-1111-1111-1111-111111111111','soporte','publica','mensaje','hola');
  raise notice 'PASS: A escribe evento en su ticket';
end $$;
select pg_temp.reset_su();

-- ---- 9) WRITE CONTRACT (negativa): B no inserta evento en ticket de A ----------
select pg_temp.act('44444444-4444-4444-4444-444444444444');
do $$
begin
  begin
    insert into public.ticket_eventos (ticket_id, autor_tipo, visibilidad, kind, texto)
    values ('ce111111-1111-1111-1111-111111111111','soporte','publica','mensaje','intruso');
    raise exception 'FAIL: B escribió evento en ticket de A';
  exception when insufficient_privilege or check_violation then
    raise notice 'PASS: B no puede escribir en ticket de A';
  end;
end $$;
select pg_temp.reset_su();

-- ---- 10) DISABLE ACCESS: admin puede dejar rol NULL; usuario queda sin acceso ---
select pg_temp.act('11111111-1111-1111-1111-111111111111');
select public.admin_disable_access('44444444-4444-4444-4444-444444444444');
select pg_temp.reset_su();

do $$
declare current_role text;
begin
  select rol into current_role
  from public.perfiles
  where id='44444444-4444-4444-4444-444444444444';

  if current_role is not null then
    raise exception 'FAIL: admin_disable_access no dejó rol NULL (rol=%)', current_role;
  end if;

  raise notice 'PASS: acceso desactivado mediante rol NULL';
end $$;

rollback; -- no persistir fixtures
