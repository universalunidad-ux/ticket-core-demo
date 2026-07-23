#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(process.argv[2] || ".");
const base = "e95b39fbb8c79740d70b558b0aa61bdbabb95906";
const responderPath = "supabase/functions/estado-ticket-responder-ts/index.ts";
const supportPath = "supabase/functions/support-submit-secure/index.ts";
const helperPath = "supabase/functions/_shared/rate-limit.ts";
const denoTestPath = "supabase/functions/_shared/rate-limit.test.ts";
const contractTestPath = "tools/edge-public-responder-antiabuse-contract.test.mjs";
const runnerPath = "tools/run-contract-tests.mjs";
const allowlist = new Map([
  [helperPath, "A"],
  [denoTestPath, "A"],
  [contractTestPath, "A"],
  [responderPath, "M"],
  [runnerPath, "M"],
]);

const git = (args, encoding = "utf8") => {
  const result = spawnSync("git", args, { cwd: root, encoding });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr || ""}`);
  return result.stdout;
};

const { rateLimit } = await import(
  pathToFileURL(join(root, helperPath)).href
);

const makeClient = ({
  count = 0,
  selectError = null,
  insertError = null,
  throwOnSelect = false,
  throwOnInsert = false,
} = {}) => {
  const calls = {
    table: [],
    select: [],
    filters: [],
    inserts: [],
  };
  const sb = {
    from(table) {
      calls.table.push(table);
      return {
        select(columns, options) {
          calls.select.push({ columns, options });
          if (throwOnSelect) throw new Error("select rejected");
          return {
            eq(column, value) {
              calls.filters.push(["eq", column, value]);
              return {
                eq(nextColumn, nextValue) {
                  calls.filters.push(["eq", nextColumn, nextValue]);
                  return {
                    async gte(dateColumn, since) {
                      calls.filters.push(["gte", dateColumn, since]);
                      return { count, error: selectError };
                    },
                  };
                },
              };
            },
          };
        },
        async insert(value) {
          calls.inserts.push(value);
          if (throwOnInsert) throw new Error("insert rejected");
          return { error: insertError };
        },
      };
    },
  };
  return { sb, calls };
};

const scope = "portal_reply";
const key = "203.0.113.10:EX-42";

const allowed = makeClient();
assert.equal(await rateLimit(allowed.sb, scope, key, 8, 10), true);
assert.deepEqual(allowed.calls.select, [
  { columns: "*", options: { count: "exact", head: true } },
]);
assert.deepEqual(allowed.calls.filters.slice(0, 2), [
  ["eq", "scope", scope],
  ["eq", "key", key],
]);
assert.equal(allowed.calls.filters[2][0], "gte");
assert.equal(allowed.calls.filters[2][1], "created_at");
assert.equal(Number.isFinite(Date.parse(allowed.calls.filters[2][2])), true);
assert.deepEqual(allowed.calls.inserts, [{ scope, key }]);

const limited = makeClient({ count: 8 });
assert.equal(await rateLimit(limited.sb, scope, key, 8, 10), false);
assert.equal(limited.calls.inserts.length, 0);

const selectFailed = makeClient({
  count: null,
  selectError: { message: "select failed" },
});
let selectFailedResult;
await assert.doesNotReject(async () => {
  selectFailedResult = await rateLimit(selectFailed.sb, scope, key, 8, 10);
});
assert.equal(selectFailedResult, false);
assert.equal(selectFailed.calls.inserts.length, 0);

const insertFailed = makeClient({
  insertError: { message: "insert failed" },
});
let insertFailedResult;
await assert.doesNotReject(async () => {
  insertFailedResult = await rateLimit(insertFailed.sb, scope, key, 8, 10);
});
assert.equal(insertFailedResult, false);

for (const client of [
  makeClient({ throwOnSelect: true }),
  makeClient({ throwOnInsert: true }),
]) {
  let result;
  await assert.doesNotReject(async () => {
    result = await rateLimit(client.sb, scope, key, 8, 10);
  });
  assert.equal(result, false);
}
console.log("EDGE_PUBLIC_RESPONDER_HELPER_FAIL_CLOSED=PASS");

const responderRaw = readFileSync(join(root, responderPath), "utf8");
const responder = responderRaw
  .replace(/\/\*[\s\S]*?\*\//gu, "")
  .replace(/(^|[^:])\/\/.*$/gmu, "$1")
  .replace(/\s+/gu, "");
const offset = (token) => {
  const value = responder.indexOf(token);
  assert.notEqual(value, -1, `falta token semántico: ${token}`);
  return value;
};

const methodGate = offset('if(req.method!=="POST")');
const contentLengthRead = offset('req.headers.get("content-length")');
const preGuard413 = offset(
  'contentLength>BODY_PRE_GUARD_BYTES)returnjson({error:"Solicituddemasiadogrande"},413)',
);
const formData = offset("awaitreq.formData()");
assert.ok(methodGate < contentLengthRead);
assert.ok(contentLengthRead < preGuard413);
assert.ok(preGuard413 < formData);
console.log("LOCAL_PRE_GUARD_ONLY=PASS");

const present = offset("if(!folio||!token)");
const ticketQuery = offset(
  '.eq("folio",folio).eq("token_publico",token).maybeSingle()',
);
const found = offset('if(!t)returnjson({error:"Noencontrado"},404)');
const expiry = offset("if(t.token_publico_expira&&");
const closed = offset('if(["cerrado"].includes(lower(t.estado)))');
const rateCall = offset(
  'awaitrateLimit(sb,"portal_reply",`${ip}:${folio}`,PORTAL_REPLY_RATE_LIMIT,PORTAL_REPLY_RATE_WINDOW_MINUTES)',
);
assert.ok(formData < present);
assert.ok(present < ticketQuery);
assert.ok(ticketQuery < found);
assert.ok(found < expiry);
assert.ok(expiry < closed);
assert.ok(closed < rateCall);

for (const token of [
  "constfiles=[...form.entries()]",
  'sb.from("ticket_eventos")',
  ".insert(",
  'sb.storage.from("soporte_adjuntos").upload',
]) {
  assert.ok(rateCall < offset(token), `rate-limit debe preceder ${token}`);
}
assert.equal(
  responder.includes(
    'rateLimit(sb,"portal_reply",`${ip}:${folio}`,PORTAL_REPLY_RATE_LIMIT,PORTAL_REPLY_RATE_WINDOW_MINUTES)',
  ),
  true,
);
assert.equal(
  responder.includes(
    '`${ip}:${folio}`',
  ),
  true,
);
const keyExpression = responder.match(
  /rateLimit\(sb,"portal_reply",(`[^`]+`),PORTAL_REPLY_RATE_LIMIT/u,
)?.[1];
assert.equal(keyExpression, "`${ip}:${folio}`");
assert.equal(
  /(token|correo|cliente_id|user_agent|hash)/u.test(keyExpression),
  false,
);
console.log("EDGE_PUBLIC_RESPONDER_ORDER_CONTRACT=PASS");

