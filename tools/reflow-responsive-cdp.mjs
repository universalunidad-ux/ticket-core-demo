#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const UNIT = "TC-A11Y-REFLOW-RESPONSIVE-EXACT-HEAD-01";
const EDGE = "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXACT_HEAD = execFileSync("git", ["-C", ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
assert.match(EXACT_HEAD, /^[0-9a-f]{40}$/, "exact Git HEAD is required for reflow provenance");
const CANONICAL_PAGES = [
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
const CANONICAL_VIEWPORTS = [
  { width: 320, height: 844 },
  { width: 375, height: 844 },
  { width: 390, height: 844 },
  { width: 768, height: 900 },
  { width: 1280, height: 900 },
];
const ROUTE_QUERY = new Map([
  ["app/cliente.html", "?id=local-reflow-fixture"],
  ["app/ticket.html", "?id=local-reflow-fixture"],
  ["app/tickets.html", "?readonly=1"],
]);
const MIME = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
]);

const args = process.argv.slice(2);
const outArg = args.indexOf("--out");
assert(outArg >= 0 && args[outArg + 1], "usage: node tools/reflow-responsive-cdp.mjs --out ABSOLUTE_DIRECTORY");
const OUT = resolve(args[outArg + 1]);
assert(OUT.startsWith("/Users/jaziel/Documents/EXPIRITI_REPOS/"), "output must remain under EXPIRITI_REPOS");
const pagesArg = args.indexOf("--pages");
const widthsArg = args.indexOf("--widths");
const targeted = args.includes("--targeted");
const PAGES = pagesArg >= 0 ? args[pagesArg + 1].split(",") : CANONICAL_PAGES;
const requestedWidths = widthsArg >= 0 ? args[widthsArg + 1].split(",").map(Number) : CANONICAL_VIEWPORTS.map(x => x.width);
const VIEWPORTS = CANONICAL_VIEWPORTS.filter(viewport => requestedWidths.includes(viewport.width));
assert(PAGES.length > 0 && PAGES.every(page => CANONICAL_PAGES.includes(page)), "all selected pages must be canonical");
assert(VIEWPORTS.length > 0 && VIEWPORTS.length === requestedWidths.length, "all selected widths must be canonical");
if (!targeted) {
  assert.deepEqual(PAGES, CANONICAL_PAGES, "full mode requires all 13 canonical pages");
  assert.deepEqual(requestedWidths, CANONICAL_VIEWPORTS.map(x => x.width), "full mode requires all five canonical widths");
}

const terminal = [];
const log = line => {
  const entry = `${new Date().toISOString()}\t${line}`;
  terminal.push(entry);
  process.stdout.write(`${entry}\n`);
};
const delay = ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms));
const esc = value => String(value ?? "").replaceAll("\t", " ").replaceAll("\r", " ").replaceAll("\n", " ");
const tsv = (header, rows) => `${header.join("\t")}\n${rows.map(row => header.map(key => esc(row[key])).join("\t")).join("\n")}\n`;

async function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url || "/", "http://127.0.0.1");
      const decoded = decodeURIComponent(requestUrl.pathname);
      const candidate = resolve(ROOT, `.${normalize(decoded)}`);
      if (!(candidate === ROOT || candidate.startsWith(`${ROOT}/`))) {
        res.writeHead(403).end("forbidden");
        return;
      }
      let file = candidate;
      if ((await stat(file)).isDirectory()) file = join(file, "index.html");
      const body = await readFile(file);
      res.writeHead(200, {
        "cache-control": "no-store",
        "content-type": MIME.get(extname(file).toLowerCase()) || "application/octet-stream",
      });
      res.end(body);
    } catch {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("not found");
    }
  });
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  return server;
}

async function waitForDebugger(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return response.json();
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`debugger endpoint unavailable: ${lastError?.message || "timeout"}`);
}

