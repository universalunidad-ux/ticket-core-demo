#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CANONICAL_A11Y_PAGES = [
  "index.html",
  "app/alta-cliente.html",
  "app/aviso-privacidad.html",
  "app/bitacora-admin.html",
  "app/cliente.html",
  "app/clientes.html",
  "app/consolidacion-clientes.html",
  "app/dashboard.html",
  "app/estado.html",
  "app/index.html",
  "app/soporte.html",
  "app/terminos.html",
  "app/ticket.html",
  "app/tickets.html",
];

const cleanText = value => String(value || "")
  .replace(/<script\b[\s\S]*?<\/script>/gi, "")
  .replace(/<style\b[\s\S]*?<\/style>/gi, "")
  .replace(/<[^>]+>/g, " ")
  .replace(/&(?:nbsp|#160);/gi, " ")
  .replace(/\s+/g, " ")
  .trim();

const attrsOf = source => {
  const attrs = new Map();
  for (const match of source.matchAll(/([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    attrs.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attrs;
};

const tagsOf = html => [...html.matchAll(/<([a-z][\w:-]*)\b([^>]*)>/gi)].map(match => ({
  name: match[1].toLowerCase(),
  attrs: attrsOf(match[2]),
  raw: match[0],
  offset: match.index,
}));

export function auditHtml(html, file = "fixture.html") {
  const tags = tagsOf(html);
  const findings = [];
  const add = (rule, severity, message) => findings.push({ rule, severity, file, message });
  const count = name => tags.filter(tag => tag.name === name).length;
  const ids = new Map();
  for (const tag of tags) {
    const id = tag.attrs.get("id");
    if (id) ids.set(id, (ids.get(id) || 0) + 1);
  }

  if (count("h1") !== 1) add("single-h1", "P1", `expected 1 h1; observed ${count("h1")}`);
  if (count("main") !== 1) add("main-landmark", "P1", `expected 1 main; observed ${count("main")}`);
  for (const [id, observed] of ids) if (observed > 1) add("unique-id", "P1", `duplicate id #${id} (${observed})`);

  for (const tag of tags) {
    for (const attr of ["aria-controls", "aria-describedby", "aria-labelledby"]) {
      for (const ref of (tag.attrs.get(attr) || "").split(/\s+/).filter(Boolean)) {
        if (!ids.has(ref)) add("aria-reference", "P1", `${attr} references missing #${ref}`);
      }
    }
  }

  const labelTargets = new Set(tags.filter(tag => tag.name === "label").map(tag => tag.attrs.get("for")).filter(Boolean));
  for (const tag of tags) {
    const hidden = (tag.attrs.get("type") || "").toLowerCase() === "hidden" || tag.attrs.has("hidden") || tag.attrs.get("aria-hidden") === "true";
    if (["input", "select", "textarea"].includes(tag.name) && !hidden) {
      const openLabel = html.lastIndexOf("<label", tag.offset);
      const closeLabel = html.lastIndexOf("</label>", tag.offset);
      const wrapped = openLabel > closeLabel && html.indexOf("</label>", tag.offset) >= 0;
      const named = wrapped || tag.attrs.has("aria-label") || tag.attrs.has("aria-labelledby") || tag.attrs.has("title") || labelTargets.has(tag.attrs.get("id"));
      if (!named) add("form-control-name", "P2", `${tag.name}${tag.attrs.get("id") ? `#${tag.attrs.get("id")}` : ""} has no accessible name`);
    }
    if (tag.name === "button") {
      if (!tag.attrs.has("type")) add("button-type", "P2", `button${tag.attrs.get("id") ? `#${tag.attrs.get("id")}` : ""} has no explicit type`);
      const end = html.indexOf("</button>", tag.offset);
      const body = end < 0 ? "" : html.slice(tag.offset + tag.raw.length, end);
      if (!tag.attrs.has("aria-label") && !tag.attrs.has("aria-labelledby") && !tag.attrs.has("title") && !cleanText(body)) add("control-name", "P2", "button has no accessible name");
    }
    if (tag.name === "img" && !tag.attrs.has("alt")) add("image-alternative", "P2", `img${tag.attrs.get("id") ? `#${tag.attrs.get("id")}` : ""} has no alt`);
    if (/^[1-9]\d*$/.test(tag.attrs.get("tabindex") || "")) add("positive-tabindex", "P2", `${tag.name} uses positive tabindex`);
    if ((tag.attrs.get("role") || "").toLowerCase() === "dialog" || tag.name === "dialog") {
      if (!tag.attrs.has("aria-label") && !tag.attrs.has("aria-labelledby")) add("dialog-name", "P1", "dialog has no accessible name");
    }
  }

  const htmlTag = tags.find(tag => tag.name === "html");
  if (!htmlTag?.attrs.get("lang")) add("document-language", "P2", "html has no language");
  if (!/<title\b[^>]*>\s*[^<\s][\s\S]*?<\/title>/i.test(html)) add("document-title", "P2", "document title is empty or missing");
  if (!/<meta\b[^>]*name=["']viewport["'][^>]*>/i.test(html)) add("mobile-viewport", "P2", "viewport metadata is missing");

  return { file, pass: findings.length === 0, p1: findings.filter(item => item.severity === "P1").length, p2: findings.filter(item => item.severity === "P2").length, findings };
}

export function runAudit({ root, evidenceDir }) {
  mkdirSync(evidenceDir, { recursive: true });
  const reports = CANONICAL_A11Y_PAGES.map(file => auditHtml(readFileSync(join(root, file), "utf8"), file));
  for (const report of reports) {
    const name = report.file.replaceAll("/", "__").replace(/\.html$/, "") + ".json";
    writeFileSync(join(evidenceDir, name), JSON.stringify(report, null, 2) + "\n");
  }
  const summary = {
    audit: reports.every(report => report.pass) ? "PASS" : "FAIL",
    pages: reports.length,
    pagesPass: reports.filter(report => report.pass).length,
    p1: reports.reduce((sum, report) => sum + report.p1, 0),
    p2: reports.reduce((sum, report) => sum + report.p2, 0),
    reports,
    automatedCoverage: ["headings", "landmarks", "names", "labels", "aria references", "unique ids", "dialog names", "button types", "tab order", "image alternatives", "language", "title", "viewport"],
    humanOnlyNotClaimed: ["meaningful reading order", "visual contrast beyond deterministic gates", "screen-reader comprehension", "mobile target usability"],
  };
  writeFileSync(join(evidenceDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  return summary;
}

function main() {
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const flag = process.argv.indexOf("--evidence-dir");
  if (flag < 0 || !process.argv[flag + 1]) throw new Error("EVIDENCE_DIR_REQUIRED");
  const summary = runAudit({ root, evidenceDir: resolve(process.argv[flag + 1]) });
  console.log(`A11Y_WCAG_AUDIT=${summary.audit}`);
  console.log(`A11Y_PAGES=${summary.pages}`);
  console.log(`A11Y_PAGES_PASS=${summary.pagesPass}`);
  console.log(`A11Y_P1=${summary.p1}`);
  console.log(`A11Y_P2=${summary.p2}`);
  if (summary.audit !== "PASS") process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
