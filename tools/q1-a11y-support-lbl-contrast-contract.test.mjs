import assert from "node:assert/strict";
import fs from "node:fs";

const css = fs.readFileSync(
  new URL("../app/soporte.css", import.meta.url),
  "utf8",
);

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
