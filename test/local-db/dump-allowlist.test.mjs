// TC-RECOVERY-P5-P9-CLOSE-05
// Pruebas del owner de la allowlist del dump. Cubren lo que el contrato
// (tools/recovery-v2-contract.test.mjs) NO repite: el acumulador de escaneo en
// streaming, los patrones de secreto y el parseo de TOC malformadas.

import test from "node:test";
import assert from "node:assert/strict";

import {
  parseRestoreToc, parseAllowedTables, newScanState, scanLineInto,
  compileSecretPatterns, ALLOWED_TOC_TYPES, EXCLUDED_TABLES,
} from "../../tools/local-db/lib/dump-allowlist.mjs";

test("parseRestoreToc ignora comentarios y separa tipo/schema/nombre", () => {
  const toc = parseRestoreToc([
    ";", "; Archive created at 2026-07-25", "; Selected TOC Entries:", ";",
    "246; 0 16456 TABLE DATA public tickets postgres",
    "3000; 0 0 SEQUENCE SET public ticket_folios_seq postgres",
  ].join("\n"));
  assert.equal(toc.length, 2);
  assert.deepEqual(
    toc.map((e) => [e.type, e.schema, e.name]),
    [["TABLE DATA", "public", "tickets"], ["SEQUENCE SET", "public", "ticket_folios_seq"]],
  );
});

test("parseRestoreToc no confunde SEQUENCE SET con SEQUENCE", () => {
  const [seq] = parseRestoreToc("10; 1259 16 SEQUENCE public s postgres");
  const [set] = parseRestoreToc("11; 0 0 SEQUENCE SET public s postgres");
  assert.equal(seq.type, "SEQUENCE");
  assert.equal(set.type, "SEQUENCE SET");
  assert.ok(!ALLOWED_TOC_TYPES.includes(seq.type), "SEQUENCE (estructura) no es restaurable data-only");
});

test("parseRestoreToc marca lineas no interpretables en vez de ignorarlas", () => {
  const [e] = parseRestoreToc("basura sin formato");
  assert.equal(e.type, "UNPARSEABLE");
});

test("parseAllowedTables lee la allowlist del orden de datos y nada mas", () => {
  const allowed = parseAllowedTables([
    "# comentario", "0  auth.users   [PLATFORM]",
    "1  public.perfiles   # primera", "2  public.tickets",
    "# EXCLUDED public.edge_idempotency",
  ].join("\n"));
  assert.deepEqual(allowed, ["perfiles", "tickets"]);
  assert.ok(!allowed.includes("users"), "auth.users no es una tabla de la allowlist de datos");
  assert.ok(EXCLUDED_TABLES.every((t) => !allowed.includes(t)));
});

test("el escaneo acumula regla + primera linea + conteo, nunca el texto", () => {
  const s = newScanState();
  scanLineInto(s, "COPY public.tickets (id) FROM stdin;");
  scanLineInto(s, "1\tsecreto-de-negocio");
  scanLineInto(s, "GRANT SELECT ON public.tickets TO anon;");
  scanLineInto(s, "GRANT INSERT ON public.tickets TO anon;");
  assert.equal(s.lines, 4);
  const f = s.findings.get("PRIVILEGE_CHANGE");
  assert.deepEqual({ count: f.count, firstLine: f.firstLine }, { count: 2, firstLine: 3 });
  assert.equal(JSON.stringify([...s.findings.entries()]).includes("secreto-de-negocio"), false);
});

test("el escaneo registra las tablas COPY vistas para verificar el alcance", () => {
  const s = newScanState();
  scanLineInto(s, "COPY public.perfiles (id) FROM stdin;");
  scanLineInto(s, "COPY app_private.x (id) FROM stdin;");
  assert.deepEqual([...s.copyTables].sort(), ["app_private.x", "public.perfiles"]);
});

test("los patrones del secret gate se aplican al contenido y se reportan por id", () => {
  const patterns = compileSecretPatterns([
    "# comentario",
    "postgres(?:ql)?://[^[:space:]/]+:[^[:space:]@]+@",
    "AKIA[0-9A-Z]{16}",
  ].join("\n"));
  assert.equal(patterns.length, 2);
  const s = newScanState();
  // El fixture se compone en tiempo de ejecucion: escribir el literal completo
  // haria que el propio secret gate marcase este archivo.
  scanLineInto(s, `1\tAKIA${"0123456789ABCDEF"}`, patterns);
  assert.equal(s.findings.size, 1);
  assert.ok([...s.findings.keys()][0].startsWith("SECRET_PATTERN_"));
});

test("una linea de datos normal no dispara ninguna regla (sin falsos positivos)", () => {
  const s = newScanState();
  for (const line of [
    "SET statement_timeout = 0;",
    "SELECT pg_catalog.set_config('search_path', '', false);",
    "COPY public.bitacora (id, actor_id) FROM stdin;",
    "9\t3f2504e0-4f89-11d3-9a0c-0305e82c3301",
    "\\.",
    "SELECT pg_catalog.setval('public.ticket_folios_seq', 42, true);",
  ]) scanLineInto(s, line);
  assert.equal(s.findings.size, 0);
});
