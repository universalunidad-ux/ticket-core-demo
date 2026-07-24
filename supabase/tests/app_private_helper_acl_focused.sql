-- ============================================================================
-- TC-APP-PRIVATE-ACL-RECONCILIATION-01 · Prueba SQL FOCALIZADA
--
-- Valida la migración 20260724090000_tc_grant_authenticated_check_helpers.sql.
-- Ejecutar SOLO en el PostgreSQL local efímero, DESPUÉS de aplicar migraciones:
--   psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/app_private_helper_acl_focused.sql
--
-- Crea fixtures sintéticos dentro de una transacción y hace ROLLBACK al final
-- (no persiste). Simula sesiones Supabase vía request.jwt.claims.sub.
--
-- Escenarios (todos deben imprimir PASS; cualquier FAIL aborta con ON_ERROR_STOP):
--   1. soporte inserta ticket_eventos con meta permitido  -> PASA.
--   2. soporte inserta meta con clave prohibida           -> falla por CONSTRAINT
--                                                            (23514), NO por ACL (42501).
--   3. anon no puede ejecutar los helpers                 -> 42501.
--   4. authenticated NO obtiene acceso adicional a tablas -> privilegios sin cambio.
--   5. service_role conserva la ejecución de los helpers.
--   6. authenticated ejecuta el helper directamente sin 42501 (prueba directa de ACL).
-- ============================================================================
\set ON_ERROR_STOP on
\pset pager off
begin;

-- ---- Conmutadores de sesión (idénticos a supabase/tests/authz_negative.sql) --
create or replace function pg_temp.act(uid uuid)
returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid::text, 'role', 'authenticated')::text, true);
end $$;

create or replace function pg_temp.act_anon()
returns void language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
end $$;

create or replace function pg_temp.act_service()
returns void language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
end $$;

create or replace function pg_temp.reset_su()
returns void language plpgsql as $$
begin perform set_config('role', 'postgres', true); end $$;

-- ---- Fixtures mínimos (como superusuario) -----------------------------------
insert into auth.users (id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('33333333-3333-3333-3333-333333333333','authenticated','authenticated',
   'tc-acl-support-a@example.invalid', now(),
   '{"provider":"email","providers":["email"],"fixture":"tc-acl"}'::jsonb,
   '{"fixture":"tc-acl","persona":"support-a"}'::jsonb, now(), now())
on conflict (id) do nothing;

insert into public.perfiles (id, rol, nombre, tema) values
  ('33333333-3333-3333-3333-333333333333','soporte','Soporte ACL','light')
on conflict (id) do nothing;

insert into public.clientes (id, nombre, origen_registro) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Cliente ACL','ticket_core')
on conflict (id) do nothing;

insert into public.tickets (id, cliente_id, asignado_a, titulo, estado, prioridad, folio) values
  ('ce111111-1111-1111-1111-111111111111','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '33333333-3333-3333-3333-333333333333','Ticket ACL','abierto','media','EX-ACL1')
on conflict (id) do nothing;

-- ---- 1) soporte inserta ticket_eventos con meta permitido: DEBE PASAR --------
select pg_temp.act('33333333-3333-3333-3333-333333333333');
do $t1$
begin
  insert into public.ticket_eventos (ticket_id, autor_tipo, kind, texto, meta)
  values ('ce111111-1111-1111-1111-111111111111','soporte','mensaje','hola',
          '{"canal":"web","folio":"EX-ACL1"}'::jsonb);
  raise notice 'PASS 1: soporte insertó ticket_eventos con meta permitido';
exception
  when sqlstate '42501' then
    raise exception 'FAIL 1: ACL denegó el helper en INSERT permitido (42501: %)', sqlerrm;
  when others then
    raise exception 'FAIL 1: INSERT permitido falló inesperadamente (% : %)', sqlstate, sqlerrm;
end $t1$;
select pg_temp.reset_su();

-- ---- 2) soporte inserta meta con clave prohibida: DEBE FALLAR POR CONSTRAINT -
select pg_temp.act('33333333-3333-3333-3333-333333333333');
do $t2$
begin
  begin
    insert into public.ticket_eventos (ticket_id, autor_tipo, kind, texto, meta)
    values ('ce111111-1111-1111-1111-111111111111','soporte','mensaje','hola',
            '{"clave_prohibida":"x"}'::jsonb);
    raise exception 'FAIL 2: meta prohibido fue aceptado (sin rechazo)';
  exception
    when sqlstate '23514' then
      raise notice 'PASS 2: meta prohibido rechazado por CONSTRAINT (23514), no por ACL';
    when sqlstate '42501' then
      raise exception 'FAIL 2: rechazo por ACL (42501) en vez de CONSTRAINT — ACL insuficiente';
  end;
