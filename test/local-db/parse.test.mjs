// TC-LOCAL-DB-RLS-HARNESS-01
// Pruebas del propio harness: parsers de salidas externas (parse.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseSupabaseStatusDbUrl, orderMigrations, parseRlsMatrixOutput,
  evaluateSecurityDefiner, evaluateRlsEnabled,
} from "../../tools/local-db/lib/parse.mjs";

test("parseSupabaseStatusDbUrl detecta URL local", () => {
  const txt = [
    "supabase local development setup is running.",
    "         API URL: http://127.0.0.1:54321",
    "          DB URL: " + [
      "postgresql://postgres:",
      "postgres@127.0.0.1:54322/postgres",
    ].join(""),
    "      Studio URL: http://127.0.0.1:54323",
  ].join("\n");
  const r = parseSupabaseStatusDbUrl(txt);
  assert.equal(r.classification, "LOCAL");
  assert.equal(r.host, "127.0.0.1");
});

test("parseSupabaseStatusDbUrl marca REMOTE si el status apunta a la nube", () => {
  const txt = ["DB URL: postgresql://postgres:", "pw@db.abcd.supabase.co:5432/postgres"].join("");
  const r = parseSupabaseStatusDbUrl(txt);
  assert.equal(r.classification, "REMOTE");
});

test("parseSupabaseStatusDbUrl devuelve null si no hay DB URL", () => {
  assert.equal(parseSupabaseStatusDbUrl("sin nada relevante"), null);
});

test("orderMigrations ordena por timestamp y filtra no-migraciones", () => {
  const input = [
    "20260721083212_tc_sec_sd_grants.sql",
    "20260717093000_authz_functions.sql",
    "README.md",
    "20260717092950_drop_legacy_policies.sql",
  ];
  assert.deepEqual(orderMigrations(input), [
    "20260717092950_drop_legacy_policies.sql",
    "20260717093000_authz_functions.sql",
    "20260721083212_tc_sec_sd_grants.sql",
  ]);
});

test("parseRlsMatrixOutput: éxito con PASS y exit 0", () => {
  const res = {
    code: 0,
    stdout: "NOTICE:  PASS: escalada de rol bloqueada\nNOTICE:  PASS: anon sin tickets\n",
    stderr: "",
  };
  const p = parseRlsMatrixOutput(res);
  assert.equal(p.ok, true);
  assert.equal(p.passes.length, 2);
  assert.equal(p.failLine, null);
});

test("parseRlsMatrixOutput: fallo captura FAIL y rol", () => {
  const res = {
    code: 3,
    stdout: "NOTICE:  PASS: A ve su ticket asignado\n",
    stderr: "ERROR:  FAIL (canario anti-permisivo): Soporte B ve el ticket de A (n=1)\n",
  };
  const p = parseRlsMatrixOutput(res);
  assert.equal(p.ok, false);
  assert.match(p.failLine, /canario anti-permisivo/);
  assert.equal(p.failedRole, "soporte");
});

test("parseRlsMatrixOutput: exit!=0 aunque no haya texto FAIL => no ok", () => {
  const p = parseRlsMatrixOutput({ code: 1, stdout: "", stderr: "connection refused" });
  assert.equal(p.ok, false);
});

test("evaluateSecurityDefiner detecta search_path no fijado", () => {
  const inv = [
    { identity: "public.tc_is_admin()", search_path_fixed: true, public_execute: false, anon_execute: false },
    { identity: "public.mala_fn()", search_path_fixed: false, public_execute: false, anon_execute: false },
  ];
  const r = evaluateSecurityDefiner(inv);
  assert.equal(r.ok, false);
  assert.deepEqual(r.searchPathUnpinned, ["public.mala_fn()"]);
});

test("evaluateSecurityDefiner detecta EXECUTE público/anon", () => {
  const inv = [
    { identity: "public.expuesta()", search_path_fixed: true, public_execute: true, anon_execute: false },
    { identity: "public.anon_fn()", search_path_fixed: true, public_execute: false, anon_execute: true },
  ];
  const r = evaluateSecurityDefiner(inv);
  assert.equal(r.ok, false);
  assert.equal(r.unsafe.length, 2);
});

test("evaluateSecurityDefiner permite anon intencional de get_ticket_portal", () => {
  const inv = [
    { identity: "public.get_ticket_portal(p_folio text, p_token text)", search_path_fixed: true, public_execute: false, anon_execute: true },
  ];
  const r = evaluateSecurityDefiner(inv);
  assert.equal(r.ok, true);
});

test("evaluateRlsEnabled detecta tablas sin RLS", () => {
  const rows = [
    { tablename: "tickets", rowsecurity: true },
    { tablename: "bitacora", rowsecurity: false },
  ];
  const r = evaluateRlsEnabled(rows, ["tickets", "bitacora", "perfiles"]);
  assert.equal(r.ok, false);
  assert.deepEqual(r.missingRls.sort(), ["bitacora", "perfiles"]);
});
