import fs from "node:fs";
import assert from "node:assert/strict";

const read = file => fs.readFileSync(file, "utf8");

const ticket = read("app/ticket.html");
const tickets = read("app/tickets.html");
const estado = read("app/estado.html");
const estadoJs = read("app/estado.js");
const clientes = read("app/clientes.html");
const alta = read("app/alta-cliente.html");
const altaJs = read("app/alta-cliente.js");

function tagById(html, id) {
  const match = html.match(
    new RegExp(`<[^>]+\\bid=["']${id}["'][^>]*>`, "i")
  );

  assert.ok(match, `Falta #${id}`);
  return match[0];
}

function attr(tag, name) {
  const match = tag.match(
    new RegExp(`\\b${name}=["']([^"']*)["']`, "i")
  );

  return match?.[1] ?? null;
}

function assertAttr(html, id, name, expected) {
  assert.equal(
    attr(tagById(html, id), name),
    expected,
    `#${id} debe tener ${name}="${expected}"`
  );
}

assert.equal(
  (ticket.match(/<h1\b/gi) || []).length,
  1,
  "ticket.html debe tener exactamente un H1"
);

assert.match(
  ticket,
  /<h1\b[^>]*\bid=["']ticketPageHeading["'][^>]*>Detalle del ticket<\/h1>/i
);

assert.equal(
  (estado.match(/<h1\b/gi) || []).length,
  1,
  "estado.html debe conservar exactamente un H1"
);

assert.match(
  estado,
  /<h1\b[^>]*\bid=["']stTitle["'][^>]*>/i
);

assert.match(
  estadoJs,
  /const\s+ensurePublicStatusHeading\s*=/,
  "Debe existir el owner del fallback de heading"
);

assert.match(
  estadoJs,
  /value===["']—["']/,
  "El fallback debe limitarse al heading vacío"
);

assert.match(
  estadoJs,
  /title\.textContent=["']Seguimiento de tu caso["']/,
  "El estado de error debe tener un H1 significativo"
);

assert.match(
  estadoJs,
  /setPublicStatusError=\(status,message\)=>\{ensurePublicStatusHeading\(\);/,
  "setPublicStatusError debe activar el fallback"
);

assert.match(
  estadoJs,
  /setTxt\(["']stTitle["'],t\?\.titulo\|\|["']—["']\)/,
  "setSummary debe continuar restaurando el título real"
);

for (const [id, label] of Object.entries({
  tkFilterPriority: "Filtrar tickets por prioridad",
  tkPrioridad: "Prioridad del ticket",
  tkClosedQ: "Buscar tickets cerrados",
  tkSearch: "Buscar tickets",
})) {
  assertAttr(tickets, id, "aria-label", label);
}

assertAttr(
  estado,
  "stReplyFilesPop",
  "aria-label",
  "Adjuntar archivos al mensaje"
);

assertAttr(
  estado,
  "stReplyFilesPop",
  "tabindex",
  "-1"
);

for (const [id, label] of Object.entries({
  clSearch: "Buscar clientes",
  clAgentFilter: "Filtrar clientes por agente",
  clOrder: "Ordenar clientes",
  clFilterPageSize: "Clientes por página",
  clEquipmentInput: "Filtrar por familia o modelo de máquina",
})) {
  assertAttr(clientes, id, "aria-label", label);
}

const errorAssociations = {
  acNombre: ["acNombreErr"],
  acContacto: ["acContactoErr"],
  acCorreo: ["acCorreoErr"],
  acTelefono: ["acTelefonoErr"],
  acModelo: ["acModeloHelp", "acModeloErr"],
  acSerie: ["acSerieErr"],
};

for (const [id, requiredIds] of Object.entries(errorAssociations)) {
  const tokens = (
    attr(tagById(alta, id), "aria-describedby") || ""
  ).split(/\s+/);

  for (const required of requiredIds) {
    assert.ok(
      tokens.includes(required),
      `#${id} debe describirse mediante #${required}`
    );

    assert.match(
      alta,
      new RegExp(`\\bid=["']${required}["']`, "i"),
      `Falta nodo #${required}`
    );
  }
}

assert.match(
  altaJs,
  /setAttribute\(["']aria-invalid["']/,
  "setFieldError debe conservar aria-invalid"
);

const documents = [ticket, tickets, estado, clientes, alta];

for (const id of [
  "ticketPageHeading",
  "tkFilterPriority",
  "tkPrioridad",
  "tkClosedQ",
  "tkSearch",
  "stReplyFilesPop",
  "clSearch",
  "clAgentFilter",
  "clOrder",
  "clFilterPageSize",
  "clEquipmentInput",
  "acNombre",
  "acContacto",
  "acCorreo",
  "acTelefono",
  "acModelo",
  "acSerie",
]) {
  const count = documents.reduce(
    (sum, html) =>
      sum + (html.match(new RegExp(`\\bid=["']${id}["']`, "g")) || []).length,
    0
  );

  assert.equal(count, 1, `El ID #${id} debe aparecer exactamente una vez`);
}

console.log("A11Y_U3_U4_TARGETED_TEST=PASS");
console.log("TICKET_H1_PASS=YES");
console.log("ESTADO_ERROR_H1_FALLBACK_PASS=YES");
console.log("ESTADO_SUCCESS_TITLE_OWNER_PRESERVED=YES");
console.log("ACCESSIBLE_CONTROL_NAMES_PASS=YES");
console.log("ALTA_ERROR_ASSOCIATIONS_PASS=YES");
