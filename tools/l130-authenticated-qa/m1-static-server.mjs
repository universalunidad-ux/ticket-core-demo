#!/usr/bin/env node

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

const HOST = "127.0.0.1";
const PORT = Number(process.env.TC_L130_STATIC_PORT || 55430);
const ROOT = resolve(process.env.TC_L130_REPO_ROOT || ".");
const API_URL = String(process.env.LOCAL_SUPABASE_URL || "");
const ANON_KEY = String(process.env.LOCAL_SUPABASE_ANON_KEY || "");

if (!/^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+\/?$/.test(API_URL)) {
  throw new Error("E_LOCAL_SUPABASE_URL_REQUIRED");
}
if (!ANON_KEY) throw new Error("E_LOCAL_ANON_KEY_REQUIRED");
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) throw new Error("E_STATIC_PORT_INVALID");

const TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

function safePath(url) {
  const pathname = decodeURIComponent(new URL(url, `http://${HOST}:${PORT}`).pathname);
  const relative = pathname === "/" ? "app/index.html" : pathname.replace(/^\/+/, "");
  const file = resolve(ROOT, relative);
  if (file !== ROOT && !file.startsWith(`${ROOT}${sep}`)) throw new Error("E_PATH_SCOPE");
  return { file, pathname };
}

const server = createServer(async (request, response) => {
  try {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405).end();
      return;
    }
    const { file, pathname } = safePath(request.url);
    if (pathname === "/app/supabase.config.public.js") {
      const body = `window.TICKET_CORE_CONFIG=${JSON.stringify({
        supabaseUrl: API_URL.replace(/\/$/, ""),
        supabasePublishableKey: ANON_KEY,
      })};\n`;
      response.writeHead(200, {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(request.method === "HEAD" ? "" : body);
      return;
    }
    const info = await stat(file);
    if (!info.isFile()) throw new Error("E_NOT_FILE");
    const body = await readFile(file);
    response.writeHead(200, {
      "content-type": TYPES[extname(file).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(request.method === "HEAD" ? "" : body);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`M1_STATIC_SERVER=READY\nM1_STATIC_ORIGIN=http://${HOST}:${PORT}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
