\set ON_ERROR_STOP on

select set_config(
  'request.jwt.claims',
  '{"role":"service_role","app_role":"service_role","sub":"00000000-0000-0000-0000-000000000001"}',
  false
);

create or replace function pg_temp.assert_true(
  p_condition boolean,
  p_message text
)
returns void
language plpgsql
as $$
begin
  if coalesce(p_condition, false) is not true then
    raise exception 'FAIL %', p_message;
  end if;
end;
$$;

create or replace function pg_temp.expect_error(
  p_command text,
  p_expected_message text
)
returns void
language plpgsql
as $$
declare
  v_seen boolean := false;
begin
  begin
    execute p_command;
  exception
    when others then
      if SQLERRM <> p_expected_message then
        raise;
      end if;

      v_seen := true;
  end;

  if not v_seen then
    raise exception
      'FAIL expected error was not raised: %',
      p_expected_message;
  end if;
end;
$$;

delete from public.media_video_registro
where ticket_id::text like
  '10000000-0000-0000-0000-0000000000%';

delete from public.autorizaciones_video
where ticket_id::text like
  '10000000-0000-0000-0000-0000000000%';

-- 1. Primer video de 10 segundos.
do $$
declare
  v_result jsonb;
begin
  select public.tc_media_validar_duracion(
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    10000
  )
  into v_result;

  perform pg_temp.assert_true(
    (v_result ->> 'accepted')::boolean,
    'MEDIA-010 case 1 accepted'
  );

  perform pg_temp.assert_true(
    (v_result ->> 'server_video_ordinal')::integer = 1,
    'MEDIA-010 case 1 ordinal'
  );

  raise notice 'PASS MEDIA-VIDEO-MATRIX case=1';
end
$$;

-- 2. Primer video de 20 segundos sin excepción.
select pg_temp.expect_error(
  $command$
    select public.tc_media_validar_duracion(
      '10000000-0000-0000-0000-000000000002',
      '20000000-0000-0000-0000-000000000002',
      20000
    )
  $command$,
  'E_MEDIA_AUTORIZACION_NO_DISPONIBLE'
);

do $$
begin
  perform pg_temp.assert_true(
    not exists (
      select 1
      from public.media_video_registro
      where ticket_id =
        '10000000-0000-0000-0000-000000000002'
    ),
    'MEDIA-012 case 2 registry residue'
  );

  raise notice 'PASS MEDIA-VIDEO-MATRIX case=2';
end
$$;

-- 3. Más de 30 segundos siempre se rechaza.
select pg_temp.expect_error(
  $command$
    select public.tc_media_validar_duracion(
      '10000000-0000-0000-0000-000000000003',
      '20000000-0000-0000-0000-000000000003',
      31000
    )
  $command$,
  'E_MEDIA_DURACION_EXCEDIDA'
);

do $$
begin
  raise notice 'PASS MEDIA-VIDEO-MATRIX case=3';
end
$$;

-- 4. Segundo video sin autorización.
select public.tc_media_validar_duracion(
  '10000000-0000-0000-0000-000000000004',
  '20000000-0000-0000-0000-000000000004',
  10000
);

select pg_temp.expect_error(
  $command$
    select public.tc_media_validar_duracion(
      '10000000-0000-0000-0000-000000000004',
      '20000000-0000-0000-0000-000000000104',
      10000
    )
  $command$,
  'E_MEDIA_AUTORIZACION_NO_DISPONIBLE'
);

do $$
begin
  perform pg_temp.assert_true(
    (
      select count(*)
      from public.media_video_registro
      where ticket_id =
        '10000000-0000-0000-0000-000000000004'
    ) = 1,
    'MEDIA-011 case 4 registry count'
  );

  raise notice 'PASS MEDIA-VIDEO-MATRIX case=4';
end
$$;

-- 5. Segundo video con autorización de 15 segundos.
select public.tc_media_validar_duracion(
  '10000000-0000-0000-0000-000000000005',
  '20000000-0000-0000-0000-000000000005',
  10000
);

select public.tc_media_otorgar_autorizacion(
  '10000000-0000-0000-0000-000000000005',
  'segundo_video_15s',
  clock_timestamp() + interval '1 hour',
  'runtime second video'
);

select public.tc_media_validar_duracion(
  '10000000-0000-0000-0000-000000000005',
  '20000000-0000-0000-0000-000000000105',
  10000
);

do $$
begin
  perform pg_temp.assert_true(
    (
      select count(*)
      from public.media_video_registro
      where ticket_id =
        '10000000-0000-0000-0000-000000000005'
    ) = 2,
    'MEDIA-011 case 5 registry count'
  );

  perform pg_temp.assert_true(
    (
      select count(*)
      from public.autorizaciones_video
      where ticket_id =
        '10000000-0000-0000-0000-000000000005'
        and tipo = 'segundo_video_15s'
        and consumida_en is not null
        and consumida_por_adjunto_id =
          '20000000-0000-0000-0000-000000000105'
    ) = 1,
    'MEDIA-011 case 5 consumed authorization'
  );

  raise notice 'PASS MEDIA-VIDEO-MATRIX case=5';
end
$$;

-- 6. Primer video de 20 segundos con excepción de 30.
select public.tc_media_otorgar_autorizacion(
  '10000000-0000-0000-0000-000000000006',
  'excepcion_30s',
  clock_timestamp() + interval '1 hour',
  'runtime duration exception'
);

