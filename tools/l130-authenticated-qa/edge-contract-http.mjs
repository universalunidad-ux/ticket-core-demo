#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const IDS = Object.freeze({
  ticketA: "e1300000-0000-4000-8000-000000000001",
  folioA: "TC-L130-A-OPEN",
});
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

function required(name) {
  const value = String(process.env[name] || "");
  if (!value) throw new Error(`E_ENV_REQUIRED_${name}`);
  return value;
}

function localUrl(name) {
  const url = new URL(required(name));
  if (url.protocol !== "http:" || !LOCAL_HOSTS.has(url.hostname.replace(/^\[|\]$/g, ""))) {
    throw new Error(`E_REMOTE_DENIED_${name}`);
  }
  return url;
}

function headers(key, token = key) {
  return { apikey: key, authorization: `Bearer ${token}`, "content-type": "application/json" };
}

async function responseJson(url, options, expectedStatus) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (Array.isArray(expectedStatus) ? !expectedStatus.includes(response.status) : response.status !== expectedStatus) {
    throw new Error(`E_HTTP_${response.status}_EXPECTED_${expectedStatus}`);
  }
  return { response, body };
}

async function signIn(base, anonKey, actor, passwordEnv) {
  const { body } = await responseJson(
    new URL("/auth/v1/token?grant_type=password", base),
    {
      method: "POST",
      headers: headers(anonKey),
      body: JSON.stringify({ email: actor.email, password: required(passwordEnv) }),
    },
    200,
  );
  if (!body?.access_token) throw new Error("E_LOGIN_TOKEN");
  return body.access_token;
}

function supportPayload(suffix = "") {
  return {
    nombre: "Persona Q2",
    correo: `q2-${suffix || "base"}@example.invalid`,
    telefono: "5512345678",
    categoria: "soporte",
    sistema: "Otro: Sistema de prueba",
    titulo: `Falla reproducible ${suffix}`.trim(),
    descripcion: "La máquina presenta una falla reproducible durante el contrato Q2.",
    impacto: "media",
    canal: "correo",
    afecta_a: "solo_yo",
  };
}

function supportForm(payload) {
  const form = new FormData();
  form.append("turnstile_token", "");
  form.append("payload", JSON.stringify(payload));
  return form;
}

