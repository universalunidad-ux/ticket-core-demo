\set ON_ERROR_STOP on

do $$
begin
  if (
    select count(*)
    from public.autorizaciones_video
    where ticket_id =
      '10000000-0000-0000-0000-0000000000aa'
      and tipo = 'segundo_video_15s'
  ) <> 1 then
    raise exception 'FAIL MEDIA-011 concurrency total';
  end if;

  if (
    select count(*)
    from public.autorizaciones_video
    where ticket_id =
      '10000000-0000-0000-0000-0000000000aa'
      and tipo = 'segundo_video_15s'
      and consumida_en is not null
      and consumida_por_adjunto_id in (
        '20000000-0000-0000-0000-0000000000a1',
        '20000000-0000-0000-0000-0000000000a2'
      )
  ) <> 1 then
    raise exception
      'FAIL MEDIA-011 concurrency not exactly one consumer';
  end if;

  raise notice 'PASS MEDIA-VIDEO-CONCURRENCY verify';
end
$$;
