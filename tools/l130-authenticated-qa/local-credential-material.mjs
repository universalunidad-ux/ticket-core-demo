#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const MIN_CREDENTIAL_LENGTH = 24;
export const CREDENTIAL_ENV_NAMES = Object.freeze([
  "TC_L130_CLIENT_A_PASSWORD",
  "TC_L130_CLIENT_B_PASSWORD",
  "TC_L130_SUPPORT_PASSWORD",
  "TC_L130_ADMIN_PASSWORD",
]);

const GENERATED_BYTES = 32;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;

export function generateEphemeralCredential(randomBytesImpl = randomBytes) {
  const value = randomBytesImpl(GENERATED_BYTES).toString("base64url");
  if (value.length < MIN_CREDENTIAL_LENGTH || CONTROL_CHARACTER.test(value)) {
    throw new Error("E_EPHEMERAL_CREDENTIAL_GENERATION_INVALID");
  }
  return value;
}

function assertCredential(name, value) {
  if (typeof value !== "string" || value.length < MIN_CREDENTIAL_LENGTH) {
    throw new Error(`E_FIXTURE_CREDENTIAL_TOO_SHORT_${name}`);
  }
  if (CONTROL_CHARACTER.test(value)) {
    throw new Error(`E_FIXTURE_CREDENTIAL_CONTROL_CHARACTER_${name}`);
  }
  return value;
}

export function resolveCredentialSet(
  env = process.env,
  generate = () => generateEphemeralCredential(),
) {
  return Object.fromEntries(CREDENTIAL_ENV_NAMES.map(name => [
    name,
    assertCredential(name, String(env[name] || generate())),
  ]));
}

function shellSingleQuote(value) {
  return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}

export function renderCredentialEnv(credentials) {
  return `${CREDENTIAL_ENV_NAMES.map(name => (
    `export ${name}=${shellSingleQuote(assertCredential(name, credentials[name]))}`
  )).join("\n")}\n`;
}

export function writeCredentialFile(path, env = process.env) {
  const abs = resolve(path);
  const credentials = resolveCredentialSet(env);
  const descriptor = openSync(
    abs,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
    0o600,
  );
  try {
    writeFileSync(descriptor, renderCredentialEnv(credentials), "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  chmodSync(abs, 0o600);
  const stat = lstatSync(abs);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600) {
    throw new Error("E_CREDENTIAL_FILE_CONTRACT");
  }
  return abs;
}

export function destroyCredentialFile(path) {
  const abs = resolve(path);
  if (!existsSync(abs)) return false;
  const stat = lstatSync(abs);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("E_CREDENTIAL_FILE_TYPE");
  }
  unlinkSync(abs);
  if (existsSync(abs)) throw new Error("E_CREDENTIAL_FILE_RESIDUAL");
  return true;
}

function isMain() {
  return process.argv[1]
    && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMain()) {
  try {
    const command = process.argv[2];
    const path = process.argv[3];
    if (!["create", "destroy"].includes(command) || !path || process.argv.length !== 4) {
      throw new Error("E_CREDENTIAL_MATERIAL_USAGE");
    }
    if (command === "create") writeCredentialFile(path);
    else destroyCredentialFile(path);
  } catch (error) {
    process.stderr.write(`CREDENTIAL_MATERIAL=FAIL\n`);
    process.stderr.write(`STOP_CODE=${String(error?.message || "E_CREDENTIAL_MATERIAL")}\n`);
    process.exit(6);
  }
}
