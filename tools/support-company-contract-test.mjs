import assert from "node:assert/strict";
import fs from "node:fs";

const sanitize=(v,max=3000)=>String(v??"").trim().replace(/\s+/g," ").slice(0,max);
const normalize=payload=>({
  nombre:sanitize(payload?.nombre,120),
  empresa:sanitize(payload?.empresa,160)||null,
  titulo:sanitize(payload?.titulo,120),
  descripcion:sanitize(payload?.descripcion,3000),
  sistema:sanitize(payload?.sistema,120)
});
const missing=p=>!p.nombre||!p.titulo||!p.descripcion||!p.sistema;

const withCompany=normalize({nombre:"Ana",empresa:"  Taller Norte  ",titulo:"La máquina no enciende",descripcion:"Detalle suficiente para una solicitud local.",sistema:"Janome 3008"});
assert.equal(withCompany.empresa,"Taller Norte");
assert.equal(missing(withCompany),false);

const withoutCompany=normalize({nombre:"Ana",empresa:"   ",titulo:"La máquina no enciende",descripcion:"Detalle suficiente para una solicitud local.",sistema:"Janome 3008"});
assert.equal(withoutCompany.empresa,null);
assert.equal(missing(withoutCompany),false);

const withoutRequired=normalize({nombre:"Ana",empresa:null,titulo:"",descripcion:"Detalle suficiente para una solicitud local.",sistema:"Janome 3008"});
assert.equal(missing(withoutRequired),true);

const edge=fs.readFileSync(new URL("../supabase/functions/support-submit-secure/index.ts",import.meta.url),"utf8");
assert.match(edge,/empresa=sanitize\(payload\?\.empresa,160\)\|\|null/);
assert.doesNotMatch(edge,/if\(!nombre\|\|!empresa\|\|/);
assert.match(edge,/matchCliente\(empresa\|\|"",correo,telefono\)/);
assert.match(edge,/empresa:empresa\|\|null/);

console.log("SUPPORT_COMPANY_CONTRACT_TEST: PASS (with company + without company + required-field control)");
