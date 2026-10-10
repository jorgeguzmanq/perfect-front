/**
 * Lectura de React desde el DOM (el overlay corre en el mundo principal de la página).
 * React 16+ guarda el fiber del nodo en una propiedad `__reactFiber$<id>`; se sube por `return`.
 */

const MAX_STEPS = 60;
export const MAX_COMPONENTS = 4;

/** Componentes de infraestructura que no ayudan a ubicar el código (SPEC §9.6). */
const INFRA = new Set([
  'Route',
  'Routes',
  'RenderedRoute',
  'Outlet',
  'Router',
  'BrowserRouter',
  'HashRouter',
  'MemoryRouter',
  'Provider',
  'Consumer',
  'Suspense',
  'Fragment',
  'ErrorBoundary',
  'StrictMode',
  'Layout',
  'Chrome',
  'Shell',
  'Wrapper',
]);

interface FiberLike {
  type?: unknown;
  return?: FiberLike | null;
}

function fiberOf(node: Element): FiberLike | null {
  for (const key of Object.keys(node)) {
    if (key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')) {
      const f = (node as unknown as Record<string, unknown>)[key];
      if (f && typeof f === 'object') return f as FiberLike;
    }
  }
  return null;
}

function nameOf(type: unknown): string | null {
  if (typeof type === 'function') {
    const t = type as { displayName?: unknown; name?: unknown };
    const n = t.displayName ?? t.name;
    return typeof n === 'string' ? n : null;
  }
  if (type && typeof type === 'object') {
    // memo / forwardRef / lazy
    const t = type as { displayName?: unknown; render?: unknown; type?: unknown };
    if (typeof t.displayName === 'string') return t.displayName;
    if (typeof t.render === 'function' && typeof (t.render as { name?: unknown }).name === 'string') {
      return (t.render as { name: string }).name;
    }
    if (t.type) return nameOf(t.type);
  }
  return null;
}

/**
 * Nombres de componentes React que contienen el nodo (el primero es el más específico),
 * hasta 4. `null` si el nodo no pertenece a un árbol React.
 */
export function reactComponents(node: Element): string[] | null {
  let fiber = fiberOf(node);
  if (!fiber) return null;
  const out: string[] = [];
  for (let i = 0; fiber && i < MAX_STEPS && out.length < MAX_COMPONENTS; i++, fiber = fiber.return ?? null) {
    const name = nameOf(fiber.type);
    if (!name || name.startsWith('_') || INFRA.has(name) || out[out.length - 1] === name) continue;
    out.push(name);
  }
  return out.length ? out : null;
}

/** `archivo:línea` anotado por un plugin de build (`data-pf-src`), del nodo o su ancestro más cercano. */
export function sourceAnnotation(node: Element): string | null {
  const body = node.ownerDocument.body;
  for (let cur: Element | null = node; cur; cur = cur.parentElement) {
    const v = cur.getAttribute('data-pf-src');
    if (v && /^.+:\d+(:\d+)?$/.test(v.trim()) && v.length <= 500) return v.trim();
    if (cur === body) break;
  }
  return null;
}
