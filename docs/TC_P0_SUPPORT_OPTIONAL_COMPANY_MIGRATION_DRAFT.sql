-- TC-P0-SUPPORT-OPTIONAL-COMPANY
-- REVIEW-ONLY DRAFT. DO NOT APPLY FROM THIS WORKTREE.
-- Prerequisite: deploy this schema change before deploying the patched Edge Function.

begin;

do $$
declare
  current_nullable text;
begin
  select c.is_nullable
    into current_nullable
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'solicitudes_soporte'
    and c.column_name = 'empresa';

  if current_nullable is null then
    raise exception 'TC_P0_SUPPORT_COMPANY: public.solicitudes_soporte.empresa does not exist';
  end if;

  if current_nullable = 'NO' then
    alter table public.solicitudes_soporte
      alter column empresa drop not null;
  end if;
end
$$;

comment on column public.solicitudes_soporte.empresa is
  'Empresa o negocio declarado por la persona solicitante; puede ser NULL cuando no fue informado.';

commit;

-- Review-only verification:
-- select is_nullable
-- from information_schema.columns
-- where table_schema = 'public'
--   and table_name = 'solicitudes_soporte'
--   and column_name = 'empresa';
--
-- Expected after deployment: YES.
--
-- Rollback prerequisite (must return 0 before SET NOT NULL):
-- select count(*) from public.solicitudes_soporte where empresa is null;
--
-- Rollback DDL, only after deciding how to handle existing NULL rows:
-- alter table public.solicitudes_soporte alter column empresa set not null;
