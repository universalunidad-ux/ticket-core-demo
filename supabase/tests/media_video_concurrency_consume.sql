\set ON_ERROR_STOP on

-- Barrera temporal común: evita que la prueba sea sólo una
-- secuencia rápida de llamadas y fuerza solapamiento real.
select pg_sleep(
  greatest(
    0,
    extract(
      epoch from (
        :'start_at'::timestamptz
        - clock_timestamp()
      )
    )
  )::double precision
);

select public.tc_media_consumir_autorizacion(
  :'ticket_id'::uuid,
  :'adjunto_id'::uuid,
  'segundo_video_15s'
);
