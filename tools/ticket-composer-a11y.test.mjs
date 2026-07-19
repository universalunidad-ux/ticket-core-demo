import fs from "node:fs";
import assert from "node:assert/strict";

const html = fs.readFileSync("app/ticket.html", "utf8");
const ticketJs = fs.readFileSync("app/ticket.js", "utf8");
const polishJs = fs.readFileSync("app/ticket-composer-polish.js", "utf8");

const tagById = id => {
  const match = html.match(new RegExp(`<[^>]+\\bid=["']${id}["'][^>]*>`, "i"));
  assert.ok(match, `Falta #${id}`);
  return match[0];
};

const hasAttr = (tag, name, value = null) => {
  const pattern = value === null
    ? new RegExp(`\\b${name}(?:\\s*=|\\s|>)`, "i")
    : new RegExp(`\\b${name}=["']${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`, "i");
  return pattern.test(tag);
};

const logFiles = tagById("logFiles");
const logKind = tagById("logKind");
const logState = tagById("logState");
const logStatus = tagById("logStatus");
const logArea = tagById("logArea");

assert.ok(hasAttr(logFiles, "aria-label", "Adjuntar archivos"));
assert.ok(hasAttr(logFiles, "tabindex", "-1"));

assert.ok(hasAttr(logKind, "aria-label", "Tipo de mensaje"));
assert.ok(hasAttr(logKind, "tabindex", "-1"));

assert.ok(hasAttr(logState, "aria-label", "Estado del ticket"));
assert.ok(hasAttr(logState, "tabindex", "-1"));

assert.ok(hasAttr(logStatus, "role", "status"));
assert.ok(hasAttr(logStatus, "aria-live", "polite"));
assert.ok(hasAttr(logStatus, "aria-atomic", "true"));

assert.ok(hasAttr(logArea, "role", "log"));
assert.ok(hasAttr(logArea, "aria-live", "polite"));
assert.ok(hasAttr(logArea, "aria-relevant", "additions text"));
assert.ok(hasAttr(logArea, "aria-atomic", "false"));

for (const id of ["logFiles", "logKind", "logState"]) {
  const occurrences = (html.match(new RegExp(`id=["']${id}["']`, "g")) || []).length;
  assert.equal(occurrences, 1, `ID duplicado: ${id}`);
}

assert.ok(
  ticketJs.includes("logFiles") || polishJs.includes("logFiles"),
  "Se perdió el consumidor del input de archivos"
);

assert.ok(
  ticketJs.includes("logKind"),
  "Se perdió la sincronización de logKind"
);

assert.ok(
  ticketJs.includes("logState"),
  "Se perdió la sincronización de logState"
);

console.log("TICKET_COMPOSER_A11Y_TEST=PASS");
console.log("ANONYMOUS_TAB_STOPS_REMOVED=3");
console.log("LIVE_STATUS_SEMANTICS=PASS");
console.log("LOG_SEMANTICS=PASS");
