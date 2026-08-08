-- ============================================================================
-- U15D · Runtime de public.manage_ticket_assignment (LOCAL).
--   psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/u15d_assignment_runtime.sql
-- Crea fixtures sintéticos dentro de una transacción y hace ROLLBACK al final
-- (no persiste). Simula sesiones Supabase con request.jwt.claims (mismo
-- patrón que supabase/tests/authz_negative.sql: pg_temp.act/act_anon/
-- act_service/reset_su). No modifica la RPC ni conecta reglas_asignacion.
-- Estado: TC-U15D-ASSIGNMENT-RUNTIME-01.
-- ============================================================================
\set ON_ERROR_STOP on
begin;

-- ---- Helpers de sesión (mismo patrón que authz_negative.sql) --------------
create or replace function pg_temp.act(uid uuid)
returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid::text, 'role', 'authenticated')::text, true);
end $$;

create or replace function pg_temp.act_forged(uid uuid, forged_role text)
returns void language plpgsql as $$
begin
  -- Simula un JWT con user_metadata/claims falsificados afirmando un rol
  -- distinto al de public.perfiles. El RPC debe ignorar esto: solo confía
  -- en request.jwt.claims.role para 'service_role' y en perfiles.rol vía
  -- app_private.has_role() para todo lo demás.
  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', uid::text, 'role', 'authenticated', 'user_metadata', json_build_object('rol', forged_role))::text,
    true
  );
end $$;

create or replace function pg_temp.act_anon()
returns void language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
end $$;

create or replace function pg_temp.act_service()
returns void language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
end $$;

create or replace function pg_temp.reset_su()
returns void language plpgsql as $$
begin perform set_config('role', 'postgres', true); end $$;

-- Hash determinístico de 64 hex (sin pgcrypto): dos md5 concatenados.
create or replace function pg_temp.fake_hash(label text)
returns text language sql as $$
  select md5(label) || md5(label || ':u15d');
$$;

-- ---- Fixtures (como superusuario) ------------------------------------------
insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('d15d0000-0000-0000-0000-000000000001','authenticated','authenticated','u15d-admin@example.invalid',now(),'{}'::jsonb,'{"persona":"admin"}'::jsonb,now(),now()),
  ('d15d0000-0000-0000-0000-000000000002','authenticated','authenticated','u15d-supervisor@example.invalid',now(),'{}'::jsonb,'{"persona":"supervisor"}'::jsonb,now(),now()),
  ('d15d0000-0000-0000-0000-000000000003','authenticated','authenticated','u15d-soporte-a@example.invalid',now(),'{}'::jsonb,'{"persona":"soporte-a"}'::jsonb,now(),now()),
  ('d15d0000-0000-0000-0000-000000000004','authenticated','authenticated','u15d-soporte-b@example.invalid',now(),'{}'::jsonb,'{"persona":"soporte-b"}'::jsonb,now(),now()),
  ('d15d0000-0000-0000-0000-000000000005','authenticated','authenticated','u15d-sin-perfil@example.invalid',now(),'{}'::jsonb,'{"persona":"sin-perfil"}'::jsonb,now(),now())
on conflict (id) do nothing;

insert into public.perfiles (id, rol, nombre, tema, activo) values
  ('d15d0000-0000-0000-0000-000000000001','admin','U15D Admin','light',true),
  ('d15d0000-0000-0000-0000-000000000002','supervisor','U15D Supervisor','light',true),
  ('d15d0000-0000-0000-0000-000000000003','soporte','U15D Soporte A','light',true),
  ('d15d0000-0000-0000-0000-000000000004','soporte','U15D Soporte B','light',true)
on conflict (id) do nothing;
-- d15d...05 queda SIN perfil a propósito (usuario autenticado sin perfil).

insert into public.clientes (id, nombre, origen_registro) values
  ('d15d1111-1111-1111-1111-111111111111','U15D Cliente','ticket_core')
on conflict (id) do nothing;

