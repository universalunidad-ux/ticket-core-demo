-- PREPARED_NOT_APPLIED
-- DO_NOT_APPLY_WITHOUT_STAGING_REVIEW
-- F17-W1-DATABASE-RLS-PREPARE — staff schema + RLS foundation
--
-- Migracion unica ADITIVA de fundacion para el dominio de Seguimiento (staff).
-- Crea 9 tablas core, habilita RLS en las 9, revoca a PUBLIC/anon, otorga solo
-- SELECT a authenticated y declara policies de lectura rol+pertenencia. Los
-- writers (INSERT/UPDATE/DELETE) se difieren a RPC posteriores (W3+). No hay
-- data migration. El estado del artefacto es PREPARED_NOT_APPLIED: no se aplica
-- ni se despliega en esta unidad; el apply remoto queda DEFERRED_OUT_OF_SCOPE.
--
-- Dependencias reutilizadas (NO creadas): public.perfiles(id,rol),
-- public.tickets(id), public.bitacora, auth.uid(), y los helpers AuthZ
-- tc_current_role() y tc_is_admin(). La migracion aborta fail-closed si alguna
-- dependencia falta o es incompatible, si existe un homonimo F17, o si falta la
-- extension btree_gist requerida por la exclusion de anuncios solapados.

begin;

-- ============================================================================
-- GUARDS fail-closed (abortar antes de crear cualquier objeto F17)
-- ============================================================================
-- F17 prerequisite: btree_gist is required by the overlapping-announcement exclusion constraint.
create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;

do $guard$
declare
  v_missing text;
begin
  -- perfiles(id, rol)
  if to_regclass('public.perfiles') is null then
    raise exception 'F17_GUARD: falta public.perfiles';
  end if;
  select string_agg(c, ', ') into v_missing
  from (select unnest(array['id','rol']) as c) req
  where not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'perfiles'
      and column_name = req.c);
  if v_missing is not null then
    raise exception 'F17_GUARD: public.perfiles sin columnas requeridas: %', v_missing;
  end if;

  -- tickets(id)
  if to_regclass('public.tickets') is null then
    raise exception 'F17_GUARD: falta public.tickets';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tickets' and column_name = 'id') then
    raise exception 'F17_GUARD: public.tickets sin columna id';
  end if;

  -- bitacora
  if to_regclass('public.bitacora') is null then
    raise exception 'F17_GUARD: falta public.bitacora';
  end if;

  -- auth.uid()
  if to_regprocedure('auth.uid()') is null then
    raise exception 'F17_GUARD: falta auth.uid()';
  end if;

  -- helpers AuthZ reutilizados (reuse-only; no se redefinen aqui)
  if to_regprocedure('public.tc_current_role()') is null then
    raise exception 'F17_GUARD: falta helper public.tc_current_role()';
  end if;
  if to_regprocedure('public.tc_is_admin()') is null then
    raise exception 'F17_GUARD: falta helper public.tc_is_admin()';
  end if;

  -- homonimos F17 (prohibido IF NOT EXISTS para ocultar colisiones)
  select string_agg(t, ', ') into v_missing
  from (select unnest(array[
    'public.staff_teams','public.staff_team_memberships','public.staff_conversations',
    'public.staff_messages','public.staff_message_revisions','public.staff_announcements',
    'public.staff_announcement_targets','public.staff_message_receipts','public.support_agent_scopes'
  ]) as t) f
  where to_regclass(f.t) is not null;
  if v_missing is not null then
    raise exception 'F17_GUARD: homonimo(s) F17 preexistente(s): %', v_missing;
  end if;

  -- btree_gist requerido por la exclusion de anuncios solapados por audiencia
  if not exists (select 1 from pg_extension where extname = 'btree_gist') then
    raise exception 'F17_GUARD: falta extension btree_gist (STOP)';
  end if;
end
$guard$;

-- ============================================================================
-- 1) staff_teams — equipos de soporte (tablas reales; soft-disable; sin DELETE)
-- ============================================================================
create table public.staff_teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.perfiles(id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid not null references public.perfiles(id) on delete restrict,
  constraint staff_teams_name_len check (char_length(btrim(name)) between 1 and 120),
  constraint staff_teams_normalized_name_uk unique (normalized_name)
);
create index staff_teams_active_norm_idx on public.staff_teams (active, normalized_name);

-- ============================================================================
-- 2) staff_team_memberships — membresia con vigencia; una activa por par
-- ============================================================================
create table public.staff_team_memberships (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.staff_teams(id) on delete restrict,
  profile_id uuid not null references public.perfiles(id) on delete restrict,
  active boolean not null default true,
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.perfiles(id) on delete restrict,
  constraint staff_team_memberships_interval check (valid_to is null or valid_from <= valid_to)
);
create unique index staff_team_memberships_active_uk
  on public.staff_team_memberships (team_id, profile_id) where active;
