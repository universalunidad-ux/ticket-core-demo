import assert from "node:assert/strict";
import fs from "node:fs";

const css = fs.readFileSync(
  new URL("../app/soporte.css", import.meta.url),
  "utf8",
);
const estadoCss = fs.readFileSync(new URL("../app/estado.css", import.meta.url), "utf8");
const workspaceCss = fs.readFileSync(new URL("../app/ticket-workspace.css", import.meta.url), "utf8");

const expected =
  ".lbl{font-size:11.5px;font-weight:800;letter-spacing:.06em;" +
  "color:var(--muted);text-transform:uppercase}";

const forbidden =
  ".lbl{font-size:11.5px;font-weight:800;letter-spacing:.06em;" +
  "color:color-mix(in srgb,var(--muted) 92%,transparent);" +
  "text-transform:uppercase}";

assert.equal(
  css.split(expected).length - 1,
  1,
  "Expected exactly one opaque .lbl rule.",
);

assert.equal(
  css.includes(forbidden),
  false,
  ".lbl must not retain transparent color-mix foreground.",
);

console.log("PASS support .lbl uses opaque var(--muted)");

assert.match(
  css,
  /\.tk-receipt-folio\{[^}]*color:var\(--muted\);/,
  "Support receipt folio must use the opaque muted foreground.",
);
assert.match(
  estadoCss,
  /\.estado-status-pill\{[^}]*color:#166534;/,
  "Public status pill must retain an AA light-theme foreground.",
);
assert.match(
  estadoCss,
  /html\[data-theme=dark\] \.estado-status-pill\{color:#86efac\}/,
  "Public status pill must retain an AA dark-theme foreground.",
);
assert.match(
  workspaceCss,
  /\.tk-workspace-status \{ color: color-mix\(in srgb, var\(--text, #0f172a\) 72%, var\(--muted, #64748b\)\);/,
  "Ticket workspace status must not use the borderline muted foreground.",
);

console.log("PASS exact-head rendered contrast owners remain opaque and theme-safe");
