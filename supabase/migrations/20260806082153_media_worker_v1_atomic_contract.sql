-- TC-DEB8FDCC-MEDIA-WORKER-V1-LOCAL-IMPLEMENTATION-28 · Commit A
--
-- Contrato SQL/RPC para el media worker `media-worker/v1`.
--
-- Motivacion (auditoria TC-DEB8FDCC-STAGING-RUNTIME-WORKERS-AND-317-LEDGER-03):
--   1. `supabase/config.toml` expone unicamente `schemas = ["public","graphql_public"]`,
--      por lo que `app_private.tc_claim_media_job` / `tc_complete_media_job` /
--      `tc_fail_media_job` NO son alcanzables por la Data API desde una Edge Function.
--      Se anaden wrappers minimos en `public`, SECURITY DEFINER, solo para `service_role`.
--   2. No existia ninguna transicion de `adjuntos_ticket.estado` de 'procesando' a
--      'listo' ni a 'cuarentena' en produccion. La unica promocion vivia en el fixture
--      `supabase/tests/media_pipeline_runtime.sql`. Esto dejaba todo adjunto subido en
--      un estado terminal muerto y explicaba los fallos S08/S19/S20/S21 del Storage E2E.
--
-- Invariantes que esta migracion establece:
--   * Un adjunto solo pasa a 'listo' si se persistio al menos un derivado real para su
--     (version, source_checksum). No hay camino para marcar 'listo' sin procesamiento.
--   * Todo identificador operado se deriva del job leased; nunca de un argumento libre.
--   * El agotamiento de reintentos deja el adjunto en 'cuarentena' en la misma transaccion.
--   * `tc_prepare_media_delete` acepta 'listo' y 'cuarentena'; sigue rechazando
--     'pendiente', 'procesando' y 'eliminado'. Legal hold y retencion quedan intactos.
--   * Un adjunto en cuarentena cuyo borrado se aborte vuelve a 'cuarentena', nunca a
--     'listo' (evita blanquear contenido rechazado a traves del ciclo de borrado).
--
-- NO se reemplaza ni se elimina `app_private.tc_complete_media_job(uuid,uuid)`:
-- se conserva intacta por compatibilidad y se anaden RPC atomicas especificas del worker.

begin;

-- ---------------------------------------------------------------------------
-- 0. Guardas de dependencia. Fail-closed.
-- ---------------------------------------------------------------------------

do $media_worker_dependencies$
begin
  if pg_catalog.to_regclass('public.adjuntos_ticket') is null
     or pg_catalog.to_regclass('public.trabajos_adjuntos') is null
     or pg_catalog.to_regclass('public.derivados_adjuntos') is null
     or pg_catalog.to_regclass('public.retencion_adjuntos') is null
     or pg_catalog.to_regprocedure('app_private.tc_claim_media_job(text,integer)') is null
     or pg_catalog.to_regprocedure('app_private.tc_complete_media_job(uuid,uuid)') is null
     or pg_catalog.to_regprocedure('app_private.tc_fail_media_job(uuid,uuid,text)') is null
     or pg_catalog.to_regprocedure('public.tc_prepare_media_delete(uuid)') is null
  then
    raise exception 'MEDIA_WORKER_DEPENDENCY_MISSING' using errcode = '42P01';
  end if;
end
$media_worker_dependencies$;

-- ---------------------------------------------------------------------------
-- 1. Preservacion del estado previo al borrado.
--
-- `tc_prepare_media_delete` mueve el adjunto a 'procesando' mientras el borrado
-- esta en vuelo y `tc_abort_media_delete` lo restauraba incondicionalmente a
-- 'listo'. Al admitir ahora tambien 'cuarentena' como origen, esa restauracion
-- incondicional convertiria un adjunto rechazado en servible. Se persiste el
-- estado previo de forma explicita.
--
-- El CHECK `(estado = 'cuarentena') = (motivo_cuarentena is not null)` impide
-- conservar el motivo mientras el adjunto esta en 'procesando'; por eso el motivo
-- se aparca en una columna dedicada.
-- ---------------------------------------------------------------------------

alter table public.adjuntos_ticket
  add column estado_pre_borrado text,
  add column motivo_cuarentena_pre_borrado text;

