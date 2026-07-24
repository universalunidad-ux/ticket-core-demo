-- Ticket Core staging baseline 0008.
-- Preconditions: perfiles exists.
-- Rollback: REVERSIBLE_BEFORE_DATA.
begin;

create table public.reglas_asignacion (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  prioridad integer not null default 100 check (prioridad between 0 and 100000),
  tipo_condicion text not null
    check (tipo_condicion in ('tipo_maquina', 'tipo_caso', 'empresa', 'cliente_nuevo', 'palabra_clave')),
  valor text,
  agente_id uuid not null references public.perfiles(id) on delete restrict,
  activo boolean not null default true,
  creado_por uuid references public.perfiles(id) on delete set null,
  actualizado_por uuid references public.perfiles(id) on delete set null,
  eliminado_en timestamptz,
  eliminado_por uuid references public.perfiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((tipo_condicion = 'cliente_nuevo' and valor is null)
    or (tipo_condicion <> 'cliente_nuevo' and nullif(trim(valor), '') is not null)),
  check ((eliminado_en is null and eliminado_por is null)
    or (eliminado_en is not null and eliminado_por is not null))
);

comment on table public.reglas_asignacion is
  'Administrative rules only. The automatic assignment engine is intentionally NOT_CONNECTED.';

create table public.site_config (
  clave text primary key,
  valor text not null,
  pagina text not null check (pagina in ('soporte', 'estado')),
  tipo text not null default 'texto' check (tipo = 'texto'),
  activo boolean not null default true,
  publico boolean not null default false,
  actualizado_por uuid references public.perfiles(id) on delete set null,
  actualizado_en timestamptz not null default now(),
  check (clave in (
    'soporte.hero.kicker', 'soporte.hero.titulo', 'soporte.ayuda.titulo',
    'soporte.evidencia.hint', 'estado.reply.titulo', 'estado.reply.hint'
  )),
  check (app_private.plain_text_is_safe(valor, 400)),
  check (pagina = split_part(clave, '.', 1)),
  check (not publico or clave in (
    'soporte.hero.kicker', 'soporte.hero.titulo', 'soporte.ayuda.titulo',
    'soporte.evidencia.hint', 'estado.reply.titulo', 'estado.reply.hint'
  ))
);

insert into public.site_config (clave, valor, pagina, tipo, activo, publico)
values
  ('soporte.hero.kicker', 'Centro de soporte', 'soporte', 'texto', true, true),
  ('soporte.hero.titulo', '¿Cómo podemos ayudarte?', 'soporte', 'texto', true, true),
  ('soporte.ayuda.titulo', 'Cómo agilizar tu atención', 'soporte', 'texto', true, true),
  ('soporte.evidencia.hint', 'Adjunta evidencia que ayude a identificar el problema.', 'soporte', 'texto', true, true),
  ('estado.reply.titulo', 'Responder al equipo', 'estado', 'texto', true, true),
  ('estado.reply.hint', 'Puedes adjuntar archivos para continuar con la atención.', 'estado', 'texto', true, true);

create table public.avisos_globales (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  contenido text not null,
  tipo text not null default 'info' check (tipo in ('info', 'warning', 'success', 'danger', 'mantenimiento')),
  prioridad integer not null default 100,
  activo boolean not null default true,
  mostrar_en_soporte boolean not null default true,
  mostrar_en_dashboard boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid references public.perfiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (app_private.plain_text_is_safe(titulo, 160)),
  check (app_private.plain_text_is_safe(contenido, 1200)),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);

commit;
