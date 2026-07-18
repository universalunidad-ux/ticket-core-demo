-- IDEMPOTENCIA V2 · Reemplaza el patrón SELECT->INSERT por una operación atómica.
-- PREPARED_NOT_APPLIED. Tabla con PK única + estado + fingerprint + expiración.
create table if not exists public.support_idempotency (
  key text primary key,
  fingerprint text not null,
  status text not null default 'processing'
    check (status in ('processing','succeeded','failed')),
  response jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '1 day'
);
create index if not exists idx_support_idempotency_expires on public.support_idempotency (expires_at);

alter table public.support_idempotency enable row level security;
-- Sin policies para anon/authenticated => denegado. Solo service_role (Edge) opera.

-- Reclamo atómico: gana un único insert; los concurrentes ven el estado existente.
-- Ante 'failed' o expirado, re-reclama (no consume la clave por un error previo).
create or replace function public.support_idem_claim(p_key text, p_fingerprint text)
returns table(claimed boolean, status text, response jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare existing public.support_idempotency;
begin
  insert into public.support_idempotency(key, fingerprint, status, expires_at)
  values (p_key, p_fingerprint, 'processing', now() + interval '1 day');
  return query select true, 'processing'::text, null::jsonb;
exception when unique_violation then
  select * into existing from public.support_idempotency where key = p_key for update;
  if existing.status = 'failed' or existing.expires_at < now() then
    update public.support_idempotency
      set status = 'processing', fingerprint = p_fingerprint,
          created_at = now(), expires_at = now() + interval '1 day', response = null
      where key = p_key;
    return query select true, 'processing'::text, null::jsonb;
  else
    return query select false, existing.status, existing.response;
  end if;
end
$$;

-- Cierre: marca succeeded/failed y guarda respuesta reusable en reintentos.
create or replace function public.support_idem_finish(p_key text, p_status text, p_response jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_status not in ('succeeded','failed') then
    raise exception 'estado idempotencia inválido' using errcode = '22023';
  end if;
  update public.support_idempotency set status = p_status, response = p_response where key = p_key;
end
$$;

-- Limpieza de expirados (job administrativo / cron).
create or replace function public.support_idem_cleanup()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  delete from public.support_idempotency where expires_at < now();
  get diagnostics n = row_count;
  return n;
end
$$;

revoke execute on function public.support_idem_claim(text,text) from public, anon, authenticated;
revoke execute on function public.support_idem_finish(text,text,jsonb) from public, anon, authenticated;
revoke execute on function public.support_idem_cleanup() from public, anon, authenticated;