async function createTarget(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" });
  assert(response.ok, `cannot create CDP target: ${response.status}`);
  return response.json();
}

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.waiters = new Map();
  }
  async open() {
    await new Promise((resolvePromise, reject) => {
      this.ws.addEventListener("open", resolvePromise, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
    this.ws.addEventListener("message", event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(`${message.error.code}: ${message.error.message}`));
        else pending.resolve(message.result);
        return;
      }
      if (message.method === "Fetch.requestPaused") {
        const url = message.params.request.url;
        const method = url.startsWith(this.localOrigin) ? "Fetch.continueRequest" : "Fetch.failRequest";
        const params = method === "Fetch.continueRequest"
          ? { requestId: message.params.requestId }
          : { requestId: message.params.requestId, errorReason: "BlockedByClient" };
        this.send(method, params).catch(() => {});
      }
      const listeners = this.waiters.get(message.method) || [];
      this.waiters.delete(message.method);
      for (const listener of listeners) listener(message.params);
    });
    return this;
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  wait(method, timeoutMs = 12000) {
    return new Promise((resolvePromise, reject) => {
      const timeout = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), timeoutMs);
      const listener = params => {
        clearTimeout(timeout);
        resolvePromise(params);
      };
      this.waiters.set(method, [...(this.waiters.get(method) || []), listener]);
    });
  }
  close() {
    this.ws.close();
  }
}

