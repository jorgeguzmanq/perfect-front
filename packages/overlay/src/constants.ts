/** Atributo del host del overlay (panel/resaltado), único por documento. */
export const HOST_ATTR = 'data-perfect-front-overlay';
/** Atributo del host de los pines y el contador. */
export const PINS_ATTR = 'data-perfect-front-pins';

/** Atributo del host del lanzador flotante. */
export const LAUNCHER_ATTR = 'data-perfect-front-launcher';

/** Nodo propio de Perfect Front (host del overlay o de los pines). */
export function isPfNode(n: unknown): boolean {
  const el = n as Element | null;
  return !!el && el.nodeType === 1 && (el.hasAttribute(HOST_ATTR) || el.hasAttribute(PINS_ATTR) || el.hasAttribute(LAUNCHER_ATTR));
}
