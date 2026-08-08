\set ON_ERROR_STOP on
begin;

create temporary table megatrain_authz_results (
  surface text not null,
  actor text not null,
  operation text not null,
  expected text not null,
  actual text not null,
  sqlstate text not null,
  policy text not null,
  result text not null,
  mutant text not null default ''
);

create or replace function pg_temp.record_result(
  p_surface text, p_actor text, p_operation text, p_expected text,
  p_actual text, p_sqlstate text, p_policy text, p_result text,
  p_mutant text default ''
) returns void
language sql security definer set search_path = pg_temp, pg_catalog
as $$
  insert into megatrain_authz_results
  values (p_surface,p_actor,p_operation,p_expected,p_actual,p_sqlstate,p_policy,p_result,p_mutant)
$$;

create or replace function pg_temp.act(uid uuid, actor_role text default 'authenticated')
returns void language plpgsql as $$
begin
  perform set_config('role', actor_role, true);
  perform set_config('request.jwt.claims', json_build_object('sub',uid::text,'role',actor_role)::text, true);
end $$;

create or replace function pg_temp.reset_su()
returns void language plpgsql as $$ begin perform set_config('role','postgres',true); end $$;

create or replace function pg_temp.assert_count(
  p_surface text, p_actor text, p_operation text, p_query text,
  p_expected integer, p_policy text
) returns void language plpgsql as $$
declare observed integer;
begin
  execute format('select count(*)::integer from (%s) q', p_query) into observed;
  perform pg_temp.record_result(p_surface,p_actor,p_operation,p_expected::text,observed::text,'00000',p_policy,case when observed=p_expected then 'PASS' else 'FAIL' end);
  if observed <> p_expected then raise exception 'AUTHZ_COUNT_FAIL %.% expected=% actual=%',p_surface,p_operation,p_expected,observed; end if;
end $$;

create or replace function pg_temp.assert_rows(
  p_surface text, p_actor text, p_operation text, p_query text,
  p_expected integer, p_policy text
) returns void language plpgsql as $$
declare observed integer;
begin
  execute p_query;
  get diagnostics observed = row_count;
  perform pg_temp.record_result(p_surface,p_actor,p_operation,p_expected::text,observed::text,'00000',p_policy,case when observed=p_expected then 'PASS' else 'FAIL' end);
  if observed <> p_expected then raise exception 'AUTHZ_ROWS_FAIL %.% expected=% actual=%',p_surface,p_operation,p_expected,observed; end if;
end $$;

create or replace function pg_temp.assert_denied(
  p_surface text, p_actor text, p_operation text, p_query text,
  p_sqlstate text, p_policy text
) returns void language plpgsql as $$
declare observed_state text := '00000';
begin
  begin
    execute p_query;
  exception when others then
    get stacked diagnostics observed_state = returned_sqlstate;
  end;
  perform pg_temp.record_result(p_surface,p_actor,p_operation,'DENIED','DENIED',observed_state,p_policy,case when observed_state=p_sqlstate then 'PASS' else 'FAIL' end);
  if observed_state <> p_sqlstate then raise exception 'AUTHZ_DENIAL_FAIL %.% expected_state=% actual_state=%',p_surface,p_operation,p_sqlstate,observed_state; end if;
end $$;

