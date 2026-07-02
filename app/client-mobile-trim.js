(function(){
  function normalize(s){
    return String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();
  }

  function pickCardFromHeading(h){
    let el = h;
    for (let i = 0; i < 7 && el && el !== document.body; i++, el = el.parentElement) {
      const txt = normalize(el.innerText || el.textContent || "");
      if (txt.length > 30 && txt.length < 1400) {
        const cs = getComputedStyle(el);
        const radius = parseFloat(cs.borderRadius || "0");
        const hasBox = radius >= 10 || cs.borderStyle !== "none" || cs.boxShadow !== "none";
        if (hasBox) return el;
      }
    }
    return h.parentElement || h;
  }

  function markOptionalSupportBlocks(){
    const needles = [
      "como agilizar tu caso",
      "vista previa"
    ];

    document.querySelectorAll("h1,h2,h3,h4,.title,.card-title,.section-title").forEach(h => {
      const t = normalize(h.textContent);
      if (!needles.some(n => t.includes(n))) return;
      const card = pickCardFromHeading(h);
      card.classList.add("tcMobileOptionalBlock");
      card.setAttribute("data-mobile-optional", "true");
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", markOptionalSupportBlocks, { once:true });
  } else {
    markOptionalSupportBlocks();
  }

  setTimeout(markOptionalSupportBlocks, 400);
})();
