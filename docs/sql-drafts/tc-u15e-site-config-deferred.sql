/*
PREPARED_NOT_APPLIED
NON_EXECUTABLE_DEFERRED_SQL

public.site_config está ausente en live. Los fragmentos siguientes fueron
retirados de la secuencia activa porque presuponen esa tabla.

PROVENANCE: supabase/migrations/20260717093300_authz_bitacora_ratelimit_solicitudes.sql:60-70
-- site_config: lectura para autenticados (config-loader); escritura solo admin.
alter table public.site_config enable row level security;
drop policy if exists site_config_read on public.site_config;
create policy site_config_read
  on public.site_config for select to authenticated
  using (true);
drop policy if exists site_config_admin_write on public.site_config;
create policy site_config_admin_write
  on public.site_config for all to authenticated
  using (public.tc_is_admin())
  with check (public.tc_is_admin());

PROVENANCE: supabase/migrations/20260717093400_authz_grants.sql:16
revoke select, insert, update, delete on public.site_config from anon;

PROVENANCE: supabase/migrations/20260717093400_authz_grants.sql:30
grant select, insert, update on public.site_config to authenticated;

DO_NOT_APPLY_WITHOUT_A_FUTURE_PRODUCT_DECISION
No aplicar este SQL sin una futura decisión de producto que defina el contrato,
el modelo de seguridad y la estrategia de publicación de site_config.
*/
