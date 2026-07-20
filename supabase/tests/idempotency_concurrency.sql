-- IDEMPOTENCIA · Prueba de reclamo atómico (STAGING).
--   psql "$STAGING_URL" -v ON_ERROR_STOP=1 -f supabase/tests/idempotency_concurrency.sql
-- Demuestra que con la MISMA clave solo un reclamo gana (claimed=true) y el
-- segundo ve el estado existente (claimed=false). Para concurrencia real usar dos
-- sesiones simultáneas (misma clave): el segundo INSERT choca con la PK única.
-- Estado local: TEST_HARNESS_FIXED_BUT_NOT_EXECUTED (sin PG).
\set ON_ERROR_STOP on
begin;

do $$
declare c1 record; c2 record; c3 record;
begin
  select * into c1 from public.support_idem_claim('k-concurrency-1','fp1');
  if not c1.claimed then raise exception 'FAIL: primer reclamo debería ganar'; end if;

  select * into c2 from public.support_idem_claim('k-concurrency-1','fp1');
  if c2.claimed then raise exception 'FAIL: segundo reclamo NO debería ganar (doble ticket)'; end if;
  if c2.status <> 'processing' then raise exception 'FAIL: estado inesperado %', c2.status; end if;
  raise notice 'PASS: solo un reclamo gana; el segundo ve processing (409)';

  -- Tras marcar succeeded, el reclamo devuelve la respuesta almacenada (reuso).
  perform public.support_idem_finish('k-concurrency-1','succeeded','{"ok":true,"folio":"EX-1"}'::jsonb);
  select * into c3 from public.support_idem_claim('k-concurrency-1','fp1');
  if c3.claimed or c3.status <> 'succeeded' then raise exception 'FAIL: no reusó respuesta'; end if;
  raise notice 'PASS: reintento reusa respuesta succeeded';

  -- Ante failed, se permite re-reclamar (no consume la clave por error previo).
  perform public.support_idem_finish('k-concurrency-1','failed', null);
  select * into c3 from public.support_idem_claim('k-concurrency-1','fp1');
  if not c3.claimed then raise exception 'FAIL: failed debería permitir reintento'; end if;
  raise notice 'PASS: failed permite reintento';
end $$;

rollback;
