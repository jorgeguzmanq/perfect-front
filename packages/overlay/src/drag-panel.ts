/**
 * Paneles movibles del overlay (editor, cajón de comentarios y lanzador) con un único módulo.
 *
 * - Arrastre desde el asa con Pointer Events + setPointerCapture (ratón, táctil, lápiz). Los controles
 *   dentro del asa (botones, enlaces, campos) no inician el arrastre.
 * - Teclado con el foco en el asa: Alt+flechas mueven 16 px (Mayús = 64 px); Inicio o doble clic restablecen.
 * - La posición se recorta al viewport con margen y se persiste por tipo en localStorage (con try/catch).
 * - Sin mover, el panel sigue su colocación automática; movido a mano, `isMoved()` es true y quien coloca
 *   el panel debe dejarlo en paz. Todos los listeners se liberan en `destroy()`.
 * - Sin animaciones (tampoco al restablecer): respeta prefers-reduced-motion por construcción.
 */

export type PanelKind = 'editor' | 'drawer' | 'launcher';

export interface PanelPos {
  left: number;
  top: number;
}
export interface PanelSize {
  width: number;
  height: number;
}
export interface PanelViewport {
  width: number;
  height: number;
}

/** Atributo del asa; el overlay lo usa para no tratar Alt+flechas del asa como navegación de elementos. */
export const GRIP_ATTR = 'data-pf-grip';
export const GRIP_LABEL = 'Mover panel';
export const DEFAULT_MARGIN = 8;
export const KEY_STEP = 16;
export const KEY_STEP_BIG = 64;
const STORAGE_PREFIX = 'perfect-front:panel-pos:';
const INTERACTIVE = 'button, a, input, select, textarea, label, [contenteditable="true"], [role="button"], [role="menuitem"]';

