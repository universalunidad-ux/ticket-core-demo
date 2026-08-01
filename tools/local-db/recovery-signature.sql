-- TC-RECOVERY-V2-IMPLEMENT-RUNTIME-01
-- recovery-signature.sql · REPORT_ONLY · SIN superuser · SIN escrituras
--
-- Estado: IMPLEMENTADO LOCAL (script estatico) · NO VALIDADO EN VIVO.
-- No crea, altera, otorga ni modifica NADA. Solo SELECT. Seguro de correr
-- contra la fuente (pre-incidente) o contra el destino restaurado: produce
-- una "firma" comparable de estructura, funciones, RLS/policies, ACL y datos
-- para el paso 8 de la arquitectura obligatoria ("Comparar datos, RLS, ACL,
-- funciones y search_path").
--
-- USO (correr DOS veces: una vez contra la fuente, otra contra el destino
-- restaurado, y diff de los CSV resultantes fuera de este script):
--   psql "$SRC_DB_URL"  -v ON_ERROR_STOP=1 -f recovery-signature.sql > src.sig
--   psql "$DEST_DB_URL" -v ON_ERROR_STOP=1 -f recovery-signature.sql > dest.sig
--   diff src.sig dest.sig   # STRUCTURE_PARITY / DATA_PARITY / RLS.. / ACL..
--
-- GUARDA DE PRIVACIDAD (obligatoria por el ticket): este script NUNCA
-- selecciona en claro las columnas public.bitacora.detalle ni
-- public.edge_idempotency.response. Donde se requiere paridad de esas
-- filas se usa md5() sobre la fila con la columna sensible removida
-- (to_jsonb(t) - 'detalle'). edge_idempotency es tabla efimera excluida
-- del restore de datos (03_DUMP_FILTERS.txt) y NO se incluye en la
-- seccion DATA de este script.
--
-- ALLOWLIST: public, app_private (nunca auth/storage/realtime/extensions/
-- graphql/vault/pgsodium/supabase_functions/supabase_migrations — ver
-- _ANALYSIS_OUTPUTS/TC_SUPABASE_RECOVERY_BOUNDARY_OPUS_01/03_DUMP_FILTERS.txt).

\set ON_ERROR_STOP on
\pset pager off

-- ---------------------------------------------------------------------------
-- DETERMINISMO DE LA FIRMA (obligatorio para que el diff signifique algo).
--
-- La firma se compara entre dos psql distintos: el del contenedor del clon y el
-- del host (contra la fuente). Con el formato alineado por defecto el ancho de
-- las columnas depende de los DATOS, asi que dos bases equivalentes podian
-- producir un diff no vacio por puro formato. Estas pragmas fijan la
-- representacion en el propio script, de modo que no dependa de quien lo invoca
-- ni de un ~/.psqlrc del operador (el invocador ademas pasa -X --no-psqlrc).
--
-- Toda consulta de este archivo lleva ORDER BY TOTAL: el orden de filas no
-- puede depender del plan de ejecucion.
-- ---------------------------------------------------------------------------
\pset format unaligned
\pset tuples_only on
\pset fieldsep '|'
\pset footer off
\pset null '<NULL>'

\echo 'RECOVERY_SIGNATURE_MODE=REPORT_ONLY'
\echo 'RECOVERY_SIGNATURE_ALLOWLIST=public,app_private'

-- =============================================================================
-- SECCION STRUCTURE — tablas, columnas, constraints, indices (public+app_private)
-- =============================================================================
\echo 'SECTION=STRUCTURE'

select
  'SCHEMA_PRESENT' as check_id,
  n.nspname as schema_name,
  (n.nspname in ('public', 'app_private')) as is_application_owned
from pg_namespace n
where n.nspname in ('public', 'app_private')
order by n.nspname;

select
  'TABLE_COLUMNS' as check_id,
  c.table_schema,
  c.table_name,
  count(*) as column_count,
  md5(
    string_agg(
      c.column_name || ':' || c.data_type || ':' || c.is_nullable,
      ',' order by c.ordinal_position
    )
  ) as columns_hash
from information_schema.columns c
where c.table_schema in ('public', 'app_private')
group by c.table_schema, c.table_name
order by c.table_schema, c.table_name;

select
  'TABLE_COUNT_PUBLIC' as check_id,
  count(*) as table_count
from pg_tables
where schemaname = 'public';

select
  'TABLE_COUNT_APP_PRIVATE' as check_id,
  count(*) as table_count
from pg_tables
where schemaname = 'app_private';

select
  'VIEW_INVENTORY' as check_id,
  schemaname,
  viewname
from pg_views
where schemaname in ('public', 'app_private')
order by schemaname, viewname;

select
  'CONSTRAINT_INVENTORY' as check_id,
  nsp.nspname as schema_name,
  rel.relname as table_name,
  con.contype as constraint_type,
  count(*) as constraint_count,
  md5(
    string_agg(
      con.conname || ':' || con.contype::text || ':' || pg_get_constraintdef(con.oid),
      '|' order by con.conname
    )
  ) as constraints_hash
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace nsp on nsp.oid = rel.relnamespace
where nsp.nspname in ('public', 'app_private')
group by nsp.nspname, rel.relname, con.contype
order by nsp.nspname, rel.relname, con.contype;

select
  'INDEX_INVENTORY' as check_id,
  schemaname,
  tablename,
  count(*) as index_count,
  md5(string_agg(indexname || ':' || indexdef, '|' order by indexname)) as indexes_hash
from pg_indexes
where schemaname in ('public', 'app_private')
group by schemaname, tablename
order by schemaname, tablename;

select
  'EXTENSION_PGCRYPTO' as check_id,
  e.extname,
  n.nspname as extension_schema
from pg_extension e
join pg_namespace n on n.oid = e.extnamespace
where e.extname = 'pgcrypto'
order by e.extname;

select
  'RLS_ENABLED_FLAG' as check_id,
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public', 'app_private')
  and c.relkind = 'r'
order by n.nspname, c.relname;

-- =============================================================================
-- SECCION FUNCTIONS — funciones propias (public+app_private): identidad,
-- SECURITY DEFINER, search_path fijado (paridad SECURITY DEFINER/search_path).
-- =============================================================================
\echo 'SECTION=FUNCTIONS'

select
  'FUNCTION_INVENTORY' as check_id,
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  p.prosecdef as security_definer,
  coalesce((p.proconfig @> array['search_path=public']::text[] or p.proconfig @> array['search_path=pg_catalog, public']::text[]), false)
    or coalesce(p.proconfig @> array['search_path=public, pg_temp']::text[], false)
    or coalesce(p.proconfig @> array['search_path=app_private, public']::text[], false)
    or coalesce(p.proconfig @> array['search_path=public, app_private']::text[], false)
    as search_path_pinned_common_form,
  p.proconfig as raw_proconfig,
  md5(pg_get_functiondef(p.oid)) as function_body_hash
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'app_private')
order by n.nspname, p.proname, identity_arguments;

