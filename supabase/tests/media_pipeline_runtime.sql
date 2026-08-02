-- TC-8166E-MT1-MEDIA-PIPELINE-LOCAL-01 · exact-head local runtime phases.
\set ON_ERROR_STOP on

\if :'phase' = 'setup'
select set_config('tc.media.image_bytes', :'image_bytes', false);
select set_config('tc.media.image_sha', :'image_sha', false);
select set_config('tc.media.video_bytes', :'video_bytes', false);
select set_config('tc.media.video_sha', :'video_sha', false);
select set_config('tc.media.image_request_hash', :'image_request_hash', false);
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('8166e000-0000-0000-0000-000000000001','authenticated','authenticated','media-runtime@example.invalid',now(),'{}','{}',now(),now());
insert into public.perfiles(id,rol,nombre,tema,activo)
values ('8166e000-0000-0000-0000-000000000001','admin','Media Runtime Admin','light',true);
insert into public.clientes(id,nombre,origen_registro)
values ('8166e111-1111-1111-1111-111111111111','Media Runtime Client','ticket_core');
insert into public.tickets(id,cliente_id,asignado_a,titulo,estado,prioridad,folio)
values
 ('8166e222-0000-0000-0000-000000000001','8166e111-1111-1111-1111-111111111111','8166e000-0000-0000-0000-000000000001','Media image E2E','abierto','media','MEDIA-E2E-IMG'),
 ('8166e222-0000-0000-0000-000000000002','8166e111-1111-1111-1111-111111111111','8166e000-0000-0000-0000-000000000001','Media video policy','abierto','media','MEDIA-E2E-VID');

select * from public.tc_claim_media_upload(
 '8166e222-0000-0000-0000-000000000001',null,
 '8166e222-0000-0000-0000-000000000001/runtime/original.png','original.png',
 'image/png','image/png','image',:'image_bytes',:'image_sha',null,'publica',
 'media-runtime-image-idem-0001',:'image_request_hash','interno','8166e000-0000-0000-0000-000000000001'
);

do $runtime_setup$
declare v_created boolean; v_count integer;
begin
  select created into v_created from public.tc_claim_media_upload(
   '8166e222-0000-0000-0000-000000000001',null,
   '8166e222-0000-0000-0000-000000000001/runtime/replay-must-not-win.png','original.png',
   'image/png','image/png','image',current_setting('tc.media.image_bytes')::bigint,current_setting('tc.media.image_sha'),null,'publica',
   'media-runtime-image-idem-0001',current_setting('tc.media.image_request_hash'),'interno','8166e000-0000-0000-0000-000000000001');
  if v_created then raise exception 'FAIL: idempotent replay created a row'; end if;
  select count(*) into v_count from public.adjuntos_ticket
   where ticket_id='8166e222-0000-0000-0000-000000000001';
  if v_count<>1 then raise exception 'FAIL: canonical row count %',v_count; end if;
  begin
    perform public.tc_claim_media_upload(
     '8166e222-0000-0000-0000-000000000001',null,
     '8166e222-0000-0000-0000-000000000001/runtime/reused.png','original.png',
     'image/png','image/png','image',current_setting('tc.media.image_bytes')::bigint,current_setting('tc.media.image_sha'),null,'publica',
     'media-runtime-image-idem-0001',repeat('f',64),'interno','8166e000-0000-0000-0000-000000000001');
    raise exception 'FAIL: reused idempotency key accepted';
  exception when others then
    if sqlerrm not like '%TC_IDEMPOTENCY_KEY_REUSED%' then raise; end if;
  end;
  raise notice 'PASS: canonical claim and idempotent replay';
end
$runtime_setup$;

select * from public.tc_claim_media_upload(
 '8166e222-0000-0000-0000-000000000002',null,
 '8166e222-0000-0000-0000-000000000002/runtime/video-one.mp4','video-one.mp4',
 'video/mp4','video/mp4','video',:'video_bytes',:'video_sha',15,'interna',
 'media-runtime-video-first-0001',:'video_request_hash','interno','8166e000-0000-0000-0000-000000000001'
);

do $second_without_auth$
begin
  begin
    perform public.tc_claim_media_upload(
     '8166e222-0000-0000-0000-000000000002',null,
     '8166e222-0000-0000-0000-000000000002/runtime/video-two-denied.mp4','video-two.mp4',
     'video/mp4','video/mp4','video',current_setting('tc.media.video_bytes')::bigint,current_setting('tc.media.video_sha'),15,'interna',
     'media-runtime-video-second-denied',repeat('a',64),'interno','8166e000-0000-0000-0000-000000000001');
    raise exception 'FAIL: second video accepted without authorization';
  exception when others then
    if sqlerrm not like '%MEDIA_VIDEO_AUTHORIZATION_REQUIRED%' then raise; end if;
  end;
  raise notice 'PASS: second video rejected without authorization';
end
$second_without_auth$;

insert into public.autorizaciones_video(
 id,ticket_id,max_duracion_segundos,permite_segundo_video,motivo,autorizado_por,expira_en
) values (
 '8166e333-0000-0000-0000-000000000001','8166e222-0000-0000-0000-000000000002',
 15,true,'TEST_ONLY_SECOND_VIDEO_AUTHORIZATION','8166e000-0000-0000-0000-000000000001',now()+interval '1 hour'
);
select * from public.tc_claim_media_upload(
 '8166e222-0000-0000-0000-000000000002',null,
 '8166e222-0000-0000-0000-000000000002/runtime/video-two.mp4','video-two.mp4',
 'video/mp4','video/mp4','video',:'video_bytes',:'video_sha',15,'interna',
 'media-runtime-video-second-0001',repeat('b',64),'interno','8166e000-0000-0000-0000-000000000001'
);

