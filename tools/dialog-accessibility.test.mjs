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
  ticketHtml:read("app/ticket.html")
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

results.forEach(([status,name])=>console.log(`${status}\t${name}`));
if(!process.exitCode)console.log(`DIALOG_ACCESSIBILITY_TESTS=PASS (${results.length}/${results.length})`);