select
  'FUNCTION_COUNT_APP_PRIVATE' as check_id,
  count(*) as function_count
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'app_private';

select
  'SECURITY_DEFINER_UNSAFE' as check_id,
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_arguments
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'app_private')
  and p.prosecdef
  and not (
    coalesce((p.proconfig @> array['search_path=public']::text[] or p.proconfig @> array['search_path=pg_catalog, public']::text[]), false)
    or coalesce(p.proconfig @> array['search_path=public, pg_temp']::text[], false)
    or coalesce(p.proconfig @> array['search_path=app_private, public']::text[], false)
    or coalesce(p.proconfig @> array['search_path=public, app_private']::text[], false)
  )
order by n.nspname, p.proname, identity_arguments;

select
  'EXECUTE_GRANT_PUBLIC_OR_ANON' as check_id,
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  exists (
    select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
  ) as public_execute,
  exists (
    select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    join pg_roles r on r.oid = acl.grantee
    where r.rolname = 'anon' and acl.privilege_type = 'EXECUTE'
  ) as anon_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'app_private')
order by n.nspname, p.proname, identity_arguments;

-- =============================================================================
-- SECCION POLICIES — RLS de public/app_private + las 2 policies app sobre
-- storage.objects (soporte_adjuntos_staff_read, certificados_staff_read).
-- =============================================================================
\echo 'SECTION=POLICIES'

