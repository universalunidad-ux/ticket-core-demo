(function(){
  function norm(s){
    return String(s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim();
  }
  function findText(selector, needle){
    return [...document.querySelectorAll(selector)].find(el => norm(el.textContent).includes(needle));
  }
  function polishComposer(){
    const closeBtn = findText("button,a,.btn,.mini", "cerrar caso") || findText("button,a,.btn,.mini", "confirma cierre");
    const visible = findText("button,a,.tag,.pill,span,label,.mini", "visible al cliente");
    if(!closeBtn || !visible) return;

    let row = document.querySelector(".tcComposerActionRow");
    if(!row){
      row = document.createElement("div");
      row.className = "tcComposerActionRow";
      const host = closeBtn.closest(".composer,.reply-composer,#composer,#replyComposer,#tkComposer,.composer-chatbox") || closeBtn.parentElement;
      host?.insertBefore(row, closeBtn);
    }

    if(visible.parentElement !== row) row.appendChild(visible);
    if(closeBtn.parentElement !== row) row.appendChild(closeBtn);
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", polishComposer, {once:true});
  }else{
    polishComposer();
  }

  // Antes: setInterval(polishComposer,1000) perpetuo. Ahora se auto-detiene cuando la
  // fila ya quedó montada (o tras 20 intentos ~20s) para no consumir CPU indefinidamente.
  let _tries = 0;
  const _iv = setInterval(() => {
    polishComposer();
    if (document.querySelector(".tcComposerActionRow") || ++_tries >= 20) clearInterval(_iv);
  }, 1000);
})();