const response429 =
  'if(!awaitrateLimit(sb,"portal_reply",`${ip}:${folio}`,PORTAL_REPLY_RATE_LIMIT,PORTAL_REPLY_RATE_WINDOW_MINUTES))returnjson({error:"Demasiadassolicitudes.Esperaunmomentoeinténtalodenuevo."},429)';
assert.equal(responder.includes(response429), true);
assert.equal((responder.match(/awaitrateLimit\(/gu) || []).length, 1);
console.log("EDGE_PUBLIC_RESPONDER_429_CONTRACT=PASS");

assert.equal(
  responder.includes(
    "constBODY_PRE_GUARD_BYTES=64*1024*1024,PORTAL_REPLY_RATE_LIMIT=8,PORTAL_REPLY_RATE_WINDOW_MINUTES=10;",
  ),
  true,
);

const supportCurrent = readFileSync(join(root, supportPath));
const supportBase = git(["show", `${base}:${supportPath}`], null);
assert.deepEqual(supportCurrent, supportBase);
assert.equal(
  git(["rev-parse", `${base}:${supportPath}`]).trim(),
  "c81b9db0fc37fe630df346a9e7c62931925e9107",
);
console.log("SUPPORT_SUBMIT_SECURE_UNCHANGED=PASS");

const actual = new Map();
for (const line of git(["diff", "--name-status", base, "--"])
  .trim()
  .split("\n")
  .filter(Boolean)) {
  const [action, path] = line.split("\t");
  actual.set(path, action);
}
for (const path of git(["ls-files", "--others", "--exclude-standard", "-z"])
  .split("\0")
  .filter(Boolean)) {
  assert.equal(actual.has(path), false, `path duplicado: ${path}`);
  actual.set(path, "A");
}
assert.deepEqual(
  [...actual.entries()].sort(),
  [...allowlist.entries()].sort(),
);
console.log("ANTIABUSE_ALLOWLIST_EXACT=PASS");

const implementationText = [...allowlist.keys()]
  .map((path) => readFileSync(join(root, path), "utf8"))
  .join("\n");
const remoteMutationSentinels = [
  ["supabase", "db", "push"].join(" "),
  ["supabase", "functions", "deploy"].join(" "),
  ["supabase", "migration", "up"].join(" "),
  ["mcp", "supabase", "apply", "migration"].join("_"),
];
for (const sentinel of remoteMutationSentinels) {
  assert.equal(
    implementationText.toLowerCase().includes(sentinel),
    false,
    `comando remoto prohibido: ${sentinel}`,
  );
}
for (const path of actual.keys()) {
  assert.equal(path.endsWith(".sql"), false);
  assert.equal(path.startsWith("supabase/migrations/"), false);
  assert.equal(path.startsWith(".github/workflows/"), false);
}
console.log("ANTIABUSE_NO_SQL_MIGRATIONS_DEPLOY=PASS");

const runner = readFileSync(join(root, runnerPath), "utf8");
assert.equal(runner.includes(contractTestPath.split("/").pop()), true);
assert.match(
  runner,
  /spawnSync\(process\.execPath,\s*\[\s*"--experimental-strip-types",\s*join\(root,\s*"tools\/edge-public-responder-antiabuse-contract\.test\.mjs"\),\s*root\s*\]/u,
);
console.log("EDGE_PUBLIC_RESPONDER_ANTIABUSE_CONTRACT=PASS");