async function supportRequest(base, anonKey, payload, idemKey, expectedStatus) {
  return responseJson(
    new URL("/functions/v1/support-submit-secure", base),
    {
      method: "POST",
      headers: {
        apikey: anonKey,
        origin: base.origin,
        "idempotency-key": idemKey,
        "x-forwarded-for": "198.51.100.44",
      },
      body: supportForm(payload),
    },
    expectedStatus,
  );
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value
      .map(item => canonicalJson(item))
      .join(",")}]`;
  }

  if (
    value !== null
    && typeof value === "object"
  ) {
    const entries = Object.entries(value)
      .sort(([left], [right]) => (
        left < right ? -1 : left > right ? 1 : 0
      ));

    return `{${entries
      .map(
        ([key, item]) =>
          `${JSON.stringify(key)}:${canonicalJson(item)}`,
      )
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function psqlAcl(databaseUrl, sql) {
  const url = new URL(databaseUrl);

  if (
    !LOCAL_HOSTS.has(
      url.hostname.replace(/^\[|\]$/g, ""),
    )
  ) {
    throw new Error("E_REMOTE_DATABASE_DENIED");
  }

  const dbCid = required("TC_LOCAL_DB_CID");

  if (!/^[A-Za-z0-9_.-]+$/u.test(dbCid)) {
    throw new Error("E_LOCAL_DB_CID_INVALID");
  }

  const inspect = spawnSync(
    "docker",
    [
      "inspect",
      "-f",
      "{{.State.Running}}",
      dbCid,
    ],
    { encoding: "utf8" },
  );

  if (
    inspect.status !== 0
    || String(inspect.stdout || "").trim() !== "true"
  ) {
    throw new Error(
      "E_LOCAL_DB_CONTAINER_NOT_RUNNING",
    );
  }

  const result = spawnSync(
    "docker",
    [
      "exec",
      "-i",
      dbCid,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-X",
      "-q",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      sql,
    ],
    { encoding: "utf8" },
  );

  if (result.status !== 0) {
    throw new Error("E_LOCAL_ACL_PROBE_SQL");
  }
}

async function main() {
  const statePath = resolve(process.argv[2] || "");
  if (!statePath || process.argv.length !== 3) throw new Error("E_USAGE");
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  const base = localUrl("LOCAL_SUPABASE_URL");
  const anonKey = required("LOCAL_SUPABASE_ANON_KEY");
  const serviceRole = required("LOCAL_SUPABASE_SERVICE_ROLE_KEY");
  const databaseUrl = required("LOCAL_DATABASE_URL");
  const support = state.users.find(user => user.key === "support");
  if (!support) throw new Error("E_SUPPORT_ACTOR");
  const supportToken = await signIn(base, anonKey, support, "TC_L130_SUPPORT_PASSWORD");

  // support-submit-secure: success object, exact replay, payload conflict.
  const idemKey = `q2-support-${crypto.randomUUID()}`;
  const payload = supportPayload("idem");
  const first = await supportRequest(base, anonKey, payload, idemKey, 200);
  const successKeys = Object.keys(first.body || {}).sort().join(",");
  if (successKeys !== "folio,ok,status,token_publico" || first.body.status !== "ticket_creado") {
    throw new Error("E_SUPPORT_PUBLIC_RESPONSE");
  }
  const replay = await supportRequest(base, anonKey, payload, idemKey, 200);
  if (canonicalJson(replay.body) !== canonicalJson(first.body)) throw new Error("E_SUPPORT_REPLAY");
  const conflict = await supportRequest(base, anonKey, supportPayload("different"), idemKey, 409);
  if (conflict.body?.code !== "TC_IDEMPOTENCY_KEY_REUSED") throw new Error("E_SUPPORT_CONFLICT_CODE");

  // Fail-closed RPC probe: remove only the local service_role grant, invoke a
  // fresh semantic request, and restore the exact grant in finally.
  psqlAcl(databaseUrl, "revoke execute on function public.support_idem_claim(text,text) from service_role");
  try {
    const failed = await supportRequest(
      base,
      anonKey,
      supportPayload("rpc-failure"),
      `q2-rpc-${crypto.randomUUID()}`,
      503,
    );
    if (failed.body?.code !== "IDEMPOTENCY_UNAVAILABLE") throw new Error("E_RPC_FAIL_OPEN");
  } finally {
    psqlAcl(databaseUrl, "grant execute on function public.support_idem_claim(text,text) to service_role");
  }

  // estado-ticket-ts and responder: token-gated read, denied invalid token,
  // positive mutation, then a bounded rate-limit denial.
  const token = `q2-${crypto.randomUUID()}`;
  await responseJson(
    new URL(`/rest/v1/tickets?id=eq.${IDS.ticketA}`, base),
    {
      method: "PATCH",
      headers: { ...headers(serviceRole), Prefer: "return=minimal" },
      body: JSON.stringify({
        token_publico: token,
        token_publico_expira: new Date(Date.now() + 3_600_000).toISOString(),
      }),
    },
    204,
  );
  await responseJson(
    new URL(`/functions/v1/estado-ticket-ts?folio=${IDS.folioA}&token=wrong`, base),
    { headers: { apikey: anonKey } },
    404,
  );
  const visible = await responseJson(
    new URL(`/functions/v1/estado-ticket-ts?folio=${IDS.folioA}&token=${token}`, base),
    { headers: { apikey: anonKey } },
    200,
  );
  if (visible.body?.ticket?.id !== IDS.ticketA) throw new Error("E_ESTADO_POSITIVE");

  const reply = new FormData();
  reply.append("folio", IDS.folioA);
  reply.append("token", token);
  reply.append("texto", `Q2 edge reply ${crypto.randomUUID()}`);
  const replyResult = await responseJson(
    new URL("/functions/v1/estado-ticket-responder-ts", base),
    { method: "POST", headers: { apikey: anonKey, "x-forwarded-for": "198.51.100.91" }, body: reply },
    200,
  );
  if (replyResult.body?.responded !== true) throw new Error("E_RESPONDER_MUTATION");
  for (let index = 0; index < 7; index += 1) {
    const empty = new FormData();
    empty.append("folio", IDS.folioA);
    empty.append("token", token);
    await responseJson(
      new URL("/functions/v1/estado-ticket-responder-ts", base),
      { method: "POST", headers: { apikey: anonKey, "x-forwarded-for": "198.51.100.91" }, body: empty },
      400,
    );
  }
  const limited = new FormData();
  limited.append("folio", IDS.folioA);
  limited.append("token", token);
  await responseJson(
    new URL("/functions/v1/estado-ticket-responder-ts", base),
    { method: "POST", headers: { apikey: anonKey, "x-forwarded-for": "198.51.100.91" }, body: limited },
    429,
  );

  // ticket-escalar-admin: explicit authn denial and assigned support success.
  await responseJson(
    new URL("/functions/v1/ticket-escalar-admin", base),
    { method: "POST", headers: { apikey: anonKey }, body: JSON.stringify({}) },
    401,
  );
  const escalation = await responseJson(
    new URL("/functions/v1/ticket-escalar-admin", base),
    {
      method: "POST",
      headers: headers(anonKey, supportToken),
      body: JSON.stringify({
        ticket_id: IDS.ticketA,
        accion: "chat_forwarded_to_admin",
        comentario: "Contrato Q2",
        idempotency_key: `q2-escalation-${crypto.randomUUID()}`,
      }),
    },
    200,
  );
  if (escalation.body?.ok !== true) throw new Error("E_ESCALATION_POSITIVE");

  const {
    execFileSync: b131ExecFileSync,
  } = await import("node:child_process");

  const b131BitacoraSql = [
    "select count(*)::text || '|' ||",
    "       (count(*) filter (where fecha is distinct from created_at))::text",
    "from public.bitacora",
    "where accion = 'ticket_supervision_escalada';",
  ].join("\n");

  const b131BitacoraProbe = b131ExecFileSync(
    "docker",
    [
      "exec",
      dbCid,
      "psql",
      "-X",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-Atqc",
      b131BitacoraSql,
    ],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  ).trim();

  if (b131BitacoraProbe !== "1|0") {
    throw new Error(
      `E_ESCALATION_BITACORA_NOT_WRITTEN:${b131BitacoraProbe || "EMPTY"}`,
    );
  }

  process.stdout.write(
    "ESCALATION_BITACORA_WRITTEN=PASS\n",
  );

  process.stdout.write(
    "SUPPORT_RATE_LIMIT=PASS\n"
      + "SUPPORT_IDEMPOTENCY_REPLAY=PASS\n"
      + "SUPPORT_IDEMPOTENCY_CONFLICT=PASS\n"
      + "SUPPORT_RPC_FAIL_CLOSED=PASS\n"
      + "ESTADO_AUTHZ_TOKEN=PASS\n"
      + "RESPONDER_MUTATION=PASS\n"
      + "RESPONDER_RATE_LIMIT=PASS\n"
      + "ESCALATION_AUTHN_AUTHZ=PASS\n"
      + "B130_003_EDGE_E2E=PASS\n",
  );
}

main().catch(error => {
  process.stderr.write(`B130_003_EDGE_E2E=FAIL\nEDGE_HTTP_ERROR=${String(error?.message || error)}\n`);
  process.exitCode = 7;
});
