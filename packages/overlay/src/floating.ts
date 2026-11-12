import { h } from './dom';
import { makeMovable, type Movable, type PanelKind } from './drag-panel';
import { icon } from './icons';
import { led } from './deck';

/**
 * Capa 13 «Flotantes»: el panel movible (drag-panel.ts) con anclaje a un borde, redimensionado por el borde,
 * minimizado a una píldora sobre el dock y gestión de foco. Estados del diseño: drag, anchor, min (pin y stack
 * viven en pins.ts y en styles-float.ts). Todo el estado visual es de clases `pf-dk-fl-*`; el estado lógico
 * (anclaje y tamaños) se recuerda por tipo de panel en localStorage con try/catch.
 *
 * - Arrastre por la cabecera (⠿): fantasma donde estaba, leve rotación y zonas de anclaje al acercarse a un borde.
 * - Soltar a ≤ EDGE px del borde derecho/inferior ancla; arrastrar un panel anclado lo suelta.
 * - Teclado con el foco en la cabecera: Enter/Espacio minimiza; Ctrl+Alt+→ / ↓ ancla; Ctrl+Alt+← / ↑ suelta.
 * - Minimizado: el foco pasa a «Restaurar panel»; Enter/Espacio restaura (el foco vuelve a la cabecera); Esc cierra.
 */

export type Anchor = 'right' | 'bottom';

/** Distancia al borde (px) a la que aparece la zona de anclaje y a la que soltar ancla. */
export const ZONE = 120;
export const EDGE = 48;
export const DEFAULT_SIZE: Record<Anchor, number> = { right: 360, bottom: 320 };
export const MIN_SIZE: Record<Anchor, number> = { right: 280, bottom: 200 };
export const SIZE_STEP = 16;
const DOCK_PREFIX = 'perfect-front:panel-dock:';

export interface DockState {
  anchor: Anchor | null;
  /** Ancho (derecha) y alto (abajo) recordados. */
  right: number;
  bottom: number;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const defaultStorage = (): StorageLike | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

/** Recorta el tamaño del panel anclado al rango permitido del viewport. Puro. */
export function clampSize(anchor: Anchor, size: number, viewport: { width: number; height: number }): number {
  const extent = anchor === 'right' ? viewport.width : viewport.height;
  const max = Math.max(MIN_SIZE[anchor], Math.min(anchor === 'right' ? 720 : extent, extent * (anchor === 'right' ? 0.8 : 0.7)));
  return Math.round(Math.max(MIN_SIZE[anchor], Math.min(size, max)));
}

/** Borde más cercano del viewport dentro de `within` px (derecho o inferior); null si ninguno. Puro. */
export function nearEdge(x: number, y: number, viewport: { width: number; height: number }, within: number): Anchor | null {
  const dr = viewport.width - x;
  const db = viewport.height - y;
  if (dr > within && db > within) return null;
  return dr <= db ? 'right' : 'bottom';
}

export function loadDock(kind: PanelKind, storage: StorageLike | null = defaultStorage()): DockState {
  const base: DockState = { anchor: null, right: DEFAULT_SIZE.right, bottom: DEFAULT_SIZE.bottom };
  try {
    const raw = storage?.getItem(DOCK_PREFIX + kind);
    if (!raw) return base;
    const v = JSON.parse(raw) as Partial<DockState>;
    return {
      anchor: v.anchor === 'right' || v.anchor === 'bottom' ? v.anchor : null,
      right: Number.isFinite(v.right) ? (v.right as number) : base.right,
      bottom: Number.isFinite(v.bottom) ? (v.bottom as number) : base.bottom,
    };
  } catch {
    return base;
  }
}

export function saveDock(kind: PanelKind, s: DockState, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(DOCK_PREFIX + kind, JSON.stringify({ anchor: s.anchor, right: Math.round(s.right), bottom: Math.round(s.bottom) }));
  } catch {
    /* sin almacenamiento: vale solo para esta sesión */
  }
}

export interface FloatingOptions {
  kind: PanelKind;
  /** Capa del overlay donde viven la píldora, las zonas y el borde. */
  layer: HTMLElement;
  /** Nombre corto del nodo para la píldora («button.cta»). */
  label(): string;
  /** Cerrar (Esc sobre la píldora). */
  onClose?(): void;
  /** Volvió a la colocación automática (Inicio, doble clic, soltar el anclaje). */
  onPanelReset?(): void;
  onMoved?(pos: { left: number; top: number } | null): void;
  /** Anclado/suelto o minimizado/restaurado. */
  onChange?(s: { anchor: Anchor | null; minimized: boolean }): void;
  storage?: StorageLike | null;
}

