-- Ticket Core staging baseline 0001.
-- Preconditions: Supabase-managed auth/storage schemas exist.
-- Rollback: COMPENSATING_MIGRATION_REQUIRED (extensions may be shared).
begin;

do $fresh_baseline_preflight$
declare
  conflicting_objects text;
begin
  select string_agg(format('%I.%I', n.nspname, c.relname), ', ' order by n.nspname, c.relname)
  into conflicting_objects
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = any (array[
      'archivos_ticket','avisos_globales','bitacora','cliente_accesos','cliente_aliases',
      'cliente_sistemas','clientes','clientes_contactos','clientes_contacto_historial',
      'edge_idempotency','perfiles','rate_limit_events','reglas_asignacion','solicitud_archivos',
      'solicitudes_alta','solicitudes_registro','solicitudes_soporte','ticket_eventos',
      'ticket_folios','ticket_match_decisiones','ticket_portal_logs','ticket_respuestas_rapidas',
      'tickets','site_config','ticket_archivos'
    ]);

  if conflicting_objects is not null then
    raise exception 'TC_FRESH_BASELINE_DRIFT: canonical/transition objects already exist: %', conflicting_objects
      using errcode = '55000';
  end if;

  if to_regnamespace('app_private') is not null then
    raise exception 'TC_FRESH_BASELINE_DRIFT: schema app_private already exists'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('next_ticket_folio', 'manage_assignment_rule', 'manage_site_config',
        'manage_ticket_assignment', 'consolidate_ticket_client')
  ) then
    raise exception 'TC_FRESH_BASELINE_DRIFT: canonical public function already exists'
      using errcode = '55000';
  end if;

  if exists (select 1 from storage.buckets where id = 'soporte_adjuntos') then
    raise exception 'TC_FRESH_BASELINE_DRIFT: storage bucket soporte_adjuntos already exists'
      using errcode = '55000';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and (
        policyname like 'soporte_adjuntos_%'
        or coalesce(qual, '') ilike '%soporte_adjuntos%'
        or coalesce(with_check, '') ilike '%soporte_adjuntos%'
      )
  ) then
    raise exception 'TC_FRESH_BASELINE_DRIFT: storage policies already affect soporte_adjuntos'
      using errcode = '55000';
  end if;
end;
$fresh_baseline_preflight$;

-- Shared Supabase extension: idempotent installation is intentional. All
-- Ticket Core-owned objects below are strict and must not preexist.
create extension if not exists pgcrypto with schema extensions;

create schema app_private;
revoke all on schema app_private from public, anon, authenticated;
grant usage on schema app_private to authenticated, service_role;

create function app_private.normalized_text(value text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select nullif(
    trim(regexp_replace(
      lower(translate(coalesce(value, ''),
        'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')),
      '[^a-z0-9]+', ' ', 'g')),
    ''
  );
$$;

create function app_private.plain_text_is_safe(value text, max_length integer default 400)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select value is not null
    and char_length(value) between 1 and max_length
    and value !~ '[<>]'
    and lower(value) !~ '(javascript|data)[[:space:]]*:'
    and value !~ '[[:cntrl:]]';
$$;

create function app_private.ticket_event_meta_is_safe(value jsonb)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select jsonb_typeof(coalesce(value, '{}'::jsonb)) = 'object'
    and not exists (
      select 1
      from jsonb_object_keys(coalesce(value, '{}'::jsonb)) as key
      where key not in (
        'canal', 'folio', 'estado_anterior', 'estado_nuevo', 'reply_to',
        'reply_to_autor_tipo', 'reply_to_kind', 'reply_to_texto',
        'reply_preview', 'reply_author', 'reply_kind',
        'idempotency_key', 'archivos_count', 'adjuntos', 'errores',
        'accion', 'por', 'cliente_id', 'contacto_id', 'requiere_consolidacion',
        'empresa_capturada', 'nombre_capturado', 'cliente_id_sugerido',
        'contacto_id_sugerido', 'capturado_preservado', 'asignado_a',
        'prioridad', 'sla_policy', 'migrated_from', 'legacy_id', 'origen',
        'autor', 'autor_id', 'sistema', 'replyAction', 'quick_key',
        'target_role', 'requires_admin_review', 'nota_cierre', 'actor_id',
        'actor_nombre', 'actor_rol', 'ref_evento_id', 'ref_evento_preview',
        'ref_archivo_id', 'ref_archivo_meta', 'comentario', 'content_type'
      )
    );
$$;

create function app_private.audit_detail_is_safe(value jsonb)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select jsonb_typeof(coalesce(value, '{}'::jsonb)) = 'object'
    and not exists (
      select 1
      from jsonb_object_keys(coalesce(value, '{}'::jsonb)) as key
      where lower(key) ~ '(password|secret|token|authorization|signed.?url|url_firma|credential)'
    );
$$;

revoke all on all functions in schema app_private from public, anon, authenticated;
grant execute on function app_private.normalized_text(text) to service_role;
grant execute on function app_private.plain_text_is_safe(text, integer) to service_role;
grant execute on function app_private.ticket_event_meta_is_safe(jsonb) to service_role;
grant execute on function app_private.audit_detail_is_safe(jsonb) to service_role;

commit;
