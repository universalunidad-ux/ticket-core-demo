-- AUTHZ U4 · tickets/clientes/contactos/sistemas/aliases: RLS por rol y asignación.
-- PREPARED_NOT_APPLIED. Aditiva/idempotente. Basada en esquema verificado read-only.
alter table public.tickets enable row level security;
alter table public.clientes enable row level security;
alter table public.clientes_contactos enable row level security;
alter table public.cliente_sistemas enable row level security;
alter table public.cliente_aliases enable row level security;

-- TICKETS: manager (admin/supervisor) ve todo; soporte solo asignados.
drop policy if exists tickets_manager_select on public.tickets;
create policy tickets_manager_select
  on public.tickets for select to authenticated
  using (public.tc_is_manager());

drop policy if exists tickets_support_select_assigned on public.tickets;
create policy tickets_support_select_assigned
  on public.tickets for select to authenticated
  using (public.tc_current_role() = 'soporte' and asignado_a = (select auth.uid()));

-- Mutación de tickets: admin, o soporte sobre ticket asignado. Supervisor no muta.
drop policy if exists tickets_admin_update on public.tickets;
create policy tickets_admin_update
  on public.tickets for update to authenticated
  using (public.tc_is_admin() or (public.tc_current_role() = 'soporte' and asignado_a = (select auth.uid())))
  with check (public.tc_is_admin() or (public.tc_current_role() = 'soporte' and asignado_a = (select auth.uid())));

-- CLIENTES: manager ve clientes con relación Ticket Core; soporte solo de tickets asignados.
drop policy if exists clientes_manager_select_ticket_core on public.clientes;
create policy clientes_manager_select_ticket_core
  on public.clientes for select to authenticated
  using (
    public.tc_is_manager()
    and (
      exists (select 1 from public.tickets t where t.cliente_id = clientes.id)
      or exists (select 1 from public.solicitudes_soporte s where s.cliente_id = clientes.id)
      or lower(coalesce(clientes.origen_registro, '')) = any (
        array[
          'ticket_core'::text,
          'soporte_publico'::text,
          'alta_cliente'::text,
          'alta_interna'::text,
          'alta_aprobada'::text,
          'alta_publica'::text,
          'registro_aprobado'::text
        ]
      )
    )
  );

drop policy if exists clientes_support_select_assigned on public.clientes;
create policy clientes_support_select_assigned
  on public.clientes for select to authenticated
  using (
    public.tc_current_role() = 'soporte'
    and exists (
      select 1 from public.tickets t
      where t.cliente_id = clientes.id and t.asignado_a = (select auth.uid())
    )
  );

-- Datos relacionados heredan la frontera del cliente visible.
drop policy if exists clientes_contactos_select_scoped on public.clientes_contactos;
create policy clientes_contactos_select_scoped
  on public.clientes_contactos for select to authenticated
  using (exists (select 1 from public.clientes c where c.id = clientes_contactos.cliente_id));

drop policy if exists cliente_sistemas_select_scoped on public.cliente_sistemas;
create policy cliente_sistemas_select_scoped
  on public.cliente_sistemas for select to authenticated
  using (exists (select 1 from public.clientes c where c.id = cliente_sistemas.cliente_id));

drop policy if exists cliente_aliases_select_scoped on public.cliente_aliases;
create policy cliente_aliases_select_scoped
  on public.cliente_aliases for select to authenticated
  using (exists (select 1 from public.clientes c where c.id = cliente_aliases.cliente_id));

create index if not exists idx_tickets_asignado_cliente
  on public.tickets (asignado_a, cliente_id) where cliente_id is not null;
create index if not exists idx_clientes_contactos_cliente_id on public.clientes_contactos (cliente_id);
create index if not exists idx_cliente_sistemas_cliente_id on public.cliente_sistemas (cliente_id);
create index if not exists idx_cliente_aliases_cliente_id on public.cliente_aliases (cliente_id);
