-- U15C · CONCURRENCY MATRIX (C1-C5) · DOS CONEXIONES REALES
-- TC-U15C-RUNTIME-IMPLEMENT-D1-D4-01
--
-- Ejercita public.tc_consolidar_cliente_ticket(...) con dos sesiones psql
-- concurrentes reales, según
-- _ANALYSIS_OUTPUTS/TC_U15C_U15D_RESILIENCE_OPUS_AUDIT_01/04_CONCURRENCY_INTERLEAVINGS.md
-- (C1-C5). NO se auto-orquesta: este archivo se invoca varias veces con
-- distintos -v desde tools/local-db/run-u15c-runtime.sh, que es quien abre
-- las dos conexiones concurrentes (psql en background) y compara resultados.
--
-- IMPORTANTE (psql \if): \if SOLO evalúa literales booleanos
-- (true/false/1/0/on/off/yes/no) o la prueba de "variable definida"
-- :{?nombre}; NO evalúa comparaciones de texto como :var = 'x'
-- (https://www.postgresql.org/docs/current/app-psql.html, sección \if).
-- Por eso el despacho de modo/caso/sesión se hace con flags 0/1 en lugar de
-- comparar cadenas. tools/local-db/run-u15c-runtime.sh DEBE pasar SIEMPRE
-- los ocho flags siguientes (nunca dejarlos indefinidos):
--   -v mode_seed=0|1 -v mode_run=0|1 -v mode_verify=0|1 -v mode_teardown=0|1
--   -v case_c1=0|1 -v case_c2=0|1 -v case_c3=0|1 -v case_c4=0|1 -v case_c5=0|1
--   -v session_a=0|1
-- Además, solo para logs legibles (no participan en \if): -v session_label=A|B
--
-- Estado local: TEST_HARNESS_FIXED_BUT_NOT_EXECUTED (sin PG/Docker en este
-- entorno). No se declara PASS runtime hasta ejecutarse en Docker local real.

\set ON_ERROR_STOP on
\pset pager off

\if :{?mode_seed}
\else
  \echo 'STOP=mode_seed_flag_REQUIRED'
  \quit 3
\endif
\if :{?mode_run}
\else
  \echo 'STOP=mode_run_flag_REQUIRED'
  \quit 3
\endif
\if :{?mode_verify}
\else
  \echo 'STOP=mode_verify_flag_REQUIRED'
  \quit 3
\endif
\if :{?mode_teardown}
\else
  \echo 'STOP=mode_teardown_flag_REQUIRED'
  \quit 3
\endif

-- ============================================================================
-- MODE: seed (mode_seed=1)
-- ============================================================================
\if :mode_seed

insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('95555555-1111-4111-8111-555555555501', 'authenticated', 'authenticated',
   'tc-u15c-conc-admin@example.invalid', now(),
   '{"provider":"email","providers":["email"],"fixture":"tc-u15c-concurrency"}'::jsonb,
   '{"fixture":"tc-u15c-concurrency","persona":"admin"}'::jsonb, now(), now())
on conflict (id) do nothing;

insert into public.perfiles (id, rol, nombre, tema) values
  ('95555555-1111-4111-8111-555555555501', 'admin', '[TC-U15C-CONC] Admin', 'light')
on conflict (id) do nothing;

insert into public.clientes (id, nombre, origen_registro, activo) values
  ('95555555-2222-4222-8222-555555555502', '[TC-U15C-CONC] Cliente A', 'ticket_core', true),
  ('95555555-2222-4222-8222-555555555503', '[TC-U15C-CONC] Cliente B', 'ticket_core', true)
on conflict (id) do nothing;

insert into public.tickets (
  id, titulo, estado, requiere_consolidacion, consolidacion_version,
  empresa_capturada, asignado_a, fecha_actualizacion
) values
  ('95555555-3333-4333-8333-555555555511', '[TC-U15C-CONC] C1', 'abierto', true, 0, 'Empresa CONC', null, now()),
  ('95555555-3333-4333-8333-555555555512', '[TC-U15C-CONC] C2', 'abierto', true, 0, 'Empresa CONC', null, now()),
  ('95555555-3333-4333-8333-555555555513', '[TC-U15C-CONC] C3', 'abierto', true, 0, 'Empresa CONC', null, now()),
  ('95555555-3333-4333-8333-555555555514', '[TC-U15C-CONC] C4', 'abierto', true, 0, 'Empresa CONC', null, now()),
  ('95555555-3333-4333-8333-555555555515', '[TC-U15C-CONC] C5', 'abierto', true, 0, 'Empresa CONC', null, now())
on conflict (id) do nothing;

\echo 'TC_CONCURRENCY_SEED=READY'
\endif

-- ============================================================================
-- MODE: run (mode_run=1; requiere case_c1..c5 y session_a=0|1)
-- ============================================================================
\if :mode_run

create or replace function pg_temp.act(uid uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid::text, 'role', 'authenticated')::text, true);
end $$;