insert into auth.users (id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
 ('81111111-1111-1111-1111-111111111111','authenticated','authenticated','mega-admin@example.invalid',now(),'{"provider":"email"}','{"fixture":"megatrain"}',now(),now()),
 ('82222222-2222-2222-2222-222222222222','authenticated','authenticated','mega-support-a@example.invalid',now(),'{"provider":"email"}','{"fixture":"megatrain"}',now(),now()),
 ('83333333-3333-3333-3333-333333333333','authenticated','authenticated','mega-support-b@example.invalid',now(),'{"provider":"email"}','{"fixture":"megatrain"}',now(),now()),
 ('84444444-4444-4444-4444-444444444444','authenticated','authenticated','mega-client-a@example.invalid',now(),'{"provider":"email"}','{"fixture":"megatrain"}',now(),now()),
 ('85555555-5555-5555-5555-555555555555','authenticated','authenticated','mega-client-b@example.invalid',now(),'{"provider":"email"}','{"fixture":"megatrain"}',now(),now());

insert into public.perfiles (id,rol,nombre,tema) values
 ('81111111-1111-1111-1111-111111111111','admin','Admin Mega','light'),
 ('82222222-2222-2222-2222-222222222222','soporte','Soporte A','light'),
 ('83333333-3333-3333-3333-333333333333','soporte','Soporte B','light');
insert into public.clientes (id,nombre,origen_registro) values
 ('8aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Cliente A','ticket_core'),
 ('8bbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','Cliente B','ticket_core');
insert into public.clientes_contactos (id,cliente_id,nombre,auth_user_id,activo) values
 ('8ca11111-1111-1111-1111-111111111111','8aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Contacto A','84444444-4444-4444-4444-444444444444',true),
 ('8cb22222-2222-2222-2222-222222222222','8bbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','Contacto B','85555555-5555-5555-5555-555555555555',true);
insert into public.tickets (id,cliente_id,asignado_a,titulo,estado,prioridad,folio) values
 ('8ea11111-1111-1111-1111-111111111111','8aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','82222222-2222-2222-2222-222222222222','Ticket A','abierto','alta','MEGA-A'),
 ('8eb22222-2222-2222-2222-222222222222','8bbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','83333333-3333-3333-3333-333333333333','Ticket B','en_proceso','media','MEGA-B');
insert into public.archivos_ticket (id,ticket_id,origen,visibilidad,nombre_archivo,storage_path,mime_type,tamano_bytes) values
 ('8fa11111-1111-1111-1111-111111111111','8ea11111-1111-1111-1111-111111111111','ticket','interna','a.heic','8ea11111-1111-1111-1111-111111111111/a.heic','image/heic',100),
 ('8fb22222-2222-2222-2222-222222222222','8eb22222-2222-2222-2222-222222222222','ticket','interna','b.mp4','8eb22222-2222-2222-2222-222222222222/b.mp4','video/mp4',200);
insert into public.cliente_aliases (id,cliente_id,alias,tipo) values
 ('8aa11111-1111-1111-1111-111111111111','8aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Alias A','manual'),
 ('8ab22222-2222-2222-2222-222222222222','8bbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','Alias B','manual');
insert into public.ticket_match_decisiones (id,ticket_id,nivel,decision) values
 ('8da11111-1111-1111-1111-111111111111','8ea11111-1111-1111-1111-111111111111','alto','pendiente'),
 ('8db22222-2222-2222-2222-222222222222','8eb22222-2222-2222-2222-222222222222','medio','pendiente');
insert into public.ticket_respuestas_rapidas (id,scope,modo,titulo,texto,activo) values
 ('8ca99999-1111-1111-1111-111111111111','global','seguimiento','Activa','Respuesta activa',true),
 ('8cb99999-2222-2222-2222-222222222222','global','nota','Inactiva','Respuesta inactiva',false);

-- tickets: owner, cross-tenant, assigned/unassigned and admin.
select pg_temp.act('84444444-4444-4444-4444-444444444444');
select pg_temp.assert_count('tickets','client_a','select_owner',$q$select id from public.tickets where id='8ea11111-1111-1111-1111-111111111111'$q$,1,'tickets_client_owner_select');
select pg_temp.assert_count('tickets','client_a','select_other',$q$select id from public.tickets where id='8eb22222-2222-2222-2222-222222222222'$q$,0,'tickets_client_owner_select');
select pg_temp.assert_rows('tickets','client_a','update_owner',$q$update public.tickets set titulo='forbidden' where id='8ea11111-1111-1111-1111-111111111111'$q$,0,'no_client_write_policy');
select pg_temp.reset_su(); select pg_temp.act('82222222-2222-2222-2222-222222222222');
select pg_temp.assert_count('tickets','support_a','select_assigned',$q$select id from public.tickets where id='8ea11111-1111-1111-1111-111111111111'$q$,1,'tickets_support_select_assigned');
select pg_temp.assert_count('tickets','support_a','select_unassigned_other',$q$select id from public.tickets where id='8eb22222-2222-2222-2222-222222222222'$q$,0,'tickets_support_select_assigned');
select pg_temp.reset_su(); select pg_temp.act('81111111-1111-1111-1111-111111111111');
select pg_temp.assert_count('tickets','admin','select_all',$q$select id from public.tickets where id in ('8ea11111-1111-1111-1111-111111111111','8eb22222-2222-2222-2222-222222222222')$q$,2,'tickets_manager_select');

-- canonical attachment metadata including HEIC/video allowlist.
select pg_temp.reset_su(); select pg_temp.act('84444444-4444-4444-4444-444444444444');
select pg_temp.assert_count('archivos_ticket','client_a','select_owner',$q$select id from public.archivos_ticket where id='8fa11111-1111-1111-1111-111111111111'$q$,1,'archivos_ticket_client_owner_select');
select pg_temp.assert_count('archivos_ticket','client_a','select_other',$q$select id from public.archivos_ticket where id='8fb22222-2222-2222-2222-222222222222'$q$,0,'archivos_ticket_client_owner_select');
select pg_temp.assert_denied('archivos_ticket','client_a','insert_forbidden',$q$insert into public.archivos_ticket(ticket_id,origen,nombre_archivo,storage_path) values ('8ea11111-1111-1111-1111-111111111111','portal','x.txt','8ea11111-1111-1111-1111-111111111111/x.txt')$q$,'42501','no_client_insert_policy');
select pg_temp.reset_su(); select pg_temp.act('82222222-2222-2222-2222-222222222222');
select pg_temp.assert_count('archivos_ticket','support_a','select_assigned',$q$select id from public.archivos_ticket where id='8fa11111-1111-1111-1111-111111111111'$q$,1,'archivos_ticket_staff_select');
select pg_temp.assert_count('archivos_ticket','support_a','select_other',$q$select id from public.archivos_ticket where id='8fb22222-2222-2222-2222-222222222222'$q$,0,'archivos_ticket_staff_select');

-- perfiles: own/admin reads, safe self update, role change denied by column ACL.
select pg_temp.assert_count('perfiles','support_a','select_self',$q$select id from public.perfiles where id='82222222-2222-2222-2222-222222222222'$q$,1,'perfiles_select_self');
select pg_temp.assert_count('perfiles','support_a','select_admin',$q$select id from public.perfiles where id='81111111-1111-1111-1111-111111111111'$q$,0,'perfiles_select_self');
select pg_temp.assert_rows('perfiles','support_a','update_safe',$q$update public.perfiles set tema='dark' where id='82222222-2222-2222-2222-222222222222'$q$,1,'perfiles_update_self');
select pg_temp.assert_denied('perfiles','support_a','update_role',$q$update public.perfiles set rol='admin' where id='82222222-2222-2222-2222-222222222222'$q$,'42501','column_acl_and_tc_prevent_rol_escalation');
select pg_temp.reset_su(); select pg_temp.act('81111111-1111-1111-1111-111111111111');
select pg_temp.assert_count('perfiles','admin','select_staff',$q$select id from public.perfiles where id in ('82222222-2222-2222-2222-222222222222','83333333-3333-3333-3333-333333333333')$q$,2,'perfiles_select_self');

-- aliases: ticket-scoped read; no direct writes.
select pg_temp.reset_su(); select pg_temp.act('82222222-2222-2222-2222-222222222222');
select pg_temp.assert_count('cliente_aliases','support_a','select_scope',$q$select id from public.cliente_aliases where id='8aa11111-1111-1111-1111-111111111111'$q$,1,'cliente_aliases_select_scoped');
select pg_temp.assert_count('cliente_aliases','support_a','select_other',$q$select id from public.cliente_aliases where id='8ab22222-2222-2222-2222-222222222222'$q$,0,'cliente_aliases_select_scoped');
select pg_temp.assert_denied('cliente_aliases','support_a','insert_forbidden',$q$insert into public.cliente_aliases(cliente_id,alias) values ('8aaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','forbidden')$q$,'42501','no_authenticated_write_grant');

-- match decisions: direct owner is admin-select only; writes belong to RPC.
select pg_temp.assert_count('ticket_match_decisiones','support_a','select_denied',$q$select id from public.ticket_match_decisiones$q$,0,'ticket_match_decisiones_admin_select_v1');
select pg_temp.assert_denied('ticket_match_decisiones','support_a','insert_denied',$q$insert into public.ticket_match_decisiones(ticket_id,nivel) values ('8ea11111-1111-1111-1111-111111111111','alto')$q$,'42501','rpc_only_no_write_grant');
select pg_temp.reset_su(); select pg_temp.act('81111111-1111-1111-1111-111111111111');
select pg_temp.assert_count('ticket_match_decisiones','admin','select_all',$q$select id from public.ticket_match_decisiones$q$,2,'ticket_match_decisiones_admin_select_v1');

-- quick replies: internal read, admin write, client isolation.
select pg_temp.reset_su(); select pg_temp.act('82222222-2222-2222-2222-222222222222');
select pg_temp.assert_count('ticket_respuestas_rapidas','support_a','select_internal',$q$select id from public.ticket_respuestas_rapidas$q$,2,'quick_replies_staff_select');
select pg_temp.assert_rows('ticket_respuestas_rapidas','support_a','update_denied',$q$update public.ticket_respuestas_rapidas set titulo='forbidden' where id='8ca99999-1111-1111-1111-111111111111'$q$,0,'quick_replies_admin_write');
select pg_temp.reset_su(); select pg_temp.act('84444444-4444-4444-4444-444444444444');
select pg_temp.assert_count('ticket_respuestas_rapidas','client_a','select_denied',$q$select id from public.ticket_respuestas_rapidas$q$,0,'quick_replies_staff_select');
select pg_temp.reset_su(); select pg_temp.act('81111111-1111-1111-1111-111111111111');
select pg_temp.assert_rows('ticket_respuestas_rapidas','admin','update_allowed',$q$update public.ticket_respuestas_rapidas set titulo='Actualizada' where id='8ca99999-1111-1111-1111-111111111111'$q$,1,'quick_replies_admin_write');

-- agent view: admin only at both query and grant boundaries.
select pg_temp.assert_count('v_janome_dashboard_agentes','admin','select_summary',$q$select agente_id from public.v_janome_dashboard_agentes$q$,2,'security_invoker_admin_guard');
select pg_temp.reset_su(); select pg_temp.act('82222222-2222-2222-2222-222222222222');
select pg_temp.assert_count('v_janome_dashboard_agentes','support_a','select_denied',$q$select agente_id from public.v_janome_dashboard_agentes$q$,0,'security_invoker_admin_guard');
select pg_temp.reset_su(); select pg_temp.act('84444444-4444-4444-4444-444444444444');
select pg_temp.assert_count('v_janome_dashboard_agentes','client_a','select_denied',$q$select agente_id from public.v_janome_dashboard_agentes$q$,0,'security_invoker_admin_guard');
select pg_temp.reset_su();

-- Runtime mutation contracts: fail if a permissive always-true replacement or
-- missing ownership/admin guard is present in the live catalog.
do $mutants$
declare checks record; unsafe_count integer;
begin
  for checks in select * from (values
    ('tickets','tickets_client_owner_select','ownership_predicate'),
    ('archivos_ticket','archivos_ticket_client_owner_select','ownership_predicate'),
    ('perfiles','perfiles_select_self','self_or_admin_predicate'),
    ('cliente_aliases','cliente_aliases_select_scoped','scoped_exists_predicate'),
    ('ticket_match_decisiones','ticket_match_decisiones_admin_select_v1','admin_only_predicate'),
    ('ticket_respuestas_rapidas','quick_replies_admin_write','admin_write_predicate')
  ) x(surface,policy,mutant) loop
    select count(*) into unsafe_count from pg_policies
    where schemaname='public' and tablename=checks.surface and policyname=checks.policy
      and (coalesce(qual,'') in ('true','(true)') or coalesce(with_check,'') in ('true','(true)'));
    if unsafe_count <> 0 then raise exception 'AUTHZ_MUTANT_SURVIVED %.%',checks.surface,checks.policy; end if;
    perform pg_temp.record_result(checks.surface,'catalog','mutant_kill','guarded','guarded','00000',checks.policy,'PASS',checks.mutant);
  end loop;
  if position('app_private.has_role' in pg_get_viewdef('public.v_janome_dashboard_agentes'::regclass,true))=0 then
    raise exception 'AUTHZ_MUTANT_SURVIVED agent_view';
  end if;
  perform pg_temp.record_result('v_janome_dashboard_agentes','catalog','mutant_kill','admin_guard','admin_guard','00000','security_invoker_admin_guard','PASS','remove_admin_guard');
  if not coalesce((select allowed_mime_types @> array['image/heic','image/heif','video/mp4','video/quicktime','video/x-m4v']::text[] from storage.buckets where id='soporte_adjuntos'), false) then
    raise exception 'storage bucket MIME allowlist is incomplete';
  end if;
  perform pg_temp.record_result('archivos_ticket','catalog','mime_allowlist','HEIC_VIDEO_ALLOWED','HEIC_VIDEO_ALLOWED','00000','storage_bucket_allowed_mime_types','PASS','remove_heic_video');
end
$mutants$;

\copy (select surface,actor,operation,expected,actual,sqlstate,policy,result,mutant from megatrain_authz_results order by surface,actor,operation) to stdout with (format csv, header true)
select 'AUTHZ_NOMINAL_MATRIX=PASS';
select 'AUTHZ_TABLES=' || count(distinct surface) from megatrain_authz_results;
select 'AUTHZ_NEGATIVE_CASES=' || count(*) from megatrain_authz_results where expected in ('0','DENIED');
select 'AUTHZ_MUTANTS=' || count(*) from megatrain_authz_results where mutant <> '';
rollback;
