/* UI-REFINE 20260715 — presentación pública ÚNICA de "Categoría singular · modelo".
   Solo transforma la PRESENTACIÓN pública; nunca altera el dato original en Supabase.
   Sirve para máquinas, accesorios, categorías en plural, vacías o ya en singular.
   Nunca produce undefined/null/[object Object], paréntesis vacíos ni doble separador. */
const SINGULAR={
  "mecanicas":"Mecánica","mecánicas":"Mecánica",
  "collareteras":"Collaretera",
  "overlock":"Overlock","overlocks":"Overlock",
  "computarizadas":"Computarizada",
  "bordadoras":"Bordadora","bordadoras con costura":"Bordadora con costura",
  "descontinuadas":"Descontinuada",
  "accesorios":"Accesorio","accesorio":"Accesorio"
};
const norm=s=>String(s==null?"":s).trim();
export const singularCategoria=raw=>{
  const r=norm(raw);
  if(!r)return"";
  if(/^accesorios?\b/i.test(r))return"Accesorio";
  let g=r;
  const m=g.match(/^\s*M[aá]quinas\s*[—-]\s*(.+)$/i);
  if(m)g=m[1].trim();
  const key=g.toLowerCase();
  if(SINGULAR[key])return SINGULAR[key];
  return g?g[0].toUpperCase()+g.slice(1):"";
};
export const formatProductoPublic=raw=>{
  const s=norm(raw);
  if(!s||/^Producto Janome no especificado$/i.test(s))return"No especificado";
  let cat="",model=s;
  const pm=s.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  if(pm){model=pm[1];cat=singularCategoria(pm[2]);}
  model=norm(model).replace(/^Janome(?:\s+|$)/i,"").replace(/^Otro:\s*/i,"").trim();
  if(!model&&!cat)return"No especificado";
  if(cat&&model)return `${cat} · ${model}`;
  return model||cat||"No especificado";
};
