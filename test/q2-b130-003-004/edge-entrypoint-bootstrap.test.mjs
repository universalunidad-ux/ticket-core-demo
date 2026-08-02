import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CANONICAL_FUNCTIONS,
  collectExternalDependencyClosure,
  extractRelativeSpecifiers,
  stageExactFunctions,
} from "../../tools/l130-authenticated-qa/edge-runtime-serve.mjs";
import {
  derivePorts,
  renderConfigToml,
} from "../../tools/local-db/lib/bootstrap.mjs";

const REPO = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const JANOME_REL = join("app", "janome", "janome_catalogo.js");
const SUPPORT_CATALOG_REL = join("supabase", "functions", "_shared", "support-catalog.ts");

function walk(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? [path, ...walk(path)] : [path];
  });
}

function assertMaterialisedRegularFile(runtimeDir, rel, label) {
  const target = join(runtimeDir, rel);
  assert.equal(existsSync(target), true, `${label} must be materialised`);
  assert.equal(lstatSync(target).isSymbolicLink(), false, `${label} must not be a symlink`);
  assert.equal(statSync(target).isFile(), true, `${label} must be a regular file`);
  assert.equal(realpathSync(target), target, `${label} must not resolve out of the workdir`);
  assert.equal(target.startsWith(`${runtimeDir}/`), true, `${label} must stay inside the workdir`);
  return target;
}

test("comment-only import examples are not treated as real specifiers", () => {
  const source = [
    '/* usage: import { A } from "./not-a-real-import.js"; */',
    '// import { B } from "./also-not-real.js";',
    'const url = "https://example.test/x";',
    'import { C } from "../../../app/janome/janome_catalogo.js";',
    'const D = await import("./dynamic.ts");',
  ].join("\n");
  const specifiers = extractRelativeSpecifiers(source);
  assert.deepEqual(
    [...specifiers].sort(),
    ["../../../app/janome/janome_catalogo.js", "./dynamic.ts"],
  );
});

test("external local dependency closure is minimal and includes the janome catalog", () => {
  const closure = collectExternalDependencyClosure(REPO);
  assert.equal(Array.isArray(closure), true);
  assert.equal(
    closure.includes(JANOME_REL),
    true,
    "closure must include the module imported by _shared/support-catalog.ts",
  );
  assert.equal(
    closure.every(rel => !rel.startsWith("supabase/functions")),
    true,
    "closure must only contain modules outside supabase/functions",
  );
  assert.equal(
    closure.some(rel => /(^|\/)\.git(\/|$)|\.env|\.key$|\.pem$/i.test(rel)),
    false,
    "closure must never contain Git metadata or secret material",
  );
  assert.ok(closure.length <= 8, `closure must stay minimal, got ${closure.length}`);
});

