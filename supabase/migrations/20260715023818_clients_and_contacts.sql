-- Ticket Core staging baseline 0003.
-- Preconditions: public.perfiles exists.
-- Rollback: REVERSIBLE_BEFORE_DATA.
begin;

create table public.clientes (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  nombre_norm text generated always as (app_private.normalized_text(nombre)) stored,
  telefono text,
  correo text,
  comentarios text,
  rol_responsable text,
  creado_por uuid references public.perfiles(id) on delete set null,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  favorito boolean not null default false,
  estatus text not null default 'activo'
    check (estatus in ('activo', 'seguimiento', 'problema', 'inactivo')),
  ultima_interaccion timestamptz,
  origen_registro text,
  horario_laboral text,
  razon_social text,
  razon_social_norm text generated always as (app_private.normalized_text(razon_social)) stored,
  rfc text,
  activo boolean not null default true,
  requiere_revision boolean not null default false,
  calidad_datos text not null default 'normal'
    check (calidad_datos in ('normal', 'sospechoso', 'validado', 'duplicado', 'archivado'))
);

create table public.clientes_contactos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  nombre text not null,
  puesto text,
  correo text,
  telefono text,
  whatsapp text,
  metodo_contacto_preferido text
    check (metodo_contacto_preferido is null or metodo_contacto_preferido in ('correo', 'telefono', 'whatsapp')),
  es_principal boolean not null default false,
  activo boolean not null default true,
  datos_confirmados_en timestamptz,
  datos_verificacion_vence_en timestamptz,
  datos_verificacion_estatus text not null default 'pendiente'
    check (datos_verificacion_estatus in ('pendiente', 'confirmado', 'vencido', 'requiere_revision')),
  cumpleanos date,
  origen_alta text,
  ultima_interaccion_en timestamptz,
  notas text,
  horario_laboral text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create table public.clientes_contacto_historial (
  id uuid primary key default gen_random_uuid(),
  contacto_id uuid not null references public.clientes_contactos(id) on delete restrict,
  cliente_id uuid not null references public.clientes(id) on delete restrict,
  nombre text,
  puesto text,
  correo text,
  telefono text,
  whatsapp text,
  metodo_contacto_preferido text,
  accion text not null default 'confirmacion'
    check (accion in ('confirmacion', 'actualizacion', 'desactivacion', 'reactivacion')),
  origen text not null default 'soporte_publico',
  creado_en timestamptz not null default now(),
  request_id uuid
);

create table public.cliente_aliases (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  alias text not null,
  alias_norm text generated always as (app_private.normalized_text(alias)) stored,
  tipo text not null default 'manual' check (tipo in ('manual', 'razon_social', 'dominio', 'sistema')),
  confianza numeric(5,4) not null default 1 check (confianza between 0 and 1),
  activo boolean not null default true,
  creado_por uuid references public.perfiles(id) on delete set null,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique (cliente_id, alias_norm)
);

create table public.cliente_sistemas (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  sistema text not null,
  system_key text,
  tipo_solicitud_default text,
  version_sistema text,
  version_windows text,
  servidor_o_equipo text,
  entorno text check (entorno is null or entorno in ('escritorio', 'nube', 'mixto', 'servidor')),
  version_sql text,
  tipo_instalacion text,
  ruta_empresa text,
  respaldo_ubicacion text,
  respaldo_frecuencia text,
  ultimo_respaldo timestamptz,
  ultimo_mantenimiento timestamptz,
  observaciones text,
  origen text,
  ultima_revision_en timestamptz,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid references public.perfiles(id) on delete set null
);

create table public.cliente_accesos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  contacto_id uuid references public.clientes_contactos(id) on delete set null,
  tipo text not null
    check (tipo in ('anydesk_id', 'teamviewer_id', 'vpn_reference', 'rdp_reference', 'other_reference')),
  valor_redactado text not null
    check (char_length(valor_redactado) between 3 and 160),
  secret_ref text,
  etiqueta text,
  notas text,
  expira_en timestamptz,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid references public.perfiles(id) on delete set null,
  check (secret_ref is null or secret_ref ~ '^vault://[a-zA-Z0-9/_-]+$')
);

comment on table public.cliente_accesos is
  'Only redacted identifiers and optional vault references; never real passwords, tokens or connection secrets.';

commit;
