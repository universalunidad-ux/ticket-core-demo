-- TC-L130-AUTHENTICATED-LOCAL-CLOSURE-01
-- M1_CONTACT_AUTH_LINK_SINGLE_CLIENT
-- Additive migration. M2 multi-company memberships remain explicitly deferred.
-- Rollback: compensating migration required; never edit historical migrations.
begin;

alter table public.clientes_contactos
  add column if not exists auth_user_id uuid
  references auth.users(id) on delete set null;

comment on column public.clientes_contactos.auth_user_id is
  'M1 login identity binding. One auth.users identity maps to one contact and therefore one active client. Never authorize by email.';

create unique index if not exists ux_clientes_contactos_auth_user_id
  on public.clientes_contactos(auth_user_id)
  where auth_user_id is not null;

-- Server-owned ownership resolution. The browser never supplies the trusted
-- client id. Internal profiles remain governed by the existing role model and
-- cannot simultaneously acquire M1 client access.
create or replace function public.tc_current_client_id()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select cc.cliente_id
  from public.clientes_contactos cc
  join public.clientes c on c.id = cc.cliente_id
  where cc.auth_user_id = (select auth.uid())
    and cc.activo
    and c.activo
    and c.estatus <> 'inactivo'
    and not exists (
      select 1
      from public.perfiles p
      where p.id = (select auth.uid())
        and p.rol is not null
    )
  limit 1
$$;

revoke execute on function public.tc_current_client_id()
  from public, anon;
grant execute on function public.tc_current_client_id()
  to authenticated;

alter table public.clientes_contactos enable row level security;
alter table public.tickets enable row level security;

drop policy if exists contactos_client_self_select
  on public.clientes_contactos;
create policy contactos_client_self_select
  on public.clientes_contactos
  for select
  to authenticated
  using (
    auth_user_id = (select auth.uid())
    and activo
    and cliente_id = public.tc_current_client_id()
  );

drop policy if exists tickets_client_owner_select
  on public.tickets;
create policy tickets_client_owner_select
  on public.tickets
  for select
  to authenticated
  using (
    cliente_id is not null
    and cliente_id = public.tc_current_client_id()
  );

-- Grants and RLS are separate. These explicit grants preserve Data API access
-- on projects where new-object auto-exposure is disabled. No client write
-- policy is added: authenticated clients cannot insert/update/delete tickets.
grant select on public.clientes_contactos to authenticated;
grant select on public.tickets to authenticated;

do $verify_m1$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'clientes_contactos'
      and column_name = 'auth_user_id'
  ) then
    raise exception 'M1_VERIFY_AUTH_LINK_MISSING';
  end if;

  if not pg_catalog.has_function_privilege(
    'authenticated',
    'public.tc_current_client_id()',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'anon',
    'public.tc_current_client_id()',
    'EXECUTE'
  ) then
    raise exception 'M1_VERIFY_FUNCTION_ACL';
  end if;

  if (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and (
        (tablename = 'clientes_contactos' and policyname = 'contactos_client_self_select')
        or (tablename = 'tickets' and policyname = 'tickets_client_owner_select')
      )
  ) <> 2 then
    raise exception 'M1_VERIFY_POLICIES';
  end if;
end
$verify_m1$;

commit;
