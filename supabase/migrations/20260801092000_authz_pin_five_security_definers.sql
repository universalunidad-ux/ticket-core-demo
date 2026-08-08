begin;

-- Pin deterministic search paths on five canonical SECURITY DEFINER
-- functions discovered by the local runtime security inventory.
--
-- No function body is replaced.
-- Existing explicit grants remain untouched.
-- Only implicit PUBLIC/anon execution is revoked.

alter function public.claim_mail_outbox(uuid, integer)
  set search_path = pg_catalog, public;

revoke execute on function
  public.claim_mail_outbox(uuid, integer)
  from public;

revoke execute on function
  public.claim_mail_outbox(uuid, integer)
  from anon;

alter function public.finish_mail_outbox(uuid, uuid, text, text)
  set search_path = pg_catalog, public;

revoke execute on function
  public.finish_mail_outbox(uuid, uuid, text, text)
  from public;

revoke execute on function
  public.finish_mail_outbox(uuid, uuid, text, text)
  from anon;

alter function public.record_client_error(
  text,
  text,
  text,
  text,
  text,
  text,
  uuid,
  jsonb
)
  set search_path = pg_catalog, public;

revoke execute on function
  public.record_client_error(
    text,
    text,
    text,
    text,
    text,
    text,
    uuid,
    jsonb
  )
  from public;

revoke execute on function
  public.record_client_error(
    text,
    text,
    text,
    text,
    text,
    text,
    uuid,
    jsonb
  )
  from anon;

alter function public.system_health_snapshot()
  set search_path = pg_catalog, public;

revoke execute on function
  public.system_health_snapshot()
  from public;

revoke execute on function
  public.system_health_snapshot()
  from anon;

alter function public.tc_current_client_id()
  set search_path = pg_catalog, public;

revoke execute on function
  public.tc_current_client_id()
  from public;

revoke execute on function
  public.tc_current_client_id()
  from anon;

commit;
