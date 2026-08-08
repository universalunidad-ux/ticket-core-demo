import { JANOME_PLANO } from "../../../app/janome/janome_catalogo.js";

export const SUPPORT_CATALOG_VERSION = "support-catalog/v1" as const;
export const SUPPORT_CATEGORIES = ["soporte"] as const;
export const SUPPORT_IMPACTS = ["baja", "media", "alta"] as const;
export const SUPPORT_CHANNELS = ["correo", "whatsapp"] as const;
export const SUPPORT_AFFECTED = ["solo_yo", "varios", "todos", "no_se"] as const;
export const SUPPORT_LAST_CHANGES = ["", "sin_cambio", "no_se"] as const;

export type SupportCategory = typeof SUPPORT_CATEGORIES[number];
export type SupportImpact = typeof SUPPORT_IMPACTS[number];
export type SupportChannel = typeof SUPPORT_CHANNELS[number];
export type SupportAffected = typeof SUPPORT_AFFECTED[number];
export type SupportLastChange = typeof SUPPORT_LAST_CHANGES[number];
export type SupportSystem = Readonly<{ kind: "catalog" | "other"; label: string }>;

const catalogLabels = new Set<string>();
for (const product of JANOME_PLANO) {
  const label = `Janome ${product.nombre} (${product.grupo})`;
  if (catalogLabels.has(label)) throw new Error("SUPPORT_CATALOG_DUPLICATE_LABEL");
  catalogLabels.add(label);
}

let readonlyCatalogLabels: ReadonlySet<string>;
readonlyCatalogLabels = Object.freeze({
  get size() { return catalogLabels.size; },
  has(value: string) { return catalogLabels.has(value); },
  entries() { return catalogLabels.entries(); },
  keys() { return catalogLabels.keys(); },
  values() { return catalogLabels.values(); },
  forEach(callback: (value: string, key: string, set: ReadonlySet<string>) => void, thisArg?: unknown) {
    catalogLabels.forEach((value) => callback.call(thisArg, value, value, readonlyCatalogLabels));
  },
  [Symbol.iterator]() { return catalogLabels[Symbol.iterator](); },
  [Symbol.toStringTag]: "Set",
});

export const KNOWN_SUPPORT_SYSTEM_LABELS: ReadonlySet<string> = readonlyCatalogLabels;

export function isSupportCategory(v: unknown): v is SupportCategory {
  return typeof v === "string" && (SUPPORT_CATEGORIES as readonly string[]).includes(v);
}

export function isSupportImpact(v: unknown): v is SupportImpact {
  return typeof v === "string" && (SUPPORT_IMPACTS as readonly string[]).includes(v);
}

export function isSupportChannel(v: unknown): v is SupportChannel {
  return typeof v === "string" && (SUPPORT_CHANNELS as readonly string[]).includes(v);
}

export function isSupportAffected(v: unknown): v is SupportAffected {
  return typeof v === "string" && (SUPPORT_AFFECTED as readonly string[]).includes(v);
}

export function isSupportLastChange(v: unknown): v is SupportLastChange {
  return typeof v === "string" && (SUPPORT_LAST_CHANGES as readonly string[]).includes(v);
}

export function parseSupportSystem(v: unknown): SupportSystem | null {
  if (typeof v !== "string" || /[\u0000-\u001f\u007f]/u.test(v)) return null;
  if (KNOWN_SUPPORT_SYSTEM_LABELS.has(v)) return Object.freeze({ kind: "catalog", label: v });
  if (!v.startsWith("Otro: ")) return null;
  const model = v.slice(6).normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (model.length < 2 || model.length > 113) return null;
  return Object.freeze({ kind: "other", label: `Otro: ${model}` });
}