test("temporary Edge runtime has four self-contained conventional entrypoints", () => {
  const tempRoot = realpathSync(tmpdir());
  const runtimeDir = mkdtempSync(join(tempRoot, "tc-edge-entrypoint-contract."));
  let runtimeRemoved = false;
  try {
    assert.equal(
      runtimeDir.startsWith(`${tempRoot}/`),
      true,
      "contract runtime must be created under the controlled system temp root",
    );
    assert.equal(lstatSync(runtimeDir).isSymbolicLink(), false, "contract runtime must be real");
    assert.equal(realpathSync(runtimeDir), runtimeDir, "contract runtime must not escape temp root");

    const runtimeSupabase = join(runtimeDir, "supabase");
    const ports = derivePorts(57300);
    mkdirSync(runtimeSupabase, { recursive: true });
    writeFileSync(
      join(runtimeSupabase, "config.toml"),
      renderConfigToml({ projectId: "tc_edge_entrypoint_contract", ...ports }),
      { mode: 0o600 },
    );
    const functionsDir = stageExactFunctions(runtimeDir);
    const configPath = join(runtimeSupabase, "config.toml");
    const config = readFileSync(configPath, "utf8");

    assert.equal(realpathSync(configPath), configPath, "runtime config must be consumed locally");
    assert.match(config, /^project_id = "tc_edge_entrypoint_contract"$/m);
    assert.deepEqual(CANONICAL_FUNCTIONS, [
      "support-submit-secure",
      "estado-ticket-ts",
      "estado-ticket-responder-ts",
      "ticket-escalar-admin",
    ]);

    // 1. Four conventional entrypoints materialised.
    for (const name of CANONICAL_FUNCTIONS) {
      const functionDir = join(functionsDir, name);
      const entrypoint = join(functionDir, "index.ts");
      assert.equal(lstatSync(functionDir).isSymbolicLink(), false, `${name} directory must be copied`);
      assert.equal(existsSync(entrypoint), true, `${name} conventional entrypoint must exist`);
      assert.equal(statSync(entrypoint).isFile(), true, `${name} entrypoint must be regular`);
      assert.equal(realpathSync(entrypoint), entrypoint, `${name} entrypoint must stay in workdir`);
      assert.equal(entrypoint.startsWith(`${runtimeDir}/`), true, `${name} must resolve inside workdir`);
    }

    // 2. _shared/support-catalog.ts materialised, 3+5. janome catalog regular file.
    const supportCatalog = assertMaterialisedRegularFile(
      runtimeDir,
      SUPPORT_CATALOG_REL,
      "_shared/support-catalog.ts",
    );
    const janome = assertMaterialisedRegularFile(runtimeDir, JANOME_REL, "janome_catalogo.js");

    // 4. The exact relative path the importer resolves must exist.
    const specifiers = extractRelativeSpecifiers(readFileSync(supportCatalog, "utf8"));
    const escaping = specifiers.filter(value => value.startsWith("../../../"));
    assert.deepEqual(escaping, ["../../../app/janome/janome_catalogo.js"]);
    for (const specifier of specifiers) {
      const resolved = resolve(dirname(supportCatalog), specifier);
      assert.equal(existsSync(resolved), true, `import ${specifier} must resolve inside the workdir`);
      assert.equal(resolved.startsWith(`${runtimeDir}/`), true, `${specifier} must stay in workdir`);
    }

    // 6. No absolute reference to the source repository.
    const janomeSource = readFileSync(janome, "utf8");
    assert.equal(janomeSource.includes(REPO), false, "materialised module must not embed source repo paths");
    assert.equal(
      janomeSource,
      readFileSync(join(REPO, JANOME_REL), "utf8"),
      "materialised module must be a complete copy",
    );

    // 7. Direct local dependencies of the materialised module are present too.
    for (const specifier of extractRelativeSpecifiers(janomeSource)) {
      const resolved = resolve(dirname(janome), specifier);
      assert.equal(existsSync(resolved), true, `janome dependency ${specifier} must be materialised`);
    }

    // 8. The temporary runtime is self-sufficient for graph construction.
    const runtimeSources = walk(runtimeDir).filter(path =>
      statSync(path).isFile() && /\.(ts|tsx|mts|js|mjs)$/.test(path)
    );
    for (const path of runtimeSources) {
      for (const specifier of extractRelativeSpecifiers(readFileSync(path, "utf8"))) {
        const resolved = resolve(dirname(path), specifier);
        assert.equal(
          existsSync(resolved) && resolved.startsWith(`${runtimeDir}/`),
          true,
          `unresolved module ${specifier} from ${relativeToRuntime(runtimeDir, path)}`,
        );
      }
    }

    // 9. No secrets and no Git material copied.
    const stagedPaths = walk(runtimeDir).filter(path => statSync(path).isFile());
    assert.equal(
      stagedPaths.some(path => /(^|\/)\.git(\/|$)|\.env$|\.key$|\.pem$|\.pgpass$/i.test(path)),
      false,
      "constructor must not copy Git metadata or secret material",
    );

    // 10. No indiscriminate whole-repository copy.
    const outsideFunctions = stagedPaths
      .map(path => path.slice(runtimeDir.length + 1))
      .filter(rel => !rel.startsWith("supabase/"));
    assert.ok(
      outsideFunctions.length <= 8,
      `constructor must not copy the whole repository, got ${outsideFunctions.length}: ${outsideFunctions.join(", ")}`,
    );
    assert.equal(outsideFunctions.includes(JANOME_REL), true);
    assert.equal(existsSync(join(runtimeDir, "tools")), false, "tools/ must not be copied");
    assert.equal(existsSync(join(runtimeDir, "test")), false, "test/ must not be copied");
    assert.equal(existsSync(join(runtimeDir, ".git")), false, ".git must not be copied");

    const allStagedPaths = walk(join(runtimeDir, "supabase", "functions"));
    assert.equal(
      allStagedPaths.some(path => lstatSync(path).isSymbolicLink()),
      false,
      "staged functions must not depend on symlinks",
    );
    const sourceFunctionsDir = join(REPO, "supabase", "functions");
    const stagedContents = allStagedPaths
      .filter(path => statSync(path).isFile())
      .map(path => readFileSync(path, "utf8"));
    assert.doesNotMatch(
      [config, ...stagedContents, janomeSource].join("\n"),
      new RegExp(sourceFunctionsDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      "runtime config and files must not reference the repository source tree",
    );
  } finally {
    rmSync(runtimeDir, { recursive: true, force: true });
    runtimeRemoved = !existsSync(runtimeDir);
  }
  assert.equal(runtimeRemoved, true, "contract runtime must be removed after validation");
});

function relativeToRuntime(runtimeDir, path) {
  return path.startsWith(`${runtimeDir}/`) ? path.slice(runtimeDir.length + 1) : path;
}
