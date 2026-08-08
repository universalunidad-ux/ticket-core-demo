-- U15C · TRANSACTION MATRIX (T01-T25) · EJECUTABLE CONTRA POSTGRES LOCAL
-- TC-U15C-RUNTIME-IMPLEMENT-D1-D4-01
--
-- Ejecuta public.tc_consolidar_cliente_ticket(...) después de aplicar el fix
-- D1-D4 (supabase/migrations/20260721014500_u15cd_consolidation_rpc.sql) y
-- verifica los 25 casos de
-- _ANALYSIS_OUTPUTS/TC_U15C_U15D_RESILIENCE_OPUS_AUDIT_01/03_U15C_TEST_MATRIX.csv.
--
-- Uso (Docker + Supabase CLI local, SOLO local, nunca remoto):
--   psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/u15c_transaction_matrix.sql
--
-- Estado local: TEST_HARNESS_FIXED_BUT_NOT_EXECUTED (sin PG/Docker en este
-- entorno). No se declara PASS runtime hasta que se ejecute en Docker local
-- real (ver tools/local-db/run-u15c-runtime.sh).
--
-- Convenciones (reutilizadas de supabase/tests/authz_negative.sql, no
-- duplicadas con lógica nueva de auth): pg_temp.act(uid) simula sesión
-- autenticada vía request.jwt.claims; pg_temp.act_anon() simula anon;
-- pg_temp.reset_su() vuelve a superusuario entre pruebas.
--
-- Toda la matriz corre dentro de UNA transacción y termina en ROLLBACK: no
-- persiste datos sintéticos, no requiere teardown separado.
--
-- Requisitos: baseline canónico aplicado + migración U15C con fix D1-D4
-- aplicada. Sin ambos, T25 (compilación) falla primero (fail-closed).

\set ON_ERROR_STOP on
\pset pager off

begin;

-- ============================================================================
-- FIXTURES
-- ============================================================================

insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('91111111-1111-4111-8111-111111111101', 'authenticated', 'authenticated',
   'tc-u15c-admin@example.invalid', now(),
   '{"provider":"email","providers":["email"],"fixture":"tc-u15c-matrix"}'::jsonb,
   '{"fixture":"tc-u15c-matrix","persona":"admin"}'::jsonb, now(), now()),
  ('91111111-1111-4111-8111-111111111102', 'authenticated', 'authenticated',
   'tc-u15c-soporte@example.invalid', now(),
   '{"provider":"email","providers":["email"],"fixture":"tc-u15c-matrix"}'::jsonb,
   '{"fixture":"tc-u15c-matrix","persona":"soporte"}'::jsonb, now(), now())
on conflict (id) do nothing;

do $fixture_guard$
begin
  if (
    select count(*) from auth.users
    where id in (
      '91111111-1111-4111-8111-111111111101',
      '91111111-1111-4111-8111-111111111102'
    )
  ) <> 2 then
    raise exception 'TC_U15C_FIXTURE_AUTH_USERS_MISSING' using errcode = '23503';
  end if;
end
$fixture_guard$;

insert into public.perfiles (id, rol, nombre, tema) values
  ('91111111-1111-4111-8111-111111111101', 'admin',   '[TC-U15C] Admin',   'light'),
  ('91111111-1111-4111-8111-111111111102', 'soporte', '[TC-U15C] Soporte', 'light')
on conflict (id) do nothing;

insert into public.clientes (id, nombre, telefono, correo, origen_registro, activo) values
  ('92222222-2222-4222-8222-222222222201', '[TC-U15C] Cliente Activo A', null, null, 'ticket_core', true),
  ('92222222-2222-4222-8222-222222222202', '[TC-U15C] Cliente Activo B', null, null, 'ticket_core', true)
on conflict (id) do nothing;

insert into public.clientes_contactos (id, cliente_id, nombre, correo, telefono, origen_alta, activo) values
  ('93333333-3333-4333-8333-333333333301',
   '92222222-2222-4222-8222-222222222201',
   '[TC-U15C] Contacto de A', 'contacto-a@example.invalid', null, 'ticket_consolidacion', true)
on conflict (id) do nothing;

-- Pool de tickets, uno por escenario que necesita estado independiente.
insert into public.tickets (
  id, titulo, estado, requiere_consolidacion, consolidacion_version,
  empresa_capturada, nombre_capturado, correo_capturado, telefono_capturado
) values
  ('94444444-0000-4444-8444-000000000001', '[TC-U15C] pool 01', 'abierto', true, 0, 'Empresa QA', 'Nombre QA', 'qa@example.invalid', '5550000001'),
  ('94444444-0000-4444-8444-000000000002', '[TC-U15C] pool 02', 'abierto', true, 0, 'Empresa QA', 'Nombre QA', 'qa@example.invalid', '5550000002'),
  ('94444444-0000-4444-8444-000000000003', '[TC-U15C] pool 03', 'abierto', true, 0, 'Empresa QA', 'Nombre QA', 'qa@example.invalid', '5550000003'),
  ('94444444-0000-4444-8444-000000000004', '[TC-U15C] pool 04', 'abierto', true, 0, 'Empresa QA', 'Nombre QA', 'qa@example.invalid', '5550000004'),
  ('94444444-0000-4444-8444-000000000005', '[TC-U15C] pool 05', 'abierto', true, 0, 'Empresa QA', 'Nombre QA', 'qa@example.invalid', '5550000005'),
  ('94444444-0000-4444-8444-000000000006', '[TC-U15C] pool 06', 'abierto', true, 0, 'Empresa QA', 'Nombre QA', 'qa@example.invalid', '5550000006'),
  ('94444444-0000-4444-8444-000000000007', '[TC-U15C] pool 07', 'abierto', true, 0, 'Empresa QA', 'Nombre QA', 'qa@example.invalid', '5550000007'),
  ('94444444-0000-4444-8444-000000000008', '[TC-U15C] pool 08', 'abierto', true, 0, 'Empresa QA', 'Nombre QA', 'qa@example.invalid', '5550000008'),
  ('94444444-0000-4444-8444-000000000009', '[TC-U15C] pool 09', 'abierto', true, 0, 'Empresa QA', 'Nombre QA', 'qa@example.invalid', '5550000009'),
  ('94444444-0000-4444-8444-000000000010', '[TC-U15C] pool 10', 'abierto', true, 0, 'Empresa QA', 'Nombre QA', 'qa@example.invalid', '5550000010'),
  ('94444444-0000-4444-8444-000000000011', '[TC-U15C] pool 11', 'abierto', true, 0, 'Empresa QA', 'Nombre QA', 'qa@example.invalid', '5550000011'),
  ('94444444-0000-4444-8444-000000000012', '[TC-U15C] pool 12', 'abierto', true, 0, 'Empresa QA', 'Nombre QA', 'qa@example.invalid', '5550000012'),
  ('94444444-0000-4444-8444-000000000013', '[TC-U15C] pool 13', 'abierto', true, 0, 'Empresa QA', 'Nombre QA', 'qa@example.invalid', '5550000013'),
  ('94444444-0000-4444-8444-000000000014', '[TC-U15C] pool 14', 'abierto', true, 0, 'Empresa QA', 'Nombre QA', 'qa@example.invalid', '5550000014'),
  ('94444444-0000-4444-8444-000000000015', '[TC-U15C] pool 15', 'abierto', true, 0, 'Empresa QA', 'Nombre QA', 'qa@example.invalid', '5550000015'),
  ('94444444-0000-4444-8444-000000000016', '[TC-U15C] pool 16 terminal', 'cerrado', true, 0, 'Empresa QA', 'Nombre QA', 'qa@example.invalid', '5550000016'),
  ('94444444-0000-4444-8444-000000000017', '[TC-U15C] pool 17', 'abierto', true, 0, 'Empresa QA', 'Nombre QA', 'qa@example.invalid', '5550000017'),
  ('94444444-0000-4444-8444-000000000018', '[TC-U15C] pool 18', 'abierto', true, 0, 'Empresa QA', 'Nombre QA', 'qa@example.invalid', '5550000018'),
  ('94444444-0000-4444-8444-000000000019', '[TC-U15C] pool 19', 'abierto', true, 0, 'Empresa QA', 'Nombre QA', 'qa@example.invalid', '5550000019'),
  ('94444444-0000-4444-8444-000000000020', '[TC-U15C] pool 20', 'abierto', true, 0, 'Empresa QA', 'Nombre QA', 'qa@example.invalid', '5550000020'),
  ('94444444-0000-4444-8444-000000000021', '[TC-U15C] pool 21', 'abierto', true, 0, 'Empresa QA', 'Nombre QA', 'qa@example.invalid', '5550000021'),
  ('94444444-0000-4444-8444-000000000022', '[TC-U15C] pool 22', 'abierto', true, 0, 'Empresa QA', 'Nombre QA', 'qa@example.invalid', '5550000022'),
  ('94444444-0000-4444-8444-000000000023', '[TC-U15C] pool 23 resuelto', 'abierto', false, 0, 'Empresa QA', 'Nombre QA', 'qa@example.invalid', '5550000023')