insert into public.tickets (id, cliente_id, asignado_a, titulo, estado, prioridad, folio) values
  ('d15d2222-0000-0000-0000-000000000001','d15d1111-1111-1111-1111-111111111111', null, 'U15D Ticket 1','abierto','media','U15D-T1'),
  ('d15d2222-0000-0000-0000-000000000002','d15d1111-1111-1111-1111-111111111111', null, 'U15D Ticket 2','abierto','media','U15D-T2'),
  ('d15d2222-0000-0000-0000-000000000003','d15d1111-1111-1111-1111-111111111111', null, 'U15D Ticket 3','abierto','media','U15D-T3')
on conflict (id) do nothing;

-- ============================================================================
-- 1) ASIGNACIÓN INICIAL (positiva, admin) + TICKET_EVENTOS + AUDITORÍA
-- ============================================================================
do $$
declare
  v_before public.tickets;
  v_result public.tickets;
  v_evt_count int;
  v_bit_count int;
begin
  select * into v_before from public.tickets where id = 'd15d2222-0000-0000-0000-000000000001';

  perform pg_temp.act('d15d0000-0000-0000-0000-000000000001'); -- admin
  select * into v_result from public.manage_ticket_assignment(
    'd15d2222-0000-0000-0000-000000000001'::uuid,
    'd15d0000-0000-0000-0000-000000000003'::uuid, -- soporte A
    'u15d-assign-initial-0001',
    pg_temp.fake_hash('assign-initial-0001'),
    v_before.fecha_actualizacion
  );
  perform pg_temp.reset_su();

  if v_result.asignado_a is distinct from 'd15d0000-0000-0000-0000-000000000003'::uuid then
    raise exception 'FAIL: asignación inicial no fijó asignado_a (got %)', v_result.asignado_a;
  end if;
  if v_result.asignado_en is null then
    raise exception 'FAIL: asignación inicial no fijó asignado_en';
  end if;
  -- Nota: todo este archivo corre dentro de una única transacción explícita
  -- (begin ... rollback), y now() es constante durante toda la transacción
  -- en PostgreSQL real; por eso NO se exige fecha_actualizacion > anterior
  -- aquí (sería un falso negativo). La prueba de concurrencia optimista real
  -- está en el bloque 6) con un expected_fecha_actualizacion deliberadamente
  -- obsoleto, no en la variación de now().
  if v_result.fecha_actualizacion is null then
    raise exception 'FAIL: asignación inicial no fijó fecha_actualizacion';
  end if;

  select count(*) into v_evt_count from public.ticket_eventos
    where ticket_id = 'd15d2222-0000-0000-0000-000000000001' and kind = 'asignacion'
      and idempotency_key = 'u15d-assign-initial-0001';
  if v_evt_count <> 1 then
    raise exception 'FAIL: ticket_eventos asignacion count=% (esperado 1)', v_evt_count;
  end if;

  select count(*) into v_bit_count from public.bitacora
    where entidad_tipo = 'ticket' and entidad_id = 'd15d2222-0000-0000-0000-000000000001'
      and accion = 'ticket_asignado';
  if v_bit_count <> 1 then
    raise exception 'FAIL: bitacora ticket_asignado count=% (esperado 1)', v_bit_count;
  end if;

  raise notice 'PASS: asignación inicial (admin) + ticket_eventos(1) + bitacora(1)';
end $$;

-- ============================================================================
-- 2) REASIGNACIÓN (soporte A -> soporte B) con expected_fecha_actualizacion correcto
-- ============================================================================
do $$
declare
  v_before public.tickets;
  v_result public.tickets;
begin
  select * into v_before from public.tickets where id = 'd15d2222-0000-0000-0000-000000000001';
  if v_before.asignado_a is distinct from 'd15d0000-0000-0000-0000-000000000003'::uuid then
    raise exception 'FAIL: precondición de reasignación inválida (asignado_a=%)', v_before.asignado_a;
  end if;

  perform pg_temp.act('d15d0000-0000-0000-0000-000000000001'); -- admin
  select * into v_result from public.manage_ticket_assignment(
    'd15d2222-0000-0000-0000-000000000001'::uuid,
    'd15d0000-0000-0000-0000-000000000004'::uuid, -- soporte B
    'u15d-reassign-0001',
    pg_temp.fake_hash('reassign-0001'),
    v_before.fecha_actualizacion
  );
  perform pg_temp.reset_su();

  if v_result.asignado_a is distinct from 'd15d0000-0000-0000-0000-000000000004'::uuid then
    raise exception 'FAIL: reasignación no cambió asignado_a (got %)', v_result.asignado_a;
  end if;
  raise notice 'PASS: reasignación (A -> B)';
