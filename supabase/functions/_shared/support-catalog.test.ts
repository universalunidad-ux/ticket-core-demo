import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  KNOWN_SUPPORT_SYSTEM_LABELS,
  SUPPORT_AFFECTED,
  SUPPORT_CATEGORIES,
  SUPPORT_CHANNELS,
  SUPPORT_IMPACTS,
  SUPPORT_LAST_CHANGES,
  isSupportAffected,
  isSupportCategory,
  isSupportChannel,
  isSupportImpact,
  isSupportLastChange,
  parseSupportSystem,
} from "./support-catalog.ts";

Deno.test("catálogos públicos son cerrados", () => {
  assertEquals(SUPPORT_CATEGORIES, ["soporte"]);
  assert(SUPPORT_IMPACTS.every(isSupportImpact));
  assert(SUPPORT_CHANNELS.every(isSupportChannel));
  assert(SUPPORT_AFFECTED.every(isSupportAffected));
  assert(SUPPORT_LAST_CHANGES.every(isSupportLastChange));
  assertEquals(isSupportCategory("ventas"), false);
});

Deno.test("sistemas provienen del catálogo Janome y Otro se normaliza", () => {
  const label = [...KNOWN_SUPPORT_SYSTEM_LABELS][0];
  assert(label);
  assertEquals(parseSupportSystem(label), { kind: "catalog", label });
  assertEquals(parseSupportSystem("Otro: Modelo   externo"), { kind: "other", label: "Otro: Modelo externo" });
  assertEquals(parseSupportSystem("Otro / no aparece en la lista"), null);
});
