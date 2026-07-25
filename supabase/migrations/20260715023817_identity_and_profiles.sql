-- Ticket Core staging baseline 0002.
-- Preconditions: auth.users is managed by Supabase.
-- Rollback: REVERSIBLE_BEFORE_DATA.
begin;

create table public.perfiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre text not null,
  rol text not null default 'soporte'
    check (rol in ('admin', 'soporte', 'ventas')),
  activo boolean not null default true,
  tema text not null default 'system'
    check (tema in ('light', 'dark', 'system')),
  preferencias jsonb not null default '{}'::jsonb
    check (jsonb_typeof(preferencias) = 'object'),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

comment on column public.perfiles.rol is
  'Authorization source controlled by administrators; never derived from user_metadata.';

commit;