const MEASURE_EXPRESSION = `(() => {
  const viewportWidth = window.innerWidth;
  const root = document.documentElement;
  const body = document.body;
  const hiddenTechnique = (el, cs, r) => {
    if (el.closest(".sr-only,.sp-hp,[aria-hidden='true'],[inert]")) return true;
    if ((cs.clip !== "auto" || cs.clipPath !== "none") && r.width <= 2 && r.height <= 32) return true;
    return false;
  };
  const visible = (el, cs, r) => {
    if (!r || r.width <= 0 || r.height <= 0) return false;
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return false;
    if (el.hidden || el.getAttribute("aria-hidden") === "true") return false;
    for (let parent = el.parentElement; parent; parent = parent.parentElement) {
      const parentStyle = getComputedStyle(parent);
      if (parentStyle.display === "none" || parentStyle.visibility === "hidden" || Number(parentStyle.opacity) === 0) return false;
      if (parent.hidden) return false;
    }
    return true;
  };
  const intersectsViewport = r => r.right > 0 && r.left < viewportWidth && r.bottom > 0 && r.top < innerHeight;
  const offCanvasState = el => {
    for (let owner = el; owner && owner !== body; owner = owner.parentElement) {
      const ownerStyle = getComputedStyle(owner);
      const ownerRect = owner.getBoundingClientRect();
      const transformedOffscreen = ownerStyle.transform !== "none" &&
        (ownerRect.right <= 0 || ownerRect.left >= viewportWidth || ownerRect.bottom <= 0 || ownerRect.top >= innerHeight);
      const knownClosedSurface = owner.matches(".ticket-side,.polizas-side,.quick-panel") &&
        !owner.matches(".open") && !body.classList.contains("tk-side-open");
      if (transformedOffscreen || knownClosedSurface) return true;
    }
    return false;
  };
  const selector = el => {
    if (el.id) return "#" + CSS.escape(el.id);
    const parts = [];
    for (let node = el; node && node.nodeType === 1 && parts.length < 5; node = node.parentElement) {
      let part = node.localName;
      if (node.classList.length) part += "." + [...node.classList].slice(0, 2).map(CSS.escape).join(".");
      const siblings = node.parentElement ? [...node.parentElement.children].filter(x => x.localName === node.localName) : [];
      if (siblings.length > 1) part += ":nth-of-type(" + (siblings.indexOf(node) + 1) + ")";
      parts.unshift(part);
    }
    return parts.join(">");
  };
  const label = el => (el.getAttribute("aria-label") || el.getAttribute("title") || el.innerText || el.value || el.name || el.id || el.localName).trim().replace(/\\s+/g, " ").slice(0, 120);
  const elements = [...document.querySelectorAll("body *")];
  const records = elements.map(el => {
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return { el, cs, rect, isVisible: visible(el, cs, rect) };
  });
  const findings = { outside: [], controls24: [], controls44: [], overlaps: [], clipping: [], scrollContainers: [], invisibleOutside: [] };
  const add = (bucket, el, extra = {}) => bucket.push({
    selector: selector(el),
    label: label(el),
    tag: el.localName,
    x: Math.round(extra.rect?.x ?? el.getBoundingClientRect().x),
    y: Math.round(extra.rect?.y ?? el.getBoundingClientRect().y),
    width: Math.round(extra.rect?.width ?? el.getBoundingClientRect().width),
    height: Math.round(extra.rect?.height ?? el.getBoundingClientRect().height),
    ...extra,
    rect: undefined,
  });
  for (const rec of records) {
    const { el, cs, rect, isVisible } = rec;
    const outside = rect.left < -1 || rect.right > viewportWidth + 1;
    if ((!isVisible || hiddenTechnique(el, cs, rect)) && outside && rect.width > 0 && rect.height > 0) {
      add(findings.invisibleOutside, el, { rect, reason: "not_visually_exposed" });
      continue;
    }
    if (!isVisible) continue;
    if (outside) {
      const scroller = el.parentElement?.closest("*");
      let intentional = false;
      let owner = el.parentElement;
      while (owner && owner !== body) {
        const ownerStyle = getComputedStyle(owner);
        if ((ownerStyle.overflowX === "auto" || ownerStyle.overflowX === "scroll") && owner.scrollWidth > owner.clientWidth + 1) {
          intentional = true;
          break;
        }
        owner = owner.parentElement;
      }
      const classification = intentional
        ? "INSIDE_INTENTIONAL_SCROLL"
        : offCanvasState(el)
          ? "CONTENT_HIDDEN_BY_BREAKPOINT_OR_RUNTIME_STATE"
          : "VISIBLE_OUTSIDE_VIEWPORT";
      add(findings.outside, el, { rect, classification });
    }
    const hasOwnText = [...el.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
    const horizontalClip = el.scrollWidth > el.clientWidth + 1;
    const verticalClip = el.scrollHeight > el.clientHeight + 1;
    const clips = ["hidden", "clip"].includes(cs.overflowX) || ["hidden", "clip"].includes(cs.overflowY);
    if (hasOwnText && !hiddenTechnique(el, cs, rect) && intersectsViewport(rect) && clips && (horizontalClip || verticalClip)) {
      add(findings.clipping, el, {
        rect,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        textOverflow: cs.textOverflow,
        whiteSpace: cs.whiteSpace,
        classification: cs.textOverflow === "ellipsis" || cs.webkitLineClamp !== "none"
          ? "INTENTIONAL_TEXT_TRUNCATION"
          : "TEXT_CLIPPED",
      });
    }
    if ((cs.overflowX === "auto" || cs.overflowX === "scroll") && el.scrollWidth > el.clientWidth + 1) {
      const tableLike = Boolean(el.matches("table,[role=grid],.table-wrap,.table-scroll") || el.querySelector("table,[role=grid]"));
      add(findings.scrollContainers, el, {
        rect,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        classification: tableLike ? "INTENTIONAL_TABLE_SCROLL" : "INTENTIONAL_PANEL_SCROLL",
      });
    }
  }
  const interactiveSelector = [
    "a[href]", "button", "input:not([type=hidden])", "select", "textarea",
    "summary", "[role=button]", "[role=link]", "[role=tab]"
  ].join(",");
  const controls = [...document.querySelectorAll(interactiveSelector)].map(el => {
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return { el, cs, rect, isVisible: visible(el, cs, rect) };
  }).filter(x => x.isVisible && !hiddenTechnique(x.el, x.cs, x.rect) && intersectsViewport(x.rect) && !offCanvasState(x.el));
  for (const rec of controls) {
    const { el, rect } = rec;
    if (rect.width < 24 || rect.height < 24) add(findings.controls24, el, { rect, classification: "TARGET_BELOW_24" });
    const primary = el.matches("button[type=submit],input[type=submit],button.primary,.btn.primary,.btn-brand,[data-primary],#tcAdminEscalateBtn");
    if (primary && (rect.width < 44 || rect.height < 44)) add(findings.controls44, el, { rect, classification: "PRIMARY_TARGET_BELOW_44" });
  }
  for (let i = 0; i < controls.length; i++) {
    const a = controls[i];
    for (let j = i + 1; j < controls.length; j++) {
      const b = controls[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const width = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
      const height = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
      if (width > 2 && height > 2) {
        const midX = Math.max(0, Math.min(viewportWidth - 1, Math.max(a.rect.left, b.rect.left) + width / 2));
        const midY = Math.max(0, Math.min(innerHeight - 1, Math.max(a.rect.top, b.rect.top) + height / 2));
        const hit = document.elementsFromPoint(midX, midY);
        if (!hit.some(el => el === a.el || a.el.contains(el)) || !hit.some(el => el === b.el || b.el.contains(el))) continue;
        const compositeA = a.el.closest(".composer-input-wrap,.quick-replies-wrap");
        const compositeB = b.el.closest(".composer-input-wrap,.quick-replies-wrap");
        findings.overlaps.push({
          selector: selector(a.el),
          label: label(a.el),
          otherSelector: selector(b.el),
          otherLabel: label(b.el),
          width: Math.round(width),
          height: Math.round(height),
          classification: compositeA && compositeA === compositeB ? "INTENTIONAL_COMPOSITE_CONTROL" : "INTERACTIVE_OVERLAP",
        });
      }
    }
  }
  const landmark = name => {
    const el = document.querySelector(name);
    if (!el) return "ABSENT";
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return visible(el, cs, rect) ? "VISIBLE" : "HIDDEN_BREAKPOINT_OR_STATE";
  };
  const visibleKeys = records.filter(x => x.isVisible).map(x => selector(x.el));
  return {
    title: document.title,
    path: location.pathname,
    innerWidth: viewportWidth,
    innerHeight: window.innerHeight,
    clientWidth: root.clientWidth,
    scrollWidth: Math.max(root.scrollWidth, body?.scrollWidth || 0),
    clientHeight: root.clientHeight,
    scrollHeight: Math.max(root.scrollHeight, body?.scrollHeight || 0),
    navState: landmark("nav"),
    headerState: landmark("header"),
    formCount: document.querySelectorAll("form").length,
    tableCount: document.querySelectorAll("table,[role=grid]").length,
    panelCount: document.querySelectorAll(".panel,.card,[class*='panel'],[class*='card']").length,
    visibleElementCount: records.filter(x => x.isVisible).length,
    visibleKeys,
    findings,
  };
})()`;

