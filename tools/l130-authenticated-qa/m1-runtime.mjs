#!/usr/bin/env node

import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const MARKER = "TC_L130_M1_SYNTHETIC_V1";
export const ACTORS = Object.freeze([
  Object.freeze({ key: "client_a", email: "tc-l130-client-a@example.invalid", passwordEnv: "TC_L130_CLIENT_A_PASSWORD" }),
  Object.freeze({ key: "client_b", email: "tc-l130-client-b@example.invalid", passwordEnv: "TC_L130_CLIENT_B_PASSWORD" }),
  Object.freeze({ key: "support", email: "tc-l130-support@example.invalid", passwordEnv: "TC_L130_SUPPORT_PASSWORD" }),
  Object.freeze({ key: "admin", email: "tc-l130-admin@example.invalid", passwordEnv: "TC_L130_ADMIN_PASSWORD" }),
]);

export const IDS = Object.freeze({
  clientA: "c1300000-0000-4000-8000-000000000001",
  clientB: "c1300000-0000-4000-8000-000000000002",
  contactA: "d1300000-0000-4000-8000-000000000001",
  contactB: "d1300000-0000-4000-8000-000000000002",
  ticketAOpen: "e1300000-0000-4000-8000-000000000001",
  ticketAResolved: "e1300000-0000-4000-8000-000000000002",
  ticketBOpen: "e1300000-0000-4000-8000-000000000003",
  ticketBResolved: "e1300000-0000-4000-8000-000000000004",
});

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertLocalApiUrl(raw) {
  let url;
  try {
    url = new URL(String(raw || ""));
  } catch {
    throw new Error("E_LOCAL_API_URL_INVALID");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (url.protocol !== "http:" || url.username || url.password || !LOCAL_HOSTS.has(host)) {
    throw new Error("E_REMOTE_SUPABASE_DENIED");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url;
}

export function redact(text) {
  return String(text || "")
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1***")
    .replace(/(apikey[=:]\s*)[A-Za-z0-9._-]+/gi, "$1***")
    .replace(/(password[=:]\s*)\S+/gi, "$1***")
    .replace(/eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "***JWT***");
}

function requiredEnv(name) {
  const value = String(process.env[name] || "");
  if (!value) throw new Error(`E_ENV_REQUIRED_${name}`);
  return value;
}

function authHeaders(key, token = key) {
  return {
    apikey: key,
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

async function jsonRequest(url, options, expected = response => response.ok) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!expected(response, body)) {
    throw new Error(`E_HTTP_${response.status}:${redact(typeof body === "string" ? body : JSON.stringify(body)).slice(0, 240)}`);
  }
  return { response, body };
}

async function listAllUsers(apiUrl, serviceRole) {
  const users = [];
  for (let page = 1; page <= 50; page += 1) {
    const { body } = await jsonRequest(
      new URL(`/auth/v1/admin/users?page=${page}&per_page=1000`, apiUrl),
      { headers: authHeaders(serviceRole) },
    );
    const rows = Array.isArray(body?.users) ? body.users : [];
    users.push(...rows);
    if (rows.length < 1000) return users;
  }
  throw new Error("E_AUTH_USER_PAGINATION_LIMIT");
}

function assertState(state) {
  if (state?.marker !== MARKER || !Array.isArray(state?.users) || state.users.length !== ACTORS.length) {
    throw new Error("E_SYNTHETIC_STATE_INVALID");
  }
  for (const actor of ACTORS) {
    const row = state.users.find(item => item.key === actor.key);
    if (!row || row.email !== actor.email || !UUID_RE.test(row.id)) {
      throw new Error(`E_SYNTHETIC_STATE_ACTOR_${actor.key}`);
    }
  }
  return state;
}

function writeState(path, state) {
  const abs = resolve(path);
  writeFileSync(abs, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(abs, 0o600);
}

function readState(path) {
  return assertState(JSON.parse(readFileSync(resolve(path), "utf8")));
}

async function createUsers(apiUrl, serviceRole, statePath) {
  const existing = await listAllUsers(apiUrl, serviceRole);
  for (const actor of ACTORS) {
    if (existing.some(user => String(user?.email || "").toLowerCase() === actor.email)) {
      throw new Error(`E_SYNTHETIC_EMAIL_COLLISION_${actor.key}`);
    }
  }

  const created = [];
  try {
    for (const actor of ACTORS) {
      const password = requiredEnv(actor.passwordEnv);
      if (password.length < 24) throw new Error(`E_PASSWORD_TOO_SHORT_${actor.key}`);
      const { body } = await jsonRequest(
        new URL("/auth/v1/admin/users", apiUrl),
        {
          method: "POST",
          headers: authHeaders(serviceRole),
          body: JSON.stringify({
            email: actor.email,
            password,
            email_confirm: true,
            app_metadata: { tc_l130_synthetic: MARKER, actor: actor.key },
            user_metadata: { tc_l130_synthetic: MARKER },
          }),
        },
      );
      const user = body?.user || body;
      if (!UUID_RE.test(String(user?.id || ""))
          || String(user?.email || "").toLowerCase() !== actor.email
          || user?.app_metadata?.tc_l130_synthetic !== MARKER) {
        throw new Error(`E_AUTH_CREATE_MISMATCH_${actor.key}`);
      }
      created.push({ key: actor.key, email: actor.email, id: user.id.toLowerCase() });
    }
  } catch (error) {
    for (const user of created.reverse()) {
      await fetch(new URL(`/auth/v1/admin/users/${user.id}`, apiUrl), {
        method: "DELETE",
        headers: authHeaders(serviceRole),
      }).catch(() => {});
    }
    throw error;
  }

  writeState(statePath, { marker: MARKER, users: created });
  process.stdout.write("AUTH_USERS_CREATED=4\n");
}

async function deleteUsers(apiUrl, serviceRole, statePath) {
  const state = readState(statePath);
  for (const user of [...state.users].reverse()) {
    await jsonRequest(
      new URL(`/auth/v1/admin/users/${user.id}`, apiUrl),
      { method: "DELETE", headers: authHeaders(serviceRole) },
      response => response.ok || response.status === 404,
    );
  }
  process.stdout.write("AUTH_USERS_DELETED=4\n");
}

async function signIn(apiUrl, anonKey, actor) {
  const { body } = await jsonRequest(
    new URL("/auth/v1/token?grant_type=password", apiUrl),
    {
      method: "POST",
      headers: authHeaders(anonKey),
      body: JSON.stringify({ email: actor.email, password: requiredEnv(actor.passwordEnv) }),
    },
  );
  if (!body?.access_token || !body?.refresh_token || !UUID_RE.test(String(body?.user?.id || ""))) {
    throw new Error(`E_LOGIN_RESPONSE_${actor.key}`);
  }
  return body;
}

async function rest(apiUrl, anonKey, token, path, options = {}) {
  const { expected = response => response.ok, ...requestOptions } = options;
  return jsonRequest(
    new URL(`/rest/v1/${path}`, apiUrl),
    {
      ...requestOptions,
      headers: {
        ...authHeaders(anonKey, token),
        ...(requestOptions.headers || {}),
      },
    },
    expected,
  );
}

function rows(body) {
  if (!Array.isArray(body)) throw new Error("E_REST_ROWS_EXPECTED");
  return body;
}

async function runApiE2e(apiUrl, anonKey, serviceRole, statePath) {
  const state = readState(statePath);
  const actor = key => ACTORS.find(item => item.key === key);
  const user = key => state.users.find(item => item.key === key);

  const anonymous = await fetch(new URL("/rest/v1/tickets?select=id&limit=1", apiUrl), {
    headers: { apikey: anonKey },
  });
  if (anonymous.ok) throw new Error("E_ANON_TICKETS_NOT_DENIED");
  process.stdout.write("ANONYMOUS_INTERNAL_DENIAL=PASS\n");

  const sessions = {};
  for (const key of ["client_a", "client_b", "support", "admin"]) {
    sessions[key] = await signIn(apiUrl, anonKey, actor(key));
    if (sessions[key].user.id.toLowerCase() !== user(key).id) throw new Error(`E_LOGIN_ID_${key}`);
    process.stdout.write(`LOGIN_${key.toUpperCase()}=PASS\n`);
  }

  for (const key of ["client_a", "client_b"]) {
    const refresh = await jsonRequest(
      new URL("/auth/v1/token?grant_type=refresh_token", apiUrl),
      {
        method: "POST",
        headers: authHeaders(anonKey),
        body: JSON.stringify({ refresh_token: sessions[key].refresh_token }),
      },
    );
    if (refresh.body?.user?.id?.toLowerCase() !== user(key).id) throw new Error(`E_REFRESH_ID_${key}`);
    sessions[key] = refresh.body;
  }
  process.stdout.write("SESSION_REFRESH_CLIENTS=PASS\n");

  const allTicketsPath = "tickets?select=id,cliente_id,folio,estado,contexto_adicional&order=folio.asc";
  const aRows = rows((await rest(apiUrl, anonKey, sessions.client_a.access_token, allTicketsPath)).body);
  const bRows = rows((await rest(apiUrl, anonKey, sessions.client_b.access_token, allTicketsPath)).body);
  if (aRows.length !== 2 || aRows.some(row => row.cliente_id !== IDS.clientA)) throw new Error("E_CLIENT_A_SCOPE");
  if (bRows.length !== 2 || bRows.some(row => row.cliente_id !== IDS.clientB)) throw new Error("E_CLIENT_B_SCOPE");
  process.stdout.write("CLIENT_A_OWN_READ=PASS\nCLIENT_B_OWN_READ=PASS\n");

  const aReadsB = rows((await rest(
    apiUrl, anonKey, sessions.client_a.access_token,
    `tickets?id=eq.${IDS.ticketBOpen}&select=id`,
  )).body);
  const bReadsA = rows((await rest(
    apiUrl, anonKey, sessions.client_b.access_token,
    `tickets?id=eq.${IDS.ticketAOpen}&select=id`,
  )).body);
  if (aReadsB.length || bReadsA.length) throw new Error("E_CROSS_CLIENT_READ");
  process.stdout.write("CLIENT_ISOLATION_DIRECT_READ=PASS\n");

  const patch = await rest(
    apiUrl, anonKey, sessions.client_a.access_token,
    `tickets?id=eq.${IDS.ticketBOpen}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ contexto_adicional: "[TC-L130-M1] unauthorized" }),
    },
  );
  if (rows(patch.body).length !== 0) throw new Error("E_CROSS_CLIENT_UPDATE");
  process.stdout.write("CLIENT_ISOLATION_DIRECT_UPDATE=PASS\n");

  const supportRows = rows((await rest(apiUrl, anonKey, sessions.support.access_token, allTicketsPath)).body);
  if (supportRows.length !== 4) throw new Error("E_SUPPORT_SCOPE");
  const supportUpdate = await rest(
    apiUrl, anonKey, sessions.support.access_token,
    `tickets?id=eq.${IDS.ticketAOpen}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ next_action_hint: "[TC-L130-M1] support verified" }),
    },
  );
  if (rows(supportUpdate.body).length !== 1) throw new Error("E_SUPPORT_UPDATE");
  process.stdout.write("SUPPORT_ALLOWED_ACTIONS=PASS\n");

  const supportAdmin = await rest(
    apiUrl, anonKey, sessions.support.access_token,
    "rpc/admin_set_rol",
    {
      method: "POST",
      body: JSON.stringify({ p_id: user("admin").id, p_rol: "admin" }),
      expected: response => !response.ok,
    },
  );
  if (supportAdmin.response.ok) throw new Error("E_SUPPORT_ADMIN_RPC");
  process.stdout.write("SUPPORT_ADMIN_DENIAL=PASS\n");

  const adminRows = rows((await rest(apiUrl, anonKey, sessions.admin.access_token, allTicketsPath)).body);
  if (adminRows.length !== 4) throw new Error("E_ADMIN_SCOPE");
  await rest(
    apiUrl, anonKey, sessions.admin.access_token,
    "rpc/admin_set_rol",
    {
      method: "POST",
      body: JSON.stringify({ p_id: user("admin").id, p_rol: "admin" }),
    },
  );
  process.stdout.write("ADMIN_ALLOWED_ACTIONS=PASS\n");

  const disable = await rest(
    apiUrl, serviceRole, serviceRole,
    `clientes_contactos?auth_user_id=eq.${user("client_a").id}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ activo: false }),
    },
  );
  if (rows(disable.body).length !== 1) throw new Error("E_CLIENT_DISABLE_WRITE");
  const afterDisable = rows((await rest(
    apiUrl, anonKey, sessions.client_a.access_token, allTicketsPath,
  )).body);
  if (afterDisable.length !== 0) throw new Error("E_DISABLED_CLIENT_STILL_AUTHORIZED");
  await rest(
    apiUrl, serviceRole, serviceRole,
    `clientes_contactos?auth_user_id=eq.${user("client_a").id}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ activo: true }),
    },
  );
  process.stdout.write("CLIENT_DEACTIVATION_REVOCATION=PASS\n");

  const verifyB = rows((await rest(
    apiUrl, anonKey, sessions.admin.access_token,
    `tickets?id=eq.${IDS.ticketBOpen}&select=id,contexto_adicional`,
  )).body);
  if (verifyB.length !== 1 || verifyB[0].contexto_adicional === "[TC-L130-M1] unauthorized") {
    throw new Error("E_CROSS_CLIENT_UPDATE_PERSISTED");
  }
  process.stdout.write("MULTIROLE_API_E2E=PASS\n");
}

async function main() {
  const command = process.argv[2];
  const statePath = process.argv[3];
  if (!["auth-up", "api-e2e", "auth-down"].includes(command) || !statePath || process.argv.length !== 4) {
    throw new Error("E_USAGE");
  }
  const apiUrl = assertLocalApiUrl(requiredEnv("LOCAL_SUPABASE_URL"));
  const serviceRole = requiredEnv("LOCAL_SUPABASE_SERVICE_ROLE_KEY");
  if (command === "auth-up") return createUsers(apiUrl, serviceRole, statePath);
  if (command === "auth-down") return deleteUsers(apiUrl, serviceRole, statePath);
  return runApiE2e(
    apiUrl,
    requiredEnv("LOCAL_SUPABASE_ANON_KEY"),
    serviceRole,
    statePath,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    process.stderr.write(`M1_RUNTIME=FAIL\nM1_RUNTIME_ERROR=${redact(error?.message || error)}\n`);
    process.exit(5);
  });
}
