-- PREFLIGHT (STAGING, solo lectura): inventario de políticas existentes.
-- Las policies permisivas se combinan con OR: una policy vieja amplia NO se
-- neutraliza al añadir una restrictiva. Exportar este resultado como snapshot
-- JSON y pasarlo a tools/policy-inventory-gate.mjs antes de aplicar migraciones.
--
-- Export JSON:
--   \pset format unaligned
--   \o policy_snapshot.json
--   select coalesce(json_agg(row_to_json(p)), '[]'::json)
--   from (
--     select schemaname, tablename, policyname, cmd, permissive, roles
--     from pg_policies where schemaname = 'public' order by tablename, policyname
--   ) p;
--   \o
select schemaname, tablename, policyname, cmd, permissive, roles, qual, with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;
