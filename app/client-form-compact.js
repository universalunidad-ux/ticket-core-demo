(function(){
  function norm(s){
    return String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\*/g, "")
      .trim();
  }

  function fieldBoxFromLabel(label){
    let el = label;
    for (let i = 0; i < 7 && el && el !== document.body; i++, el = el.parentElement) {
      const hasInput = !!el.querySelector?.("input,textarea,select");
      const txt = norm(el.innerText || el.textContent || "");
      if (hasInput && txt.length > 2 && txt.length < 300) return el;
    }
    return label.parentElement || label;
  }

  function markContactGrid(){
    const wanted = [
      { key:"nombre", rx:/^nombre\b/ },
      { key:"correo", rx:/^correo\b|email/ },
      { key:"telefono", rx:/^telefono\b|^teléfono\b/ },
      { key:"empresa", rx:/^empresa\b|negocio/ }
    ];

    const labels = [...document.querySelectorAll("label,.label,.field-label,.form-label")];
    const found = [];

    for (const w of wanted) {
      const label = labels.find(l => w.rx.test(norm(l.textContent)));
      if (!label) continue;
      const box = fieldBoxFromLabel(label);
      if (!box || found.includes(box)) continue;
      box.classList.add("tcContactGridItem", "tcContactGridItem--" + w.key);
      found.push(box);
    }

    if (found.length < 3) return;

    let grid = document.querySelector(".tcContactGrid");
    if (!grid) {
      grid = document.createElement("div");
      grid.className = "tcContactGrid";
      found[0].parentNode.insertBefore(grid, found[0]);
    }

    found.forEach(el => {
      if (el.parentElement !== grid) grid.appendChild(el);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", markContactGrid, { once:true });
  } else {
    markContactGrid();
  }

  setTimeout(markContactGrid, 350);
})();