alter table public.adjuntos_ticket
  add constraint adjuntos_ticket_estado_pre_borrado_valido
    check (estado_pre_borrado is null or estado_pre_borrado in ('listo', 'cuarentena')),
  add constraint adjuntos_ticket_delete_token_pareado
    check ((delete_token is not null) = (estado_pre_borrado is not null)),
  add constraint adjuntos_ticket_motivo_pre_borrado_pareado
    check (
      estado_pre_borrado is null
      or (estado_pre_borrado = 'cuarentena') = (motivo_cuarentena_pre_borrado is not null)
    );

comment on column public.adjuntos_ticket.estado_pre_borrado is
  'Estado del adjunto antes de tc_prepare_media_delete. Consumido por abort/finalize.';
comment on column public.adjuntos_ticket.motivo_cuarentena_pre_borrado is
  'Motivo de cuarentena aparcado durante el borrado en vuelo. Restaurado por abort.';

-- ---------------------------------------------------------------------------
-- 2. Catalogo cerrado de motivos de cuarentena.
--
-- El worker nunca escribe texto libre en `motivo_cuarentena`. Solo codigos de
-- esta lista, sin datos del usuario, sin nombres de archivo y sin payloads.
-- ---------------------------------------------------------------------------

create or replace function app_private.tc_media_quarantine_reason_is_valid(p_reason text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $function$
  select p_reason in (
    'MEDIA_SOURCE_CHECKSUM_MISMATCH',
    'MEDIA_SIGNATURE_OR_MIME_REJECTED',
    'MEDIA_DECODE_FAILED',
    'MEDIA_OBJECT_MISSING',
    'MEDIA_SIZE_LIMIT_EXCEEDED',
    'MEDIA_DERIVATIVE_CHECKSUM_CONFLICT',
    'MEDIA_UNSUPPORTED_KIND_PDF',
    'MEDIA_UNSUPPORTED_KIND_VIDEO',
    'MEDIA_JOB_DEAD_LETTER'
  )
$function$;

comment on function app_private.tc_media_quarantine_reason_is_valid(text) is
  'Catalogo cerrado de motivos de cuarentena admitidos por el worker media-worker/v1.';

-- ---------------------------------------------------------------------------
-- 3. Wrapper de claim en `public`.
--
-- Reclama hasta p_limit jobs (tope duro 5) y devuelve el contexto completo del
-- adjunto para que el worker no necesite lecturas adicionales.
-- ---------------------------------------------------------------------------

create or replace function public.tc_worker_claim_media_jobs(
  p_worker_id text,
  p_lease_seconds integer default 120,
  p_limit integer default 5
)
returns table (
  job_id uuid,
  lease_token uuid,
  adjunto_id uuid,
  job_tipo text,
  job_version text,
  source_checksum_sha256 text,
  intentos integer,
  max_intentos integer,
  bucket_id text,
  storage_path text,
  mime_declarado text,
  mime_detectado text,
  adjunto_tipo text,
  adjunto_estado text,
  tamano_bytes bigint,
  adjunto_checksum_sha256 text
)
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_claim record;
  v_job public.trabajos_adjuntos%rowtype;
  v_adjunto public.adjuntos_ticket%rowtype;
  v_index integer;
begin
  if nullif(trim(coalesce(p_worker_id, '')), '') is null or length(p_worker_id) > 120 then
    raise exception 'MEDIA_WORKER_ID_INVALID' using errcode = '22023';
  end if;
  if p_lease_seconds is null or p_lease_seconds not between 15 and 900 then
    raise exception 'MEDIA_LEASE_SECONDS_INVALID' using errcode = '22023';
  end if;
  if p_limit is null or p_limit not between 1 and 5 then
    raise exception 'MEDIA_CLAIM_LIMIT_INVALID' using errcode = '22023';
  end if;

  for v_index in 1 .. p_limit loop
    select * into v_claim
    from app_private.tc_claim_media_job(p_worker_id, p_lease_seconds)
    limit 1;
    exit when not found;

    select * into v_job from public.trabajos_adjuntos where id = v_claim.job_id;
    exit when not found;
    select * into v_adjunto from public.adjuntos_ticket where id = v_claim.adjunto_id;
    exit when not found;

    job_id := v_claim.job_id;
    lease_token := v_claim.lease_token;
    adjunto_id := v_claim.adjunto_id;
    job_tipo := v_claim.tipo;
    job_version := v_claim.version;
    source_checksum_sha256 := v_claim.source_checksum_sha256;
    intentos := v_claim.intentos;
    max_intentos := v_job.max_intentos;
    bucket_id := v_adjunto.bucket_id;
    storage_path := v_adjunto.storage_path;
    mime_declarado := v_adjunto.mime_declarado;
    mime_detectado := v_adjunto.mime_detectado;
    adjunto_tipo := v_adjunto.tipo;
    adjunto_estado := v_adjunto.estado;
    tamano_bytes := v_adjunto.tamano_bytes;
    adjunto_checksum_sha256 := v_adjunto.checksum_sha256;
    return next;
  end loop;
end
$function$;

-- ---------------------------------------------------------------------------
-- 4. Finalizacion atomica con exito: derivados + promocion a 'listo'.
--
-- Una sola transaccion: valida job, lease, adjunto y checksum; persiste
-- derivados; promueve el adjunto; completa el job. No existe estado intermedio
-- observable.
-- ---------------------------------------------------------------------------

create or replace function public.tc_worker_complete_media_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_derivados jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_job public.trabajos_adjuntos%rowtype;
  v_adjunto public.adjuntos_ticket%rowtype;
  v_element jsonb;
  v_persisted integer;
  v_existing public.derivados_adjuntos%rowtype;
begin
  if p_job_id is null or p_lease_token is null then
    raise exception 'MEDIA_JOB_ARGUMENTS_INVALID' using errcode = '22023';
  end if;

  -- El job es la unica fuente de identidad. Bloqueo por id + estado + lease.
  select * into v_job
  from public.trabajos_adjuntos
  where id = p_job_id and estado = 'ejecutando' and lease_token = p_lease_token
  for update;
  if not found then
    raise exception 'MEDIA_JOB_LEASE_MISMATCH' using errcode = '42501';
  end if;
  if v_job.lease_expira_en is null or v_job.lease_expira_en < now() then
    raise exception 'MEDIA_JOB_LEASE_EXPIRED' using errcode = '42501';
  end if;

  -- El adjunto se deriva del job, nunca de un argumento del llamante.
  select * into v_adjunto
  from public.adjuntos_ticket
  where id = v_job.adjunto_id
  for update;
  if not found then
    raise exception 'MEDIA_ATTACHMENT_MISSING' using errcode = 'P0002';
  end if;
  if v_adjunto.estado <> 'procesando' then
    raise exception 'MEDIA_ATTACHMENT_STATE_INVALID' using errcode = '22023';
  end if;
  if v_adjunto.delete_token is not null then
    raise exception 'MEDIA_ATTACHMENT_DELETE_IN_FLIGHT' using errcode = '55006';
  end if;
  if v_adjunto.checksum_sha256 is distinct from v_job.source_checksum_sha256 then
    raise exception 'MEDIA_SOURCE_CHECKSUM_MISMATCH' using errcode = '22023';
  end if;

  -- Sin derivados no hay promocion. Esta es la invariante central.
  if p_derivados is null
     or jsonb_typeof(p_derivados) <> 'array'
     or jsonb_array_length(p_derivados) = 0
  then
    raise exception 'MEDIA_DERIVATIVES_REQUIRED' using errcode = '22023';
  end if;

  for v_element in select value from jsonb_array_elements(p_derivados) loop
    if jsonb_typeof(v_element) <> 'object' then
      raise exception 'MEDIA_DERIVATIVE_SHAPE_INVALID' using errcode = '22023';
    end if;
    if coalesce(v_element->>'checksum_sha256', '') !~ '^[0-9a-f]{64}$' then
      raise exception 'MEDIA_DERIVATIVE_CHECKSUM_INVALID' using errcode = '22023';
    end if;
    if coalesce(v_element->>'tipo', '') not in (
      'review_webp', 'thumbnail_webp', 'pdf_poster_webp',
      'video_proxy_720p', 'video_poster_webp', 'video_contact_sheet_webp'
    ) then
      raise exception 'MEDIA_DERIVATIVE_TYPE_INVALID' using errcode = '22023';
    end if;
    if coalesce(v_element->>'storage_path', '') = ''
       or v_element->>'storage_path' ~* '^https?://' then
      raise exception 'MEDIA_DERIVATIVE_PATH_INVALID' using errcode = '22023';
    end if;
    if coalesce((v_element->>'tamano_bytes')::bigint, 0) <= 0 then
      raise exception 'MEDIA_DERIVATIVE_SIZE_INVALID' using errcode = '22023';
    end if;

    -- Idempotencia: si el derivado ya existe, su checksum debe coincidir.
    select * into v_existing
    from public.derivados_adjuntos
    where adjunto_id = v_job.adjunto_id
      and tipo = v_element->>'tipo'
      and version = v_job.version
      and source_checksum_sha256 = v_job.source_checksum_sha256;
    if found and v_existing.checksum_sha256 is distinct from (v_element->>'checksum_sha256') then
      raise exception 'MEDIA_DERIVATIVE_CHECKSUM_CONFLICT' using errcode = '23505';
    end if;

    insert into public.derivados_adjuntos (
      adjunto_id, tipo, version, bucket_id, storage_path, mime_type,
      tamano_bytes, checksum_sha256, source_checksum_sha256, ancho, alto
    ) values (
      v_job.adjunto_id,
      v_element->>'tipo',
      v_job.version,
      'soporte_adjuntos',
      v_element->>'storage_path',
      v_element->>'mime_type',
      (v_element->>'tamano_bytes')::bigint,
      v_element->>'checksum_sha256',
      v_job.source_checksum_sha256,
      nullif(v_element->>'ancho', '')::integer,
      nullif(v_element->>'alto', '')::integer
    )
    -- Se referencia la tupla de columnas y no el nombre truncado del indice.
    on conflict (adjunto_id, tipo, version, source_checksum_sha256)
    do nothing;
  end loop;

  select count(*) into v_persisted
  from public.derivados_adjuntos
  where adjunto_id = v_job.adjunto_id
    and version = v_job.version
    and source_checksum_sha256 = v_job.source_checksum_sha256;
  if v_persisted = 0 then
    raise exception 'MEDIA_DERIVATIVES_NOT_PERSISTED' using errcode = '23514';
  end if;

  update public.adjuntos_ticket
  set estado = 'listo',
      motivo_cuarentena = null,
      actualizado_en = now()
  where id = v_job.adjunto_id;

  update public.trabajos_adjuntos
  set estado = 'completado',
      lease_token = null,
      lease_expira_en = null,
      completado_en = now(),
      ultimo_error_codigo = null,
      ultimo_error_detalle = null,
      actualizado_en = now()
  where id = v_job.id;
end
$function$;

-- ---------------------------------------------------------------------------
-- 5. Rechazo determinista: cuarentena atomica y job completado.
--
-- Un rechazo determinista NO es un fallo transitorio: no consume reintentos y
-- no vuelve a la cola. El job se cierra como procesado con cuarentena.
-- ---------------------------------------------------------------------------

create or replace function public.tc_worker_quarantine_media_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_motivo_codigo text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_job public.trabajos_adjuntos%rowtype;
  v_adjunto public.adjuntos_ticket%rowtype;
begin
  if p_job_id is null or p_lease_token is null then
    raise exception 'MEDIA_JOB_ARGUMENTS_INVALID' using errcode = '22023';
  end if;
  if not app_private.tc_media_quarantine_reason_is_valid(p_motivo_codigo) then
    raise exception 'MEDIA_QUARANTINE_REASON_INVALID' using errcode = '22023';
  end if;

  select * into v_job
  from public.trabajos_adjuntos
  where id = p_job_id and estado = 'ejecutando' and lease_token = p_lease_token
  for update;
  if not found then
    raise exception 'MEDIA_JOB_LEASE_MISMATCH' using errcode = '42501';
  end if;

  select * into v_adjunto
  from public.adjuntos_ticket
  where id = v_job.adjunto_id
  for update;
  if not found then
    raise exception 'MEDIA_ATTACHMENT_MISSING' using errcode = 'P0002';
  end if;
  if v_adjunto.estado <> 'procesando' then
    raise exception 'MEDIA_ATTACHMENT_STATE_INVALID' using errcode = '22023';
  end if;
  if v_adjunto.delete_token is not null then
    raise exception 'MEDIA_ATTACHMENT_DELETE_IN_FLIGHT' using errcode = '55006';
  end if;

  update public.adjuntos_ticket
  set estado = 'cuarentena',
      motivo_cuarentena = p_motivo_codigo,
      actualizado_en = now()
  where id = v_job.adjunto_id;

  update public.trabajos_adjuntos
  set estado = 'completado',
      lease_token = null,
      lease_expira_en = null,
      completado_en = now(),
      ultimo_error_codigo = p_motivo_codigo,
      ultimo_error_detalle = null,
      actualizado_en = now()
  where id = v_job.id;
end
$function$;

-- ---------------------------------------------------------------------------
-- 6. Fallo transitorio con dead-letter atomico.
--
-- Delega el backoff exponencial y el conteo de intentos en
-- `app_private.tc_fail_media_job` (sin duplicar la politica). Si el intento
-- agotaba `max_intentos`, el adjunto pasa a cuarentena en la misma transaccion.
-- ---------------------------------------------------------------------------

create or replace function public.tc_worker_fail_media_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_error_code text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_job public.trabajos_adjuntos%rowtype;
  v_dead boolean;
begin
  if p_job_id is null or p_lease_token is null then
    raise exception 'MEDIA_JOB_ARGUMENTS_INVALID' using errcode = '22023';
  end if;
  if coalesce(p_error_code, '') !~ '^[A-Z0-9_]{3,80}$' then
    raise exception 'MEDIA_ERROR_CODE_INVALID' using errcode = '22023';
  end if;

  select * into v_job
  from public.trabajos_adjuntos
  where id = p_job_id and estado = 'ejecutando' and lease_token = p_lease_token
  for update;
  if not found then
    raise exception 'MEDIA_JOB_LEASE_MISMATCH' using errcode = '42501';
  end if;

  v_dead := v_job.intentos >= v_job.max_intentos;

  perform app_private.tc_fail_media_job(p_job_id, p_lease_token, p_error_code);

  if v_dead then
    update public.adjuntos_ticket
    set estado = 'cuarentena',
        motivo_cuarentena = 'MEDIA_JOB_DEAD_LETTER',
        actualizado_en = now()
    where id = v_job.adjunto_id
      and estado = 'procesando'
      and delete_token is null;
  end if;

  return case when v_dead then 'muerto' else 'fallido' end;
end
$function$;

-- ---------------------------------------------------------------------------
-- 7. Borrado: aceptar 'listo' y 'cuarentena'.
--
-- Se conservan sin cambio alguno las validaciones de legal hold y de retencion.
-- Se sigue rechazando 'pendiente', 'procesando' y 'eliminado'.
-- ---------------------------------------------------------------------------

create or replace function public.tc_prepare_media_delete(p_adjunto_id uuid)
returns table(storage_path text, delete_token uuid)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_attachment public.adjuntos_ticket%rowtype;
  v_retention public.retencion_adjuntos%rowtype;
  v_token uuid := gen_random_uuid();
begin
  select * into v_attachment from public.adjuntos_ticket
  where id = p_adjunto_id for update;
  if not found then raise exception 'MEDIA_ATTACHMENT_NOT_FOUND'; end if;
  if v_attachment.estado not in ('listo', 'cuarentena') then
    raise exception 'MEDIA_DELETE_STATE_INVALID';
  end if;
  select * into v_retention from public.retencion_adjuntos where adjunto_id = p_adjunto_id;
  if found and v_retention.legal_hold then raise exception 'MEDIA_DELETE_LEGAL_HOLD'; end if;
  if found and v_retention.retener_hasta is not null and v_retention.retener_hasta > now() then
    raise exception 'MEDIA_DELETE_RETENTION_ACTIVE';
  end if;
  update public.adjuntos_ticket
  set estado = 'procesando',
      delete_token = v_token,
      estado_pre_borrado = v_attachment.estado,
      motivo_cuarentena_pre_borrado = v_attachment.motivo_cuarentena,
      motivo_cuarentena = null,
      actualizado_en = now()
  where id = p_adjunto_id;
  return query select v_attachment.storage_path, v_token;
end
$function$;

create or replace function public.tc_finalize_media_delete(p_adjunto_id uuid, p_delete_token uuid)
returns boolean
language sql
security definer
set search_path = pg_catalog, public
as $function$
  update public.adjuntos_ticket
  set estado = 'eliminado',
      eliminado_en = now(),
      delete_token = null,
      estado_pre_borrado = null,
      motivo_cuarentena_pre_borrado = null,
      actualizado_en = now()
  where id = p_adjunto_id and estado = 'procesando' and delete_token = p_delete_token
  returning true
$function$;

-- Restaura el estado exacto previo. Un adjunto en cuarentena nunca se blanquea
-- a 'listo' por abortar un borrado.
create or replace function public.tc_abort_media_delete(p_adjunto_id uuid, p_delete_token uuid)
returns boolean
language sql
security definer
set search_path = pg_catalog, public
as $function$
  update public.adjuntos_ticket
  set estado = coalesce(estado_pre_borrado, 'listo'),
      motivo_cuarentena = motivo_cuarentena_pre_borrado,
      delete_token = null,
      estado_pre_borrado = null,
      motivo_cuarentena_pre_borrado = null,
      actualizado_en = now()
  where id = p_adjunto_id and estado = 'procesando' and delete_token = p_delete_token
  returning true
$function$;

-- ---------------------------------------------------------------------------
-- 8. ACL. Nada de esto es alcanzable por anon ni por usuarios autenticados.
-- ---------------------------------------------------------------------------

revoke execute on function app_private.tc_media_quarantine_reason_is_valid(text)
  from public, anon, authenticated;
revoke execute on function public.tc_worker_claim_media_jobs(text, integer, integer)
  from public, anon, authenticated;
revoke execute on function public.tc_worker_complete_media_job(uuid, uuid, jsonb)
  from public, anon, authenticated;
revoke execute on function public.tc_worker_quarantine_media_job(uuid, uuid, text)
  from public, anon, authenticated;
revoke execute on function public.tc_worker_fail_media_job(uuid, uuid, text)
  from public, anon, authenticated;
revoke execute on function public.tc_prepare_media_delete(uuid)
  from public, anon, authenticated;
revoke execute on function public.tc_finalize_media_delete(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.tc_abort_media_delete(uuid, uuid)
  from public, anon, authenticated;

grant execute on function app_private.tc_media_quarantine_reason_is_valid(text) to service_role;
grant execute on function public.tc_worker_claim_media_jobs(text, integer, integer) to service_role;
grant execute on function public.tc_worker_complete_media_job(uuid, uuid, jsonb) to service_role;
grant execute on function public.tc_worker_quarantine_media_job(uuid, uuid, text) to service_role;
grant execute on function public.tc_worker_fail_media_job(uuid, uuid, text) to service_role;
grant execute on function public.tc_prepare_media_delete(uuid) to service_role;
grant execute on function public.tc_finalize_media_delete(uuid, uuid) to service_role;
grant execute on function public.tc_abort_media_delete(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 9. Verificacion fail-closed de la propia migracion.
-- ---------------------------------------------------------------------------

do $media_worker_verify$
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
    if pg_catalog.to_regprocedure(v_signature) is null then
      raise exception 'MEDIA_WORKER_RPC_MISSING: %', v_signature;
    end if;
    foreach v_role in array array['public', 'anon', 'authenticated'] loop
      if pg_catalog.has_function_privilege(v_role, v_signature, 'EXECUTE') then
        raise exception 'MEDIA_WORKER_RPC_OVEREXPOSED: % / %', v_signature, v_role;
      end if;
    end loop;
    if not pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE') then
      raise exception 'MEDIA_WORKER_RPC_NOT_GRANTED: %', v_signature;
    end if;
  end loop;

  -- `app_private.tc_complete_media_job(uuid,uuid)` debe seguir existiendo intacta.
  if pg_catalog.to_regprocedure('app_private.tc_complete_media_job(uuid,uuid)') is null then
    raise exception 'MEDIA_WORKER_LEGACY_RPC_REMOVED';
  end if;
end
$media_worker_verify$;

commit;
