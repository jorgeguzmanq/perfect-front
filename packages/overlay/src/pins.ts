import { PINS_ATTR, isPfNode } from './constants';
import { injectStylesIntoShadowRoot } from './styles';

/** Subconjunto de VisualComment que usan los pines (contrato de GET {base}/comments). */
export interface PinComment {
  id: string;
  status: string;
  scope: string;
  comment: string;
  location: { route: string; selector: string | null; selectorCandidates?: string[] };
  elementRect?: unknown;
  createdAt?: string;
}

export interface PinsOptions {
  document?: Document;
  loadComments(): Promise<PinComment[]>;
  /** Se llama tras cada redibujado con los totales (alimenta el lanzador). */
  onStats?(s: { total: number; here: number; located: number; route: string }): void;
}

export interface PinsHandle {
  /** Vuelve a pedir los comentarios y redibuja. */
  refresh(): Promise<void>;
  /** Redibuja con los comentarios ya cargados (p. ej. tras navegar). */
  relocate(): void;
  destroy(): void;
  /** Comentarios abiertos (pendientes o en curso), con o sin pin. */
  readonly total: number;
  /** Abiertos de la ruta actual. */
  readonly here: number;
  /** Abiertos de la ruta actual que tienen pin. */
  readonly located: number;
}

const OPEN = new Set(['pending', 'in_progress']);
const RELOCATE_DELAYS = [150, 600, 1500];

const routeOf = (doc: Document) => (doc.location.pathname || '/') + (doc.location.search || '');

function sameRoute(commentRoute: string, doc: Document): boolean {
  if (commentRoute === routeOf(doc)) return true;
  // Una ruta guardada sin query coincide con cualquier query de la misma ruta.
  return !commentRoute.includes('?') && commentRoute === (doc.location.pathname || '/');
}

function resolve(doc: Document, c: PinComment): Element | null {
  const sels = [c.location.selector, ...(c.location.selectorCandidates ?? [])].filter(
    (s): s is string => typeof s === 'string' && s.length > 0,
  );
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

interface Entry {
  n: number;
  comment: PinComment;
  el: Element | null;
  pin: HTMLButtonElement | null;
}

export function createPins(opts: PinsOptions): PinsHandle {
  const doc = opts.document ?? document;
  const win = doc.defaultView;

  const host = doc.createElement('div');
  host.setAttribute(PINS_ATTR, '');
  const shadow = host.attachShadow({ mode: 'open' });
  injectStylesIntoShadowRoot(shadow, doc);
  const layer = doc.createElement('div');
  layer.className = 'pf-root pf-pins-layer';
  shadow.appendChild(layer);
  doc.documentElement.appendChild(host);

  let destroyed = false;
  let all: PinComment[] = [];
  let entries: Entry[] = [];
  let stats = { total: 0, here: 0, located: 0 };
  let frame: ReturnType<typeof setTimeout> | number = 0;
  const cleanups: Array<() => void> = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const listen = (t: EventTarget, type: string, fn: () => void, o?: boolean) => {
    t.addEventListener(type, fn, o);
    cleanups.push(() => t.removeEventListener(type, fn, o));
  };

  const place = (e: Entry) => {
    if (!e.pin) return;
    if (!e.el || !e.el.isConnected) e.el = resolve(doc, e.comment);
    const r = e.el?.getBoundingClientRect();
    if (!e.el || !r || (r.width === 0 && r.height === 0)) {
      e.pin.hidden = true;
      return;
    }
    e.pin.hidden = false;
    e.pin.style.left = `${r.right - 8}px`;
    e.pin.style.top = `${r.top - 8}px`;
  };

  const paint = () => {
    if (destroyed) return;
    for (const e of entries) e.pin?.remove();
    const open = all
      .filter((c) => OPEN.has(c.status))
      .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
    entries = open.map((comment, i) => ({ n: i + 1, comment, el: null, pin: null }));
    let here = 0;
    let located = 0;
    for (const e of entries) {
      if (!sameRoute(e.comment.location.route, doc)) continue;
      here++;
      if (e.comment.scope !== 'element') continue;
      e.el = resolve(doc, e.comment);
      if (!e.el) continue;
      located++;
      const pin = doc.createElement('button');
      pin.type = 'button';
      pin.className = 'pf-pin';
      pin.textContent = String(e.n);
      pin.setAttribute('aria-label', `Comentario ${e.n}: ${e.comment.comment.slice(0, 200)}`);
      const tip = doc.createElement('span');
      tip.className = 'pf-pin__tip';
      tip.setAttribute('role', 'tooltip');
      tip.textContent = e.comment.comment.slice(0, 300);
      pin.appendChild(tip);
      pin.addEventListener('click', () => pin.toggleAttribute('data-open'));
      pin.addEventListener('blur', () => pin.removeAttribute('data-open'));
      layer.appendChild(pin);
      e.pin = pin;
      place(e);
    }
    stats = { total: entries.length, here, located };
    opts.onStats?.({ ...stats, route: routeOf(doc) });
  };

  const reposition = () => {
    if (frame || destroyed) return;
    const run = () => {
      frame = 0;
      for (const e of entries) place(e);
    };
    frame = win?.requestAnimationFrame ? win.requestAnimationFrame(run) : setTimeout(run, 16);
  };

  const later = (ms: number, fn: () => void) => {
    const t = setTimeout(() => {
      timers.delete(t);
      if (!destroyed) fn();
    }, ms);
    timers.add(t);
  };

  const relocate = () => {
    paint();
    // Una SPA renderiza la vista nueva después de cambiar la URL: reintenta unos instantes.
    for (const ms of RELOCATE_DELAYS) later(ms, paint);
  };

  listen(doc, 'scroll', reposition, true);
  if (win) listen(win, 'resize', reposition);
  let mutTimer: ReturnType<typeof setTimeout> | null = null;
  const MO = win?.MutationObserver ?? (typeof MutationObserver !== 'undefined' ? MutationObserver : null);
  const mo = MO
    ? new MO(() => {
        if (mutTimer) clearTimeout(mutTimer);
        mutTimer = setTimeout(() => {
          mutTimer = null;
          if (destroyed) return;
          if (entries.some((e) => !e.el || !e.el.isConnected)) paint();
          else reposition();
        }, 300);
      })
    : null;
  if (mo && doc.body) mo.observe(doc.body, { childList: true, subtree: true });

  return {
    async refresh() {
      try {
        all = await opts.loadComments();
      } catch {
        // Sin servidor se conserva lo ya cargado; el contador queda como estaba.
        return;
      }
      paint();
    },
    relocate,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const fn of cleanups) fn();
      mo?.disconnect();
      if (mutTimer) clearTimeout(mutTimer);
      for (const t of timers) clearTimeout(t);
      timers.clear();
      host.remove();
      entries = [];
    },
    get total() {
      return stats.total;
    },
    get here() {
      return stats.here;
    },
    get located() {
      return stats.located;
    },
  };
}