on conflict (id) do nothing;

-- Ticket 15/06 requieren contacto_id ya asignado (contact-overwrite scenarios).
update public.tickets
  set contacto_id = '93333333-3333-4333-8333-333333333301',
      cliente_id = '92222222-2222-4222-8222-222222222201'
  where id in (
    '94444444-0000-4444-8444-000000000006',
    '94444444-0000-4444-8444-000000000015'
  );

-- ============================================================================
-- HELPERS (pg_temp; viven solo en esta sesión/transacción)
-- ============================================================================

create or replace function pg_temp.act(uid uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid::text, 'role', 'authenticated')::text, true);
end $$;

create or replace function pg_temp.act_anon() returns void
language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
end $$;

create or replace function pg_temp.reset_su() returns void
language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
end $$;

create temporary table tc_fixtures (key text primary key, id uuid not null);
insert into tc_fixtures (key, id) values
  ('admin',   '91111111-1111-4111-8111-111111111101'),
  ('soporte', '91111111-1111-4111-8111-111111111102'),
  ('cliente_a', '92222222-2222-4222-8222-222222222201'),
  ('cliente_b', '92222222-2222-4222-8222-222222222202'),
  ('contacto_a1', '93333333-3333-4333-8333-333333333301'),
  ('t01', '94444444-0000-4444-8444-000000000001'),
  ('t02', '94444444-0000-4444-8444-000000000002'),
  ('t03', '94444444-0000-4444-8444-000000000003'),
  ('t04', '94444444-0000-4444-8444-000000000004'),
  ('t05', '94444444-0000-4444-8444-000000000005'),
  ('t06', '94444444-0000-4444-8444-000000000006'),
  ('t07', '94444444-0000-4444-8444-000000000007'),
  ('t08', '94444444-0000-4444-8444-000000000008'),
  ('t09', '94444444-0000-4444-8444-000000000009'),
  ('t10', '94444444-0000-4444-8444-000000000010'),
  ('t11', '94444444-0000-4444-8444-000000000011'),
  ('t12', '94444444-0000-4444-8444-000000000012'),
  ('t13', '94444444-0000-4444-8444-000000000013'),
  ('t14', '94444444-0000-4444-8444-000000000014'),
  ('t15', '94444444-0000-4444-8444-000000000015'),
  ('t16', '94444444-0000-4444-8444-000000000016'),
  ('t17', '94444444-0000-4444-8444-000000000017'),
  ('t18', '94444444-0000-4444-8444-000000000018'),
  ('t19', '94444444-0000-4444-8444-000000000019'),
  ('t20', '94444444-0000-4444-8444-000000000020'),
  ('t21', '94444444-0000-4444-8444-000000000021'),
  ('t22', '94444444-0000-4444-8444-000000000022'),
  ('t23', '94444444-0000-4444-8444-000000000023');

-- pg_temp.fx se ejecuta después de cambiar a authenticated/anon.
-- La tabla es temporal y existe únicamente durante esta transacción de prueba.
grant select on tc_fixtures to authenticated, anon;

create or replace function pg_temp.fx(p_key text) returns uuid
language sql stable as $$
  select id from tc_fixtures where key = p_key;
$$;


create or replace function pg_temp.new_key() returns text
language sql as $$
  select 'tc-u15c-test-' || replace(gen_random_uuid()::text, '-', '');
$$;

create type pg_temp.tc_call_result as (
  ok boolean,
  sqlstate_code text,
  business_code text,
  response jsonb
);

-- Envuelve la llamada a la RPC y captura tanto el retorno normal (ok=false
-- con 'code' de negocio) como los raise P0001/42501 (detail JSON) sin abortar
-- el script completo, para poder correr las 25 pruebas en una sola pasada.
create or replace function pg_temp.call_consolidar(
  p_ticket_id uuid,
  p_action text,
  p_expected_version bigint,
  p_key text,
  p_cliente_id uuid default null,
  p_contacto_id uuid default null,
  p_cliente jsonb default '{}'::jsonb,
  p_contacto jsonb default '{}'::jsonb
) returns pg_temp.tc_call_result
language plpgsql as $$
declare
  v_result pg_temp.tc_call_result;
  v_detail text;
  v_detail_json jsonb;
begin
  begin
    v_result.response := public.tc_consolidar_cliente_ticket(
      p_ticket_id, p_action, p_expected_version, p_key,
      p_cliente_id, p_contacto_id, p_cliente, p_contacto
    );
    v_result.sqlstate_code := '00000';
    v_result.ok := coalesce((v_result.response ->> 'ok')::boolean, false);
    v_result.business_code := v_result.response ->> 'code';
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    v_result.ok := false;
    v_result.sqlstate_code := sqlstate;
    begin
      v_detail_json := nullif(v_detail, '')::jsonb;
      v_result.response := v_detail_json;
      v_result.business_code := coalesce(v_detail_json ->> 'code', sqlerrm);
    exception when others then
      v_result.business_code := sqlerrm;
      v_result.response := null;
    end;
  end;
  return v_result;
end;
$$;

create temporary table tc_results (
  test_id text primary key,
  status text not null check (status in ('PASS', 'FAIL')),
  detail text,
  recorded_at timestamptz not null default clock_timestamp()
);

-- pass()/fail() se ejecutan temporalmente como authenticated/anon.
-- Esta tabla desaparece al terminar la sesión de la matriz.
grant select, insert, update on tc_results to authenticated, anon;

