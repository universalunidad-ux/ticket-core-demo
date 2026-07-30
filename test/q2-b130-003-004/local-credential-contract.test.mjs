#!/usr/bin/env node

import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  CREDENTIAL_ENV_NAMES,
  MIN_CREDENTIAL_LENGTH,
  destroyCredentialFile,
  resolveCredentialSet,
  writeCredentialFile,
} from "../../tools/l130-authenticated-qa/local-credential-material.mjs";

const ROOT = resolve(import.meta.dirname, "..", "..");
const OWNER = resolve(ROOT, "tools/l130-authenticated-qa/local-credential-material.mjs");
const RUNNER = readFileSync(
  resolve(ROOT, "tools/l130-authenticated-qa/10_RUN_LOCAL_AUTH_E2E.sh"),
  "utf8",
);
const RUNTIME = readFileSync(
  resolve(ROOT, "tools/l130-authenticated-qa/m1-runtime.mjs"),
  "utf8",
);

function withoutCredentials(extra = {}) {
  const env = { ...process.env };
  for (const name of CREDENTIAL_ENV_NAMES) delete env[name];
  return { ...env, ...extra };
}

test("missing fixture credentials are generated securely for every actor", () => {
  const credentials = resolveCredentialSet(withoutCredentials());
  assert.equal(Object.keys(credentials).length, 4);
  assert.ok(Object.values(credentials).every(value => value.length >= MIN_CREDENTIAL_LENGTH));
  assert.equal(new Set(Object.values(credentials)).size, 4);
});

test("an explicit fixture credential propagates unchanged without output", () => {
  const explicit = `FixtureOnly_${"A".repeat(32)}`;
  const credentials = resolveCredentialSet(withoutCredentials({
    TC_L130_CLIENT_A_PASSWORD: explicit,
  }));
  assert.equal(credentials.TC_L130_CLIENT_A_PASSWORD, explicit);
});

test("credential material is created as an exclusive 0600 regular file", () => {
  const dir = mkdtempSync(join(tmpdir(), "tc-q2-credential-"));
  const path = join(dir, "credentials.env");
  try {
    writeCredentialFile(path, withoutCredentials());
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.match(readFileSync(path, "utf8"), /^export TC_L130_CLIENT_A_PASSWORD='/m);
    assert.throws(() => writeCredentialFile(path, withoutCredentials()), /EEXIST/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI never prints an explicit credential to stdout or stderr", () => {
  const dir = mkdtempSync(join(tmpdir(), "tc-q2-credential-cli-"));
  const path = join(dir, "credentials.env");
  const explicit = `FixtureOnly_${"B".repeat(32)}`;
  try {
    const result = spawnSync(process.execPath, [OWNER, "create", path], {
      encoding: "utf8",
      env: withoutCredentials({ TC_L130_CLIENT_A_PASSWORD: explicit }),
    });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(explicit));
    assert.equal(statSync(path).mode & 0o777, 0o600);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("user creation and login consume the same actor passwordEnv identity", () => {
  assert.match(
    RUNTIME,
    /for \(const actor of ACTORS\)[\s\S]+const password = requiredEnv\(actor\.passwordEnv\)[\s\S]+password,/,
  );
  assert.match(
    RUNTIME,
    /async function signIn[\s\S]+password: requiredEnv\(actor\.passwordEnv\)/,
  );
  for (const name of CREDENTIAL_ENV_NAMES) assert.match(RUNTIME, new RegExp(name));
});

test("credential values are absent from state and runtime marker output", () => {
  assert.match(RUNTIME, /created\.push\(\{ key: actor\.key, email: actor\.email, id: user\.id\.toLowerCase\(\) \}\)/);
  assert.doesNotMatch(RUNTIME, /created\.push\(\{[^}]*password/s);
  assert.doesNotMatch(RUNNER, /(?:echo|printf).*(?:CLIENT_A_PASSWORD|CLIENT_B_PASSWORD|SUPPORT_PASSWORD|ADMIN_PASSWORD)/);
});

test("teardown destroys credential material and verifies no residual", () => {
  const dir = mkdtempSync(join(tmpdir(), "tc-q2-credential-down-"));
  const path = join(dir, "credentials.env");
  try {
    writeCredentialFile(path, withoutCredentials());
    assert.equal(destroyCredentialFile(path), true);
    assert.equal(destroyCredentialFile(path), false);
    assert.match(RUNNER, /local-credential-material\.mjs" \\\n\s+destroy "\$CREDENTIAL_FILE"/);
    assert.match(RUNNER, /unset TC_L130_CLIENT_A_PASSWORD/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("remote environment guard executes before credential generation", () => {
  const remoteGuard = RUNNER.indexOf("SUPABASE_ACCESS_TOKEN SUPABASE_PROJECT_ID");
  const credentialCreate = RUNNER.indexOf('create "$CREDENTIAL_FILE"');
  assert.ok(remoteGuard >= 0 && credentialCreate > remoteGuard);
  assert.match(RUNNER, /E_REMOTE_ENV_\$\{name\}/);
});

test("credentials are process environment or a 0600 file, never argv values", () => {
  assert.match(RUNNER, /source "\$CREDENTIAL_FILE"/);
  assert.doesNotMatch(
    RUNNER,
    /m1-runtime\.mjs" (?:auth-up|api-e2e|auth-down)[^\n]*\$(?:TC_L130_.*PASSWORD)/,
  );
  assert.doesNotMatch(
    RUNNER,
    /local-credential-material\.mjs"[\s\S]{0,100}\$(?:TC_L130_.*PASSWORD)/,
  );
});

test("no personal login or hardcoded password is part of the contract", () => {
  assert.doesNotMatch(`${RUNNER}\n${RUNTIME}`, /PERSONAL_(?:LOGIN|PASSWORD)|USER_(?:LOGIN|PASSWORD)/);
  assert.doesNotMatch(
    `${RUNNER}\n${RUNTIME}`,
    /TC_L130_[A-Z_]+PASSWORD=["'][^"$']/,
  );
  assert.ok(CREDENTIAL_ENV_NAMES.every(name => name.startsWith("TC_L130_")));
});
