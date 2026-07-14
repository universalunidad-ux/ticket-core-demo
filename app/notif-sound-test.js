(function(){
  function beep(){
    try{
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      const vol = Number(document.querySelector('input[type="range"]')?.value || 70) / 100;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.value = Math.max(.03, Math.min(.35, vol * .25));
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      setTimeout(()=>{ osc.stop(); ctx.close(); }, 180);
    }catch(e){
      console.warn("No se pudo reproducir sonido de prueba");
    }
  }

  function mount(){
    const candidates = [...document.querySelectorAll(
      '#tkThreadGearMenu,.thread-gear-menu,.notif-menu,.notifications-menu,[id*="GearMenu"],[class*="gear"],[class*="notif"]'
    )].filter(el => {
      const t = (el.innerText || "").toLowerCase();
      return t.includes("sonido") || t.includes("volumen") || t.includes("notificaciones") || t.includes("alertas");
    });

    for(const menu of candidates){
      if(menu.querySelector(".tcSoundTestBtn")) continue;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tcSoundTestBtn";
      btn.innerHTML = '<span aria-hidden="true">🔊</span><span>Probar sonido</span>';
      btn.addEventListener("click", e => {
        e.preventDefault();
        e.stopPropagation();
        beep();
      });

      const volume = [...menu.querySelectorAll("input[type='range'],select")].pop();
      if(volume?.parentElement) volume.parentElement.insertAdjacentElement("afterend", btn);
      else menu.appendChild(btn);
    }
  }

  document.addEventListener("click", () => setTimeout(mount, 80), true);
  document.addEventListener("DOMContentLoaded", mount, {once:true});
  // Antes: setInterval(mount,1200) perpetuo. Ahora se auto-detiene al montar el botón
  // (o tras 25 intentos ~30s); los clics siguen re-montando bajo demanda.
  let _tries = 0;
  const _iv = setInterval(() => {
    mount();
    if (document.querySelector(".tcSoundTestBtn") || ++_tries >= 25) clearInterval(_iv);
  }, 1200);
})();
