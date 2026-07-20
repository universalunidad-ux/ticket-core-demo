/* ============================================================================
   CATÁLOGO JANOME MÉXICO — para sistema de tickets de soporte
   Fuente: https://janome.com.mx  (categorías disp.cat.aspx)
   ----------------------------------------------------------------------------
   Cada producto:  { id, nombre }
     - id     -> ID interno de Janome (también sirve para armar el enlace
                 de detalle: https://janome.com.mx/disp.prod.aspx?id=<id>)
     - nombre -> texto que ve el usuario / cliente
   ----------------------------------------------------------------------------
   Uso rápido:
     import { JANOME_CATALOGO, poblarSelect } from './janome_catalogo.js';
     poblarSelect(document.getElementById('spSystem'));
   ============================================================================ */

export const JANOME_CATALOGO = [
  {
    grupo: "Máquinas — Mecánicas",
    productos: [
      { id: 7,   nombre: "3008" },
      { id: 10,  nombre: "1008" },
      { id: 11,  nombre: "3016" },
      { id: 12,  nombre: "423S" },
      { id: 13,  nombre: "RE1706" },
      { id: 14,  nombre: "2212" },
      { id: 20,  nombre: "1600PQC" },
      { id: 24,  nombre: "3016LE" },
      { id: 27,  nombre: "2222" },
      { id: 28,  nombre: "Sew Mini Deluxe Pink" },
      { id: 29,  nombre: "Sew Mini Deluxe Gray" },
      { id: 282, nombre: "HD1000BE" },
      { id: 283, nombre: "HD3000BE" },
      { id: 284, nombre: "3022HD" },
      { id: 316, nombre: "1522RD" },
      { id: 317, nombre: "311PG" },
      { id: 318, nombre: "1522PG" },
      { id: 319, nombre: "3112RD" },
      { id: 321, nombre: "3112PK" },
      { id: 322, nombre: "3128" },
      { id: 324, nombre: "HD9" },
      { id: 326, nombre: "TM16" },
    ],
  },
  {
    grupo: "Máquinas — Collareteras",
    productos: [
      { id: 9,   nombre: "CoverPro 2000CPX" },
      { id: 328, nombre: "3000P" },
    ],
  },
  {
    grupo: "Máquinas — Overlock",
    productos: [
      { id: 241, nombre: "7034D" },
      { id: 323, nombre: "HD4BE" },
      { id: 330, nombre: "454D" },
    ],
  },
  {
    grupo: "Máquinas — Computarizadas",
    productos: [
      { id: 16,  nombre: "MC6700P" },
      { id: 18,  nombre: "2160DC" },
      { id: 19,  nombre: "4120QDC" },
      { id: 22,  nombre: "MC8200QC" },
      { id: 212, nombre: "1030MX" },
      { id: 213, nombre: "1050DC" },
      { id: 214, nombre: "5100" },
      { id: 320, nombre: "M7 Continental" },
      { id: 327, nombre: "TM30" },
      { id: 333, nombre: "Skyline S5 Edición Aniversario" },
    ],
  },
  {
    grupo: "Máquinas — Bordadoras",
    productos: [
      { id: 8,   nombre: "MC500E" },
      { id: 32,  nombre: "MB-4S" },
      { id: 33,  nombre: "MB-7" },
      { id: 34,  nombre: "MC400E" },
      { id: 325, nombre: "MC550E LE" },
      { id: 332, nombre: "MC100E" },
    ],
  },
  {
    grupo: "Máquinas — Bordadoras con costura",
    productos: [
      { id: 238, nombre: "MC15000" },
      { id: 329, nombre: "MC9850" },
      { id: 331, nombre: "MC1000" },
    ],
  },
  {
    grupo: "Máquinas — Descontinuadas",
    productos: [
      { id: 5,   nombre: "1000CPX" },
      { id: 15,  nombre: "MC230E" },
      { id: 17,  nombre: "Skyline S5" },
      { id: 21,  nombre: "MC6300P" },
      { id: 23,  nombre: "MC8900QCP" },
      { id: 25,  nombre: "3016SE" },
      { id: 26,  nombre: "3112" },
      { id: 30,  nombre: "Sew Mini Deluxe Blue" },
      { id: 31,  nombre: "Sew Mini Deluxe Orange" },
      { id: 35,  nombre: "MC370E" },
      { id: 215, nombre: "MC550E" },
      { id: 237, nombre: "MC9900" },
      { id: 239, nombre: "2012" },
      { id: 240, nombre: "3022" },
      { id: 242, nombre: "9102D" },
      { id: 243, nombre: "1000CP" },
      { id: 244, nombre: "DC2007LE" },
      { id: 246, nombre: "MC200E" },
      { id: 247, nombre: "1117S" },
      { id: 248, nombre: "3004" },
      { id: 249, nombre: "2018S" },
      { id: 250, nombre: "2039SN" },
      { id: 251, nombre: "2041LX" },
      { id: 252, nombre: "2049LX" },
      { id: 253, nombre: "4052LX" },
      { id: 254, nombre: "134D" },
      { id: 255, nombre: "8100" },
      { id: 256, nombre: "MC6500" },
      { id: 261, nombre: "MC350E" },
      { id: 262, nombre: "MC300E" },
      { id: 263, nombre: "MC9700" },
      { id: 264, nombre: "MC1100" },
      { id: 265, nombre: "6021" },
      { id: 266, nombre: "DC2010" },
      { id: 267, nombre: "Hello Kitty 18750" },
      { id: 268, nombre: "Hello Kitty 15822" },
      { id: 269, nombre: "MC7700" },
      { id: 314, nombre: "792PG" },
      { id: 315, nombre: "793PG" },
    ],
  },
  {
    grupo: "Accesorios — Collarete",
    productos: [
      { id: 105, nombre: "Guía para dobladillo Cover" },
      { id: 106, nombre: "Aditamento para colocar bies Cover (blister)" },
      { id: 107, nombre: "Aditamento de elástico delgado Cover (blister)" },
      { id: 108, nombre: "Aditamento de elástico ancho Cover" },
      { id: 110, nombre: "Pie c/guía al centro Cover" },
      { id: 112, nombre: "Guía de costura ajustable para Cover" },
      { id: 113, nombre: "Aditamento de bies 12mm" },
      { id: 114, nombre: "Aditamento de bies 8mm" },
      { id: 115, nombre: "Soporte de bies" },
      { id: 270, nombre: "Pie básico transparente Cover" },
    ],
  },
  {
    grupo: "Accesorios — Coser Mecánicas",
    productos: [
      { id: 53,  nombre: "Pie para zig zag" },
      { id: 54,  nombre: "Pie para alforzas" },
      { id: 57,  nombre: "Pie transparente (F)" },
      { id: 58,  nombre: "Pie para cierre normal" },
      { id: 59,  nombre: "Pie para dobladillo invisible" },
      { id: 60,  nombre: "Pie dobladillador 2mm" },
      { id: 63,  nombre: "Pie para overlock" },
      { id: 64,  nombre: "Pie para puntada recta" },
      { id: 65,  nombre: "Pie ultradeslizante" },
      { id: 66,  nombre: "Pie para perlas" },
      { id: 67,  nombre: "Pie para doble arrastre con guía" },
      { id: 68,  nombre: "Pie de rodillo" },
      { id: 69,  nombre: "Pie para tricot" },
      { id: 70,  nombre: "Pie para cierre invisible plástico" },
      { id: 71,  nombre: "Pie para cierre invisible metal" },
      { id: 72,  nombre: "Pie para 1 cordón" },
      { id: 73,  nombre: "Pie para tres cordones" },
      { id: 74,  nombre: "Pie para ojal automático" },
      { id: 75,  nombre: "Carrete de plástico" },
      { id: 77,  nombre: "Pie de 1/4 de pulgada" },
      { id: 80,  nombre: "Pie para listón y lentejuela" },
      { id: 81,  nombre: "Pie de ojal en cuatro pasos" },
      { id: 82,  nombre: "Pie de resorte / plisar" },
      { id: 193, nombre: "Pie dobladillador 4mm" },
      { id: 194, nombre: "Pie dobladillador 6mm" },
      { id: 219, nombre: "Pie para botón" },
      { id: 273, nombre: "Pie para bies" },
      { id: 286, nombre: "Pie de cierre E" },
    ],
  },
  {
    grupo: "Accesorios — Coser Computarizadas",
    productos: [
      { id: 51,  nombre: 'Pie para zigzag "A" 7mm de ancho' },
      { id: 116, nombre: "Aditamento para bies 9mm (blister)" },
      { id: 117, nombre: "Aditamento para círculos 9mm (blister ing)" },
      { id: 118, nombre: "Ditch Quilting Foot 9mm" },
      { id: 119, nombre: "Pie (F) transparente 9mm" },
      { id: 120, nombre: "Pie AcuFeed angosto HP2 para 9mm" },
      { id: 121, nombre: "Pie angosto completo 9mm" },
      { id: 122, nombre: "Pie de 1/4 de pulgada (sin guía 9mm)" },
      { id: 123, nombre: "Pie de 1/4 de pulgada angosto 9mm" },
      { id: 124, nombre: "Pie de 1/4 de pulgada 9mm (AcuFeed)" },
      { id: 125, nombre: 'Pie de 1/4" 9mm (blister ing)' },
      { id: 126, nombre: "Pie para 3 cordones 9mm" },
      { id: 127, nombre: "Pie para alforza 9mm (blister ing)" },
      { id: 128, nombre: "Pie para alforzas angosto 9mm" },
      { id: 129, nombre: "Pie para bies 9mm" },
      { id: 130, nombre: "Pie para bordado libre abierto 9mm" },
      { id: 131, nombre: "Pie para botón 9mm" },
      { id: 132, nombre: "Pie para cierre E AcuFeed 9mm" },
      { id: 133, nombre: "Pie para cierre invisible 9mm" },
      { id: 134, nombre: "Pie Ditch Quilting 9mm (blister AcuFeed)" },
      { id: 135, nombre: "Pie para doble arrastre 9mm (ancho)" },
      { id: 136, nombre: "Pie para doble arrastre con guía 9mm" },
      { id: 137, nombre: "Pie para doble arrastre con guías 9mm (blister)" },
      { id: 138, nombre: "Pie para doble arrastre 9mm (delgado)" },
      { id: 139, nombre: "Pie para fruncido 9mm" },
      { id: 140, nombre: "Prensatelas transparente con guías 9mm" },
      { id: 141, nombre: "Pie para listón y lentejuela 9mm" },
      { id: 142, nombre: "Pie para ojal 9mm" },
      { id: 143, nombre: "Pie para perlas ranura ancha 9mm" },
      { id: 144, nombre: "Pie para piping para 9mm" },
      { id: 145, nombre: "Pie para punta recta 9mm (blister)" },
      { id: 146, nombre: "Pie para puntada abierta AcuFeed 9mm (abierto)" },
      { id: 147, nombre: "Pie para puntada ciega 9mm" },
      { id: 148, nombre: "Pie para puntada recta AcuFeed 9mm (blister)" },
      { id: 149, nombre: "Pie ultradeslizante 9mm" },
      { id: 150, nombre: "Pie ultradeslizante con placa 9mm" },
      { id: 151, nombre: "Pie para zigzag (A) 9mm" },
      { id: 152, nombre: "Pie dobladillador 4mm (9mm)" },
      { id: 153, nombre: "Pie dobladillador 6mm (9mm)" },
      { id: 154, nombre: "Pie dobladillador 2mm (9mm)" },
      { id: 156, nombre: "Pie para dobladillo invisible 9mm" },
      { id: 157, nombre: "Pie para perla 9mm (angosto)" },
      { id: 158, nombre: "Pie para regla de 1/4 de pulgada 9mm" },
      { id: 159, nombre: "Pie transparente completo 9mm" },
      { id: 160, nombre: "Pie transparente con guía deslizable 9mm" },
      { id: 161, nombre: "Pie transparente F2 nuevo 9mm" },
      { id: 162, nombre: "Plizador Ruffler para 9mm (ing)" },
      { id: 163, nombre: "Pie para arrastre rotatorio" },
      { id: 164, nombre: "Set para quilting y guías 9mm (blister)" },
      { id: 217, nombre: "Pie para bies" },
      { id: 218, nombre: "Pie de bordado libre" },
      { id: 220, nombre: "Pie de cierre E" },
      { id: 221, nombre: "Pie de dobladillo invisible" },
      { id: 222, nombre: "Pie de doble arrastre con guía" },
      { id: 223, nombre: "Pie de ojal automático" },
      { id: 224, nombre: "Pie para overlock C" },
      { id: 225, nombre: "Pie para overlock M" },
      { id: 229, nombre: "Pie para tricot" },
      { id: 231, nombre: "Pie Ditch Quilting" },
      { id: 233, nombre: "Pie dobladillador 4mm" },
      { id: 236, nombre: "Pie transparente abierto" },
      { id: 299, nombre: "Pie de doble arrastre para 1600P" },
      { id: 300, nombre: "Mesa de resina transparente 1600P" },
      { id: 301, nombre: "Pie de 1/4 de pulgada 1600P" },
      { id: 302, nombre: "Pie de bordado libre 1600P" },
      { id: 303, nombre: "Pie de bordado libre regla con placa 1600P" },
      { id: 304, nombre: "Ditch Quilting Foot 1600P" },
      { id: 305, nombre: "Pie de cierre ajustable 1600P" },
      { id: 307, nombre: "Pie de cinta 1600P" },
      { id: 308, nombre: "Pie para puntada recta (angosto) 1600P" },
      { id: 309, nombre: "Pie para puntada recta con placa 1600P" },
      { id: 310, nombre: "Pie para terciopelo 1600P" },
      { id: 311, nombre: "Pie ultradeslizante para 1600P" },
      { id: 312, nombre: "Set de bordado libre con placa 1600P" },
    ],
  },
  {
    grupo: "Accesorios — Overlock",
    productos: [
      { id: 94,  nombre: "Pinzas de ensartado para overlock" },
      { id: 95,  nombre: "Pie para dobladillo invisible (over)" },
      { id: 96,  nombre: "Pie para cordón A (over)" },
      { id: 97,  nombre: "Pie para cordón B (over)" },
      { id: 98,  nombre: "Aditamento de elástico (over)" },
      { id: 99,  nombre: "Aditamento para perlas (over)" },
      { id: 100, nombre: "Pie de 1/8 para cordón (over)" },
      { id: 101, nombre: "Pie de 3/16 para cordón (over)" },
      { id: 102, nombre: "Gathering Foot (over)" },
      { id: 103, nombre: "Plizador para over" },
    ],
  },
  {
    grupo: "Accesorios — Bordadoras (Aros)",
    productos: [
      { id: 76,  nombre: "Aro SQ14B" },
      { id: 83,  nombre: "Aro A básico" },
      { id: 84,  nombre: "Aro B" },
      { id: 85,  nombre: "Aro C" },
      { id: 86,  nombre: "Aro F circular" },
      { id: 87,  nombre: "Aro Giga Hoop D" },
      { id: 88,  nombre: "Aro para gorra bordadora" },
      { id: 89,  nombre: "Aro A para MC200E" },
      { id: 90,  nombre: "Aro 5x5 de MC200E" },
      { id: 91,  nombre: "Aro RE20B" },
      { id: 93,  nombre: "Aro RE10B" },
      { id: 287, nombre: "Aro SQ20B" },
      { id: 288, nombre: "Aro RE28B" },
    ],
  },
  {
    grupo: "Accesorios — Misceláneos",
    productos: [
      { id: 272, nombre: "Kit de extensión máquina mecánica serie 20/30" },
      { id: 275, nombre: "Kit de extensión máquina mecánica 423S" },
      { id: 276, nombre: "Kit para máquinas 2160DC / 1050DC" },
      { id: 278, nombre: "Mesa de extensión 7034D / 9102D" },
      { id: 279, nombre: "Kit de extensión para Cover 1000CPX / 2000CPX" },
      { id: 280, nombre: "Maleta para máquina recta MX" },
      { id: 281, nombre: "Bolsa de transporte Janome rosa" },
      { id: 290, nombre: "Aguja #9" },
      { id: 292, nombre: "Aguja #11" },
      { id: 294, nombre: "Aguja #14" },
      { id: 295, nombre: "Aguja #16" },
      { id: 296, nombre: "Aguja #11 punto de bola" },
      { id: 297, nombre: "Aguja #11 punto azul" },
      { id: 298, nombre: "Aguja #14 punto rojo" },
    ],
  },
  {
    grupo: "Accesorios — Quilting",
    productos: [
      { id: 52, nombre: "Pie de bordado libre" },
    ],
  },
  {
    grupo: "Accesorios — Refacciones Básicas",
    productos: [
      { id: 36,  nombre: "Bobina máquina recta" },
      { id: 37,  nombre: "Portaprensatelas máquina recta" },
      { id: 38,  nombre: "Pedal máquina recta / over" },
      { id: 39,  nombre: "Botella de aceite" },
      { id: 40,  nombre: "Desarmador grueso" },
      { id: 41,  nombre: "Desarmador delgado" },
      { id: 42,  nombre: "Enhebrador de aguja" },
      { id: 165, nombre: "Bobina para 6500P / MC350E" },
      { id: 166, nombre: "Bobina para MC300E / 4052 / 2007" },
      { id: 168, nombre: "Bobina regular para MC500E / MC400E" },
      { id: 169, nombre: "Placa aguja para overlock" },
      { id: 170, nombre: "Placa aguja para serie 20/30" },
      { id: 171, nombre: "Ensartador para 2160DC" },
      { id: 172, nombre: "Ensartador para serie 30" },
      { id: 173, nombre: "Ensartador para serie 20" },
      { id: 174, nombre: "Ensartador para 6500 / 300E / 350E" },
      { id: 176, nombre: "Engrane inferior oscilatorio serie L" },
      { id: 177, nombre: "Engrane inferior oscilatorio serie 20/30" },
      { id: 178, nombre: "Motor para MC300E / MC350E / MC370E" },
      { id: 179, nombre: "Motor MC200E" },
      { id: 180, nombre: "Cuchilla superior 6002, 204D, 9102D" },
      { id: 181, nombre: "Cuchilla inferior 634D, 204D, 9102D, 7034D" },
      { id: 182, nombre: "Cuchilla superior modelos anteriores" },
      { id: 183, nombre: "Cuchilla inferior modelos anteriores" },
      { id: 184, nombre: "Gancho inferior máq. overlock" },
      { id: 185, nombre: "Gancho superior máq. overlock" },
      { id: 186, nombre: "Cangrejo máquina recta" },
      { id: 187, nombre: "Ring del cangrejo" },
      { id: 188, nombre: "Foco de presión máquina recta" },
      { id: 189, nombre: "Goma base máquina recta (ancha)" },
      { id: 191, nombre: "Motor para máquina serie 20/30 / 423S" },
      { id: 192, nombre: "Motor para máquina overlock" },
    ],
  },
];

