-- TC-BACKEND-SECURITY-MACROBATCH-02
-- REQUIREMENTS: OPS-LOG-001, TC-U025, TC-U050, TC-U051
-- PREPARED_NOT_APPLIED
-- STATIC_CONTRACT_ONLY: no PostgreSQL/Supabase/Edge runtime claim.
-- Rollback: compensating migration after application.

begin;

do $identity_guard$
begin
  if pg_catalog.to_regclass('public.bitacora') is null
     or pg_catalog.to_regclass('public.rate_limit_events') is null
     or pg_catalog.to_regclass('public.perfiles') is null
     or pg_catalog.to_regprocedure(
       'app_private.audit_detail_is_safe(jsonb)'
     ) is null
  then
    raise exception 'TC_BSM02_REQUIRED_BASELINE_MISSING'
      using errcode = '55000';
  end if;

  if pg_catalog.to_regclass('public.app_error_events') is not null
     or pg_catalog.to_regclass('public.app_incidents') is not null
     or pg_catalog.to_regclass('public.mail_outbox') is not null
     or pg_catalog.to_regprocedure(
       'app_private.error_context_is_safe(jsonb)'
     ) is not null
  then
    raise exception 'TC_BSM02_OBJECT_COLLISION'
      using errcode = '42P07';
  end if;
end
$identity_guard$;

create function app_private.error_context_is_safe(value jsonb)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $error_context_is_safe$
  select pg_catalog.jsonb_typeof(coalesce(value, '{}'::jsonb)) = 'object'
    and app_private.audit_detail_is_safe(coalesce(value, '{}'::jsonb))
    and not exists (
      select 1
      from pg_catalog.jsonb_object_keys(coalesce(value, '{}'::jsonb)) key
      where key not in (
        'component',
        'operation',
        'http_status',
        'online',
        'retryable',
        'viewport_bucket'
      )
    )
$error_context_is_safe$;

revoke all on function app_private.error_context_is_safe(jsonb)
  from public, anon, authenticated;
grant execute on function app_private.error_context_is_safe(jsonb)
  to service_role;

create table public.app_incidents (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null unique
    check (fingerprint ~ '^[a-f0-9]{64}$'),
  status text not null default 'open'
    check (status in ('open', 'acknowledged', 'resolved')),
  severity text not null
    check (severity in ('warning', 'error', 'critical')),
  code text not null
    check (code ~ '^[A-Z0-9_]{3,80}$'),
  source text not null
    check (source in ('browser', 'edge', 'database', 'worker')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  occurrence_count bigint not null default 1
    check (occurrence_count > 0),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.app_error_events (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null
    references public.app_incidents(id) on delete restrict,
  occurred_at timestamptz not null default now(),
  source text not null
    check (source in ('browser', 'edge', 'database', 'worker')),
  severity text not null
    check (severity in ('warning', 'error', 'critical')),
  code text not null
    check (code ~ '^[A-Z0-9_]{3,80}$'),
  route text
    check (route is null or char_length(route) between 1 and 240),
  release text
    check (release is null or char_length(release) between 1 and 120),
  request_id uuid not null,
  fingerprint text not null
    check (fingerprint ~ '^[a-f0-9]{64}$'),
  context jsonb not null default '{}'::jsonb
    check (app_private.error_context_is_safe(context)),
  created_at timestamptz not null default now()
);

create table public.mail_outbox (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique
    check (char_length(idempotency_key) between 16 and 200),
  channel text not null
    check (channel in ('ops_email')),
  recipient_key text not null
    check (recipient_key in ('primary_ops')),
  template text not null
    check (template in ('incident_critical_v1')),
  payload jsonb not null
    check (jsonb_typeof(payload) = 'object')
    check (app_private.audit_detail_is_safe(payload)),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'failed')),
  attempts integer not null default 0
    check (attempts between 0 and 20),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by uuid,
  sent_at timestamptz,
  last_error_code text
    check (
      last_error_code is null
      or last_error_code ~ '^[A-Z0-9_]{3,80}$'
    ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'processing' and locked_at is not null and locked_by is not null)
    or status <> 'processing'
  ),
  check (
    (status = 'sent' and sent_at is not null)
    or status <> 'sent'
  )
);

alter table public.app_incidents enable row level security;
alter table public.app_error_events enable row level security;
alter table public.mail_outbox enable row level security;

revoke all on table public.app_incidents
  from public, anon, authenticated;
revoke all on table public.app_error_events
  from public, anon, authenticated;
revoke all on table public.mail_outbox
  from public, anon, authenticated;

grant select, insert, update on table public.app_incidents
  to service_role;
grant select, insert on table public.app_error_events
  to service_role;
grant select, insert, update on table public.mail_outbox
  to service_role;

create index app_incidents_status_severity_idx
  on public.app_incidents(status, severity, last_seen_at desc);