export interface Floating {
  /** Movible del panel; `isMoved()` también es true mientras está anclado (no recolocarlo). */
  readonly movable: Movable;
  anchor(): Anchor | null;
  setAnchor(a: Anchor | null): void;
  size(): number;
  setSize(n: number): void;
  minimized(): boolean;
  setMinimized(min: boolean): void;
  destroy(): void;
}

export function makeFloating(panel: HTMLElement, handle: HTMLElement, opts: FloatingOptions): Floating {
  const doc = panel.ownerDocument;
  const win = doc.defaultView;
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage;
  const state = loadDock(opts.kind, storage);
  let anchor: Anchor | null = null;
  let min = false;
  let gone = false;
  let drag: { rect: DOMRect; started: boolean } | null = null;
  let zones: Partial<Record<Anchor, HTMLElement>> = {};
  let ghost: HTMLElement | null = null;
  let hint: HTMLElement | null = null;
  let edge: HTMLElement | null = null;

  const offs: Array<() => void> = [];
  const on = (t: EventTarget, type: string, fn: (e: never) => void, o?: AddEventListenerOptions | boolean) => {
    t.addEventListener(type, fn as EventListener, o);
    offs.push(() => t.removeEventListener(type, fn as EventListener, o));
  };
  const viewport = () => ({ width: win?.innerWidth ?? 0, height: win?.innerHeight ?? 0 });
  const notify = () => opts.onChange?.({ anchor, minimized: min });
  const persist = () => saveDock(opts.kind, { anchor, right: state.right, bottom: state.bottom }, storage);

  // --- Anclaje y tamaño -----------------------------------------------------------------------
  const sizeFor = (a: Anchor) => {
    const vp = viewport();
    return vp.width && vp.height ? clampSize(a, state[a], vp) : state[a];
  };

  const placeEdge = () => {
    if (!edge || !anchor) return;
    const s = sizeFor(anchor);
    edge.style.right = anchor === 'right' ? `${s}px` : '0';
    edge.style.bottom = anchor === 'bottom' ? `${s}px` : '0';
    edge.setAttribute('aria-valuenow', String(s));
    const vp = viewport();
    if (vp.width) {
      edge.setAttribute('aria-valuemin', String(MIN_SIZE[anchor]));
      edge.setAttribute('aria-valuemax', String(clampSize(anchor, 99999, vp)));
    }
  };

  const applyAnchor = () => {
    panel.classList.toggle('pf-dk-fl--right', anchor === 'right');
    panel.classList.toggle('pf-dk-fl--bottom', anchor === 'bottom');
    if (anchor) {
      panel.setAttribute('data-pf-anchor', anchor);
      panel.style.setProperty('--pf-fl-size', `${sizeFor(anchor)}px`);
    } else {
      panel.removeAttribute('data-pf-anchor');
      panel.style.removeProperty('--pf-fl-size');
    }
    edge?.remove();
    edge = null;
    if (anchor) {
      edge = h(doc, 'div', `pf-dk-fl-edge pf-dk-fl-edge--${anchor}`);
      edge.setAttribute('role', 'separator');
      edge.setAttribute('aria-orientation', anchor === 'right' ? 'vertical' : 'horizontal');
      edge.setAttribute('aria-label', anchor === 'right' ? 'Cambiar el ancho del panel' : 'Cambiar el alto del panel');
      edge.setAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight ArrowUp ArrowDown');
      edge.tabIndex = 0;
      edge.title = anchor === 'right' ? 'Arrastra para cambiar el ancho' : 'Arrastra para cambiar el alto';
      bindEdge(edge, anchor);
      opts.layer.appendChild(edge);
      placeEdge();
    }
    if (edge) edge.hidden = min;
  };

  /** `release`: al soltar el anclaje se vuelve a la colocación automática (salvo que lo suelte un arrastre). */
  const setAnchor = (a: Anchor | null, release = true) => {
    if (gone || a === anchor) return;
    anchor = a;
    applyAnchor();
    persist();
    notify();
    if (!a && release) {
      inner.reset();
    }
  };

  const setSize = (n: number) => {
    if (!anchor) return;
    state[anchor] = clampSize(anchor, n, viewport().width ? viewport() : { width: 99999, height: 99999 });
    panel.style.setProperty('--pf-fl-size', `${state[anchor]}px`);
    placeEdge();
    persist();
  };

  function bindEdge(el: HTMLElement, a: Anchor) {
    let id: number | null = null;
    const to = (e: PointerEvent) => {
      const vp = viewport();
      setSize(a === 'right' ? vp.width - e.clientX : vp.height - e.clientY);
    };
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      id = e.pointerId;
      try {
        el.setPointerCapture?.(e.pointerId);
      } catch {
        /* puntero ya liberado */
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (id === null || e.pointerId !== id) return;
      e.preventDefault();
      to(e);
    });
    const up = (e: PointerEvent) => {
      if (id === null || e.pointerId !== id) return;
      id = null;
      try {
        el.releasePointerCapture?.(e.pointerId);
      } catch {
        /* ya liberado */
      }
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('keydown', (e) => {
      const grow = a === 'right' ? 'ArrowLeft' : 'ArrowUp';
      const shrink = a === 'right' ? 'ArrowRight' : 'ArrowDown';
      if (e.key !== grow && e.key !== shrink) return;
      e.preventDefault();
      e.stopPropagation();
      setSize(state[a] + (e.key === grow ? SIZE_STEP : -SIZE_STEP) * (e.shiftKey ? 4 : 1));
    });
  }

  // --- Minimizar a la píldora ------------------------------------------------------------------
  let pill: HTMLElement | null = null;
  let pillText: HTMLElement | null = null;
  let restore: HTMLButtonElement | null = null;

  const buildPill = () => {
    const p = h(doc, 'div', 'pf-dk-unit pf-dk-lcd pf-dk-lp pf-dk-fx pf-dk-g12 pf-dk-fl-pill');
    p.setAttribute('role', 'region');
    p.setAttribute('aria-label', 'Panel minimizado');
    pillText = h(doc, 'span', 'pf-dk-tx pf-dk-grow pf-dk-ell');
    const b = h(doc, 'button', 'pf-dk-key pf-dk-key--sq');
    b.type = 'button';
    b.setAttribute('aria-label', 'Restaurar panel');
    b.title = 'Restaurar panel';
    b.appendChild(icon(doc, 'plus', 16));
    b.addEventListener('click', () => setMinimized(false));
    p.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        opts.onClose?.();
      }
    });
    p.append(led(doc, true), pillText, b);
    restore = b;
    return p;
  };

  function setMinimized(next: boolean) {
    if (gone || next === min) return;
    min = next;
    if (min) {
      pill ??= buildPill();
      pillText!.textContent = `Panel minimizado · ${opts.label()}`;
      pillText!.title = pillText!.textContent;
      opts.layer.appendChild(pill);
      panel.setAttribute('data-pf-min', '');
      if (edge) edge.hidden = true;
      restore?.focus();
    } else {
      pill?.remove();
      panel.removeAttribute('data-pf-min');
      if (edge) edge.hidden = false;
      handle.focus();
    }
    notify();
  }

  // --- Arrastre: fantasma, rotación y zonas de anclaje -------------------------------------------
  const clearDrag = () => {
    drag = null;
    panel.classList.remove('pf-dk-fl--drag');
    ghost?.remove();
    hint?.remove();
    ghost = hint = null;
    for (const z of Object.values(zones)) z?.remove();
    zones = {};
  };

  const onDrag = (phase: 'start' | 'move' | 'end', e: PointerEvent) => {
    if (gone) return;
    const vp = viewport();
    if (phase === 'start') {
      drag = { rect: panel.getBoundingClientRect(), started: false };
      return;
    }
    if (!drag) return;
    if (phase === 'move') {
      if (!drag.started) {
        drag.started = true;
        ghost = h(doc, 'div', 'pf-dk-fl-ghost');
        ghost.setAttribute('aria-hidden', 'true');
        ghost.style.left = `${drag.rect.left}px`;
        ghost.style.top = `${drag.rect.top}px`;
        ghost.style.inlineSize = `${drag.rect.width}px`;
        ghost.style.blockSize = `${drag.rect.height}px`;
        hint = h(doc, 'span', 'pf-dk-chip pf-dk-chip--on pf-dk-fl-hint', 'Moviendo · suelta en un borde para anclar');
        hint.setAttribute('aria-hidden', 'true');
        for (const a of ['right', 'bottom'] as const) {
          const z = h(doc, 'div', `pf-dk-fl-zone pf-dk-fl-zone--${a}`, a === 'right' ? 'Anclar →' : 'Anclar abajo');
          z.setAttribute('aria-hidden', 'true');
          z.hidden = true;
          zones[a] = z;
          opts.layer.appendChild(z);
        }
        opts.layer.append(ghost, hint);
        panel.classList.add('pf-dk-fl--drag');
      }
      // Un panel anclado se suelta al arrastrarlo (antes de que drag-panel mida y coloque).
      if (anchor) setAnchor(null, false);
      const near = vp.width ? nearEdge(e.clientX, e.clientY, vp, ZONE) : null;
      const hot = vp.width ? nearEdge(e.clientX, e.clientY, vp, EDGE) : null;
      for (const a of ['right', 'bottom'] as const) {
        const z = zones[a];
        if (!z) continue;
        z.hidden = near !== a;
        z.classList.toggle('pf-dk-fl-zone--hot', hot === a);
      }
      if (hint) {
        const r = panel.getBoundingClientRect();
        hint.style.left = `${r.left}px`;
        hint.style.top = `${Math.max(4, r.top - 34)}px`;
      }
      return;
    }
    // end
    const started = drag.started;
    const hot = started && vp.width ? nearEdge(e.clientX, e.clientY, vp, EDGE) : null;
    clearDrag();
    if (hot) setAnchor(hot);
  };

  const inner = makeMovable(panel, handle, {
    kind: opts.kind,
    storage,
    onDrag,
    onMoved: (p) => {
      if (gone) return;
      // Cualquier movimiento manual (teclado incluido) o restablecer saca al panel del anclaje.
      if (anchor) setAnchor(null, false);
      if (!p) opts.onPanelReset?.();
      opts.onMoved?.(p);
    },
  });

  // --- Teclado en la cabecera ----------------------------------------------------------------------
  const prev = handle.getAttribute('aria-keyshortcuts') ?? '';
  handle.setAttribute('aria-keyshortcuts', `${prev} Enter Space Control+Alt+ArrowRight Control+Alt+ArrowDown Control+Alt+ArrowLeft`.trim());
  on(handle, 'keydown', (e: KeyboardEvent) => {
    if ((e.composedPath?.()[0] ?? e.target) !== handle) return;
    if ((e.key === 'Enter' || e.key === ' ') && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      setMinimized(true);
      return;
    }
    if (!e.ctrlKey || !e.altKey) return;
    const to = { ArrowRight: 'right', ArrowDown: 'bottom', ArrowLeft: null, ArrowUp: null }[e.key as 'ArrowRight'];
    if (to === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    setAnchor(to as Anchor | null);
  });

  const refit = () => {
    if (gone || !anchor) return;
    panel.style.setProperty('--pf-fl-size', `${sizeFor(anchor)}px`);
    placeEdge();
  };
  if (win) on(win, 'resize', refit);

  // Estado recordado: el panel nace anclado si lo estaba.
  if (state.anchor) {
    anchor = state.anchor;
    applyAnchor();
    notify();
  }

  const movable: Movable = {
    reset() {
      if (anchor) setAnchor(null, false);
      inner.reset();
    },
    destroy() {
      if (gone) return;
      gone = true;
      clearDrag();
      for (const f of offs) f();
      inner.destroy();
      edge?.remove();
      pill?.remove();
      panel.classList.remove('pf-dk-fl--right', 'pf-dk-fl--bottom');
      panel.removeAttribute('data-pf-anchor');
      panel.removeAttribute('data-pf-min');
      panel.style.removeProperty('--pf-fl-size');
    },
    isMoved: () => anchor !== null || inner.isMoved(),
    position: () => inner.position(),
  };

  return {
    movable,
    anchor: () => anchor,
    setAnchor: (a) => setAnchor(a),
    size: () => (anchor ? state[anchor] : 0),
    setSize,
    minimized: () => min,
    setMinimized,
    destroy: () => movable.destroy(),
  };
}
