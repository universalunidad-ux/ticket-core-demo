-- TC-APP-PRIVATE-ACL-RECONCILIATION-01
-- PREPARED_NOT_APPLIED
-- DO_NOT_APPLY_WITHOUT_STAGING_REVIEW
--
-- Migración compensatoria posterior a
--   20260724080000_tc_fix_role_escalation_guard.sql
--
-- Problema (VALIDADO EN VIVO por el harness):
--   `authenticated` tiene INSERT sobre ticket_eventos / bitacora / archivos_ticket
--   y INSERT/UPDATE/DELETE sobre avisos_globales (migración 20260717094000), pero
--   los CHECK constraints de esas tablas invocan helpers IMMUTABLE de app_private
--   cuyo EXECUTE sólo estaba concedido a service_role (baseline 20260715023815).
--   Como un CHECK se evalúa con los privilegios del rol que ejecuta el DML, el
--   INSERT falla con `permission denied for function ...` (SQLSTATE 42501).
--
-- Helpers cubiertos por DML autenticado directo (vía CHECK constraint):
--   * app_private.plain_text_is_safe(text, integer)  -> avisos_globales.titulo/contenido
--   * app_private.ticket_event_meta_is_safe(jsonb)    -> ticket_eventos.meta
--   * app_private.audit_detail_is_safe(jsonb)         -> ticket_eventos.detalle,
--                                                        bitacora.detalle,
--                                                        archivos_ticket.meta
--
-- NO cubierto (se mantiene service_role-only, sin cambios):
--   * app_private.normalized_text(text) -> sólo aparece en columnas GENERATED de
--     clientes / cliente_aliases, tablas sobre las que `authenticated` sólo tiene
--     SELECT (nunca evalúa la expresión generada). Concederlo sería sobre-otorgar.
--
-- Esta migración NO toca cuerpos de función, constraints, policies ni grants de
-- tabla. Sólo reconcilia la ACL EXECUTE de tres helpers y verifica el estado final.
-- No usa GRANT EXECUTE ON ALL FUNCTIONS.

begin;

-- ---------------------------------------------------------------------------
-- 1) Guarda de identidad / naturaleza: los helpers seleccionados deben seguir
--    siendo IMMUTABLE, SECURITY INVOKER y conservar su identidad exacta.
--    Si algo cambió (owner-confusion, redefinición a definer, volatilidad),
--    fail-closed antes de conceder cualquier privilegio.
-- ---------------------------------------------------------------------------
do $guard_identity$
declare
  v_signature text;
  v_fn        pg_catalog.regprocedure;
  v_volatile  "char";
  v_secdef    boolean;
begin
  foreach v_signature in array array[
    'app_private.plain_text_is_safe(text,integer)',
    'app_private.ticket_event_meta_is_safe(jsonb)',
    'app_private.audit_detail_is_safe(jsonb)'
  ]
  loop
    v_fn := pg_catalog.to_regprocedure(v_signature);

    if v_fn is null then
      raise exception 'TC_ACL_HELPER_MISSING: %', v_signature
        using errcode = '42883';
    end if;

    select p.provolatile, p.prosecdef
      into v_volatile, v_secdef
      from pg_catalog.pg_proc p
      where p.oid = v_fn;

    if v_volatile is distinct from 'i' then
      raise exception 'TC_ACL_HELPER_NOT_IMMUTABLE: % (provolatile=%)',
        v_signature, v_volatile
        using errcode = '55000';
    end if;

    if coalesce(v_secdef, false) then
      raise exception 'TC_ACL_HELPER_NOT_SECURITY_INVOKER: %', v_signature
        using errcode = '42501';
    end if;
  end loop;
end
$guard_identity$;

-- ---------------------------------------------------------------------------
-- 2) Reafirmar que PUBLIC y anon permanecen revocados (idempotente / anti-drift)
--    y conceder EXECUTE únicamente a authenticated. service_role conserva su
--    grant baseline: no se toca.
-- ---------------------------------------------------------------------------
revoke execute on function app_private.plain_text_is_safe(text, integer) from public, anon;
revoke execute on function app_private.ticket_event_meta_is_safe(jsonb)  from public, anon;
revoke execute on function app_private.audit_detail_is_safe(jsonb)       from public, anon;

grant execute on function app_private.plain_text_is_safe(text, integer) to authenticated;
grant execute on function app_private.ticket_event_meta_is_safe(jsonb)  to authenticated;
grant execute on function app_private.audit_detail_is_safe(jsonb)       to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Verificación fail-closed de la ACL final con has_function_privilege.
--    Estado esperado por helper concedido:
--      authenticated EXECUTE = true ; service_role EXECUTE = true ;
--      anon EXECUTE = false ; PUBLIC EXECUTE = false (grantee 0 en proacl).
--    Además: normalized_text NO debe quedar ejecutable por authenticated.
-- ---------------------------------------------------------------------------
do $verify_acl$
declare
  v_signature   text;
  v_fn          pg_catalog.regprocedure;
  v_public_exec boolean;
begin
  foreach v_signature in array array[
    'app_private.plain_text_is_safe(text,integer)',
    'app_private.ticket_event_meta_is_safe(jsonb)',
    'app_private.audit_detail_is_safe(jsonb)'
  ]
  loop
    v_fn := pg_catalog.to_regprocedure(v_signature);

    if not pg_catalog.has_function_privilege('authenticated', v_fn::oid, 'EXECUTE') then
      raise exception 'TC_ACL_VERIFY_AUTHENTICATED_MISSING: %', v_signature
        using errcode = '42501';
    end if;

    if not pg_catalog.has_function_privilege('service_role', v_fn::oid, 'EXECUTE') then
      raise exception 'TC_ACL_VERIFY_SERVICE_ROLE_MISSING: %', v_signature
        using errcode = '42501';
    end if;

    if pg_catalog.has_function_privilege('anon', v_fn::oid, 'EXECUTE') then
      raise exception 'TC_ACL_VERIFY_ANON_LEAK: %', v_signature
        using errcode = '42501';
    end if;

    select exists (
      select 1
      from pg_catalog.pg_proc p
      cross join lateral pg_catalog.aclexplode(
        coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
      ) a
      where p.oid = v_fn
        and a.grantee = 0
        and a.privilege_type = 'EXECUTE'
    )
    into v_public_exec;

    if coalesce(v_public_exec, false) then
      raise exception 'TC_ACL_VERIFY_PUBLIC_LEAK: %', v_signature
        using errcode = '42501';
    end if;
  end loop;

  -- normalized_text permanece service_role-only: authenticated NO debe ejecutarlo.
  if pg_catalog.has_function_privilege(
       'authenticated',
       pg_catalog.to_regprocedure('app_private.normalized_text(text)')::oid,
       'EXECUTE'
     ) then
    raise exception 'TC_ACL_VERIFY_NORMALIZED_TEXT_OVERGRANT'
      using errcode = '42501';
  end if;
end
$verify_acl$;

commit;
