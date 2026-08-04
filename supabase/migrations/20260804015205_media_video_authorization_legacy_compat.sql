-- MEDIA video authorization compatibility bridge.
--
-- El esquema histórico conserva max_duracion_segundos NOT NULL.
-- La política canónica nueva utiliza segundos_max. Durante la transición
-- ambas columnas deben representar exactamente el mismo límite.

begin;

do $$
begin
  if to_regclass('public.autorizaciones_video') is null then
    raise exception
      'E_MEDIA_AUTORIZACIONES_VIDEO_TABLE_MISSING';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'autorizaciones_video'
      and column_name = 'max_duracion_segundos'
  ) then
    raise exception
      'E_MEDIA_LEGACY_DURATION_COLUMN_MISSING';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'autorizaciones_video'
      and column_name = 'segundos_max'
  ) then
    raise exception
      'E_MEDIA_CANONICAL_DURATION_COLUMN_MISSING';
  end if;
end
$$;

create or replace function public.tc_media_sync_authorization_duration_columns()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  new.segundos_max := coalesce(
    new.segundos_max,
    new.max_duracion_segundos
  );

  new.max_duracion_segundos := coalesce(
    new.max_duracion_segundos,
    new.segundos_max
  );

  if new.segundos_max is null
     or new.max_duracion_segundos is null
  then
    raise exception
      'E_MEDIA_DURACION_AUTORIZADA_REQUERIDA';
  end if;

  if new.segundos_max not in (15, 30)
     or new.max_duracion_segundos not in (15, 30)
  then
    raise exception
      'E_MEDIA_DURACION_AUTORIZADA_INVALIDA';
  end if;

  if new.segundos_max <> new.max_duracion_segundos then
    raise exception
      'E_MEDIA_DURACION_AUTORIZADA_INCONSISTENTE';
  end if;

  return new;
end
$$;

revoke all
on function public.tc_media_sync_authorization_duration_columns()
from public, anon, authenticated;

drop trigger if exists
  tc_media_authorization_duration_compat
on public.autorizaciones_video;

create trigger tc_media_authorization_duration_compat
before insert or update of
  segundos_max,
  max_duracion_segundos
on public.autorizaciones_video
for each row
execute function
  public.tc_media_sync_authorization_duration_columns();

-- Normalización defensiva de filas históricas.
update public.autorizaciones_video
set segundos_max = max_duracion_segundos
where segundos_max is null
  and max_duracion_segundos is not null;

update public.autorizaciones_video
set max_duracion_segundos = segundos_max
where max_duracion_segundos is null
  and segundos_max is not null;

do $$
begin
  if exists (
    select 1
    from public.autorizaciones_video
    where segundos_max is distinct from max_duracion_segundos
  ) then
    raise exception
      'E_MEDIA_DURATION_COLUMNS_NOT_RECONCILED';
  end if;
end
$$;

commit;
