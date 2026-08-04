\set ON_ERROR_STOP on

begin;

select set_config(
  'tc.fixture_actor_id',
  :'actor_id',
  false
);

select set_config(
  'tc.fixture_ticket_id',
  :'ticket_id',
  false
);

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values (
  null,
  current_setting('tc.fixture_actor_id')::uuid,
  'authenticated',
  'authenticated',
  'tc-media-runtime@local.invalid',
  '',
  clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{
    "fixture":"tc-media-video-runtime",
    "nombre":"TC Media Runtime"
  }'::jsonb,
  clock_timestamp(),
  clock_timestamp()
)
on conflict do nothing;

do $fixture$
declare
  v_actor_id uuid :=
    current_setting('tc.fixture_actor_id')::uuid;

  v_role text;
  v_created boolean := false;
begin
  if exists (
    select 1
    from public.perfiles
    where id = v_actor_id
  ) then
    return;
  end if;

  foreach v_role in array array[
    'admin',
    'agente',
    'supervisor',
    'soporte',
    'usuario'
  ]
  loop
    begin
      insert into public.perfiles (
        id,
        nombre,
        rol,
        activo
      )
      values (
        v_actor_id,
        'TC Media Runtime',
        v_role,
        true
      )
      on conflict (id) do nothing;

      if exists (
        select 1
        from public.perfiles
        where id = v_actor_id
      ) then
        v_created := true;
        exit;
      end if;

    exception
      when check_violation then
        null;
    end;
  end loop;

  if not v_created then
    raise exception
      'E_MEDIA_LOCAL_FIXTURE_PROFILE_NOT_CREATED';
  end if;
end
$fixture$;

insert into public.tickets (
  id,
  titulo
)
values (
  current_setting('tc.fixture_ticket_id')::uuid,
  'TC Media Video Runtime Fixture'
)
on conflict (id) do update
set titulo = excluded.titulo;

do $fixture$
declare
  v_actor_id uuid :=
    current_setting('tc.fixture_actor_id')::uuid;

  v_ticket_id uuid :=
    current_setting('tc.fixture_ticket_id')::uuid;
begin
  if not exists (
    select 1
    from auth.users
    where id = v_actor_id
  ) then
    raise exception
      'E_MEDIA_LOCAL_FIXTURE_AUTH_USER_MISSING';
  end if;

  if not exists (
    select 1
    from public.perfiles
    where id = v_actor_id
  ) then
    raise exception
      'E_MEDIA_LOCAL_FIXTURE_PROFILE_MISSING';
  end if;

  if not exists (
    select 1
    from public.tickets
    where id = v_ticket_id
  ) then
    raise exception
      'E_MEDIA_LOCAL_FIXTURE_TICKET_MISSING';
  end if;
end
$fixture$;

commit;

select
  current_setting('tc.fixture_ticket_id')::uuid
    as fixture_ticket_id,
  current_setting('tc.fixture_actor_id')::uuid
    as fixture_actor_id,
  (
    select count(*)
    from public.tickets
    where id =
      current_setting('tc.fixture_ticket_id')::uuid
  ) as ticket_count,
  (
    select count(*)
    from public.perfiles
    where id =
      current_setting('tc.fixture_actor_id')::uuid
  ) as profile_count;