create or replace function pg_temp.pass(p_test text) returns void language sql as $$
  insert into tc_results (test_id, status) values (p_test, 'PASS')
  on conflict (test_id) do update set status = 'PASS', detail = null, recorded_at = clock_timestamp();
$$;

create or replace function pg_temp.fail(p_test text, p_detail text) returns void language sql as $$
  insert into tc_results (test_id, status, detail) values (p_test, 'FAIL', p_detail)
  on conflict (test_id) do update set status = 'FAIL', detail = excluded.detail, recorded_at = clock_timestamp();
$$;

-- Reinicia un ticket del pool a estado "pendiente de consolidación" limpio,
-- y borra su auditoría/decisión previas, para reutilizarlo entre pruebas.
create or replace function pg_temp.reset_ticket(
  p_id uuid,
  p_estado text default 'abierto',
  p_requiere boolean default true,
  p_version bigint default 0,
  p_cliente_sugerido uuid default null,
  p_contacto_previo uuid default null,
  p_cliente_previo uuid default null
) returns void language plpgsql as $$
begin
  perform pg_temp.reset_su();
  update public.tickets
    set estado = p_estado,
        cliente_id = p_cliente_previo,
        contacto_id = p_contacto_previo,
        cliente_id_sugerido = p_cliente_sugerido,
        contacto_id_sugerido = null,
        match_confirmado = false,
        contacto_confirmado = false,
        contacto_es_nuevo = false,
        requiere_consolidacion = p_requiere,
        consolidacion_version = p_version
    where id = p_id;
  delete from public.ticket_match_decisiones where ticket_id = p_id;
  delete from public.ticket_eventos where ticket_id = p_id;
  delete from public.bitacora where entidad_tipo = 'ticket' and entidad_id = p_id;
  -- No se limpian clientes/contactos creados por pruebas previas: toda la
  -- matriz corre en una única transacción con ROLLBACK final (o aborto ante
  -- el primer fallo no capturado), así que nada persiste entre ejecuciones
  -- del script.
end $$;

\echo 'FIXTURES_READY'

-- ============================================================================
-- T01 · HAPPY associate_existing
-- ============================================================================
do $$
declare r pg_temp.tc_call_result; v public.tickets;
begin
  perform pg_temp.reset_ticket(pg_temp.fx('t01'));
  perform pg_temp.act(pg_temp.fx('admin'));
  r := pg_temp.call_consolidar(pg_temp.fx('t01'), 'associate_existing', 0, pg_temp.new_key(), pg_temp.fx('cliente_a'));
  if not r.ok then raise exception 'expected ok=true, got %', r.response; end if;
  select * into v from public.tickets where id = pg_temp.fx('t01');
  if v.cliente_id is distinct from pg_temp.fx('cliente_a') then raise exception 'cliente_id not set'; end if;
  if v.consolidacion_version <> 1 then raise exception 'version=%, expected 1', v.consolidacion_version; end if;
  if v.requiere_consolidacion then raise exception 'requiere_consolidacion still true'; end if;
  if (select count(*) from public.ticket_eventos where ticket_id = pg_temp.fx('t01') and kind = 'sistema') <> 1 then
    raise exception 'expected exactly 1 ticket_eventos';
  end if;
  if (select count(*) from public.bitacora where entidad_tipo = 'ticket' and entidad_id = pg_temp.fx('t01') and accion = 'ticket_consolidacion') <> 1 then
    raise exception 'expected exactly 1 bitacora';
  end if;
  perform pg_temp.pass('U15C-T01-HAPPY-ASSOCIATE');
exception when others then
  perform pg_temp.fail('U15C-T01-HAPPY-ASSOCIATE', sqlstate || ': ' || sqlerrm);
end $$;
select pg_temp.reset_su();

-- ============================================================================
-- T02 · HAPPY create_new (cliente nuevo desde empresa_capturada)
-- ============================================================================
do $$
declare r pg_temp.tc_call_result; v public.tickets; n int;
begin
  perform pg_temp.reset_ticket(pg_temp.fx('t02'));
  perform pg_temp.act(pg_temp.fx('admin'));
  r := pg_temp.call_consolidar(pg_temp.fx('t02'), 'create_new', 0, pg_temp.new_key());
  if not r.ok then raise exception 'expected ok=true, got %', r.response; end if;
  select * into v from public.tickets where id = pg_temp.fx('t02');
  if v.cliente_id is null then raise exception 'cliente_id not set after create_new'; end if;
  if v.consolidacion_version <> 1 then raise exception 'version=%, expected 1', v.consolidacion_version; end if;
  select count(*) into n from public.clientes where id = v.cliente_id and nombre = 'Empresa QA';
  if n <> 1 then raise exception 'nuevo cliente no persistido con nombre esperado'; end if;
  if (r.response ->> 'code') <> 'CONSOLIDATION_COMPLETED' then raise exception 'code inesperado %', r.response; end if;
  perform pg_temp.pass('U15C-T02-HAPPY-CREATE-CLIENT');
exception when others then
  perform pg_temp.fail('U15C-T02-HAPPY-CREATE-CLIENT', sqlstate || ': ' || sqlerrm);
end $$;
select pg_temp.reset_su();

-- ============================================================================
-- T03 · Decisión humana persiste en ticket_match_decisiones (UPDATE de pendiente previa)
-- ============================================================================
do $$
declare r pg_temp.tc_call_result; v public.ticket_match_decisiones;
begin
  perform pg_temp.reset_ticket(pg_temp.fx('t03'));
  perform pg_temp.reset_su();
  insert into public.ticket_match_decisiones (ticket_id, cliente_id_sugerido, decision)
    values (pg_temp.fx('t03'), pg_temp.fx('cliente_a'), 'pendiente');
  perform pg_temp.act(pg_temp.fx('admin'));
  r := pg_temp.call_consolidar(pg_temp.fx('t03'), 'associate_existing', 0, pg_temp.new_key(), pg_temp.fx('cliente_a'));
  if not r.ok then raise exception 'expected ok=true, got %', r.response; end if;
  select * into v from public.ticket_match_decisiones where ticket_id = pg_temp.fx('t03');
  if v.decision <> 'aceptado' then raise exception 'decision=%, expected aceptado', v.decision; end if;
  if v.decidido_por is distinct from pg_temp.fx('admin') then raise exception 'decidido_por no seteado'; end if;
  if v.decidido_en is null then raise exception 'decidido_en no seteado'; end if;
  if (select count(*) from public.ticket_match_decisiones where ticket_id = pg_temp.fx('t03')) <> 1 then
    raise exception 'se insertó una segunda decisión en lugar de UPDATE';
  end if;
  perform pg_temp.pass('U15C-T03-DECISION-HUMANA');
exception when others then
  perform pg_temp.fail('U15C-T03-DECISION-HUMANA', sqlstate || ': ' || sqlerrm);
end $$;
select pg_temp.reset_su();

