import assert from "node:assert/strict";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);

const appRoot = join(repoRoot, "app");

const clienteFiles = readdirSync(appRoot)
  .filter((name) => {
    const lower = name.toLowerCase();

    return (
      lower === "cliente.html"
      || lower.startsWith("cliente.")
      || lower.startsWith("cliente-")
    );
  })
  .sort();

const htmlFiles = clienteFiles.filter(
  (name) => name.endsWith(".html"),
);

const scriptFiles = clienteFiles.filter(
  (name) =>
    name.endsWith(".js")
    || name.endsWith(".mjs")
    || name.endsWith(".ts"),
);

const conflictPattern =
  /^(?:<{7}|={7}|>{7})/m;

function readAppFile(name) {
  return readFileSync(
    join(appRoot, name),
    "utf8",
  );
}

function localReferences(html) {
  const references = [];

  const pattern =
    /\b(?:src|href)\s*=\s*["']([^"'#?]+)(?:[?#][^"']*)?["']/gi;

  for (const match of html.matchAll(pattern)) {
    const value = match[1].trim();

    if (
      !value
      || value.startsWith("http://")
      || value.startsWith("https://")
      || value.startsWith("//")
      || value.startsWith("data:")
      || value.startsWith("mailto:")
      || value.startsWith("tel:")
      || value.startsWith("#")
    ) {
      continue;
    }

    references.push(value);
  }

  return references;
}

function resolveLocalReference(htmlName, reference) {
  if (reference.startsWith("/")) {
    return join(
      repoRoot,
      reference.replace(/^\/+/, ""),
    );
  }

  return resolve(
    appRoot,
    dirname(htmlName),
    reference,
  );
}

function validatePageModel(
  htmlText,
  scriptsText,
) {
  const hasMainContent =
    /<main\b/i.test(htmlText)
    || /\brole\s*=\s*["']main["']/i.test(htmlText)
    || /\bid\s*=\s*["'][^"']*(?:cliente|detail|content)[^"']*["']/i.test(
      htmlText,
    );

  const hasPageScript =
    /<script\b[^>]*\bsrc\s*=/i.test(
      htmlText,
    );

  const hasClientSelection =
    /URLSearchParams|searchParams|location\.search|location\.href/i.test(
      scriptsText,
    );

  const hasRendering =
    /textContent|innerHTML|appendChild|replaceChildren|insertAdjacentHTML/i.test(
      scriptsText,
    );

  return {
    hasMainContent,
    hasPageScript,
    hasClientSelection,
    hasRendering,
  };
}

test(
  "PROD-005 conserva el conjunto cliente HTML y JavaScript",
  () => {
    assert.ok(
      clienteFiles.length >= 2,
      "Deben existir al menos dos archivos app/cliente.*",
    );

    assert.ok(
      htmlFiles.length >= 1,
      "Debe existir una página HTML de cliente",
    );

    assert.ok(
      scriptFiles.length >= 1,
      "Debe existir JavaScript de cliente",
    );

    for (const name of clienteFiles) {
      const fullPath = join(appRoot, name);

      assert.equal(
        statSync(fullPath).isFile(),
        true,
      );

      assert.ok(
        statSync(fullPath).size > 100,
        `${name} no puede estar vacío`,
      );
    }

    console.log(
      `PROD005_CLIENTE_FILE_COUNT=${clienteFiles.length}`,
    );
  },
);

test(
  "los archivos cliente no contienen marcadores de conflicto",
  () => {
    for (const name of clienteFiles) {
      const source = readAppFile(name);

      assert.doesNotMatch(
        source,
        conflictPattern,
        `${name} contiene marcadores de conflicto`,
      );
    }

    console.log(
      "PROD005_CONFLICT_MARKERS=PASS",
    );
  },
);

test(
  "los JavaScript de cliente tienen sintaxis válida",
  () => {
    for (const name of scriptFiles) {
      const path = join(appRoot, name);

      const result = spawnSync(
        process.execPath,
        ["--check", path],
        {
          encoding: "utf8",
        },
      );

      assert.equal(
        result.status,
        0,
        [
          `${name} no pasa node --check`,
          result.stdout,
          result.stderr,
        ].join("\n"),
      );
    }

    console.log(
      "PROD005_CLIENTE_JS_SYNTAX=PASS",
    );
  },
);

test(
  "las referencias locales declaradas por cliente HTML existen",
  () => {
    let checked = 0;

    for (const htmlName of htmlFiles) {
      const html = readAppFile(htmlName);

      for (const reference of localReferences(html)) {
        const resolved = resolveLocalReference(
          htmlName,
          reference,
        );

        assert.equal(
          existsSync(resolved),
          true,
          `${htmlName} referencia un recurso inexistente: ${reference}`,
        );

        checked += 1;
      }
    }

    assert.ok(
      checked >= 1,
      "La página cliente debe declarar recursos locales",
    );

    console.log(
      `PROD005_LOCAL_REFERENCES_CHECKED=${checked}`,
    );
  },
);

test(
  "cliente conserva contrato mínimo de selección y renderizado",
  () => {
    const html = htmlFiles
      .map(readAppFile)
      .join("\n");

    const scripts = scriptFiles
      .map(readAppFile)
      .join("\n");

    const model = validatePageModel(
      html,
      scripts,
    );

    assert.deepEqual(
      model,
      {
        hasMainContent: true,
        hasPageScript: true,
        hasClientSelection: true,
        hasRendering: true,
      },
    );

    console.log(
      "PROD005_CLIENTE_PAGE_MODEL=PASS",
    );
  },
);

test(
  "el quickpass detecta pérdida del enlace de script",
  () => {
    const html = htmlFiles
      .map(readAppFile)
      .join("\n");

    const scripts = scriptFiles
      .map(readAppFile)
      .join("\n");

    const mutated = html.replace(
      /<script\b[^>]*\bsrc\s*=\s*["'][^"']+["'][^>]*>\s*<\/script>/gi,
      "",
    );

    assert.notEqual(
      mutated,
      html,
      "La mutación debe eliminar al menos un script local",
    );

    const model = validatePageModel(
      mutated,
      scripts,
    );

    assert.equal(
      model.hasPageScript,
      false,
      "El contrato debe detectar una página sin enlace de script",
    );

    console.log(
      "PROD005_SCRIPT_LINK_MUTATION_REJECTED=PASS",
    );
  },
);
