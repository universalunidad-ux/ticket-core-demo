import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.argv[2] ?? ".";
const scopeFile = "tools/megatrain-a11y-audit.mjs";
const targetPage = "app/consolidacion-clientes.html";

assert.ok(
  fs.existsSync(path.join(root, targetPage)),
  `${targetPage} must exist`,
);

const scopeText = fs.readFileSync(
  path.join(root, scopeFile),
  "utf8",
);

assert.ok(
  scopeText.includes(targetPage),
  `${targetPage} must be included in ${scopeFile}`,
);

console.log(JSON.stringify({
  rowId: "A11Y-011",
  scopeFile,
  targetPage,
  assertions: 2,
  result: "PASS",
}));