create index staff_team_memberships_team_idx
  on public.staff_team_memberships (team_id, profile_id) where active;
create index staff_team_memberships_profile_idx
  on public.staff_team_memberships (profile_id, team_id) where active;

-- ============================================================================
-- 3) staff_conversations — una conversacion por agente de soporte
-- ============================================================================
create table public.staff_conversations (
  id uuid primary key default gen_random_uuid(),
  support_agent_id uuid not null references public.perfiles(id) on delete restrict,
  state text not null default 'open',
  version bigint not null default 0,
  last_message_at timestamptz,
  archived_at timestamptz,
  archived_by uuid references public.perfiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint staff_conversations_agent_uk unique (support_agent_id),
  constraint staff_conversations_state_chk check (state in ('open','archived')),
  constraint staff_conversations_version_chk check (version >= 0),
  constraint staff_conversations_archived_pair check (
    (archived_at is null and archived_by is null)
    or (archived_at is not null and archived_by is not null))
);
create index staff_conversations_recent_idx
  on public.staff_conversations (last_message_at desc, id desc);
create index staff_conversations_open_idx
  on public.staff_conversations (state, last_message_at desc, id desc) where state = 'open';

-- ============================================================================
-- 4) staff_messages — append-only (sin UPDATE/DELETE nunca)
-- ============================================================================
create table public.staff_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.staff_conversations(id) on delete restrict,
  author_id uuid not null references public.perfiles(id) on delete restrict,
  author_kind text not null,
  client_message_id text not null,
  body text not null,
  urgent boolean not null default false,
  ticket_id uuid references public.tickets(id) on delete set null,
  reply_to_message_id uuid references public.staff_messages(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint staff_messages_author_kind_chk check (author_kind in ('admin','support')),
  constraint staff_messages_body_len check (char_length(btrim(body)) between 1 and 4000),
  constraint staff_messages_client_uk unique (author_id, client_message_id)
);
create index staff_messages_conv_idx
  on public.staff_messages (conversation_id, created_at desc, id desc);
create index staff_messages_urgent_idx
  on public.staff_messages (conversation_id, created_at desc) where urgent;
create index staff_messages_ticket_idx
  on public.staff_messages (ticket_id, created_at desc) where ticket_id is not null;

-- ============================================================================
-- 5) staff_message_revisions — append-only; edicion via RPC ventana 15m
-- ============================================================================
create table public.staff_message_revisions (
  id bigint generated always as identity primary key,
  message_id uuid not null references public.staff_messages(id) on delete restrict,
  revision_no integer not null,
  body text not null,
  previous_body_sha256 text not null,
  editor_id uuid not null references public.perfiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint staff_message_revisions_no_chk check (revision_no > 0),
  constraint staff_message_revisions_body_len check (char_length(btrim(body)) between 1 and 4000),
  constraint staff_message_revisions_sha_fmt check (previous_body_sha256 ~ '^[a-f0-9]{64}$'),
  constraint staff_message_revisions_uk unique (message_id, revision_no)
);
create index staff_message_revisions_msg_idx
  on public.staff_message_revisions (message_id, revision_no desc);

-- ============================================================================
-- 6) staff_announcements — append-only lifecycle; exclusion por audiencia
-- ============================================================================
create table public.staff_announcements (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.perfiles(id) on delete restrict,
  idempotency_key text not null,
  title text not null,
  body text not null,
  severity text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  cancelled_at timestamptz,
  cancelled_by uuid references public.perfiles(id) on delete restrict,
  replaced_at timestamptz,
  replaced_by_id uuid references public.staff_announcements(id) on delete restrict,
  audience_hash text not null,
  selector_spec jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint staff_announcements_idem_uk unique (created_by, idempotency_key),
  constraint staff_announcements_title_len check (char_length(btrim(title)) between 1 and 120),
  constraint staff_announcements_body_len check (char_length(btrim(body)) between 1 and 4000),
  constraint staff_announcements_severity_chk check (severity in ('info','warning','urgent')),
  constraint staff_announcements_window_chk check (ends_at > starts_at),
  constraint staff_announcements_duration_chk check (ends_at <= starts_at + interval '30 days'),
  constraint staff_announcements_lifecycle_chk check (not (cancelled_at is not null and replaced_at is not null)),
  constraint staff_announcements_no_self_replace check (replaced_by_id is null or replaced_by_id <> id),
  constraint staff_announcements_audience_fmt check (audience_hash ~ '^[a-f0-9]{64}$'),
  constraint staff_announcements_no_overlap exclude using gist (
    audience_hash with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (cancelled_at is null and replaced_at is null)
);
create index staff_announcements_window_idx on public.staff_announcements (starts_at, ends_at);
create index staff_announcements_created_idx on public.staff_announcements (created_at desc, id);
create index staff_announcements_audience_idx on public.staff_announcements (audience_hash, starts_at, ends_at);

-- ============================================================================
-- 7) staff_announcement_targets — snapshot congelado por receptor
-- ============================================================================
create table public.staff_announcement_targets (
  announcement_id uuid not null references public.staff_announcements(id) on delete restrict,
  recipient_profile_id uuid not null references public.perfiles(id) on delete restrict,
  matched_by jsonb not null default '{}'::jsonb,
  manually_selected boolean not null default false,
  created_at timestamptz not null default now(),
  constraint staff_announcement_targets_pk primary key (announcement_id, recipient_profile_id)
);
create index staff_announcement_targets_recipient_idx
  on public.staff_announcement_targets (recipient_profile_id, announcement_id);

