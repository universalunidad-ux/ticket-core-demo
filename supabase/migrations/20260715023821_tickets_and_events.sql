-- Ticket Core staging baseline 0005.
-- Preconditions: identity, clients and intake migrations applied.
-- Rollback: REVERSIBLE_BEFORE_DATA.
begin;

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid references public.clientes(id) on delete set null,
  contacto_id uuid references public.clientes_contactos(id) on delete set null,
  solicitud_soporte_id uuid unique references public.solicitudes_soporte(id) on delete set null,
  titulo text not null,
  descripcion text,
  prioridad text not null default 'media' check (prioridad in ('baja', 'media', 'alta', 'urgente')),
  estado text not null default 'abierto'
    check (estado in ('abierto', 'en_proceso', 'esperando_cliente', 'resuelto', 'cerrado')),
  tipo text not null default 'soporte'
    check (tipo in ('soporte', 'renovacion', 'facturacion', 'configuracion', 'mantenimiento')),
  asignado_a uuid references public.perfiles(id) on delete set null,
  creado_por uuid references public.perfiles(id) on delete set null,
  fecha_creacion timestamptz not null default now(),
  fecha_actualizacion timestamptz not null default now(),
  fecha_cierre timestamptz,
  asignado_en timestamptz,
  primera_respuesta_en timestamptz,
  origen text not null default 'dashboard',
  impacto text,
  afecta_a text,
  desde_cuando text,
  ultimo_cambio text,
  horario_contacto text,
  horario_desde time,
  horario_hasta time,
  horario_notas text,
  contexto_adicional text,
  canal text,
  adjuntos jsonb not null default '[]'::jsonb check (jsonb_typeof(adjuntos) = 'array'),
  evidencia_count integer not null default 0 check (evidencia_count >= 0),
  folio text unique,
  token_publico text unique,
  token_publico_expira timestamptz,
  correo_cliente text,
  nombre_cliente_contacto text,
  timeline_publica jsonb not null default '[]'::jsonb check (jsonb_typeof(timeline_publica) = 'array'),
  empresa_capturada text,
  nombre_capturado text,
  correo_capturado text,
  telefono_capturado text,
  cliente_id_sugerido uuid references public.clientes(id) on delete set null,
  contacto_id_sugerido uuid references public.clientes_contactos(id) on delete set null,
  match_nivel text check (match_nivel is null or match_nivel in ('alto', 'medio', 'bajo', 'ninguno')),
  match_score integer,
  match_confirmado boolean not null default false,
  contacto_confirmado boolean not null default false,
  contacto_es_nuevo boolean not null default false,
  requiere_consolidacion boolean not null default false,
  sla_policy text,
  sla_first_response_deadline timestamptz,
  sla_resolution_deadline timestamptz,
  sla_breached_first_response boolean not null default false,
  sla_breached_resolution boolean not null default false,
  triage_score integer,
  next_action_hint text,
  requiere_supervision boolean not null default false,
  requiere_supervision_en timestamptz,
  revisado_por uuid references public.perfiles(id) on delete set null,
  revisado_en timestamptz,
  check ((token_publico is null) = (token_publico_expira is null))
);

alter table public.solicitudes_soporte
  add constraint solicitudes_soporte_ticket_id_fkey
  foreign key (ticket_id) references public.tickets(id) on delete set null;

create table public.ticket_folios (
  prefix text primary key check (prefix ~ '^[A-Z]{2,8}$'),
  last_value bigint not null default 0 check (last_value >= 0),
  updated_at timestamptz not null default now()
);

create table public.ticket_eventos (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  autor_tipo text not null check (autor_tipo in ('cliente', 'soporte', 'admin', 'sistema')),
  visibilidad text not null default 'publica' check (visibilidad in ('publica', 'interna')),
  kind text not null
    check (kind in ('mensaje', 'estado', 'nota', 'archivo', 'sistema', 'asignacion', 'sla', 'cierre', 'consolidacion')),
  texto text,
  created_at timestamptz not null default now(),
  created_by uuid references public.perfiles(id) on delete set null,
  meta jsonb not null default '{}'::jsonb,
  idempotency_key text generated always as (nullif(meta ->> 'idempotency_key', '')) stored,
  check (app_private.ticket_event_meta_is_safe(meta)),
  check (texto is not null or kind in ('archivo', 'sistema'))
);

create table public.ticket_respuestas_rapidas (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid references public.clientes(id) on delete cascade,
  contacto_id uuid references public.clientes_contactos(id) on delete cascade,
  scope text not null default 'global' check (scope in ('global', 'cliente', 'contacto')),
  modo text not null check (modo in ('seguimiento', 'nota', 'solucion')),
  titulo text not null,
  texto text not null,
  orden integer not null default 0,
  activo boolean not null default true,
  variables jsonb not null default '[]'::jsonb check (jsonb_typeof(variables) = 'array'),
  categoria text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  check ((scope = 'global' and cliente_id is null and contacto_id is null)
    or (scope = 'cliente' and cliente_id is not null and contacto_id is null)
    or (scope = 'contacto' and cliente_id is not null and contacto_id is not null))
);

create table public.ticket_portal_logs (
  id bigint generated by default as identity primary key,
  ticket_id uuid references public.tickets(id) on delete cascade,
  folio text,
  evento text not null check (evento in ('view', 'reply', 'upload', 'invalid_token', 'rate_limited')),
  requester_hash text check (requester_hash is null or requester_hash ~ '^[a-f0-9]{64}$'),
  user_agent_family text check (user_agent_family is null or user_agent_family in ('edge','opera','chrome','firefox','safari','curl','other')),
  detalle jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (app_private.audit_detail_is_safe(detalle))
);

create table public.ticket_match_decisiones (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid references public.tickets(id) on delete cascade,
  solicitud_soporte_id uuid references public.solicitudes_soporte(id) on delete cascade,
  empresa_capturada text,
  nombre_capturado text,
  correo_capturado text,
  telefono_capturado text,
  cliente_id_sugerido uuid references public.clientes(id) on delete set null,
  contacto_id_sugerido uuid references public.clientes_contactos(id) on delete set null,
  cliente_nombre_sugerido text,
  contacto_nombre_sugerido text,
  score numeric,
  nivel text not null default 'ninguno' check (nivel in ('alto', 'medio', 'bajo', 'ninguno')),
  razones jsonb not null default '[]'::jsonb check (jsonb_typeof(razones) = 'array'),
  decision text not null default 'pendiente'
    check (decision in ('pendiente', 'aceptado', 'rechazado', 'creado_cliente', 'creado_contacto', 'merge', 'ignorado')),
  decidido_por uuid references public.perfiles(id) on delete set null,
  decidido_en timestamptz,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  check (ticket_id is not null or solicitud_soporte_id is not null)
);

commit;
