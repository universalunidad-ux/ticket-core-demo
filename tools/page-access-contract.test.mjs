#!/usr/bin/env node
/*
 * TC-PAGE-ROLE-ACCESS-CONTRACT-01
 * Contrato ejecutable de navegacion y autorizacion por pagina.
 *
 * Convierte la matriz pagina/rol en invariantes verificables contra la fuente
 * real (app/*.html, app/*.js). NO edita interfaces; solo lee y valida.
 *
 * Ejecutable standalone:
 *   node tools/page-access-contract.test.mjs [ROOT]
 *
 * Falla (exit 1) si:
 *   - una pagina interna no monta guard autenticado (INTERNAL_NO_GUARD)
 *   - una pagina admin carece de comprobacion de rol (ADMIN_NO_ROLE_CHECK)
 *   - una pagina publica intenta exigir sesion (PUBLIC_REQUIRES_SESSION)
 *   - una pagina interna se enlaza desde nav para un rol no permitido
 *     (NAV_ROLE_NOT_ALLOWED / UNDECLARED_NAV_LINK / PUBLIC_PAGE_IN_INTERNAL_NAV)
 *   - falta entry JS declarado (ENTRY_JS_MISSING / ENTRY_JS_FILE_MISSING)
 *   - data-page y nav key divergen del real (DATA_PAGE_NAVKEY_DIVERGENCE)
 *   - existe una ruta huerfana (ORPHAN_ROUTE_UNDECLARED)
 *   - una pagina privilegiada permite render funcional antes del guard
 *     (RENDER_BEFORE_GUARD / ADMIN_UNGUARDED_MUTATION)
 *   - seguimiento se marca implementado sin existir (SEGUIMIENTO_FALSE_IMPLEMENTED)
 *   - alta-cliente deja de ser interna (ALTA_NOT_INTERNAL)
 *   - legal deja de ser publica (LEGAL_NOT_PUBLIC)
 *   - soporte/estado dejan de ser publicas (PUBLIC_SUPPORT_STATE_CHANGED)
 *
 * Incluye corpus de mutaciones negativas no tautologico: cada mutante altera la
 * fuente o el contrato y exige que el MISMO validador lo rechace con un codigo
 * especifico.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(process.argv[2] || ".");
const APP = join(ROOT, "app");

/* ----------------------------- lectura de fuente ----------------------------- */

const readOrNull = (p) => (existsSync(p) ? readFileSync(p, "utf8") : null);

const parseBody = (raw) => {
  const m = raw.match(/<body([^>]*)>/i);
  const attrs = m ? m[1] : "";
  const surface = (attrs.match(/data-surface="([^"]+)"/) || [])[1] || null;
  const dataPage = (attrs.match(/data-page="([^"]+)"/) || [])[1] || null;
  return { surface, dataPage };
};

const parseScripts = (raw) => {
  const out = [];
  const re = /<script[^>]*\ssrc="([^"]+)"/gi;
  let m;
  while ((m = re.exec(raw))) {
    const base = m[1].split("?")[0].split("/").pop();
    if (base) out.push(base);
  }
  return out;
};

const resolveHref = (h) => String(h || "").split("#")[0].split("?")[0].split("/").pop();

const parseAppMenu = (src) => {
  const block = (src.match(/const APP_MENU=\{([\s\S]*?)\};/) || [])[1] || "";
  const roleBlock = (role) => (block.match(new RegExp(`${role}:\\s*\\[([\\s\\S]*?)\\]`)) || [])[1] || "";
  const items = (text) => {
    const out = [];
    const re = /\{[^{}]*\}/g;
    let m;
    while ((m = re.exec(text))) {
      const obj = m[0];
      const key = (obj.match(/key:"([^"]+)"/) || [])[1];
      const href = (obj.match(/href:"([^"]+)"/) || [])[1] || null;
      if (key) out.push({ key, href });
    }
    return out;
  };
  return { soporte: items(roleBlock("soporte")), admin: items(roleBlock("admin")) };
};

const parseInternalRoutes = (src) => {
  const block = (src.match(/INTERNAL_ROUTES\s*=\s*new Set\(\[([\s\S]*?)\]\)/) || [])[1] || "";
  const out = new Set();
  const re = /"([^"]+\.html)"/g;
  let m;
  while ((m = re.exec(block))) out.add(m[1]);
  return out;
};