select
  'POLICY_INVENTORY' as check_id,
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  md5(coalesce(qual, '') || '|' || coalesce(with_check, '')) as predicate_hash
from pg_policies
where schemaname in ('public', 'app_private')
   or (schemaname = 'storage' and policyname in ('soporte_adjuntos_staff_read', 'certificados_staff_read'))
order by schemaname, tablename, policyname;

select
  'POLICY_COUNT_PUBLIC' as check_id,
  count(*) as policy_count
from pg_policies
where schemaname = 'public';

select
  'POLICY_COUNT_STORAGE_APP' as check_id,
  count(*) as policy_count
from pg_policies
where schemaname = 'storage'
  and policyname in ('soporte_adjuntos_staff_read', 'certificados_staff_read');

-- =============================================================================
-- SECCION ACL — grants efectivos sobre anon/authenticated/service_role.
-- BLOQUEANTE: una divergencia aqui significa que los privilegios no sobrevivieron
-- al restore. El ownership NO vive en esta seccion (ver SECCION OWNERSHIP): con
-- --no-owner el ownership del destino divergira siempre por diseño, y mezclarlo
-- aqui convertiria un check bloqueante en ruido garantizado.
-- =============================================================================
\echo 'SECTION=ACL'

select
  'TABLE_PRIVILEGE_MATRIX' as check_id,
  n.nspname as schema_name,
  c.relname as table_name,
  r.rolname as role_name,
  has_table_privilege(r.rolname, c.oid, 'SELECT') as can_select,
  has_table_privilege(r.rolname, c.oid, 'INSERT') as can_insert,
  has_table_privilege(r.rolname, c.oid, 'UPDATE') as can_update,
  has_table_privilege(r.rolname, c.oid, 'DELETE') as can_delete
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
cross join (values ('anon'), ('authenticated'), ('service_role')) as r(rolname)
where n.nspname in ('public', 'app_private')
  and c.relkind in ('r', 'v')
order by n.nspname, c.relname, r.rolname;

select
  'SCHEMA_USAGE_APP_PRIVATE' as check_id,
  r.rolname as role_name,
  has_schema_privilege(r.rolname, 'app_private', 'USAGE') as has_usage
from (values ('anon'), ('authenticated'), ('service_role'), ('public')) as r(rolname)
order by r.rolname;

-- =============================================================================
-- SECCION OWNERSHIP — INFORMATIVA, NO BLOQUEANTE.
--
-- Semantica explicita: el dump se toma con --no-owner y el restore corre como
-- `postgres`, asi que en el destino TODO objeto application queda propiedad de
-- `postgres` con independencia de quien lo poseia en la fuente. Una divergencia
-- fuente/destino aqui es el resultado ESPERADO del procedimiento, no un fallo.
-- Se reporta aparte para que el operador la lea, y NO participa del veredicto.
--
-- Lo que si es una invariante real (y se comprueba por VALOR, no por paridad):
-- storage.objects debe seguir perteneciendo a supabase_storage_admin, porque
-- nada de la frontera platform debe haber sido tocado.
-- =============================================================================
\echo 'SECTION=OWNERSHIP'

select
  'OWNERSHIP_APPLICATION_OBJECTS' as check_id,
  n.nspname as schema_name,
  c.relname as object_name,
  pg_get_userbyid(c.relowner) as owner
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public', 'app_private')
  and c.relkind in ('r', 'v')
order by n.nspname, c.relname;

select
  'OWNERSHIP_STORAGE_OBJECTS_INTACT' as check_id,
  pg_get_userbyid(c.relowner) as owner,
  (pg_get_userbyid(c.relowner) = 'supabase_storage_admin') as owner_untouched
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'storage'
  and c.relname = 'objects'
order by c.relname;

-- =============================================================================
-- SECCION DATA — conteos + hash por fila para las 22 tablas application-owned
-- con datos restaurables (allowlist menos las 4 tablas efimeras). Orden y
-- exclusiones documentadas en recovery-data-order.txt. bitacora.detalle se
-- excluye del hash (guarda de privacidad del ticket).
-- =============================================================================
\echo 'SECTION=DATA'

