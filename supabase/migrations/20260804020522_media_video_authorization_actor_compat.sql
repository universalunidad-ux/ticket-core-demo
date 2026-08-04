-- MEDIA video authorization legacy compatibility:
--   segundos_max          <-> max_duracion_segundos
--   creada_por            <-> autorizado_por
--
-- La RPC canónica escribe las columnas nuevas. El esquema histórico
-- conserva columnas obligatorias que deben mantenerse sincronizadas.

begin;

do $$
begin
  if to_regclass(
    'public.autorizaciones_video'
  ) is null then
    raise exception
      'E_MEDIA_AUTORIZACIONES_VIDEO_TABLE_MISSING';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'autorizaciones_video'
      and column_name = 'creada_por'
  ) then
    raise exception
      'E_MEDIA_CANONICAL_ACTOR_COLUMN_MISSING';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'autorizaciones_video'
      and column_name = 'autorizado_por'
  ) then
    raise exception
      'E_MEDIA_LEGACY_ACTOR_COLUMN_MISSING';
  end if;
end
$$;

create or replace function
  public.tc_media_sync_authorization_duration_columns()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  -- Detectar contradicciones explícitas antes de normalizar.

  if new.segundos_max is not null
     and new.max_duracion_segundos is not null
     and new.segundos_max::numeric
       is distinct from new.max_duracion_segundos
  then
    raise exception
      'E_MEDIA_DURACION_AUTORIZADA_INCONSISTENTE';
  end if;

  if new.creada_por is not null
     and new.autorizado_por is not null
     and new.creada_por
       is distinct from new.autorizado_por
  then
    raise exception
      'E_MEDIA_AUTORIZADOR_INCONSISTENTE';
  end if;

  -- Puente de duración.

  new.segundos_max := coalesce(
    new.segundos_max,
    new.max_duracion_segundos::integer
  );

  new.max_duracion_segundos := coalesce(
    new.max_duracion_segundos,
    new.segundos_max::numeric
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

  -- Puente de identidad. La RPC canónica proporciona creada_por.
  -- Las escrituras históricas pueden proporcionar autorizado_por.

  new.autorizado_por := coalesce(
    new.autorizado_por,
    new.creada_por,
    auth.uid()
  );

  new.creada_por := coalesce(
    new.creada_por,
    new.autorizado_por,
    auth.uid()
  );

  if new.autorizado_por is null
     or new.creada_por is null
  then
    raise exception
      'E_MEDIA_AUTORIZADOR_REQUERIDO';
  end if;

  if new.creada_por
     is distinct from new.autorizado_por
  then
    raise exception
      'E_MEDIA_AUTORIZADOR_INCONSISTENTE';
  end if;

  return new;
end
$$;

revoke all
on function
  public.tc_media_sync_authorization_duration_columns()
from public, anon, authenticated;

drop trigger if exists
  tc_media_authorization_duration_compat
on public.autorizaciones_video;

create trigger
  tc_media_authorization_duration_compat
before insert or update of
  segundos_max,
  max_duracion_segundos,
  creada_por,
  autorizado_por
on public.autorizaciones_video
for each row
execute function
  public.tc_media_sync_authorization_duration_columns();

-- Normalizar cualquier fila histórica sin columna canónica.
-- autorizado_por ya es NOT NULL en el esquema heredado.

update public.autorizaciones_video
set creada_por = autorizado_por
where creada_por is null;

do $$
begin
  if exists (
    select 1
    from public.autorizaciones_video
    where creada_por
      is distinct from autorizado_por
  ) then
    raise exception
      'E_MEDIA_AUTHORIZATION_ACTORS_NOT_RECONCILED';
  end if;

  if exists (
    select 1
    from public.autorizaciones_video
    where segundos_max::numeric
      is distinct from max_duracion_segundos
  ) then
    raise exception
      'E_MEDIA_AUTHORIZATION_DURATIONS_NOT_RECONCILED';
  end if;
end
$$;

commit;
