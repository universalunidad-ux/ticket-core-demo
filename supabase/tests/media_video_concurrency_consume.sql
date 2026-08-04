\set ON_ERROR_STOP on

select public.tc_media_consumir_autorizacion(
  :'ticket_id'::uuid,
  :'adjunto_id'::uuid,
  'segundo_video_15s'
);
