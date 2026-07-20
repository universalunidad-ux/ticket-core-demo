import { mountNav } from "./shared/nav-interna.js?v=frontend-final-20260716-01";
import { createLogView, loadLogSummary } from "./dashboard.js?v=frontend-final-20260716-01";

const init=async()=>{
  const ctx=await mountNav("bitacora-admin");
  if(!ctx)return;
  const role=String(ctx.rol||"").toLowerCase();
  if(!["admin","owner","administrador"].includes(role)){
    document.querySelector("#bitacoraSummary").innerHTML="";
    document.querySelector("#bitacoraView").innerHTML='<div class="empty-state"><b>Acceso reservado para administración.</b><span>La bitácora no amplía los permisos definidos por RLS.</span></div>';
    return;
  }
  await loadLogSummary(document.querySelector("#bitacoraSummary"));
  createLogView(document.querySelector("#bitacoraView"),{pageSize:25});
};
document.addEventListener("DOMContentLoaded",init);
