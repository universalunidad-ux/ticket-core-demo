-- ============================================================================
-- U15D · Concurrencia real de public.manage_ticket_assignment (LOCAL).
--
-- A diferencia de los demás archivos de supabase/tests/**, ESTE archivo NO
-- envuelve todo en `begin; ... rollback;`: la concurrencia real entre DOS
-- sesiones de Postgres requiere DOS procesos psql distintos ejecutándose en
-- paralelo, así que los fixtures deben persistir (COMMIT) entre invocaciones
-- y se limpian explícitamente en la fase `teardown` (ver abajo). Orquestado
-- por tools/local-db/run-u15d-runtime.sh — no ejecutar este archivo suelto
-- sin seguir las 4 fases en orden.
--
-- Fases (psql -v phase=...):
--   1) setup     — una sola invocación, secuencial. Crea fixtures y expone
--                  el fecha_actualizacion inicial vía \gset (compartido).
--   2) race      — DOS invocaciones EN PARALELO (side=a / side=b), mismo
--                  expected_fecha_actualizacion capturado en 1).
--                  side=a: toma el lock explícito, duerme, luego llama al RPC
--                          y hace commit (gana la carrera).
--                  side=b: llama al RPC directo; su `for update` interno se
--                          bloquea hasta que side=a libere el lock; al
--                          reanudar, su expected ya quedó obsoleto -> 40001.
--   3) verify    — una sola invocación, secuencial, tras esperar ambas
--                  invocaciones de `race` (wait en el shell). Verifica que
--                  ganó EXACTAMENTE una, que no hay fila duplicada de
--                  ticket_eventos/bitacora, y que el ticket terminó asignado
--                  al actor de side=a (nunca a ambos, nunca a ninguno).
--   4) teardown  — una sola invocación, secuencial. Borra los fixtures.
--
-- "Dos supervisores concurrentes": en este esquema `perfiles.rol='supervisor'`
-- NO está autorizado a invocar manage_ticket_assignment (ver bloque 7/8/9 de
-- supabase/tests/u15d_assignment_runtime.sql: supervisor -> 42501). La
-- carrera aquí usa DOS actores admin (los únicos autorizados junto con
-- service_role) para poder observar la propiedad de concurrencia real que
-- importa: exclusión mutua vía `for update` + rechazo determinista por
-- versión obsoleta (40001), nunca un lost update ni doble aplicación.
-- ============================================================================
\set ON_ERROR_STOP on

\if :{?phase}
\else
  \echo 'STOP=phase_required (setup|race|verify|teardown)'
  \quit 1
\endif

-- `\if` sólo evalúa booleanos después de interpolar variables. Calculamos
-- una vez el dispatch mediante SQL + \gset y rechazamos cualquier fase que
-- no pertenezca al conjunto cerrado.
select
  :'phase' = 'setup' as phase_setup,
  :'phase' = 'race' as phase_race,
  :'phase' = 'verify' as phase_verify,
  :'phase' = 'teardown' as phase_teardown,
  :'phase' in ('setup', 'race', 'verify', 'teardown') as phase_valid
\gset

\if :phase_valid
\else
  \echo 'STOP=phase_invalid (setup|race|verify|teardown)'
  \quit 1
\endif

-- ---------------------------------------------------------------------------
-- FASE: setup
-- ---------------------------------------------------------------------------
\if :phase_setup

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('d15dc000-0000-0000-0000-00000000000a','authenticated','authenticated','u15d-concurrency-admin-a@example.invalid',now(),'{}'::jsonb,'{"persona":"admin-a"}'::jsonb,now(),now()),
  ('d15dc000-0000-0000-0000-00000000000b','authenticated','authenticated','u15d-concurrency-admin-b@example.invalid',now(),'{}'::jsonb,'{"persona":"admin-b"}'::jsonb,now(),now()),
  ('d15dc000-0000-0000-0000-00000000000c','authenticated','authenticated','u15d-concurrency-dest-c@example.invalid',now(),'{}'::jsonb,'{"persona":"destino-c"}'::jsonb,now(),now()),
  ('d15dc000-0000-0000-0000-00000000000d','authenticated','authenticated','u15d-concurrency-dest-d@example.invalid',now(),'{}'::jsonb,'{"persona":"destino-d"}'::jsonb,now(),now())
on conflict (id) do nothing;

insert into public.perfiles (id, rol, nombre, tema, activo) values
  ('d15dc000-0000-0000-0000-00000000000a','admin','U15D Admin A (race)','light',true),
  ('d15dc000-0000-0000-0000-00000000000b','admin','U15D Admin B (race)','light',true),
  ('d15dc000-0000-0000-0000-00000000000c','soporte','U15D Soporte destino A','light',true),
  ('d15dc000-0000-0000-0000-00000000000d','soporte','U15D Soporte destino B','light',true)
on conflict (id) do nothing;

insert into public.clientes (id, nombre, origen_registro) values
  ('d15dc111-1111-1111-1111-111111111111','U15D Cliente Concurrencia','ticket_core')
on conflict (id) do nothing;

insert into public.tickets (id, cliente_id, asignado_a, titulo, estado, prioridad, folio) values
  ('d15dc222-0000-0000-0000-000000000001','d15dc111-1111-1111-1111-111111111111', null, 'U15D Ticket Concurrencia','abierto','media','U15D-RACE-1')
on conflict (id) do nothing;

-- Expuesto para que el shell lo capture con \gset y lo reinyecte como -v en
-- las dos invocaciones paralelas de la fase `race`.
select fecha_actualizacion as shared_expected
from public.tickets where id = 'd15dc222-0000-0000-0000-000000000001' \gset

\qecho SETUP_OK shared_expected=:'shared_expected'

\endif

-- ---------------------------------------------------------------------------
-- FASE: race (side=a | side=b), requiere -v shared_expected='<timestamptz>'
-- ---------------------------------------------------------------------------
\if :phase_race

\if :{?shared_expected}
\else
  \qecho 'STOP=shared_expected_required'
  \quit 1
\endif

\if :{?side}
\else
  \echo 'STOP=side_required (a|b)'
  \quit 1
\endif

select
  :'side' = 'a' as side_a,
  :'side' = 'b' as side_b,
  :'side' in ('a', 'b') as side_valid
\gset

\if :side_valid
\else
  \echo 'STOP=side_invalid (a|b)'
  \quit 1
\endif

\if :side_a
  -- Gana la carrera: toma el lock explícito primero y duerme para ampliar
  -- la ventana de contención antes de llamar al RPC real.
  begin;
  select fecha_actualizacion from public.tickets
    where id = 'd15dc222-0000-0000-0000-000000000001' for update;
  select pg_sleep(2);
  select set_config('role','authenticated', true);
  select set_config('request.jwt.claims',
    json_build_object('sub','d15dc000-0000-0000-0000-00000000000a','role','authenticated')::text, true);
  select (r).asignado_a as winner_asignado_a, (r).fecha_actualizacion as winner_fecha
  from (
    select public.manage_ticket_assignment(
      'd15dc222-0000-0000-0000-000000000001'::uuid,
      'd15dc000-0000-0000-0000-00000000000c'::uuid,
      'u15d-race-side-a-000001',
      md5('race-side-a') || md5('race-side-a:u15d'),
      :'shared_expected'::timestamptz
    ) as r
  ) w;
  select set_config('role','postgres', true);
  commit;
  \echo RACE_SIDE_A_DONE
\elif :side_b
  -- Pierde la carrera: su `for update` interno queda bloqueado hasta que
  -- side=a haga commit; al reanudar, :shared_expected ya está obsoleto.
  -- Los GUC locales de autorización deben vivir en la MISMA transacción que
  -- la RPC. Sin este begin, cada SELECT autocommit descarta set_config(...,
  -- true) antes de la llamada y produce admin_or_edge_required en vez del
  -- conflicto de versión esperado.
  begin;
  select set_config('role','authenticated', true);
  select set_config('request.jwt.claims',
    json_build_object('sub','d15dc000-0000-0000-0000-00000000000b','role','authenticated')::text, true);
  select public.manage_ticket_assignment(
    'd15dc222-0000-0000-0000-000000000001'::uuid,
    'd15dc000-0000-0000-0000-00000000000d'::uuid,
    'u15d-race-side-b-000001',
    md5('race-side-b') || md5('race-side-b:u15d'),
    :'shared_expected'::timestamptz
  );
  -- Se espera que esta llamada TERMINE EN ERROR (40001) y que psql retorne
  -- código de salida distinto de cero: ON_ERROR_STOP termina psql y deja
  -- esta transacción abortada naturalmente. No hay COMMIT en esta rama.
  \echo 'RACE_SIDE_B_UNEXPECTED_SUCCESS (debía fallar con 40001)'
  select set_config('role','postgres', true);
\else
  \echo 'STOP=side_required (a|b)'
  \quit 1
\endif

\endif

-- ---------------------------------------------------------------------------
-- FASE: verify (secuencial, después de esperar ambos `race`)
-- ---------------------------------------------------------------------------
\if :phase_verify

do $$
declare
  v_ticket public.tickets;
  v_evt_count int;
  v_bit_count int;
begin
  select * into v_ticket from public.tickets where id = 'd15dc222-0000-0000-0000-000000000001';

  if v_ticket.asignado_a is distinct from 'd15dc000-0000-0000-0000-00000000000c'::uuid then
    raise exception 'FAIL: el ganador esperado (side=a) no quedó asignado (asignado_a=%)', v_ticket.asignado_a;
  end if;

  select count(*) into v_evt_count from public.ticket_eventos
    where ticket_id = 'd15dc222-0000-0000-0000-000000000001' and kind = 'asignacion';
  if v_evt_count <> 1 then
    raise exception 'FAIL: se esperaba exactamente 1 ticket_eventos de asignación, hay % (lost update o doble aplicación)', v_evt_count;
  end if;

  select count(*) into v_bit_count from public.bitacora
    where entidad_tipo = 'ticket' and entidad_id = 'd15dc222-0000-0000-0000-000000000001' and accion = 'ticket_asignado';
  if v_bit_count <> 1 then
    raise exception 'FAIL: se esperaba exactamente 1 bitacora de asignación, hay %', v_bit_count;
  end if;

  raise notice 'PASS: dos actores admin concurrentes sobre el mismo ticket -> exactamente uno gana (side=a), el otro recibe 40001, sin filas duplicadas';
end $$;

\endif

-- ---------------------------------------------------------------------------
-- FASE: teardown (secuencial, limpieza explícita — este archivo SÍ persiste)
-- ---------------------------------------------------------------------------
\if :phase_teardown

delete from public.ticket_eventos where ticket_id = 'd15dc222-0000-0000-0000-000000000001';
delete from public.bitacora where entidad_tipo = 'ticket' and entidad_id = 'd15dc222-0000-0000-0000-000000000001';
delete from public.edge_idempotency where idempotency_key in ('u15d-race-side-a-000001','u15d-race-side-b-000001');
delete from public.tickets where id = 'd15dc222-0000-0000-0000-000000000001';
delete from public.clientes where id = 'd15dc111-1111-1111-1111-111111111111';
delete from public.perfiles where id in (
  'd15dc000-0000-0000-0000-00000000000a','d15dc000-0000-0000-0000-00000000000b',
  'd15dc000-0000-0000-0000-00000000000c','d15dc000-0000-0000-0000-00000000000d'
);
delete from auth.users where id in (
  'd15dc000-0000-0000-0000-00000000000a','d15dc000-0000-0000-0000-00000000000b',
  'd15dc000-0000-0000-0000-00000000000c','d15dc000-0000-0000-0000-00000000000d'
);

\echo TEARDOWN_OK

\endif
