\set ON_ERROR_STOP on

delete from public.media_video_registro
where ticket_id =
  :'ticket_id'::uuid;

delete from public.autorizaciones_video
where ticket_id =
  :'ticket_id'::uuid;