-- ============================================================================
-- T04 · Asocia al cliente correcto (A), no al sugerido erróneamente (B)
-- ============================================================================
do $$
declare r pg_temp.tc_call_result; v public.tickets;
begin
  perform pg_temp.reset_ticket(pg_temp.fx('t04'), p_cliente_sugerido => pg_temp.fx('cliente_b'));
  perform pg_temp.act(pg_temp.fx('admin'));
  r := pg_temp.call_consolidar(pg_temp.fx('t04'), 'associate_existing', 0, pg_temp.new_key(), pg_temp.fx('cliente_a'));
  if not r.ok then raise exception 'expected ok=true, got %', r.response; end if;
  select * into v from public.tickets where id = pg_temp.fx('t04');
  if v.cliente_id is distinct from pg_temp.fx('cliente_a') then raise exception 'cliente_id incorrecto: %', v.cliente_id; end if;
  if v.cliente_id_sugerido is not null then raise exception 'cliente_id_sugerido no se limpió'; end if;
  if (select (detalle ->> 'cliente_id')::uuid from public.bitacora
      where entidad_tipo = 'ticket' and entidad_id = pg_temp.fx('t04') and accion = 'ticket_consolidacion')
      is distinct from pg_temp.fx('cliente_a') then
    raise exception 'bitacora.detalle.cliente_id no coincide con A';
  end if;
  perform pg_temp.pass('U15C-T04-TICKET-CLIENTE-CORRECTO');
exception when others then
  perform pg_temp.fail('U15C-T04-TICKET-CLIENTE-CORRECTO', sqlstate || ': ' || sqlerrm);
end $$;
select pg_temp.reset_su();

-- ============================================================================
-- T05 · create_new crea contacto desde nombre_capturado/correo_capturado
-- ============================================================================
do $$
declare r pg_temp.tc_call_result; v public.tickets; n int;
begin
  perform pg_temp.reset_ticket(pg_temp.fx('t05'));
  perform pg_temp.act(pg_temp.fx('admin'));
  r := pg_temp.call_consolidar(
    pg_temp.fx('t05'), 'create_new', 0, pg_temp.new_key(), pg_temp.fx('cliente_a')
  );
  if not r.ok then raise exception 'expected ok=true, got %', r.response; end if;
  select * into v from public.tickets where id = pg_temp.fx('t05');
  if v.contacto_id is null then raise exception 'contacto_id no seteado'; end if;
  if not v.contacto_es_nuevo then raise exception 'contacto_es_nuevo=false, esperado true'; end if;
  select count(*) into n from public.clientes_contactos
    where id = v.contacto_id and cliente_id = pg_temp.fx('cliente_a') and nombre = 'Nombre QA';
  if n <> 1 then raise exception 'contacto nuevo no persistido con datos capturados'; end if;
  if (select decision from public.ticket_match_decisiones where ticket_id = pg_temp.fx('t05')) <> 'creado_contacto' then
    raise exception 'decision no es creado_contacto';
  end if;
  perform pg_temp.pass('U15C-T05-CREATE-OR-UPDATE-CONTACT');
exception when others then
  perform pg_temp.fail('U15C-T05-CREATE-OR-UPDATE-CONTACT', sqlstate || ': ' || sqlerrm);
end $$;
select pg_temp.reset_su();

-- ============================================================================
-- T06 · Guard CONTACT_OVERWRITE_NOT_ALLOWED: ticket ya con contacto_id, se
-- intenta crear un contacto nuevo (nombre_capturado presente) -> rollback total.
-- ============================================================================
do $$
declare r pg_temp.tc_call_result; v public.tickets; n_events int; n_audit int;
begin
  perform pg_temp.reset_ticket(pg_temp.fx('t06'), p_contacto_previo => pg_temp.fx('contacto_a1'), p_cliente_previo => pg_temp.fx('cliente_a'));
  perform pg_temp.act(pg_temp.fx('admin'));
  r := pg_temp.call_consolidar(pg_temp.fx('t06'), 'create_new', 0, pg_temp.new_key(), pg_temp.fx('cliente_a'));
  if r.ok then raise exception 'expected failure, got ok=true'; end if;
  if r.sqlstate_code <> 'P0001' then raise exception 'sqlstate=%, expected P0001', r.sqlstate_code; end if;
  if r.business_code <> 'CONTACT_OVERWRITE_NOT_ALLOWED' then raise exception 'code=%, expected CONTACT_OVERWRITE_NOT_ALLOWED', r.business_code; end if;
  select * into v from public.tickets where id = pg_temp.fx('t06');
  if v.consolidacion_version <> 0 then raise exception 'version cambió pese al rollback'; end if;
  select count(*) into n_events from public.ticket_eventos where ticket_id = pg_temp.fx('t06');
  select count(*) into n_audit from public.bitacora where entidad_tipo = 'ticket' and entidad_id = pg_temp.fx('t06');
  if n_events <> 0 or n_audit <> 0 then raise exception 'auditoría escrita pese a rollback (eventos=%, bitacora=%)', n_events, n_audit; end if;
  perform pg_temp.pass('U15C-T06-CONTACT-OVERWRITE-BLOCKED');
exception when others then
  perform pg_temp.fail('U15C-T06-CONTACT-OVERWRITE-BLOCKED', sqlstate || ': ' || sqlerrm);
end $$;
select pg_temp.reset_su();

-- ============================================================================
-- T07 · cliente_sistemas no se toca (la RPC no asocia máquinas)
-- ============================================================================
do $$
declare r pg_temp.tc_call_result; n_before int; n_after int;
begin
  perform pg_temp.reset_ticket(pg_temp.fx('t07'));
  perform pg_temp.reset_su();
  select count(*) into n_before from public.cliente_sistemas where cliente_id = pg_temp.fx('cliente_a');
  perform pg_temp.act(pg_temp.fx('admin'));
  r := pg_temp.call_consolidar(pg_temp.fx('t07'), 'associate_existing', 0, pg_temp.new_key(), pg_temp.fx('cliente_a'));
  if not r.ok then raise exception 'expected ok=true, got %', r.response; end if;
  select count(*) into n_after from public.cliente_sistemas where cliente_id = pg_temp.fx('cliente_a');
  if n_before <> n_after then raise exception 'cliente_sistemas cambió (before=%, after=%)', n_before, n_after; end if;
  perform pg_temp.pass('U15C-T07-SYSTEMS-MACHINES-ABSENT');
exception when others then
  perform pg_temp.fail('U15C-T07-SYSTEMS-MACHINES-ABSENT', sqlstate || ': ' || sqlerrm);
end $$;
select pg_temp.reset_su();