/* ----------------------------------------------------------------------------
   Helpers
   -------------------------------------------------------------------------- */

// Enlace de detalle del producto en janome.com.mx
export function urlProducto(id) {
  return `https://janome.com.mx/disp.prod.aspx?id=${id}`;
}

// Llena un <select> con optgroups. El value de cada opción es el ID del
// producto (estable). Si prefieres guardar el nombre, cambia opt.value.
export function poblarSelect(selectEl, { placeholder = "Selecciona tu equipo o accesorio" } = {}) {
  if (!selectEl) return;
  selectEl.innerHTML = "";

  const ph = document.createElement("option");
  ph.value = "";
  ph.textContent = placeholder;
  selectEl.appendChild(ph);

  for (const grupo of JANOME_CATALOGO) {
    const og = document.createElement("optgroup");
    og.label = grupo.grupo;
    for (const p of grupo.productos) {
      const opt = document.createElement("option");
      opt.value = p.id;                 // <-- guarda el ID en el ticket
      opt.dataset.nombre = p.nombre;    // nombre legible disponible si lo necesitas
      opt.dataset.grupo = grupo.grupo;
      opt.textContent = p.nombre;
      og.appendChild(opt);
    }
    selectEl.appendChild(og);
  }

  // Opción de cierre: equipo o accesorio que no está en el catálogo.
  const otro = document.createElement("option");
  otro.value = "OTRO";
  otro.dataset.nombre = "Otro / no aparece en la lista";
  otro.dataset.grupo = "Otro";
  otro.textContent = "Otro / no aparece en la lista";
  selectEl.appendChild(otro);
}

