import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const migrationDir = new URL("../../supabase/migrations/", import.meta.url);
const files = readdirSync(migrationDir).filter((name) => name.endsWith(".sql")).sort();
const target = "20260730081307_backend_security_macrobatch_01.sql";
const sql = readFileSync(new URL(target, migrationDir), "utf8");

test("29 migration is last in canonical lexical order", () => {
  assert.equal(files.at(-1), target);
});

test("30 migration timestamp is unique", () => {
  assert.equal(files.filter((name) => name.startsWith("20260730081307_")).length, 1);
});

test("31 each selected policy has one CREATE owner", () => {
  for (const policy of [
    "perfiles_select_self",
    "perfiles_update_self",
    "archivos_ticket_staff_select",
    "archivos_ticket_client_owner_select",
    "ticket_archivos_staff_select",
    "ticket_archivos_client_owner_select",
  ]) {
    assert.equal((sql.match(new RegExp(`create policy ${policy}\\b`, "g")) || []).length, 1);
  }
});

test("32 every recreated policy is preceded by DROP IF EXISTS", () => {
  const drops = (sql.match(/drop policy if exists/g) || []).length;
  const creates = (sql.match(/create policy/g) || []).length;
  assert.equal(drops, creates);
  assert.equal(creates, 6);
});

test("33 no function overload is created", () => {
  assert.doesNotMatch(sql, /\bcreate\s+(?:or\s+replace\s+)?function\b/i);
});

test("34 no contradictory anonymous grant exists", () => {
  assert.doesNotMatch(sql, /\bgrant\b[\s\S]{0,120}\bto\s+(?:public|anon)\s*;/i);
});

test("35 exact selected requirement count is four", () => {
  const header = sql.match(/-- REQUIREMENTS: (.+)/)?.[1] || "";
  assert.deepEqual(header.split(", ").sort(), ["TC-U010", "TC-U012", "TC-U013", "TC-U033"]);
});

test("36 migration contains explicit fail-closed SQLSTATEs", () => {
  for (const state of ["42883", "42P01", "55000", "42501"]) {
    assert.match(sql, new RegExp(`errcode = '${state}'`));
  }
});
