-- Ticket Core staging baseline 0004.
-- Preconditions: clients and contacts exist.
-- Rollback: REVERSIBLE_BEFORE_DATA.
begin;

create table public.solicitudes_alta (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  telefono text,
  correo text,
  contacto text,
  comentarios text,
  estatus text not null default 'pendiente'
    check (estatus in ('pendiente', 'procesando', 'aprobada', 'rechazada')),
  origen text not null default 'alta_publica',
  archivos_count integer not null default 0 check (archivos_count between 0 and 10),
  total_peso bigint not null default 0 check (total_peso >= 0),
  observaciones_internas text,
  cliente_id uuid references public.clientes(id) on delete set null,
  contacto_id uuid references public.clientes_contactos(id) on delete set null,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  procesado_en timestamptz,
  contacto_principal_nombre text,
  contacto_principal_puesto text,
  contacto_principal_correo text,
  contacto_principal_telefono text,
  contacto_principal_whatsapp text,
  metodo_contacto_preferido text,
  horario_contacto text,
  cumpleanos_contacto date,
  contacto_alterno_nombre text,
  contacto_alterno_puesto text,
  contacto_alterno_correo text,
  contacto_alterno_telefono text,
  horario_laboral text,
  cliente_id_sugerido uuid references public.clientes(id) on delete set null,
  contacto_id_sugerido uuid references public.clientes_contactos(id) on delete set null,
  match_nivel text,
  match_score numeric,
  match_razones jsonb not null default '[]'::jsonb,
  requiere_revision boolean not null default true
);

create table public.solicitudes_registro (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid references public.clientes(id) on delete set null,
  contacto_id uuid references public.clientes_contactos(id) on delete set null,
  empresa text not null,
  correo_empresa text,
  telefono_empresa text,
  contacto_nombre text not null,
  contacto_puesto text,
  contacto_correo text,
  contacto_telefono text,
  contacto_whatsapp text,
  metodo_contacto_preferido text,
  horario_contacto text,
  cumpleanos_contacto date,
  contacto_alterno_nombre text,
  contacto_alterno_puesto text,
  contacto_alterno_correo text,
  contacto_alterno_telefono text,
  comentarios text,
  origen text not null default 'registro_publico',
  estatus text not null default 'pendiente'
    check (estatus in ('pendiente', 'aprobada', 'rechazada')),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  horario_laboral text,
  cliente_id_sugerido uuid references public.clientes(id) on delete set null,
  contacto_id_sugerido uuid references public.clientes_contactos(id) on delete set null,
  match_nivel text,
  match_score numeric,
  match_razones jsonb not null default '[]'::jsonb,
  requiere_revision boolean not null default true
);

create table public.solicitudes_soporte (
  id uuid primary key default gen_random_uuid(),
  folio text unique,
  nombre text not null,
  empresa text,
  correo text,
  telefono text,
  categoria text,
  sistema text,
  objetivo text,
  titulo text not null,
  descripcion text not null,
  impacto text,
  prioridad text not null default 'media' check (prioridad in ('baja', 'media', 'alta', 'urgente')),
  canal text,
  voz text,
  cliente_id uuid references public.clientes(id) on delete set null,
  contacto_id uuid references public.clientes_contactos(id) on delete set null,
  whatsapp_disponible boolean,
  ticket_id uuid,
  origen text not null default 'soporte_publico',
  estatus text not null default 'nuevo',
  created_at timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  desde_cuando text,
  afecta_a text,
  ultimo_cambio text,
  horario_contacto text,
  horario_desde time,
  horario_hasta time,
  horario_notas text,
  contexto_adicional text,
  archivos_count integer not null default 0 check (archivos_count between 0 and 10),
  total_peso bigint not null default 0 check (total_peso >= 0),
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
  consentimiento_aceptado boolean,
  consentimiento_en timestamptz,
  consentimiento_version text,
  privacidad_version text,
  consentimiento_origen text,
  check (
    (consentimiento_aceptado is null and consentimiento_en is null
      and consentimiento_version is null and privacidad_version is null
      and consentimiento_origen is null)
    or
    (consentimiento_aceptado is true and consentimiento_en is not null
      and nullif(trim(consentimiento_version), '') is not null
      and nullif(trim(privacidad_version), '') is not null
      and consentimiento_origen = 'soporte_publico_edge')
  ),
  check (consentimiento_version is null or char_length(consentimiento_version) <= 120),
  check (privacidad_version is null or char_length(privacidad_version) <= 120)
);

comment on column public.solicitudes_soporte.empresa is
  'Optional canonical company value; empty input is normalized to NULL by Edge.';

create table public.solicitud_archivos (
  id uuid primary key default gen_random_uuid(),
  solicitud_id uuid not null references public.solicitudes_soporte(id) on delete cascade,
  nombre_archivo text not null,
  storage_path text not null,
  mime_type text,
  tamano_bytes bigint check (tamano_bytes is null or tamano_bytes > 0),
  tipo_detectado text,
  creado_en timestamptz not null default now(),
  unique (solicitud_id, storage_path)
);

commit;
