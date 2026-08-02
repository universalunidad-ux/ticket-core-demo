-- TC-DE8A4DC-MT1-CLAIM-UPLOAD-AMBIGUITY-REPAIR-01
-- Executes the canonical claim and an intentionally ambiguous mutant in local Postgres.
\set ON_ERROR_STOP on

begin;

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('de8a4dc0-0000-0000-0000-000000000001','authenticated','authenticated','claim-targeted@example.invalid',now(),'{}','{}',now(),now());
insert into public.perfiles(id,rol,nombre,tema,activo)
values ('de8a4dc0-0000-0000-0000-000000000001','admin','Claim Targeted Admin','light',true);
insert into public.clientes(id,nombre,origen_registro)
values ('de8a4dc1-1111-1111-1111-111111111111','Claim Targeted Client','ticket_core');
insert into public.tickets(id,cliente_id,asignado_a,titulo,estado,prioridad,folio)
values (
  'de8a4dc2-2222-2222-2222-222222222222',
  'de8a4dc1-1111-1111-1111-111111111111',
  'de8a4dc0-0000-0000-0000-000000000001',
  'Canonical claim targeted',
  'abierto',
  'media',
  'MEDIA-CLAIM-TARGETED'
);

do $canonical_claim$
declare
  v_first record;
  v_second record;
  v_attachment_count integer;
  v_job_count integer;
begin
  select * into v_first from public.tc_claim_media_upload(
    'de8a4dc2-2222-2222-2222-222222222222', null,
    'de8a4dc2-2222-2222-2222-222222222222/targeted/original.png', 'original.png',
    'image/png', 'image/png', 'image', 128, repeat('a', 64), null, 'interna',
    'media-claim-targeted-idem-0001', repeat('b', 64), 'interno',
    'de8a4dc0-0000-0000-0000-000000000001'
  );
  select * into v_second from public.tc_claim_media_upload(
    'de8a4dc2-2222-2222-2222-222222222222', null,
    'de8a4dc2-2222-2222-2222-222222222222/targeted/replay.png', 'original.png',
    'image/png', 'image/png', 'image', 128, repeat('a', 64), null, 'interna',
    'media-claim-targeted-idem-0001', repeat('b', 64), 'interno',
    'de8a4dc0-0000-0000-0000-000000000001'
  );

  if v_first.created is not true or v_second.created is not false then
    raise exception 'FAIL: canonical claim creation flags %, %', v_first.created, v_second.created;
  end if;
  if v_first.adjunto_id is distinct from v_second.adjunto_id then
    raise exception 'FAIL: equivalent claims returned different attachments';
  end if;

  select count(*) into v_attachment_count
  from public.adjuntos_ticket as attachment
  where attachment.ticket_id = 'de8a4dc2-2222-2222-2222-222222222222'
    and attachment.idempotency_key = 'media-claim-targeted-idem-0001';
  select count(*) into v_job_count
  from public.trabajos_adjuntos as queued_job
  where queued_job.adjunto_id = v_first.adjunto_id;

  if v_attachment_count <> 1 or v_job_count <> 1 then
    raise exception 'FAIL: claim cardinality attachments=%, jobs=%', v_attachment_count, v_job_count;
  end if;
  raise notice 'PASS: canonical claim is exactly once and unambiguous';
end
$canonical_claim$;

create function pg_temp.tc_claim_media_upload_conflict_mutant(
  p_adjunto_id uuid,
  p_checksum_sha256 text
)
returns table(adjunto_id uuid)
language plpgsql
as $mutant$
begin
  insert into public.trabajos_adjuntos(adjunto_id, tipo, source_checksum_sha256)
  values (p_adjunto_id, 'procesar_imagen', p_checksum_sha256)
  on conflict (adjunto_id, tipo, version, source_checksum_sha256) do nothing;
  return query select p_adjunto_id;
end
$mutant$;

do $kill_mutant$
begin
  begin
    perform * from pg_temp.tc_claim_media_upload_conflict_mutant(
      (select attachment.id from public.adjuntos_ticket as attachment
       where attachment.idempotency_key = 'media-claim-targeted-idem-0001'),
      repeat('a', 64)
    );
    raise exception 'FAIL: ambiguous conflict-target mutant survived';
  exception
    when ambiguous_column then
      if position('adjunto_id' in sqlerrm) = 0 then raise; end if;
      raise notice 'PASS: ambiguous adjunto_id mutant killed';
  end;
end
$kill_mutant$;

rollback;
\echo MEDIA_CLAIM_UPLOAD_POSTGRES_TARGETED=PASS
\echo MEDIA_CLAIM_UPLOAD_IDEMPOTENCY=PASS
\echo MEDIA_CLAIM_UPLOAD_AMBIGUITY_MUTANT_KILLED=YES