function flattenFindings(result, kind) {
  return result.metrics.findings[kind].map(item => ({
    page: result.page,
    viewport: result.viewport,
    kind,
    selector: item.selector,
    label: item.label,
    dimensions: item.otherSelector
      ? `${item.width}x${item.height} overlap with ${item.otherSelector}`
      : `${item.width}x${item.height}`,
    detail: item.classification || item.reason || "",
    provisional: provisional(kind, item),
  }));
}

function provisional(kind, item) {
  if (kind === "invisibleOutside") return "FALSE_POSITIVE_INVISIBLE";
  if (kind === "scrollContainers") return item.classification;
  if (kind === "outside" && item.classification === "INSIDE_INTENTIONAL_SCROLL") return "INTENTIONAL_SCROLL_CONTENT";
  if (kind === "outside" && item.classification === "CONTENT_HIDDEN_BY_BREAKPOINT_OR_RUNTIME_STATE") return "CONTENT_HIDDEN_BY_BREAKPOINT_OR_RUNTIME_STATE";
  if (kind === "clipping" && item.classification === "INTENTIONAL_TEXT_TRUNCATION") return "INTENTIONAL_TEXT_TRUNCATION";
  if (kind === "overlaps" && item.classification === "INTENTIONAL_COMPOSITE_CONTROL") return "INTENTIONAL_COMPOSITE_CONTROL";
  if (kind === "outside") return "REVIEW_OVERFLOW_DEFECT";
  if (kind === "controls24") return "REVIEW_TARGET_SIZE";
  if (kind === "controls44") return "REVIEW_PRIMARY_TARGET_SIZE";
  if (kind === "overlaps") return "REVIEW_CONTROL_OVERLAP";
  if (kind === "clipping") return "REVIEW_TEXT_CLIPPING";
  return "REVIEW_REQUIRED";
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise(resolvePromise => child.once("exit", () => resolvePromise(true))),
    delay(3000).then(() => false),
  ]);
  if (!exited && child.exitCode === null) {
    child.kill("SIGKILL");
    await new Promise(resolvePromise => child.once("exit", resolvePromise));
  }
}