/** Recorta `pos` para que el panel (`size`) quede dentro del viewport con `margin` de separación. Puro. */
export function clampPosition(pos: PanelPos, size: PanelSize, viewport: PanelViewport, margin = DEFAULT_MARGIN): PanelPos {
  const fit = (v: number, extent: number, room: number) => {
    const max = room - extent - margin;
    // Si el panel es mayor que el viewport, prima el borde de origen (la cabecera siempre visible).
    return Math.max(margin, Math.min(v, Math.max(margin, max)));
  };
  return { left: fit(pos.left, size.width, viewport.width), top: fit(pos.top, size.height, viewport.height) };
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const defaultStorage = (): StorageLike | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

/** Lee la posición guardada del tipo; null si no hay, es inválida o el almacenamiento falla. */
export function loadPosition(kind: PanelKind, storage: StorageLike | null = defaultStorage()): PanelPos | null {
  try {
    const raw = storage?.getItem(STORAGE_PREFIX + kind);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<PanelPos>;
    return Number.isFinite(v.left) && Number.isFinite(v.top) ? { left: v.left as number, top: v.top as number } : null;
  } catch {
    return null;
  }
}

/** Guarda la posición del tipo (`null` la borra). Nunca lanza. */
export function savePosition(kind: PanelKind, pos: PanelPos | null, storage: StorageLike | null = defaultStorage()): void {
  try {
    if (pos) storage?.setItem(STORAGE_PREFIX + kind, JSON.stringify({ left: Math.round(pos.left), top: Math.round(pos.top) }));
    else storage?.removeItem(STORAGE_PREFIX + kind);
  } catch {
    /* sin almacenamiento: la posición vale solo para esta sesión */
  }
}

export interface MovableOptions {
  kind: PanelKind;
  /** Separación mínima con el borde del viewport (por defecto 8). */
  margin?: number;
  /** Se llama tras mover (pos) o restablecer (null); p. ej. para recolocar piezas anexas o volver a colocar. */
  onMoved?(pos: PanelPos | null): void;
  /** Almacenamiento alternativo (tests); null desactiva la persistencia. */
  storage?: StorageLike | null;
  /**
   * Fases del arrastre con puntero: `start` (antes de medir el panel), `move` (antes de colocarlo) y `end`.
   * Lo usa floating.ts para el fantasma, las zonas de anclaje y soltar en un borde.
   */
  onDrag?(phase: 'start' | 'move' | 'end', e: PointerEvent): void;
}

export interface Movable {
  /** Vuelve a la colocación automática y borra la posición guardada. */
  reset(): void;
  /** Quita todos los listeners y los atributos del asa. Idempotente. */
  destroy(): void;
  /** true si el usuario lo movió (o se restauró una posición guardada). */
  isMoved(): boolean;
  /** Posición actual si está movido; si no, null. */
  position(): PanelPos | null;
}

/**
 * Hace movible `panel` (position: fixed) arrastrando/usando el teclado en `handle`.
 * `handle` debe ser un elemento estable (no se repinta); su contenido puede cambiar.
 */
export function makeMovable(panel: HTMLElement, handle: HTMLElement, opts: MovableOptions): Movable {
  const doc = panel.ownerDocument;
  const win = doc.defaultView;
  const margin = opts.margin ?? DEFAULT_MARGIN;
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage;
  let pos: PanelPos | null = null;
  let dragging: { id: number; dx: number; dy: number } | null = null;
  let suppressClick = false;
  let gone = false;

  const offs: Array<() => void> = [];
  const on = (t: EventTarget, type: string, fn: (e: never) => void, o?: AddEventListenerOptions | boolean) => {
    t.addEventListener(type, fn as EventListener, o);
    offs.push(() => t.removeEventListener(type, fn as EventListener, o));
  };

  const viewport = (): PanelViewport => ({ width: win?.innerWidth ?? 0, height: win?.innerHeight ?? 0 });
  const size = (): PanelSize => {
    const r = panel.getBoundingClientRect();
    return { width: r.width, height: r.height };
  };
  const current = (): PanelPos => {
    const r = panel.getBoundingClientRect();
    return { left: r.left, top: r.top };
  };

  const apply = (p: PanelPos, persist: boolean) => {
    const vp = viewport();
    // Viewport desconocido (0): no recortar.
    pos = vp.width && vp.height ? clampPosition(p, size(), vp, margin) : p;
    panel.style.left = `${pos.left}px`;
    panel.style.top = `${pos.top}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    if (persist) savePosition(opts.kind, pos, storage);
    opts.onMoved?.(pos);
  };

  const reset = () => {
    pos = null;
    for (const side of ['left', 'top', 'right', 'bottom'] as const) panel.style[side] = '';
    savePosition(opts.kind, null, storage);
    opts.onMoved?.(null);
  };

  // --- Asa ------------------------------------------------------------------------------------
  handle.setAttribute(GRIP_ATTR, '');
  handle.setAttribute('tabindex', '0');
  handle.setAttribute('role', 'group');
  handle.setAttribute('aria-label', GRIP_LABEL);
  handle.setAttribute('aria-keyshortcuts', 'Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight Home');
  handle.title = 'Arrastra para mover · Alt+flechas · doble clic o Inicio restablece';
  handle.style.touchAction = 'none';
  handle.style.cursor = 'grab';
  handle.style.userSelect = 'none';

  const isControl = (e: Event) => {
    const t = (e.composedPath?.()[0] ?? e.target) as Element | null;
    const hit = t?.closest?.(INTERACTIVE);
    return !!hit && handle.contains(hit);
  };
  const swallow = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  };

  on(handle, 'pointerdown', (e: PointerEvent) => {
    if (gone || (e.pointerType === 'mouse' && e.button !== 0) || isControl(e)) return;
    swallow(e);
    suppressClick = false;
    opts.onDrag?.('start', e);
    const from = pos ?? current();
    dragging = { id: e.pointerId, dx: e.clientX - from.left, dy: e.clientY - from.top };
    try {
      handle.setPointerCapture?.(e.pointerId);
    } catch {
      /* puntero ya liberado */
    }
    handle.style.cursor = 'grabbing';
  });
  on(handle, 'pointermove', (e: PointerEvent) => {
    if (!dragging || e.pointerId !== dragging.id) return;
    swallow(e);
    suppressClick = true;
    opts.onDrag?.('move', e);
    apply({ left: e.clientX - dragging.dx, top: e.clientY - dragging.dy }, false);
  });
  const end = (e: PointerEvent) => {
    if (!dragging || e.pointerId !== dragging.id) return;
    swallow(e);
    dragging = null;
    handle.style.cursor = 'grab';
    try {
      handle.releasePointerCapture?.(e.pointerId);
    } catch {
      /* ya liberado */
    }
    if (pos) savePosition(opts.kind, pos, storage);
    opts.onDrag?.('end', e);
  };
  on(handle, 'pointerup', end);
  on(handle, 'pointercancel', end);
  // Tras arrastrar, el clic sintético no debe llegar a la página ni a nadie.
  on(
    handle,
    'click',
    (e: Event) => {
      if (suppressClick) {
        suppressClick = false;
        swallow(e);
      }
    },
    true,
  );
  on(handle, 'dblclick', (e: Event) => {
    if (isControl(e)) return;
    swallow(e);
    reset();
  });
  on(handle, 'keydown', (e: KeyboardEvent) => {
    // Solo con el foco en el asa; las teclas de los controles internos no se tocan.
    if (e.target !== handle && (e.composedPath?.()[0] ?? e.target) !== handle) return;
    if (e.key === 'Home' && !e.altKey && !e.ctrlKey && !e.metaKey) {
      swallow(e);
      reset();
      return;
    }
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    const step = e.shiftKey ? KEY_STEP_BIG : KEY_STEP;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d) return;
    swallow(e);
    e.stopImmediatePropagation();
    const base = pos ?? current();
    apply({ left: base.left + d[0]!, top: base.top + d[1]! }, true);
  });

  // --- Viewport -------------------------------------------------------------------------------
  const refit = () => {
    if (gone || !pos || dragging) return;
    const vp = viewport();
    if (!vp.width || !vp.height) return;
    const next = clampPosition(pos, size(), vp, margin);
    if (next.left !== pos.left || next.top !== pos.top) apply(next, true);
  };
  if (win) {
    on(win, 'resize', refit);
    on(win, 'scroll', refit, { passive: true });
  }

  // --- Posición guardada ----------------------------------------------------------------------
  const saved = loadPosition(opts.kind, storage);
  if (saved) apply(saved, false);

  return {
    reset,
    isMoved: () => pos !== null,
    position: () => (pos ? { ...pos } : null),
    destroy() {
      if (gone) return;
      gone = true;
      dragging = null;
      for (const f of offs) f();
      for (const a of [GRIP_ATTR, 'tabindex', 'role', 'aria-label', 'aria-keyshortcuts', 'title']) handle.removeAttribute(a);
      handle.style.touchAction = handle.style.cursor = handle.style.userSelect = '';
    },
  };
}

/** ¿El evento nace de un asa de panel? (Alt+flechas ahí son del panel, no navegación de elementos.) */
export function isGripEvent(e: Event): boolean {
  const t = (e.composedPath?.()[0] ?? e.target) as Element | null;
  return !!t?.hasAttribute?.(GRIP_ATTR);
}
