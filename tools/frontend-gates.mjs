#!/usr/bin/env node
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(process.argv[2] || ".");
const failures = [];
const skipDirs = new Set([".git", "node_modules", "_CHECKPOINT_GLOBAL_PARITY", "_DEMO_BUILDS"]);
const textExt = new Set([".html", ".js", ".mjs", ".css", ".json", ".webmanifest", ".md", ".yml", ".yaml"]);
const files = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (skipDirs.has(name) || name.startsWith("_CHECKPOINT_GLOBAL_PARITY_")) continue;
    const file = join(dir, name);
    const st = statSync(file);
    if (st.isDirectory()) walk(file);
    else files.push(file);
  }
}
walk(root);

const rel = file => relative(root, file).replaceAll("\\", "/");
const fail = (code, file, detail) => failures.push(`${code}\t${rel(file)}\t${detail}`);
const stripRef = value => value.trim().replace(/^['"]|['"]$/g, "").split(/[?#]/, 1)[0];
const external = value => !value || /^(?:[a-z]+:|\/\/|#|data:|blob:)/i.test(value);
function resolveLocal(owner, raw) {
  const value = stripRef(raw);
  if (external(value)) return null;
  if (value.startsWith("/")) {
    const clean = value.replace(/^\/(?:ticket-core-demo\/)?/, "");
    return resolve(root, clean || "index.html");
  }
  return resolve(dirname(owner), decodeURIComponent(value));
}
function checkRef(owner, raw, kind) {
  const target = resolveLocal(owner, raw);
  if (!target) return;
  if (!target.startsWith(root) || !existsSync(target)) fail(`${kind}_MISSING`, owner, raw);
}

for (const file of files) {
  const ext = extname(file).toLowerCase();
  if (!textExt.has(ext)) continue;
  const source = readFileSync(file, "utf8");
  if (/[\u00c2\u00c3\ufffd]|\u00e2(?:\u20ac|\u2122|\u0153|\u017e|\u02c6)/u.test(source)) fail("MOJIBAKE", file, "secuencia UTF-8 corrupta");

  if (ext === ".js" || ext === ".mjs") {
    const checked = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    if (checked.status !== 0) fail("JS_SYNTAX", file, (checked.stderr || checked.stdout).trim().split("\n").slice(-2).join(" "));
    const importRe = /(?:import\s+(?:[^'";]+?\s+from\s+)?|export\s+[^'";]+?\s+from\s+|import\s*\()(["'])(\.{1,2}\/[^"']+)\1/g;
    for (const m of source.matchAll(importRe)) checkRef(file, m[2], "IMPORT");
  }

  if (ext === ".html") {
    const ids = new Map();
    for (const m of source.matchAll(/\bid\s*=\s*(["'])([^"']+)\1/gi)) ids.set(m[2], (ids.get(m[2]) || 0) + 1);
    for (const [id, count] of ids) if (count > 1) fail("DUPLICATE_ID", file, `${id} x${count}`);
    for (const m of source.matchAll(/\b(?:src|href)\s*=\s*(["'])([^"']+)\1/gi)) checkRef(file, m[2], "HTML_REF");
  }

  if (ext === ".css") {
    let depth = 0;
    const clean = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(['"])(?:\\.|(?!\1)[\s\S])*\1/g, "");
    for (const char of clean) { if (char === "{") depth++; if (char === "}") depth--; if (depth < 0) break; }
    if (depth !== 0) fail("CSS_BALANCE", file, `balance=${depth}`);
    for (const m of source.matchAll(/url\(\s*([^)]+?)\s*\)/gi)) checkRef(file, m[1], "CSS_ASSET");
    for (const m of source.matchAll(/@import\s+(?:url\()?\s*(["'][^"']+["'])/gi)) checkRef(file, m[1], "CSS_IMPORT");
  }
}

const forbiddenFiles = files.filter(file => /(^|\/)supabase\.config\.local\.js$/i.test(rel(file)) || /(^|\/)\.env$/i.test(rel(file)));
for (const file of forbiddenFiles) fail("FORBIDDEN_FILE", file, "configuración local o .env");
for (const required of [".nojekyll", "app/index.html", "app/supabase.config.public.js", "app/sw.js"]) {
  if (!existsSync(join(root, required))) failures.push(`PAGES_REQUIRED\t${required}\tarchivo ausente`);
}

if (failures.length) {
  console.error(failures.join("\n"));
  console.error(`FRONTEND_GATES: FAIL (${failures.length})`);
  process.exit(1);
}
console.log(`FRONTEND_GATES: PASS (${files.length} archivos; JS/imports/HTML/CSS/IDs/mojibake/assets/Pages)`);
