import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(
  new URL(
    "../.github/workflows/frontend-gates.yml",
    import.meta.url,
  ),
  "utf8",
);

const command =
  "node tools/assignment-engine.test.mjs";

assert.equal(
  workflow.split(command).length - 1,
  1,
  "assignment-engine.test.mjs debe ejecutarse una sola vez",
);

for (const relative of [
  "../tools/preflight.mjs",
  "../tools/preflight.test.mjs",
]) {
  const text = readFileSync(
    new URL(relative, import.meta.url),
    "utf8",
  );

  assert.equal(
    text.includes("assignment-engine.test.mjs"),
    false,
    `${relative} no debe convertirse en otro owner`,
  );
}

console.log(
  "ci-assignment-ownership: PASS",
);
