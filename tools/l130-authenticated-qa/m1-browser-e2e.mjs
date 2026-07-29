#!/usr/bin/env node

const CDP_PORT = Number(process.env.TC_L130_CDP_PORT || 55431);
const ORIGIN = String(process.env.TC_L130_STATIC_ORIGIN || "");
const EMAIL = "tc-l130-client-a@example.invalid";
const PASSWORD = String(process.env.TC_L130_CLIENT_A_PASSWORD || "");

if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(ORIGIN)) throw new Error("E_STATIC_ORIGIN_INVALID");
if (!PASSWORD) throw new Error("E_CLIENT_A_PASSWORD_REQUIRED");

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitForJson(url, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {}
    await wait(200);
  }
  throw new Error("E_CDP_TIMEOUT");
}

const targets = await waitForJson(`http://127.0.0.1:${CDP_PORT}/json/list`);
const pageTarget = targets.find(target => target.type === "page" && target.webSocketDebuggerUrl);
if (!pageTarget) throw new Error("E_CDP_WEBSOCKET_MISSING");

const socket = new WebSocket(pageTarget.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", () => reject(new Error("E_CDP_SOCKET")), { once: true });
});

let sequence = 0;
const pending = new Map();
socket.addEventListener("message", event => {
  const message = JSON.parse(String(event.data));
  if (!message.id || !pending.has(message.id)) return;
  const { resolve: done, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(`E_CDP_${message.error.code}`));
  else done(message.result);
});

function command(method, params = {}) {
  const id = ++sequence;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const result = await command("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error("E_BROWSER_EVALUATION");
  return result.result?.value;
}

async function navigate(url) {
  await command("Page.navigate", { url });
}

async function waitUntil(predicate, code, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if (await evaluate(predicate)) return;
    } catch {}
    await wait(200);
  }
  throw new Error(code);
}

await command("Page.enable");
await command("Runtime.enable");
await navigate(`${ORIGIN}/app/index.html?next=portal-cliente.html`);
await waitUntil(`document.readyState === "complete" && !!document.querySelector("#loginForm")`, "E_LOGIN_PAGE");

await evaluate(`(() => {
  const email = document.querySelector("#loginEmail");
  const password = document.querySelector("#loginPassword");
  email.value = ${JSON.stringify(EMAIL)};
  password.value = ${JSON.stringify(PASSWORD)};
  document.querySelector("#loginForm").requestSubmit();
  return true;
})()`);
await waitUntil(
  `location.pathname.endsWith("/portal-cliente.html") && document.body?.dataset?.authzState === "authorized"`,
  "E_CLIENT_PORTAL_LOGIN",
  30000,
);
const firstCount = await evaluate(`document.querySelectorAll("[data-client-ticket]").length`);
if (firstCount !== 2) throw new Error("E_CLIENT_PORTAL_TICKET_COUNT");
process.stdout.write("BROWSER_CLIENT_LOGIN=PASS\n");

await command("Page.reload", { ignoreCache: true });
await waitUntil(
  `location.pathname.endsWith("/portal-cliente.html") && document.body?.dataset?.authzState === "authorized"`,
  "E_CLIENT_SESSION_RELOAD",
  30000,
);
const reloadCount = await evaluate(`document.querySelectorAll("[data-client-ticket]").length`);
if (reloadCount !== 2) throw new Error("E_CLIENT_RELOAD_TICKET_COUNT");
process.stdout.write("BROWSER_SESSION_RELOAD=PASS\n");

await navigate(`${ORIGIN}/app/tickets.html`);
await waitUntil(`location.pathname.endsWith("/portal-cliente.html")`, "E_INTERNAL_ROUTE_NOT_DENIED", 30000);
process.stdout.write("BROWSER_INTERNAL_ROUTE_DENIAL=PASS\n");

await evaluate(`document.querySelector("#clientLogout").click()`);
await waitUntil(`location.pathname.endsWith("/index.html")`, "E_CLIENT_LOGOUT", 30000);
process.stdout.write("BROWSER_LOGOUT=PASS\n");

await navigate(`${ORIGIN}/app/portal-cliente.html`);
await waitUntil(`location.pathname.endsWith("/index.html")`, "E_POST_LOGOUT_ROUTE", 30000);
process.stdout.write("BROWSER_POST_LOGOUT_DENIAL=PASS\n");

socket.close();
process.stdout.write("BROWSER_M1_E2E=PASS\n");