end $$;

-- ============================================================================
-- 3) DESASIGNACIÓN (asignado_a = null)
-- ============================================================================
do $$
declare
  v_before public.tickets;
  v_result public.tickets;
begin
  select * into v_before from public.tickets where id = 'd15d2222-0000-0000-0000-000000000001';

  perform pg_temp.act('d15d0000-0000-0000-0000-000000000001'); -- admin
  select * into v_result from public.manage_ticket_assignment(
    'd15d2222-0000-0000-0000-000000000001'::uuid,
    null,
    'u15d-unassign-0001',
    pg_temp.fake_hash('unassign-0001'),
    v_before.fecha_actualizacion
  );
  perform pg_temp.reset_su();

  if v_result.asignado_a is not null then
    raise exception 'FAIL: desasignación dejó asignado_a=%', v_result.asignado_a;
  end if;
  raise notice 'PASS: desasignación (asignado_a = null)';
end $$;

-- ============================================================================
-- 4) REPLAY IDEMPOTENTE (misma key + mismo hash) — sin duplicar auditoría
-- ============================================================================
do $$
declare
  v_before public.tickets;
  v_result1 public.tickets;
  v_result2 public.tickets;
  v_evt_count int;
  v_bit_count int;
begin
  select * into v_before from public.tickets where id = 'd15d2222-0000-0000-0000-000000000002';

  perform pg_temp.act('d15d0000-0000-0000-0000-000000000001'); -- admin
  select * into v_result1 from public.manage_ticket_assignment(
    'd15d2222-0000-0000-0000-000000000002'::uuid,
    'd15d0000-0000-0000-0000-000000000003'::uuid,
    'u15d-idem-replay-0001',
    pg_temp.fake_hash('idem-replay-0001'),
    v_before.fecha_actualizacion
  );

  -- Replay #1: misma key, mismo hash, MISMO expected (aún válido).
  select * into v_result2 from public.manage_ticket_assignment(
    'd15d2222-0000-0000-0000-000000000002'::uuid,
    'd15d0000-0000-0000-0000-000000000003'::uuid,
    'u15d-idem-replay-0001',
    pg_temp.fake_hash('idem-replay-0001'),
    v_before.fecha_actualizacion  -- deliberadamente el expected ORIGINAL (ya obsoleto)
  );
  perform pg_temp.reset_su();

  if v_result1.fecha_actualizacion is distinct from v_result2.fecha_actualizacion then
    raise exception 'FAIL: replay idempotente devolvió un estado distinto (% vs %)', v_result1.fecha_actualizacion, v_result2.fecha_actualizacion;
  end if;

  select count(*) into v_evt_count from public.ticket_eventos
    where ticket_id = 'd15d2222-0000-0000-0000-000000000002' and idempotency_key = 'u15d-idem-replay-0001';
  if v_evt_count <> 1 then
    raise exception 'FAIL: replay duplicó ticket_eventos (count=%)', v_evt_count;
  end if;

  select count(*) into v_bit_count from public.bitacora
    where entidad_tipo='ticket' and entidad_id='d15d2222-0000-0000-0000-000000000002' and accion='ticket_asignado';
  if v_bit_count <> 1 then
    raise exception 'FAIL: replay duplicó bitacora (count=%)', v_bit_count;
  end if;

  raise notice 'PASS: replay idempotente no duplica ticket_eventos ni bitacora (auditoría exactamente una vez)';
end $$;

-- ============================================================================
-- 5) MISMA KEY CON PAYLOAD DISTINTO (request_hash distinto) -> 23505
-- ============================================================================
do $$
declare
  v_before public.tickets;
