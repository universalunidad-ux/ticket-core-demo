-- BLOCKED_BACKEND_RLS
-- Draft only. Do not run in production without staging, synthetic role tests,
-- a schema backup, Security Advisor review, and an approved deployment unit.
-- Contract verified read-only on 2026-07-16 against project ovfmqqqwezfdtgrtkjhf.

begin;

-- 1) The current role model has admin/ventas/soporte only.
alter table public.perfiles
  drop constraint perfiles_rol_check;
alter table public.perfiles
  add constraint perfiles_rol_check
  check (rol = any (array['admin'::text, 'supervisor'::text, 'ventas'::text, 'soporte'::text]));

create or replace function public.is_internal_user()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1
    from public.perfiles p
    where p.id = (select auth.uid())
      and p.rol in ('admin', 'supervisor', 'soporte', 'ventas')
  )
$function$;

-- 2) Admin and supervisor can read every Ticket Core client authorized by the
-- existing business boundary. Support remains ticket-assignment scoped.
drop policy if exists clientes_admin_select_ticket_core on public.clientes;
create policy clientes_manager_select_ticket_core
on public.clientes
for select
to authenticated
using (
  public.tc_current_role() = any (array['admin'::text, 'supervisor'::text])
  and (
    exists (select 1 from public.tickets t where t.cliente_id = clientes.id)
    or exists (select 1 from public.solicitudes_soporte s where s.cliente_id = clientes.id)
    or lower(coalesce(origen_registro, '')) = any (
      array[
        'ticket_core'::text, 'soporte_publico'::text, 'alta_cliente'::text,
        'alta_interna'::text, 'alta_aprobada'::text, 'alta_publica'::text,
        'registro_aprobado'::text
      ]
    )
  )
);

drop policy if exists clientes_support_select_assigned on public.clientes;
create policy clientes_support_select_assigned
on public.clientes
for select
to authenticated
using (
  public.tc_current_role() = 'soporte'
  and exists (
    select 1
    from public.tickets t
    where t.cliente_id = clientes.id
      and t.asignado_a = (select auth.uid())
  )
);

-- Supervisor needs ticket visibility to calculate the agent filter, but this
-- draft grants no ticket mutation rights to that role.
drop policy if exists tickets_supervisor_select on public.tickets;
create policy tickets_supervisor_select
on public.tickets
for select
to authenticated
using (public.tc_current_role() = 'supervisor');

-- 3) Related client data must inherit the same client boundary. Today contacts
-- are deny-all and systems are readable by every internal profile.
drop policy if exists clientes_contactos_select_scoped on public.clientes_contactos;
create policy clientes_contactos_select_scoped
on public.clientes_contactos
for select
to authenticated
using (
  exists (
    select 1
    from public.clientes c
    where c.id = clientes_contactos.cliente_id
  )
);

drop policy if exists cliente_sistemas_select_staff on public.cliente_sistemas;
drop policy if exists cliente_sistemas_select_scoped on public.cliente_sistemas;
create policy cliente_sistemas_select_scoped
on public.cliente_sistemas
for select
to authenticated
using (
  exists (
    select 1
    from public.clientes c
    where c.id = cliente_sistemas.cliente_id
  )
);

-- Explicit grants are kept beside RLS because Data API grants and policies are
-- separate controls. No anon grant is added.
grant select on table public.clientes to authenticated;
grant select on table public.tickets to authenticated;
grant select on table public.perfiles to authenticated;
grant select on table public.clientes_contactos to authenticated;
grant select on table public.cliente_sistemas to authenticated;

-- RLS and agent-filter lookup indexes.
alter table public.clientes enable row level security;
alter table public.tickets enable row level security;
alter table public.perfiles enable row level security;
alter table public.clientes_contactos enable row level security;
alter table public.cliente_sistemas enable row level security;

create index if not exists idx_tickets_asignado_cliente
  on public.tickets (asignado_a, cliente_id)
  where cliente_id is not null;
create index if not exists idx_clientes_contactos_cliente_id
  on public.clientes_contactos (cliente_id);
create index if not exists idx_cliente_sistemas_cliente_id
  on public.cliente_sistemas (cliente_id);

commit;

-- Required staging verification after applying this draft:
-- 1. Admin: all authorized clients; filters all/specific/unassigned.
-- 2. Supervisor: same reads and filters; no ticket update/delete.
-- 3. Support A: only clients with tickets assigned to A.
-- 4. Support B and direct REST-by-UUID: zero rows for A's clients, contacts,
--    systems and tickets.
-- 5. Anon: zero rows for all five internal tables.
-- 6. Run Security Advisor and EXPLAIN the assigned-client lookup.

-- Migration rollback (staging only; review policies before use):
-- drop policy if exists cliente_sistemas_select_scoped on public.cliente_sistemas;
-- create policy cliente_sistemas_select_staff on public.cliente_sistemas for select
--   to authenticated using (exists (select 1 from public.perfiles p where
--   p.id = (select auth.uid()) and p.rol = any (array['admin','soporte','ventas'])));
-- drop policy if exists clientes_contactos_select_scoped on public.clientes_contactos;
-- drop policy if exists tickets_supervisor_select on public.tickets;
-- drop policy if exists clientes_manager_select_ticket_core on public.clientes;
-- Recreate clientes_admin_select_ticket_core from the pre-migration schema dump.
-- Restore public.is_internal_user() and perfiles_rol_check from that same dump.