-- ============================================================================
-- 8) staff_message_receipts — upsert monotonico; self-owned
-- ============================================================================
create table public.staff_message_receipts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.perfiles(id) on delete restrict,
  message_id uuid references public.staff_messages(id) on delete restrict,
  announcement_id uuid references public.staff_announcements(id) on delete restrict,
  delivered_at timestamptz,
  read_at timestamptz,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  constraint staff_message_receipts_target_chk check (num_nonnulls(message_id, announcement_id) = 1),
  constraint staff_message_receipts_read_needs_delivered check (read_at is null or delivered_at is not null),
  constraint staff_message_receipts_ack_needs_read check (acknowledged_at is null or read_at is not null),
  constraint staff_message_receipts_read_ge_delivered check (read_at is null or delivered_at is null or read_at >= delivered_at),
  constraint staff_message_receipts_ack_ge_read check (acknowledged_at is null or read_at is null or acknowledged_at >= read_at)
);
create unique index staff_message_receipts_msg_uk
  on public.staff_message_receipts (profile_id, message_id) where message_id is not null;
create unique index staff_message_receipts_ann_uk
  on public.staff_message_receipts (profile_id, announcement_id) where announcement_id is not null;
create index staff_message_receipts_msg_idx on public.staff_message_receipts (profile_id, message_id);
create index staff_message_receipts_ann_idx on public.staff_message_receipts (profile_id, announcement_id);
create index staff_message_receipts_pending_idx
  on public.staff_message_receipts (profile_id) where acknowledged_at is null;

-- ============================================================================
-- 9) support_agent_scopes — scopes specialty/machine/family (NUNCA team)
-- ============================================================================
create table public.support_agent_scopes (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.perfiles(id) on delete restrict,
  scope_kind text not null,
  scope_key text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.perfiles(id) on delete restrict,
  constraint support_agent_scopes_kind_chk check (scope_kind in ('specialty','machine','family')),
  constraint support_agent_scopes_key_len check (char_length(btrim(scope_key)) between 1 and 120)
);
create unique index support_agent_scopes_active_uk
  on public.support_agent_scopes (profile_id, scope_kind, scope_key) where active;
create index support_agent_scopes_lookup_idx
  on public.support_agent_scopes (scope_kind, scope_key, profile_id) where active;
create index support_agent_scopes_profile_idx
  on public.support_agent_scopes (profile_id);

-- ============================================================================
-- RLS: habilitar en las 9; revocar PUBLIC/anon; GRANT SELECT solo a authenticated
-- (cero DML core a authenticated; writers = RPC posterior)
-- ============================================================================
alter table public.staff_teams enable row level security;
alter table public.staff_team_memberships enable row level security;
alter table public.staff_conversations enable row level security;
alter table public.staff_messages enable row level security;
alter table public.staff_message_revisions enable row level security;
alter table public.staff_announcements enable row level security;
alter table public.staff_announcement_targets enable row level security;
alter table public.staff_message_receipts enable row level security;
alter table public.support_agent_scopes enable row level security;

revoke all on public.staff_teams from public, anon;
revoke all on public.staff_team_memberships from public, anon;
revoke all on public.staff_conversations from public, anon;
revoke all on public.staff_messages from public, anon;
revoke all on public.staff_message_revisions from public, anon;
revoke all on public.staff_announcements from public, anon;
revoke all on public.staff_announcement_targets from public, anon;
revoke all on public.staff_message_receipts from public, anon;
revoke all on public.support_agent_scopes from public, anon;

grant select on public.staff_teams to authenticated;
grant select on public.staff_team_memberships to authenticated;
grant select on public.staff_conversations to authenticated;
grant select on public.staff_messages to authenticated;
grant select on public.staff_message_revisions to authenticated;
grant select on public.staff_announcements to authenticated;
grant select on public.staff_announcement_targets to authenticated;
grant select on public.staff_message_receipts to authenticated;
grant select on public.support_agent_scopes to authenticated;

