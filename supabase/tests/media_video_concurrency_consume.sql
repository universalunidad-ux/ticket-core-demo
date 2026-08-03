\set ON_ERROR_STOP on

select public.tc_media_consumir_autorizacion(
  '10000000-0000-0000-0000-0000000000aa',
  :'adjunto_id'::uuid,
  'segundo_video_15s'
);
