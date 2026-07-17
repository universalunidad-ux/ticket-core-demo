-- AUTHZ U4 · Pruebas negativas/positivas de autorización (ejecutar en STAGING).
-- Requiere un esquema con datos sintéticos. Simula sesiones con jwt.claims.sub.
-- Ejecutar con: psql "$STAGING_URL" -v ON_ERROR_STOP=1 -f supabase/tests/authz_negative.sql
-- Estado local: BLOCKED_REMOTE (no hay Postgres/sesión en el worktree).

begin;

-- Helper para simular una sesión Supabase (auth.uid() = sub).
create or replace function pg_temp.act_as(uid uuid, rol text default 'authenticated')
returns void language plpgsql as $$
begin
  perform set_config('role', rol, true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid::text, 'role', rol)::text, true);
end $$;

-- Suponiendo fixtures: admin A, soporte S1 (asignado a T1), soporte S2 (sin T1),
-- cliente C1 (ligado a T1). Sustituir UUIDs por los de staging.
\set ADMIN  '00000000-0000-0000-0000-0000000000a1'
\set S1     '00000000-0000-0000-0000-0000000000s1'
\set S2     '00000000-0000-0000-0000-0000000000s2'

-- 1) ROLE_ESCALATION: S1 no puede cambiar su propio rol a admin.
select pg_temp.act_as(:'S1'::uuid, 'authenticated');
do $$
begin
  begin
    update public.perfiles set rol='admin' where id = :'S1'::uuid;
    raise exception 'FAIL: S1 pudo escalar su rol';
  exception when sqlstate '42501' then
    raise notice 'PASS: escalada de rol bloqueada';
  end;
end $$;
reset role;

-- 2) TICKETS scope: S2 no ve tickets asignados a S1.
select pg_temp.act_as(:'S2'::uuid, 'authenticated');
do $$
declare n int;
begin
  select count(*) into n from public.tickets t where t.asignado_a = :'S1'::uuid;
  if n > 0 then raise exception 'FAIL: S2 ve % tickets de S1', n;
  else raise notice 'PASS: S2 no ve tickets de S1'; end if;
end $$;
reset role;

-- 3) CLIENTES scope: S2 no ve clientes de tickets no asignados.
select pg_temp.act_as(:'S2'::uuid, 'authenticated');
do $$
declare n int;
begin
  select count(*) into n from public.clientes;
  raise notice 'INFO: S2 ve % clientes (esperado: solo los de sus asignaciones)', n;
end $$;
reset role;

-- 4) BITACORA: soporte no lee bitácora (solo admin).
select pg_temp.act_as(:'S1'::uuid, 'authenticated');
do $$
declare n int;
begin
  select count(*) into n from public.bitacora;
  if n > 0 then raise exception 'FAIL: soporte leyó % filas de bitacora', n;
  else raise notice 'PASS: bitacora oculta a soporte'; end if;
end $$;
reset role;

-- 5) ANON: rol anon no lee tablas internas.
select set_config('role','anon',true);
do $$
declare n int;
begin
  begin
    select count(*) into n from public.tickets;
    if n > 0 then raise exception 'FAIL: anon leyó % tickets', n;
    else raise notice 'PASS: anon sin tickets'; end if;
  exception when insufficient_privilege then
    raise notice 'PASS: anon sin privilegio sobre tickets';
  end;
end $$;
reset role;

rollback; -- las pruebas no persisten cambios
