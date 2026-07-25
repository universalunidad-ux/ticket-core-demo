-- GENERATED FILE — DO NOT EDIT MANUALLY
-- SOURCE: tools/authz-policy-manifest.json
-- SOURCE_SECTION: legacy_to_drop
-- SOURCE_SHA256: 03e5aa18071ea14ea1516c96531b34b53b01e53d55a7242bd90b14f4fb4a0eb4
-- GENERATOR: tools/generate-authz-policy-reconciliation.mjs
-- PREPARED_NOT_APPLIED
-- DO_NOT_APPLY_WITHOUT_STAGING_REVIEW

begin;

drop policy if exists "admin_select" on "public"."archivos_ticket";
drop policy if exists "archivos_support_scope" on "public"."archivos_ticket";
drop policy if exists "admin_select" on "public"."avisos_globales";
drop policy if exists "public_active_notices_anon_select" on "public"."avisos_globales";
drop policy if exists "public_active_notices_authenticated_select" on "public"."avisos_globales";
drop policy if exists "bitacora_admin_select" on "public"."bitacora";
drop policy if exists "bitacora_support_own_select" on "public"."bitacora";
drop policy if exists "accesos_support_scope" on "public"."cliente_accesos";
drop policy if exists "admin_select" on "public"."cliente_accesos";
drop policy if exists "admin_select" on "public"."cliente_aliases";
drop policy if exists "aliases_support_scope" on "public"."cliente_aliases";
drop policy if exists "admin_select" on "public"."cliente_sistemas";
drop policy if exists "cliente_sistemas_select_staff" on "public"."cliente_sistemas";
drop policy if exists "sistemas_support_scope" on "public"."cliente_sistemas";
drop policy if exists "admin_select" on "public"."clientes";
drop policy if exists "clientes_admin_select_ticket_core" on "public"."clientes";
drop policy if exists "clientes_support_scope" on "public"."clientes";
drop policy if exists "admin_select" on "public"."clientes_contactos";
drop policy if exists "contactos_support_scope" on "public"."clientes_contactos";
drop policy if exists "profiles_admin_safe_update" on "public"."perfiles";
drop policy if exists "profiles_admin_select" on "public"."perfiles";
drop policy if exists "profiles_self_update" on "public"."perfiles";
drop policy if exists "profiles_team_select" on "public"."perfiles";
drop policy if exists "admin_select" on "public"."reglas_asignacion";
drop policy if exists "assignment_rules_support_select" on "public"."reglas_asignacion";
drop policy if exists "admin_select" on "public"."site_config";
drop policy if exists "public_site_config_anon_select" on "public"."site_config";
drop policy if exists "public_site_config_authenticated_select" on "public"."site_config";
drop policy if exists "admin_select" on "public"."solicitudes_soporte";
drop policy if exists "solicitudes_support_scope" on "public"."solicitudes_soporte";
drop policy if exists "ticket_archivos_admin_read" on "public"."ticket_archivos";
drop policy if exists "ticket_archivos_support_read" on "public"."ticket_archivos";
drop policy if exists "admin_select" on "public"."ticket_eventos";
drop policy if exists "eventos_support_scope" on "public"."ticket_eventos";
drop policy if exists "admin_select" on "public"."ticket_respuestas_rapidas";
drop policy if exists "quick_replies_support_select" on "public"."ticket_respuestas_rapidas";
drop policy if exists "admin_select" on "public"."tickets";
drop policy if exists "tickets_support_select" on "public"."tickets";

do $verify$
declare
  v_remaining text;
begin
  select string_agg(
    format(
      '%I.%I.%I',
      p.schemaname,
      p.tablename,
      p.policyname
    ),
    ', '
    order by
      p.schemaname,
      p.tablename,
      p.policyname
  )
  into v_remaining
  from pg_policies p
  join (
    values
      ('public', 'archivos_ticket', 'admin_select'),
      ('public', 'archivos_ticket', 'archivos_support_scope'),
      ('public', 'avisos_globales', 'admin_select'),
      ('public', 'avisos_globales', 'public_active_notices_anon_select'),
      ('public', 'avisos_globales', 'public_active_notices_authenticated_select'),
      ('public', 'bitacora', 'bitacora_admin_select'),
      ('public', 'bitacora', 'bitacora_support_own_select'),
      ('public', 'cliente_accesos', 'accesos_support_scope'),
      ('public', 'cliente_accesos', 'admin_select'),
      ('public', 'cliente_aliases', 'admin_select'),
      ('public', 'cliente_aliases', 'aliases_support_scope'),
      ('public', 'cliente_sistemas', 'admin_select'),
      ('public', 'cliente_sistemas', 'cliente_sistemas_select_staff'),
      ('public', 'cliente_sistemas', 'sistemas_support_scope'),
      ('public', 'clientes', 'admin_select'),
      ('public', 'clientes', 'clientes_admin_select_ticket_core'),
      ('public', 'clientes', 'clientes_support_scope'),
      ('public', 'clientes_contactos', 'admin_select'),
      ('public', 'clientes_contactos', 'contactos_support_scope'),
      ('public', 'perfiles', 'profiles_admin_safe_update'),
      ('public', 'perfiles', 'profiles_admin_select'),
      ('public', 'perfiles', 'profiles_self_update'),
      ('public', 'perfiles', 'profiles_team_select'),
      ('public', 'reglas_asignacion', 'admin_select'),
      ('public', 'reglas_asignacion', 'assignment_rules_support_select'),
      ('public', 'site_config', 'admin_select'),
      ('public', 'site_config', 'public_site_config_anon_select'),
      ('public', 'site_config', 'public_site_config_authenticated_select'),
      ('public', 'solicitudes_soporte', 'admin_select'),
      ('public', 'solicitudes_soporte', 'solicitudes_support_scope'),
      ('public', 'ticket_archivos', 'ticket_archivos_admin_read'),
      ('public', 'ticket_archivos', 'ticket_archivos_support_read'),
      ('public', 'ticket_eventos', 'admin_select'),
      ('public', 'ticket_eventos', 'eventos_support_scope'),
      ('public', 'ticket_respuestas_rapidas', 'admin_select'),
      ('public', 'ticket_respuestas_rapidas', 'quick_replies_support_select'),
      ('public', 'tickets', 'admin_select'),
      ('public', 'tickets', 'tickets_support_select')
  ) as retired(
    schemaname,
    tablename,
    policyname
  )
    on retired.schemaname = p.schemaname
   and retired.tablename = p.tablename
   and retired.policyname = p.policyname;

  if v_remaining is not null then
    raise exception
      'TC_RETIRED_POLICY_REMAINS: %',
      v_remaining
      using errcode = '55000';
  end if;
end
$verify$;

commit;