begin
  select * into v_before from public.tickets where id = 'd15d2222-0000-0000-0000-000000000003';
  perform pg_temp.act('d15d0000-0000-0000-0000-000000000001'); -- admin

  perform public.manage_ticket_assignment(
    'd15d2222-0000-0000-0000-000000000003'::uuid,
    'd15d0000-0000-0000-0000-000000000003'::uuid,
    'u15d-key-reuse-0001',
    pg_temp.fake_hash('key-reuse-payload-A'),
    v_before.fecha_actualizacion
  );

  begin
    perform public.manage_ticket_assignment(
      'd15d2222-0000-0000-0000-000000000003'::uuid,
      'd15d0000-0000-0000-0000-000000000004'::uuid, -- payload distinto: otro asignado
      'u15d-key-reuse-0001', -- MISMA key
      pg_temp.fake_hash('key-reuse-payload-B'), -- hash distinto
      v_before.fecha_actualizacion
    );
    raise exception 'FAIL: misma key con payload distinto no fue rechazada';
  exception when sqlstate '23505' then
    raise notice 'PASS: misma key con payload distinto -> 23505 TC_IDEMPOTENCY_KEY_REUSED';
  end;

  perform pg_temp.reset_su();
end $$;

-- ============================================================================
-- 6) EXPECTED fecha_actualizacion OBSOLETA -> 40001
-- ============================================================================
do $$
declare
  v_ticket_id uuid := 'd15d2222-0000-0000-0000-000000000001';
  v_stale timestamptz;
begin
  select fecha_actualizacion into v_stale from public.tickets where id = v_ticket_id;
  -- v_stale es la fecha_actualizacion ANTERIOR a las operaciones 1/2/3 de arriba
  -- sobre este mismo ticket: para esta prueba forzamos un valor deliberadamente
  -- desalineado (now() - 1h) que no puede coincidir con el valor real.
  perform pg_temp.act('d15d0000-0000-0000-0000-000000000001'); -- admin
  begin
    perform public.manage_ticket_assignment(
      v_ticket_id,
      'd15d0000-0000-0000-0000-000000000003'::uuid,
      'u15d-stale-version-0001',
      pg_temp.fake_hash('stale-version-0001'),
      now() - interval '1 hour'
    );
    raise exception 'FAIL: expected_fecha_actualizacion obsoleta no fue rechazada';
  exception when sqlstate '40001' then
    raise notice 'PASS: expected_fecha_actualizacion obsoleta -> 40001 TC_ASSIGNMENT_VERSION_CONFLICT';
  end;
  perform pg_temp.reset_su();
end $$;

-- ============================================================================
-- 7/8/9) AUTORIZACIÓN: admin (positiva) ya cubierta arriba.
--   supervisor y soporte NO autorizados a invocar el RPC directamente.
-- ============================================================================
do $$
declare
  v_before public.tickets;
begin
  select * into v_before from public.tickets where id = 'd15d2222-0000-0000-0000-000000000002';

  -- supervisor: ve todo por RLS, pero el RPC exige admin/service_role.
  perform pg_temp.act('d15d0000-0000-0000-0000-000000000002');
  begin
    perform public.manage_ticket_assignment(
      v_before.id, 'd15d0000-0000-0000-0000-000000000003'::uuid,
      'u15d-authz-supervisor-0001', pg_temp.fake_hash('authz-supervisor-0001'),
      v_before.fecha_actualizacion
    );
    raise exception 'FAIL: supervisor pudo invocar manage_ticket_assignment';
  exception when sqlstate '42501' then
    raise notice 'PASS: supervisor no autorizado (42501 admin_or_edge_required)';
  end;
  perform pg_temp.reset_su();

  -- soporte: tampoco autorizado a invocar el RPC (solo admin/service_role).
  perform pg_temp.act('d15d0000-0000-0000-0000-000000000003');
  begin
    perform public.manage_ticket_assignment(
      v_before.id, 'd15d0000-0000-0000-0000-000000000004'::uuid,
      'u15d-authz-soporte-0001', pg_temp.fake_hash('authz-soporte-0001'),
      v_before.fecha_actualizacion
    );
    raise exception 'FAIL: soporte pudo invocar manage_ticket_assignment';
  exception when sqlstate '42501' then
    raise notice 'PASS: soporte no autorizado (42501 admin_or_edge_required)';
  end;
  perform pg_temp.reset_su();