do $second_atomic_verify$
declare v_consumed integer;
begin
  select count(*) into v_consumed from public.autorizaciones_video
   where id='8166e333-0000-0000-0000-000000000001' and consumido_en is not null and consumido_por_adjunto is not null;
  if v_consumed<>1 then raise exception 'FAIL: authorization consumption count %',v_consumed; end if;
  begin
    perform public.tc_claim_media_upload(
     '8166e222-0000-0000-0000-000000000002',null,
     '8166e222-0000-0000-0000-000000000002/runtime/video-three.mp4','video-three.mp4',
     'video/mp4','video/mp4','video',current_setting('tc.media.video_bytes')::bigint,current_setting('tc.media.video_sha'),15,'interna',
     'media-runtime-video-third-0001',repeat('c',64),'interno','8166e000-0000-0000-0000-000000000001');
    raise exception 'FAIL: consumed authorization reused';
  exception when others then
    if sqlerrm not like '%MEDIA_VIDEO_AUTHORIZATION_REQUIRED%' then raise; end if;
  end;
  raise notice 'PASS: second video authorization consumed exactly once';
end
$second_atomic_verify$;

select public.tc_finalize_media_upload(
 (select id from public.adjuntos_ticket where idempotency_key='media-runtime-image-idem-0001'),
 :'image_request_hash'
);
\echo MEDIA_RUNTIME_SETUP=PASS
\endif

\if :'phase' = 'worker_complete'
insert into public.derivados_adjuntos(
 adjunto_id,tipo,storage_path,mime_type,tamano_bytes,checksum_sha256,source_checksum_sha256,ancho,alto
) values
 ((select id from public.adjuntos_ticket where idempotency_key='media-runtime-image-idem-0001'),'review_webp',:'review_path','image/webp',:'review_bytes',:'review_sha',:'image_sha',640,480),
 ((select id from public.adjuntos_ticket where idempotency_key='media-runtime-image-idem-0001'),'thumbnail_webp',:'thumb_path','image/webp',:'thumb_bytes',:'thumb_sha',:'image_sha',320,240);
select app_private.tc_complete_media_job(:'job_id',:'lease_token');
update public.adjuntos_ticket set estado='listo',actualizado_en=now()
 where idempotency_key='media-runtime-image-idem-0001' and checksum_sha256=:'image_sha';
\echo MEDIA_WORKER_DB_COMPLETE=PASS
\endif

\if :'phase' = 'retention'
insert into public.politicas_retencion_adjuntos(
 id,nombre,intervalo_retencion,referencia_aprobacion,aprobada_por
) values (
 '8166e444-0000-0000-0000-000000000001','TEST_ONLY_ONE_DAY',interval '1 day',
 'TEST_ONLY_NOT_A_PRODUCT_OR_LEGAL_POLICY','8166e000-0000-0000-0000-000000000001'
);
insert into public.retencion_adjuntos(adjunto_id,politica_id,retener_hasta,legal_hold,referencia_legal,establecido_por)
select id,'8166e444-0000-0000-0000-000000000001',now()+interval '1 day',true,
 'TEST_ONLY_LEGAL_HOLD','8166e000-0000-0000-0000-000000000001'
from public.adjuntos_ticket where idempotency_key='media-runtime-image-idem-0001';
do $retention_checks$
declare v_id uuid;
begin
  select id into v_id from public.adjuntos_ticket where idempotency_key='media-runtime-image-idem-0001';
  begin perform public.tc_prepare_media_delete(v_id); raise exception 'FAIL: legal hold delete accepted';
  exception when others then if sqlerrm not like '%MEDIA_DELETE_LEGAL_HOLD%' then raise; end if; end;
  update public.retencion_adjuntos set legal_hold=false,referencia_legal=null where adjunto_id=v_id;
  begin perform public.tc_prepare_media_delete(v_id); raise exception 'FAIL: retained delete accepted';
  exception when others then if sqlerrm not like '%MEDIA_DELETE_RETENTION_ACTIVE%' then raise; end if; end;
  update public.retencion_adjuntos set retener_hasta=now()-interval '1 second' where adjunto_id=v_id;
  raise notice 'PASS: legal hold and retention block deletion';
end
$retention_checks$;
\echo MEDIA_RETENTION_RUNTIME=PASS
\endif

\if :'phase' = 'teardown'
delete from public.tickets where id in ('8166e222-0000-0000-0000-000000000001','8166e222-0000-0000-0000-000000000002');
delete from public.politicas_retencion_adjuntos where id='8166e444-0000-0000-0000-000000000001';
delete from public.clientes where id='8166e111-1111-1111-1111-111111111111';
delete from public.perfiles where id='8166e000-0000-0000-0000-000000000001';
delete from auth.users where id='8166e000-0000-0000-0000-000000000001';
do $residuals$
declare v_rows bigint;
begin
  select
    (select count(*) from public.tickets where id::text like '8166e222-%')+
    (select count(*) from public.adjuntos_ticket where ticket_id::text like '8166e222-%')+
    (select count(*) from public.autorizaciones_video where ticket_id::text like '8166e222-%')+
    (select count(*) from auth.users where id='8166e000-0000-0000-0000-000000000001')
  into v_rows;
  if v_rows<>0 then raise exception 'FAIL: residual rows %',v_rows; end if;
  raise notice 'PASS: residual rows zero';
end
$residuals$;
\echo MEDIA_ROLLBACK=PASS
\endif
