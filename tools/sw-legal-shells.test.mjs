import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sw = readFileSync(
  new URL("../app/sw.js", import.meta.url),
  "utf8",
);

const shells =
  sw.match(/const PAGE_SHELLS=\[(.*?)\];/s)?.[1] || "";

assert.match(
  shells,
  /["']\.\/aviso-privacidad\.html["']/,
  "aviso-privacidad debe estar en PAGE_SHELLS",
);

assert.match(
  shells,
  /["']\.\/terminos\.html["']/,
  "terminos debe estar en PAGE_SHELLS",
);

assert.match(
  sw,
  /const RELEASE="frontend-p0-20260811-01";/,
  "Debe conservarse el release canónico validado",
);

console.log("sw-legal-shells: PASS");
