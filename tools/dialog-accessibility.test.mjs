#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root=join(dirname(fileURLToPath(import.meta.url)),"..");
const read=path=>readFileSync(join(root,path),"utf8");
const files={
  global:read("app/global.js"),
  tickets:read("app/tickets.js"),
  ticket:read("app/ticket.js"),
  assignment:read("app/tickets-assignment.js"),
  polish:read("app/ticket-composer-polish.js"),
  ticketsHtml:read("app/tickets.html"),
  ticketHtml:read("app/ticket.html"),
  ticketCss:read("app/ticket.css")
};
const results=[];
const test=(name,fn)=>{try{fn();results.push(["PASS",name])}catch(error){results.push(["FAIL",name]);console.error(`FAIL\t${name}\n${error.stack||error}`);process.exitCode=1}};
const count=(text,needle)=>text.split(needle).length-1;
const tagById=(html,id)=>html.match(new RegExp(`<[^>]+id=["']${id}["'][^>]*>`))?.[0]||"";
const idsOf=html=>[...html.matchAll(/\bid=["']([^"']+)["']/g)].map(match=>match[1]);

test("01 single shared lifecycle owner",()=>{
  for(const name of ["openDialog","closeDialog","syncDialogStack"])assert.equal(count(files.global,`export const ${name}=`),1);
  assert.equal(count(files.global,'document.addEventListener("keydown",onDialogKeydown,true)'),1);
  assert.match(files.global,/const dialogStack=\[\]/);
});

test("02 fixed overlays expose dialog semantics",()=>{
  const targets=[
    [files.ticketsHtml,"tkModal"],[files.ticketsHtml,"tkClosedModal"],
    [files.ticketHtml,"evModal"],[files.ticketHtml,"tkContactOverlay"],
    [files.ticketHtml,"tkSystemOverlay"],[files.ticketHtml,"tkQrModal"]
  ];
  for(const[html,id]of targets){const tag=tagById(html,id);assert.match(tag,/role="dialog"/);assert.match(tag,/aria-modal="true"/);assert.match(tag,/\bhidden\b/)}
  assert.match(files.tickets,/id="tkQuickPanel" role="dialog" aria-modal="true"/);
  assert.match(files.tickets,/id="tkQrEditor" role="dialog" aria-modal="true"/);
});

