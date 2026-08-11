import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = path => readFileSync(join(root, path), "utf8");
const journeyPages = ["dashboard", "tickets", "ticket", "clientes", "cliente"];
const legacyRelease = "functional-product-macrobatch-01";

function canonicalRelease() {
  const match = read("tools/final-fix-gates.mjs").match(/\bRELEASE\s*=\s*"([^"]+)"/);
  assert.ok(match, "the canonical gate must declare its release");
  return match[1];
}

function assertCanonicalJourneyRelease(source, page, release) {
  const canonicalHref = `operations-journey.css?v=${release}`;
  const legacyHref = `operations-journey.css?v=${legacyRelease}`;
  assert.equal(source.includes(canonicalHref), true, `${page} must use ${canonicalHref}`);
  assert.equal(
    source.includes(legacyHref),
    false,
    `${page} must reject obsolete release ${legacyRelease}`,
  );
}

test("todas las superficies cargan el estilo operativo con la release canónica", () => {
  const release = canonicalRelease();
  assert.equal(release, "frontend-p0-20260811-01");

  // This tightens the legacy test to the owner gate; it does not relax the
  // contract by accepting either release.
  for (const page of journeyPages) {
    assertCanonicalJourneyRelease(read(`app/${page}.html`), page, release);
  }
});

test("mutante: la release operativa legacy sigue siendo rechazada", () => {
  const release = canonicalRelease();
  for (const page of journeyPages) {
    const mutant = read(`app/${page}.html`).replace(
      `operations-journey.css?v=${release}`,
      `operations-journey.css?v=${legacyRelease}`,
    );
    assert.throws(
      () => assertCanonicalJourneyRelease(mutant, page, release),
      /must use operations-journey\.css\?v=frontend-p0-20260811-01/,
      `${page} mutant must fail when the legacy release is reintroduced`,
    );
  }
});

test("barra operativa tiene landmarks, estado vivo y controles etiquetados", () => {
  const source = read("app/shared/operations-journey.js");
  assert.match(source, /aria-label", "Recorrido operativo"/);
  assert.match(source, /aria-label="Navegación operativa"/);
  assert.match(source, /role="status" aria-live="polite"/);
  assert.match(source, /aria-describedby="tcOperationsHint"/);
  assert.match(source, /aria-current="page"/);
});

test("targets móviles, foco, error y movimiento reducido tienen contrato CSS", () => {
  const css = read("app/operations-journey.css");
  assert.match(css, /:focus-visible/);
  assert.match(css, /min-height:44px/);
  assert.match(css, /data-sync-state="error"/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(css, /overflow-x:auto/);
});

test("miniaturas de evidencia usan carga diferida y decodificación asíncrona", () => {
  const source = read("app/ticket.js");
  assert.ok((source.match(/loading="lazy" decoding="async"/g) || []).length >= 3);
  assert.match(source, /img\.loading="lazy";img\.decoding="async"/);
});
