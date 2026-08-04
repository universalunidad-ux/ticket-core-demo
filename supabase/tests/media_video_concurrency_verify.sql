select set_config(
  'tc.fixture_ticket_id',
  :'ticket_id',
  false
);

\set ON_ERROR_STOP on

do $$
begin
  if (
    select count(*)
    from public.autorizaciones_video
    where ticket_id =
      current_setting('tc.fixture_ticket_id')::uuid
      and tipo = 'segundo_video_15s'
  ) <> 1 then
    raise exception 'FAIL MEDIA-011 concurrency total';
  end if;

  if (
    select count(*)
    from public.autorizaciones_video
    where ticket_id =
      current_setting('tc.fixture_ticket_id')::uuid
      and tipo = 'segundo_video_15s'
      and consumida_en is not null
      and consumida_por_adjunto_id in (
        '20000000-0000-0000-0000-0000000000a1',
        '20000000-0000-0000-0000-0000000000a2',
        '20000000-0000-0000-0000-0000000000a3',
        '20000000-0000-0000-0000-0000000000a4',
        '20000000-0000-0000-0000-0000000000a5',
        '20000000-0000-0000-0000-0000000000a6',
        '20000000-0000-0000-0000-0000000000a7',
        '20000000-0000-0000-0000-0000000000a8',
        '20000000-0000-0000-0000-0000000000a9',
        '20000000-0000-0000-0000-0000000000aa'
      )
  ) <> 1 then
    raise exception
      'FAIL MEDIA-011 exact10 not exactly one consumer';
  end if;

  raise notice 'PASS MEDIA-VIDEO-CONCURRENCY verify';
end
$$;
