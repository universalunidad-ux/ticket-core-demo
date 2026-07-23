// TC-L100-SWVER-VERIFY-01 — contract test for app/sw.js
// Requirements: TC-U080 (cache version gate) and DIST-003 (API/Auth cache exclusion).
// Static, read-only verification. This test NEVER executes network, SQL, a browser,
// nor modifies sw.js. It reads sw.js as text and asserts real structure.
// Runner: node --test (Node 22, no external dependencies).
//
// Design note (anti-tautology): every clause below is paired, in the negative-mutant
// suite, with source mutations that remove or relax the corresponding guard. Each
// mutant must be "killed" (the guard must flip to false). Assertions that could not
// fail are forbidden (no assert.ok(true), no always-matching regex).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SW_URL = new URL('../app/sw.js', import.meta.url);
const src = readFileSync(SW_URL, 'utf8');

// ---------- structural helpers ----------
function slice(re, s = src) {
  const m = s.match(re);
  return m ? m[0] : '';
}
const RE_ISSENSITIVE = /const\s+isSensitive\s*=\s*request\s*=>\{[\s\S]*?\};/;
const RE_FETCH       = /self\.addEventListener\(\s*["']fetch["'][\s\S]*$/;
const RE_ACTIVATE    = /self\.addEventListener\(\s*["']activate["'][\s\S]*?\)\);/;
const RE_INSTALL     = /self\.addEventListener\(\s*["']install["'][\s\S]*?\)\);/;
const RE_NETFIRST    = /const\s+networkFirstPage\s*=[\s\S]*?\};/;

// Extract the sensitive URL-path alternation `(?:a|b|c)\/v1` -> ['a','b','c'].
// Scoped to the path regex so the "authorization" header string cannot leak a
// false "auth" match (that leak would make C-5 a tautology).
function sensitiveSegs(def) {
  const m = def.match(/\(\?:([a-z|]+)\)\\\/v1/);
  return m ? m[1].split('|') : [];
}

// ---------- guards (each returns boolean pass) ----------
const guard = {
  // C-1: explicit, non-empty cache version constant.
  C1(s = src) {
    const m = s.match(/const\s+RELEASE\s*=\s*(["'`])([^"'`]+)\1\s*;/);
    return !!m && m[2].trim().length > 0;
  },
  // C-2: cache names are template-versioned with ${RELEASE}; caches.open is never
  // called on a bare string literal (which would bypass the version).
  C2(s = src) {
    const staticVer = /const\s+STATIC_CACHE\s*=\s*`[^`]*\$\{RELEASE\}[^`]*`/.test(s);
    const pageVer   = /const\s+PAGE_CACHE\s*=\s*`[^`]*\$\{RELEASE\}[^`]*`/.test(s);
    const literalOpen = /caches\.open\(\s*["'`][^)]*["'`]\s*\)/.test(s); // violation if present
    return staticVer && pageVer && !literalOpen;
  },
  // C-3: precache asset graph exists and is written into the versioned caches at
  // install (never into a bare/unversioned cache).
  C3(s = src) {
    const install = slice(RE_INSTALL, s);
    const pageArr   = /const\s+PAGE_SHELLS\s*=\s*\[[^\]]+\]/.test(s);
    const staticArr = /const\s+STATIC_ASSETS\s*=\s*\[[^\]]+\]/.test(s);
    const pageInto   = /cacheAllAvailable\(\s*PAGE_CACHE\s*,\s*PAGE_SHELLS\s*\)/.test(install);
    const staticInto = /cacheAllAvailable\(\s*STATIC_CACHE\s*,\s*STATIC_ASSETS\s*\)/.test(install);
    const literalCacheArg = /cacheAllAvailable\(\s*["'`]/.test(install); // violation
    return pageArr && staticArr && pageInto && staticInto && !literalCacheArg;
  },
  // C-3b (version gate): activate() cleans previous (non-current) caches, keeping
  // only the current versioned caches.
  CLEAN(s = src) {
    const activate = slice(RE_ACTIVATE, s);
    const keys   = /caches\.keys\(\)/.test(activate);
    const filter = /!\[\s*STATIC_CACHE\s*,\s*PAGE_CACHE\s*\]\.includes\(\s*key\s*\)/.test(activate);
    const del    = /caches\.delete\(\s*key\s*\)/.test(activate);
    return keys && filter && del;
  },
  // C-4: API/Supabase routes (rest/functions/storage under /v1) are excluded from
  // cache-first via isSensitive() + an early return in the fetch handler.
  C4(s = src) {
    const segs = sensitiveSegs(slice(RE_ISSENSITIVE, s));
    const apiSegs = segs.includes('rest') && segs.includes('functions') && segs.includes('storage');
    const earlyReturn = /isSensitive\(\s*request\s*\)\s*\)\s*return\s*;/.test(slice(RE_FETCH, s));
    return apiSegs && earlyReturn;
  },
  // C-5: Auth routes (/auth/v1) and any Authorization-bearing request are excluded
  // from cache-first via isSensitive() + the same early return.
  C5(s = src) {
    const def = slice(RE_ISSENSITIVE, s);
    const authSeg = sensitiveSegs(def).includes('auth');
    const authHeader = /headers\.has\(\s*["'`]authorization["'`]\s*\)/i.test(def);
    const earlyReturn = /isSensitive\(\s*request\s*\)\s*\)\s*return\s*;/.test(slice(RE_FETCH, s));
    return authSeg && authHeader && earlyReturn;
  },
  // C-6: credible network-first / no-store strategy — navigation goes through
  // networkFirstPage (which fetches no-store before touching cache), assets are
  // cache-first ONLY when ?v===RELEASE, and everything else falls through to a
  // no-store network fetch.
  C6(s = src) {
    const nf = slice(RE_NETFIRST, s);
    const fh = slice(RE_FETCH, s).trim();
    const nfNoStore = /fetch\(\s*request\s*,\s*\{\s*cache\s*:\s*["']no-store["']\s*\}\s*\)/.test(nf);
    const navNetworkFirst = /request\.mode\s*===\s*["']navigate["']\s*\)\s*return\s+event\.respondWith\(\s*networkFirstPage\(/.test(fh);
    const versionGatedAsset = /url\.searchParams\.get\(\s*["']v["']\s*\)\s*===\s*RELEASE\s*\)\s*return\s+event\.respondWith\(\s*cacheFirstVersionedAsset\(/.test(fh);
    const fallthroughNoStore = /event\.respondWith\(\s*fetch\(\s*request\s*,\s*\{\s*cache\s*:\s*["']no-store["']\s*\}\s*\)\s*\)\s*\}\s*\)\s*;?$/.test(fh);
    return nfNoStore && navNetworkFirst && versionGatedAsset && fallthroughNoStore;
  },
};

// ---------- positive clause tests (must pass on the real sw.js) ----------
test('C-1 explicit non-empty cache version constant', () => {
  assert.match(src, /const\s+RELEASE\s*=\s*['"`][^'"`]+['"`]/);
  assert.equal(guard.C1(), true, 'RELEASE must be an explicit, non-empty version literal');
});

test('C-2 cache name incorporates the version (no fixed literal, no bare caches.open)', () => {
  assert.match(src, /const\s+STATIC_CACHE\s*=\s*`[^`]*\$\{RELEASE\}[^`]*`/);
  assert.match(src, /const\s+PAGE_CACHE\s*=\s*`[^`]*\$\{RELEASE\}[^`]*`/);
  assert.doesNotMatch(src, /caches\.open\(\s*["'`][^)]*["'`]\s*\)/, 'caches.open must use a versioned identifier, not a string literal');
  assert.equal(guard.C2(), true);
});

test('C-3 asset graph is precached into the versioned caches', () => {
  assert.match(src, /const\s+PAGE_SHELLS\s*=\s*\[[^\]]+\]/);
  assert.match(src, /const\s+STATIC_ASSETS\s*=\s*\[[^\]]+\]/);
  assert.equal(guard.C3(), true, 'precache lists must be written to the versioned caches at install');
  assert.equal(guard.CLEAN(), true, 'activate must delete previous (non-current) caches — version gate cleanup');
});

test('C-4 API/Supabase routes are excluded from cache-first', () => {
  const segs = sensitiveSegs(slice(RE_ISSENSITIVE));
  assert.ok(segs.includes('rest') && segs.includes('functions') && segs.includes('storage'),
    'isSensitive must cover Supabase REST/Functions/Storage API paths');
  assert.match(slice(RE_FETCH), /isSensitive\(\s*request\s*\)\s*\)\s*return\s*;/,
    'fetch handler must early-return on sensitive requests (never cache-first)');
  assert.equal(guard.C4(), true);
});

test('C-5 Auth routes and Authorization requests are excluded from cache-first', () => {
  const def = slice(RE_ISSENSITIVE);
  assert.ok(sensitiveSegs(def).includes('auth'), 'isSensitive must cover /auth/v1 paths');
  assert.match(def, /headers\.has\(\s*["'`]authorization["'`]\s*\)/i,
    'isSensitive must exclude any Authorization-bearing request');
  assert.equal(guard.C5(), true);
});

test('C-6 credible network-first / no-store strategy', () => {
  assert.match(slice(RE_NETFIRST), /fetch\(\s*request\s*,\s*\{\s*cache\s*:\s*["']no-store["']\s*\}\s*\)/,
    'navigation must fetch network-first with no-store');
  assert.equal(guard.C6(), true,
    'navigate -> networkFirstPage, assets cache-first only when ?v===RELEASE, else no-store network');
});

// ---------- negative-mutant suite (sensitivity) ----------
// Each mutant removes or relaxes exactly one guard. A mutant is "killed" when the
// mutation actually applied AND the paired guard flips to false. If any guard is a
// tautology, its mutant survives and this suite fails.
const MUTANTS = [
  { id: 'M1  version literal emptied',            req: 'C-1',     guard: 'C1',
    mutate: s => s.replace(/const\s+RELEASE\s*=\s*"[^"]+";/, 'const RELEASE="";') },
  { id: 'M2a cache name hard-coded (unversioned)', req: 'C-2',     guard: 'C2',
    mutate: s => s.replace('`ticket-core-static-${RELEASE}`', '"ticket-core-static"') },
  { id: 'M2b caches.open on a string literal',     req: 'C-2',     guard: 'C2',
    mutate: s => s.replace('caches.open(STATIC_CACHE),cached', 'caches.open("static-cache"),cached') },
  { id: 'M3  assets cached into unversioned cache', req: 'C-3',    guard: 'C3',
    mutate: s => s.replace('cacheAllAvailable(STATIC_CACHE,STATIC_ASSETS)', 'cacheAllAvailable("tc-static",STATIC_ASSETS)') },
  { id: 'M4a old-cache delete removed',            req: 'C-3b',    guard: 'CLEAN',
    mutate: s => s.replace('.map(key=>caches.delete(key))', '.map(key=>key)') },
  { id: 'M4b cleanup filter keeps every cache',    req: 'C-3b',    guard: 'CLEAN',
    mutate: s => s.replace('&&![STATIC_CACHE,PAGE_CACHE].includes(key)', '&&false') },
  { id: 'M5a API segments dropped from isSensitive', req: 'C-4',   guard: 'C4',
    mutate: s => s.replace('auth|rest|functions|storage', 'auth') },
  { id: 'M5b fetch early-return on sensitive removed', req: 'C-4/C-5', guard: 'C4',
    mutate: s => s.replace('||isSensitive(request))return;', ')return;') },
  { id: 'M6a auth segment dropped from isSensitive', req: 'C-5',   guard: 'C5',
    mutate: s => s.replace('auth|rest|functions|storage', 'rest|functions|storage') },
  { id: 'M6b Authorization-header guard removed',   req: 'C-5',    guard: 'C5',
    mutate: s => s.replace('request.headers.has("authorization")||', '') },
  { id: 'M7a navigation switched to cache-first',   req: 'C-6',    guard: 'C6',
    mutate: s => s.replace('event.respondWith(networkFirstPage(request))', 'event.respondWith(cacheFirstVersionedAsset(request))') },
  { id: 'M7b no-store dropped from fallthrough',    req: 'C-6',    guard: 'C6',
    mutate: s => s.replace('event.respondWith(fetch(request,{cache:"no-store"}))})', 'event.respondWith(fetch(request))})') },
  { id: 'M7c asset version gate opened (?v check -> true)', req: 'C-6', guard: 'C6',
    mutate: s => s.replace('url.searchParams.get("v")===RELEASE', 'true') },
];

test('negative mutants — every relaxed guard must die', async (t) => {
  let killed = 0;
  for (const m of MUTANTS) {
    await t.test(`${m.id} [${m.req}]`, () => {
      const mutated = m.mutate(src);
      assert.notEqual(mutated, src, `mutation did not apply: ${m.id}`);
      assert.equal(guard[m.guard](mutated), false, `guard ${m.guard} did not detect mutation ${m.id} (tautology?)`);
      killed++;
    });
  }
  assert.equal(killed, MUTANTS.length, 'all mutants must be killed');
  assert.ok(MUTANTS.length >= 6, 'sensitivity suite must be non-trivial');
});