const collectEvidence = (contract) => {
  const files = readdirSync(APP).filter((f) => f.endsWith(".html"));
  const html = {};
  for (const f of files) {
    const raw = readFileSync(join(APP, f), "utf8");
    html[f] = { ...parseBody(raw), scripts: parseScripts(raw), raw };
  }
  const jsNeeded = new Set(contract.loadJs || []);
  for (const p of contract.pages) {
    (p.entry || []).forEach((e) => jsNeeded.add(e));
    (p.reachedBy || []).forEach((r) => r.file && jsNeeded.add(r.file));
  }
  const js = {};
  for (const rel of jsNeeded) js[rel] = readOrNull(join(APP, rel));
  return {
    files: new Set(files),
    html,
    js,
    internalRoutes: parseInternalRoutes(js["index.js"] || ""),
    appMenu: parseAppMenu(js["global.js"] || ""),
  };
};

/* --------------------------------- validador -------------------------------- */

const GUARD_CALL_TOKENS = ["mountNav(", "guardSession(", "tkSessionToken("];
const MUTATION_TOKENS = [".insert(", ".update(", ".delete(", ".upsert(", "functions.invoke("];

function validate(contract, ev) {
  const V = [];
  const add = (code, path, detail) => V.push({ code, path, detail });
  const pageByHtml = Object.fromEntries(contract.pages.map((p) => [p.html, p]));
  const internal = new Set(contract.internalClasses);
  const publik = new Set(contract.publicClasses);
  const entrySrc = (p) => (p.entry || []).map((e) => ev.js[e] || "").join("\n");
  const seg = contract.pending.seguimiento;

  /* cobertura / huerfanas */
  for (const f of ev.files) {
    if (f === seg.html) { add("SEGUIMIENTO_FALSE_IMPLEMENTED", "app/" + f, "archivo seguimiento presente"); continue; }
    if (!pageByHtml[f]) add("ORPHAN_ROUTE_UNDECLARED", "app/" + f, "html no declarado en el contrato");
  }
  for (const p of contract.pages) {
    if (!ev.files.has(p.html)) add("DECLARED_PAGE_MISSING_FILE", p.path, "declarado sin archivo real");
  }

  /* seguimiento pendiente */
  if (seg.status !== "F17_W2_PENDING_NOT_PRESENT") add("SEGUIMIENTO_FALSE_IMPLEMENTED", seg.path, `status=${seg.status}`);
  if (contract.pages.some((p) => p.html === seg.html)) add("SEGUIMIENTO_FALSE_IMPLEMENTED", seg.path, "declarado como pagina activa");

  for (const p of contract.pages) {
    const h = ev.html[p.html];
    const src = entrySrc(p);
    const isInternal = internal.has(p.class);
    const isPublic = publik.has(p.class);

    if (h) {
      if (h.surface !== p.surface) add("SURFACE_DIVERGENCE", p.path, `real=${h.surface} esperado=${p.surface}`);
      if (p.dataPage && h.dataPage !== p.dataPage) add("DATA_PAGE_NAVKEY_DIVERGENCE", p.path, `data-page real=${h.dataPage} esperado=${p.dataPage}`);
      if (!p.dataPage && h.dataPage) add("DATA_PAGE_UNEXPECTED", p.path, `data-page real=${h.dataPage} no esperado`);
      for (const e of p.entry || []) {
        if (ev.js[e] === null || ev.js[e] === undefined) add("ENTRY_JS_FILE_MISSING", p.path, e);
        if (!h.scripts.includes(e)) add("ENTRY_JS_MISSING", p.path, `entry ${e} no referenciado en html`);
      }
    }

    /* guard */
    if (isInternal) {
      const g = p.guard || {};
      for (const tok of g.evidence || []) {
        if (!src.includes(tok)) add("INTERNAL_NO_GUARD", p.path, `falta evidencia de guard: ${tok}`);
      }
      if (g.earlyReturn && !(new RegExp(g.earlyReturn).test(src))) {
        add("RENDER_BEFORE_GUARD", p.path, "guard sin early-return: render funcional posible antes del guard");
      }
    }
    if (isPublic) {
      for (const tok of GUARD_CALL_TOKENS) {
        if (src.includes(tok)) add("PUBLIC_REQUIRES_SESSION", p.path, `pagina publica invoca guard: ${tok}`);
      }
    }

    /* rol admin */
    if (p.class === "ADMIN_ONLY") {
      const gate = p.roles && p.roles.gate;
      if (!gate || !(gate.evidence || []).length) {
        add("ADMIN_NO_ROLE_CHECK", p.path, "admin sin gate de rol declarado");
      } else {
        for (const tok of gate.evidence) {
          if (!src.includes(tok)) add("ADMIN_NO_ROLE_CHECK", p.path, `falta comprobacion de rol: ${tok}`);
        }
      }
    }

    /* mutaciones privilegiadas en paginas sin escritura */
    if (p.noMutations) {
      for (const tok of MUTATION_TOKENS) {
        if (src.includes(tok)) add("ADMIN_UNGUARDED_MUTATION", p.path, `mutacion no permitida en pagina de solo lectura: ${tok}`);
      }
    }
    if (p.featureFlag && p.featureFlag.evidence) {
      for (const tok of p.featureFlag.evidence) {
        if (!src.includes(tok)) add("FEATURE_FLAG_MISSING", p.path, `flag ausente: ${tok}`);
      }
    }

    /* pins explicitos */
    if (p.pin === "PUBLIC_SUPPORT" && !(p.class === "PUBLIC_NO_SESSION" && p.session.required === false)) {
      add("PUBLIC_SUPPORT_STATE_CHANGED", p.path, `class=${p.class} sessionRequired=${p.session.required}`);
    }
    if (p.pin === "LEGAL_PUBLIC" && !(p.class === "LEGAL_PUBLIC" && p.session.required === false)) {
      add("LEGAL_NOT_PUBLIC", p.path, `class=${p.class} sessionRequired=${p.session.required}`);
    }
    if (p.pin === "ALTA_INTERNAL" && !(p.class === "ADMIN_ONLY" && p.surface === "admin")) {
      add("ALTA_NOT_INTERNAL", p.path, `class=${p.class} surface=${p.surface}`);
    }

    /* alcanzabilidad interna */
    if (isInternal) {
      let reached = (p.nav.navRoles || []).length > 0;
      for (const r of p.reachedBy || []) {
        if (r.kind === "linker") {
          const s = ev.js[r.file];
          if (s && s.includes(r.token)) reached = true;
        }
      }
      if (!reached) add("UNREACHABLE_INTERNAL", p.path, "sin nav ni linker resoluble");
    }
  }

  /* navegacion: cada href real -> pagina permitida para ese rol */
  for (const role of contract.navSource.roleMenus) {
    for (const item of ev.appMenu[role] || []) {
      if (!item.href) continue;
      const target = resolveHref(item.href);
      const pt = pageByHtml[target];
      if (!pt) { add("NAV_LINK_TO_UNKNOWN", "app/" + target, `menu ${role} enlaza destino no declarado (key=${item.key})`); continue; }
      if (publik.has(pt.class)) { add("PUBLIC_PAGE_IN_INTERNAL_NAV", pt.path, `menu ${role} enlaza pagina publica (key=${item.key})`); continue; }
      if (!(pt.nav.navRoles || []).includes(role)) {
        if ((pt.nav.navRoles || []).length === 0) add("UNDECLARED_NAV_LINK", pt.path, `menu ${role} enlaza pagina no linkable (key=${item.key})`);
        else add("NAV_ROLE_NOT_ALLOWED", pt.path, `menu ${role} no permitido; navRoles=${pt.nav.navRoles.join(",")}`);
      }
    }
  }
  /* navegacion inversa: navKey declarado debe existir en cada rol requerido */
  for (const p of contract.pages) {
    for (const role of p.nav.navRoles || []) {
      const found = (ev.appMenu[role] || []).some((it) => it.key === p.nav.navKey && resolveHref(it.href) === p.html);
      if (!found) add("NAV_LINK_MISSING", p.path, `falta link key=${p.nav.navKey} en menu ${role}`);
    }
  }

  /* allowlist de rutas internas (index.js INTERNAL_ROUTES) */
  const declared = [...contract.internalRouteAllowlist.routes].sort();
  const real = [...ev.internalRoutes].sort();
  if (JSON.stringify(declared) !== JSON.stringify(real)) {
    add("INTERNAL_ROUTE_ALLOWLIST_DRIFT", contract.internalRouteAllowlist.source, `declarado=[${declared}] real=[${real}]`);
  }
  for (const r of contract.internalRouteAllowlist.routes) {
    const pt = pageByHtml[r];
    if (!pt || !internal.has(pt.class)) add("ALLOWLIST_NONINTERNAL", "app/" + r, "ruta en allowlist no es pagina interna");
  }

  return V;
}

