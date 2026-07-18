#!/usr/bin/env node
import fs from "node:fs";
import vm from "node:vm";

const html=fs.readFileSync("app/estado.html","utf8");
const js=fs.readFileSync("app/estado.js","utf8");
const css=fs.readFileSync("app/estado.css","utf8");
const failures=[];
let passed=0;
const test=(name,fn)=>{try{fn();passed++;console.log(`PASS ${name}`)}catch(error){failures.push(`${name}: ${error.message}`);console.error(`FAIL ${name}: ${error.message}`)}};
const assert=(condition,message)=>{if(!condition)throw new Error(message)};

const functionSource=name=>{
  const match=js.match(new RegExp(`const ${name}=.*?;(?=\\n)`));
  assert(match,`no se encontró ${name}`);
  return match[0].replace(`const ${name}=`,`globalThis.${name}=`);
};
const elements=new Map([
  ["#stHeroStatus",{textContent:"",className:"estado-status-pill",classList:null}],
  ["#stNextStep",{textContent:"",classList:null}],
  ["#stNextStepBox",{textContent:"",classes:new Set(["estado-next","hidden"]),classList:null}]
]);
for(const element of elements.values())element.classList={add:value=>element.classes?.add(value),remove:value=>element.classes?.delete(value),contains:value=>element.classes?.has(value)};
const context={
  $:selector=>elements.get(selector)||null,
  setTxt:(id,value)=>{const element=elements.get(`#${id}`);if(element)element.textContent=value??"—"},
  sl:state=>state==="en_proceso"?"En revisión":"Recibido",
  ticketStateCls:state=>state==="en_proceso"?"info":"ok"
};
vm.createContext(context);
vm.runInContext(["setPublicStatusError","clearPublicStatusError","setHero"].map(functionSource).join("\n"),context);
const reset=()=>{elements.get("#stHeroStatus").textContent="";elements.get("#stHeroStatus").className="estado-status-pill";elements.get("#stNextStep").textContent="";elements.get("#stNextStepBox").classes=new Set(["estado-next","hidden"])};

test("CASE 1 missing folio/token uses visible warning owner",()=>{
  reset();context.setPublicStatusError("Enlace incompleto","Faltan folio o token.");
  assert(elements.get("#stHeroStatus").textContent==="Enlace incompleto","estado incorrecto");
  assert(elements.get("#stHeroStatus").className==="estado-status-pill warn","falta warn");
  assert(elements.get("#stNextStep").textContent==="Faltan folio o token.","mensaje incorrecto");
  assert(!elements.get("#stNextStepBox").classes.has("hidden"),"mensaje oculto");
});

test("CASE 2 fixture/load error uses visible warning owner",()=>{
  reset();context.setPublicStatusError("No disponible","No fue posible consultar el seguimiento.");
  assert(elements.get("#stHeroStatus").textContent==="No disponible","estado incorrecto");
  assert(elements.get("#stHeroStatus").className.endsWith(" warn"),"falta warn");
  assert(!elements.get("#stNextStepBox").classes.has("hidden"),"mensaje oculto");
});

test("CASE 3 all three load failures use the centralized owner",()=>{
  const calls=(js.match(/setPublicStatusError\(/g)||[]).length;
  assert(calls===3,`se esperaban 3 rutas y hay ${calls}`);
  assert(/STATUS_FIXTURE_MODE==="error"\)\{setPublicStatusError\("No disponible"/.test(js),"fixture error no usa el owner");
  assert(/if\(!folio\|\|!token\)\{setPublicStatusError\("Enlace incompleto"/.test(js),"folio/token faltante no usa el owner");
  assert(/catch\(ex\)\{[^}]*setPublicStatusError\("No disponible"/.test(js),"fallo fetch no usa el owner");
  assert(!/setTxt\("stHeroStatus","(?:No disponible|Enlace incompleto)"\)/.test(js),"queda una escritura de error directa");
});

test("CASE 4 error to success clears stale warning and message",()=>{
  reset();context.setPublicStatusError("No disponible","Fallo temporal");context.setHero({estado:"en_proceso"});
  assert(elements.get("#stHeroStatus").textContent==="En revisión","estado normal no restaurado");
  assert(elements.get("#stHeroStatus").className==="estado-status-pill info","clase normal no restaurada");
  assert(elements.get("#stNextStep").textContent==="","mensaje stale no limpiado");
  assert(elements.get("#stNextStepBox").classes.has("hidden"),"mensaje stale visible");
  assert(js.includes("if(unchanged)setHero(j.ticket);else renderLoadedTicket(j.ticket)"),"recovery de ticket sin cambios no cubierto");
});

test("CASE 5 semantic nodes and CSS owners are unique",()=>{
  for(const id of ["stNextStepBox","stNextStep"])assert((html.match(new RegExp(`id="${id}"`,"g"))||[]).length===1,`${id} no es único`);
  assert(/id="stNextStepBox"[^>]*role="status"[^>]*aria-live="polite"/.test(html),"falta semántica live/status");
  assert((css.match(/\.estado-status-pill\.warn\{/g)||[]).length===1,"owner warn duplicado");
  assert((css.match(/(?:^|\n)\.estado-next\{/g)||[]).length===1,"owner estado-next duplicado");
});

console.log(`TARGETED_TESTS_TOTAL=${passed+failures.length}`);
console.log(`TARGETED_TESTS_PASS=${passed}`);
console.log(`TARGETED_TESTS_FAIL=${failures.length}`);
if(failures.length)process.exit(1);