select pg_temp.act('95555555-1111-4111-8111-555555555501');

-- ---- C1: dos llamadas IDÉNTICAS (misma key, mismo payload) -----------------
-- Invariante I-C1: una sola operación efectiva; el que llega segundo hace
-- replay. A retrasa su commit con pg_sleep para forzar que B bloquee en el
-- INSERT/FOR UPDATE y observe el estado ya resuelto por A.
\if :case_c1
  begin;
  \if :session_a
    select pg_sleep(0.2);
  \else
    select pg_sleep(0.8);
  \endif
  select public.tc_consolidar_cliente_ticket(
    '95555555-3333-4333-8333-555555555511'::uuid,
    'associate_existing', 0,
    'tc-u15c-conc-c1-fixed-key-0001',
    '95555555-2222-4222-8222-555555555502'::uuid
  ) as result \gset r_
  \if :session_a
    select pg_sleep(0.6);
  \endif
  commit;
  \echo 'TC_C1_SESSION_RESULT session=' :session_label
  select :'r_result' as raw_result;
\endif

-- ---- C2: misma key, PAYLOAD DISTINTO ---------------------------------------
-- Invariante I-C2: la key queda ligada al primer hash; el segundo ve 409
-- IDEMPOTENCY_PAYLOAD_MISMATCH sin escribir, gane o no la carrera del INSERT.
\if :case_c2
  begin;
  \if :session_a
    select pg_sleep(0.2);
    select public.tc_consolidar_cliente_ticket(
      '95555555-3333-4333-8333-555555555512'::uuid,
      'associate_existing', 0,
      'tc-u15c-conc-c2-fixed-key-0001',
      '95555555-2222-4222-8222-555555555502'::uuid
    ) as result \gset r_
    select pg_sleep(0.4);
  \else
    select pg_sleep(0.5);
    select public.tc_consolidar_cliente_ticket(
      '95555555-3333-4333-8333-555555555512'::uuid,
      'associate_existing', 0,
      'tc-u15c-conc-c2-fixed-key-0001',
      '95555555-2222-4222-8222-555555555503'::uuid
    ) as result \gset r_
  \endif
  commit;
  \echo 'TC_C2_SESSION_RESULT session=' :session_label
  select :'r_result' as raw_result;
\endif

-- ---- C3: dos DECISIONES DISTINTAS para el mismo ticket (keys distintas) ----
-- Invariante I-C3: una ronda de consolidacion_version = una decisión. El
-- segundo en tomar el FOR UPDATE relee la versión ya avanzada y debe fallar
-- con STALE_EXPECTED_VERSION (ambos piden expected_version=0).
\if :case_c3
  begin;
  \if :session_a
    select pg_sleep(0.2);
    select public.tc_consolidar_cliente_ticket(
      '95555555-3333-4333-8333-555555555513'::uuid,
      'associate_existing', 0,
      'tc-u15c-conc-c3-key-A-0001',
      '95555555-2222-4222-8222-555555555502'::uuid
    ) as result \gset r_
    select pg_sleep(0.6);
  \else
    select pg_sleep(0.5);
    select public.tc_consolidar_cliente_ticket(
      '95555555-3333-4333-8333-555555555513'::uuid,
      'associate_existing', 0,
      'tc-u15c-conc-c3-key-B-0001',
      '95555555-2222-4222-8222-555555555503'::uuid
    ) as result \gset r_
  \endif
  commit;
  \echo 'TC_C3_SESSION_RESULT session=' :session_label
  select :'r_result' as raw_result;
\endif