end $$;

-- ============================================================================
-- 10) ANON -> permiso denegado a nivel de GRANT (antes de entrar a la función)
-- ============================================================================
do $$
declare
  v_before public.tickets;
begin
  select * into v_before from public.tickets where id = 'd15d2222-0000-0000-0000-000000000002';
  perform pg_temp.act_anon();
  begin
    perform public.manage_ticket_assignment(
      v_before.id, 'd15d0000-0000-0000-0000-000000000003'::uuid,
      'u15d-authz-anon-00001', pg_temp.fake_hash('authz-anon-00001'),
      v_before.fecha_actualizacion
    );
    raise exception 'FAIL: anon pudo invocar manage_ticket_assignment';
  exception when insufficient_privilege then
    raise notice 'PASS: anon sin privilegio de EXECUTE (revocado en migración)';
  end;
  perform pg_temp.reset_su();
end $$;

-- ============================================================================
-- 11) USUARIO AUTENTICADO SIN PERFIL -> 42501 (has_role no encuentra perfil)
-- ============================================================================
do $$
declare
  v_before public.tickets;
begin
  select * into v_before from public.tickets where id = 'd15d2222-0000-0000-0000-000000000002';
  perform pg_temp.act('d15d0000-0000-0000-0000-000000000005'); -- sin fila en perfiles
  begin
    perform public.manage_ticket_assignment(
      v_before.id, 'd15d0000-0000-0000-0000-000000000003'::uuid,
      'u15d-authz-noprofile01', pg_temp.fake_hash('authz-noprofile-0001'),
      v_before.fecha_actualizacion
    );
    raise exception 'FAIL: usuario sin perfil pudo invocar manage_ticket_assignment';
  exception when sqlstate '42501' then
    raise notice 'PASS: usuario autenticado sin perfil -> 42501 admin_or_edge_required';
  end;
  perform pg_temp.reset_su();
end $$;

-- ============================================================================
-- 12) ESCALADA DE ROL BLOQUEADA: JWT/metadata falsificando rol admin no basta.
--     El RPC solo confía en perfiles.rol (vía app_private.has_role), nunca en
--     request.jwt.claims.user_metadata.rol ni en ningún claim distinto de
--     'service_role'.
-- ============================================================================
do $$
declare
  v_before public.tickets;
begin
  select * into v_before from public.tickets where id = 'd15d2222-0000-0000-0000-000000000002';
  perform pg_temp.act_forged('d15d0000-0000-0000-0000-000000000003', 'admin'); -- soporte A finge ser admin
  begin
    perform public.manage_ticket_assignment(
      v_before.id, 'd15d0000-0000-0000-0000-000000000004'::uuid,
      'u15d-role-escalation01', pg_temp.fake_hash('role-escalation-0001'),
      v_before.fecha_actualizacion
    );
    raise exception 'FAIL: rol forjado en JWT escaló privilegios en el RPC';
  exception when sqlstate '42501' then
    raise notice 'PASS: escalada de rol bloqueada (RPC ignora claims/metadata forjados)';
  end;
  perform pg_temp.reset_su();
end $$;

-- ============================================================================
-- 13) LECTURA POSTERIOR CONSISTENTE (respeta RLS de soporte)
-- ============================================================================
do $$
declare
  v_result public.tickets;
  v_seen_by_b public.tickets;
  n int;
begin
  perform pg_temp.act('d15d0000-0000-0000-0000-000000000001'); -- admin
  select * into v_result from public.tickets where id = 'd15d2222-0000-0000-0000-000000000002';
  perform pg_temp.reset_su();
  if v_result.asignado_a is distinct from 'd15d0000-0000-0000-0000-000000000003'::uuid then
    raise exception 'FAIL: precondición de lectura posterior inválida (asignado_a=%)', v_result.asignado_a;
  end if;

  -- soporte B (no asignado) no debe ver el ticket 2.
  perform pg_temp.act('d15d0000-0000-0000-0000-000000000004');
  select count(*) into n from public.tickets where id = 'd15d2222-0000-0000-0000-000000000002';
  perform pg_temp.reset_su();
  if n <> 0 then
    raise exception 'FAIL (canario anti-permisivo): soporte B ve el ticket asignado a A (n=%)', n;
  end if;

  -- soporte A (asignado) sí ve su propio ticket con el estado recién escrito.
  perform pg_temp.act('d15d0000-0000-0000-0000-000000000003');
  select * into v_seen_by_b from public.tickets where id = 'd15d2222-0000-0000-0000-000000000002';
  perform pg_temp.reset_su();
  if v_seen_by_b.asignado_a is distinct from 'd15d0000-0000-0000-0000-000000000003'::uuid then
    raise exception 'FAIL: lectura posterior inconsistente para el asignado (asignado_a=%)', v_seen_by_b.asignado_a;
  end if;

  raise notice 'PASS: lectura posterior consistente (asignado ve su ticket; tercero no)';
