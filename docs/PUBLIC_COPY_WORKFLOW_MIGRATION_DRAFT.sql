-- DRAFT ONLY · TC-D100 U10 · DO NOT APPLY FROM THIS UNIT
-- Atomic draft/publish contract for plain-text public copy.
create table if not exists public.site_config_revisions (
  id uuid primary key default gen_random_uuid(),
  base_version bigint not null,
  version bigint not null,
  state text not null check (state in ('draft','published')),
  values_json jsonb not null,
  changed_keys text[] not null default '{}',
  actor_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  published_at timestamptz,
  constraint site_config_revisions_plain_object check (jsonb_typeof(values_json)='object')
);
alter table public.site_config_revisions enable row level security;
-- Required before deployment: admin-only policies, length validation for the
-- six allowlisted keys, save_site_config_draft(expected_version, values_json)
-- and publish_site_config(expected_version, revision_id) SECURITY DEFINER RPCs.
-- Publication must update all six public values and write one redacted audit
-- event in the same transaction. No function is deployed by this draft.
