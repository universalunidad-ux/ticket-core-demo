import test from "node:test";
import assert from "node:assert/strict";

import {
  SYNTHETIC_USERS,
  assertLocalApiUrl,
  ensureLocalSyntheticUsers,
} from "../../tools/local-db/lib/local-auth-users.mjs";

const IDS = Object.freeze({
  admin: "10000000-0000-4000-8000-000000000001",
  supervisor: "10000000-0000-4000-8000-000000000002",
  support_a: "10000000-0000-4000-8000-000000000003",
  support_b: "10000000-0000-4000-8000-000000000004",
});
const TOKEN = "local-test-service-role-token";

function syntheticUser(role, id = IDS[role]) {
  const expected = SYNTHETIC_USERS.find((entry) => entry.role === role);
  return {
    id,
    email: expected.email,
    user_metadata: {
      tc_recovery_synthetic: "TC_RECOVERY_SYNTHETIC_V1",
      tc_recovery_role: role,
    },
    app_metadata: { tc_recovery_synthetic: "TC_RECOVERY_SYNTHETIC_V1" },
  };
}

function mockAuth(initial = []) {
  const state = { users: initial.map((user) => structuredClone(user)), calls: [] };
  const fetchImpl = async (url, options = {}) => {
    state.calls.push({
      url: String(url),
      method: options.method || "GET",
      authorization: options.headers?.authorization,
      apikey: options.headers?.apikey,
    });
    if ((options.method || "GET") === "GET") {
      return { ok: true, status: 200, json: async () => ({ users: state.users }) };
    }
    const payload = JSON.parse(options.body);
    const role = payload.user_metadata.tc_recovery_role;
    const user = syntheticUser(role);
    state.users.push(user);
    return { ok: true, status: 200, json: async () => user };
  };
  return { state, fetchImpl };
}

test("acepta únicamente API loopback explícita", () => {
  for (const value of [
    "http://localhost:54321",
    "http://127.0.0.1:54321/",
    "http://[::1]:54321",
  ]) {
    assert.doesNotThrow(() => assertLocalApiUrl(value));
  }
  for (const value of [
    "https://project.supabase.co",
    "http://0.0.0.0:54321",
    "http://127.0.0.2:54321",
    "file:///tmp/auth",
    "http://user:secret@localhost:54321",
    "",
  ]) {
    assert.throws(() => assertLocalApiUrl(value));
  }
});

test("crea cuatro usuarios únicos, sintéticos y deterministas", async () => {
  const mock = mockAuth();
  const users = await ensureLocalSyntheticUsers({
    apiUrl: "http://127.0.0.1:54321",
    serviceRole: TOKEN,
    fetchImpl: mock.fetchImpl,
  });
  assert.deepEqual(users, IDS);
  assert.equal(mock.state.users.length, 4);
  assert.equal(new Set(Object.values(users)).size, 4);
  assert.deepEqual(
    mock.state.users.map((user) => user.email),
    SYNTHETIC_USERS.map((user) => user.email),
  );
});

test("es idempotente y no vuelve a crear usuarios existentes", async () => {
  const mock = mockAuth(SYNTHETIC_USERS.map(({ role }) => syntheticUser(role)));
  const first = await ensureLocalSyntheticUsers({
    apiUrl: "http://localhost:54321",
    serviceRole: TOKEN,
    fetchImpl: mock.fetchImpl,
  });
  const second = await ensureLocalSyntheticUsers({
    apiUrl: "http://localhost:54321",
    serviceRole: TOKEN,
    fetchImpl: mock.fetchImpl,
  });
  assert.deepEqual(first, second);
  assert.equal(mock.state.calls.filter((call) => call.method === "POST").length, 0);
});

test("una colisión no sintética falla cerrado", async () => {
  const collision = syntheticUser("admin");
  collision.user_metadata = { full_name: "persona real" };
  const mock = mockAuth([collision]);
  await assert.rejects(
    ensureLocalSyntheticUsers({
      apiUrl: "http://127.0.0.1:54321",
      serviceRole: TOKEN,
      fetchImpl: mock.fetchImpl,
    }),
    /LOCAL_AUTH_NON_SYNTHETIC_COLLISION_admin/,
  );
  assert.equal(mock.state.calls.filter((call) => call.method === "POST").length, 0);
});

test("UUID repetido entre roles falla cerrado", async () => {
  const users = SYNTHETIC_USERS.map(({ role }) => syntheticUser(role, IDS.admin));
  const mock = mockAuth(users);
  await assert.rejects(
    ensureLocalSyntheticUsers({
      apiUrl: "http://[::1]:54321",
      serviceRole: TOKEN,
      fetchImpl: mock.fetchImpl,
    }),
    /LOCAL_AUTH_UUIDS_NOT_DISTINCT/,
  );
});

test("la service role viaja en headers pero nunca en salida de error", async () => {
  const mock = mockAuth();
  mock.fetchImpl = async (_url, options = {}) => {
    assert.equal(options.headers.authorization, `Bearer ${TOKEN}`);
    assert.equal(options.headers.apikey, TOKEN);
    return { ok: false, status: 503, json: async () => ({}) };
  };
  await assert.rejects(
    ensureLocalSyntheticUsers({
      apiUrl: "http://localhost:54321",
      serviceRole: TOKEN,
      fetchImpl: mock.fetchImpl,
    }),
    (error) => !String(error.message).includes(TOKEN) && /LOCAL_AUTH_HTTP_503/.test(error.message),
  );
});