-- El UNION ALL no garantiza el orden de las ramas: se envuelve en un ORDER BY
-- explicito por table_name para que la firma sea estable entre corridas.
select s.check_id, s.table_name, s.row_count, s.data_hash from (
select 'DATA_ROW_SIGNATURE' as check_id, 'public.perfiles' as table_name,
  count(*) as row_count, md5(coalesce(string_agg(md5(t::text), '' order by md5(t::text)), '')) as data_hash
from public.perfiles t
union all
select 'DATA_ROW_SIGNATURE', 'public.ticket_folios',
  count(*), md5(coalesce(string_agg(md5(t::text), '' order by md5(t::text)), ''))
from public.ticket_folios t
union all
select 'DATA_ROW_SIGNATURE', 'public.clientes',
  count(*), md5(coalesce(string_agg(md5(t::text), '' order by md5(t::text)), ''))
from public.clientes t
union all
select 'DATA_ROW_SIGNATURE', 'public.clientes_contactos',
  count(*), md5(coalesce(string_agg(md5(t::text), '' order by md5(t::text)), ''))
from public.clientes_contactos t
union all
select 'DATA_ROW_SIGNATURE', 'public.clientes_contacto_historial',
  count(*), md5(coalesce(string_agg(md5(t::text), '' order by md5(t::text)), ''))
from public.clientes_contacto_historial t
union all
select 'DATA_ROW_SIGNATURE', 'public.cliente_sistemas',
  count(*), md5(coalesce(string_agg(md5(t::text), '' order by md5(t::text)), ''))
from public.cliente_sistemas t
union all
select 'DATA_ROW_SIGNATURE', 'public.cliente_aliases',
  count(*), md5(coalesce(string_agg(md5(t::text), '' order by md5(t::text)), ''))
from public.cliente_aliases t
union all
select 'DATA_ROW_SIGNATURE', 'public.cliente_accesos',
  count(*), md5(coalesce(string_agg(md5(t::text), '' order by md5(t::text)), ''))
from public.cliente_accesos t
union all
select 'DATA_ROW_SIGNATURE', 'public.solicitudes_alta',
  count(*), md5(coalesce(string_agg(md5(t::text), '' order by md5(t::text)), ''))
from public.solicitudes_alta t
union all
select 'DATA_ROW_SIGNATURE', 'public.solicitudes_registro',
  count(*), md5(coalesce(string_agg(md5(t::text), '' order by md5(t::text)), ''))
from public.solicitudes_registro t
union all
select 'DATA_ROW_SIGNATURE', 'public.solicitudes_soporte',
  count(*), md5(coalesce(string_agg(md5(t::text), '' order by md5(t::text)), ''))
from public.solicitudes_soporte t
union all
select 'DATA_ROW_SIGNATURE', 'public.tickets',
  count(*), md5(coalesce(string_agg(md5(t::text), '' order by md5(t::text)), ''))
from public.tickets t
union all
select 'DATA_ROW_SIGNATURE', 'public.solicitud_archivos',
  count(*), md5(coalesce(string_agg(md5(t::text), '' order by md5(t::text)), ''))
from public.solicitud_archivos t
union all
select 'DATA_ROW_SIGNATURE', 'public.ticket_eventos',
  count(*), md5(coalesce(string_agg(md5(t::text), '' order by md5(t::text)), ''))
from public.ticket_eventos t
union all
select 'DATA_ROW_SIGNATURE', 'public.archivos_ticket',
  count(*), md5(coalesce(string_agg(md5(t::text), '' order by md5(t::text)), ''))
from public.archivos_ticket t
union all
select 'DATA_ROW_SIGNATURE', 'public.ticket_archivos',
  count(*), md5(coalesce(string_agg(md5(t::text), '' order by md5(t::text)), ''))
from public.ticket_archivos t
union all
select 'DATA_ROW_SIGNATURE', 'public.ticket_match_decisiones',
  count(*), md5(coalesce(string_agg(md5(t::text), '' order by md5(t::text)), ''))
from public.ticket_match_decisiones t
union all
select 'DATA_ROW_SIGNATURE', 'public.reglas_asignacion',
  count(*), md5(coalesce(string_agg(md5(t::text), '' order by md5(t::text)), ''))
from public.reglas_asignacion t
union all
select 'DATA_ROW_SIGNATURE', 'public.ticket_respuestas_rapidas',
  count(*), md5(coalesce(string_agg(md5(t::text), '' order by md5(t::text)), ''))
from public.ticket_respuestas_rapidas t
union all
-- bitacora: hash de la fila SIN la columna sensible `detalle` (guarda de privacidad).
select 'DATA_ROW_SIGNATURE', 'public.bitacora',
  count(*),
  md5(coalesce(string_agg(md5((to_jsonb(t) - 'detalle')::text), '' order by md5((to_jsonb(t) - 'detalle')::text)), ''))
from public.bitacora t
union all
select 'DATA_ROW_SIGNATURE', 'public.avisos_globales',
  count(*), md5(coalesce(string_agg(md5(t::text), '' order by md5(t::text)), ''))
from public.avisos_globales t
union all
select 'DATA_ROW_SIGNATURE', 'public.site_config',
  count(*), md5(coalesce(string_agg(md5(t::text), '' order by md5(t::text)), ''))
from public.site_config t
) s
order by s.table_name;