/* ----------------------------- corpus de mutantes ---------------------------- */

const clone = (x) => structuredClone(x);
const pageOf = (c, html) => c.pages.find((p) => p.html === html);
const stripFrom = (ev, file, needle) => { ev.js[file] = (ev.js[file] || "").split(needle).join(""); };

const MUTANTS = [
  {
    id: "M01",
    label: "soporte reclasificada como interna",
    expect: "PUBLIC_SUPPORT_STATE_CHANGED",
    apply: (c) => { pageOf(c, "soporte.html").class = "AUTHENTICATED_SHARED"; },
  },
  {
    id: "M02",
    label: "alta-cliente deja de ser interna",
    expect: "ALTA_NOT_INTERNAL",
    apply: (c) => { const p = pageOf(c, "alta-cliente.html"); p.class = "PUBLIC_NO_SESSION"; p.surface = "client"; },
  },
  {
    id: "M03",
    label: "legal intenta exigir sesion (guard inyectado en theme.js)",
    expect: "PUBLIC_REQUIRES_SESSION",
    apply: (_c, ev) => { ev.js["theme.js"] = (ev.js["theme.js"] || "") + "\nawait guardSession();"; },
  },
  {
    id: "M04",
    label: "pagina interna sin guard (mountNav removido)",
    expect: "INTERNAL_NO_GUARD",
    apply: (_c, ev) => stripFrom(ev, "clientes.js", 'mountNav("clientes")'),
  },
  {
    id: "M05",
    label: "render funcional antes del guard (early-return removido)",
    expect: "RENDER_BEFORE_GUARD",
    apply: (_c, ev) => { ev.js["consolidacion-clientes.js"] = (ev.js["consolidacion-clientes.js"] || "").replace(/if\s*\(!ctx\)\s*return/g, "/* removed */ 0"); },
  },
  {
    id: "M06",
    label: "pagina admin sin comprobacion de rol",
    expect: "ADMIN_NO_ROLE_CHECK",
    apply: (_c, ev) => stripFrom(ev, "bitacora-admin.js", '["admin","owner","administrador"]'),
  },
  {
    id: "M07",
    label: "ruta huerfana no declarada",
    expect: "ORPHAN_ROUTE_UNDECLARED",
    apply: (_c, ev) => { ev.files.add("rogue.html"); ev.html["rogue.html"] = { surface: "admin", dataPage: "rogue", scripts: [], raw: "" }; },
  },
  {
    id: "M08",
    label: "data-page divergente del real",
    expect: "DATA_PAGE_NAVKEY_DIVERGENCE",
    apply: (_c, ev) => { ev.html["clientes.html"].dataPage = "klientes"; },
  },
  {
    id: "M09",
    label: "pagina publica enlazada en navegacion interna",
    expect: "PUBLIC_PAGE_IN_INTERNAL_NAV",
    apply: (_c, ev) => { ev.appMenu.soporte.push({ key: "soporte", href: "soporte.html" }); },
  },
  {
    id: "M10",
    label: "link interno para rol no permitido",
    expect: "NAV_ROLE_NOT_ALLOWED",
    apply: (c) => { pageOf(c, "tickets.html").nav.navRoles = ["admin"]; },
  },
  {
    id: "M11",
    label: "pagina no linkable enlazada en nav (ticket)",
    expect: "UNDECLARED_NAV_LINK",
    apply: (_c, ev) => { ev.appMenu.soporte.push({ key: "ticket", href: "ticket.html" }); },
  },
  {
    id: "M12",
    label: "seguimiento marcado implementado (status)",
    expect: "SEGUIMIENTO_FALSE_IMPLEMENTED",
    apply: (c) => { c.pending.seguimiento.status = "IMPLEMENTED"; },
  },
  {
    id: "M13",
    label: "seguimiento con archivo presente sin declararse",
    expect: "SEGUIMIENTO_FALSE_IMPLEMENTED",
    apply: (_c, ev) => { ev.files.add("seguimiento.html"); ev.html["seguimiento.html"] = { surface: "support", dataPage: "seguimiento", scripts: [], raw: "" }; },
  },
  {
    id: "M14",
    label: "entry JS declarado faltante en html",
    expect: "ENTRY_JS_MISSING",
    apply: (_c, ev) => { ev.html["soporte.html"].scripts = ev.html["soporte.html"].scripts.filter((s) => s !== "soporte.js"); },
  },
  {
    id: "M15",
    label: "allowlist de rutas internas con drift",
    expect: "INTERNAL_ROUTE_ALLOWLIST_DRIFT",
    apply: (_c, ev) => { ev.internalRoutes.delete("tickets.html"); },
  },
  {
    id: "M16",
    label: "mutacion privilegiada en pagina de solo lectura",
    expect: "ADMIN_UNGUARDED_MUTATION",
    apply: (_c, ev) => { ev.js["consolidacion-clientes.js"] = (ev.js["consolidacion-clientes.js"] || "") + '\nawait s.from("clientes").insert({});'; },
  },
  {
    id: "M17",
    label: "nav key requerido ausente en su menu de rol",
    expect: "NAV_LINK_MISSING",
    apply: (_c, ev) => { ev.appMenu.admin = ev.appMenu.admin.filter((it) => it.key !== "dashboard"); },
  },
  {
    id: "M18",
    label: "data-surface divergente del real",
    expect: "SURFACE_DIVERGENCE",
    apply: (_c, ev) => { ev.html["dashboard.html"].surface = "client"; },
  },
];

