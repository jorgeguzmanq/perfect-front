/**
 * Contratos locales de la extensión que NO viven en shared.
 * zod no es dependencia de esta app, así que la validación es manual y estricta.
 */

/** Resultado del sondeo del mundo MAIN de una pestaña (`probeLayer`). */
export interface LayerProbe {
  /** `typeof window.__pf === "object"`: el overlay del proxy está cargado. */
  present: boolean;
  /** `window.__pf.isEnabled()`; false si no hay overlay. */
  enabled: boolean;
  version: string | null;
}

export function parseLayerProbe(raw: unknown): LayerProbe | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  if (Object.keys(r).length !== 3) return undefined;
  if (typeof r["present"] !== "boolean" || typeof r["enabled"] !== "boolean") return undefined;
  if (r["version"] !== null && typeof r["version"] !== "string") return undefined;
  return { present: r["present"], enabled: r["enabled"], version: r["version"] };
}
