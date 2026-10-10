/**
 * Funciones pequeñas que `chrome.scripting.executeScript({ world: "MAIN" })` serializa y ejecuta en la página.
 * Deben ser autocontenidas: no pueden referenciar nada de este módulo ni de otros.
 */

interface PfApi {
  version?: unknown;
  enable(): void;
  disable(): void;
  isEnabled(): boolean;
}

/** Lee el estado de `window.__pf`. */
export function probeLayer(): { present: boolean; enabled: boolean; version: string | null } {
  const pf = (window as unknown as { __pf?: PfApi }).__pf;
  if (typeof pf !== "object" || pf === null) return { present: false, enabled: false, version: null };
  return {
    present: true,
    enabled: typeof pf.isEnabled === "function" ? pf.isEnabled() === true : false,
    version: typeof pf.version === "string" ? pf.version : null,
  };
}

/** Escribe la preferencia `pf:layer` y enciende/apaga el overlay si está cargado. Devuelve si había overlay. */
export function setLayerInPage(enabled: boolean): boolean {
  try {
    if (enabled) localStorage.removeItem("pf:layer");
    else localStorage.setItem("pf:layer", "off");
  } catch {
    // almacenamiento bloqueado: se actúa solo sobre el overlay vivo
  }
  const pf = (window as unknown as { __pf?: PfApi }).__pf;
  if (typeof pf !== "object" || pf === null) return false;
  if (enabled) pf.enable();
  else pf.disable();
  return true;
}
