import type { FrameRef } from '@perfect-front/shared';
import { isPfNode } from './constants';
import { generateSelectorCandidates } from './selector';

/**
 * Comentarios dentro de `<iframe>`. Solo se puede entrar en marcos del mismo origen (`contentDocument`
 * accesible); los de otro origen se detectan y se explican, sin lanzar ni romper nada.
 */

export const CROSS_ORIGIN_MSG = 'Ese marco es de otro origen: no se puede entrar desde aquí. Ábrelo en su propia pestaña o comenta el marco completo.';

export function isTopWindow(win: Window | null | undefined): boolean {
  try {
    return !win || win.top === win;
  } catch {
    return false;
  }
}

/** Marco donde vive `doc`, o null si es la ventana superior (o no es http/https). */
export function frameInfo(doc: Document): FrameRef | null {
  const win = doc.defaultView;
  if (!win || isTopWindow(win)) return null;
  const url = (doc.location?.href ?? '').slice(0, 2048);
  if (!/^https?:\/\//i.test(url)) return null;
  let fe: Element | null = null;
  try {
    fe = win.frameElement;
  } catch {
    /* anfitrión de otro origen */
  }
  let selector: string | null = null;
  let hostRoute: string | null = null;
  if (fe) {
    selector = generateSelectorCandidates(fe)[0] ?? null;
    try {
      const l = fe.ownerDocument.location;
      hostRoute = ((l.pathname || '/') + (l.search || '')).slice(0, 2048);
    } catch {
      /* sin ruta anfitriona */
    }
  }
  return { url, selector, hostRoute };
}

/** Documento interno de un `<iframe>`; null si es de otro origen (o no cargó). */
export function readableDoc(frame: Element): Document | null {
  try {
    return (frame as HTMLIFrameElement).contentDocument ?? null;
  } catch {
    return null;
  }
}

/** ¿Es un `<iframe>` cuyo contenido no se puede leer por ser de otro origen? */
export function isCrossOriginFrame(el: Element): boolean {
  if (el.localName !== 'iframe') return false;
  const src = el.getAttribute('src') ?? '';
  if (!src || src.startsWith('about:') || el.hasAttribute('srcdoc')) return false;
  return readableDoc(el) === null;
}

export interface Locatable {
  selector: string | null;
  selectorCandidates?: string[];
  frame?: FrameRef | null;
}

export type Located = { ok: true; el: Element; frameEl: Element | null } | { ok: false; reason: 'cross-origin' | 'not-found' };

const selectorsOf = (loc: Locatable): string[] =>
  [loc.selector, ...(loc.selectorCandidates ?? [])].filter((s): s is string => typeof s === 'string' && s.length > 0);

function query(doc: Document, sels: readonly string[]): Element | null {
  for (const s of sels) {
    try {
      const el = doc.querySelector(s);
      if (el && !isPfNode(el)) return el;
    } catch {
      /* selector inválido: se prueba el siguiente */
    }
  }
  return null;
}

function search(doc: Document, sels: readonly string[], depth: number): { hit?: { el: Element; frameEl: Element }; crossed: boolean } {
  let crossed = false;
  for (const f of Array.from(doc.querySelectorAll('iframe'))) {
    const d = readableDoc(f);
    if (!d) {
      crossed ||= isCrossOriginFrame(f);
      continue;
    }
    const el = query(d, sels);
    if (el) return { hit: { el, frameEl: f }, crossed };
    if (depth < 2) {
      const inner = search(d, sels, depth + 1);
      if (inner.hit) return { hit: { el: inner.hit.el, frameEl: f }, crossed };
      crossed ||= inner.crossed;
    }
  }
  return { crossed };
}

/**
 * Resuelve el elemento de un comentario: en esta ventana y, si el comentario trae `frame` (o no está aquí),
 * dentro de los marcos del mismo origen. `frameEl` es el `<iframe>` de la ventana actual que lo contiene.
 */
export function locateElement(doc: Document, loc: Locatable): Located {
  const sels = selectorsOf(loc);
  if (!sels.length) return { ok: false, reason: 'not-found' };
  let crossed = false;
  if (loc.frame?.selector) {
    let frames: Element[] = [];
    try {
      frames = Array.from(doc.querySelectorAll(loc.frame.selector));
    } catch {
      /* selector del marco inválido */
    }
    for (const f of frames) {
      const d = readableDoc(f);
      if (!d) {
        crossed ||= isCrossOriginFrame(f);
        continue;
      }
      const el = query(d, sels);
      if (el) return { ok: true, el, frameEl: f };
    }
  }
  const own = query(doc, sels);
  if (own) return { ok: true, el: own, frameEl: null };
  const r = search(doc, sels, 0);
  if (r.hit) return { ok: true, ...r.hit };
  return { ok: false, reason: crossed || r.crossed ? 'cross-origin' : 'not-found' };
}