-- ============================================================================
-- Policies de LECTURA (SELECT) rol+pertenencia. Admin via tc_is_admin();
-- soporte via tc_current_role()='soporte' + predicado de pertenencia/propiedad.
-- supervisor/ventas/null/no-profile/anon => cero filas (fail-closed).
-- Ninguna policy de escritura en W1.
-- ============================================================================

-- staff_teams
create policy staff_teams_admin_select on public.staff_teams
  for select to authenticated using (public.tc_is_admin());
create policy staff_teams_support_select on public.staff_teams
  for select to authenticated using (
    public.tc_current_role() = 'soporte'
    and exists (
      select 1 from public.staff_team_memberships m
      where m.team_id = staff_teams.id and m.profile_id = auth.uid() and m.active));

-- staff_team_memberships
create policy staff_team_memberships_admin_select on public.staff_team_memberships
  for select to authenticated using (public.tc_is_admin());
create policy staff_team_memberships_self_select on public.staff_team_memberships
  for select to authenticated using (
    public.tc_current_role() = 'soporte' and profile_id = auth.uid());

-- staff_conversations
create policy staff_conversations_admin_select on public.staff_conversations
  for select to authenticated using (public.tc_is_admin());
create policy staff_conversations_support_select on public.staff_conversations
  for select to authenticated using (
    public.tc_current_role() = 'soporte' and support_agent_id = auth.uid());

-- staff_messages
create policy staff_messages_admin_select on public.staff_messages
  for select to authenticated using (public.tc_is_admin());
create policy staff_messages_support_select on public.staff_messages
  for select to authenticated using (
    public.tc_current_role() = 'soporte'
    and exists (
      select 1 from public.staff_conversations c
      where c.id = staff_messages.conversation_id and c.support_agent_id = auth.uid()));

-- staff_message_revisions
create policy staff_message_revisions_admin_select on public.staff_message_revisions
  for select to authenticated using (public.tc_is_admin());
create policy staff_message_revisions_support_select on public.staff_message_revisions
  for select to authenticated using (
    public.tc_current_role() = 'soporte'
    and exists (
      select 1 from public.staff_messages msg
      join public.staff_conversations c on c.id = msg.conversation_id
      where msg.id = staff_message_revisions.message_id and c.support_agent_id = auth.uid()));

-- staff_announcements
create policy staff_announcements_admin_select on public.staff_announcements
  for select to authenticated using (public.tc_is_admin());
create policy staff_announcements_support_select on public.staff_announcements
  for select to authenticated using (
    public.tc_current_role() = 'soporte'
    and cancelled_at is null and replaced_at is null
    and starts_at <= now() and now() < ends_at
    and exists (
      select 1 from public.staff_announcement_targets t
      where t.announcement_id = staff_announcements.id and t.recipient_profile_id = auth.uid()));

-- staff_announcement_targets
create policy staff_announcement_targets_admin_select on public.staff_announcement_targets
  for select to authenticated using (public.tc_is_admin());
create policy staff_announcement_targets_self_select on public.staff_announcement_targets
  for select to authenticated using (
    public.tc_current_role() = 'soporte' and recipient_profile_id = auth.uid());

-- staff_message_receipts
create policy staff_message_receipts_admin_select on public.staff_message_receipts
  for select to authenticated using (public.tc_is_admin());
create policy staff_message_receipts_self_select on public.staff_message_receipts
  for select to authenticated using (
    public.tc_current_role() = 'soporte' and profile_id = auth.uid());

-- support_agent_scopes
create policy support_agent_scopes_admin_select on public.support_agent_scopes
  for select to authenticated using (public.tc_is_admin());
create policy support_agent_scopes_self_select on public.support_agent_scopes
  for select to authenticated using (
    public.tc_current_role() = 'soporte' and profile_id = auth.uid() and active);

commit;

-- ROLLBACK (local, mientras PREPARED_NOT_APPLIED): esta migracion nunca se
-- aplica en esta unidad. Rollback documental en
-- docs/operations/F17_SCHEMA_AUTHZ_ROLLBACK.md. Orden inverso de DROP (solo con
-- aprobacion explicita de perdida de datos y tras un apply futuro autorizado):
--   staff_message_receipts -> staff_announcement_targets -> staff_announcements
--   -> staff_message_revisions -> staff_messages -> staff_conversations
--   -> staff_team_memberships -> staff_teams -> support_agent_scopes
-- Preservar perfiles, tickets, bitacora, avisos_globales, ticket_eventos,
-- reglas_asignacion, soporte_adjuntos y helpers preexistentes.
