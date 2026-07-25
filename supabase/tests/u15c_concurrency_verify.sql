-- U15C · EVALUACIÓN + LIMPIEZA de la sonda de concurrencia
-- TC-U15C-RUNTIME-IMPLEMENT-D1-D4-01
--
-- Par obligatorio de supabase/tests/u15c_concurrency_probe.sql. Corre en
-- AUTOCOMMIT y en este orden exacto:
--   1) congela las métricas de la carrera en una tabla temporal;
--   2) limpia SIEMPRE las filas sintéticas (antes de poder fallar);
--   3) recién entonces falla fail-closed si la carrera no fue segura.
-- Si se evaluara dentro de una transacción, el raise revertiría la limpieza y
-- dejaría basura en la base local; por eso el orden no es intercambiable.
--
-- Invariante bajo prueba (lo que D1 hacía imposible): con la MISMA clave y dos
-- sesiones simultáneas hay EXACTAMENTE un efecto — una fila de idempotencia,
-- un incremento de versión, un evento y una entrada de bitácora.
--
-- SOLO LOCAL. Estado local: TEST_HARNESS_FIXED_BUT_NOT_EXECUTED.
--
-- Uso:
--   psql ... -X -q -v ON_ERROR_STOP=1 \
--     -v key='tc-u15c-conc-...' \
--     -v ticket='96666666-0000-4666-8666-000000000001' \
--     -f supabase/tests/u15c_concurrency_verify.sql

\set ON_ERROR_STOP on
\pset pager off

create temporary table u15c_conc_check as
select
  (select consolidacion_version from public.tickets where id = :'ticket'::uuid) as version,
  (select requiere_consolidacion from public.tickets where id = :'ticket'::uuid) as requiere,
  (select count(*) from public.edge_idempotency where idempotency_key = :'key') as idem_rows,
  (select string_agg(distinct action, ',') from public.edge_idempotency where idempotency_key = :'key') as idem_action,
  (select string_agg(distinct status, ',') from public.edge_idempotency where idempotency_key = :'key') as idem_status,
  (select count(*) from public.ticket_eventos where ticket_id = :'ticket'::uuid) as eventos,
  (select count(*) from public.bitacora where entidad_tipo = 'ticket' and entidad_id = :'ticket'::uuid) as bitacora,
  (select count(*) from public.ticket_match_decisiones where ticket_id = :'ticket'::uuid) as decisiones;

-- --- LIMPIEZA (siempre antes de cualquier posible raise) --------------------
delete from public.ticket_eventos where ticket_id = :'ticket'::uuid;
delete from public.bitacora where entidad_tipo = 'ticket' and entidad_id = :'ticket'::uuid;
delete from public.ticket_match_decisiones where ticket_id = :'ticket'::uuid;
delete from public.edge_idempotency where idempotency_key = :'key';
delete from public.tickets where id = :'ticket'::uuid;
delete from public.perfiles where id = '95555555-5555-4555-8555-555555555501';
delete from auth.users where id = '95555555-5555-4555-8555-555555555501';

-- --- EVALUACIÓN fail-closed -------------------------------------------------
do $$
declare c record;
begin
  select * into c from u15c_conc_check;

  if c.version is null then
    raise exception 'U15C_CONC_FAIL: el ticket de la sonda no existía (¿probe no corrió?)';
  end if;
  if c.version <> 1 then
    raise exception 'U15C_CONC_FAIL: consolidacion_version=% (esperado 1: doble efecto o ninguno)', c.version;
  end if;
  if c.idem_rows <> 1 then
    raise exception 'U15C_CONC_FAIL: filas de idempotencia=% (esperado 1)', c.idem_rows;
  end if;
  if c.idem_action is distinct from 'consolidar_cliente' then
    raise exception 'U15C_CONC_FAIL(D1): action=% (esperado consolidar_cliente)', coalesce(c.idem_action, 'null');
  end if;
  if c.idem_status is distinct from 'completed' then
    raise exception 'U15C_CONC_FAIL: status=% (esperado completed; processing = claim huérfano)', coalesce(c.idem_status, 'null');
  end if;
  if c.eventos <> 1 then
    raise exception 'U15C_CONC_FAIL: ticket_eventos=% (esperado 1)', c.eventos;
  end if;
  if c.bitacora <> 1 then
    raise exception 'U15C_CONC_FAIL: bitacora=% (esperado 1)', c.bitacora;
  end if;
  if c.decisiones <> 1 then
    raise exception 'U15C_CONC_FAIL: ticket_match_decisiones=% (esperado 1)', c.decisiones;
  end if;
  if c.requiere is not true then
    raise exception 'U15C_CONC_FAIL: postpone no conservó requiere_consolidacion=true';
  end if;

  raise notice 'U15C_CONCURRENCY_SUMMARY version=% idem=% eventos=% bitacora=% decisiones=%',
    c.version, c.idem_rows, c.eventos, c.bitacora, c.decisiones;
end $$;

\echo 'U15C_CONCURRENCY=PASS'