test("03 every adopted dialog has an accessible name",()=>{
  for(const[html,id]of [[files.ticketsHtml,"tkModal"],[files.ticketsHtml,"tkClosedModal"],[files.ticketHtml,"evModal"],[files.ticketHtml,"tkContactOverlay"],[files.ticketHtml,"tkSystemOverlay"],[files.ticketHtml,"tkQrModal"]]){
    const tag=tagById(html,id),label=tag.match(/aria-labelledby="([^"]+)"/)?.[1];
    assert.ok(/aria-label="[^"]+"/.test(tag)||label&&new RegExp(`id=["']${label}["']`).test(html),`${id} has no resolvable name`);
  }
  assert.match(files.tickets,/id="tkQuickPanel"[^>]+aria-labelledby="tkQuickTitle"/);
  assert.match(files.tickets,/id="tkQrEditor"[^>]+aria-label="Editor de respuestas rápidas"/);
});

test("04 trigger is stored per dialog instance",()=>{
  assert.match(files.global,/const dialogRecords=new WeakMap\(\)/);
  assert.match(files.global,/record\.trigger=options\.trigger\|\|/);
  assert.match(files.global,/dialogTargetVisible\(preferred\)\?preferred/);
});

test("05 Tab and Shift+Tab use one dynamic topmost trap",()=>{
  assert.match(files.global,/const record=dialogStack\.at\(-1\)/);
  assert.match(files.global,/if\(e\.key==="Tab"\)/);
  assert.match(files.global,/e\.shiftKey\?last:first/);
  assert.match(files.global,/const controls=dialogFocusables\(record\.element\)/);
  assert.match(files.global,/querySelectorAll\(DIALOG_FOCUSABLE\)/);
});

test("06 Escape closes only the topmost dialog and honors specialists",()=>{
  assert.match(files.global,/if\(record\.options\.onEscape\?\.\(e\)===false\)return/);
  assert.match(files.global,/record\.options\.onCloseRequest/);
  assert.doesNotMatch(files.tickets,/tkNewEscBound/);
  assert.doesNotMatch(files.assignment,/tcAssignKeydownBound/);
  assert.match(files.ticket,/onEscape:\(\)=>\{if\(\$\("#tkSysModelPop"\)/);
});

test("07 focus restore is not hardcoded to search",()=>{
  const lifecycle=files.global.slice(files.global.indexOf("const DIALOG_FOCUSABLE"),files.global.indexOf("export const applyTheme"));
  assert.doesNotMatch(lifecycle,/#tkSearch/);
  assert.match(lifecycle,/const preferred=record\.trigger/);
  assert.match(lifecycle,/if\(next\)focusDialogTarget\(next\)/);
});

test("08 background inert never includes the active dialog",()=>{
  assert.match(files.global,/const top=dialogStack\.at\(-1\),allowed=new Set\(\[top\.element/);
  assert.match(files.global,/if\(allowed\.has\(child\)\)return/);
  assert.match(files.global,/allowed\.forEach\(el=>setDialogInert\(el,false\)\)/);
  assert.match(files.global,/restoreDialogInert\(\)/);
});

test("09 generic show and hide remain non-dialog utilities",()=>{
  assert.match(files.global,/export const show=v=>\{[^\n]+classList\.remove\("hidden"\)/);
  assert.match(files.global,/export const hide=v=>\{[^\n]+setAttribute\("hidden","hidden"\)/);
  const generic=files.global.slice(files.global.indexOf("export const show="),files.global.indexOf("export const toggle="));
  assert.doesNotMatch(generic,/role|aria-modal|openDialog/);
});

test("10 no duplicate static IDs",()=>{
  for(const[name,html]of [["tickets.html",files.ticketsHtml],["ticket.html",files.ticketHtml]]){
    const ids=idsOf(html),duplicates=[...new Set(ids.filter((id,index)=>ids.indexOf(id)!==index))];
    assert.deepEqual(duplicates,[],`${name}: ${duplicates.join(", ")}`);
  }
});

test("11 every required callsite adopts the shared owner",()=>{
  for(const id of ["tkModal","tkClosedModal","tkQrEditor"]){assert.match(files.tickets,new RegExp(`(?:openDialog|closeDialog)\\([^\\n]*${id}`),id)}
  assert.match(files.tickets,/const panel=\$\("#tkQuickPanel"\)/);
  assert.match(files.tickets,/openDialog\(panel,\{initialFocus:"#tkQuickText"/);
  for(const id of ["evModal","tkContactOverlay","tkSystemOverlay","tkQrModal"]){assert.match(files.ticket,new RegExp(`(?:openDialog|closeDialog)\\([^\\n]*${id}`),id)}
  assert.match(files.assignment,/openDialog\("#tcViewOverlay"/);
  assert.match(files.assignment,/openDialog\(ov, \{ trigger, initialFocus:"#tcAssignSelect"/);
  assert.match(files.polish,/__tcDialogLifecycle\?\.closeDialog/);
});

test("12 nested quick replies preserve the lower layer",()=>{
  assert.match(files.tickets,/openDialog\("#tkQrEditor"/);
  assert.match(files.tickets,/onCloseRequest:closeQuickEditor/);
  assert.match(files.global,/dialogStack\.slice\(0,-1\)\.forEach\(record=>setDialogInert\(record\.element,true\)\)/);
  assert.match(files.global,/const next=dialogStack\.at\(-1\)\|\|null/);
});

// R16: cobertura estatica de los tres defectos runtime (focusables fantasma, restauracion de foco,
// overlay invisible) mas los invariantes que la correccion no debe romper.
const slice=(text,from,to)=>text.slice(text.indexOf(from),text.indexOf(to));
const visibilityPredicate=()=>slice(files.global,"const dialogTargetVisible=","const dialogFocusables=");
const lifecycleBlock=()=>slice(files.global,"const DIALOG_FOCUSABLE","export const applyTheme");

test("13 focusable filter discards controls under an invisible ancestor",()=>{
  const predicate=visibilityPredicate();
  assert.match(predicate,/typeof el\.checkVisibility==="function"/);
  assert.match(predicate,/checkVisibility\(\{checkVisibilityCSS:true\}\)/);
  assert.match(predicate,/getClientRects\?\.\(\)\.length/);
  assert.doesNotMatch(predicate,/offsetParent/);
});

test("14 focusable filter preserves genuinely rendered controls",()=>{
  const predicate=visibilityPredicate();
  assert.match(predicate,/\.hidden,\[inert\],\[hidden\],\[aria-hidden='true'\]/);
  assert.match(predicate,/style\.display!=="none"&&style\.visibility!=="hidden"/);
  const list=slice(files.global,"const dialogFocusables=","const focusDialogTarget=");
  assert.match(list,/querySelectorAll\(DIALOG_FOCUSABLE\)/);
  assert.match(list,/el\.tabIndex<0/);
  assert.match(list,/\[disabled\],\[aria-disabled='true'\]/);
});

test("15 closed tickets modal restores focus to a persistent anchor",()=>{
  assert.match(files.tickets,/openDialog\(m,\{initialFocus:"#tkClosedQ",fallbackFocus:"#tkMoreFiltersBtn"/);
  assert.match(files.tickets,/closeDialog\("#tkClosedModal",\{fallbackFocus:"#tkMoreFiltersBtn"\}\)/);
  assert.doesNotMatch(files.tickets,/fallbackFocus:"#tkToggleClosed"/);
  const anchor=files.ticketsHtml.indexOf('id="tkMoreFiltersBtn"'),pop=files.ticketsHtml.indexOf('id="tkAdvancedFilters"'),toggle=files.ticketsHtml.indexOf('id="tkToggleClosed"');
  assert.ok(anchor>=0&&pop>=0&&toggle>=0,"missing toolbar ids");
  // El ancla debe preceder al popup que closeTicketFloaters() oculta; #tkToggleClosed queda dentro.
  assert.ok(anchor<pop,"#tkMoreFiltersBtn must live outside #tkAdvancedFilters");
  assert.ok(toggle>pop,"#tkToggleClosed is expected inside #tkAdvancedFilters");
});

test("16 contact overlay derives visibility from the hidden attribute",()=>{
  assert.match(files.ticketCss,/#tkContactOverlay:not\(\[hidden\]\)\{display:flex\}/);
  assert.match(files.ticketCss,/#tkContactOverlay\[hidden\]/);
  assert.equal(count(files.ticketCss,"#tkContactOverlay:not([hidden])"),1);
  // #evModal ya derivaba su estado visible de [hidden]: patron canonico preexistente, no regresionar.
  assert.match(files.ticketCss,/#evModal:not\(\[hidden\]\)/);
  // Los overlays sin regla visible propia siguen sin ella: la correccion no los toca.
  for(const id of ["tkSystemOverlay","tkQrModal"])assert.doesNotMatch(files.ticketCss,new RegExp(`#${id}:not\\(\\[hidden\\]\\)`),id);
  assert.doesNotMatch(files.ticket,/tkContactOverlay"\)\.classList/);
});

test("17 dialog stack stays LIFO",()=>{
  assert.match(files.global,/const existingIndex=dialogStack\.findIndex\(item=>item\.element===element\)/);
  assert.match(files.global,/if\(existingIndex>=0\)dialogStack\.splice\(existingIndex,1\)/);
  assert.match(files.global,/dialogStack\.push\(record\)/);
  assert.match(files.global,/const top=dialogStack\.at\(-1\)/);
  assert.match(files.global,/const next=dialogStack\.at\(-1\)\|\|null/);
});

test("18 inert bookkeeping survives the fix",()=>{
  assert.match(files.global,/const dialogInertState=new Map\(\)/);
  assert.match(files.global,/const rememberInert=el=>/);
  assert.match(files.global,/el\.toggleAttribute\("inert",!!on\)/);
  assert.match(files.global,/const restoreDialogInert=\(\)=>/);
  assert.match(files.global,/dialogInertState\.clear\(\)/);
});

test("19 Escape still closes only the topmost dialog",()=>{
  const handler=slice(files.global,"const onDialogKeydown=","const ensureDialogOwner=");
  assert.match(handler,/const record=dialogStack\.at\(-1\)/);
  assert.match(handler,/if\(e\.key!=="Escape"\)return/);
  assert.match(handler,/e\.stopImmediatePropagation\(\)/);
  assert.match(handler,/record\.options\.onCloseRequest\|\|\(\(\)=>closeDialog\(record\.element\)\)/);
});

test("20 no global fallback to the search box",()=>{
  assert.doesNotMatch(lifecycleBlock(),/#tkSearch/);
  assert.doesNotMatch(files.tickets,/fallbackFocus:"#tkSearch"/);
  assert.doesNotMatch(files.ticket,/fallbackFocus:"#tkSearch"/);
});

results.forEach(([status,name])=>console.log(`${status}\t${name}`));
if(!process.exitCode)console.log(`DIALOG_ACCESSIBILITY_TESTS=PASS (${results.length}/${results.length})`);
