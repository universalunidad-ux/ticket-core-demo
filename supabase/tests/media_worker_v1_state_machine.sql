-- TC-DEB8FDCC-MEDIA-WORKER-V1-LOCAL-IMPLEMENTATION-28 · Commit A
--
-- Pruebas de maquina de estados del contrato `media-worker/v1` contra una base
-- PostgreSQL viva. Requiere Docker + `supabase db reset` y por tanto NO se
-- ejecuta en el entorno de implementacion. Terminal debe correrlo con:
--
--   docker exec -i supabase_db_<project> psql -X -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/media_worker_v1_state_machine.sql
--
-- Todo el script vive en una unica transaccion que termina en ROLLBACK: no deja
-- ninguna fila, ningun job y ningun objeto huerfano.
--
-- NOTA: este script NO toca Storage. Los derivados se declaran como metadatos.
-- El E2E de Storage lo cubre la matriz S01..S21 despues del deploy del worker.

\set ON_ERROR_STOP on

begin;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into auth.users(id, aud, role, email, email_confirmed_at,
                       raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('deb8fdcc-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
        'media-worker-sm@example.invalid', now(), '{}', '{}', now(), now());

insert into public.perfiles(id, rol, nombre, tema, activo)
values ('deb8fdcc-0000-0000-0000-000000000001', 'admin', 'Media Worker SM', 'light', true);

insert into public.clientes(id, nombre, origen_registro)
values ('deb8fdcc-1111-1111-1111-111111111111', 'Media Worker SM Client', 'ticket_core');

insert into public.tickets(id, cliente_id, asignado_a, titulo, estado, prioridad, folio)
values
 ('deb8fdcc-2222-0000-0000-000000000001', 'deb8fdcc-1111-1111-1111-111111111111',
  'deb8fdcc-0000-0000-0000-000000000001', 'SM happy path', 'abierto', 'media', 'MW-SM-001'),
 ('deb8fdcc-2222-0000-0000-000000000002', 'deb8fdcc-1111-1111-1111-111111111111',
  'deb8fdcc-0000-0000-0000-000000000001', 'SM quarantine', 'abierto', 'media', 'MW-SM-002'),
 ('deb8fdcc-2222-0000-0000-000000000003', 'deb8fdcc-1111-1111-1111-111111111111',
  'deb8fdcc-0000-0000-0000-000000000001', 'SM dead letter', 'abierto', 'media', 'MW-SM-003');

do $fixtures$
declare
  v_sha text := repeat('a', 64);
  v_sha_b text := repeat('b', 64);
  v_sha_c text := repeat('c', 64);
  v_id uuid;
begin
  -- Tres adjuntos canonicos, cada uno con su job encolado por
  -- tc_claim_media_upload + tc_finalize_media_upload.
  select adjunto_id into v_id from public.tc_claim_media_upload(
    'deb8fdcc-2222-0000-0000-000000000001', null,
    'deb8fdcc-2222-0000-0000-000000000001/sm/a.png', 'a.png',
    'image/png', 'image/png', 'image', 1024, v_sha, null, 'publica',
    'media-worker-sm-idem-000000001', repeat('1', 64), 'interno',
    'deb8fdcc-0000-0000-0000-000000000001');
  perform public.tc_finalize_media_upload(v_id, repeat('1', 64));

  select adjunto_id into v_id from public.tc_claim_media_upload(
    'deb8fdcc-2222-0000-0000-000000000002', null,
    'deb8fdcc-2222-0000-0000-000000000002/sm/b.png', 'b.png',
    'image/png', 'image/png', 'image', 2048, v_sha_b, null, 'publica',
    'media-worker-sm-idem-000000002', repeat('2', 64), 'interno',
    'deb8fdcc-0000-0000-0000-000000000001');
  perform public.tc_finalize_media_upload(v_id, repeat('2', 64));

  select adjunto_id into v_id from public.tc_claim_media_upload(
    'deb8fdcc-2222-0000-0000-000000000003', null,
    'deb8fdcc-2222-0000-0000-000000000003/sm/c.png', 'c.png',
    'image/png', 'image/png', 'image', 4096, v_sha_c, null, 'publica',
    'media-worker-sm-idem-000000003', repeat('3', 64), 'interno',
    'deb8fdcc-0000-0000-0000-000000000001');
  perform public.tc_finalize_media_upload(v_id, repeat('3', 64));

  if (select count(*) from public.trabajos_adjuntos) <> 3 then
    raise exception 'FAIL: expected three queued jobs';
  end if;
  if (select count(*) from public.adjuntos_ticket where estado = 'procesando') <> 3 then
    raise exception 'FAIL: expected three attachments in procesando';
  end if;
  raise notice 'PASS: fixtures queued three jobs in procesando';
end
$fixtures$;

-- ---------------------------------------------------------------------------
-- M01  claim: un job por llamada, lease unico, no reentrega bajo lease vigente
-- ---------------------------------------------------------------------------

do $m01_claim$
declare
  v_first record;
  v_second record;
  v_third record;
  v_all uuid[];
begin
  select * into v_first from public.tc_worker_claim_media_jobs('sm-worker-1', 120, 1);
  if v_first.job_id is null then raise exception 'FAIL M01: first claim empty'; end if;
  if v_first.lease_token is null then raise exception 'FAIL M01: no lease token'; end if;
  if v_first.adjunto_estado <> 'procesando' then
    raise exception 'FAIL M01: claimed attachment not in procesando';
  end if;

  -- Un segundo claim no puede devolver el mismo job mientras el lease vive.
  select * into v_second from public.tc_worker_claim_media_jobs('sm-worker-2', 120, 1);
  if v_second.job_id = v_first.job_id then
    raise exception 'FAIL M01: the same job was leased twice';
  end if;
  if v_second.lease_token = v_first.lease_token then
    raise exception 'FAIL M01: lease token collision';
  end if;

  select * into v_third from public.tc_worker_claim_media_jobs('sm-worker-3', 120, 1);
  v_all := array[v_first.job_id, v_second.job_id, v_third.job_id];
  if (select count(distinct j) from unnest(v_all) as j) <> 3 then
    raise exception 'FAIL M01: claims are not disjoint';
  end if;

  -- Cola agotada: respuesta vacia, no error.
  if exists (select 1 from public.tc_worker_claim_media_jobs('sm-worker-4', 120, 5)) then
    raise exception 'FAIL M01: queue should be empty';
  end if;

  if (select count(*) from public.trabajos_adjuntos where estado = 'ejecutando') <> 3 then
    raise exception 'FAIL M01: expected three leased jobs';
  end if;
  raise notice 'PASS M01: one job per claim, unique leases, empty queue is not an error';
end
$m01_claim$;

-- ---------------------------------------------------------------------------
-- M02  claim: argumentos fuera de contrato
-- ---------------------------------------------------------------------------

do $m02_claim_args$
declare v_ok boolean;
begin
  begin
    perform public.tc_worker_claim_media_jobs('sm-worker', 120, 6);
    raise exception 'FAIL M02: batch of 6 accepted';
  exception when others then
    if sqlerrm not like '%MEDIA_CLAIM_LIMIT_INVALID%' then raise; end if;
  end;
  begin
    perform public.tc_worker_claim_media_jobs('sm-worker', 5, 1);
    raise exception 'FAIL M02: lease of 5s accepted';
  exception when others then
    if sqlerrm not like '%MEDIA_LEASE_SECONDS_INVALID%' then raise; end if;
  end;
  begin
    perform public.tc_worker_claim_media_jobs('   ', 120, 1);
    raise exception 'FAIL M02: blank worker id accepted';
  exception when others then
    if sqlerrm not like '%MEDIA_WORKER_ID_INVALID%' then raise; end if;
  end;
  raise notice 'PASS M02: claim rejects out-of-contract arguments';
end
$m02_claim_args$;

-- ---------------------------------------------------------------------------
-- M03  complete: lease incorrecto denegado
-- ---------------------------------------------------------------------------

do $m03_bad_lease$
declare v_job public.trabajos_adjuntos%rowtype;
begin
  select * into v_job from public.trabajos_adjuntos where estado = 'ejecutando' order by creado_en limit 1;
  begin
    perform public.tc_worker_complete_media_job(v_job.id, gen_random_uuid(),
      jsonb_build_array(jsonb_build_object(
        'tipo', 'thumbnail_webp', 'storage_path', 'x/y.webp', 'mime_type', 'image/webp',
        'tamano_bytes', 10, 'checksum_sha256', repeat('d', 64))));
    raise exception 'FAIL M03: wrong lease accepted by complete';
  exception when others then
    if sqlerrm not like '%MEDIA_JOB_LEASE_MISMATCH%' then raise; end if;
  end;
  begin
    perform public.tc_worker_quarantine_media_job(v_job.id, gen_random_uuid(), 'MEDIA_DECODE_FAILED');
    raise exception 'FAIL M03: wrong lease accepted by quarantine';
  exception when others then
    if sqlerrm not like '%MEDIA_JOB_LEASE_MISMATCH%' then raise; end if;
  end;
  begin
    perform public.tc_worker_fail_media_job(v_job.id, gen_random_uuid(), 'MEDIA_TRANSIENT');
    raise exception 'FAIL M03: wrong lease accepted by fail';
  exception when others then
    if sqlerrm not like '%MEDIA_JOB_LEASE_MISMATCH%' then raise; end if;
  end;
  raise notice 'PASS M03: a wrong lease is denied by every worker RPC';
end
$m03_bad_lease$;

-- ---------------------------------------------------------------------------
-- M04  complete: sin derivados no hay promocion a 'listo'
-- ---------------------------------------------------------------------------

do $m04_no_derivatives$
declare v_job public.trabajos_adjuntos%rowtype;
begin
  select * into v_job from public.trabajos_adjuntos where estado = 'ejecutando' order by creado_en limit 1;
  begin
    perform public.tc_worker_complete_media_job(v_job.id, v_job.lease_token, '[]'::jsonb);
    raise exception 'FAIL M04: empty derivative array accepted';
  exception when others then
    if sqlerrm not like '%MEDIA_DERIVATIVES_REQUIRED%' then raise; end if;
  end;
  begin
    perform public.tc_worker_complete_media_job(v_job.id, v_job.lease_token, null);
    raise exception 'FAIL M04: null derivative set accepted';
  exception when others then
    if sqlerrm not like '%MEDIA_DERIVATIVES_REQUIRED%' then raise; end if;
  end;
  if (select estado from public.adjuntos_ticket where id = v_job.adjunto_id) <> 'procesando' then
    raise exception 'FAIL M04: attachment moved despite the rejection';
  end if;
  raise notice 'PASS M04: no promotion to listo without real derivatives';
end
$m04_no_derivatives$;

-- ---------------------------------------------------------------------------
-- M05  complete: camino feliz, transicion atomica y derivados persistidos
-- ---------------------------------------------------------------------------

do $m05_happy$
declare
  v_job public.trabajos_adjuntos%rowtype;
  v_adjunto public.adjuntos_ticket%rowtype;
  v_derived integer;
begin
  select * into v_job from public.trabajos_adjuntos where estado = 'ejecutando' order by creado_en limit 1;
  select * into v_adjunto from public.adjuntos_ticket where id = v_job.adjunto_id;

  perform public.tc_worker_complete_media_job(v_job.id, v_job.lease_token,
    jsonb_build_array(
      jsonb_build_object(
        'tipo', 'review_webp',
        'storage_path', v_adjunto.storage_path || '.review.v1.webp',
        'mime_type', 'image/webp', 'tamano_bytes', 4096,
        'checksum_sha256', repeat('e', 64), 'ancho', 320, 'alto', 320),
      jsonb_build_object(
        'tipo', 'thumbnail_webp',
        'storage_path', v_adjunto.storage_path || '.thumb.v1.webp',
        'mime_type', 'image/webp', 'tamano_bytes', 512,
        'checksum_sha256', repeat('f', 64), 'ancho', 160, 'alto', 160)));

  select * into v_adjunto from public.adjuntos_ticket where id = v_job.adjunto_id;
  if v_adjunto.estado <> 'listo' then
    raise exception 'FAIL M05: attachment is % instead of listo', v_adjunto.estado;
  end if;
  if v_adjunto.motivo_cuarentena is not null then
    raise exception 'FAIL M05: motivo_cuarentena was not cleared';
  end if;

  select * into v_job from public.trabajos_adjuntos where id = v_job.id;
  if v_job.estado <> 'completado' then
    raise exception 'FAIL M05: job is % instead of completado', v_job.estado;
  end if;
  if v_job.lease_token is not null or v_job.lease_expira_en is not null then
    raise exception 'FAIL M05: lease not released';
  end if;
  if v_job.completado_en is null then
    raise exception 'FAIL M05: completado_en not set';
  end if;

  select count(*) into v_derived from public.derivados_adjuntos
   where adjunto_id = v_adjunto.id and version = 'media-worker/v1';
  if v_derived <> 2 then
    raise exception 'FAIL M05: expected two derivatives, found %', v_derived;
  end if;
  if exists (select 1 from public.derivados_adjuntos
             where adjunto_id = v_adjunto.id
               and source_checksum_sha256 <> v_adjunto.checksum_sha256) then
    raise exception 'FAIL M05: derivative source checksum does not match the attachment';
  end if;
  raise notice 'PASS M05: atomic promotion with persisted, checksummed derivatives';
end
$m05_happy$;

-- ---------------------------------------------------------------------------
-- M06  idempotencia: repetir complete sobre un job ya cerrado es rechazado
-- ---------------------------------------------------------------------------

do $m06_idempotency$
declare
  v_job public.trabajos_adjuntos%rowtype;
  v_before integer;
  v_after integer;
begin
  select * into v_job from public.trabajos_adjuntos where estado = 'completado' limit 1;
  select count(*) into v_before from public.derivados_adjuntos where adjunto_id = v_job.adjunto_id;
  begin
    perform public.tc_worker_complete_media_job(v_job.id, gen_random_uuid(),
      jsonb_build_array(jsonb_build_object(
        'tipo', 'thumbnail_webp', 'storage_path', 'z/dup.webp', 'mime_type', 'image/webp',
        'tamano_bytes', 10, 'checksum_sha256', repeat('9', 64))));
    raise exception 'FAIL M06: a completed job accepted a second completion';
  exception when others then
    if sqlerrm not like '%MEDIA_JOB_LEASE_MISMATCH%' then raise; end if;
  end;
  select count(*) into v_after from public.derivados_adjuntos where adjunto_id = v_job.adjunto_id;
  if v_before <> v_after then
    raise exception 'FAIL M06: derivative count changed on a rejected replay';
  end if;
  raise notice 'PASS M06: second invocation is idempotent and side-effect free';
end
$m06_idempotency$;

-- ---------------------------------------------------------------------------
-- M07  cuarentena: motivo enumerado, adjunto en cuarentena, job completado
-- ---------------------------------------------------------------------------

do $m07_quarantine$
declare
  v_job public.trabajos_adjuntos%rowtype;
  v_adjunto public.adjuntos_ticket%rowtype;
begin
  select * into v_job from public.trabajos_adjuntos where estado = 'ejecutando' order by creado_en limit 1;

  begin
    perform public.tc_worker_quarantine_media_job(v_job.id, v_job.lease_token, 'MOTIVO_LIBRE');
    raise exception 'FAIL M07: free-text quarantine reason accepted';
  exception when others then
    if sqlerrm not like '%MEDIA_QUARANTINE_REASON_INVALID%' then raise; end if;
  end;

  perform public.tc_worker_quarantine_media_job(
    v_job.id, v_job.lease_token, 'MEDIA_SOURCE_CHECKSUM_MISMATCH');

  select * into v_adjunto from public.adjuntos_ticket where id = v_job.adjunto_id;
  if v_adjunto.estado <> 'cuarentena' then
    raise exception 'FAIL M07: attachment is % instead of cuarentena', v_adjunto.estado;
  end if;
  if v_adjunto.motivo_cuarentena <> 'MEDIA_SOURCE_CHECKSUM_MISMATCH' then
    raise exception 'FAIL M07: quarantine reason not recorded';
  end if;

  select * into v_job from public.trabajos_adjuntos where id = v_job.id;
  if v_job.estado <> 'completado' then
    raise exception 'FAIL M07: quarantined job is % instead of completado', v_job.estado;
  end if;
  if v_job.intentos > 1 then
    raise exception 'FAIL M07: deterministic rejection consumed retries';
  end if;
  if not exists (select 1 from public.derivados_adjuntos where adjunto_id = v_adjunto.id) then
    null; -- correcto: una cuarentena no produce derivados
  else
    raise exception 'FAIL M07: quarantine produced derivatives';
  end if;
  raise notice 'PASS M07: deterministic rejection quarantines without consuming retries';
end
$m07_quarantine$;

-- ---------------------------------------------------------------------------
-- M08  fallo transitorio: backoff y reencolado; el adjunto sigue en procesando
-- ---------------------------------------------------------------------------

do $m08_transient$
declare
  v_job public.trabajos_adjuntos%rowtype;
  v_state text;
  v_after public.trabajos_adjuntos%rowtype;
begin
  select * into v_job from public.trabajos_adjuntos where estado = 'ejecutando' order by creado_en limit 1;

  begin
    perform public.tc_worker_fail_media_job(v_job.id, v_job.lease_token, 'codigo minusculas');
    raise exception 'FAIL M08: malformed error code accepted';
  exception when others then
    if sqlerrm not like '%MEDIA_ERROR_CODE_INVALID%' then raise; end if;
  end;

  v_state := public.tc_worker_fail_media_job(v_job.id, v_job.lease_token, 'MEDIA_STORAGE_TIMEOUT');
  if v_state <> 'fallido' then
    raise exception 'FAIL M08: expected fallido, got %', v_state;
  end if;

  select * into v_after from public.trabajos_adjuntos where id = v_job.id;
  if v_after.estado <> 'fallido' then raise exception 'FAIL M08: job not requeued'; end if;
  if v_after.lease_token is not null then raise exception 'FAIL M08: lease not released'; end if;
  if v_after.disponible_en <= now() then
    raise exception 'FAIL M08: backoff did not push disponible_en into the future';
  end if;
  if v_after.ultimo_error_codigo <> 'MEDIA_STORAGE_TIMEOUT' then
    raise exception 'FAIL M08: error code not recorded';
  end if;
  if (select estado from public.adjuntos_ticket where id = v_job.adjunto_id) <> 'procesando' then
    raise exception 'FAIL M08: a transient failure must not move the attachment';
  end if;
  raise notice 'PASS M08: transient failure requeues with backoff, attachment untouched';
end
$m08_transient$;

-- ---------------------------------------------------------------------------
-- M09  dead-letter: agotar intentos deja job 'muerto' y adjunto en cuarentena
-- ---------------------------------------------------------------------------

do $m09_dead_letter$
declare
  v_job_id uuid;
  v_adjunto_id uuid;
  v_claim record;
  v_state text;
  v_job public.trabajos_adjuntos%rowtype;
  v_adjunto public.adjuntos_ticket%rowtype;
  v_i integer;
begin
  select id, adjunto_id into v_job_id, v_adjunto_id
  from public.trabajos_adjuntos where estado = 'fallido' limit 1;

  -- max_intentos por defecto = 5; ya se consumio 1 intento en M08.
  update public.trabajos_adjuntos set max_intentos = 2, disponible_en = now() where id = v_job_id;

  for v_i in 1 .. 4 loop
    update public.trabajos_adjuntos set disponible_en = now() where id = v_job_id;
    select * into v_claim from public.tc_worker_claim_media_jobs('sm-dead', 120, 1);
    exit when v_claim.job_id is null;
    v_state := public.tc_worker_fail_media_job(v_claim.job_id, v_claim.lease_token, 'MEDIA_STORAGE_TIMEOUT');
    exit when v_state = 'muerto';
  end loop;

  if v_state <> 'muerto' then
    raise exception 'FAIL M09: job never reached dead-letter, last state %', v_state;
  end if;

  select * into v_job from public.trabajos_adjuntos where id = v_job_id;
  if v_job.estado <> 'muerto' then
    raise exception 'FAIL M09: job is % instead of muerto', v_job.estado;
  end if;

  select * into v_adjunto from public.adjuntos_ticket where id = v_adjunto_id;
  if v_adjunto.estado <> 'cuarentena' then
    raise exception 'FAIL M09: dead-lettered attachment is % instead of cuarentena', v_adjunto.estado;
  end if;
  if v_adjunto.motivo_cuarentena <> 'MEDIA_JOB_DEAD_LETTER' then
    raise exception 'FAIL M09: dead-letter reason not recorded';
  end if;
  raise notice 'PASS M09: exhausting retries quarantines the attachment atomically';
end
$m09_dead_letter$;

-- ---------------------------------------------------------------------------
-- M10  borrado: 'cuarentena' es eliminable, 'procesando' no
-- ---------------------------------------------------------------------------

do $m10_delete_states$
declare
  v_quarantined uuid;
  v_token uuid;
  v_path text;
  v_processing uuid;
begin
  select id into v_quarantined from public.adjuntos_ticket where estado = 'cuarentena' limit 1;
  select storage_path, delete_token into v_path, v_token
  from public.tc_prepare_media_delete(v_quarantined);
  if v_token is null then raise exception 'FAIL M10: quarantined attachment is not deletable'; end if;

  -- Mientras el borrado esta en vuelo el adjunto esta en 'procesando': un
  -- segundo prepare debe fallar.
  begin
    perform public.tc_prepare_media_delete(v_quarantined);
    raise exception 'FAIL M10: prepare accepted an attachment in procesando';
  exception when others then
    if sqlerrm not like '%MEDIA_DELETE_STATE_INVALID%' then raise; end if;
  end;

  -- Abortar debe devolverlo a 'cuarentena', nunca a 'listo'.
  perform public.tc_abort_media_delete(v_quarantined, v_token);
  if (select estado from public.adjuntos_ticket where id = v_quarantined) <> 'cuarentena' then
    raise exception 'FAIL M10: abort laundered a quarantined attachment';
  end if;
  if (select motivo_cuarentena from public.adjuntos_ticket where id = v_quarantined) is null then
    raise exception 'FAIL M10: abort lost the quarantine reason';
  end if;

  raise notice 'PASS M10: quarantine is deletable, procesando is not, abort does not launder';
end
$m10_delete_states$;

-- ---------------------------------------------------------------------------
-- M11  borrado: legal hold y retencion activa siguen bloqueando
-- ---------------------------------------------------------------------------

do $m11_retention$
declare
  v_ready uuid;
  v_policy uuid;
begin
  select id into v_ready from public.adjuntos_ticket where estado = 'listo' limit 1;

  insert into public.retencion_adjuntos(adjunto_id, legal_hold, referencia_legal, establecido_por)
  values (v_ready, true, 'SM-LEGAL-REF', 'deb8fdcc-0000-0000-0000-000000000001');
  begin
    perform public.tc_prepare_media_delete(v_ready);
    raise exception 'FAIL M11: legal hold did not block the delete';
  exception when others then
    if sqlerrm not like '%MEDIA_DELETE_LEGAL_HOLD%' then raise; end if;
  end;

  insert into public.politicas_retencion_adjuntos(
    nombre, intervalo_retencion, referencia_aprobacion, aprobada_por)
  values ('sm-policy', interval '30 days', 'SM-APPROVAL-REF',
          'deb8fdcc-0000-0000-0000-000000000001')
  returning id into v_policy;

  update public.retencion_adjuntos
  set legal_hold = false, referencia_legal = null,
      politica_id = v_policy, retener_hasta = now() + interval '30 days'
  where adjunto_id = v_ready;
  begin
    perform public.tc_prepare_media_delete(v_ready);
    raise exception 'FAIL M11: active retention did not block the delete';
  exception when others then
    if sqlerrm not like '%MEDIA_DELETE_RETENTION_ACTIVE%' then raise; end if;
  end;

  if (select estado from public.adjuntos_ticket where id = v_ready) <> 'listo' then
    raise exception 'FAIL M11: a blocked delete moved the attachment';
  end if;
  raise notice 'PASS M11: legal hold and active retention still block deletion';
end
$m11_retention$;

-- ---------------------------------------------------------------------------
-- M12  ACL: ningun rol de la Data API distinto de service_role puede ejecutar
-- ---------------------------------------------------------------------------

do $m12_acl$
declare
  v_signature text;
  v_role text;
begin
  foreach v_signature in array array[
    'public.tc_worker_claim_media_jobs(text,integer,integer)',
    'public.tc_worker_complete_media_job(uuid,uuid,jsonb)',
    'public.tc_worker_quarantine_media_job(uuid,uuid,text)',
    'public.tc_worker_fail_media_job(uuid,uuid,text)'
  ] loop
    foreach v_role in array array['anon', 'authenticated'] loop
      if has_function_privilege(v_role, v_signature, 'EXECUTE') then
        raise exception 'FAIL M12: % is executable by %', v_signature, v_role;
      end if;
    end loop;
    if not has_function_privilege('service_role', v_signature, 'EXECUTE') then
      raise exception 'FAIL M12: % is not executable by service_role', v_signature;
    end if;
  end loop;
  raise notice 'PASS M12: worker RPC reachable only by service_role';
end
$m12_acl$;

-- ---------------------------------------------------------------------------
-- M13  sin huerfanos: todo derivado y todo job apuntan a un adjunto existente
-- ---------------------------------------------------------------------------

do $m13_orphans$
begin
  if exists (
    select 1 from public.derivados_adjuntos d
    left join public.adjuntos_ticket a on a.id = d.adjunto_id
    where a.id is null
  ) then raise exception 'FAIL M13: orphan derivative'; end if;

  if exists (
    select 1 from public.trabajos_adjuntos j
    left join public.adjuntos_ticket a on a.id = j.adjunto_id
    where a.id is null
  ) then raise exception 'FAIL M13: orphan job'; end if;

  if exists (
    select 1 from public.adjuntos_ticket
    where estado = 'cuarentena' and motivo_cuarentena is null
  ) then raise exception 'FAIL M13: quarantined attachment without a reason'; end if;

  if exists (
    select 1 from public.adjuntos_ticket
    where delete_token is not null and estado_pre_borrado is null
  ) then raise exception 'FAIL M13: delete token without a preserved state'; end if;

  raise notice 'PASS M13: no orphan rows and no broken invariants';
end
$m13_orphans$;

select 'MEDIA_WORKER_V1_STATE_MACHINE=PASS' as result;

-- Cero residuos: la transaccion completa se descarta.
rollback;