select
  'DATA_TABLE_COUNT_EXPECTED' as check_id,
  22 as expected_data_bearing_tables,
  4 as expected_ephemeral_excluded,
  26 as expected_total_public_tables;

-- =============================================================================
-- SECCION LEDGER — INFORMATIVA, NO BLOQUEANTE.
--
-- Semantica explicita: supabase_migrations.schema_migrations se repuebla por
-- REAPLICACION de migraciones, nunca se restaura desde el dump
-- (05_STORAGE_RECOVERY.md §5). Por tanto el ledger del destino refleja la
-- baseline canonica (31) y el de la fuente refleja su propia historia: comparar
-- ambos por paridad produciria una divergencia esperada, no un fallo.
-- La invariante real del ledger del DESTINO se comprueba por VALOR y de forma
-- fail-closed en el PASO 2 de run-recovery-v2.sh, no aqui.
-- =============================================================================
\echo 'SECTION=LEDGER'

select
  'MIGRATIONS_LEDGER_COUNT' as check_id,
  count(*) as applied_migrations,
  31 as expected_migrations
from supabase_migrations.schema_migrations;

-- =============================================================================
-- SECCION STORAGE — INFORMATIVA, NO BLOQUEANTE.
--
-- Semantica explicita: los blobs de Storage viajan por un plano SEPARADO de
-- pg_dump (paso 7) y su sincronizacion es hoy una operacion manual. En el
-- destino storage.objects estara vacio o incompleto mientras ese plano no se
-- ejecute, asi que la paridad fuente/destino divergira por diseño. Se reporta
-- aparte, con su conteo, para que el operador sepa cuanto Storage falta.
-- La invariante que si es un fallo real (ausencia de signed URLs en
-- storage_path) se comprueba por VALOR: violations_* debe ser 0 en ambos lados.
-- =============================================================================
\echo 'SECTION=STORAGE'

select
  'BUCKETS_PRIVATE' as check_id,
  id as bucket_id,
  public as is_public
from storage.buckets
where id in ('soporte_adjuntos', 'certificados')
order by id;

select
  'STORAGE_OBJECTS_VS_APP_METADATA' as check_id,
  (select count(*) from storage.objects) as storage_objects_count,
  (select count(*) from public.archivos_ticket) as archivos_ticket_count,
  (select count(*) from public.solicitud_archivos) as solicitud_archivos_count;

select
  'NO_SIGNED_URLS_IN_STORAGE_PATH' as check_id,
  (select count(*) from public.archivos_ticket where storage_path ~* '^https?://') as violations_archivos_ticket,
  (select count(*) from public.solicitud_archivos where storage_path ~* '^https?://') as violations_solicitud_archivos;

-- Marcador de cierre: permite al orquestador delimitar la ultima seccion al
-- partir la firma en bloques comparables.
\echo 'SECTION=END'
\echo 'RECOVERY_SIGNATURE_COMPLETE=YES'
