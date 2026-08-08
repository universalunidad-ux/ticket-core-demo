#!/usr/bin/env node
// TC-RECOVERY-SEQUENTIAL-SCORABLE-01
// Crea o reutiliza exactamente cuatro identidades Auth locales y sintéticas.
// La service role sólo se recibe por SUPABASE_SERVICE_ROLE_KEY y nunca se
// imprime. La salida exitosa contiene únicamente rol=UUID.

import { pathToFileURL } from "node:url";

export const SYNTHETIC_USERS = Object.freeze([
  Object.freeze({ role: "admin", email: "tc-recovery-admin@example.invalid" }),
  Object.freeze({ role: "supervisor", email: "tc-recovery-supervisor@example.invalid" }),
  Object.freeze({ role: "support_a", email: "tc-recovery-support-a@example.invalid" }),
  Object.freeze({ role: "support_b", email: "tc-recovery-support-b@example.invalid" }),
]);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const SYNTHETIC_MARKER = "TC_RECOVERY_SYNTHETIC_V1";

export function assertLocalApiUrl(raw) {
  let url;
  try {
    url = new URL(String(raw || ""));
  } catch {
    throw new Error("LOCAL_AUTH_API_URL_INVALID");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("LOCAL_AUTH_API_PROTOCOL_DENIED");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (url.username || url.password || !LOCAL_HOSTS.has(host)) {
    throw new Error("LOCAL_AUTH_API_REMOTE_DENIED");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url;
}

function isUuid(value) {
  return typeof value === "string" && UUID_RE.test(value);
}

function isExpectedSyntheticIdentity(user, expected) {
  const metadata = user?.user_metadata || {};
  return (
    String(user?.email || "").toLowerCase() === expected.email
    && metadata.tc_recovery_synthetic === SYNTHETIC_MARKER
    && metadata.tc_recovery_role === expected.role
  );
}

function headers(serviceRole) {
  return {
    authorization: `Bearer ${serviceRole}`,
    apikey: serviceRole,
    "content-type": "application/json",
  };
}

async function authRequest(fetchImpl, apiUrl, serviceRole, path, options = {}) {
  const response = await fetchImpl(new URL(path, `${apiUrl.href}/`), {
    ...options,
    headers: { ...headers(serviceRole), ...(options.headers || {}) },
  });
  if (!response || !response.ok) {
    throw new Error(`LOCAL_AUTH_HTTP_${Number(response?.status || 0)}`);
  }
  return response.json();
}

async function listAllUsers(fetchImpl, apiUrl, serviceRole) {
  const found = [];
  for (let page = 1; page <= 100; page += 1) {
    const body = await authRequest(
      fetchImpl,
      apiUrl,
      serviceRole,
      `auth/v1/admin/users?page=${page}&per_page=1000`,
    );
    const users = Array.isArray(body?.users) ? body.users : [];
    found.push(...users);
    if (users.length < 1000) return found;
  }
  throw new Error("LOCAL_AUTH_USER_LIST_PAGINATION_LIMIT");
}

async function createSyntheticUser(fetchImpl, apiUrl, serviceRole, expected) {
  const body = await authRequest(
    fetchImpl,
    apiUrl,
    serviceRole,
    "auth/v1/admin/users",
    {
      method: "POST",
      body: JSON.stringify({
        email: expected.email,
        email_confirm: true,
        user_metadata: {
          tc_recovery_synthetic: SYNTHETIC_MARKER,
          tc_recovery_role: expected.role,
        },
        app_metadata: {
          tc_recovery_synthetic: SYNTHETIC_MARKER,
        },
      }),
    },
  );
  return body?.user || body;
}

export async function ensureLocalSyntheticUsers({
  apiUrl,
  serviceRole,
  fetchImpl = globalThis.fetch,
} = {}) {
  const localUrl = assertLocalApiUrl(apiUrl);
  if (typeof serviceRole !== "string" || serviceRole.length < 16) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY_REQUIRED");
  }
  if (typeof fetchImpl !== "function") throw new Error("FETCH_REQUIRED");

  const existing = await listAllUsers(fetchImpl, localUrl, serviceRole);
  const result = {};

  for (const expected of SYNTHETIC_USERS) {
    const matches = existing.filter(
      (user) => String(user?.email || "").toLowerCase() === expected.email,
    );
    if (matches.length > 1) throw new Error(`LOCAL_AUTH_DUPLICATE_EMAIL_${expected.role}`);

    let user = matches[0];
    if (user && !isExpectedSyntheticIdentity(user, expected)) {
      throw new Error(`LOCAL_AUTH_NON_SYNTHETIC_COLLISION_${expected.role}`);
    }
    if (!user) {
      user = await createSyntheticUser(fetchImpl, localUrl, serviceRole, expected);
      if (!isExpectedSyntheticIdentity(user, expected)) {
        throw new Error(`LOCAL_AUTH_CREATE_IDENTITY_MISMATCH_${expected.role}`);
      }
      existing.push(user);
    }
    if (!isUuid(user.id)) throw new Error(`LOCAL_AUTH_INVALID_UUID_${expected.role}`);
    result[expected.role] = user.id.toLowerCase();
  }

  if (new Set(Object.values(result)).size !== SYNTHETIC_USERS.length) {
    throw new Error("LOCAL_AUTH_UUIDS_NOT_DISTINCT");
  }
  return result;
}

function isMain() {
  return process.argv[1]
    && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMain()) {
  try {
    if (process.argv.length !== 2) throw new Error("ARGUMENTS_DENIED");
    const users = await ensureLocalSyntheticUsers({
      apiUrl: process.env.LOCAL_AUTH_API_URL,
      serviceRole: process.env.SUPABASE_SERVICE_ROLE_KEY,
    });
    for (const { role } of SYNTHETIC_USERS) {
      process.stdout.write(`${role}=${users[role]}\n`);
    }
  } catch (error) {
    process.stderr.write(`LOCAL_AUTH_USERS=FAIL\n`);
    process.stderr.write(`LOCAL_AUTH_ERROR=${String(error?.message || "UNKNOWN")}\n`);
    process.exit(5);
  }
}
