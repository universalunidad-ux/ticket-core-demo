/* B19A — formateadores compartidos del módulo interno (clientes/cliente/consolidación/alta).
   Reusa la fuente canónica de estados de global.js; aquí solo lo que global no tiene. */
import{ticketStateLabel,ticketStateCls}from"../global.js";
export const fmtFecha=v=>v?new Date(v).toLocaleDateString("es-MX",{day:"2-digit",month:"short",year:"numeric"}):"—";
export const fmtFechaHora=v=>v?new Date(v).toLocaleString("es-MX",{day:"2-digit",month:"short",hour:"numeric",minute:"2-digit"}):"—";
export const estadoTag=e=>`<span class="tag ${ticketStateCls(e)}">${ticketStateLabel(e)}</span>`;
export const prioTag=p=>{const k=(p||"").toLowerCase();return`<span class="tag ${k==="urgente"?"bad":k==="alta"?"warn":""}">${p||"—"}</span>`};
export const matchTag=n=>{const k=(n||"").toLowerCase();return`<span class="tag ${k==="alto"?"ok":k==="medio"?"warn":k==="bajo"?"bad":""}">${n||"sin candidato"}</span>`};
export const initials=n=>(n||"?").split(/\s+/).slice(0,2).map(x=>x[0]||"").join("").toUpperCase();
