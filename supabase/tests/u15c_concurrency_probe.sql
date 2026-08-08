-- U15C · SONDA DE CONCURRENCIA REAL (dos sesiones simultáneas, misma clave)
-- TC-U15C-RUNTIME-IMPLEMENT-D1-D4-01
--
-- Complementa supabase/tests/u15c_transaction_matrix.sql: la matriz corre en
-- UNA transacción con ROLLBACK final, así que sólo puede *simular* la carrera
-- (T11 inserta status='processing' a mano). Esta sonda corre en AUTOCOMMIT y
-- está pensada para lanzarse DOS veces en paralelo con la MISMA :key, el MISMO
-- :ticket y el MISMO :t0 (barrera de reloj compartida).
--
-- Escribe filas reales. El evaluador y el limpiador son
-- supabase/tests/u15c_concurrency_verify.sql; ejecutarlo SIEMPRE después.
--
-- SOLO LOCAL (Docker + Supabase CLI). Nunca contra Supabase remoto.
-- Estado local: TEST_HARNESS_FIXED_BUT_NOT_EXECUTED (sin PG/Docker en el
-- entorno donde se escribió); lo orquesta tools/local-db/run-u15c-runtime.sh.
--
-- Uso:
--   psql ... -X -q -v ON_ERROR_STOP=1 \
--     -v slot=1 -v key='tc-u15c-conc-...' \
--     -v ticket='96666666-0000-4666-8666-000000000001' \
--     -v t0='2026-07-25T03:00:00Z' \
--     -f supabase/tests/u15c_concurrency_probe.sql

\set ON_ERROR_STOP on
\pset pager off

-- ============================================================================
-- FIXTURES (idempotentes: ambas sesiones ejecutan el mismo seed en carrera)
-- ============================================================================

insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '95555555-5555-4555-8555-555555555501', 'authenticated', 'authenticated',
  'tc-u15c-conc-admin@example.invalid', now(),
  '{"provider":"email","providers":["email"],"fixture":"tc-u15c-conc"}'::jsonb,
  '{"fixture":"tc-u15c-conc","persona":"admin"}'::jsonb, now(), now()
)
on conflict (id) do nothing;

insert into public.perfiles (id, rol, nombre, tema) values
  ('95555555-5555-4555-8555-555555555501', 'admin', '[TC-U15C-CONC] Admin', 'light')
on conflict (id) do nothing;

insert into public.tickets (
  id, titulo, estado, requiere_consolidacion, consolidacion_version,
  empresa_capturada, nombre_capturado, correo_capturado, telefono_capturado
)
values (
  :'ticket'::uuid, '[TC-U15C-CONC] carrera', 'abierto', true, 0,
  'Empresa QA CONC', 'Nombre QA CONC', 'qa-conc@example.invalid', '5559000001'
)
on conflict (id) do nothing;

-- Fail-closed: sin fixtures no hay carrera que medir.
do $conc_guard$
begin
  if not exists (select 1 from public.perfiles where id = '95555555-5555-4555-8555-555555555501' and rol = 'admin') then
    raise exception 'TC_U15C_CONC_FIXTURE_ADMIN_MISSING' using errcode = '23503';
  end if;
end
$conc_guard$;

-- ============================================================================
-- SONDA (se define como superusuario; se invoca ya como authenticated)
-- ============================================================================

create or replace function pg_temp.probe_call(p_ticket uuid, p_key text)
returns text language plpgsql as $$
declare v_res jsonb; v_detail text; v_code text;
begin
  v_res := public.tc_consolidar_cliente_ticket(
    p_ticket, 'postpone', 0, p_key, null, null, '{}'::jsonb, '{}'::jsonb
  );
  return format(
    'sqlstate=00000 ok=%s code=%s replayed=%s',
    coalesce(v_res ->> 'ok', '?'),
    coalesce(v_res ->> 'code', '?'),
    coalesce(v_res ->> 'replayed', '?')
  );
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail;
  begin
    v_code := coalesce(nullif(v_detail, '')::jsonb ->> 'code', sqlerrm);
  exception when others then
    v_code := sqlerrm;
  end;
  return format('sqlstate=%s ok=false code=%s replayed=n/a', sqlstate, v_code);
end $$;

-- Sesión autenticada como admin.
-- Se establecen tanto los claims escalares como el JSON para reproducir
-- de forma robusta el contexto que consumen auth.uid() y los helpers AuthZ.
select set_config('role', 'authenticated', false);
select set_config(
  'request.jwt.claim.sub',
  '95555555-5555-4555-8555-555555555501',
  false
);
select set_config(
  'request.jwt.claim.role',
  'authenticated',
  false
);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '95555555-5555-4555-8555-555555555501',
    'role', 'authenticated'
  )::text,
  false
);

-- Fail-closed antes de lanzar la carrera: no medir concurrencia con una
-- identidad que la RPC no reconoce como admin.
do $auth_context_guard$
declare
  v_uid uuid := auth.uid();
  v_role text := public.tc_current_role();
begin
  if v_uid is distinct from '95555555-5555-4555-8555-555555555501'::uuid then
    raise exception
      'U15C_AUTH_CONTEXT_FAIL: auth.uid()=% expected=95555555-5555-4555-8555-555555555501',
      coalesce(v_uid::text, 'null')
      using errcode = '42501';
  end if;

  if v_role is distinct from 'admin' then
    raise exception
      'U15C_AUTH_CONTEXT_FAIL: tc_current_role()=% expected=admin',
      coalesce(v_role, 'null')
      using errcode = '42501';
  end if;
end
$auth_context_guard$;

-- Barrera de reloj: ambas sesiones despiertan en :t0 y compiten por la clave.
select pg_sleep(greatest(0, extract(epoch from (:'t0'::timestamptz - clock_timestamp()))));

\pset tuples_only on
\pset format unaligned
select 'U15C_CONC_RESULT slot=' || :'slot' || ' ' || pg_temp.probe_call(:'ticket'::uuid, :'key');
