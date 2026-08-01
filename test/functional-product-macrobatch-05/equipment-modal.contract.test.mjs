import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const clients = read("app/clientes.js"), detail = read("app/cliente.ui.js");
const modal = read("app/shared/client-product-registration.js"), html = read("app/cliente.html");

test("selector se cierra después de elegir", () => assert.match(clients, /chooseEquipment[\s\S]*aria-expanded", "false"/));
test("selector restaura foco después de elegir", () => assert.match(clients, /chooseEquipment[\s\S]*focus\(\{ preventScroll: true \}\)/));
test("Escape cierra sólo las sugerencias abiertas", () => assert.match(clients, /event\.key === "Escape"[\s\S]*closeEquipmentSuggestions/));
test("clic fuera cierra las sugerencias", () => assert.match(clients, /!event\.target\.closest\("\.cl-equipment-field"\).*closeEquipmentSuggestions/));
test("cambiar de pestaña cierra el modal de producto", () => assert.match(read("app/cliente.js"), /openTab[\s\S]*closeClientProductRegistration\(\)/));
test("CTA ya no dirige al alta interna", () => assert.doesNotMatch(detail, /Registrar desde alta interna/));
test("CTA se llama Registrar producto", () => assert.match(detail, /data-register-product>Registrar producto/));
test("modal declara semántica accesible", () => assert.match(html, /id="cfProductModal" role="dialog" aria-modal="true" aria-labelledby="cfProductTitle"/));
test("modal ofrece Máquina y Accesorio", () => {
  assert.match(html, /value="machine" checked> Máquina/);
  assert.match(html, /value="accessory"> Accesorio/);
});
test("modal captura modelo variante serie y compra", () => {
  ["cfProductModel", "cfProductVariant", "cfProductSerial", "cfProductDate"].forEach(id => assert.match(html, new RegExp(`id="${id}"`)));
});
test("catálogo se filtra por categoría", () => assert.match(modal, /startsWith\(kind === "machine" \? "Máquinas — " : "Accesorios — "\)/));
test("el flujo no inventa fetch ni RPC", () => {
  assert.doesNotMatch(modal, /\bfetch\s*\(/);
  assert.doesNotMatch(modal, /\.rpc\s*\(/);
});
test("validación evita un falso éxito", () => assert.match(modal, /No se guardó ningún cambio/));
test("modal usa ciclo de foco compartido", () => {
  assert.match(modal, /openDialog\("#cfProductModal"/);
  assert.match(modal, /initialFocus: "#cfProductSearch"/);
});