-- ---- C4: CONSOLIDACIÓN (U15C) y ASIGNACIÓN (U15D) simultáneas -------------
-- GAP documentado (I-C4, 04_CONCURRENCY_INTERLEAVINGS.md#C4): U15C no toca
-- fecha_actualizacion, así que la asignación concurrente no detecta el
-- cambio de cliente_id. Este caso confirma el comportamiento observado (NO
-- se corrige aquí: cerrar el gap es U-02, fuera de alcance D1-D4). Ambas
-- deben poder COMMITear sin deadlock.
\if :case_c4
  begin;
  \if :session_a
    select pg_sleep(0.2);
    select public.tc_consolidar_cliente_ticket(
      '95555555-3333-4333-8333-555555555514'::uuid,
      'associate_existing', 0,
      'tc-u15c-conc-c4-consolidacion-0001',
      '95555555-2222-4222-8222-555555555502'::uuid
    ) as result \gset r_
  \else
    select pg_sleep(0.5);
    select row_to_json(t) as result from public.manage_ticket_assignment(
      '95555555-3333-4333-8333-555555555514'::uuid,
      '95555555-1111-4111-8111-555555555501'::uuid,
      'tc-u15c-conc-c4-asignacion-0001',
      encode(extensions.digest('tc-u15c-conc-c4-asignacion-payload', 'sha256'), 'hex'),
      (select fecha_actualizacion from public.tickets where id = '95555555-3333-4333-8333-555555555514'::uuid)
    ) as t \gset r_
  \endif
  commit;
  \echo 'TC_C4_SESSION_RESULT session=' :session_label
  select :'r_result' as raw_result;
\endif

-- ---- C5: reintento tras caída de la primera sesión -------------------------
-- Simulado como ROLLBACK explícito (no COMMIT) en la sesión A tras el claim;
-- la sesión B reintenta la MISMA key después y debe ganar limpio (sin fila
-- 'processing' fantasma), porque el rollback de A revierte el INSERT.
\if :case_c5
  \if :session_a
    begin;
    select public.tc_consolidar_cliente_ticket(
      '95555555-3333-4333-8333-555555555515'::uuid,
      'associate_existing', 0,
      'tc-u15c-conc-c5-fixed-key-0001',
      '95555555-2222-4222-8222-555555555502'::uuid
    ) as result \gset r_
    -- Caída simulada: se aborta en vez de commitear.
    rollback;
    \echo 'TC_C5_SESSION_RESULT session=' :session_label
    select :'r_result' as raw_result;
  \else
    select pg_sleep(1.0);
    begin;
    select public.tc_consolidar_cliente_ticket(
      '95555555-3333-4333-8333-555555555515'::uuid,
      'associate_existing', 0,
      'tc-u15c-conc-c5-fixed-key-0001',
      '95555555-2222-4222-8222-555555555502'::uuid
    ) as result \gset r_
    commit;
    \echo 'TC_C5_SESSION_RESULT session=' :session_label
    select :'r_result' as raw_result;
  \endif
\endif

\endif

-- ============================================================================
-- MODE: verify (mode_verify=1; requiere case_c1..c5)
-- ============================================================================
\if :mode_verify

\if :case_c1
  select case
    when count(*) filter (where status = 'completed') = 1
     and count(*) = 1
     and (select consolidacion_version from public.tickets where id = '95555555-3333-4333-8333-555555555511') = 1
    then 'TC_C1_VERIFY=PASS'
    else 'TC_C1_VERIFY=FAIL'
  end
  from public.edge_idempotency
  where idempotency_key = 'tc-u15c-conc-c1-fixed-key-0001';
\endif

\if :case_c2
  select case
    when count(*) = 1 and count(*) filter (where status = 'completed') = 1
    then 'TC_C2_VERIFY=PASS (una sola key completada; la otra hash quedó fuera)'
    else 'TC_C2_VERIFY=FAIL'
  end
  from public.edge_idempotency
  where idempotency_key = 'tc-u15c-conc-c2-fixed-key-0001';
\endif

\if :case_c3
  select case
    when (select consolidacion_version from public.tickets where id = '95555555-3333-4333-8333-555555555513') = 1
     and (select count(*) from public.ticket_eventos where ticket_id = '95555555-3333-4333-8333-555555555513') = 1
     and (select count(*) from public.bitacora where entidad_tipo = 'ticket' and entidad_id = '95555555-3333-4333-8333-555555555513') = 1
     and (select count(*) from public.edge_idempotency
          where idempotency_key in ('tc-u15c-conc-c3-key-A-0001', 'tc-u15c-conc-c3-key-B-0001')) = 1
     and (select count(*) from public.edge_idempotency
          where idempotency_key in ('tc-u15c-conc-c3-key-A-0001', 'tc-u15c-conc-c3-key-B-0001')
            and status = 'completed') = 1
    then 'TC_C3_EXACTLY_ONE_WINNER=PASS'
    else 'TC_C3_EXACTLY_ONE_WINNER=FAIL'
  end;
\endif

\if :case_c4
  select case
    when (select cliente_id from public.tickets where id = '95555555-3333-4333-8333-555555555514') is not null
     and (select asignado_a from public.tickets where id = '95555555-3333-4333-8333-555555555514') is not null
    then 'TC_C4_VERIFY=PASS (ambas escrituras commitearon sin deadlock)'
    else 'TC_C4_VERIFY=FAIL'
  end;
  \echo 'TC_C4_GAP_NOTE=U15C no actualiza fecha_actualizacion (I-C4, ver U-02, fuera de alcance D1-D4)'
\endif

\if :case_c5
  select case
    when not exists (
      select 1 from public.edge_idempotency
      where idempotency_key = 'tc-u15c-conc-c5-fixed-key-0001' and status = 'processing'
    )
     and exists (
      select 1 from public.edge_idempotency
      where idempotency_key = 'tc-u15c-conc-c5-fixed-key-0001' and status = 'completed'
    )
    then 'TC_C5_VERIFY=PASS (sin fila processing fantasma; B reclamó limpio tras caida de A)'
    else 'TC_C5_VERIFY=FAIL'
  end;
\endif

\endif

-- ============================================================================
-- MODE: teardown (mode_teardown=1)
-- ============================================================================
\if :mode_teardown

delete from public.ticket_eventos where ticket_id in (
  select id from public.tickets where titulo like '[TC-U15C-CONC]%'
);
delete from public.bitacora where entidad_tipo = 'ticket' and entidad_id in (
  select id from public.tickets where titulo like '[TC-U15C-CONC]%'
);
delete from public.ticket_match_decisiones where ticket_id in (
  select id from public.tickets where titulo like '[TC-U15C-CONC]%'
);
delete from public.edge_idempotency where idempotency_key like 'tc-u15c-conc-%';
delete from public.tickets where titulo like '[TC-U15C-CONC]%';
delete from public.clientes_contactos where cliente_id in (
  select id from public.clientes where nombre like '[TC-U15C-CONC]%'
);
delete from public.clientes where nombre like '[TC-U15C-CONC]%';
delete from public.perfiles where nombre like '[TC-U15C-CONC]%';
delete from auth.users where id = '95555555-1111-4111-8111-555555555501';

\echo 'TC_CONCURRENCY_TEARDOWN=DONE'
select case when
  not exists (select 1 from public.ticket_eventos where ticket_id::text like '95555555-3333-4333-8333-55555555551%')
  and not exists (select 1 from public.bitacora where entidad_tipo = 'ticket' and entidad_id::text like '95555555-3333-4333-8333-55555555551%')
  and not exists (select 1 from public.ticket_match_decisiones where ticket_id::text like '95555555-3333-4333-8333-55555555551%')
  and not exists (select 1 from public.edge_idempotency where idempotency_key like 'tc-u15c-conc-%')
  and not exists (select 1 from public.tickets where id::text like '95555555-3333-4333-8333-55555555551%')
  and not exists (select 1 from public.clientes_contactos where cliente_id::text like '95555555-2222-4222-8222-55555555550%')
  and not exists (select 1 from public.clientes where id::text like '95555555-2222-4222-8222-55555555550%')
  and not exists (select 1 from public.perfiles where id = '95555555-1111-4111-8111-555555555501')
  and not exists (select 1 from auth.users where id = '95555555-1111-4111-8111-555555555501')
then 'TC_CONCURRENCY_RESIDUAL_ROWS=0'
else 'TC_CONCURRENCY_RESIDUAL_ROWS=NONZERO'
end;
\endif