async function main() {
  await mkdir(OUT, { recursive: true });
  log(`UNIT=${UNIT}`);
  log(`ROOT=${ROOT}`);
  log(`EXACT_HEAD=${EXACT_HEAD}`);
  log(`OUTPUT=${OUT}`);
  log(`NETWORK_POLICY=LOCALHOST_ONLY_CDP_FETCH_ABORT`);
  log(`EXECUTION_MODE=${targeted ? "TARGETED_POST_FIX" : "FULL_BASELINE"}`);

  let server;
  let edge;
  let cdp;
  let profile;
  let serverStopped = "NO";
  let browserStopped = "NO";
  let profileRemoved = "NO";
  const results = [];
  const runtimeErrors = [];
  try {
    server = await startServer();
    const address = server.address();
    const origin = `http://127.0.0.1:${address.port}`;
    log(`SERVER_STARTED=${origin}`);
    profile = await mkdtemp(join(tmpdir(), "tc-q1-reflow-edge-"));
    const debugPort = address.port + 1000;
    edge = spawn(EDGE, [
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profile}`,
      "--headless=new",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-default-apps",
      "--disable-features=Translate,MediaRouter,OptimizationHints",
      "--disable-sync",
      "--metrics-recording-only",
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ], { stdio: ["ignore", "pipe", "pipe"] });
    edge.stdout.on("data", data => log(`EDGE_STDOUT=${esc(data)}`));
    edge.stderr.on("data", data => {
      const line = esc(data);
      if (line) log(`EDGE_STDERR=${line}`);
    });
    const version = await waitForDebugger(debugPort);
    log(`BROWSER=${version.Browser}`);
    const target = await createTarget(debugPort);
    cdp = await new CDP(target.webSocketDebuggerUrl).open();
    cdp.localOrigin = origin;
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });

    for (const page of PAGES) {
      for (const viewport of VIEWPORTS) {
        const run = `${page}@${viewport.width}`;
        try {
          await cdp.send("Emulation.setDeviceMetricsOverride", {
            width: viewport.width,
            height: viewport.height,
            deviceScaleFactor: 1,
            mobile: viewport.width < 768,
            screenWidth: viewport.width,
            screenHeight: viewport.height,
          });
          const loaded = cdp.wait("Page.loadEventFired");
          const url = `${origin}/${page}${ROUTE_QUERY.get(page) || ""}`;
          await cdp.send("Page.navigate", { url });
          await loaded;
          await delay(650);
          const evaluation = await cdp.send("Runtime.evaluate", {
            expression: MEASURE_EXPRESSION,
            returnByValue: true,
            awaitPromise: true,
          });
          if (evaluation.exceptionDetails) throw new Error(evaluation.exceptionDetails.text || "evaluation failed");
          const metrics = evaluation.result.value;
          assert.equal(metrics.innerWidth, viewport.width, `CSS viewport mismatch ${metrics.innerWidth}`);
          results.push({ page, viewport: viewport.width, metrics, status: "PASS" });
          log(`RUN_PASS=${run} scroll=${metrics.scrollWidth}/${metrics.clientWidth} outside=${metrics.findings.outside.length} controls24=${metrics.findings.controls24.length} controls44=${metrics.findings.controls44.length} clipping=${metrics.findings.clipping.length} overlaps=${metrics.findings.overlaps.length}`);
        } catch (error) {
          runtimeErrors.push({ page, viewport: viewport.width, error: error.message });
          results.push({ page, viewport: viewport.width, metrics: null, status: "FAIL", error: error.message });
          log(`RUN_FAIL=${run} error=${error.message}`);
        }
      }
    }
  } finally {
    cdp?.close();
    await stopChild(edge);
    browserStopped = edge && edge.exitCode !== null ? "YES" : "NO";
    if (server) {
      await new Promise(resolvePromise => server.close(resolvePromise));
      serverStopped = "YES";
    }
    if (profile) {
      await rm(profile, { recursive: true, force: true });
      try {
        await stat(profile);
      } catch {
        profileRemoved = "YES";
      }
    }
    log(`SERVER_STOPPED=${serverStopped}`);
    log(`BROWSER_STOPPED=${browserStopped}`);
    log(`PROFILE_REMOVED=${profileRemoved}`);
  }

  const ok = results.filter(result => result.status === "PASS");
  const overflow = ok.flatMap(result => [
    ...flattenFindings(result, "outside"),
    ...flattenFindings(result, "scrollContainers"),
    ...flattenFindings(result, "invisibleOutside"),
  ]);
  const controls = ok.flatMap(result => [
    ...flattenFindings(result, "controls24"),
    ...flattenFindings(result, "controls44"),
    ...flattenFindings(result, "overlaps"),
  ]);
  const clipping = ok.flatMap(result => flattenFindings(result, "clipping"));
  const allFindings = [...overflow, ...controls, ...clipping];
  const breakpointRows = [];
  for (const page of PAGES) {
    const pageRuns = ok.filter(result => result.page === page);
    if (pageRuns.length !== VIEWPORTS.length) continue;
    const mobile = new Set(pageRuns.find(result => result.viewport === 320).metrics.visibleKeys);
    const desktop = new Set(pageRuns.find(result => result.viewport === 1280).metrics.visibleKeys);
    const desktopOnly = [...desktop].filter(key => !mobile.has(key));
    const mobileOnly = [...mobile].filter(key => !desktop.has(key));
    if (desktopOnly.length || mobileOnly.length) {
      breakpointRows.push({
        page,
        viewport: "320_vs_1280",
        kind: "breakpoint_visibility",
        selector: "",
        label: "",
        dimensions: "",
        detail: `desktop_only=${desktopOnly.length};mobile_only=${mobileOnly.length}`,
        provisional: "CONTENT_HIDDEN_BY_BREAKPOINT_OR_RUNTIME_STATE",
      });
    }
  }

  await writeFile(join(OUT, "01_PAGE_VIEWPORT_MATRIX.tsv"), tsv([
    "page", "viewport_css_px", "runtime_status", "inner_width", "client_width", "document_scroll_width",
    "document_overflow_px", "visible_outside", "controls_below_24", "primary_below_44",
    "control_overlaps", "text_clipping", "intentional_scroll_containers", "header_state", "nav_state",
    "forms", "tables", "panels", "runtime_error",
  ], results.map(result => ({
    page: result.page,
    viewport_css_px: result.viewport,
    runtime_status: result.status,
    inner_width: result.metrics?.innerWidth ?? "",
    client_width: result.metrics?.clientWidth ?? "",
    document_scroll_width: result.metrics?.scrollWidth ?? "",
    document_overflow_px: result.metrics ? Math.max(0, result.metrics.scrollWidth - result.metrics.clientWidth) : "",
    visible_outside: result.metrics?.findings.outside.length ?? "",
    controls_below_24: result.metrics?.findings.controls24.length ?? "",
    primary_below_44: result.metrics?.findings.controls44.length ?? "",
    control_overlaps: result.metrics?.findings.overlaps.length ?? "",
    text_clipping: result.metrics?.findings.clipping.length ?? "",
    intentional_scroll_containers: result.metrics?.findings.scrollContainers.length ?? "",
    header_state: result.metrics?.headerState ?? "",
    nav_state: result.metrics?.navState ?? "",
    forms: result.metrics?.formCount ?? "",
    tables: result.metrics?.tableCount ?? "",
    panels: result.metrics?.panelCount ?? "",
    runtime_error: result.error || "",
  }))));
  const findingHeader = ["page", "viewport", "kind", "selector", "label", "dimensions", "detail", "provisional"];
  await writeFile(join(OUT, "02_OVERFLOW_FINDINGS.tsv"), tsv(findingHeader, overflow));
  await writeFile(join(OUT, "03_CONTROL_SIZE_FINDINGS.tsv"), tsv(findingHeader, controls));
  await writeFile(join(OUT, "04_CLIPPING_FINDINGS.tsv"), tsv(findingHeader, clipping));
  await writeFile(join(OUT, "05_ADJUDICATION.tsv"), tsv(findingHeader, [...allFindings, ...breakpointRows]));

  const counts = new Map();
  for (const row of [...allFindings, ...breakpointRows]) counts.set(row.provisional, (counts.get(row.provisional) || 0) + 1);
  const decision = [
    `# ${UNIT}`,
    "",
    "Evidencia local de reflow/responsive mediante Microsoft Edge y CDP. No es una auditoría AX general,",
    "no repite contraste y no demuestra conformidad WCAG integral.",
    "",
    "## Ejecución",
    "",
    `- HEAD exacto: \`${EXACT_HEAD}\``,
    `- Páginas: ${PAGES.length}`,
    `- Viewports CSS: ${VIEWPORTS.map(x => x.width).join(", ")} px`,
    `- Corridas completas: ${ok.length}/${PAGES.length * VIEWPORTS.length}`,
    `- Fallas runtime: ${runtimeErrors.length}`,
    "- Red: solicitudes no-localhost abortadas por CDP.",
    "",
    "## Adjudicación provisional",
    "",
    ...[...counts].sort().map(([key, value]) => `- ${key}: ${value}`),
    "",
    "Los estados REVIEW_* requieren revisión source-aware antes de declararse defecto P1/P2. Los contenedores",
    "de tabla/panel con overflow-x auto/scroll se clasifican como scroll intencional, y los elementos no",
    "visualmente expuestos se separan como falsos positivos. Las diferencias 320/1280 se registran como",
    "breakpoint o estado runtime y no se califican automáticamente como defecto.",
    "",
  ].join("\n");
  await writeFile(join(OUT, "06_DECISION.md"), decision);

  const provenance = [
    `UNIT=${UNIT}`,
    `EXACT_HEAD=${EXACT_HEAD}`,
    `ROOT=${ROOT}`,
    `EDGE_EXECUTABLE=${EDGE}`,
    `EDGE_BROWSER=${terminal.find(line => line.includes("\tBROWSER="))?.split("\tBROWSER=")[1] || "UNKNOWN"}`,
    `NODE=${process.version}`,
    `PAGES_SHA256=SEE_FINAL_PROVENANCE_APPEND`,
    `NETWORK_EXTERNAL=BLOCKED_BY_CDP_FETCH`,
    `SERVER_STOPPED=${serverStopped}`,
    `BROWSER_STOPPED=${browserStopped}`,
    `PROFILE_REMOVED=${profileRemoved}`,
  ].join("\n") + "\n";
  await writeFile(join(OUT, "07_PROVENANCE.txt"), provenance);
  await writeFile(join(OUT, "00_terminal.log"), `${terminal.join("\n")}\n`);

  const expectedRuns = PAGES.length * VIEWPORTS.length;
  const preliminaryPass = runtimeErrors.length === 0 && ok.length === expectedRuns && serverStopped === "YES" && browserStopped === "YES" && profileRemoved === "YES";
  const preliminary = [
    `RESULT=${preliminaryPass ? "PASS" : "INCOMPLETE"}`,
    `REASON_CODE=${preliminaryPass ? "REFLOW_RESPONSIVE_EVIDENCE_COMPLETED" : "REFLOW_RESPONSIVE_RUNTIME_INCOMPLETE"}`,
    `PAGES_TOTAL=${PAGES.length}`,
    `VIEWPORTS_TOTAL=${VIEWPORTS.length}`,
    `PAGE_VIEWPORT_RUNS=${ok.length}`,
    `RUNTIME_FAILURES=${runtimeErrors.length}`,
    "PRODUCT_P1_OPEN=PENDING_SOURCE_AWARE_ADJUDICATION",
    "PRODUCT_P2_OPEN=PENDING_SOURCE_AWARE_ADJUDICATION",
    `SERVER_STOPPED=${serverStopped}`,
    `BROWSER_STOPPED=${browserStopped}`,
    `PROFILE_REMOVED=${profileRemoved}`,
    "WORKTREE_CLEAN=PENDING_POST_COMMIT_VERIFICATION",
    "OFFICIAL_LEDGER_DELTA=0.00",
    "NEXT_ACTION=ADJUDICATE_REFLOW_EVIDENCE_OR_CONTINUE_AUTHENTICATED_QA",
  ].join("\n") + "\n";
  await writeFile(join(OUT, "00_FINAL_RESULT.txt"), preliminary);
  await writeFile(join(OUT, "99_CLIPBOARD_SUMMARY.txt"), preliminary);
  log(`ARTIFACTS_WRITTEN=${OUT}`);
  log(`PRELIMINARY_RESULT=${preliminaryPass ? "PASS" : "INCOMPLETE"}`);
  await writeFile(join(OUT, "00_terminal.log"), `${terminal.join("\n")}\n`);
  if (!preliminaryPass) process.exitCode = 1;
}

await main();
