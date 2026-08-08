-- TC-8166E-MT1-MEDIA-PIPELINE-LOCAL-01 · wagon 4
-- MEDIA-014 / MEDIA-015 control plane only. No legal duration is invented and
-- no policy row is seeded. Adoption of MEDIA-015 remains a legal/product decision.
begin;

create table public.politicas_retencion_adjuntos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique check (length(trim(nombre)) between 3 and 120),
  intervalo_retencion interval not null check (intervalo_retencion > interval '0 seconds'),
  referencia_aprobacion text not null check (length(trim(referencia_aprobacion)) between 3 and 500),
  aprobada_por uuid not null references public.perfiles(id) on delete restrict,
  activa boolean not null default true,
  creada_en timestamptz not null default now()
);

create table public.retencion_adjuntos (
  adjunto_id uuid primary key references public.adjuntos_ticket(id) on delete cascade,
  politica_id uuid references public.politicas_retencion_adjuntos(id) on delete restrict,
  retener_hasta timestamptz,
  legal_hold boolean not null default false,
  referencia_legal text,
  establecido_por uuid references public.perfiles(id) on delete restrict,
  establecido_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  check (not legal_hold or (referencia_legal is not null and length(trim(referencia_legal)) >= 3)),
  check (politica_id is not null or retener_hasta is null)
);

alter table public.adjuntos_ticket
  add column delete_token uuid;

alter table public.politicas_retencion_adjuntos enable row level security;
alter table public.retencion_adjuntos enable row level security;
revoke all on public.politicas_retencion_adjuntos, public.retencion_adjuntos from public, anon, authenticated;
grant all on public.politicas_retencion_adjuntos, public.retencion_adjuntos to service_role;

create or replace function public.tc_prepare_media_delete(p_adjunto_id uuid)
returns table(storage_path text, delete_token uuid)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_attachment public.adjuntos_ticket%rowtype;
  v_retention public.retencion_adjuntos%rowtype;
  v_token uuid := gen_random_uuid();
begin
  select * into v_attachment from public.adjuntos_ticket
  where id = p_adjunto_id for update;
  if not found then raise exception 'MEDIA_ATTACHMENT_NOT_FOUND'; end if;
  if v_attachment.estado <> 'listo' then raise exception 'MEDIA_DELETE_STATE_INVALID'; end if;
  select * into v_retention from public.retencion_adjuntos where adjunto_id = p_adjunto_id;
  if found and v_retention.legal_hold then raise exception 'MEDIA_DELETE_LEGAL_HOLD'; end if;
  if found and v_retention.retener_hasta is not null and v_retention.retener_hasta > now() then
    raise exception 'MEDIA_DELETE_RETENTION_ACTIVE';
  end if;
  update public.adjuntos_ticket
  set estado = 'procesando', delete_token = v_token, actualizado_en = now()
  where id = p_adjunto_id;
  return query select v_attachment.storage_path, v_token;
end
$function$;

create or replace function public.tc_finalize_media_delete(p_adjunto_id uuid, p_delete_token uuid)
returns boolean
language sql
security definer
set search_path = pg_catalog, public
as $function$
  update public.adjuntos_ticket
  set estado = 'eliminado', eliminado_en = now(), delete_token = null, actualizado_en = now()
  where id = p_adjunto_id and estado = 'procesando' and delete_token = p_delete_token
  returning true
$function$;

create or replace function public.tc_abort_media_delete(p_adjunto_id uuid, p_delete_token uuid)
returns boolean
language sql
security definer
set search_path = pg_catalog, public
as $function$
  update public.adjuntos_ticket
  set estado = 'listo', delete_token = null, actualizado_en = now()
  where id = p_adjunto_id and estado = 'procesando' and delete_token = p_delete_token
  returning true
$function$;

revoke execute on function public.tc_prepare_media_delete(uuid) from public, anon, authenticated;
revoke execute on function public.tc_finalize_media_delete(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.tc_abort_media_delete(uuid, uuid) from public, anon, authenticated;
grant execute on function public.tc_prepare_media_delete(uuid) to service_role;
grant execute on function public.tc_finalize_media_delete(uuid, uuid) to service_role;
grant execute on function public.tc_abort_media_delete(uuid, uuid) to service_role;

do $media_legal_policy_guard$
begin
  if exists (select 1 from public.politicas_retencion_adjuntos) then
    raise exception 'MEDIA_RETENTION_POLICY_MUST_NOT_BE_ASSUMED';
  end if;
end
$media_legal_policy_guard$;

commit;