// Lista plana { id, nombre, grupo } por si la necesitas para buscador, etc.
export const JANOME_PLANO = JANOME_CATALOGO.flatMap((g) =>
  g.productos.map((p) => ({ id: p.id, nombre: p.nombre, grupo: g.grupo }))
);

/* ----------------------------------------------------------------------------
   montarBuscadorEquipo: convierte un <select> (oculto) en un buscador con
   filtrado en vivo y categorías. El usuario ESCRIBE y la lista se va
   recortando a las coincidencias (por modelo o por categoría: "overlock",
   "bordadora", "accesorio"…). Al elegir, guarda el valor en el <select>
   oculto y dispara su evento "change" — así el resto del formulario
   (sistemaLabel, pintarAyudaProducto, preview) sigue funcionando igual.

   - selectEl: el <select id="spSystem"> (oculto, ya poblado con poblarSelect)
   - hostEl:   contenedor vacío donde se construye el buscador
   - onPick(id): callback opcional al elegir
   -------------------------------------------------------------------------- */
function _norm(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

let _comboInstance = 0;

export function montarBuscadorEquipo(selectEl, hostEl, { onPick, placeholder } = {}) {
  if (!selectEl || !hostEl) return;
  selectEl.hidden = true;
  selectEl.setAttribute("aria-hidden", "true");
  selectEl.tabIndex = -1;

  const base = hostEl.id || selectEl.id || `jn-combo-${++_comboInstance}`;
  const listId = `${base}-list`;

  hostEl.classList.add("jn-combo");
  hostEl.innerHTML = `
    <input type="text" class="input jn-combo-input" autocomplete="off" spellcheck="false"
           placeholder="${placeholder || "Escribe tu modelo o tipo (ej. 3008, overlock, bordadora)…"}" />
    <button type="button" class="jn-combo-clear" aria-label="Borrar" hidden>×</button>
    <div class="jn-combo-panel" hidden>
      <div class="jn-combo-list" role="listbox"></div>
      <div class="jn-combo-cats" aria-label="Categorías"></div>
    </div>
  `;
  const input = hostEl.querySelector(".jn-combo-input");
  const requestedInputId = String(hostEl.dataset.inputId || "").trim();
  input.id = requestedInputId || `${base}-input`;
  const clear = hostEl.querySelector(".jn-combo-clear");
  const panel = hostEl.querySelector(".jn-combo-panel");
  const list = hostEl.querySelector(".jn-combo-list");
  const cats = hostEl.querySelector(".jn-combo-cats");

  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-controls", listId);
  list.id = listId;

  let items = [], idx = -1, activeCat = "", confirmedName = "";

  /* B17C43D: el texto de una selección CONFIRMADA no debe usarse como filtro
     al reabrir o cambiar de categoría (causaba "Sin coincidencias" fantasma).
     Solo filtra lo que el usuario está escribiendo de verdad. */
  const selectedNombre = () => selectEl?.selectedOptions?.[0]?.dataset?.nombre || "";
  const queryFor = () => {
    const v = (input.value || "").trim();
    if (!v) return "";
    const n = _norm(v);
    if (confirmedName && n === _norm(confirmedName)) return "";
    if (n === _norm(selectedNombre())) return "";
    return v;
  };

  // Columna derecha FIJA: categorías. Clic = filtra la lista de la izquierda.
  const renderCats = () => {
    cats.innerHTML = "";
    const mk = (label, val) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "jn-cat-btn" + (activeCat === val ? " is-active" : "");
      b.dataset.cat = val;
      b.textContent = label;
      cats.appendChild(b);
    };
    mk("Todas", "");
    for (const g of JANOME_CATALOGO) mk(g.grupo, g.grupo);
  };

  const render = (q = "") => {
    const nq = _norm(q.trim());
    list.innerHTML = "";
    items = [];
    let total = 0;

    for (const g of JANOME_CATALOGO) {
      if (activeCat && g.grupo !== activeCat) continue;
      const grupoMatch = nq && _norm(g.grupo).includes(nq);
      const matches = g.productos.filter(
        (p) => !nq || grupoMatch || _norm(p.nombre).includes(nq)
      );
      if (!matches.length) continue;

      const h = document.createElement("div");
      h.className = "jn-combo-group";
      h.textContent = g.grupo;
      list.appendChild(h);

      for (const p of matches) {
        const it = document.createElement("button");
        it.type = "button";
        it.className = "jn-combo-item";
        it.setAttribute("role", "option");
        it.tabIndex = -1;
        it.id = `${base}-opt-${items.length}`;
        it.dataset.id = p.id;
        it.dataset.nombre = p.nombre;
        it.dataset.grupo = g.grupo;
        it.textContent = p.nombre;
        list.appendChild(it);
        items.push(it);
        if (++total >= 120) break;
      }
      if (total >= 120) break;
    }

    const otro = document.createElement("button");
    otro.type = "button";
    otro.className = "jn-combo-item jn-combo-otro";
    otro.setAttribute("role", "option");
    otro.tabIndex = -1;
    otro.id = `${base}-opt-${items.length}`;
    otro.dataset.id = "OTRO";
    otro.dataset.nombre = "Otro / no aparece en la lista";
    otro.dataset.grupo = "Otro";
    otro.innerHTML = `Otro / no aparece en la lista<span class="jn-cat">Mi producto no está en el listado</span>`;
    list.appendChild(otro);
    items.push(otro);

    if (!total) {
      const e = document.createElement("div");
      e.className = "jn-combo-empty";
      e.textContent = "Sin coincidencias. Prueba con el modelo (ej. 3008) o el tipo (overlock, bordadora).";
      list.insertBefore(e, otro);
    }
    idx = -1;
    input.removeAttribute("aria-activedescendant");
  };

  const abrir = () => {
    /* B17C43E-R:
       - conserva visible el producto confirmado;
       - al reabrir vuelve a Todas;
       - el producto anterior no se usa como filtro invisible. */
    activeCat = "";
    renderCats();
    render("");
    panel.hidden = false;
    input.setAttribute("aria-expanded", "true");

    if (confirmedName && _norm(input.value) === _norm(confirmedName)) {
      requestAnimationFrame(() => input.select());
    }
  };
  const cerrar = () => {
    panel.hidden = true;
    idx = -1;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  };

  const marcar = () => {
    items.forEach((it, i) => it.classList.toggle("is-active", i === idx));
    if (items[idx]) {
      input.setAttribute("aria-activedescendant", items[idx].id);
      items[idx].scrollIntoView({ block: "nearest" });
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  };

  const elegir = (it) => {
    if (!it) return;
    selectEl.value = it.dataset.id;
    input.value = it.dataset.nombre;
    confirmedName = it.dataset.nombre; /* B17C43D: nueva selección reemplaza la anterior */
    clear.hidden = false;
    selectEl.dispatchEvent(new Event("change", { bubbles: true }));
    cerrar();
    if (typeof onPick === "function") onPick(it.dataset.id);
  };

  input.addEventListener("focus", abrir);

  /* B17C43F:
     Después de elegir un producto el input puede conservar el foco.
     Un nuevo clic debe reabrir Todas aunque focus no vuelva a dispararse. */
  input.addEventListener("click", () => {
    if (panel.hidden) {
      abrir();
      return;
    }

    if (
      confirmedName &&
      _norm(input.value) === _norm(confirmedName)
    ) {
      activeCat = "";
      renderCats();
      render("");
    }
  });
  input.addEventListener("input", () => {
    clear.hidden = !input.value;
    render(input.value);
    panel.hidden = false;
    input.setAttribute("aria-expanded", "true");
    if (!input.value.trim() && selectEl.value) {
      selectEl.value = "";
      selectEl.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Tab") { cerrar(); return; }
    if (panel.hidden) { if (e.key === "ArrowDown") abrir(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); idx = Math.min(idx + 1, items.length - 1); marcar(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); idx = Math.max(idx - 1, 0); marcar(); }
    else if (e.key === "Enter") { e.preventDefault(); elegir(items[idx] || items[0]); }
    else if (e.key === "Escape") { cerrar(); }
  });
  clear.addEventListener("click", () => {
    input.value = ""; clear.hidden = true; activeCat = ""; confirmedName = "";
    selectEl.value = ""; selectEl.dispatchEvent(new Event("change", { bubbles: true }));
    renderCats(); render(""); panel.hidden = false; input.focus();
  });

  // un solo handler (mousedown para no perder foco): item o categoría
  panel.addEventListener("mousedown", (e) => {
    const cat = e.target.closest(".jn-cat-btn");
    if (cat) {
      e.preventDefault();
      activeCat = cat.dataset.cat;

      /* B17C43E-R:
         cambiar categoría limpia la búsqueda temporal, pero no borra
         el producto confirmado hasta seleccionar uno nuevo. */
      if (confirmedName) input.value = confirmedName;
      else input.value = "";

      clear.hidden = !input.value;
      renderCats();
      render("");
      return;
    }
    const it = e.target.closest(".jn-combo-item");
    if (it) { e.preventDefault(); elegir(it); }
  });
  document.addEventListener("click", (e) => { if (!hostEl.contains(e.target)) cerrar(); });
}