create index app_error_events_incident_time_idx
  on public.app_error_events(incident_id, occurred_at desc);
create index app_error_events_request_id_idx
  on public.app_error_events(request_id);
create index mail_outbox_claim_idx
  on public.mail_outbox(status, available_at, created_at)
  where status in ('pending', 'failed');

create function public.record_client_error(
  p_fingerprint text,
  p_source text,
  p_severity text,
  p_code text,
  p_route text,
  p_release text,
  p_request_id uuid,
  p_context jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $record_client_error$
declare
  v_incident_id uuid;
  v_event_id uuid;
  v_context jsonb := coalesce(p_context, '{}'::jsonb);
begin
  if p_fingerprint is null
     or p_fingerprint !~ '^[a-f0-9]{64}$'
     or p_source is null
     or p_source not in ('browser', 'edge', 'database', 'worker')
     or p_severity is null
     or p_severity not in ('warning', 'error', 'critical')
     or p_code is null
     or p_code !~ '^[A-Z0-9_]{3,80}$'
     or p_request_id is null
  then
    raise exception 'TC_BSM02_ERROR_EVENT_INVALID'
      using errcode = '22023';
  end if;

  if not app_private.error_context_is_safe(v_context)
  then
    raise exception 'TC_BSM02_ERROR_CONTEXT_INVALID'
      using errcode = '22023';
  end if;

  insert into public.app_incidents (
    fingerprint,
    severity,
    code,
    source
  )
  values (
    p_fingerprint,
    p_severity,
    p_code,
    p_source
  )
  on conflict (fingerprint) do update
    set last_seen_at = pg_catalog.now(),
        occurrence_count = public.app_incidents.occurrence_count + 1,
        severity = case
          when public.app_incidents.severity = 'critical'
            or excluded.severity = 'critical' then 'critical'
          when public.app_incidents.severity = 'error'
            or excluded.severity = 'error' then 'error'
          else 'warning'
        end,
        updated_at = pg_catalog.now()
  returning id into v_incident_id;

  insert into public.app_error_events (
    incident_id,
    source,
    severity,
    code,
    route,
    release,
    request_id,
    fingerprint,
    context
  )
  values (
    v_incident_id,
    p_source,
    p_severity,
    p_code,
    nullif(pg_catalog.left(trim(p_route), 240), ''),
    nullif(pg_catalog.left(trim(p_release), 120), ''),
    p_request_id,
    p_fingerprint,
    v_context
  )
  returning id into v_event_id;

  if p_severity = 'critical' then
    insert into public.mail_outbox (
      idempotency_key,
      channel,
      recipient_key,
      template,
      payload
    )
    values (
      'incident-critical:' || p_fingerprint,
      'ops_email',
      'primary_ops',
      'incident_critical_v1',
      pg_catalog.jsonb_build_object(
        'incident_id', v_incident_id,
        'code', p_code,
        'severity', p_severity,
        'request_id', p_request_id
      )
    )
    on conflict (idempotency_key) do nothing;
  end if;

  insert into public.bitacora (
    actor_tipo,
    accion,
    entidad_tipo,
    entidad_id,
    resultado,
    detalle,
    request_id
  )
  values (
    'service_role',
    'client_error_reported',
    'app_incident',
    v_incident_id,
    'error',
    pg_catalog.jsonb_build_object(
      'code', p_code,
      'severity', p_severity,
      'source', p_source
    ),
    p_request_id
  );

  return v_event_id;
end
$record_client_error$;

create function public.system_health_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $system_health_snapshot$
  select pg_catalog.jsonb_build_object(
    'status',
    case
      when exists (
        select 1
        from public.app_incidents
        where status <> 'resolved'
          and severity = 'critical'
      ) then 'degraded'
      when exists (
        select 1
        from public.mail_outbox
        where status = 'failed'
          and attempts >= 5
      ) then 'degraded'
      else 'ok'
    end,
    'open_incidents',
    (
      select count(*)
      from public.app_incidents
      where status <> 'resolved'
    ),
    'critical_incidents',
    (
      select count(*)
      from public.app_incidents
      where status <> 'resolved'
        and severity = 'critical'
    ),
    'pending_outbox',
    (
      select count(*)
      from public.mail_outbox
      where status in ('pending', 'failed')
    ),
    'checked_at',
    pg_catalog.now()
  )
$system_health_snapshot$;

create function public.claim_mail_outbox(
  p_worker uuid,
  p_limit integer default 20
)
returns setof public.mail_outbox
language plpgsql
security definer
set search_path = ''
as $claim_mail_outbox$
begin
  if p_worker is null or p_limit is null or p_limit not between 1 and 100 then
    raise exception 'TC_BSM02_OUTBOX_CLAIM_INVALID'
      using errcode = '22023';
  end if;

  return query
  with candidates as (
    select o.id
    from public.mail_outbox o
    where o.status in ('pending', 'failed')
      and o.available_at <= pg_catalog.now()
      and o.attempts < 20
    order by o.available_at, o.created_at
    for update skip locked
    limit p_limit
  )
  update public.mail_outbox o
  set status = 'processing',
      locked_at = pg_catalog.now(),
      locked_by = p_worker,
      attempts = o.attempts + 1,
      updated_at = pg_catalog.now()
  from candidates
  where o.id = candidates.id
  returning o.*;
end
$claim_mail_outbox$;

create function public.finish_mail_outbox(
  p_id uuid,
  p_worker uuid,
  p_status text,
  p_error_code text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $finish_mail_outbox$
declare
  v_rows integer;
begin
  if p_id is null
     or p_worker is null
     or p_status not in ('sent', 'failed')
     or (
       p_error_code is not null
       and p_error_code !~ '^[A-Z0-9_]{3,80}$'
     )
  then
    raise exception 'TC_BSM02_OUTBOX_FINISH_INVALID'
      using errcode = '22023';
  end if;

  update public.mail_outbox
  set status = p_status,
      sent_at = case when p_status = 'sent' then pg_catalog.now() else null end,
      last_error_code = case
        when p_status = 'failed' then p_error_code
        else null
      end,
      locked_at = null,
      locked_by = null,
      updated_at = pg_catalog.now()
  where id = p_id
    and status = 'processing'
    and locked_by = p_worker;

  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'TC_BSM02_OUTBOX_OWNERSHIP_MISMATCH'
      using errcode = '42501';
  end if;
end
$finish_mail_outbox$;

revoke all on function public.record_client_error(
  text, text, text, text, text, text, uuid, jsonb
) from public, anon, authenticated;
revoke all on function public.system_health_snapshot()
  from public, anon, authenticated;
revoke all on function public.claim_mail_outbox(uuid, integer)
  from public, anon, authenticated;
revoke all on function public.finish_mail_outbox(uuid, uuid, text, text)
  from public, anon, authenticated;

grant execute on function public.record_client_error(
  text, text, text, text, text, text, uuid, jsonb
) to service_role;
grant execute on function public.system_health_snapshot()
  to service_role;
grant execute on function public.claim_mail_outbox(uuid, integer)
  to service_role;
grant execute on function public.finish_mail_outbox(uuid, uuid, text, text)
  to service_role;

do $verify_bsm02$
declare
  v_table text;
  v_signature text;
  v_proc pg_catalog.regprocedure;
begin
  foreach v_table in array array[
    'app_error_events',
    'app_incidents',
    'mail_outbox'
  ]
  loop
    if not exists (
      select 1
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = v_table
        and c.relrowsecurity
    ) then
      raise exception 'TC_BSM02_RLS_DISABLED: %', v_table
        using errcode = '42501';
    end if;

    if exists (
      select 1
      from pg_catalog.pg_policies p
      where p.schemaname = 'public'
        and p.tablename = v_table
    ) then
      raise exception 'TC_BSM02_UNEXPECTED_POLICY: %', v_table
        using errcode = '42501';
    end if;

    if pg_catalog.has_table_privilege(
      'anon', 'public.' || v_table, 'SELECT'
    ) or pg_catalog.has_table_privilege(
      'authenticated', 'public.' || v_table, 'SELECT'
    ) then
      raise exception 'TC_BSM02_TABLE_ACL_LEAK: %', v_table
        using errcode = '42501';
    end if;
  end loop;

  foreach v_signature in array array[
    'public.record_client_error(text,text,text,text,text,text,uuid,jsonb)',
    'public.system_health_snapshot()',
    'public.claim_mail_outbox(uuid,integer)',
    'public.finish_mail_outbox(uuid,uuid,text,text)'
  ]
  loop
    v_proc := pg_catalog.to_regprocedure(v_signature);
    if v_proc is null
       or not pg_catalog.has_function_privilege(
         'service_role', v_proc, 'EXECUTE'
       )
       or pg_catalog.has_function_privilege(
         'anon', v_proc, 'EXECUTE'
       )
       or pg_catalog.has_function_privilege(
         'authenticated', v_proc, 'EXECUTE'
       )
    then
      raise exception 'TC_BSM02_RPC_ACL_INVALID: %', v_signature
        using errcode = '42501';
    end if;

    if not exists (
      select 1
      from pg_catalog.pg_proc p
      where p.oid = v_proc
        and p.prosecdef
        and exists (
          select 1
          from unnest(coalesce(p.proconfig, array[]::text[])) config
          where config in ('search_path=', 'search_path=""')
        )
    ) then
      raise exception 'TC_BSM02_RPC_SECURITY_INVALID: %', v_signature
        using errcode = '42501';
    end if;
  end loop;
end
$verify_bsm02$;

commit;
