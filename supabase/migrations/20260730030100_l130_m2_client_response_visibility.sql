-- TC-Q2-B130-004 response visibility slice.
-- Additive to M1 ownership; this does not introduce memberships.
begin;

alter table public.ticket_eventos enable row level security;

drop policy if exists ticket_eventos_client_public_select
  on public.ticket_eventos;
create policy ticket_eventos_client_public_select
  on public.ticket_eventos
  for select
  to authenticated
  using (
    visibilidad = 'publica'
    and exists (
      select 1
      from public.tickets t
      where t.id = ticket_eventos.ticket_id
        and t.cliente_id is not null
        and t.cliente_id = public.tc_current_client_id()
    )
  );

grant select on public.ticket_eventos to authenticated;

do $verify_q2_client_events$
declare
  policy_roles name[];
  policy_command text;
  policy_using text;
begin
  select roles, cmd, qual
  into policy_roles, policy_command, policy_using
  from pg_policies
  where schemaname = 'public'
    and tablename = 'ticket_eventos'
    and policyname = 'ticket_eventos_client_public_select';

  if policy_roles is null
    or policy_roles <> array['authenticated']::name[]
    or policy_command <> 'SELECT'
    or policy_using not like '%visibilidad%publica%'
    or policy_using not like '%tc_current_client_id%'
  then
    raise exception 'Q2_CLIENT_EVENT_POLICY_VERIFY_FAILED';
  end if;

  if not pg_catalog.has_table_privilege(
    'authenticated', 'public.ticket_eventos', 'SELECT'
  ) then
    raise exception 'Q2_CLIENT_EVENT_SELECT_GRANT_MISSING';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'ticket_eventos'
      and policyname = 'ticket_eventos_client_public_select'
      and cmd <> 'SELECT'
  ) then
    raise exception 'Q2_CLIENT_EVENT_WRITE_POLICY_FORBIDDEN';
  end if;
end
$verify_q2_client_events$;

commit;