-- ============================================================================
-- T08 · Forma del evento (D4): claves de ticket_eventos.meta dentro de la
-- whitelist de app_private.ticket_event_meta_is_safe (regresión post-fix).
-- ============================================================================
do $$
declare r pg_temp.tc_call_result; v_meta jsonb; v_safe boolean;
begin
  perform pg_temp.reset_ticket(pg_temp.fx('t08'));
  perform pg_temp.act(pg_temp.fx('admin'));
  r := pg_temp.call_consolidar(pg_temp.fx('t08'), 'associate_existing', 0, pg_temp.new_key(), pg_temp.fx('cliente_a'));
  if not r.ok then raise exception 'expected ok=true (D4 debe estar resuelto), got %', r.response; end if;
  -- app_private.ticket_event_meta_is_safe solo tiene EXECUTE para service_role;
  -- se verifica como superusuario (no afecta la aserción, solo el permiso de llamada).
  perform pg_temp.reset_su();
  select meta into v_meta from public.ticket_eventos where ticket_id = pg_temp.fx('t08') and kind = 'sistema';
  select app_private.ticket_event_meta_is_safe(v_meta) into v_safe;
  if not v_safe then raise exception 'meta fuera de whitelist: %', v_meta; end if;
  if v_meta ? 'action' then raise exception 'meta conserva clave prohibida "action"'; end if;
  if v_meta ? 'event' or v_meta ? 'operation_id' or v_meta ? 'previous_version' or v_meta ? 'new_version' then
    raise exception 'meta conserva claves fuera de whitelist: %', v_meta;
  end if;
  if not (v_meta ? 'accion' and v_meta ? 'idempotency_key') then
    raise exception 'meta no contiene el payload mínimo esperado: %', v_meta;
  end if;
  if (select count(*) from public.ticket_eventos where ticket_id = pg_temp.fx('t08')) <> 1
     or (select count(*) from public.bitacora where entidad_tipo = 'ticket' and entidad_id = pg_temp.fx('t08')) <> 1 then
    raise exception 'auditoría no es exactamente 1+1';
  end if;
  perform pg_temp.pass('U15C-T08-AUDIT-EVENT-SHAPE');
exception when others then
  perform pg_temp.fail('U15C-T08-AUDIT-EVENT-SHAPE', sqlstate || ': ' || sqlerrm);
end $$;
select pg_temp.reset_su();

-- ============================================================================
-- T09 · Replay misma key + mismo payload -> respuesta original + replayed=true, 0 filas nuevas
-- ============================================================================
do $$
declare r1 pg_temp.tc_call_result; r2 pg_temp.tc_call_result; v_key text; n_events int; n_audit int;
begin
  perform pg_temp.reset_ticket(pg_temp.fx('t09'));
  v_key := pg_temp.new_key();
  perform pg_temp.act(pg_temp.fx('admin'));
  r1 := pg_temp.call_consolidar(pg_temp.fx('t09'), 'associate_existing', 0, v_key, pg_temp.fx('cliente_a'));
  if not r1.ok then raise exception 'primera llamada falló: %', r1.response; end if;
  select count(*) into n_events from public.ticket_eventos where ticket_id = pg_temp.fx('t09');
  select count(*) into n_audit from public.bitacora where entidad_tipo = 'ticket' and entidad_id = pg_temp.fx('t09');
  r2 := pg_temp.call_consolidar(pg_temp.fx('t09'), 'associate_existing', 0, v_key, pg_temp.fx('cliente_a'));
  if not r2.ok then raise exception 'replay falló: %', r2.response; end if;
  if coalesce((r2.response ->> 'replayed')::boolean, false) is not true then raise exception 'replayed no es true: %', r2.response; end if;
  if r2.response ->> 'operation_id' is distinct from r1.response ->> 'operation_id' then
    raise exception 'operation_id cambió entre original y replay';
  end if;
  if (select count(*) from public.ticket_eventos where ticket_id = pg_temp.fx('t09')) <> n_events
     or (select count(*) from public.bitacora where entidad_tipo = 'ticket' and entidad_id = pg_temp.fx('t09')) <> n_audit then
    raise exception 'replay generó filas de auditoría nuevas';
  end if;
  perform pg_temp.pass('U15C-T09-REPLAY-SAME-REQUEST');
exception when others then
  perform pg_temp.fail('U15C-T09-REPLAY-SAME-REQUEST', sqlstate || ': ' || sqlerrm);
end $$;
select pg_temp.reset_su();

-- ============================================================================
-- T10 · Misma key, payload distinto -> 409 IDEMPOTENCY_PAYLOAD_MISMATCH, sin escrituras
-- ============================================================================
do $$
declare r1 pg_temp.tc_call_result; r2 pg_temp.tc_call_result; v_key text; v_before bigint;
begin
  perform pg_temp.reset_ticket(pg_temp.fx('t10'));
  v_key := pg_temp.new_key();
  perform pg_temp.act(pg_temp.fx('admin'));
  r1 := pg_temp.call_consolidar(pg_temp.fx('t10'), 'associate_existing', 0, v_key, pg_temp.fx('cliente_a'));
  if not r1.ok then raise exception 'primera llamada falló: %', r1.response; end if;
  select consolidacion_version into v_before from public.tickets where id = pg_temp.fx('t10');
  -- Misma key, mismo ticket, pero acción distinta -> hash distinto.
  r2 := pg_temp.call_consolidar(pg_temp.fx('t10'), 'discard_candidate', v_before, v_key);
  if r2.ok then raise exception 'esperado ok=false por mismatch, got ok=true'; end if;
  if r2.sqlstate_code <> '00000' then raise exception 'mismatch debe ser retorno normal, no excepción (sqlstate=%)', r2.sqlstate_code; end if;
  if r2.business_code <> 'IDEMPOTENCY_PAYLOAD_MISMATCH' then raise exception 'code=%, expected IDEMPOTENCY_PAYLOAD_MISMATCH', r2.business_code; end if;
  if (select consolidacion_version from public.tickets where id = pg_temp.fx('t10')) <> v_before then
    raise exception 'version cambió pese a mismatch';
  end if;
  perform pg_temp.pass('U15C-T10-REPLAY-DIFF-PAYLOAD');
exception when others then
  perform pg_temp.fail('U15C-T10-REPLAY-DIFF-PAYLOAD', sqlstate || ': ' || sqlerrm);
end $$;
select pg_temp.reset_su();

-- ============================================================================
-- T11 · key con status=processing (simulando carrera) -> 409 IDEMPOTENCY_IN_PROGRESS
-- ============================================================================
do $$
declare r pg_temp.tc_call_result; v_key text; v_hash text;
begin
  perform pg_temp.reset_ticket(pg_temp.fx('t11'));
  v_key := pg_temp.new_key();
  v_hash := encode(
    sha256(convert_to(
      jsonb_build_object(
      'ticket_id', pg_temp.fx('t11'),
      'action', 'associate_existing',
      'expected_version', 0,
      'cliente_id', pg_temp.fx('cliente_a'),
      'contacto_id', null::uuid,
      'cliente', '{}'::jsonb,
      'contacto', '{}'::jsonb
    )::text,
      'UTF8'
    )),
    'hex'
  );
  perform pg_temp.reset_su();
  insert into public.edge_idempotency (idempotency_key, action, resource_id, request_hash, status)
    values (v_key, 'consolidar_cliente', pg_temp.fx('t11'), v_hash, 'processing');
  perform pg_temp.act(pg_temp.fx('admin'));
  r := pg_temp.call_consolidar(pg_temp.fx('t11'), 'associate_existing', 0, v_key, pg_temp.fx('cliente_a'));
  if r.ok then raise exception 'esperado ok=false (in progress), got ok=true'; end if;
  if r.sqlstate_code <> '00000' then raise exception 'IN_PROGRESS debe ser retorno normal (sqlstate=%)', r.sqlstate_code; end if;
  if r.business_code <> 'IDEMPOTENCY_IN_PROGRESS' then raise exception 'code=%, expected IDEMPOTENCY_IN_PROGRESS', r.business_code; end if;
  if (select requiere_consolidacion from public.tickets where id = pg_temp.fx('t11')) is not true then
    raise exception 'ticket fue modificado pese a IN_PROGRESS';
  end if;
  perform pg_temp.pass('U15C-T11-KEY-REUSE-INPROGRESS');