end $$;

-- ============================================================================
-- 14) ROLLBACK SIN FILAS PARCIALES: un fallo a mitad de función no deja
--     estado a medias (ni claim de idempotencia atascado en 'processing').
-- ============================================================================
do $$
declare
  v_ticket_id uuid := 'd15d2222-0000-0000-0000-000000000003';
  v_before public.tickets;
  v_evt_before int; v_evt_after int;
  v_bit_before int; v_bit_after int;
  v_idem_count int;
  v_retry public.tickets;
begin
  select * into v_before from public.tickets where id = v_ticket_id;
  select count(*) into v_evt_before from public.ticket_eventos where ticket_id = v_ticket_id;
  select count(*) into v_bit_before from public.bitacora where entidad_tipo='ticket' and entidad_id = v_ticket_id;

  perform pg_temp.act('d15d0000-0000-0000-0000-000000000001'); -- admin

  -- asignado_a inexistente -> invalid_or_inactive_assignee (23503), a mitad
  -- de la función (después del claim de idempotencia, antes del UPDATE).
  begin
    perform public.manage_ticket_assignment(
      v_ticket_id,
      'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, -- no existe en perfiles
      'u15d-rollback-partial01',
      pg_temp.fake_hash('rollback-partial-0001'),
      v_before.fecha_actualizacion
    );
    raise exception 'FAIL: asignado_a inválido no fue rechazado';
  exception when sqlstate '23503' then
    raise notice 'PASS (paso 1/2): asignado_a inválido -> 23503 invalid_or_inactive_assignee';
  end;

  select count(*) into v_evt_after from public.ticket_eventos where ticket_id = v_ticket_id;
  select count(*) into v_bit_after from public.bitacora where entidad_tipo='ticket' and entidad_id = v_ticket_id;
  if v_evt_after <> v_evt_before or v_bit_after <> v_bit_before then
    raise exception 'FAIL: quedaron filas parciales (ticket_eventos % -> %, bitacora % -> %)',
      v_evt_before, v_evt_after, v_bit_before, v_bit_after;
  end if;

  perform pg_temp.reset_su(); -- edge_idempotency es SELECT-only para service_role
  select count(*) into v_idem_count from public.edge_idempotency where idempotency_key = 'u15d-rollback-partial01';
  if v_idem_count <> 0 then
    raise exception 'FAIL: quedó un claim de idempotencia atascado (count=%)', v_idem_count;
  end if;
  perform pg_temp.act('d15d0000-0000-0000-0000-000000000001'); -- admin, para el reintento

  -- La MISMA key debe poder reintentarse limpiamente (no quedó 'processing').
  select * into v_retry from public.manage_ticket_assignment(
    v_ticket_id,
    'd15d0000-0000-0000-0000-000000000004'::uuid, -- ahora sí válido
    'u15d-rollback-partial01', -- MISMA key que el intento fallido
    pg_temp.fake_hash('rollback-partial-0001-retry'),
    v_before.fecha_actualizacion
  );
  perform pg_temp.reset_su();

  if v_retry.asignado_a is distinct from 'd15d0000-0000-0000-0000-000000000004'::uuid then
    raise exception 'FAIL: reintento tras rollback no aplicó la asignación';
  end if;

  raise notice 'PASS (paso 2/2): rollback sin filas parciales; reintento con la misma key funciona limpio';
end $$;

rollback; -- no persistir fixtures
