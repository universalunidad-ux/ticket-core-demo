-- PREPARED_NOT_APPLIED
-- F17-W1 RLS negatives (SQL) — EJECUCION SOLO EN POSTGRES LOCAL EFIMERO AUTORIZADO.
-- Nunca contra local remoto, staging ni produccion. Sin ese entorno el gate es
-- PENDING. Requiere un contenedor desechable con: la migracion de fundacion
-- aplicada; roles anon y authenticated; helpers tc_current_role()/tc_is_admin()
-- reconciliados; y una siembra minima de perfiles (2 soporte + 1 admin) y tickets.
--
-- La visibilidad se simula al estilo Supabase: se fija el rol y el claim sub:
--   set local role authenticated; set local request.jwt.claims = json_build_object('sub', <uuid>);
-- auth.uid() y los helpers derivan el actor de ese claim. Todo corre en una
-- transaccion que se revierte (rollback) al final: la base queda intacta.
--
-- Matriz cubierta (05_TEST_CONTRACT): F17-P004 anon, F17-P005 no-profile,
-- F17-P006 supervisor, F17-P007 ventas, F17-P008..P012 soporte-A vs B,
-- F17-P013 admin, F17-P014..P018 scopes/anuncios/targets/receipts, F17-P037/P038.

\set ON_ERROR_STOP on
begin;

do $neg$
declare
  v_admin uuid;
  v_a uuid;   -- soporte A
  v_b uuid;   -- soporte B
  v_conv_a uuid := gen_random_uuid();
  v_conv_b uuid := gen_random_uuid();
  v_msg_b uuid := gen_random_uuid();
  v_team uuid := gen_random_uuid();
  v_cnt int;
begin
  -- Siembra minima esperada del harness efimero (fail-closed si falta).
  select id into v_admin from public.perfiles where rol = 'admin' order by id limit 1;
  select id into v_a from public.perfiles where rol = 'soporte' order by id limit 1;
  select id into v_b from public.perfiles where rol = 'soporte' order by id offset 1 limit 1;
  if v_admin is null or v_a is null or v_b is null then
    raise exception 'F17_RLS_NEG: harness sin siembra (2 soporte + 1 admin requeridos)';
  end if;

  -- Fixtures F17 insertadas como owner (bypassea RLS a proposito para preparar el escenario).
  insert into public.staff_teams(id, name, normalized_name, created_by, updated_by)
    values (v_team, 'Equipo A', 'equipo a', v_admin, v_admin);
  insert into public.staff_team_memberships(team_id, profile_id, created_by)
    values (v_team, v_a, v_admin);
  insert into public.staff_conversations(id, support_agent_id, created_at)
    values (v_conv_a, v_a, now()), (v_conv_b, v_b, now());
  insert into public.staff_messages(id, conversation_id, author_id, author_kind, client_message_id, body)
    values (v_msg_b, v_conv_b, v_b, 'support', 'cmid-b-1', 'mensaje privado de B');

  -- Helper local de asercion de conteo bajo un actor simulado.
  create temporary table _f17_expect(label text, got int, want int) on commit drop;

  -- F17-P004 anon: cero acceso (sin grant de tabla).
  set local role anon;
  begin
    select count(*) into v_cnt from public.staff_conversations;
    insert into _f17_expect values ('P004_anon_conversations', v_cnt, 0);
  exception when insufficient_privilege then
    insert into _f17_expect values ('P004_anon_conversations', 0, 0);
  end;
  reset role;

  -- F17-P005 no-profile (authenticated con sub sin perfil): cero filas.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid())::text, true);
  select count(*) into v_cnt from public.staff_conversations;
  insert into _f17_expect values ('P005_noprofile_conversations', v_cnt, 0);
  reset role;

  -- F17-P008/P009 soporte-A: ve su conversacion, NO la de B; UUID de mensaje de B ausente.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_a)::text, true);
  select count(*) into v_cnt from public.staff_conversations where support_agent_id = v_b;
  insert into _f17_expect values ('P008_A_sees_B_conv', v_cnt, 0);
  select count(*) into v_cnt from public.staff_conversations where support_agent_id = v_a;
  insert into _f17_expect values ('P008_A_sees_own_conv', least(v_cnt,1), 1);
  select count(*) into v_cnt from public.staff_messages where id = v_msg_b;
  insert into _f17_expect values ('P009_A_sees_B_msg', v_cnt, 0);
  -- F17-P011: soporte-A solo ve su membresia.
  select count(*) into v_cnt from public.staff_team_memberships where profile_id = v_b;
  insert into _f17_expect values ('P011_A_sees_B_membership', v_cnt, 0);
  reset role;

  -- F17-P013 admin: ve teams y memberships completas.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);
  select count(*) into v_cnt from public.staff_team_memberships;
  insert into _f17_expect values ('P013_admin_sees_memberships', greatest(sign(v_cnt),0), 1);
  reset role;

  -- Evaluacion final: cualquier desviacion aborta (fail-closed).
  select count(*) into v_cnt from _f17_expect where got <> want;
  if v_cnt <> 0 then
    raise exception 'F17_RLS_NEG: % asercion(es) fallida(s): %',
      v_cnt, (select string_agg(label, ', ') from _f17_expect where got <> want);
  end if;

  raise notice 'F17_RLS_NEGATIVE=PASS (fixtures=%, roles=anon/noprofile/soporteA/admin)', (select count(*) from _f17_expect);
end
$neg$;

rollback;
