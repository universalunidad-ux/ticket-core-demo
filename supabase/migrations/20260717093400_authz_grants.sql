-- AUTHZ U4 · Grants mínimos y revocación de acceso anónimo al Data API.
-- PREPARED_NOT_APPLIED. Aditiva/idempotente.
-- anon NO necesita acceso a tablas: el flujo público va por Edge Functions
-- (service_role) con token. Se revoca cualquier acceso anónimo residual.
revoke select, insert, update, delete on public.perfiles from anon;
revoke select, insert, update, delete on public.tickets from anon;
revoke select, insert, update, delete on public.clientes from anon;
revoke select, insert, update, delete on public.clientes_contactos from anon;
revoke select, insert, update, delete on public.cliente_sistemas from anon;
revoke select, insert, update, delete on public.cliente_aliases from anon;
revoke select, insert, update, delete on public.solicitudes_soporte from anon;
revoke select, insert, update, delete on public.bitacora from anon;
revoke select, insert, update, delete on public.rate_limit_events from anon;
revoke select, insert, update, delete on public.ticket_eventos from anon;
revoke select, insert, update, delete on public.archivos_ticket from anon;
revoke select, insert, update, delete on public.site_config from anon;

-- authenticated: grants de tabla mínimos; RLS acota las filas.
grant select on public.perfiles to authenticated;
grant update on public.perfiles to authenticated;
grant select, update on public.tickets to authenticated;
grant select on public.clientes to authenticated;
grant select on public.clientes_contactos to authenticated;
grant select on public.cliente_sistemas to authenticated;
grant select on public.cliente_aliases to authenticated;
grant select on public.solicitudes_soporte to authenticated;
grant select on public.bitacora to authenticated;
grant select on public.ticket_eventos to authenticated;
grant select on public.archivos_ticket to authenticated;
grant select, insert, update on public.site_config to authenticated;
