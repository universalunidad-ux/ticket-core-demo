/* B19A — estado de filtros/búsqueda en la URL (consumido por clientes.js y consolidacion-clientes.js). */
export const readQS=(defaults={})=>{const p=new URLSearchParams(location.search),out={...defaults};Object.keys(defaults).forEach(k=>{const v=p.get(k);if(v!==null&&v!=="")out[k]=v});return out};
export const writeQS=state=>{const p=new URLSearchParams();Object.entries(state).forEach(([k,v])=>{if(v!==""&&v!=null)p.set(k,String(v))});const qs=p.toString();history.replaceState(null,"",qs?`${location.pathname}?${qs}`:location.pathname)};
