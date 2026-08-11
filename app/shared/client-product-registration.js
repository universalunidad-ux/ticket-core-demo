import { openDialog, closeDialog } from "../global.js?v=frontend-p0-20260811-01";
import { JANOME_CATALOGO } from "../janome/janome_catalogo.js";

const $ = selector => document.querySelector(selector);
const normalize = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
let mounted = false;
let activeClientId = null;

const groupsFor = kind => JANOME_CATALOGO.filter(group =>
  String(group.grupo || "").startsWith(kind === "machine" ? "Máquinas — " : "Accesorios — "),
);

function renderCatalog() {
  const select = $("#cfProductModel"), search = normalize($("#cfProductSearch")?.value);
  const kind = document.querySelector("[name='productKind']:checked")?.value || "machine";
  if (!select) return;
  const groups = groupsFor(kind).map(group => {
    const options = group.productos.filter(product => !search || normalize(`${group.grupo} ${product.nombre}`).includes(search));
    if (!options.length) return "";
    return `<optgroup label="${String(group.grupo).replaceAll('"', "&quot;")}">${options.map(product => `<option value="${String(product.id).replaceAll('"', "&quot;")}">${String(product.nombre).replaceAll("<", "&lt;")}</option>`).join("")}</optgroup>`;
  }).join("");
  select.innerHTML = `<option value="">${groups ? "Seleccione una opción" : "Sin coincidencias"}</option>${groups}`;
  $("#cfProductStatus").textContent = groups
    ? "Persistencia pendiente de contrato backend."
    : "No hay productos del catálogo que coincidan con la búsqueda.";
}

function resetForm() {
  $("#cfProductForm")?.reset();
  if ($("#cfProductStatus")) {
    $("#cfProductStatus").className = "status warn";
    $("#cfProductStatus").textContent = "Persistencia pendiente de contrato backend.";
  }
  renderCatalog();
}

export function closeClientProductRegistration() {
  closeDialog("#cfProductModal");
}

export function mountClientProductRegistration({ clientId } = {}) {
  activeClientId = clientId || null;
  if (mounted) return;
  mounted = true;
  document.addEventListener("click", event => {
    const trigger = event.target.closest?.("[data-register-product]");
    if (trigger) {
      resetForm();
      openDialog("#cfProductModal", {
        trigger,
        initialFocus: "#cfProductSearch",
        fallbackFocus: trigger,
        onCloseRequest: closeClientProductRegistration,
      });
      return;
    }
    if (event.target.id === "cfProductModal") closeClientProductRegistration();
  });
  $("#cfProductClose")?.addEventListener("click", closeClientProductRegistration);
  $("#cfProductCancel")?.addEventListener("click", closeClientProductRegistration);
  $("#cfProductSearch")?.addEventListener("input", renderCatalog);
  document.querySelectorAll("[name='productKind']").forEach(input => input.addEventListener("change", () => {
    $("#cfProductSearch").value = "";
    renderCatalog();
  }));
  $("#cfProductForm")?.addEventListener("submit", event => {
    event.preventDefault();
    const form = event.currentTarget, status = $("#cfProductStatus");
    if (!form.reportValidity() || !activeClientId) {
      status.className = "status bad";
      status.textContent = activeClientId ? "Seleccione un producto válido del catálogo." : "No se pudo identificar al cliente.";
      return;
    }
    status.className = "status warn";
    status.textContent = "Datos validados. No se guardó ningún cambio: falta una operación backend autorizada, auditable e idempotente.";
  });
  renderCatalog();
}