/* ---------------------------------- runner ---------------------------------- */

const contract = JSON.parse(readFileSync(join(ROOT, "tools/page-access-contract.json"), "utf8"));
const evidence = collectEvidence(contract);

// 1) Positivo: la fuente real cumple el contrato (cero violaciones).
const base = validate(contract, evidence);
if (base.length) {
  console.error("PAGE_ACCESS_CONTRACT: FAIL — violaciones en la fuente real:");
  for (const v of base) console.error(`  [${v.code}] ${v.path} — ${v.detail}`);
  process.exit(1);
}

// Cobertura estructural minima.
assert.equal(contract.pages.length, 13, "se esperan 13 paginas reales");
assert.equal(evidence.files.has("seguimiento.html"), false, "seguimiento.html no debe existir");
const classCount = contract.pages.reduce((a, p) => ((a[p.class] = (a[p.class] || 0) + 1), a), {});
assert.ok(classCount.PUBLIC_NO_SESSION >= 3, "publicas sin sesion");
assert.ok(classCount.LEGAL_PUBLIC === 2, "dos legales publicas");
assert.ok(classCount.ADMIN_ONLY === 3, "tres admin-only");
assert.ok(classCount.SUPPORT_AND_ADMIN === 2, "dos support+admin");
assert.ok(classCount.AUTHENTICATED_SHARED === 3, "tres authenticated shared");