exception when others then
  perform pg_temp.fail('U15C-T11-KEY-REUSE-INPROGRESS', sqlstate || ': ' || sqlerrm);
end $$;
select pg_temp.reset_su();

-- ============================================================================
-- T12 · Ticket inexistente -> 404 TICKET_NOT_FOUND, claim revertido (rollback)
-- ============================================================================
do $$
declare r pg_temp.tc_call_result; v_missing uuid := gen_random_uuid(); v_key text;
begin
  v_key := pg_temp.new_key();
  perform pg_temp.act(pg_temp.fx('admin'));
  r := pg_temp.call_consolidar(v_missing, 'associate_existing', 0, v_key, pg_temp.fx('cliente_a'));
  if r.ok then raise exception 'expected failure, got ok=true'; end if;
  if r.sqlstate_code <> 'P0001' then raise exception 'sqlstate=%, expected P0001', r.sqlstate_code; end if;
  if r.business_code <> 'TICKET_NOT_FOUND' then raise exception 'code=%, expected TICKET_NOT_FOUND', r.business_code; end if;
  perform pg_temp.reset_su();
  if exists (select 1 from public.edge_idempotency where idempotency_key = v_key) then
    raise exception 'claim de idempotencia no se revirtió tras el fallo';
  end if;
  perform pg_temp.pass('U15C-T12-FAIL-BEFORE-WRITE');
exception when others then
  perform pg_temp.fail('U15C-T12-FAIL-BEFORE-WRITE', sqlstate || ': ' || sqlerrm);
end $$;
select pg_temp.reset_su();

-- ============================================================================
-- T13 · expected_version obsoleta -> 409 STALE_EXPECTED_VERSION
-- ============================================================================
do $$
declare r pg_temp.tc_call_result;
begin
  perform pg_temp.reset_ticket(pg_temp.fx('t13'), p_version => 2);
  perform pg_temp.act(pg_temp.fx('admin'));
  r := pg_temp.call_consolidar(pg_temp.fx('t13'), 'associate_existing', 0, pg_temp.new_key(), pg_temp.fx('cliente_a'));
  if r.ok then raise exception 'expected failure, got ok=true'; end if;
  if r.sqlstate_code <> 'P0001' then raise exception 'sqlstate=%, expected P0001', r.sqlstate_code; end if;
  if r.business_code <> 'STALE_EXPECTED_VERSION' then raise exception 'code=%, expected STALE_EXPECTED_VERSION', r.business_code; end if;
  if (select consolidacion_version from public.tickets where id = pg_temp.fx('t13')) <> 2 then
    raise exception 'version cambió pese al conflicto';
  end if;
  perform pg_temp.pass('U15C-T13-FAIL-STALE-VERSION');
exception when others then
  perform pg_temp.fail('U15C-T13-FAIL-STALE-VERSION', sqlstate || ': ' || sqlerrm);
end $$;
select pg_temp.reset_su();

-- ============================================================================
-- T14 · create_new (cliente nuevo) + p_contacto_id ajeno -> CONTACT_NOT_OWNED_BY_CLIENT,
-- rollback total, 0 clientes persistidos (el cliente recién creado también se revierte).
-- ============================================================================
do $$
declare r pg_temp.tc_call_result; n int;
begin
  perform pg_temp.reset_ticket(pg_temp.fx('t14'));
  perform pg_temp.act(pg_temp.fx('admin'));
  r := pg_temp.call_consolidar(
    pg_temp.fx('t14'), 'create_new', 0, pg_temp.new_key(),
    null, pg_temp.fx('contacto_a1'),
    jsonb_build_object('nombre', '[TC-U15C-CREATED] T14 no debe persistir')
  );
  if r.ok then raise exception 'expected failure, got ok=true'; end if;
  if r.sqlstate_code <> 'P0001' then raise exception 'sqlstate=%, expected P0001', r.sqlstate_code; end if;
  if r.business_code <> 'CONTACT_NOT_OWNED_BY_CLIENT' then raise exception 'code=%, expected CONTACT_NOT_OWNED_BY_CLIENT', r.business_code; end if;
  perform pg_temp.reset_su();
  select count(*) into n from public.clientes where nombre = '[TC-U15C-CREATED] T14 no debe persistir';
  if n <> 0 then raise exception 'cliente huérfano persistido (n=%)', n; end if;
  perform pg_temp.pass('U15C-T14-FAIL-AFTER-CREATE-CLIENT');
exception when others then
  perform pg_temp.fail('U15C-T14-FAIL-AFTER-CREATE-CLIENT', sqlstate || ': ' || sqlerrm);
end $$;
select pg_temp.reset_su();

-- ============================================================================
-- T15 · create_new (cliente nuevo) con ticket.contacto_id ya asignado y
-- nombre_capturado presente -> CONTACT_OVERWRITE_NOT_ALLOWED, rollback total.
-- ============================================================================
do $$
declare r pg_temp.tc_call_result; n_cliente int; n_contacto int;
begin
  perform pg_temp.reset_ticket(pg_temp.fx('t15'), p_contacto_previo => pg_temp.fx('contacto_a1'), p_cliente_previo => pg_temp.fx('cliente_a'));
  perform pg_temp.act(pg_temp.fx('admin'));
  r := pg_temp.call_consolidar(
    pg_temp.fx('t15'), 'create_new', 0, pg_temp.new_key(),
    null, null,
    jsonb_build_object('nombre', '[TC-U15C-CREATED] T15 no debe persistir')
  );
  if r.ok then raise exception 'expected failure, got ok=true'; end if;
  if r.sqlstate_code <> 'P0001' then raise exception 'sqlstate=%, expected P0001', r.sqlstate_code; end if;
  if r.business_code <> 'CONTACT_OVERWRITE_NOT_ALLOWED' then raise exception 'code=%, expected CONTACT_OVERWRITE_NOT_ALLOWED', r.business_code; end if;
  perform pg_temp.reset_su();
  select count(*) into n_cliente from public.clientes where nombre = '[TC-U15C-CREATED] T15 no debe persistir';
  select count(*) into n_contacto from public.clientes_contactos where cliente_id in (
    select id from public.clientes where nombre = '[TC-U15C-CREATED] T15 no debe persistir'
  );
  if n_cliente <> 0 or n_contacto <> 0 then
    raise exception 'filas huérfanas tras rollback (clientes=%, contactos=%)', n_cliente, n_contacto;
  end if;
  perform pg_temp.pass('U15C-T15-FAIL-AFTER-CREATE-CONTACT');
exception when others then
  perform pg_temp.fail('U15C-T15-FAIL-AFTER-CREATE-CONTACT', sqlstate || ': ' || sqlerrm);
end $$;
select pg_temp.reset_su();

