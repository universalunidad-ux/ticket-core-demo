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
create or replace function pg_temp.reset_su()
returns void language plpgsql as $$
begin perform set_config('role', 'postgres', true); end $$;

-- ---- Fixtures (como superusuario; RLS se prueba luego cambiando de rol) --------
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
