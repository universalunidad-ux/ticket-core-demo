\set ON_ERROR_STOP on

select set_config(
  'request.jwt.claims',
  '{"role":"service_role","app_role":"service_role","sub":"00000000-0000-0000-0000-000000000001"}',
  false
);

delete from public.media_video_registro
where ticket_id =
  '10000000-0000-0000-0000-0000000000aa';

delete from public.autorizaciones_video
where ticket_id =
  '10000000-0000-0000-0000-0000000000aa';

select public.tc_media_otorgar_autorizacion(
  '10000000-0000-0000-0000-0000000000aa',
  'segundo_video_15s',
  clock_timestamp() + interval '1 hour',
  'runtime concurrent consumption'
);

do $$
begin
  if (
    select count(*)
    from public.autorizaciones_video
    where ticket_id =
      '10000000-0000-0000-0000-0000000000aa'
      and tipo = 'segundo_video_15s'
      and consumida_en is null
  ) <> 1 then
    raise exception 'FAIL MEDIA-011 concurrency setup';
  end if;

  raise notice 'PASS MEDIA-VIDEO-CONCURRENCY setup';
end
$$;
