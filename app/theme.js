document.addEventListener("click",e=>{
  const b=e.target.closest("[data-theme-toggle]");
  if(!b)return;
  const html=document.documentElement;
  const next=(html.dataset.theme||html.getAttribute("data-theme")||"light")==="dark"?"light":"dark";
  html.dataset.theme=next;
  html.setAttribute("data-theme",next);
  localStorage.setItem("tc_theme",next);
  document.querySelectorAll("[data-theme-label]").forEach(x=>x.textContent=next==="dark"?"Oscuro":"Claro");
});
document.addEventListener("DOMContentLoaded",()=>{
  const t=localStorage.getItem("tc_theme")||"light";
  document.documentElement.dataset.theme=t;
  document.documentElement.setAttribute("data-theme",t);
  document.querySelectorAll("[data-theme-label]").forEach(x=>x.textContent=t==="dark"?"Oscuro":"Claro");
});
