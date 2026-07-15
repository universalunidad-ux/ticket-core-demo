#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(process.argv[2] || ".");
const app = join(root, "app");
const failures = [];
const forbiddenFixture = join(app, "janome-test-tickets.json");
if (existsSync(forbiddenFixture)) failures.push("app/janome-test-tickets.json: fixture con identidades no pertenece al artefacto público");

function visit(value, path, file) {
  if (Array.isArray(value)) return value.forEach((x, i) => visit(x, `${path}[${i}]`, file));
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const next = path ? `${path}.${key}` : key;
    if (/^(?:correo|email)$/i.test(key) && typeof child === "string" && child && !/@example\.(?:com|org|net|test)$/i.test(child)) failures.push(`${relative(root, file)}:${next}: correo no sintético`);
    if (/^(?:telefono|phone|celular|whatsapp)$/i.test(key) && typeof child === "string" && /\d{8,}/.test(child)) failures.push(`${relative(root, file)}:${next}: teléfono en fixture público`);
    visit(child, next, file);
  }
}
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const file = join(dir, name), st = statSync(file);
    if (st.isDirectory()) walk(file);
    else if (name.endsWith(".json")) {
      try { visit(JSON.parse(readFileSync(file, "utf8")), "", file); }
      catch { /* frontend-gates cubre referencias; JSON no parseable se revisa aparte */ }
    }
  }
}
walk(app);
if (failures.length) { console.error(failures.join("\n")); console.error("PII_GATE: FAIL"); process.exit(1); }
console.log("PII_GATE: PASS");