end $t2$;
select pg_temp.reset_su();

-- ---- 3) anon NO puede ejecutar los helpers: DEBE FALLAR 42501 ----------------
select pg_temp.act_anon();
do $t3$
declare
  v_sig text;
  v_ok  boolean;
begin
  foreach v_sig in array array[
    'ticket_event_meta_is_safe','audit_detail_is_safe','plain_text_is_safe'
  ]
  loop
    begin
      if v_sig = 'plain_text_is_safe' then
        perform app_private.plain_text_is_safe('texto', 400);
      elsif v_sig = 'audit_detail_is_safe' then
        perform app_private.audit_detail_is_safe('{}'::jsonb);
      else
        perform app_private.ticket_event_meta_is_safe('{}'::jsonb);
      end if;
      raise exception 'FAIL 3: anon ejecutó app_private.% sin denegación', v_sig;
    exception
      when sqlstate '42501' then
        null; -- esperado
    end;
  end loop;
  raise notice 'PASS 3: anon no puede ejecutar ninguno de los 3 helpers (42501)';
end $t3$;
select pg_temp.reset_su();

-- ---- 4) authenticated NO obtiene acceso adicional a TABLAS -------------------
do $t4$
begin
  if has_table_privilege('authenticated','public.clientes','INSERT') then
    raise exception 'FAIL 4: authenticated ganó INSERT en public.clientes';
  end if;
  if has_table_privilege('authenticated','public.edge_idempotency','SELECT') then
    raise exception 'FAIL 4: authenticated ganó SELECT en public.edge_idempotency';
  end if;
  if has_table_privilege('authenticated','public.site_config','INSERT') then
    raise exception 'FAIL 4: authenticated ganó INSERT en public.site_config';
  end if;
  raise notice 'PASS 4: authenticated sin acceso adicional a tablas';
end $t4$;

-- ---- 5) service_role conserva la ejecución de los helpers --------------------
select pg_temp.act_service();
do $t5$
begin
  perform app_private.ticket_event_meta_is_safe('{"canal":"web"}'::jsonb);
  perform app_private.audit_detail_is_safe('{}'::jsonb);
  perform app_private.plain_text_is_safe('ok', 400);
  raise notice 'PASS 5: service_role conserva EXECUTE sobre los 3 helpers';
exception
  when sqlstate '42501' then
    raise exception 'FAIL 5: service_role perdió EXECUTE sobre un helper (42501)';
end $t5$;
select pg_temp.reset_su();

-- ---- 6) authenticated ejecuta el helper directamente sin 42501 (ACL directa) -
select pg_temp.act('33333333-3333-3333-3333-333333333333');
do $t6$
declare
  v_res boolean;
begin
  select app_private.ticket_event_meta_is_safe('{"canal":"web"}'::jsonb) into v_res;
  if v_res is distinct from true then
    raise exception 'FAIL 6: helper ejecutó pero devolvió resultado inesperado (%)', v_res;
  end if;
  raise notice 'PASS 6: authenticated ejecuta el helper directamente (ACL concedida)';
exception
  when sqlstate '42501' then
    raise exception 'FAIL 6: authenticated aún sin EXECUTE sobre el helper (42501)';
end $t6$;
select pg_temp.reset_su();

rollback;
-- FOCUSED_ACL_TEST_END (transacción revertida; sin persistencia)
