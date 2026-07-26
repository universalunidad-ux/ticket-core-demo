-- TC-RECOVERY-P5-P9-CLOSE-05
-- fk-integrity.sql — Validación POSITIVA de integridad tras el restore (P7.9).
--
-- Motivo: `pg_restore` terminando con código 0 NO demuestra integridad. Con
-- triggers de usuario deshabilitados y constraints recreadas, hay que probar
-- explícitamente que (a) ninguna FK quedó sin validar, (b) no hay filas
-- huérfanas, (c) ningún trigger quedó deshabilitado, (d) cada perfil tiene su
-- auth.users, y (e) no se filtró ningún correo real al seed sintético.
--
-- REPORT_ONLY: sólo SELECT/\echo/\gexec sobre SELECT generados. Nunca DDL/DML.
-- NO imprime datos: sólo nombres de objeto y conteos.
--
-- Uso: psql ... -X -q --no-psqlrc -v ON_ERROR_STOP=1 -f fk-integrity.sql

\pset format unaligned
\pset tuples_only on
\pset footer off

\echo SECTION=FK_INTEGRITY

-- (a) FKs declaradas pero NO validadas (p. ej. recreadas con NOT VALID).
select 'FK_NOT_VALIDATED|' || coalesce(string_agg(c.conname, ',' order by c.conname), '')
from pg_constraint c
join pg_class r on r.oid = c.conrelid
join pg_namespace n on n.oid = r.relnamespace
where c.contype = 'f' and n.nspname in ('public','app_private') and not c.convalidated;

-- (b) FKs presentes, por si una recreación se perdió por el camino.
select 'FK_TOTAL|' || count(*)::text
from pg_constraint c
join pg_class r on r.oid = c.conrelid
join pg_namespace n on n.oid = r.relnamespace
where c.contype = 'f' and n.nspname in ('public','app_private');

-- (c) FK circular tickets <-> solicitudes_soporte: deben existir las DOS.
select 'CIRCULAR_FK_PRESENT|' || count(*)::text
from pg_constraint c
join pg_class r on r.oid = c.conrelid
join pg_class fr on fr.oid = c.confrelid
join pg_namespace n on n.oid = r.relnamespace
where c.contype = 'f' and n.nspname = 'public'
  and ((r.relname = 'tickets' and fr.relname = 'solicitudes_soporte')
    or (r.relname = 'solicitudes_soporte' and fr.relname = 'tickets'));

-- (d) Triggers que quedaron deshabilitados tras el restore (debe ser vacío).
select 'TRIGGER_DISABLED|' || coalesce(string_agg(n.nspname || '.' || r.relname || '.' || t.tgname, ',' order by t.tgname), '')
from pg_trigger t
join pg_class r on r.oid = t.tgrelid
join pg_namespace n on n.oid = r.relnamespace
where n.nspname in ('public','app_private') and not t.tgisinternal and t.tgenabled = 'D';

-- (e) Ownership: ninguna tabla de la allowlist puede pertenecer a otro rol.
select 'TABLE_OWNER_MISMATCH|' || coalesce(string_agg(schemaname || '.' || tablename, ',' order by tablename), '')
from pg_tables
where schemaname in ('public','app_private') and tableowner <> current_user;

-- (f) Relación auth.users <-> public.perfiles (paso 5 del ticket).
select 'PERFILES_WITHOUT_AUTH_USER|' || count(*)::text
from public.perfiles p
where not exists (select 1 from auth.users u where u.id = p.id);

-- (g) El seed de auth.users es SINTÉTICO: ningún correo fuera del dominio
--     reservado. Se cuenta, jamás se imprime el correo.
select 'AUTH_USERS_NON_SYNTHETIC|' || count(*)::text
from auth.users
where email is null or email not like '%@example.invalid';

-- (h) FKs multi-columna: no se comprueban huérfanas por generación; se declara
--     la limitación en vez de fingir cobertura.
select 'FK_MULTICOL_UNCHECKED|' || count(*)::text
from pg_constraint c
join pg_class r on r.oid = c.conrelid
join pg_namespace n on n.oid = r.relnamespace
where c.contype = 'f' and n.nspname in ('public','app_private')
  and coalesce(array_length(c.conkey, 1), 0) > 1;

-- (i) Huérfanas por FK de una sola columna: se GENERAN los SELECT de conteo y
--     se ejecutan con \gexec. Cada uno emite FK_ORPHANS|<constraint>|<n>.
select format(
  'select ''FK_ORPHANS|%s|'' || count(*)::text from %I.%I t where t.%I is not null and not exists (select 1 from %I.%I r where r.%I = t.%I)',
  c.conname, n.nspname, r.relname, a.attname, fn.nspname, fr.relname, fa.attname, a.attname)
from pg_constraint c
join pg_class r on r.oid = c.conrelid
join pg_namespace n on n.oid = r.relnamespace
join pg_class fr on fr.oid = c.confrelid
join pg_namespace fn on fn.oid = fr.relnamespace
join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
join pg_attribute fa on fa.attrelid = c.confrelid and fa.attnum = c.confkey[1]
where c.contype = 'f' and n.nspname in ('public','app_private')
  and coalesce(array_length(c.conkey, 1), 0) = 1
order by c.conname
\gexec

\echo FK_INTEGRITY_COMPLETE=YES
