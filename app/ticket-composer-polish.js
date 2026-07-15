/* D2E2_TICKET_COMPOSER_POLISH_SAFE_ACTIVE */
(function(){
  /* B17C1_REAL_ADMIN_ESCALATE */
  "use strict";

  console.info("D2E3_TICKET_POLISH_LOADED");
  // D2E3_TICKET_POLISH_TIGHT_GAP

  const $  = (q, r=document) => r.querySelector(q);
  const $$ = (q, r=document) => Array.from(r.querySelectorAll(q));

  const clean = v => String(v || "").replace(/\s+/g, " ").trim();

  const clamp = (n,min,max) => Math.max(min, Math.min(max, n));

function normalizeEnterCopy(){
    const enter = $("#tkEnterSends");
    if(!enter) return;

    const host = enter.closest("label") || enter.parentElement;
    if(!host) return;

    host.classList.add("tc-enter-clean");

    host.querySelectorAll("span:not(.tc-enter-copy)").forEach(n => n.remove());

    Array.from(host.childNodes).forEach(n => {
      if(n.nodeType === Node.TEXT_NODE) n.textContent = " ";
    });

    let copy = host.querySelector(".tc-enter-copy");
    if(!copy){
      copy = document.createElement("span");
      copy.className = "tc-enter-copy";
      host.appendChild(copy);
    }

    copy.textContent = "Tecla Enter envía respuesta";
  }

  function cleanSoundTestPill(){
    const menu = $("#tkThreadGearMenu") || $(".thread-gear-menu");
    if(!menu) return;

    const buttons = $$("button", menu).filter(b => /probar\s+sonido/i.test(clean(b.textContent)));
    if(buttons.length > 1){
      buttons[0].classList.add("tc-hide-top-sound-test");
      buttons[0].setAttribute("aria-hidden", "true");
    }
  }

  function markAttachmentCards(){
    $$(".thread-file-card").forEach(card => {
      card.classList.add("tc-thumb-only-card");
      card.setAttribute("role", "button");
      card.setAttribute("tabindex", "0");

      const opener = card.matches("[data-thread-open],[data-ev-open]") ? card : card.querySelector("[data-thread-open],[data-ev-open]");
      if(opener && !card.dataset.evOpen){
        card.dataset.evOpen = opener.dataset.threadOpen || opener.dataset.evOpen || "";
      }

      const name = clean(card.querySelector(".thread-file-main b")?.textContent) ||
                   card.getAttribute("title") ||
                   "Archivo adjunto";
      card.setAttribute("aria-label", "Abrir " + name);
    });
  }

  function closestMessageMeta(card){
    const msg = card?.closest(".log-msg,.thread-msg,.event-card,.timeline-item,[data-event-id]") || null;
    const whole = clean(msg?.textContent || "");

    let who = clean(
      msg?.querySelector(".log-author,.thread-author,.msg-author,.author,strong,b")?.textContent
    );

    if(!who){
      if(/\bcliente\b/i.test(whole)) who = "Cliente";
      else if(/\bsoporte\b/i.test(whole)) who = "Soporte";
      else who = "Adjunto";
    }

    let time = clean(
      msg?.querySelector("time,.log-time,.thread-time,.msg-time,.mut")?.textContent
    );

    return { who, time };
  }

  function bindAttachmentCards(){
    if(window.__D2E2_TICKET_ATTACHMENT_BIND__) return;
    window.__D2E2_TICKET_ATTACHMENT_BIND__ = true;

    document.addEventListener("click", e => {
      const card = e.target.closest(".thread-file-card.tc-thumb-only-card");
      if(!card) return;
      if(e.target.closest(".ev-menu,.ev-menu-wrap,[data-ev-menu],[data-ev-download],[data-ev-copy],[data-ev-open-new]")) return;

      window.__D2E2_ACTIVE_FILE_META__ = closestMessageMeta(card);

      /* D2F: no abrir aquí; ticket.js maneja data-thread-open. Este listener solo guarda meta para el visor. */
    }, true);

    document.addEventListener("keydown", e => {
      if(e.key !== "Enter" && e.key !== " ") return;
      const card = e.target.closest?.(".thread-file-card.tc-thumb-only-card");
      if(!card) return;

      window.__D2E2_ACTIVE_FILE_META__ = closestMessageMeta(card);

      const opener = card.matches("[data-thread-open],[data-ev-open]") ? card : card.querySelector("[data-thread-open],[data-ev-open]");
      if(opener){
        e.preventDefault();
        opener.click();
      }
    }, true);
  }

  function clickExistingClose(modal){
    const btn = modal.querySelector('[data-close], [data-ev-close], button[aria-label*="Cerrar"], button[title*="Cerrar"]');
    if(btn) return btn.click();
    modal.setAttribute("hidden", "");
  }

  function evidenceDownload(modal){
    const a = modal.querySelector('a[download], a[href]');
    if(a) a.click();
  }

  function d2hClampEvidencePan(media, x, y, z){
    const body = document.getElementById("evBody");
    if(!body || !media) return { x:0, y:0 };

    const br = body.getBoundingClientRect();
    const baseW = media.offsetWidth || media.clientWidth || br.width;
    const baseH = media.offsetHeight || media.clientHeight || br.height;

    const maxX = Math.max(0, (baseW * z - br.width) / 2);
    const maxY = Math.max(0, (baseH * z - br.height) / 2);

    return {
      x: Math.max(-maxX, Math.min(maxX, x)),
      y: Math.max(-maxY, Math.min(maxY, y))
    };
  }

  function d2hEvidenceRotationFit(media, rot){
    if(!media) return 1;

    const deg = ((Math.round(Number(rot || 0) / 90) * 90) % 360 + 360) % 360;
    if(deg % 180 === 0) return 1;

    const body = media.closest("#evBody") || media.parentElement;
    if(!body) return 1;

    const availableW = Math.max(1, Number(body.clientWidth || 0) - 32);
    const availableH = Math.max(1, Number(body.clientHeight || 0) - 32);

    const w = Number(media.offsetWidth || media.naturalWidth || media.videoWidth || 0);
    const h = Number(media.offsetHeight || media.naturalHeight || media.videoHeight || 0);

    if(!availableW || !availableH || !w || !h) return 1;

    return Math.max(.1, Math.min(1, availableW / h, availableH / w));
  }

  function applyEvidenceTransform(media){
    if(!media) return;

    let z = Number(media.dataset.zoom || "1");
    if(!Number.isFinite(z)) z = 1;
    z = Math.max(1, Math.min(3, z));

    let x = Number(media.dataset.panX || "0");
    let y = Number(media.dataset.panY || "0");
    if(!Number.isFinite(x)) x = 0;
    if(!Number.isFinite(y)) y = 0;

    let rot = Number(media.dataset.rotate || "0");
    if(!Number.isFinite(rot)) rot = 0;
    rot = Math.round(rot / 90) * 90;

    if(z <= 1.01){
      z = 1;
      x = 0;
      y = 0;
    }else{
      const c = d2hClampEvidencePan(media, x, y, z);
      x = c.x;
      y = c.y;
    }

    media.dataset.zoom = String(z);
    media.dataset.panX = String(Math.round(x));
    media.dataset.panY = String(Math.round(y));
    media.dataset.zoomed = z > 1.01 ? "1" : "0";
    media.dataset.rotate = String(rot);
    media.dataset.rotated = rot !== 0 ? "1" : "0";
    const rotated = rot !== 0;
    const fit = rotated ? d2hEvidenceRotationFit(media, rot) : 1;
    const finalScale = Math.max(.1, Math.round((z * fit) * 1000) / 1000);

    if(!rotated && z <= 1.01){
      media.style.transform = "none";
    }else{
      media.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0) scale(${finalScale}) rotate(${rot}deg)`;
    }
    media.style.transformOrigin = "center center";
    window.__TC_VIEWER_CLAMP__ = "B9SAFE";
  }



  function bindEvidencePan(media){
    if(!media || media.dataset.panBound) return;
    media.dataset.panBound = "1";

    media.addEventListener("pointerdown", e => {
      const z = Number(media.dataset.zoom || "1");
      if(z <= 1.01) return;

      e.preventDefault();
      e.stopPropagation();

      media.setPointerCapture?.(e.pointerId);
      media.dataset.panning = "1";

      const startX = e.clientX;
      const startY = e.clientY;
      const baseX = Number(media.dataset.panX || "0");
      const baseY = Number(media.dataset.panY || "0");

      const move = ev => {
        ev.preventDefault();
        const zNow = Number(media.dataset.zoom || "1");
        const c = d2hClampEvidencePan(
          media,
          baseX + (ev.clientX - startX),
          baseY + (ev.clientY - startY),
          zNow
        );
        media.dataset.panX = String(Math.round(c.x));
        media.dataset.panY = String(Math.round(c.y));
        applyEvidenceTransform(media);
      };

      const up = () => {
        media.dataset.panning = "0";
        media.releasePointerCapture?.(e.pointerId);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        applyEvidenceTransform(media);
      };

      window.addEventListener("pointermove", move, { passive:false });
      window.addEventListener("pointerup", up, { once:true });
    }, { passive:false });
  }



  function setZoom(modal, dir){
    const media = modal.querySelector("#evBody img,#evBody video");
    if(!media) return;

    bindEvidencePan(media);

    const cur = Number(media.dataset.zoom || "1");
    const next = clamp(cur + dir, 1, 3);

    if(next <= 1.01){
      media.dataset.panX = "0";
      media.dataset.panY = "0";
    }

    media.dataset.zoom = String(next);
    applyEvidenceTransform(media);
  }

  function d2hRotateEvidence(modal, dir){
    const media = modal?.querySelector("#evBody img,#evBody video");
    if(!media) return;

    bindEvidencePan(media);

    const cur = Number(media.dataset.rotate || "0");
    const base = Number.isFinite(cur) ? Math.round(cur / 90) * 90 : 0;
    const step = Number(dir || 1) < 0 ? -90 : 90;
    const next = base + step;

    media.dataset.rotate = String(next);
    media.dataset.rotated = next !== 0 ? "1" : "0";
    media.dataset.panX = "0";
    media.dataset.panY = "0";
    media.dataset.panning = "0";

    requestAnimationFrame(() => applyEvidenceTransform(media));
  }

  function addEvidenceToolbar(){
    const modal = $("#evModal:not([hidden])");
    if(!modal) return;

    const shell = modal.firstElementChild || modal;
    if(!shell || shell.querySelector(".tc-ev-toolbar")) return;

    shell.classList.add("tc-ev-shell");

    const bar = document.createElement("div");
    bar.className = "tc-ev-toolbar";
    bar.innerHTML = `
      <button type="button" class="tc-ev-btn" data-tc-ev="zoom-out" title="Alejar" aria-label="Alejar">⌕−</button>
      <button type="button" class="tc-ev-btn" data-tc-ev="zoom-in" title="Acercar" aria-label="Acercar">⌕+</button>
      <button type="button" class="tc-ev-btn" data-tc-ev="rotate-ccw" title="Girar a la izquierda" aria-label="Girar a la izquierda">↺</button>
      <button type="button" class="tc-ev-btn" data-tc-ev="rotate-cw" title="Girar a la derecha" aria-label="Girar a la derecha">↻</button>
      <button type="button" class="tc-ev-btn" data-tc-ev="reply" title="Responder" aria-label="Responder">↩</button>
      <button type="button" class="tc-ev-btn" data-tc-ev="download" title="Descargar" aria-label="Descargar">⇩</button>
      <button type="button" class="tc-ev-btn tc-ev-close" data-tc-ev="close" title="Cerrar" aria-label="Cerrar">×</button>
    `;

    shell.prepend(bar);

    bar.addEventListener("click", e => {
      const act = e.target.closest("[data-tc-ev]")?.dataset.tcEv;
      if(!act) return;

      /* D2I-A: close/download/reply/forward/more los maneja D2H en captura.
         Aquí solo queda zoom para evitar doble controlador de evidencia. */
      if(act === "zoom-in") return setZoom(modal, .2);
      if(act === "zoom-out") return setZoom(modal, -.2);
      if(act === "rotate-ccw") return d2hRotateEvidence(modal, -1);
      if(act === "rotate-cw") return d2hRotateEvidence(modal, 1);
    });
  }

  function polish(){
    try{
      const t = $("#logText");
      /* D2I-A: ticket.js gobierna el placeholder del composer. */

      normalizeEnterCopy();
      cleanSoundTestPill();
      markAttachmentCards();
      bindAttachmentCards();
      addEvidenceToolbar();
    }catch(err){
      console.warn("D2E2_POLISH_WARN", err);
    }
  }

  function boot(){
    polish();

    document.addEventListener("tc:ticket-rendered",() => {
      clearTimeout(window.__D2E2_POLISH_TIMER__);
      window.__D2E2_POLISH_TIMER__ = setTimeout(polish, 80);
    });

    const ev = $("#evModal");
    if(ev){
      const evMo = new MutationObserver(() => {
        clearTimeout(window.__D2E2_EV_TIMER__);
        window.__D2E2_EV_TIMER__ = setTimeout(addEvidenceToolbar, 40);
      });
      evMo.observe(ev, { childList:true, subtree:true, attributes:true, attributeFilter:["hidden"] });
    }
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", boot, { once:true });
  }else{
    boot();
  }


  /* TC D2H EVIDENCE TRAY START */
  function d2hToast(text, kind){
    try{
      if(window.toast) return window.toast(text, kind || "ok");
    }catch(e){}
    console.info(text);
  }

  function d2hHideEvidence(){
    const modal = $("#evModal");
    if(!modal) return;
    modal.hidden = true;
    document.body.classList.remove("modal-open");
  }

  async function d2hDownloadEvidence(){
    const a = $("#evOpenRaw");
    const url = a?.getAttribute("href") || "";
    if(!url || url === "#") return d2hToast("No hay enlace de descarga.", "warn");

    const name = clean($("#evTitle")?.dataset.fileName || $("#evTitle")?.textContent || "archivo");

    try{
      const res = await fetch(url, { credentials:"omit" });
      if(!res.ok) throw new Error("download fetch failed");
      const blob = await res.blob();
      const obj = URL.createObjectURL(blob);
      const dl = document.createElement("a");
      dl.href = obj;
      dl.download = name;
      document.body.appendChild(dl);
      dl.click();
      dl.remove();
      setTimeout(()=>URL.revokeObjectURL(obj),1500);
    }catch(err){
      const dl = document.createElement("a");
      dl.href = url;
      dl.download = name;
      dl.target = "_blank";
      dl.rel = "noopener";
      document.body.appendChild(dl);
      dl.click();
      dl.remove();
    }
  }

  function d2hEvidenceCards(){
    return $$(".thread-file-card[data-thread-open]").filter(card=>{
      const idx=Number(card.dataset.threadOpen||-1);
      if(typeof window.__tcEvidenceCanPreview==="function")return window.__tcEvidenceCanPreview(idx);
      return !!card.querySelector("img,video,.thread-file-thumb-img");
    });
  }

  function d2hActiveIndex(){
    const explicit = Number(window.__TC_ACTIVE_EVIDENCE_INDEX__ ?? -1);
    if(Number.isFinite(explicit) && explicit >= 0) return explicit;

    const title = clean($("#evTitle")?.dataset.fileName || $("#evTitle")?.textContent || "");
    const cards = d2hEvidenceCards();
    const match = cards.find(c => clean(c.getAttribute("title") || "") === title);
    return match ? Number(match.dataset.threadOpen || -1) : -1;
  }

  function d2hMetaForActive(){
    const cards = d2hEvidenceCards();
    const active = d2hActiveIndex();
    const card = cards.find(c => Number(c.dataset.threadOpen || -1) === active) || null;
    return card ? closestMessageMeta(card) : (window.__D2E2_ACTIVE_FILE_META__ || {});
  }

  function d2hRefreshEvidenceTraySoon(){
    clearTimeout(window.__TC_D2H_EV_TRAY_TIMER__);
    window.__TC_D2H_EV_TRAY_TIMER__ = setTimeout(d2hRenderEvidenceTray, 90);
  }

  function d2hResetEvidenceMediaSoon(){
    setTimeout(() => {
      const media = document.querySelector("#evBody img,#evBody video");
      if(!media) return;
      media.dataset.zoom = "1";
      media.dataset.panX = "0";
      media.dataset.panY = "0";
      media.dataset.zoomed = "0";
      media.dataset.panning = "0";
      media.dataset.rotate = "0";
      media.dataset.rotated = "0";
      media.style.transform = "none";
    }, 80);
  }

  function d2hShowEvidenceIndex(index){
    d2hResetEvidenceMediaSoon();
    const idx = Number(index);

    if(!Number.isFinite(idx) || idx < 0) return;

    if(typeof window.__tcCoreEvidenceOpen === "function") return window.__tcCoreEvidenceOpen(idx);

    if(typeof window.__tcEvidenceCanPreview === "function" && !window.__tcEvidenceCanPreview(idx)){
      d2hToast("Este adjunto no tiene vista previa disponible.", "warn");
      return;
    }

    window.__TC_ACTIVE_EVIDENCE_INDEX__ = idx;

    if(typeof window.__tcOpenEvidence === "function"){
      Promise.resolve(window.__tcOpenEvidence(idx)).finally(d2hRefreshEvidenceTraySoon);
      return;
    }

    document.querySelector(`.thread-file-card[data-thread-open="${idx}"]`)?.click();
    d2hRefreshEvidenceTraySoon();
  }

  function d2hGoEvidence(delta){
    if(typeof window.__tcCoreEvidenceGo === "function") return window.__tcCoreEvidenceGo(delta);
    const cards = d2hEvidenceCards();
    if(cards.length < 2) return;

    const indexes = cards
      .map(c => Number(c.dataset.threadOpen || -1))
      .filter(n => Number.isFinite(n) && n >= 0);

    const active = d2hActiveIndex();
    const pos = Math.max(0, indexes.indexOf(active));
    const next = indexes[(pos + delta + indexes.length) % indexes.length];
    d2hShowEvidenceIndex(next);
  }

  function d2hPointerStop(e){
    e.preventDefault();
    e.stopPropagation();
    if(typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
  }

  function d2hPointerRun(btn, e, fn){
    const now = Date.now();
    if(Number(btn.__d2hLastPointerRun || 0) && now - Number(btn.__d2hLastPointerRun || 0) < 240){
      d2hPointerStop(e);
      return;
    }
    btn.__d2hLastPointerRun = now;
    d2hPointerStop(e);
    fn();
  }

  function d2hPointerGo(delta){
    const now = Date.now();
    const until = Number(window.__TC_EV_NAV_LOCK__ || 0);
    if(Number.isFinite(until) && until > now) return;
    window.__TC_EV_NAV_LOCK__ = now + 180;

    const buttons = [...document.querySelectorAll(".tc-ev-tray button[data-tc-ev-index]")];
    if(buttons.length < 2) return;

    let pos = buttons.findIndex(b => b.classList.contains("is-active"));

    if(pos < 0){
      const active = Number(d2hActiveIndex());
      pos = buttons.findIndex(b => Number(b.dataset.tcEvIndex) === active);
    }

    if(pos < 0) pos = 0;

    const step = Number(delta || 1) < 0 ? -1 : 1;
    const target = buttons[(pos + step + buttons.length) % buttons.length];
    const index = Number(target?.dataset.tcEvIndex ?? -1);

    if(!Number.isFinite(index) || index < 0) return;

    return d2hPointerOpen(index);
  }

  function d2hPointerOpen(index){
    if(typeof window.__tcCoreEvidenceOpen === "function") return window.__tcCoreEvidenceOpen(index);
    return d2hShowEvidenceIndex(index);
  }

  function d2hBindPointerNav(btn, fn){
    if(!btn || btn.dataset.d2hPointerBound === "1") return;
    btn.dataset.d2hPointerBound = "1";
    btn.dataset.d2hDirectOnly = "1";
    btn.style.pointerEvents = "auto";
    btn.style.touchAction = "manipulation";

    /*
      B14C: handler directo único.
      El listener global ignora botones directOnly para evitar doble navegación.
    */
    btn.addEventListener("click", e => d2hPointerRun(btn, e, fn), true);
  }

  function d2hRenderEvidenceNav(shell){
    if(!shell) return;

    document.querySelectorAll(".tc-ev-nav").forEach(n => n.remove());

    const cards = d2hEvidenceCards();
    if(cards.length < 2) return;

    const prev = document.createElement("button");
    prev.type = "button";
    prev.className = "tc-ev-nav prev";
    prev.dataset.tcEvNav = "-1";
    prev.setAttribute("aria-label", "Adjunto anterior");
    prev.textContent = "‹";

    const next = document.createElement("button");
    next.type = "button";
    next.className = "tc-ev-nav next";
    next.dataset.tcEvNav = "1";
    next.setAttribute("aria-label", "Adjunto siguiente");
    next.textContent = "›";

    d2hBindPointerNav(prev, () => d2hPointerGo(-1));
    d2hBindPointerNav(next, () => d2hPointerGo(1));

    shell.appendChild(prev);
    shell.appendChild(next);
  }



  function d2hRenderEvidenceTray(){
    const modal = document.getElementById("evModal");
    const shell = modal?.querySelector(".tc-ev-shell") || modal?.querySelector(".ticket-ev-modal,.modal") || modal?.firstElementChild;
    if(!modal || modal.hidden || !shell) return;

    d2hRenderEvidenceNav(shell);

    const pairs = d2hEvidenceCards()
      .map((card, fallback) => {
        const idx = Number(card?.dataset?.threadOpen ?? fallback);
        return {card, index: idx};
      })
      .filter(x => Number.isFinite(x.index) && x.index >= 0)
      .filter(x => !window.__tcEvidenceCanPreview || window.__tcEvidenceCanPreview(x.index));

    let tray = shell.querySelector(".tc-ev-tray");

    if(pairs.length < 2){
      tray?.remove();
      return;
    }

    if(!tray){
      tray = document.createElement("div");
      tray.className = "tc-ev-tray";
      shell.appendChild(tray);
    }

    const sig = pairs.map(x => `${x.index}:${x.card?.getAttribute("title") || ""}`).join("|");

    if(tray.dataset.d2hSig !== sig){
      tray.dataset.d2hSig = sig;
      tray.innerHTML = "";

      pairs.forEach(({card, index}) => {
        const b = document.createElement("button");
        b.type = "button";
        b.dataset.tcEvIndex = String(index);
        b.title = card.getAttribute("title") || "Adjunto";

        const media = card.querySelector("img,video,.thread-file-thumb-icon");
        if(media){
          const clone = media.cloneNode(true);
          clone.removeAttribute("data-zoom");
          clone.removeAttribute("data-zoomed");
          clone.removeAttribute("data-panning");
          clone.style.transform = "";
          clone.style.pointerEvents = "none";
          if(clone.tagName === "VIDEO"){
            clone.muted = true;
            clone.playsInline = true;
            clone.removeAttribute("controls");
          }
          b.appendChild(clone);
        }

        d2hBindPointerNav(b, () => d2hPointerOpen(index));
        tray.appendChild(b);
      });
    }

    const active = Number(window.__TC_ACTIVE_EVIDENCE_INDEX__ ?? -1);
    tray.querySelectorAll("button").forEach(btn => {
      btn.classList.toggle("is-active", Number(btn.dataset.tcEvIndex) === active);
    });
  }

  function d2hNavAtPoint(e){
    if(!e || typeof e.clientX !== "number" || typeof e.clientY !== "number") return null;

    const navs = [...document.querySelectorAll(".tc-ev-nav[data-tc-ev-nav]")];
    const pad = 24;

    for(const nav of navs){
      const r = nav.getBoundingClientRect();
      if(!r || r.width <= 0 || r.height <= 0) continue;

      if(
        e.clientX >= r.left - pad &&
        e.clientX <= r.right + pad &&
        e.clientY >= r.top - pad &&
        e.clientY <= r.bottom + pad
      ){
        return nav;
      }
    }

    return null;
  }

  function d2hBindEvidenceControls(){
    if(window.__TC_D2H_EVIDENCE_TRAY__) return;
    window.__TC_D2H_EVIDENCE_TRAY__ = true;

    /*
      B14F: fallback de hitbox por coordenadas.
      Si una capa intercepta el click manual sobre la flecha,
      pointerup en captura detecta el rectángulo real de .tc-ev-nav.
    */
    document.addEventListener("pointerup", e => {
      const nav = d2hNavAtPoint(e) || e.target.closest("[data-tc-ev-nav]");
      if(!nav) return;

      e.preventDefault();
      e.stopImmediatePropagation();
      d2hPointerGo(Number(nav.dataset.tcEvNav || 1));
    }, true);

    document.addEventListener("click", async e => {
      if(e.target.closest("[data-d2h-direct-only='1']")) return;
      const card = e.target.closest(".thread-file-card[data-thread-open]");
      if(card) window.__TC_ACTIVE_EVIDENCE_INDEX__ = Number(card.dataset.threadOpen || -1);

      const nav = e.target.closest("[data-tc-ev-nav]");
      if(nav){
        e.preventDefault();
        e.stopImmediatePropagation();
        d2hGoEvidence(Number(nav.dataset.tcEvNav || 1));
        return;
      }

      const jump = e.target.closest("[data-tc-ev-index]");
      if(jump){
        e.preventDefault();
        e.stopImmediatePropagation();
        d2hShowEvidenceIndex(Number(jump.dataset.tcEvIndex || -1));
        return;
      }

      const close = e.target.closest("#evClose,[data-tc-ev='close']");
      if(close){
        e.preventDefault();
        e.stopImmediatePropagation();
        d2hHideEvidence();
        return;
      }

      const dl = e.target.closest("[data-tc-ev='download']");
      if(dl){
        e.preventDefault();
        e.stopImmediatePropagation();
        await d2hDownloadEvidence();
        return;
      }

      const reply = e.target.closest("[data-tc-ev='reply']");
      if(reply){
        e.preventDefault();
        e.stopImmediatePropagation();
        d2hHideEvidence();
        setTimeout(()=>{
          if(window.__tcJanomeReplyFromActiveEvidence){
            window.__tcJanomeReplyFromActiveEvidence();
          }else{
            const t=$("#logText");
            t?.focus();
            t?.scrollIntoView?.({block:"center",behavior:"smooth"});
          }
        },60);
        return;
      }

    }, true);

    const ev = $("#evModal");
    if(ev){
      const mo = new MutationObserver(()=>{
        clearTimeout(window.__TC_D2H_EV_TRAY_TIMER__);
        window.__TC_D2H_EV_TRAY_TIMER__ = setTimeout(d2hRenderEvidenceTray, 70);
      });
      mo.observe(ev, { childList:true, subtree:true, attributes:true, attributeFilter:["hidden"] });
    }
  }

  d2hBindEvidenceControls();
  /* TC D2H EVIDENCE TRAY END */


  /* B16A_JANOME_CHAT_UX */
  function tcJanomeChatUxEsc(v){
    return String(v ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;", "'":"&#39;" }[c]));
  }

  function tcJanomeChatUxText(v, max=110){
    const s = String(v || "").replace(/\s+/g, " ").trim();
    return s.length > max ? s.slice(0, max - 1) + "…" : s;
  }

  function tcJanomeSupervisionSafeText(v, max=220){
    return tcJanomeChatUxText(String(v || "")
      .replace(/https?:\/\/\S+/gi, "[enlace omitido]")
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, "[referencia omitida]"), max);
  }

  function tcJanomeChatUxToast(text, kind="ok"){
    if(typeof window.toast === "function") return window.toast(text, kind);
    const el = document.createElement("div");
    el.textContent = text;
    /* B17C8G_TOAST_OVER_BLUR: z-index por ENCIMA del overlay de supervision
       (10120) para que el toast nunca quede escondido detras del blur. */
    el.style.cssText = "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:10140;padding:10px 14px;border-radius:999px;background:#111827;color:#fff;font:600 13px system-ui;box-shadow:0 18px 50px rgba(0,0,0,.22)";
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4600);
  }

  function tcJanomeEnsureReplyContext(){
    let box = document.getElementById("tcReplyContext");
    if(box) return box;

    const chat = document.querySelector(".composer-chatbox");
    const input = document.querySelector(".composer-input-wrap");
    if(!chat || !input) return null;

    box = document.createElement("div");
    box.id = "tcReplyContext";
    box.className = "tc-reply-context";
    box.hidden = true;
    box.innerHTML = `
      <div class="tc-reply-context-main">
        <div class="tc-reply-context-k">Respondiendo</div>
        <div class="tc-reply-context-v">—</div>
      </div>
      <button type="button" class="tc-reply-context-x" aria-label="Cancelar respuesta">×</button>
    `;
    chat.insertBefore(box, input);

    box.querySelector(".tc-reply-context-x")?.addEventListener("click", e => {
      e.preventDefault();
      e.stopPropagation();
      tcJanomeClearReplyContext();
    });

    return box;
  }

  /* B17C8F_COMPACT_REPLY_SINGLE_SOURCE: el contexto ahora guarda una sola
     linea "meta" compacta (sender · hora · tipo · tamaño/preview) en vez de
     title/text por separado, para poder mostrar exactamente el mismo texto
     en la barra de arriba del composer y en la burbuja enviada, sin volver a
     ensamblar "Soporte" dos veces en ningun lado. */
  function tcJanomeSetReplyContext(data){
    /* B17C31_REPLY_THUMB_CALLSITE_EXACT:
       El thumb real debe venir desde los callsites. Si llega thumbUrl,
       el contexto visual muestra miniatura y el quote persistido guarda @thumb. */
    const box = tcJanomeEnsureReplyContext();
    if(!box) return;

    let meta = tcJanomeChatUxText(data?.meta || data?.title || "mensaje", 140);
    let preview = tcJanomeChatUxText(data?.preview || "", 160);
    const thumbUrl = String(data?.thumbUrl || data?.url || data?.file?.thumbUrl || data?.file?.url || "").trim();

    const fileLike = !!thumbUrl || /\b(imagen|foto|video|pdf|archivo|adjunto|png|jpe?g|webp|gif|mp4|mov|m4v|webm)\b/i.test(`${meta} ${preview}`);

    meta = meta
      .replace(/^Universal Soporte\s*·\s*/i, "")
      .replace(/^Soporte\s*·\s*/i, "")
      .replace(/^\d{1,2}:\d{2}\s*(?:a\.m\.|p\.m\.)\s*·\s*/i, "")
      .replace(/\s+/g, " ")
      .trim();

    if(fileLike){
      const m = `${meta} ${preview}`.match(/\b(Imagen|Foto|Video|PDF|Archivo)\b/i);
      const s = `${meta} ${preview}`.match(/\b\d+(?:[.,]\d+)?\s*(?:kb|mb|gb|b)\b/i);
      meta = thumbUrl
        ? (m ? m[1] : "Imagen")
        : [m ? m[1] : "Archivo", s ? s[0].toLowerCase().replace(/\s+/g,"") : ""].filter(Boolean).join(" · ");
      preview = "";
    }

    box.hidden = false;
    box.dataset.replyMeta = meta || "mensaje";
    box.dataset.replyPreview = preview;
    box.dataset.replyFileLike = fileLike ? "1" : "0";
    box.dataset.replyThumbUrl = thumbUrl;
    box.querySelector(".tc-reply-context-k").textContent = data?.kind === "admin" ? "Reenviar a admin" : "Respondiendo";

    const v = box.querySelector(".tc-reply-context-v");
    const main = box.querySelector(".tc-reply-context-main") || box;
    box.querySelector(".tc-reply-context-thumb")?.remove();

    if(thumbUrl){
      box.classList.add("has-thumb");
      if(v) v.textContent = "";
      const wrap = document.createElement("div");
      wrap.className = "tc-reply-context-thumb";
      wrap.innerHTML = `<img src="${tcJanomeChatUxEsc(thumbUrl)}" alt="">`;
      main.appendChild(wrap);
    }else{
      box.classList.remove("has-thumb");
      if(v) v.textContent = preview ? `${box.dataset.replyMeta} · ${preview}` : box.dataset.replyMeta;
    }

    const t = document.getElementById("logText");
    t?.focus();
    t?.scrollIntoView?.({block:"center", behavior:"smooth"});
  }





  function tcJanomeClearReplyContext(){
    const box = document.getElementById("tcReplyContext");
    if(!box) return;
    box.hidden = true;
    box.classList.remove("has-thumb");
    box.dataset.replyMeta = "";
    box.dataset.replyPreview = "";
    box.dataset.replyFileLike = "";
    box.dataset.replyThumbUrl = "";
    box.querySelector(".tc-reply-context-thumb")?.remove();
    box.querySelector(".tc-reply-context-v").textContent = "—";
  }



  function tcJanomeFileTypeLabel(card){
    if(!card) return "Archivo";
    if(card.querySelector("video")) return "Video";
    if(card.querySelector("img")) return "Imagen";
    return "Archivo";
  }

  function tcJanomeFileInfo(card){
    if(!card) return {title:"archivo", text:"adjunto", sizeText:"", thumbUrl:"", typeLabel:"Archivo"};
    const name =
      card.querySelector(".thread-file-main b")?.textContent ||
      card.getAttribute("title") ||
      card.querySelector("img")?.getAttribute("alt") ||
      "archivo adjunto";

    const meta =
      card.querySelector(".thread-file-main span")?.textContent ||
      card.dataset.threadOpen ||
      "";

    const rawSize = (String(meta).match(/\b\d+(?:[.,]\d+)?\s*(?:kb|mb|gb|b)\b/i) || [""])[0];
    const sizeText = rawSize ? rawSize.toLowerCase().replace(/\s+/g, "") : "";

    return {
      title: tcJanomeChatUxText(name, 80),
      text: tcJanomeChatUxText(meta ? `adjunto · ${meta}` : "adjunto del hilo", 120),
      sizeText,
      typeLabel: tcJanomeFileTypeLabel(card),
      ref_archivo_id: card.dataset.fileId || null,
      thumbUrl: card.querySelector("img,video")?.currentSrc || card.querySelector("img,video")?.src || "",
      url: card.querySelector("img,video")?.currentSrc || card.querySelector("img,video")?.src || ""
    };
  }

  function tcJanomePrepareAdminNote(text){
    const modeNote = document.getElementById("modeNoteBtn");
    const input = document.getElementById("logText");
    if(modeNote) modeNote.click();
    if(input){
      const current = input.value.trim();
      input.value = current ? `${current}\n\n${text}` : text;
      input.dispatchEvent(new Event("input", {bubbles:true}));
      input.focus();
      input.scrollIntoView?.({block:"center", behavior:"smooth"});
    }
  }

  async function tcJanomeEscalateAdmin(payload, comment){
    const ticketId = new URL(location.href).searchParams.get("id");
    if(!ticketId) throw new Error("No hay ticket_id en la URL.");

    const stage=(name,detail={})=>{try{performance.mark(`admin-${name.toLowerCase()}`);console.info(`ADMIN_STAGE=${name}`,detail)}catch(e){}};
    stage("VALIDATION",{ticket_id:ticketId});

    const kind = String(payload?.kind || "chat").toLowerCase();
    const refEventoId = payload?.ref_evento_id || payload?.preview?.ref_evento_id || payload?.preview?.event_id || null;
    const refArchivoId = payload?.ref_archivo_id || payload?.file?.ref_archivo_id || payload?.file?.archivo_id || null;

    const uuid=v=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v||""));
    const accion=(kind==="file"||kind==="image")&&uuid(refArchivoId)
      ? "file_forwarded_to_admin"
      : ["message","mensaje","note","nota"].includes(kind)&&uuid(refEventoId)
        ? "message_forwarded_to_admin"
        : "chat_forwarded_to_admin";
    const fileLike=payload?.file||payload?.preview||{};
    const content_type=kind==="image"||String(fileLike?.typeLabel||"").toLowerCase()==="imagen"||String(fileLike?.mime_type||"").toLowerCase().startsWith("image/")?"image":accion==="file_forwarded_to_admin"?"file":"text";

    const cleanComment = tcJanomeChatUxText(comment || "", 900);
    let comentario = cleanComment;
    try{
      const quote = tcJanomeQuoteLineFromPayload(payload?.preview || payload?.file || payload || null);
      if(quote){
        comentario = cleanComment
          ? `${quote}\n\nComentario para admin: ${cleanComment}`
          : quote;
      }
    }catch(e){}

    const idempotency_key = `b17c_${accion}_${ticketId}_${Date.now()}_${Math.random().toString(16).slice(2)}`;

    const mod = await import("./supabase.js");
    const client = mod?.supabase;
    if(!client?.functions?.invoke){
      throw new Error("No se pudo cargar el cliente Supabase para enviar a admin.");
    }

    const body = {
      ticket_id: ticketId,
      accion,
      comentario,
      ref_evento_id: refEventoId || null,
      ref_archivo_id: refArchivoId || null,
      content_type,
      idempotency_key
    };

    stage("EDGE_REQUEST",{action:accion,content_type});
    const { data, error } = await client.functions.invoke("ticket-escalar-admin", { body });
    if(error){
      throw new Error(error.message || "No se pudo enviar a supervisión.");
    }
    if(data?.error){
      throw new Error(data.error);
    }
    stage("EVENT_ACK",{evento_id:data?.evento_id||null,idempotency_key});

    return { data, accion, content_type, idempotency_key };
  }

  async function tcJanomeSendAdminNote(payload, comment){
    return tcJanomeEscalateAdmin(payload, comment);
  }

  function tcJanomeEnsureSupervisorModal(){
    let overlay = document.getElementById("tcSupervisorOverlay");
    if(overlay) return overlay;

    overlay = document.createElement("div");
    overlay.id = "tcSupervisorOverlay";
    overlay.className = "tc-supervisor-overlay";
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="tc-supervisor-modal" role="dialog" aria-modal="true" aria-labelledby="tcSupervisorTitle">
        <div class="tc-supervisor-head">
          <div>
            <h3 class="tc-supervisor-title" id="tcSupervisorTitle">Enviar chat a supervisión</h3>
            <p class="tc-supervisor-help" id="tcSupervisorHelp">Puedes agregar un comentario para admin antes de enviar este chat.</p>
          </div>
          <button type="button" class="tc-supervisor-x" aria-label="Cerrar">×</button>
        </div>
        <div class="tc-supervisor-file" id="tcSupervisorFile" hidden>
          <div class="tc-supervisor-thumb" id="tcSupervisorThumb">📎</div>
          <div class="tc-supervisor-file-main">
            <div class="tc-supervisor-file-name" id="tcSupervisorFileName">archivo</div>
            <div class="tc-supervisor-file-size" id="tcSupervisorFileSize"></div>
          </div>
        </div>
        <textarea class="tc-supervisor-text" id="tcSupervisorText" placeholder="Ej. Se requiere apoyo para validar garantía, revisar adjuntos o dar seguimiento al caso."></textarea>
        <div class="tc-supervisor-error" id="tcSupervisorError" hidden></div>
        <div class="tc-supervisor-actions">
          <button type="button" class="btn btn-ghost" id="tcSupervisorCancel">Cancelar</button>
          <button type="button" class="btn btn-brand tc-supervisor-send" id="tcSupervisorSend">Enviar a Administración</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const close = () => tcJanomeCloseSupervisorModal();
    overlay.querySelector(".tc-supervisor-x")?.addEventListener("click", close);
    overlay.querySelector("#tcSupervisorCancel")?.addEventListener("click", close);
    overlay.addEventListener("mousedown", e => {
      if(e.target === overlay) close();
    });
    overlay.querySelector("#tcSupervisorSend")?.addEventListener("click", () => tcJanomeSubmitSupervisorModal());

    if(!window.__TC_B16B_SUPERVISOR_ESC__){
      window.__TC_B16B_SUPERVISOR_ESC__ = true;
      document.addEventListener("keydown", e => {
        if(e.key === "Escape" && !document.getElementById("tcSupervisorOverlay")?.hidden){
          tcJanomeCloseSupervisorModal();
        }
      });
    }

    return overlay;
  }

  function tcJanomeOpenSupervisorModal(payload){
    const errBox0=document.getElementById("tcSupervisorError");
    if(errBox0){errBox0.textContent="";errBox0.hidden=true;}
    const overlay = tcJanomeEnsureSupervisorModal();
    const data = payload || {};
    overlay.__tcPayload = data;

    const title = overlay.querySelector("#tcSupervisorTitle");
    const help = overlay.querySelector("#tcSupervisorHelp");
    const text = overlay.querySelector("#tcSupervisorText");
    const fileBox = overlay.querySelector("#tcSupervisorFile");
    const thumb = overlay.querySelector("#tcSupervisorThumb");
    const fileName = overlay.querySelector("#tcSupervisorFileName");
    const fileSize = overlay.querySelector("#tcSupervisorFileSize");

    title.textContent = data.title || "Enviar chat a supervisión";
    help.textContent = data.help || "Puedes agregar un comentario para admin antes de enviar este chat.";
    text.placeholder = data.placeholder || "Ej. Se requiere apoyo para validar garantía, revisar adjuntos o dar seguimiento al caso.";
    text.value = data.defaultText || "";

    const file = data.file || data.preview || null;
    if(file){
      fileBox.hidden = false;
      fileName.textContent = file.title || "archivo";
      fileSize.textContent = file.sizeText || "";
      thumb.innerHTML = file.thumbUrl ? `<img alt="" src="${tcJanomeChatUxEsc(file.thumbUrl)}">` : tcJanomeChatUxEsc(file.icon || "📎");
    }else{
      fileBox.hidden = true;
      fileName.textContent = "archivo";
      fileSize.textContent = "";
      thumb.textContent = "📎";
    }

    overlay.hidden = false;
    document.body.classList.add("modal-open");
    setTimeout(() => text.focus(), 30);
  }

  function tcJanomeCloseSupervisorModal(){
    const overlay = document.getElementById("tcSupervisorOverlay");
    if(!overlay) return;
    overlay.hidden = true;
    overlay.__tcPayload = null;
    document.body.classList.remove("modal-open");
  }


  function tcJanomeSupervisorHistoryText(payload, comment){
    const kind = String(payload?.kind || "chat");
    const preview = payload?.file || payload?.preview || null;
    const quote = tcJanomeQuoteLineFromPayload(preview);
    const cleanComment = tcJanomeChatUxText(comment || "", 900);

    let body = "Se envió este chat a admin para seguimiento del caso.";
    if(kind === "file") body = "Se reenvió este archivo a admin de forma correcta.";
    if(kind === "message") body = "Se reenvió este mensaje a admin de forma correcta.";

    if(cleanComment){
      body = `${body}\nComentario para admin: ${cleanComment}`;
    }

    return quote ? `${quote}\n\n${body}` : body;
  }

  async function tcJanomeSubmitSupervisorModal(){
    const overlay = document.getElementById("tcSupervisorOverlay");
    if(!overlay) return;

    const payload = overlay.__tcPayload || {};
    const text = (overlay.querySelector("#tcSupervisorText")?.value || "").trim();
    const sendBtn = overlay.querySelector("#tcSupervisorSend");

    if(!text){
      tcJanomeChatUxToast("Agrega un comentario para enviar a supervisión.", "warn");
      overlay.querySelector("#tcSupervisorText")?.focus();
      return;
    }

    if(sendBtn?.disabled) return;

    try{
      if(sendBtn){
        sendBtn.disabled = true;
        sendBtn.dataset.tcOldText = sendBtn.textContent || "";
        sendBtn.textContent = "Enviando a Administración";
        sendBtn.classList.add("is-sending");
        sendBtn.setAttribute("aria-busy","true");
        sendBtn.setAttribute("aria-label","Enviando a Administración…");
      }
      tcJanomeChatUxToast("Enviando a Administración…", "");

      const res = await tcJanomeSendAdminNote(payload, text);

      tcJanomeCloseSupervisorModal();
      tcJanomeChatUxToast("Enviado a Administración", "ok");

      const title=res?.content_type==="image"?"Imagen enviada a supervisión":res?.content_type==="file"?"Archivo enviado a supervisión":"Mensaje enviado a supervisión";
      const persistedText=`${title}.\nComentario para admin: ${text}`;

      window.dispatchEvent(new CustomEvent("tc:admin-escalated", {
        detail: {
          ticket_id: new URL(location.href).searchParams.get("id"),
          accion: res?.accion || null,
          content_type:res?.content_type||"text",
          evento_id:res?.data?.evento_id||null,
          created_at:res?.data?.requiere_supervision_en||new Date().toISOString(),
          persisted_text:persistedText,
          idempotency_key: res?.idempotency_key || null
        }
      }));
      console.info("ADMIN_STAGE=LOCAL_RENDER",{evento_id:res?.data?.evento_id||null});
    }catch(err){
      console.error("TC_ADMIN_ESCALATE_ERROR", err);
      const errMsg=err?.message || "No se pudo enviar a Administración";
      const errBox=overlay.querySelector("#tcSupervisorError");
      if(errBox){errBox.textContent=errMsg;errBox.hidden=false;}
      tcJanomeChatUxToast("No se pudo enviar a Administración", "bad");
      overlay.querySelector("#tcSupervisorText")?.focus();
    }finally{
      if(sendBtn){
        sendBtn.disabled = false;
        sendBtn.classList.remove("is-sending");
        sendBtn.removeAttribute("aria-busy");
        sendBtn.removeAttribute("aria-label");
        sendBtn.textContent = sendBtn.dataset.tcOldText || "Enviar a Administración";
        delete sendBtn.dataset.tcOldText;
      }
    }
  }

  function tcJanomeOpenFileMenu(card, anchor){
    if(!card || !anchor) return;

    let pop = document.getElementById("tcFileActionPop");
    if(!pop){
      pop = document.createElement("div");
      pop.id = "tcFileActionPop";
      pop.className = "tc-file-action-pop";
      pop.hidden = true;
      pop.innerHTML = `
        <button type="button" data-tc-file-act="reply">↩ Responder</button>
        <button type="button" data-tc-file-act="admin">⇧ Reenviar a admin</button>
      `;
      document.body.appendChild(pop);
    }

    const r = anchor.getBoundingClientRect();
    pop.dataset.cardKey = card.dataset.threadOpen || card.getAttribute("title") || "";
    pop.__tcCard = card;
    pop.style.left = Math.min(window.innerWidth - 210, Math.max(8, r.right - 190)) + "px";
    pop.style.top = Math.min(window.innerHeight - 110, Math.max(8, r.bottom + 8)) + "px";
    pop.hidden = false;
  }

  function tcJanomeCloseFileMenu(){
    const pop = document.getElementById("tcFileActionPop");
    if(pop) pop.hidden = true;
  }

  function tcJanomeDecorateFileCards(){
    document.querySelectorAll(".thread-file-card .tc-file-menu-btn").forEach(btn => btn.remove());
  }



  function tcJanomeSyncThreadStampFolio(){
    const stamp = document.getElementById("tkThreadStamp");
    if(!stamp) return;

    const candidates = [
      document.getElementById("tkFolio")?.textContent,
      document.querySelector("[data-ticket-folio]")?.dataset?.ticketFolio,
      document.querySelector("[data-folio]")?.dataset?.folio,
      document.querySelector("[data-ticket]")?.dataset?.ticket,
      document.body?.innerText
    ].filter(Boolean).map(v => String(v));

    let folio = "";
    for(const c of candidates){
      const m = c.match(/\bJAN-[A-Z0-9-]+\b/i);
      if(m){
        folio = m[0].toUpperCase();
        break;
      }
    }

    if(!folio) return;

    const current = String(stamp.textContent || "").trim();
    if(!current || current.startsWith(folio + " ·")) return;

    const base = stamp.dataset.tcBaseStamp || current.replace(/^[A-Z0-9-]+\\s*·\\s*/i, "");
    stamp.dataset.tcBaseStamp = base;
    stamp.textContent = `${folio} · ${base}`;
  }

  /* B17C8F_COMPACT_REPLY_SINGLE_SOURCE
     Causa exacta del bug "Soporte11:46 p. m. Imagen 3 KB" / "Soporte"
     repetido: cuando el mensaje respondido no tenia ".log-text" ni "<p>"
     (o sea, era un mensaje de archivo, renderizado con ".thread-files-grid"),
     esta funcion caia al fallback "msg.textContent" -- que concatena TODO el
     texto del nodo (nombre del autor + hora + nombre de archivo + botones
     "Vista previa/Descargar/Copiar enlace") sin ningun separador, porque el
     HTML de renderLogs() no tiene espacios entre esos tags. Eso pegaba el
     texto y ademas duplicaba "Soporte" (una vez como title, otra dentro del
     blob). Ahora: si el mensaje tiene una tarjeta de archivo, se usa
     tcJanomeFileInfo() (misma fuente que ya usaba la accion "admin"); nunca
     se vuelve a leer msg.textContent completo. */
  function tcJanomeMsgSenderTime(msg){
    const sender = tcJanomeChatUxText(msg?.querySelector(".log-meta b")?.textContent || "Mensaje", 40);
    const time = tcJanomeChatUxText(msg?.querySelector(".log-meta span, .log-meta time")?.textContent || "", 20);
    return {sender, time};
  }

  function tcJanomeMsgInfo(msg){
    if(!msg) return {meta:"mensaje", preview:"", title:"mensaje", text:"sin texto visible",ref_evento_id:null};

    const {sender, time} = tcJanomeMsgSenderTime(msg);
    const fileCard = msg.querySelector(".thread-file-card");

    if(fileCard){
      const file = tcJanomeFileInfo(fileCard);
      const meta = [sender, time, file.typeLabel, file.sizeText].filter(Boolean).join(" · ");
      return {meta, preview:"", title:file.title, text:file.text, sizeText:file.sizeText, thumbUrl:file.thumbUrl, url:file.url,ref_evento_id:msg.dataset.eventId||null};
    }

    const bodyEl = msg.querySelector(".tc-msg-body") || msg.querySelector(".log-text");
    const rawText = bodyEl ? bodyEl.textContent : "";
    const preview = tcJanomeChatUxText(String(rawText || "").replace(/↩|⇧|⌄/g, " ").trim(), 120);
    const meta = [sender, time].filter(Boolean).join(" · ");

    return {meta, preview, title:sender, text:preview,ref_evento_id:msg.dataset.eventId||null};
  }

  function tcJanomeDecorateMessages(){
    document.querySelectorAll(".log-msg").forEach(msg => {
      if(msg.querySelector(".tc-msg-menu-btn")) return;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tc-msg-menu-btn";
      btn.title = "Más acciones del mensaje";
      btn.setAttribute("aria-label", "Más acciones del mensaje");
      btn.textContent = "⌄";
      msg.appendChild(btn);
    });
  }

  function tcJanomeOpenMsgMenu(msg, anchor){
    if(!msg || !anchor) return;

    let pop = document.getElementById("tcMsgActionPop");
    if(!pop){
      pop = document.createElement("div");
      pop.id = "tcMsgActionPop";
      pop.className = "tc-msg-action-pop";
      pop.hidden = true;
      document.body.appendChild(pop);
    }

    pop.innerHTML = `
      <button type="button" data-tc-msg-act="reply"><span>↩</span><b>Responder</b></button>
      <button type="button" data-tc-msg-act="admin"><span>↗</span><b>Reenviar a admin</b></button>
    `;

    const r = anchor.getBoundingClientRect();
    const width = 230;
    const left = Math.min(window.innerWidth - width - 8, Math.max(8, r.right - width));
    const top = Math.max(8, r.bottom + 8);

    pop.__tcMsg = msg;
    pop.style.position = "fixed";
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
    pop.style.width = `${width}px`;
    pop.hidden = false;
    pop.classList.add("is-open");
  }

  function tcJanomeCloseMsgMenu(){
    const pop = document.getElementById("tcMsgActionPop");
    if(pop){
      pop.hidden = true;
      pop.classList.remove("is-open");
    }
  }

  function tcJanomeEnsureAdminEscalateCard(){
    if(document.getElementById("tcAdminEscalateCard")) return;

    const janomeFold = document.getElementById("tkSystemsFold");
    if(!janomeFold) return;

    const card = document.createElement("div");
    card.id = "tcAdminEscalateCard";
    card.className = "tc-admin-escalate-card";
    card.innerHTML = `<button type="button" class="tc-admin-escalate-btn" id="tcAdminEscalateBtn">Enviar chat a admin</button>`;
    janomeFold.insertAdjacentElement("afterend", card);

    let armedUntil = 0;
    const btn = card.querySelector("#tcAdminEscalateBtn");

    btn?.addEventListener("click", e => {
      e.preventDefault();
      const now = Date.now();

      if(now < armedUntil){
        armedUntil = 0;
        btn.classList.remove("is-armed");
        btn.textContent = "Enviando…";

        const folio = document.getElementById("tkFolio")?.textContent?.trim() || "";
        tcJanomeOpenSupervisorModal({
          kind:"chat",
          title:"Enviar chat a supervisión",
          help:"Puedes agregar un comentario para admin antes de enviar este chat.",
          placeholder:"Ej. Se requiere apoyo para validar garantía, revisar adjuntos o dar seguimiento al caso.",
          defaultText:"Envío este chat para seguimiento al caso."
        });
        setTimeout(() => { btn.textContent = "Enviar chat a admin"; }, 600);
        return;
      }

      armedUntil = now + 3500;
      btn.classList.add("is-armed");
      btn.textContent = "Confirmar envío a admin";

      setTimeout(() => {
        if(Date.now() >= armedUntil){
          btn.classList.remove("is-armed");
          btn.textContent = "Enviar chat a admin";
          armedUntil = 0;
        }
      }, 3600);
    });
  }

  window.__tcJanomeReplyFromActiveEvidence = function(){
    const active = Number(window.__TC_ACTIVE_EVIDENCE_INDEX__ ?? -1);
    const card = Number.isFinite(active)
      ? document.querySelector(`.thread-file-card[data-thread-open="${active}"]`)
      : document.querySelector(".thread-file-card[data-thread-open]");
    const info = tcJanomeFileInfo(card);
    const {sender, time} = tcJanomeMsgSenderTime(card?.closest(".log-msg"));
    const meta = [sender, time, info.typeLabel, info.sizeText].filter(Boolean).join(" · ");
    tcJanomeSetReplyContext({kind:"reply", meta, thumbUrl:info.thumbUrl, url:info.url, file:info});
  };


  function tcJanomeFormatBytes(bytes){
    const n = Number(bytes || 0);
    if(!Number.isFinite(n) || n <= 0) return "";
    if(n < 1024) return `${Math.round(n)}b`;
    if(n < 1024 * 1024) return `${Math.round(n / 1024)}kb`;
    return `${Math.round((n / (1024 * 1024)) * 10) / 10}mb`;
  }

  function tcJanomeEnsureSelectedFilesPreview(){
    let box = document.getElementById("tcSelectedFilesPreview");
    if(box) return box;

    const chat = document.querySelector(".composer-chatbox");
    const inputWrap = document.querySelector(".composer-input-wrap");
    const meta = document.getElementById("logFilesMeta");

    box = document.createElement("div");
    box.id = "tcSelectedFilesPreview";
    box.className = "tc-selected-files-preview";

    if(chat && inputWrap){
      chat.insertBefore(box, inputWrap);
    }else if(meta){
      meta.insertAdjacentElement("afterend", box);
    }else{
      document.body.appendChild(box);
    }

    return box;
  }

  function tcJanomeRenderSelectedFiles(){
    const input = document.getElementById("logFiles");
    const box = tcJanomeEnsureSelectedFilesPreview();
    const legacyMeta = document.getElementById("logFilesMeta");

    if(!input || !box) return;

    const files = Array.from(input.files || []);
    if(legacyMeta) legacyMeta.innerHTML = "";

    if(!files.length){
      box.innerHTML = "";
      return;
    }

    box.innerHTML = `<div class="tk-attach-row">${files.map((f, i) => {
      const isImage = String(f.type || "").startsWith("image/");
      const size = tcJanomeFormatBytes(f.size);
      const thumb = isImage ? `<img alt="" src="${URL.createObjectURL(f)}">` : "📎";
      return `
        <div class="tk-attach-chip" data-tc-file-idx="${i}">
          <div class="tk-attach-thumb">${thumb}</div>
          <div class="tk-attach-main">
            <div class="tk-attach-name">${tcJanomeChatUxEsc(f.name || "archivo")}</div>
            <div class="tk-attach-size">${tcJanomeChatUxEsc(size)}</div>
          </div>
          <button type="button" class="tk-attach-del" title="Quitar archivo" aria-label="Quitar archivo">×</button>
        </div>
      `;
    }).join("")}</div>`;
  }

  function tcJanomeRemoveSelectedFile(idx){
    const input = document.getElementById("logFiles");
    if(!input || !input.files) return;

    const dt = new DataTransfer();
    Array.from(input.files).forEach((f, i) => {
      if(i !== idx) dt.items.add(f);
    });
    input.files = dt.files;
    input.dispatchEvent(new Event("change", {bubbles:true}));
    tcJanomeRenderSelectedFiles();
  }


  /* B17C8_REPLY_PERSIST_SYSTEM_FIX: transformacion unica de sistema/supervision.
     Antes habia 2 funciones separadas (rename de autor aqui + tarjeta en
     tcJanomeHumanizeSupervisorNotes) corriendo en pasadas distintas sobre el
     mismo nodo, ademas de selectores ".sys/.me.sys" que renderLogs() nunca
     produce (dead code) y que causaban que CUALQUIER nota interna normal
     quedara etiquetada "Sistema" sin ser en realidad una supervision.
     Ahora: una sola pasada, un solo dataset flag, contenido garantizado
     no-vacio (fallbacks de title/comment) solo para mensajes que realmente
     son de supervision. */
  function tcJanomeDecorateSystemMessages(){
    document.querySelectorAll(".log-msg .log-text").forEach(el => {
      if(el.dataset.tcSystemDecorated === "1") return;

      const msg = el.closest(".log-msg");
      const raw = String(el.textContent || "").replace(/\r\n/g, "\n").trim();
      const data = tcJanomeSupervisorCommentFromText(raw);

      if(data && msg){
        const b = msg.querySelector(".log-meta b");
        if(b) b.textContent = "Sistema";
        msg.classList.add("sys", "tc-msg-supervision");

        /* B17C8F_COMPACT_REPLY_SINGLE_SOURCE: se quita el kicker "SUPERVISIÓN"
           (ruido redundante); el titulo azul/negrita ya comunica que es un
           evento de supervision. */
        /* B17C8G_SUPERVISION_COMPACT: la fila de comentario solo se emite si
           hay comentario real. Sin tarjeta vacia ni "Sin comentario adicional." */
        /* B17C20_SUPERVISION_FORWARD_PREVIEW:
           Mantiene el comentario a admin, pero también muestra la previsualización
           del mensaje/archivo reenviado cuando el texto persistido trae quote "↪". */
        const supComment = tcJanomeSupervisionSafeText(data.comment || "", 220);

        let supForwardMeta = "";
        let supForwardPreview = "";
        /* B17C21R_REPAIR_PARTIAL_QUOTE_CSS: detectar quote aunque no sea el primer caracter del texto persistido. */
        try{
          const rawLines = String(raw || "").replace(/\r\n/g, "\n").trim();
          const qMatch = rawLines.match(/↪\s*([\s\S]*?)(?:\n\s*\nComentario para admin:|\n\s*\n|Comentario para admin:|$)/i);
          const quoteBlock = qMatch ? String(qMatch[1] || "").trim() : "";
          if(quoteBlock){
            const qLines = quoteBlock.split("\n").map(x => x.trim()).filter(Boolean);
            supForwardMeta = tcJanomeSupervisionSafeText(qLines.shift() || "", 140);
            supForwardPreview = tcJanomeSupervisionSafeText(qLines.join(" ") || "", 220);
          }
        }catch(e){}

        const supFileLike = /\b(archivo|adjunto|imagen|foto|video|pdf|png|jpe?g|webp|gif|mp4|mov|m4v|webm)\b/i.test(`${supForwardMeta} ${supForwardPreview}`);
        const supPreviewHtml = (supForwardMeta || supForwardPreview) ? `
          <div class="tc-supervision-forward-preview${supFileLike ? " is-file" : ""}">
            ${supFileLike ? `<div class="tc-supervision-forward-thumb" aria-hidden="true">▣</div>` : ""}
            <div class="tc-supervision-forward-copy">
              ${supForwardMeta ? `<div class="tc-supervision-forward-meta">${tcJanomeChatUxEsc(supForwardMeta)}</div>` : ""}
              ${supForwardPreview ? `<div class="tc-supervision-forward-text">${tcJanomeChatUxEsc(supForwardPreview)}</div>` : ""}
            </div>
          </div>
        ` : "";

        el.innerHTML = `<div class="tc-supervision-card"><div class="tc-supervision-title">${tcJanomeChatUxEsc(data.title || "Mensaje enviado a supervisión")}</div>${supPreviewHtml}${supComment?`<div class="tc-supervision-comment">${tcJanomeChatUxEsc(supComment)}</div>`:""}</div>`;
        el.dataset.tcSupervisorHumanized = "1";
      }

      el.dataset.tcSystemDecorated = "1";
    });
  }

  function tcJanomeEnsureScrollDateBadge(){
    let badge = document.getElementById("tcJanomeScrollDateBadge");
    if(badge) return badge;

    badge = document.createElement("div");
    badge.id = "tcJanomeScrollDateBadge";
    badge.className = "tc-scroll-date-badge";
    badge.textContent = "—";
    document.body.appendChild(badge);
    return badge;
  }

  function tcJanomeShowScrollDateBadge(){
    const badge = tcJanomeEnsureScrollDateBadge();
    const stamp = document.getElementById("tkThreadStamp");
    /* B17C8G_DATE_PILL_SINGLE_SOURCE: la pastilla es SOLO un indicador de
       fecha. Antes copiaba el sello completo (folio · fecha · hora · adjuntos),
       lo que se veia como texto duplicado. Ahora se extrae unicamente el
       segmento de dia ("Hoy" / "Ayer" / "Antier" / "Hace N dias" / "DD/MM"),
       ignorando el folio y el resto; si trae año (DD/MM/AA) se muestra DD/MM. */
    const parts = String(stamp?.textContent || "").split("·").map(s => s.trim()).filter(Boolean);
    let day = parts.find(p => /^(Hoy|Ayer|Antier|Hace\s+\d+\s+d|\d{2}\/\d{2})/i.test(p)) || "Hoy";
    day = day.replace(/^(\d{2}\/\d{2})\/\d{2}$/, "$1");
    badge.textContent = day;
    badge.classList.add("is-show");

    clearTimeout(window.__TC_B16D_SCROLL_BADGE_TIMER__);
    window.__TC_B16D_SCROLL_BADGE_TIMER__ = setTimeout(() => {
      badge.classList.remove("is-show");
    }, 780);
  }

  function tcJanomeBindScrollDateBadge(){
    if(window.__TC_B16D_SCROLL_BADGE_BOUND__) return;
    const log = document.getElementById("log") || document.querySelector(".log-area");
    if(!log) return;

    window.__TC_B16D_SCROLL_BADGE_BOUND__ = true;
    log.addEventListener("scroll", () => tcJanomeShowScrollDateBadge(), {passive:true});
  }


  /* B16E2_QUOTE_MESSAGES_COMPACT */
  /* B17C8F_COMPACT_REPLY_SINGLE_SOURCE: la linea de cita ahora es una sola
     "meta" compacta (ej. "Soporte · 11:46 p. m. · Imagen · 3 KB") en vez de
     title+text separados por " · " -- eso es justo lo que producia el
     formato viejo cuando el title YA venia con sender+hora pegados. */
  function tcJanomeQuoteLineFromPayload(payload){
    if(!payload) return "";
    const meta = tcJanomeChatUxText(payload.meta || payload.title || "mensaje", 140);
    const preview = tcJanomeChatUxText(payload.preview || "", 160);
    const thumbUrl = String(payload.thumbUrl || payload.url || payload.file?.thumbUrl || payload.file?.url || "").trim();
    if(!meta) return "";
    return `↪ ${meta}${thumbUrl ? "\n@thumb " + thumbUrl : ""}${preview ? "\n" + preview : ""}`;
  }



  function tcJanomeQuoteLineFromReplyContext(){
    const box = document.getElementById("tcReplyContext");
    if(!box || box.hidden) return "";

    const meta = tcJanomeChatUxText(box.dataset.replyMeta || "mensaje", 140);
    const preview = tcJanomeChatUxText(box.dataset.replyPreview || "", 160);
    const thumbUrl = String(box.dataset.replyThumbUrl || "").trim();

    if(!meta) return "";
    return `↪ ${meta}${thumbUrl ? "\n@thumb " + thumbUrl : ""}${preview ? "\n" + preview : ""}`;
  }





  function tcJanomeApplyReplyQuoteToComposer(){
    /* B17C8E_SINGLE_SOURCE_LAYOUT: no blind timers.
       Legacy alias now routes to the unified submit helper. */
    return tcJanomeSubmitWithReplyContext();
  }

  function tcJanomeSplitQuoteText(raw){
    const text = String(raw || "").replace(/\r\n/g, "\n").trim();
    if(!text.startsWith("↪ ")) return null;

    const parts = text.split(/\n\s*\n/);
    const quoteBlock = String(parts.shift() || "").replace(/^↪\s*/, "");
    const body = parts.join("\n\n").trim();

    const [metaLine, ...previewLinesRaw] = quoteBlock.split("\n");
    const meta = tcJanomeChatUxText(metaLine || "mensaje", 140);

    let thumbUrl = "";
    const previewLines = [];
    previewLinesRaw.forEach(line => {
      const s = String(line || "").trim();
      const m = s.match(/^@thumb\s+(.+)$/i);
      if(m) thumbUrl = String(m[1] || "").trim();
      else if(s) previewLines.push(s);
    });

    const preview = tcJanomeChatUxText(previewLines.join(" ").trim(), 160);
    return {meta, preview, body, thumbUrl};
  }



  /* B17C8F_COMPACT_REPLY_SINGLE_SOURCE: la burbuja enviada ya no repite
     "Soporte" ni pega texto sin separadores -- una sola linea meta arriba
     (sender · hora · tipo · tamaño/preview), el texto enviado abajo, sin
     tarjeta-dentro-de-tarjeta. */
  function tcJanomeDecorateQuotedMessages(){
    document.querySelectorAll(".log-msg .log-text").forEach(el => {
      if(el.dataset.tcQuoteDecorated === "1") return;

      const data = tcJanomeSplitQuoteText(el.textContent);
      if(!data) return;

      const body = data.body || "";
      const rawMeta = String(data.meta || "mensaje").replace(/\s+/g, " ").trim();
      const rawPreview = String(data.preview || "").replace(/\s+/g, " ").trim();
      const thumbUrl = String(data.thumbUrl || "").trim();

      const quoteFileLike = !!thumbUrl || /\b(imagen|foto|video|pdf|archivo|adjunto|png|jpe?g|webp|gif|mp4|mov|m4v|webm)\b/i.test(`${rawMeta} ${rawPreview}`);

      const cleanMeta = rawMeta
        .replace(/^Universal Soporte\s*·\s*/i, "")
        .replace(/^Soporte\s*·\s*/i, "")
        .replace(/^\d{1,2}:\d{2}\s*(?:a\.m\.|p\.m\.)\s*·\s*/i, "")
        .trim() || "mensaje";

      const fileLabel = (() => {
        const m = `${cleanMeta} ${rawPreview}`.match(/\b(Imagen|Foto|Video|PDF|Archivo)\b/i);
        const s = `${cleanMeta} ${rawPreview}`.match(/\b\d+(?:[.,]\d+)?\s*(?:kb|mb|gb|b)\b/i);
        return [m ? m[1] : "Archivo", s ? s[0].toLowerCase().replace(/\s+/g,"") : ""].filter(Boolean).join(" · ");
      })();

      el.innerHTML = `
        <div class="tc-msg-quote${quoteFileLike ? " is-file" : ""}${thumbUrl ? " has-thumb" : ""}">
          ${thumbUrl ? `<img class="tc-msg-quote-thumb-img" src="${tcJanomeChatUxEsc(thumbUrl)}" alt="">` : ""}
          <div class="tc-msg-quote-copy">
            <div class="tc-msg-quote-meta">${tcJanomeChatUxEsc(quoteFileLike ? fileLabel : cleanMeta)}</div>
            ${(!quoteFileLike && rawPreview) ? `<div class="tc-msg-quote-preview">${tcJanomeChatUxEsc(rawPreview)}</div>` : ""}
          </div>
        </div>
        ${body ? `<div class="tc-msg-body">${tcJanomeChatUxEsc(body)}</div>` : ""}
      `;
      if(!body) el.closest(".log-msg")?.classList.add("tc-msg-quote-only");
      el.dataset.tcQuoteDecorated = "1";
    });
  }



  function tcJanomeEnsureQuoteDecoratorBinding(){
    if(document.documentElement.dataset.tcB17c25QuoteObserver === "1") return;
    document.documentElement.dataset.tcB17c25QuoteObserver = "1";

    let raf = 0;
    const run = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        try{ tcJanomeDecorateQuotedMessages(); }catch(e){}
      });
    };

    document.addEventListener("tc:ticket-rendered",run);
    run();

    setTimeout(run, 80);
    setTimeout(run, 450);
    setTimeout(run, 1200);
  }

  try{ tcJanomeEnsureQuoteDecoratorBinding(); }catch(e){}

  function tcJanomeSupervisorCommentFromText(raw){
    /* B17C27_SYSTEM_IMAGE_REPLY_COMPOSER_CLEANUP:
       Limpia confirmaciones de admin para que no se vea texto técnico/bruto. */
    const txt = String(raw || "").replace(/\r\n/g, "\n").trim();
    if(!/(Se envió este chat a admin|Se reenvió este mensaje a admin|Se reenvió este archivo a admin|Comentario para admin:|supervisi[oó]n)/i.test(txt)) return null;

    let title = "Mensaje enviado a supervisión";
    if(/imagen|foto|image\//i.test(txt)) title = "Imagen enviada a supervisión";
    else if(/archivo|adjunto|video|pdf/i.test(txt)) title = "Archivo enviado a supervisión";

    let comment = "";
    const m = txt.match(/Comentario para admin:\s*([\s\S]*)$/i);
    if(m) comment = m[1].trim();
    else comment = txt;

    comment = comment
      .replace(/^↪\s*[\s\S]*?(?:\n\s*\n|$)/i, "")
      .replace(/^Se envió este chat a admin para seguimiento del caso\.?/i, "")
      .replace(/^Se reenvió este mensaje a admin\.?/i, "")
      .replace(/^Se reenvió este archivo a admin\.?/i, "")
      .replace(/^Comentario para admin:\s*/i, "")
      .replace(/Reenvío este mensaje a supervisión para comentarios\.?/gi, "")
      .replace(/Reenvío este archivo a supervisión para comentarios\.?/gi, "")
      .replace(/\s+/g, " ")
      .trim();

    comment = comment ? tcJanomeChatUxText(comment, 180) : "";
    return {title, comment};
  }



  /* B17C8_REPLY_PERSIST_SYSTEM_FIX: la construccion de la tarjeta de
     supervision se movio a tcJanomeDecorateSystemMessages() para que sea una
     unica transformacion por mensaje (evita el patron "una funcion extrae,
     otra vuelve a renderizar" que dejaba burbujas duplicadas/vacias).
     Se conserva esta funcion sin cuerpo activo por compatibilidad, por si
     algo externo llegara a invocarla. */
  function tcJanomeHumanizeSupervisorNotes(){
    return;
  }

  /* B17C8F_COMPACT_REPLY_SINGLE_SOURCE
     Diagnostico exacto del bug "el quote aparece como texto editable":
     la version anterior (B17C8/B17C8E) escribia "↪ ..." en #logText.value en
     fase de captura y lo dejaba ahi durante TODO el tiempo que saveLog()
     (en ticket.js) tardaba en resolver sus await a Supabase -- el usuario
     veia y podia editar el marcador crudo mientras la respuesta viajaba.
     No hace falta tocar ticket.js para arreglar esto: saveLog() ya lee
     "$('#logText').value" de forma SINCRONA, antes de su primer await
     (confirmado leyendo ticket.js linea ~829). Eso significa que basta con
     que el valor con la cita exista en el instante exacto en que ese
     handler lee el textarea -- no despues.
     Por eso este helper ahora usa DOS listeners en window, sin ningun
     setTimeout/intervalo para decidir cuando revertir:
       - fase de captura (bindQuoteSubmit): inyecta la cita, ANTES de que el
         handler de ticket.js (registrado en el propio #logText/#saveLogBtn,
         fase de burbuja) la lea.
       - fase de burbuja (bindQuoteSubmit, mismo document, sin capture):
         como la burbuja ocurre DESPUES de la fase de destino en el mismo
         despacho sincrono del evento, este listener corre justo despues de
         que saveLog() ya arranco (y ya capturo el valor por variable local),
         asi que puede devolver el textarea a su texto plano de inmediato,
         en el mismo tick -- nunca hay repintado de por medio, el usuario
         jamas ve el marcador "↪ ...". */
  function tcJanomeQuoteLineIsActive(){
    const box = document.getElementById("tcReplyContext");
    return !!(box && !box.hidden);
  }

  /* El contexto solo se limpia si de verdad vimos la señal de exito real de
     ticket.js: #logStatus pasa por "Guardando..." y luego vuelve a "" (asi
     es como resetComposerAfterSave() marca exito). Si en cambio aparece un
     mensaje de error, o si nunca se vio "Guardando...", o si pasan 15s sin
     resolucion, se deja el contexto TAL CUAL (visible) -- ese es el default
     seguro, nunca se limpia a ciegas por el simple paso del tiempo. */
  function tcJanomeWatchReplySubmitOutcome(){
    const status = document.getElementById("logStatus");

    let done = false;
    let sawGuardando = false;

    const finish = success => {
      if(done) return;
      done = true;
      clearInterval(timer);
      if(success) tcJanomeClearReplyContext();
    };

    const startedAt = Date.now();

    const timer = setInterval(() => {
      if(!tcJanomeQuoteLineIsActive()){
        finish(false);
        return;
      }

      const statusText = status ? String(status.textContent || "").trim() : "";
      if(statusText === "Guardando...") sawGuardando = true;

      if(sawGuardando && statusText === ""){
        finish(true);
        return;
      }

      if(sawGuardando && statusText && statusText !== "Guardando..."){
        finish(false);
        return;
      }

      if(Date.now() - startedAt > 15000){
        finish(false);
      }
    }, 120);

  }

  function tcJanomeSubmitWithReplyContext(){
    if(!tcJanomeQuoteLineIsActive()) return;

    const input = document.getElementById("logText");
    if(!input) return;

    const current = String(input.value || "").trim();
    const quote = tcJanomeQuoteLineFromReplyContext();
    if(!quote) return;

    if(current){
      if(current.startsWith("↪ ")) return;
      input.dataset.tcPendingRestore = current;
      input.value = `${quote}\n\n${current}`;
      input.dispatchEvent(new Event("input", {bubbles:true}));
    }else{
      const filesInput = document.getElementById("logFiles");
      const hasFiles = !!(filesInput && filesInput.files && filesInput.files.length);
      if(!hasFiles) return;
      input.dataset.tcPendingRestore = "";
      input.value = quote;
      input.dispatchEvent(new Event("input", {bubbles:true}));
    }

    tcJanomeWatchReplySubmitOutcome();
  }

  /* Corre en fase de burbuja, DESPUES del handler propio de ticket.js
     (target/burbuja) para el mismo click/Enter -- ver comentario arriba.
     Devuelve el textarea a texto plano sin la cita "↪ ..." de forma
     determinista, nunca con un setTimeout adivinando cuanto tardo el envio. */
  function tcJanomeRestoreComposerAfterQuoteInject(){
    const input = document.getElementById("logText");
    if(!input || input.dataset.tcPendingRestore === undefined) return;

    const restore = input.dataset.tcPendingRestore;
    delete input.dataset.tcPendingRestore;

    if(input.value.startsWith("↪ ")){
      input.value = restore;
      input.dispatchEvent(new Event("input", {bubbles:true}));
    }
  }

  /* Alias retrocompatible: el nombre anterior queda apuntando al helper
     unico para no romper referencias externas. */
  function tcJanomeApplyReplyQuoteForSubmit(){
    tcJanomeSubmitWithReplyContext();
  }

  function tcJanomeDecorateMessageQuickActions(){
    /* B17C8_REPLY_PERSIST_SYSTEM_FIX: la limpieza de botones sueltos y el
       relabel del menu ya la hace tcJanomeStabilizeMessageLayout();
    tcJanomeEnsureComposerFileCleanupAfterSend();
    tcJanomeEnsureReplyThumbCaptureFromDom();
    tcJanomeB17C28CompactSupervisionCards(); aqui solo
       se marca la clase para no duplicar la misma pasada de DOM dos veces. */
    document.querySelectorAll(".log-msg").forEach(msg => {
      msg.classList.add("tc-msg-single-menu");
    });
  }

  function tcJanomeBindInlineMsgActions(){
    if(window.__TC_B17C6_INLINE_MSG_ACTIONS_DISABLED__) return;
    window.__TC_B17C6_INLINE_MSG_ACTIONS_DISABLED__ = true;
  }


  function tcJanomeCompactLegacyAdminNotes(){
    document.querySelectorAll(".log-msg .log-text").forEach(el => {
      if(el.dataset.tcLegacyAdminCompacted === "1") return;

      const raw = String(el.textContent || "").replace(/\r\n/g, "\n");
      if(!raw.includes("Comentario para admin:")) return;

      const compact = raw
        .replace(/\n\s*\n\s*Comentario para admin:/gi, "\nComentario para admin:")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

      if(compact && compact !== raw.trim()){
        el.textContent = compact;
      }

      el.dataset.tcLegacyAdminCompacted = "1";
    });
  }

  /* B17C8F_COMPACT_REPLY_SINGLE_SOURCE: Enter y el boton enviar pasan por un
     unico par de listeners (una fuente de verdad para el submit): captura
     (inyecta la cita antes de que ticket.js la lea) + burbuja (la retira del
     textarea justo despues, en el mismo tick, sin timers). */
  function tcJanomeIsSubmitTrigger(e){
    if(e.type === "click") return !!e.target?.closest?.("#saveLogBtn");
    if(e.type === "keydown"){
      return (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ||
        (e.key === "Enter" && !e.shiftKey && e.target?.id === "logText");
    }
    return false;
  }

  function tcJanomeBindQuoteSubmit(){
    if(window.__TC_B16E2_QUOTE_SUBMIT_BOUND__) return;
    window.__TC_B16E2_QUOTE_SUBMIT_BOUND__ = true;

    document.addEventListener("click", e => {
      if(tcJanomeIsSubmitTrigger(e)) tcJanomeSubmitWithReplyContext();
    }, true);

    document.addEventListener("keydown", e => {
      if(tcJanomeIsSubmitTrigger(e)) tcJanomeSubmitWithReplyContext();
    }, true);

    document.addEventListener("click", e => {
      if(tcJanomeIsSubmitTrigger(e)) tcJanomeRestoreComposerAfterQuoteInject();
    }, false);

    document.addEventListener("keydown", e => {
      if(tcJanomeIsSubmitTrigger(e)) tcJanomeRestoreComposerAfterQuoteInject();
    }, false);
  }
  /* /B16E2_QUOTE_MESSAGES_COMPACT */



  function tcJanomeLinkQuoteAttachments(){
    /* B17C26A_FIX_MISSING_LINK_QUOTE_ATTACHMENTS:
       Hotfix defensivo: evita que tcJanomeChatUxInit truene si la función
       fue llamada pero no quedó definida. Mantiene el decorador de quotes activo. */
    try{
      if(typeof tcJanomeDecorateQuotedMessages === "function") tcJanomeDecorateQuotedMessages();
    }catch(e){}
    try{
      if(typeof tcJanomeEnsureQuoteDecoratorBinding === "function") tcJanomeEnsureQuoteDecoratorBinding();
    }catch(e){}
  }


  function tcJanomeStabilizeMessageLayout(){
    /* B17C26B_FIX_MISSING_STABILIZE_MESSAGE_LAYOUT:
       Hotfix defensivo para que tcJanomeChatUxInit no truene.
       Re-ejecuta decoradores visuales existentes tras renders tardíos del hilo. */
    const run = () => {
      try{
        if(typeof tcJanomeDecorateQuotedMessages === "function") tcJanomeDecorateQuotedMessages();
      }catch(e){}
      try{
        if(typeof tcJanomeLinkQuoteAttachments === "function") tcJanomeLinkQuoteAttachments();
      }catch(e){}
      try{
        if(typeof tcJanomeHumanizeSupervisorMessages === "function") tcJanomeHumanizeSupervisorMessages();
      }catch(e){}
      try{
        if(typeof tcJanomeNormalizeSystemMessages === "function") tcJanomeNormalizeSystemMessages();
      }catch(e){}
      try{
        if(typeof tcJanomeEnsureSingleMessageMenu === "function") tcJanomeEnsureSingleMessageMenu();
      try{ tcJanomeB17C28CompactSupervisionCards(); }catch(e){}
      }catch(e){}
    };

    run();
    try{ requestAnimationFrame(run); }catch(e){}
    setTimeout(run, 80);
    setTimeout(run, 350);
    setTimeout(run, 1000);
  }


  function tcJanomeEnsureComposerFileCleanupAfterSend(){
    if(document.documentElement.dataset.tcB17c27ComposerFileCleanup === "1") return;
    document.documentElement.dataset.tcB17c27ComposerFileCleanup = "1";

    let armed = false;
    const hasComposerFiles = () => {
      const input = document.getElementById("logFiles");
      const meta = document.getElementById("logFilesMeta");
      return !!((input?.files?.length || 0) || (meta && meta.textContent.trim()));
    };

    const clearComposerFilesUi = () => {
      const input = document.getElementById("logFiles");
      const meta = document.getElementById("logFilesMeta");
      try{ if(input) input.value = ""; }catch(e){}
      if(meta) meta.innerHTML = "";
      document.querySelectorAll("[data-logfile-del]").forEach(x => x.closest("button, .file-chip, .attachment-chip, .tc-file-chip, li, div")?.remove?.());
      try{
        if(typeof renderLogFilesMeta === "function") renderLogFilesMeta();
      }catch(e){}
    };

    document.addEventListener("click", e => {
      if(e.target.closest("#saveLogBtn") && hasComposerFiles()) armed = true;
    }, true);

    document.addEventListener("keydown", e => {
      if(e.key === "Enter" && hasComposerFiles()){
        const active = document.activeElement;
        if(active && active.id === "logText") armed = true;
      }
    }, true);

    document.addEventListener("tc:ticket-rendered",()=>{if(!armed)return;clearTimeout(window.__tcB17c27FileCleanupTimer);window.__tcB17c27FileCleanupTimer=setTimeout(()=>{clearComposerFilesUi();armed=false},250)});
  }


  function tcJanomeEnsureReplyThumbCaptureFromDom(){
    /* B17C30R_REPLY_THUMB_NO_DUPES:
       Captura miniatura real desde .thread-file-thumb-img y la mete en #tcReplyContext.
       No toca flechas, sistema, cierre ni supervisión. */
    if(document.documentElement.dataset.tcB17c30rReplyThumbCapture === "1") return;
    document.documentElement.dataset.tcB17c30rReplyThumbCapture = "1";

    const clean = x => String(x?.innerText || x?.textContent || "").replace(/\s+/g," ").trim();

    const goodSrc = src => {
      const s = String(src || "").trim();
      if(!s) return "";
      if(/descargar\.png|090-vista|015-papel|\/IMG\//i.test(s)) return "";
      return s;
    };

    const findMediaSrc = msg => {
      if(!msg) return "";
      const candidates = [
        ...msg.querySelectorAll(".thread-file-card--img .thread-file-thumb-img"),
        ...msg.querySelectorAll(".thread-file-thumb-img"),
        ...msg.querySelectorAll("img:not(.tc-msg-quote-thumb-img),video")
      ];
      for(const media of candidates){
        const s = goodSrc(media.currentSrc || media.src || media.poster || media.getAttribute("src") || media.getAttribute("poster"));
        if(s) return s;
      }
      return "";
    };

    const remember = msg => {
      const src = findMediaSrc(msg);
      if(!src) return "";
      window.__tcB17c30rLastMediaReply = {src, ts:Date.now()};
      return src;
    };

    const latestMediaSrc = () => {
      const last = window.__tcB17c30rLastMediaReply || window.__tcB17c29LastMediaReply;
      if(last?.src && Date.now() - last.ts < 60000) return last.src;

      const msgs = [...document.querySelectorAll("#logArea .log-msg")].filter(m => findMediaSrc(m));
      return findMediaSrc(msgs[msgs.length - 1]);
    };

    const applyThumb = () => {
      const box = document.getElementById("tcReplyContext");
      if(!box || box.hidden) return;

      const txt = clean(box);
      const looksImage = /imagen|foto|archivo|\d+\s*(kb|mb|gb)/i.test(`${box.dataset.replyMeta||""} ${box.dataset.replyPreview||""} ${txt}`);
      if(!looksImage) return;

      const src = goodSrc(box.dataset.replyThumbUrl) || latestMediaSrc();
      if(!src) return;

      box.dataset.replyThumbUrl = src;
      box.dataset.replyFileLike = "1";
      box.dataset.replyMeta = "Imagen";
      box.dataset.replyPreview = "";
      box.classList.add("has-thumb");

      const v = box.querySelector(".tc-reply-context-v");
      if(v) v.textContent = "";

      const main = box.querySelector(".tc-reply-context-main") || box;
      let wrap = box.querySelector(".tc-reply-context-thumb");
      if(!wrap){
        wrap = document.createElement("div");
        wrap.className = "tc-reply-context-thumb";
        main.appendChild(wrap);
      }
      wrap.innerHTML = `<img src="${tcJanomeChatUxEsc(src)}" alt="">`;
    };

    document.addEventListener("mouseover", e => {
      const msg = e.target.closest("#logArea .log-msg");
      if(msg && msg.querySelector(".thread-file-thumb-img,img,video")) remember(msg);
    }, true);

    document.addEventListener("pointerdown", e => {
      const msg = e.target.closest("#logArea .log-msg");
      if(msg) remember(msg);
    }, true);

    document.addEventListener("click", e => {
      const msg = e.target.closest("#logArea .log-msg");
      if(msg) remember(msg);

      const action = e.target.closest("[data-tc-file-act='reply'],[data-tc-msg-act='reply'],button,[role='button'],a");
      const label = clean(action || e.target);
      if(/responder|reply/i.test(label)){
        [0,40,100,220,450,800,1300,2000].forEach(ms => setTimeout(applyThumb, ms));
      }
    }, true);

    const box = document.getElementById("tcReplyContext");
    if(box){
      try{
        new MutationObserver(() => {
          [0,50,150,350,700].forEach(ms => setTimeout(applyThumb, ms));
        }).observe(box,{attributes:true,childList:true,subtree:true,characterData:true});
      }catch(e){}
    }

    setInterval(applyThumb, 700);
  }





  function tcJanomeB17C28CompactSupervisionCards(){
    document.querySelectorAll(".log-msg.tc-msg-supervision").forEach(msg => {
      const title = msg.querySelector(".tc-supervision-title");
      if(title && !title.textContent.trim()) title.textContent = "Mensaje enviado a supervisión";
    });
  }

  function tcJanomeChatUxInit(){
    tcJanomeEnsureReplyContext();
    tcJanomeEnsureAdminEscalateCard();
    tcJanomeDecorateFileCards();
    tcJanomeDecorateMessages();
    tcJanomeDecorateSystemMessages();
    tcJanomeDecorateQuotedMessages();
    tcJanomeLinkQuoteAttachments();
    tcJanomeDecorateMessageQuickActions();
    tcJanomeStabilizeMessageLayout();
    tcJanomeBindInlineMsgActions();
    tcJanomeRenderSelectedFiles();
    tcJanomeSyncThreadStampFolio();
    tcJanomeBindScrollDateBadge();
    tcJanomeBindQuoteSubmit();

    if(!window.__TC_B16A_FILE_OBSERVER__){
      window.__TC_B16A_FILE_OBSERVER__ = true;
      document.addEventListener("tc:ticket-rendered",() => {
        clearTimeout(window.__TC_B16A_DECORATE_TIMER__);
        /* B17C8_REPLY_PERSIST_SYSTEM_FIX: tcJanomeCompactLegacyAdminNotes()
           y tcJanomeHumanizeSupervisorNotes() ya no corren aqui -- quedaron
           fusionadas dentro de tcJanomeDecorateSystemMessages() como una
           unica transformacion por mensaje. */
        window.__TC_B16A_DECORATE_TIMER__ = setTimeout(() => { tcJanomeDecorateFileCards(); tcJanomeDecorateMessages(); tcJanomeDecorateSystemMessages(); tcJanomeDecorateQuotedMessages(); tcJanomeLinkQuoteAttachments(); tcJanomeDecorateMessageQuickActions(); tcJanomeStabilizeMessageLayout(); tcJanomeSyncThreadStampFolio(); }, 80);
      });
    }
  }

  document.addEventListener("click", e => {
    const clearReply = e.target.closest(".tc-reply-context-x");
    if(clearReply) return;

    const attachDel = e.target.closest(".tk-attach-del");
    if(attachDel){
      e.preventDefault();
      e.stopPropagation();
      const chip = attachDel.closest("[data-tc-file-idx]");
      tcJanomeRemoveSelectedFile(Number(chip?.dataset?.tcFileIdx || -1));
      return;
    }

    const fileMenuBtn = e.target.closest(".tc-file-menu-btn");
    if(fileMenuBtn){
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      tcJanomeOpenFileMenu(fileMenuBtn.closest(".thread-file-card"), fileMenuBtn);
      return;
    }

    const msgMenuBtn = e.target.closest(".tc-msg-menu-btn");
    if(msgMenuBtn){
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      tcJanomeOpenMsgMenu(msgMenuBtn.closest(".log-msg"), msgMenuBtn);
      return;
    }

    const action = e.target.closest("[data-tc-file-act]");
    if(action){
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      const pop = document.getElementById("tcFileActionPop");
      const card = pop?.__tcCard;
      const info = tcJanomeFileInfo(card);

      if(action.dataset.tcFileAct === "reply"){
        const {sender, time} = tcJanomeMsgSenderTime(card?.closest(".log-msg"));
        const meta = [sender, time, info.typeLabel, info.sizeText].filter(Boolean).join(" · ");
        tcJanomeSetReplyContext({kind:"reply", meta, thumbUrl:info.thumbUrl, url:info.url, file:info});
        tcJanomeCloseFileMenu();
        return;
      }

      if(action.dataset.tcFileAct === "admin"){
        tcJanomeOpenSupervisorModal({
          kind:"file",
          title:"Enviar archivo a supervisión",
          help:"Puedes agregar un comentario para admin antes de enviar este archivo.",
          placeholder:"Ej. Se requiere apoyo para validar garantía, revisar adjuntos o dar seguimiento al caso.",
          defaultText:"Reenvío este archivo a supervisión para comentarios.",
          file:info
        });
        tcJanomeCloseFileMenu();
        return;
      }
    }

    const msgAction = e.target.closest("[data-tc-msg-act]");
    if(msgAction){
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      const pop = document.getElementById("tcMsgActionPop");
      const msg = pop?.__tcMsg;
      const info = tcJanomeMsgInfo(msg);
      const msgFileCard = msg?.querySelector(".thread-file-card");
      const msgFileInfo = msgFileCard ? tcJanomeFileInfo(msgFileCard) : null;

      if(msgAction.dataset.tcMsgAct === "reply"){
        if(msgFileInfo?.thumbUrl || msgFileInfo?.url){
          const {sender, time} = tcJanomeMsgSenderTime(msg);
          const meta = [sender, time, msgFileInfo.typeLabel, msgFileInfo.sizeText].filter(Boolean).join(" · ");
          tcJanomeSetReplyContext({
            kind:"reply",
            meta,
            thumbUrl:msgFileInfo.thumbUrl,
            url:msgFileInfo.url,
            file:msgFileInfo
          });
        }else{
          tcJanomeSetReplyContext({kind:"reply", meta:info.meta, preview:info.preview});
        }
        tcJanomeCloseMsgMenu();
        return;
      }

      if(msgAction.dataset.tcMsgAct === "admin"){
        tcJanomeOpenSupervisorModal({
          kind:"message",
          title:"Enviar mensaje a supervisión",
          help:"Puedes agregar un comentario para admin antes de enviar este mensaje.",
          placeholder:"Ej. Se requiere apoyo para validar garantía, revisar adjuntos o dar seguimiento al caso.",
          defaultText:"Reenvío este mensaje a supervisión para comentarios.",
          ref_evento_id:info.ref_evento_id||null,
          file:msgFileInfo,
          preview:msgFileInfo ? null : {title:info.title || "mensaje", sizeText:info.text || "", icon:"💬"}
        });
        tcJanomeCloseMsgMenu();
        return;
      }
    }

    if(!e.target.closest("#tcFileActionPop")) tcJanomeCloseFileMenu();
    if(!e.target.closest("#tcMsgActionPop")) tcJanomeCloseMsgMenu();
  }, true);

  document.addEventListener("change", e => {
    if(e.target?.id === "logFiles"){
      setTimeout(tcJanomeRenderSelectedFiles, 20);
      setTimeout(tcJanomeRenderSelectedFiles, 140);
      setTimeout(tcJanomeRenderSelectedFiles, 420);
    }
  }, true);

  document.addEventListener("input", e => {
    if(e.target?.id === "logFiles") setTimeout(tcJanomeRenderSelectedFiles, 20);
  }, true);

  document.addEventListener("DOMContentLoaded", () => {
    setTimeout(tcJanomeChatUxInit, 150);
    setTimeout(tcJanomeChatUxInit, 800);
    setTimeout(tcJanomeSyncThreadStampFolio, 1400);
  });

  setTimeout(tcJanomeChatUxInit, 400);
  /* /B16A_JANOME_CHAT_UX */

})();
