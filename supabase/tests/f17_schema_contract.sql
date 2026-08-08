-- PREPARED_NOT_APPLIED
-- F17-W1 schema contract (SQL) — EJECUCION SOLO EN POSTGRES LOCAL EFIMERO AUTORIZADO.
-- Nunca contra local remoto, staging ni produccion. Sin ese entorno el gate es
-- PENDING y no se declara cobertura viva. Verifica, sobre una base donde la
-- migracion de fundacion ya fue aplicada en un contenedor desechable:
--   * existen las 9 tablas F17;
--   * RLS habilitado en las 9;
--   * authenticated tiene SELECT y cero DML core;
--   * anon/PUBLIC tienen cero privilegios de tabla.
-- Cubre F17-P001..P003 (inventario base) y el gate de grants de 05_TEST_CONTRACT.

\set ON_ERROR_STOP on
begin;

do $contract$
declare
  v_expected text[] := array[
    'staff_teams','staff_team_memberships','staff_conversations','staff_messages',
    'staff_message_revisions','staff_announcements','staff_announcement_targets',
    'staff_message_receipts','support_agent_scopes'];
  v_t text;
  v_missing int;
  v_rls int;
  v_dml int;
  v_anon int;
begin
  -- F17-P001: dependencias base compatibles o fail-closed.
  if to_regclass('public.perfiles') is null
     or to_regclass('public.tickets') is null
     or to_regclass('public.bitacora') is null then
    raise exception 'F17_SQL_CONTRACT: dependencias base ausentes';
  end if;

  foreach v_t in array v_expected loop
    -- Presencia de las 9 tablas.
    if to_regclass('public.' || v_t) is null then
      raise exception 'F17_SQL_CONTRACT: falta tabla %', v_t;
    end if;

    -- RLS habilitado.
    select count(*) into v_rls
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = v_t and c.relrowsecurity;
    if v_rls <> 1 then
      raise exception 'F17_SQL_CONTRACT: RLS deshabilitado en %', v_t;
    end if;

    -- authenticated debe tener SELECT.
    if not has_table_privilege('authenticated', 'public.' || v_t, 'SELECT') then
      raise exception 'F17_SQL_CONTRACT: authenticated sin SELECT en %', v_t;
    end if;

    -- authenticated NO debe tener DML core.
    select count(*) into v_dml
    from (values ('INSERT'),('UPDATE'),('DELETE')) as p(priv)
    where has_table_privilege('authenticated', 'public.' || v_t, p.priv);
    if v_dml <> 0 then
      raise exception 'F17_SQL_CONTRACT: authenticated con DML en % (count=%)', v_t, v_dml;
    end if;

    -- anon y PUBLIC deben tener cero privilegios.
    select count(*) into v_anon
    from (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) as p(priv)
    where has_table_privilege('anon', 'public.' || v_t, p.priv)
       or has_table_privilege('public', 'public.' || v_t, p.priv);
    if v_anon <> 0 then
      raise exception 'F17_SQL_CONTRACT: anon/PUBLIC con privilegio en % (count=%)', v_t, v_anon;
    end if;
  end loop;

  -- No debe existir una decima tabla staff_/support_agent_ fuera del set esperado.
  select count(*) into v_missing
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and (c.relname like 'staff\_%' or c.relname = 'support_agent_scopes')
    and not (c.relname = any(v_expected));
  if v_missing <> 0 then
    raise exception 'F17_SQL_CONTRACT: tabla(s) F17 inesperada(s) (count=%)', v_missing;
  end if;

  raise notice 'F17_SQL_SCHEMA_CONTRACT=PASS';
end
$contract$;

rollback;
