\set ON_ERROR_STOP on

delete from public.media_video_registro
where ticket_id =
  :'ticket_id'::uuid;

delete from public.autorizaciones_video
where ticket_id =
  :'ticket_id'::uuid;

-- Test-only synthetic fixture cleanup.

delete from public.tickets
where id = :'ticket_id'::uuid
  and titulo = 'TC Media Video Runtime Fixture';

delete from public.perfiles
where id = :'actor_id'::uuid
  and exists (
    select 1
    from auth.users u
    where u.id = :'actor_id'::uuid
      and u.raw_user_meta_data
        ->> 'fixture' =
        'tc-media-video-runtime'
  );

delete from auth.users
where id = :'actor_id'::uuid
  and raw_user_meta_data
    ->> 'fixture' =
    'tc-media-video-runtime';