console.log(`PASS\tcontrato positivo (paginas=${contract.pages.length}, violaciones=0)`);

// 2) Sensibilidad: cada mutante debe ser rechazado con su codigo.
let killed = 0;
for (const mut of MUTANTS) {
  const c2 = clone(contract);
  const ev2 = { files: new Set(evidence.files), html: clone(evidence.html), js: { ...evidence.js }, internalRoutes: new Set(evidence.internalRoutes), appMenu: clone(evidence.appMenu) };
  mut.apply(c2, ev2);
  const res = validate(c2, ev2);
  const hit = res.some((v) => v.code === mut.expect);
  if (!hit) {
    console.error(`SENSITIVITY: FAIL — ${mut.id} (${mut.label}) no produjo ${mut.expect}. Codigos: [${[...new Set(res.map((v) => v.code))].join(", ") || "ninguno"}]`);
    process.exit(1);
  }
  killed++;
  console.log(`PASS\t${mut.id} rechazado (${mut.expect}) — ${mut.label}`);
}

// 3) No tautologico: el contrato real sin mutar sigue en verde tras el corpus.
assert.equal(validate(contract, evidence).length, 0, "el contrato real debe permanecer valido");

console.log(`PAGE_ACCESS_CONTRACT: PASS (paginas=13 positivo=1 mutantes=${killed}/${MUTANTS.length})`);
