import type { NavDir } from './dom-nav';

/**
 * Atajos del editor v2 como función pura (sin DOM): dada una tecla y el contexto, devuelve la acción.
 * Decisión de diseño: en TODAS las pestañas (también Estructura) ↑↓ navegan padre/hijo y ←→ hermanos;
 * reordenar hermanos solo se hace con arrastre o con los botones «Mover antes/después».
 */

export type KeyAction =
  | { type: 'nav'; dir: NavDir }
  | { type: 'save' }
  | { type: 'cancel' }
  | { type: 'paste-image' };

export interface KeyContext {
  /** El foco está en un textarea/input/select/contentEditable. */
  typing: boolean;
  /** El evento viene del propio overlay (no de la página). */
  own: boolean;
  /** Hay un elemento elegido (no es «toda la vista»). */
  hasElement: boolean;
}

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

const NAV: Record<string, NavDir> = { ArrowUp: 'parent', ArrowDown: 'child', ArrowLeft: 'prev', ArrowRight: 'next' };

export function interpretEditorKey(k: KeyLike, ctx: KeyContext): KeyAction | null {
  if (k.key === 'Escape') return { type: 'cancel' };
  if (k.key === 'Enter' && (k.ctrlKey || k.metaKey)) return { type: 'save' };
  const dir = NAV[k.key];
  if (dir && ctx.hasElement) {
    // Escribiendo, las flechas son del campo: solo navega con Alt. Fuera de un campo, navega siempre.
    if (k.altKey || (ctx.own && !ctx.typing)) return { type: 'nav', dir };
  }
  return null;
}