-- ============================================================================
-- T16 · Ticket en estado terminal (cerrado) -> 409 TICKET_TERMINAL_STATE
-- ============================================================================
do $$
declare r pg_temp.tc_call_result;
begin
  perform pg_temp.reset_ticket(pg_temp.fx('t16'), p_estado => 'cerrado');
  perform pg_temp.act(pg_temp.fx('admin'));
  r := pg_temp.call_consolidar(pg_temp.fx('t16'), 'associate_existing', 0, pg_temp.new_key(), pg_temp.fx('cliente_a'));
  if r.ok then raise exception 'expected failure, got ok=true'; end if;
  if r.sqlstate_code <> 'P0001' then raise exception 'sqlstate=%, expected P0001', r.sqlstate_code; end if;
  if r.business_code <> 'TICKET_TERMINAL_STATE' then raise exception 'code=%, expected TICKET_TERMINAL_STATE', r.business_code; end if;
  perform pg_temp.pass('U15C-T16-FAIL-AFTER-TICKET-ASSOC');
exception when others then
  perform pg_temp.fail('U15C-T16-FAIL-AFTER-TICKET-ASSOC', sqlstate || ': ' || sqlerrm);
end $$;
select pg_temp.reset_su();

-- ============================================================================
-- T17 · Regresión D4: create_new (cliente+contacto nuevos) ya NO falla en el
-- INSERT de ticket_eventos (pre-fix daba 23514). Debe completar limpio, 0
-- filas huérfanas porque la operación commitea entera.
-- ============================================================================
do $$
declare r pg_temp.tc_call_result; v public.tickets; n_cliente int; n_contacto int;
begin
  perform pg_temp.reset_ticket(pg_temp.fx('t17'));
  perform pg_temp.act(pg_temp.fx('admin'));
  r := pg_temp.call_consolidar(
    pg_temp.fx('t17'), 'create_new', 0, pg_temp.new_key(),
    null, null,
    jsonb_build_object('nombre', '[TC-U15C-CREATED] T17'),
    jsonb_build_object('nombre', '[TC-U15C-CREATED] T17 contacto')
  );
  if not r.ok then raise exception 'D4 no está resuelto: %', r.response; end if;
  select * into v from public.tickets where id = pg_temp.fx('t17');
  select count(*) into n_cliente from public.clientes where nombre = '[TC-U15C-CREATED] T17';
  select count(*) into n_contacto from public.clientes_contactos where nombre = '[TC-U15C-CREATED] T17 contacto';
  if n_cliente <> 1 then raise exception 'cliente no persistido (n=%)', n_cliente; end if;
  if n_contacto <> 1 then raise exception 'contacto no persistido (n=%)', n_contacto; end if;
  if (select count(*) from public.ticket_match_decisiones where ticket_id = pg_temp.fx('t17')) <> 1 then
    raise exception 'decisión no persistida exactamente una vez';
  end if;
  perform pg_temp.pass('U15C-T17-NO-ORPHAN-ROWS');
exception when others then
  perform pg_temp.fail('U15C-T17-NO-ORPHAN-ROWS', sqlstate || ': ' || sqlerrm);
end $$;
select pg_temp.reset_su();

-- ============================================================================
-- T18 · Auditoría exactamente una vez tras 1 ejecución real + 1 replay
-- ============================================================================
do $$
declare r1 pg_temp.tc_call_result; r2 pg_temp.tc_call_result; v_key text;
begin
  perform pg_temp.reset_ticket(pg_temp.fx('t18'));
  v_key := pg_temp.new_key();
  perform pg_temp.act(pg_temp.fx('admin'));
  r1 := pg_temp.call_consolidar(pg_temp.fx('t18'), 'associate_existing', 0, v_key, pg_temp.fx('cliente_a'));
  if not r1.ok then raise exception 'primera llamada falló: %', r1.response; end if;
  r2 := pg_temp.call_consolidar(pg_temp.fx('t18'), 'associate_existing', 0, v_key, pg_temp.fx('cliente_a'));
  if not r2.ok or coalesce((r2.response ->> 'replayed')::boolean, false) is not true then
    raise exception 'segunda llamada debía ser replay: %', r2.response;
  end if;
  if (select count(*) from public.ticket_eventos where ticket_id = pg_temp.fx('t18')) <> 1 then
    raise exception 'ticket_eventos != 1 tras execute+replay';
  end if;
  if (select count(*) from public.bitacora where entidad_tipo = 'ticket' and entidad_id = pg_temp.fx('t18') and accion = 'ticket_consolidacion') <> 1 then
    raise exception 'bitacora != 1 tras execute+replay';
  end if;
  perform pg_temp.pass('U15C-T18-AUDIT-EXACTLY-ONCE');
exception when others then
  perform pg_temp.fail('U15C-T18-AUDIT-EXACTLY-ONCE', sqlstate || ': ' || sqlerrm);
end $$;
select pg_temp.reset_su();

-- ============================================================================
-- T19 · Rol soporte autenticado -> 42501 (admin role required)
-- ============================================================================
do $$
declare r pg_temp.tc_call_result;
begin
  perform pg_temp.reset_ticket(pg_temp.fx('t19'));
  perform pg_temp.act(pg_temp.fx('soporte'));
  r := pg_temp.call_consolidar(pg_temp.fx('t19'), 'associate_existing', 0, pg_temp.new_key(), pg_temp.fx('cliente_a'));
  if r.ok then raise exception 'expected failure, got ok=true'; end if;
  if r.sqlstate_code <> '42501' then raise exception 'sqlstate=%, expected 42501', r.sqlstate_code; end if;
  perform pg_temp.reset_su();
  if (select consolidacion_version from public.tickets where id = pg_temp.fx('t19')) <> 0 then
    raise exception 'ticket modificado pese a rol no autorizado';
  end if;
  perform pg_temp.pass('U15C-T19-NON-ADMIN-DENIED');
exception when others then
  perform pg_temp.fail('U15C-T19-NON-ADMIN-DENIED', sqlstate || ': ' || sqlerrm);
end $$;
select pg_temp.reset_su();

-- ============================================================================
-- T20 · anon sin auth.uid() -> 42501 (authentication required)
-- ============================================================================
do $$
declare r pg_temp.tc_call_result;
begin
  perform pg_temp.reset_ticket(pg_temp.fx('t20'));
  perform pg_temp.act_anon();
  r := pg_temp.call_consolidar(pg_temp.fx('t20'), 'associate_existing', 0, pg_temp.new_key(), pg_temp.fx('cliente_a'));
  if r.ok then raise exception 'expected failure, got ok=true'; end if;
  if r.sqlstate_code <> '42501' then raise exception 'sqlstate=%, expected 42501', r.sqlstate_code; end if;
  perform pg_temp.pass('U15C-T20-ANON-DENIED');
exception when others then
  perform pg_temp.fail('U15C-T20-ANON-DENIED', sqlstate || ': ' || sqlerrm);
end $$;
select pg_temp.reset_su();

