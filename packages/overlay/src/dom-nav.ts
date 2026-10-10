import { isPfNode } from './constants';

/** Navegación por el DOM: padre, primer hijo (o el de regreso) y hermanos. Sin estado propio salvo la pila de regreso. */

export type NavDir = 'parent' | 'child' | 'prev' | 'next';

const visibleChildren = (el: Element): Element[] => Array.from(el.children).filter((c) => !isPfNode(c));

/** Hermanos del elemento (incluido él), sin nodos propios de Perfect Front. */
export function siblingsOf(el: Element): Element[] {
  const p = el.parentElement;
  return p ? visibleChildren(p) : [el];
}

export function parentOf(el: Element | null): Element | null {
  const p = el?.parentElement ?? null;
  return p && p !== el!.ownerDocument.documentElement ? p : null;
}

export function firstChildOf(el: Element): Element | null {
  return visibleChildren(el)[0] ?? null;
}

/** Posición 0-based entre hermanos y cantidad. */
export function siblingPos(el: Element): { pos: number; count: number } {
  const sibs = siblingsOf(el);
  return { pos: Math.max(0, sibs.indexOf(el)), count: sibs.length };
}

/** Qué direcciones están disponibles (alimenta los `disabled` del navegador ↑↓←→). */
export function navAvailability(el: Element | null): Record<NavDir, boolean> {
  if (!el) return { parent: false, child: false, prev: false, next: false };
  const { pos, count } = siblingPos(el);
  return { parent: !!parentOf(el), child: !!firstChildOf(el), prev: pos > 0, next: pos < count - 1 };
}

/**
 * Destino de una flecha. `stack` recuerda de dónde se subió para que ↓ regrese por el mismo camino
 * (misma conducta que el overlay v1). Muta `stack`. Devuelve null si no hay a dónde ir.
 */
export function navTarget(el: Element, dir: NavDir, stack: Element[]): Element | null {
  switch (dir) {
    case 'parent': {
      const p = parentOf(el);
      if (p) stack.push(el);
      return p;
    }
    case 'child': {
      const back = stack.pop();
      if (back && back !== el && el.contains(back)) {
        const via = visibleChildren(el).find((c) => c === back || c.contains(back));
        if (via) return via;
      }
      return firstChildOf(el);
    }
    case 'prev':
    case 'next': {
      stack.length = 0;
      const sibs = siblingsOf(el);
      const i = sibs.indexOf(el);
      return sibs[dir === 'prev' ? i - 1 : i + 1] ?? null;
    }
  }
}

/** Ruta de ancestros (migas): del más lejano (excluye html) al propio elemento. */
export function ancestorsOf(el: Element): Element[] {
  const out: Element[] = [];
  const root = el.ownerDocument.documentElement;
  for (let c: Element | null = el; c && c !== root; c = c.parentElement) out.unshift(c);
  return out;
}
