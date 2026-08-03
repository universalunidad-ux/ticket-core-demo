\set ON_ERROR_STOP on

delete from public.media_video_registro
where ticket_id =
  '10000000-0000-0000-0000-0000000000aa';

delete from public.autorizaciones_video
where ticket_id =
  '10000000-0000-0000-0000-0000000000aa';