do $$
declare
  v_result jsonb;
begin
  select public.tc_media_validar_duracion(
    '10000000-0000-0000-0000-000000000006',
    '20000000-0000-0000-0000-000000000006',
    20000
  )
  into v_result;

  perform pg_temp.assert_true(
    (v_result ->> 'maximum_duration_ms')::integer = 30000,
    'MEDIA-012 case 6 maximum'
  );

  raise notice 'PASS MEDIA-VIDEO-MATRIX case=6';
end
$$;

-- 7. Segundo video de 20 segundos con sólo autorización de segundo video.
-- La excepción debe revertir el consumo parcial.
select public.tc_media_validar_duracion(
  '10000000-0000-0000-0000-000000000007',
  '20000000-0000-0000-0000-000000000007',
  10000
);

select public.tc_media_otorgar_autorizacion(
  '10000000-0000-0000-0000-000000000007',
  'segundo_video_15s',
  clock_timestamp() + interval '1 hour',
  'runtime rollback'
);

select pg_temp.expect_error(
  $command$
    select public.tc_media_validar_duracion(
      '10000000-0000-0000-0000-000000000007',
      '20000000-0000-0000-0000-000000000107',
      20000
    )
  $command$,
  'E_MEDIA_AUTORIZACION_NO_DISPONIBLE'
);

do $$
begin
  perform pg_temp.assert_true(
    (
      select count(*)
      from public.autorizaciones_video
      where ticket_id =
        '10000000-0000-0000-0000-000000000007'
        and tipo = 'segundo_video_15s'
        and consumida_en is null
    ) = 1,
    'MEDIA-011 case 7 rollback authorization'
  );

  perform pg_temp.assert_true(
    (
      select count(*)
      from public.media_video_registro
      where ticket_id =
        '10000000-0000-0000-0000-000000000007'
    ) = 1,
    'MEDIA-012 case 7 rollback registry'
  );

  raise notice 'PASS MEDIA-VIDEO-MATRIX case=7';
end
$$;

-- 8. Segundo video de 20 segundos con ambas autorizaciones.
select public.tc_media_validar_duracion(
  '10000000-0000-0000-0000-000000000008',
  '20000000-0000-0000-0000-000000000008',
  10000
);

select public.tc_media_otorgar_autorizacion(
  '10000000-0000-0000-0000-000000000008',
  'segundo_video_15s',
  clock_timestamp() + interval '1 hour',
  'runtime second video'
);

select public.tc_media_otorgar_autorizacion(
  '10000000-0000-0000-0000-000000000008',
  'excepcion_30s',
  clock_timestamp() + interval '1 hour',
  'runtime duration exception'
);

select public.tc_media_validar_duracion(
  '10000000-0000-0000-0000-000000000008',
  '20000000-0000-0000-0000-000000000108',
  20000
);

do $$
begin
  perform pg_temp.assert_true(
    (
      select count(*)
      from public.autorizaciones_video
      where ticket_id =
        '10000000-0000-0000-0000-000000000008'
        and consumida_en is not null
        and consumida_por_adjunto_id =
          '20000000-0000-0000-0000-000000000108'
    ) = 2,
    'MEDIA-011/012 case 8 authorizations'
  );

  perform pg_temp.assert_true(
    (
      select count(*)
      from public.media_video_registro
      where ticket_id =
        '10000000-0000-0000-0000-000000000008'
    ) = 2,
    'MEDIA-011/012 case 8 registry'
  );

  raise notice 'PASS MEDIA-VIDEO-MATRIX case=8';
end
$$;

-- 9. Segundo video de 31 segundos con ambas autorizaciones.
-- Debe rechazarse antes de consumirlas.
select public.tc_media_validar_duracion(
  '10000000-0000-0000-0000-000000000009',
  '20000000-0000-0000-0000-000000000009',
  10000
);

select public.tc_media_otorgar_autorizacion(
  '10000000-0000-0000-0000-000000000009',
  'segundo_video_15s',
  clock_timestamp() + interval '1 hour',
  'runtime 31 second rejection'
);

select public.tc_media_otorgar_autorizacion(
  '10000000-0000-0000-0000-000000000009',
  'excepcion_30s',
  clock_timestamp() + interval '1 hour',
  'runtime 31 second rejection'
);

select pg_temp.expect_error(
  $command$
    select public.tc_media_validar_duracion(
      '10000000-0000-0000-0000-000000000009',
      '20000000-0000-0000-0000-000000000109',
      31000
    )
  $command$,
  'E_MEDIA_DURACION_EXCEDIDA'
);

do $$
begin
  perform pg_temp.assert_true(
    (
      select count(*)
      from public.autorizaciones_video
      where ticket_id =
        '10000000-0000-0000-0000-000000000009'
        and consumida_en is null
    ) = 2,
    'MEDIA-012 case 9 authorization residue'
  );

  perform pg_temp.assert_true(
    (
      select count(*)
      from public.media_video_registro
      where ticket_id =
        '10000000-0000-0000-0000-000000000009'
    ) = 1,
    'MEDIA-012 case 9 registry residue'
  );

  raise notice 'PASS MEDIA-VIDEO-MATRIX case=9';
end
$$;

delete from public.media_video_registro
where ticket_id::text like
  '10000000-0000-0000-0000-0000000000%';

delete from public.autorizaciones_video
where ticket_id::text like
  '10000000-0000-0000-0000-0000000000%';