-- ============================================================================
-- T21 · postpone mantiene requiere_consolidacion=true, avanza versión,
-- decision='pendiente' sin decidido_por
-- ============================================================================
do $$
declare r pg_temp.tc_call_result; v public.tickets; v_dec public.ticket_match_decisiones;
begin
  perform pg_temp.reset_ticket(pg_temp.fx('t21'));
  perform pg_temp.act(pg_temp.fx('admin'));
  r := pg_temp.call_consolidar(pg_temp.fx('t21'), 'postpone', 0, pg_temp.new_key());
  if not r.ok then raise exception 'expected ok=true, got %', r.response; end if;
  select * into v from public.tickets where id = pg_temp.fx('t21');
  if v.requiere_consolidacion is not true then raise exception 'requiere_consolidacion debe seguir true'; end if;
  if v.consolidacion_version <> 1 then raise exception 'version=%, expected 1', v.consolidacion_version; end if;
  select * into v_dec from public.ticket_match_decisiones where ticket_id = pg_temp.fx('t21');
  if v_dec.decision <> 'pendiente' then raise exception 'decision=%, expected pendiente', v_dec.decision; end if;
  if v_dec.decidido_por is not null then raise exception 'decidido_por debería ser null en postpone'; end if;
  if (select count(*) from public.ticket_eventos where ticket_id = pg_temp.fx('t21')) <> 1
     or (select count(*) from public.bitacora where entidad_tipo = 'ticket' and entidad_id = pg_temp.fx('t21')) <> 1 then
    raise exception 'auditoría no es exactamente 1+1 en postpone';
  end if;
  perform pg_temp.pass('U15C-T21-POSTPONE-KEEPS-PENDING');
exception when others then
  perform pg_temp.fail('U15C-T21-POSTPONE-KEEPS-PENDING', sqlstate || ': ' || sqlerrm);
end $$;
select pg_temp.reset_su();

-- ============================================================================
-- T22 · discard_candidate limpia sugerencias y marca decision='ignorado'
-- ============================================================================
do $$
declare r pg_temp.tc_call_result; v public.tickets;
begin
  perform pg_temp.reset_ticket(pg_temp.fx('t22'), p_cliente_sugerido => pg_temp.fx('cliente_a'));
  perform pg_temp.act(pg_temp.fx('admin'));
  r := pg_temp.call_consolidar(pg_temp.fx('t22'), 'discard_candidate', 0, pg_temp.new_key());
  if not r.ok then raise exception 'expected ok=true, got %', r.response; end if;
  select * into v from public.tickets where id = pg_temp.fx('t22');
  if v.cliente_id_sugerido is not null then raise exception 'cliente_id_sugerido no se limpió'; end if;
  if v.match_confirmado is not false then raise exception 'match_confirmado debe ser false'; end if;
  if v.requiere_consolidacion is not false then raise exception 'requiere_consolidacion debe ser false tras discard'; end if;
  if (select decision from public.ticket_match_decisiones where ticket_id = pg_temp.fx('t22')) <> 'ignorado' then
    raise exception 'decision no es ignorado';
  end if;
  perform pg_temp.pass('U15C-T22-DISCARD-CLEARS-SUGGESTION');
exception when others then
  perform pg_temp.fail('U15C-T22-DISCARD-CLEARS-SUGGESTION', sqlstate || ': ' || sqlerrm);
end $$;
select pg_temp.reset_su();

-- ============================================================================
-- T23 · requiere_consolidacion=false -> 409 CONSOLIDATION_ALREADY_RESOLVED
-- ============================================================================
do $$
declare r pg_temp.tc_call_result;
begin
  perform pg_temp.reset_ticket(pg_temp.fx('t23'), p_requiere => false);
  perform pg_temp.act(pg_temp.fx('admin'));
  r := pg_temp.call_consolidar(pg_temp.fx('t23'), 'associate_existing', 0, pg_temp.new_key(), pg_temp.fx('cliente_a'));
  if r.ok then raise exception 'expected failure, got ok=true'; end if;
  if r.sqlstate_code <> 'P0001' then raise exception 'sqlstate=%, expected P0001', r.sqlstate_code; end if;
  if r.business_code <> 'CONSOLIDATION_ALREADY_RESOLVED' then raise exception 'code=%, expected CONSOLIDATION_ALREADY_RESOLVED', r.business_code; end if;
  perform pg_temp.pass('U15C-T23-ALREADY-RESOLVED');
exception when others then
  perform pg_temp.fail('U15C-T23-ALREADY-RESOLVED', sqlstate || ': ' || sqlerrm);
end $$;
select pg_temp.reset_su();

-- ============================================================================
-- T24 · Regresión D1: el primer claim de idempotencia YA NO viola el CHECK
-- de edge_idempotency.action (pre-fix: 23514 con 'tc_consolidar_cliente_ticket').
-- ============================================================================
do $$
declare r pg_temp.tc_call_result; v_action text;
begin
  perform pg_temp.reset_ticket(pg_temp.fx('t01'));
  perform pg_temp.act(pg_temp.fx('admin'));
  r := pg_temp.call_consolidar(pg_temp.fx('t01'), 'postpone', 0, pg_temp.new_key());
  if r.sqlstate_code = '23514' then
    raise exception 'D1 NO resuelto: check_violation en edge_idempotency.action';
  end if;
  if not r.ok then raise exception 'llamada inesperadamente falló (no D1): %', r.response; end if;
  perform pg_temp.reset_su();
  select action into v_action from public.edge_idempotency
    where resource_id = pg_temp.fx('t01') order by created_at desc limit 1;
  if v_action <> 'consolidar_cliente' then raise exception 'action=%, expected consolidar_cliente', v_action; end if;
  perform pg_temp.pass('U15C-T24-DEFECT-D1-ACTION-CHECK');
exception when others then
  perform pg_temp.fail('U15C-T24-DEFECT-D1-ACTION-CHECK', sqlstate || ': ' || sqlerrm);
end $$;
select pg_temp.reset_su();

-- ============================================================================
-- T25 · Regresión D2/D3: la función existe, compiló (CREATE FUNCTION con
-- check_function_bodies=on no debe haber fallado) y no referencia documento_id.
-- ============================================================================
do $$
declare v_oid oid; v_def text;
begin
  perform pg_temp.reset_su();
  v_oid := to_regprocedure('public.tc_consolidar_cliente_ticket(uuid,text,bigint,text,uuid,uuid,jsonb,jsonb)');
  if v_oid is null then raise exception 'D2/D3 NO resuelto: la función no existe/no compiló'; end if;
  select pg_get_functiondef(v_oid) into v_def;
  if v_def ilike '%documento_id%' then raise exception 'D2/D3 NO resuelto: aún referencia documento_id'; end if;
  perform pg_temp.pass('U15C-T25-DEFECT-D2-D3-DOCUMENTO-ID');
exception when others then
  perform pg_temp.fail('U15C-T25-DEFECT-D2-D3-DOCUMENTO-ID', sqlstate || ': ' || sqlerrm);
end $$;

-- ============================================================================
-- REPORTE FINAL
-- ============================================================================
\echo 'U15C_TRANSACTION_MATRIX_RESULTS'
select test_id, status, detail from tc_results order by test_id;

do $$
declare v_total int; v_pass int; v_fail int;
begin
  select count(*), count(*) filter (where status = 'PASS'), count(*) filter (where status = 'FAIL')
    into v_total, v_pass, v_fail
    from tc_results;
  raise notice 'U15C_TRANSACTION_MATRIX_SUMMARY total=% pass=% fail=%', v_total, v_pass, v_fail;
  if v_total <> 25 then
    raise exception 'U15C_TRANSACTION_MATRIX_INCOMPLETE: se esperaban 25 resultados, hay %', v_total;
  end if;
  if v_fail > 0 then
    raise exception 'U15C_TRANSACTION_MATRIX_FAILED: % de % pruebas fallaron', v_fail, v_total;
  end if;
end $$;

\echo 'U15C_TRANSACTION_MATRIX=PASS'

rollback;
