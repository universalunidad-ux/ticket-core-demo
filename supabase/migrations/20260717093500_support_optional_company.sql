-- U-support · solicitudes_soporte.empresa opcional (consolida borrador TC-P0).
-- PREPARED_NOT_APPLIED. Idempotente y guardado.
do $$
declare current_nullable text;
begin
  select c.is_nullable into current_nullable
  from information_schema.columns c
  where c.table_schema='public' and c.table_name='solicitudes_soporte' and c.column_name='empresa';
  if current_nullable is null then
    raise exception 'public.solicitudes_soporte.empresa no existe';
  end if;
  if current_nullable = 'NO' then
    alter table public.solicitudes_soporte alter column empresa drop not null;
  end if;
end $$;
comment on column public.solicitudes_soporte.empresa is
  'Empresa/negocio declarado por la persona solicitante; puede ser NULL cuando no fue informado.';
