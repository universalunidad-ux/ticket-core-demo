#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const IDS = Object.freeze({
  ticketA: "e1300000-0000-4000-8000-000000000001",
  ticketB: "e1300000-0000-4000-8000-000000000003",
});
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

function required(name) {
  const value = String(process.env[name] || "");
  if (!value) throw new Error(`E_ENV_REQUIRED_${name}`);
  return value;
}

function apiUrl() {
  const value = new URL(required("LOCAL_SUPABASE_URL"));
  if (value.protocol !== "http:" || !LOCAL_HOSTS.has(value.hostname.replace(/^\[|\]$/g, ""))) {
    throw new Error("E_REMOTE_SUPABASE_DENIED");
  }
  return value;
}

function headers(key, token = key) {
  return { apikey: key, authorization: `Bearer ${token}`, "content-type": "application/json" };
}

async function request(url, options, expected = response => response.ok) {
  const response = await fetch(url, options);
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!expected(response, body)) throw new Error(`E_HTTP_${response.status}`);
  return body;
}

async function signIn(base, anonKey, email, password) {
  const body = await request(new URL("/auth/v1/token?grant_type=password", base), {
    method: "POST",
    headers: headers(anonKey),
    body: JSON.stringify({ email, password }),
  });
  if (!body?.access_token) throw new Error("E_LOGIN_TOKEN");
  return body.access_token;
}

async function main() {
  const statePath = resolve(process.argv[2] || "");
  if (!statePath || process.argv.length !== 3) throw new Error("E_USAGE");
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  const base = apiUrl();
  const anonKey = required("LOCAL_SUPABASE_ANON_KEY");
  const serviceRole = required("LOCAL_SUPABASE_SERVICE_ROLE_KEY");
  const clientA = state.users.find(user => user.key === "client_a");
  const clientB = state.users.find(user => user.key === "client_b");
  if (!clientA || !clientB) throw new Error("E_STATE_CLIENTS");

  const marker = `TC-Q2-${crypto.randomUUID()}`;
  const fixtureRows = [
    { ticket_id: IDS.ticketA, autor_tipo: "soporte", visibilidad: "publica", kind: "mensaje", texto: `${marker}-A-PUBLIC` },
    { ticket_id: IDS.ticketA, autor_tipo: "soporte", visibilidad: "interna", kind: "nota", texto: `${marker}-A-INTERNAL` },
    { ticket_id: IDS.ticketB, autor_tipo: "soporte", visibilidad: "publica", kind: "mensaje", texto: `${marker}-B-PUBLIC` },
    { ticket_id: IDS.ticketB, autor_tipo: "soporte", visibilidad: "interna", kind: "nota", texto: `${marker}-B-INTERNAL` },
  ];
  const inserted = await request(new URL("/rest/v1/ticket_eventos?select=id,ticket_id,texto", base), {
    method: "POST",
    headers: { ...headers(serviceRole), Prefer: "return=representation" },
    body: JSON.stringify(fixtureRows),
  });
  const createdIds = inserted.map(row => row.id);

  try {
    const tokenA = await signIn(base, anonKey, clientA.email, required("TC_L130_CLIENT_A_PASSWORD"));
    const tokenB = await signIn(base, anonKey, clientB.email, required("TC_L130_CLIENT_B_PASSWORD"));
    const query = `ticket_eventos?texto=like.${marker}*&select=id,ticket_id,visibilidad,texto&order=created_at.asc`;
    const rowsA = await request(new URL(`/rest/v1/${query}`, base), { headers: headers(anonKey, tokenA) });
    const rowsB = await request(new URL(`/rest/v1/${query}`, base), { headers: headers(anonKey, tokenB) });
    if (rowsA.length !== 1 || rowsA[0].ticket_id !== IDS.ticketA || rowsA[0].texto !== `${marker}-A-PUBLIC`) {
      throw new Error("E_CLIENT_A_VISIBILITY");
    }
    if (rowsB.length !== 1 || rowsB[0].ticket_id !== IDS.ticketB || rowsB[0].texto !== `${marker}-B-PUBLIC`) {
      throw new Error("E_CLIENT_B_VISIBILITY");
    }
    if ([...rowsA, ...rowsB].some(row => row.visibilidad !== "publica" || row.texto.includes("INTERNAL"))) {
      throw new Error("E_INTERNAL_EVENT_VISIBLE");
    }
    process.stdout.write("CLIENT_A_PUBLIC_RESPONSE=PASS\nCLIENT_A_CANNOT_SEE_B=PASS\nCLIENT_B_CANNOT_SEE_A=PASS\nCLIENT_INTERNAL_EVENTS_DENIED=PASS\nB130_004_EDGE_E2E=PASS\n");
  } finally {
    if (createdIds.length) {
      await request(
        new URL(`/rest/v1/ticket_eventos?id=in.(${createdIds.join(",")})`, base),
        { method: "DELETE", headers: headers(serviceRole) },
      );
    }
  }
}

main().catch(error => {
  process.stderr.write(`B130_004_EDGE_E2E=FAIL\nRESPONSE_VISIBILITY_ERROR=${String(error?.message || error)}\n`);
  process.exitCode = 6;
});
