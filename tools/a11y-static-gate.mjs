#!/usr/bin/env node
import { existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

// Manifiesto canonico y ordenado. Owner unico de las suites estaticas de accesibilidad.
export const A11Y_STATIC_SUITES = [
  "tools/a11y-u3-u4.test.mjs",
  "tools/client-tabs-a11y.test.mjs",
  "tools/ticket-composer-a11y.test.mjs",
  "tools/dialog-accessibility.test.mjs",
];

export const A11Y_STATIC_GATE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function runA11yStaticGate({ root = A11Y_STATIC_GATE_ROOT, forward = true } = {}) {
  const executed = [];
  for (const suite of A11Y_STATIC_SUITES) {
    const path = join(root, suite);
    if (!existsSync(path)) throw new Error(`A11Y_SUITE_MISSING:${suite}`);
    // Las suites leen rutas relativas (app/*.html), por lo que cwd debe ser la raiz del repo.
    const result = spawnSync(process.execPath, [path], { cwd: root, encoding: "utf8" });
    if (forward) {
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
    }
    const status = result.status === 0 ? "PASS" : "FAIL";
    console.log(`A11Y_SUITE=${suite} RESULT=${status}`);
    if (result.error) throw new Error(`A11Y_SUITE_SPAWN_FAILED:${suite}`);
    if (result.status !== 0) throw new Error(`A11Y_SUITE_FAILED:${suite}:${result.status}`);
    executed.push(suite);
  }
  console.log("A11Y_STATIC_GATE=PASS");
  console.log(`A11Y_STATIC_SUITE_COUNT=${executed.length}`);
  return executed;
}

function main() {
  try {
    runA11yStaticGate();
  } catch (error) {
    const reason = String(error?.message || "UNKNOWN").replace(/[\r\n\t]+/g, " ");
    console.error("A11Y_STATIC_GATE=FAIL");
    console.error(`STOP_REASON=${reason}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) main();
