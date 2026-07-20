import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const support = readFileSync(
  new URL("../app/soporte.html", import.meta.url),
  "utf8",
);

const catalog = readFileSync(
  new URL(
    "../app/janome/janome_catalogo.js",
    import.meta.url,
  ),
  "utf8",
);

assert.match(
  support,
  /<label[^>]+for=["']spSystemSearch["']/,
  "Producto debe conservar label[for=spSystemSearch]",
);

assert.match(
  support,
  /id=["']spEquipoCombo["'][^>]+data-input-id=["']spSystemSearch["']/,
  "El host debe declarar el id del input visible",
);

assert.match(
  catalog,
  /hostEl\.dataset\.inputId/,
  "El constructor debe consumir data-input-id",
);

assert.match(
  catalog,
  /input\.id\s*=\s*requestedInputId\s*\|\|\s*`\$\{base\}-input`/,
  "El input visible debe recibir un id estable",
);

console.log(
  "support-product-combobox-a11y: PASS",
);
