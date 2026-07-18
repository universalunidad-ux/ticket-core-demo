-- AUTHZ V2 · Reemplazo explícito de políticas heredadas conocidas.
-- PREPARED_NOT_APPLIED. Ejecutar el PREFLIGHT (policy_preflight.sql) y revisar el
-- gate policy-inventory-gate.mjs antes de aplicar: si aparece una policy no
-- reconocida sobre estas tablas, DETENERSE (podría abrir acceso por OR).
drop policy if exists clientes_admin_select_ticket_core on public.clientes;
drop policy if exists cliente_sistemas_select_staff on public.cliente_sistemas;
-- Rollback documentado: recrear desde el dump de esquema previo a la migración
-- (ver docs/FRONTEND_WRITE_MATRIX.md y CLIENT_ROLE_FILTER_RLS_DRAFT.sql para el
-- modelo previo). No recrear políticas permisivas amplias sin revisión.
