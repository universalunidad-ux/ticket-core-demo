begin;

create or replace function public.tc_public_support_notices(
  p_limit integer default 5
)
returns table (
  id uuid,
  titulo text,
  contenido text,
  tipo text,
  prioridad integer,
  starts_at timestamptz,
  ends_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    aviso.id,
    aviso.titulo,
    aviso.contenido,
    aviso.tipo,
    aviso.prioridad,
    aviso.starts_at,
    aviso.ends_at
  from public.avisos_globales as aviso
  where aviso.activo is true
    and aviso.mostrar_en_soporte is true
    and (
      aviso.starts_at is null
      or aviso.starts_at <= pg_catalog.now()
    )
    and (
      aviso.ends_at is null
      or aviso.ends_at > pg_catalog.now()
    )
  order by
    aviso.prioridad asc,
    aviso.created_at desc,
    aviso.id asc
  limit (
    case
      when p_limit is null then 5
      when p_limit < 1 then 1
      when p_limit > 20 then 20
      else p_limit
    end
  );
$function$;

comment on function public.tc_public_support_notices(integer)
is
  'Returns only active, currently effective notices explicitly enabled for the public support surface.';

revoke all
on function public.tc_public_support_notices(integer)
from public;

revoke all
on function public.tc_public_support_notices(integer)
from anon, authenticated;

grant execute
on function public.tc_public_support_notices(integer)
to anon, authenticated, service_role;

commit;
