-- AUTHZ V2 · Policies de ESCRITURA específicas para las escrituras legítimas del
-- frontend (ver docs/FRONTEND_WRITE_MATRIX.md). PREPARED_NOT_APPLIED. Aditiva.
-- Sin grants amplios: cada operación se acota por dueño/asignación/rol.

-- Helper: ¿el usuario actual puede operar sobre este ticket? (manager o asignado)
create or replace function public.tc_can_access_ticket(p_ticket uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.tickets t
    where t.id = p_ticket
      and (public.tc_is_manager() or t.asignado_a = (select auth.uid()))
  )
$$;
revoke execute on function public.tc_can_access_ticket(uuid) from public, anon;
grant execute on function public.tc_can_access_ticket(uuid) to authenticated;

-- BITACORA: insertar solo el propio registro (usuario_id = self). Lectura ya es admin (V1).
drop policy if exists bitacora_insert_self on public.bitacora;
create policy bitacora_insert_self
  on public.bitacora for insert to authenticated
  with check (public.is_internal_user() and usuario_id = (select auth.uid()));

-- TICKET_EVENTOS: insertar en tickets accesibles.
drop policy if exists ticket_eventos_staff_insert on public.ticket_eventos;
create policy ticket_eventos_staff_insert
  on public.ticket_eventos for insert to authenticated
  with check (public.tc_can_access_ticket(ticket_id));

-- ARCHIVOS_TICKET: insert/delete en tickets accesibles.
drop policy if exists archivos_ticket_staff_insert on public.archivos_ticket;
create policy archivos_ticket_staff_insert
  on public.archivos_ticket for insert to authenticated
  with check (public.tc_can_access_ticket(ticket_id));
drop policy if exists archivos_ticket_staff_delete on public.archivos_ticket;
create policy archivos_ticket_staff_delete
  on public.archivos_ticket for delete to authenticated
  using (public.tc_can_access_ticket(ticket_id));

-- TICKET_ARCHIVOS (legacy): mismo alcance.
alter table public.ticket_archivos enable row level security;
drop policy if exists ticket_archivos_staff_select on public.ticket_archivos;
create policy ticket_archivos_staff_select
  on public.ticket_archivos for select to authenticated
  using (public.tc_can_access_ticket(ticket_id));
drop policy if exists ticket_archivos_staff_insert on public.ticket_archivos;
create policy ticket_archivos_staff_insert
  on public.ticket_archivos for insert to authenticated
  with check (public.tc_can_access_ticket(ticket_id));
drop policy if exists ticket_archivos_staff_delete on public.ticket_archivos;
create policy ticket_archivos_staff_delete
  on public.ticket_archivos for delete to authenticated
  using (public.tc_can_access_ticket(ticket_id));

-- CLIENTE_SISTEMAS: escritura por staff con cliente visible.
drop policy if exists cliente_sistemas_staff_insert on public.cliente_sistemas;
create policy cliente_sistemas_staff_insert
  on public.cliente_sistemas for insert to authenticated
  with check (exists (select 1 from public.clientes c where c.id = cliente_sistemas.cliente_id));
drop policy if exists cliente_sistemas_staff_update on public.cliente_sistemas;
create policy cliente_sistemas_staff_update
  on public.cliente_sistemas for update to authenticated
  using (exists (select 1 from public.clientes c where c.id = cliente_sistemas.cliente_id))
  with check (exists (select 1 from public.clientes c where c.id = cliente_sistemas.cliente_id));
drop policy if exists cliente_sistemas_staff_delete on public.cliente_sistemas;
create policy cliente_sistemas_staff_delete
  on public.cliente_sistemas for delete to authenticated
  using (exists (select 1 from public.clientes c where c.id = cliente_sistemas.cliente_id));

-- CLIENTE_ACCESOS: escritura por staff con cliente visible. RLS + select.
alter table public.cliente_accesos enable row level security;
drop policy if exists cliente_accesos_staff_select on public.cliente_accesos;
create policy cliente_accesos_staff_select
  on public.cliente_accesos for select to authenticated
  using (exists (select 1 from public.clientes c where c.id = cliente_accesos.cliente_id));
drop policy if exists cliente_accesos_staff_insert on public.cliente_accesos;
create policy cliente_accesos_staff_insert
  on public.cliente_accesos for insert to authenticated
  with check (exists (select 1 from public.clientes c where c.id = cliente_accesos.cliente_id));
drop policy if exists cliente_accesos_staff_update on public.cliente_accesos;
create policy cliente_accesos_staff_update
  on public.cliente_accesos for update to authenticated
  using (exists (select 1 from public.clientes c where c.id = cliente_accesos.cliente_id))
  with check (exists (select 1 from public.clientes c where c.id = cliente_accesos.cliente_id));

-- TICKETS asignación: solo manager (admin/supervisor) cambia asignado_a.
drop policy if exists tickets_manager_assign on public.tickets;
create policy tickets_manager_assign
  on public.tickets for update to authenticated
  using (public.tc_is_manager())
  with check (public.tc_is_manager());

-- QUICK REPLIES: administración solo admin (coincide con gating de UI).
alter table public.ticket_respuestas_rapidas enable row level security;
drop policy if exists quick_replies_staff_select on public.ticket_respuestas_rapidas;
create policy quick_replies_staff_select
  on public.ticket_respuestas_rapidas for select to authenticated
  using (public.is_internal_user());
drop policy if exists quick_replies_admin_write on public.ticket_respuestas_rapidas;
create policy quick_replies_admin_write
  on public.ticket_respuestas_rapidas for all to authenticated
  using (public.tc_is_admin())
  with check (public.tc_is_admin());

-- REGLAS_ASIGNACION: config admin.
alter table public.reglas_asignacion enable row level security;
drop policy if exists reglas_asignacion_staff_select on public.reglas_asignacion;
create policy reglas_asignacion_staff_select
  on public.reglas_asignacion for select to authenticated
  using (public.is_internal_user());
drop policy if exists reglas_asignacion_admin_write on public.reglas_asignacion;
create policy reglas_asignacion_admin_write
  on public.reglas_asignacion for all to authenticated
  using (public.tc_is_admin())
  with check (public.tc_is_admin());

-- AVISOS_GLOBALES: config admin escribe; lectura para autenticados (banner interno).
alter table public.avisos_globales enable row level security;
drop policy if exists avisos_globales_read on public.avisos_globales;
create policy avisos_globales_read
  on public.avisos_globales for select to authenticated
  using (true);
drop policy if exists avisos_globales_admin_write on public.avisos_globales;
create policy avisos_globales_admin_write
  on public.avisos_globales for all to authenticated
  using (public.tc_is_admin())
  with check (public.tc_is_admin());

-- Grants mínimos para las nuevas escrituras (RLS acota filas).
grant insert on public.bitacora to authenticated;
grant insert on public.ticket_eventos to authenticated;
grant insert, delete on public.archivos_ticket to authenticated;
grant select, insert, delete on public.ticket_archivos to authenticated;
grant insert, update, delete on public.cliente_sistemas to authenticated;
grant select, insert, update on public.cliente_accesos to authenticated;
grant select, insert, update, delete on public.ticket_respuestas_rapidas to authenticated;
grant select, insert, update on public.reglas_asignacion to authenticated;
grant select, insert, update, delete on public.avisos_globales to authenticated;

-- Revocar cualquier acceso anónimo residual a estas tablas.
revoke all on public.ticket_archivos from anon;
revoke all on public.cliente_accesos from anon;
revoke all on public.ticket_respuestas_rapidas from anon;
revoke all on public.reglas_asignacion from anon;
revoke all on public.avisos_globales from anon;
