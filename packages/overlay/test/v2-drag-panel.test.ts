// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GRIP_ATTR,
  GRIP_LABEL,
  KEY_STEP,
  KEY_STEP_BIG,
  clampPosition,
  isGripEvent,
  makeMovable,
  type Movable,
  type PanelKind,
} from '../src/drag-panel';

/* ------------------------------------------------------------------ helpers */

const VP_W = 1000;
const VP_H = 800;

function setViewport(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true });
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true, writable: true });
}

/** getBoundingClientRect con valores fijos (happy-dom no hace layout). */
function setRect(el: HTMLElement, r: { left: number; top: number; width?: number; height?: number }): void {
  const width = r.width ?? 200;
  const height = r.height ?? 100;
  el.getBoundingClientRect = () =>
    ({
      left: r.left,
      top: r.top,
      width,
      height,
      right: r.left + width,
      bottom: r.top + height,
      x: r.left,
      y: r.top,
      toJSON() {
        return this;
      },
    }) as DOMRect;
}

interface PtrOpts {
  pointerId?: number;
  pointerType?: string;
  button?: number;
}

function pointer(target: EventTarget, type: string, x: number, y: number, o: PtrOpts = {}): Event {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(e, {
    clientX: { value: x },
    clientY: { value: y },
    pointerId: { value: o.pointerId ?? 1 },
    pointerType: { value: o.pointerType ?? 'mouse' },
    button: { value: o.button ?? 0 },
  });
  target.dispatchEvent(e);
  return e;
}

function key(target: EventTarget, k: string, mods: { alt?: boolean; shift?: boolean; ctrl?: boolean; meta?: boolean } = {}): KeyboardEvent {
  const e = new KeyboardEvent('keydown', {
    key: k,
    altKey: !!mods.alt,
    shiftKey: !!mods.shift,
    ctrlKey: !!mods.ctrl,
    metaKey: !!mods.meta,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(e);
  return e;
}

function memStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: vi.fn((k: string) => data.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => {
      data.set(k, v);
    }),
    removeItem: vi.fn((k: string) => {
      data.delete(k);
    }),
  };
}

const throwingStorage = () => ({
  getItem: (): string | null => {
    throw new Error('getItem bloqueado');
  },
  setItem: (): void => {
    throw new Error('setItem bloqueado');
  },
  removeItem: (): void => {
    throw new Error('removeItem bloqueado');
  },
});

/* -------------------------------------------------------------------- setup */

let panel: HTMLDivElement;
let handle: HTMLDivElement;
let button: HTMLButtonElement;
const movables: Movable[] = [];

function mount(kind: PanelKind = 'editor', opts: { storage?: ReturnType<typeof memStorage> | ReturnType<typeof throwingStorage> | null; onMoved?: (p: unknown) => void; margin?: number } = {}): Movable {
  const m = makeMovable(panel, handle, {
    kind,
    storage: opts.storage === undefined ? memStorage() : opts.storage,
    ...(opts.onMoved ? { onMoved: opts.onMoved } : {}),
    ...(opts.margin !== undefined ? { margin: opts.margin } : {}),
  });
  movables.push(m);
  return m;
}

beforeEach(() => {
  setViewport(VP_W, VP_H);
  document.body.innerHTML = '';
  panel = document.createElement('div');
  handle = document.createElement('div');
  button = document.createElement('button');
  button.textContent = 'Cerrar';
  handle.appendChild(button);
  panel.appendChild(handle);
  document.body.appendChild(panel);
  setRect(panel, { left: 100, top: 100, width: 200, height: 100 });
  handle.setPointerCapture = vi.fn();
  handle.releasePointerCapture = vi.fn();
});

afterEach(() => {
  for (const m of movables.splice(0)) m.destroy();
  vi.restoreAllMocks();
});

/* -------------------------------------------------------------- arrastre */

describe('arrastre con punteros', () => {
  it('pointerdown/move/up mueve el panel conservando el desfase del agarre', () => {
    const m = mount();
    pointer(handle, 'pointerdown', 110, 105);
    expect(handle.setPointerCapture).toHaveBeenCalledWith(1);

    pointer(handle, 'pointermove', 210, 155);
    expect(panel.style.left).toBe('200px');
    expect(panel.style.top).toBe('150px');
    expect(panel.style.right).toBe('auto');
    expect(panel.style.bottom).toBe('auto');

    pointer(handle, 'pointerup', 210, 155);
    expect(handle.releasePointerCapture).toHaveBeenCalledWith(1);
    expect(m.isMoved()).toBe(true);
    expect(m.position()).toEqual({ left: 200, top: 150 });
  });

  it('tras arrastrar, el clic sintético se cancela', () => {
    mount();
    pointer(handle, 'pointerdown', 110, 105);
    pointer(handle, 'pointermove', 150, 150);
    pointer(handle, 'pointerup', 150, 150);
    const click = new Event('click', { bubbles: true, cancelable: true });
    handle.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
  });

  it('ignora movimientos de otro pointerId y los que llegan sin arrastre previo', () => {
    const m = mount();
    pointer(handle, 'pointermove', 300, 300);
    expect(m.isMoved()).toBe(false);

    pointer(handle, 'pointerdown', 110, 105, { pointerId: 1 });
    pointer(handle, 'pointermove', 400, 400, { pointerId: 2 });
    expect(panel.style.left).toBe('');
    pointer(handle, 'pointerup', 400, 400, { pointerId: 2 });
    pointer(handle, 'pointermove', 210, 155, { pointerId: 1 });
    expect(panel.style.left).toBe('200px');
  });

  it('botón secundario del ratón no inicia el arrastre', () => {
    const m = mount();
    const e = pointer(handle, 'pointerdown', 110, 105, { button: 2 });
    expect(e.defaultPrevented).toBe(false);
    pointer(handle, 'pointermove', 210, 155);
    expect(m.isMoved()).toBe(false);
  });
});

describe('controles de la cabecera', () => {
  it('un pointerdown sobre un botón del asa no inicia el arrastre', () => {
    const m = mount();
    const down = pointer(button, 'pointerdown', 110, 105);
    expect(down.defaultPrevented).toBe(false);
    expect(handle.setPointerCapture).not.toHaveBeenCalled();

    pointer(handle, 'pointermove', 210, 155);
    expect(m.isMoved()).toBe(false);
    expect(panel.style.left).toBe('');
  });

  it('un doble clic sobre un botón del asa no restablece', () => {
    const m = mount();
    pointer(handle, 'pointerdown', 110, 105);
    pointer(handle, 'pointermove', 150, 150);
    pointer(handle, 'pointerup', 150, 150);
    expect(m.isMoved()).toBe(true);

    button.dispatchEvent(new Event('dblclick', { bubbles: true, cancelable: true }));
    expect(m.isMoved()).toBe(true);
  });
});

/* ------------------------------------------------------------------ clamp */

describe('clampPosition (puro)', () => {
  const size = { width: 200, height: 100 };
  const vp = { width: VP_W, height: VP_H };

  it('recorta con margen por defecto en los 4 bordes', () => {
    expect(clampPosition({ left: -50, top: -50 }, size, vp)).toEqual({ left: 8, top: 8 });
    expect(clampPosition({ left: 5000, top: 5000 }, size, vp)).toEqual({ left: VP_W - 200 - 8, top: VP_H - 100 - 8 });
  });

  it('respeta el margen indicado en cada borde', () => {
    expect(clampPosition({ left: -5, top: -5 }, size, vp, 20)).toEqual({ left: 20, top: 20 });
    expect(clampPosition({ left: 900, top: 750 }, size, vp, 20)).toEqual({ left: VP_W - 200 - 20, top: VP_H - 100 - 20 });
  });

  it('no toca posiciones ya válidas', () => {
    expect(clampPosition({ left: 300, top: 200 }, size, vp)).toEqual({ left: 300, top: 200 });
  });

  it('viewport más pequeño que el panel: prima el borde de origen', () => {
    expect(clampPosition({ left: 500, top: 500 }, size, { width: 150, height: 80 })).toEqual({ left: 8, top: 8 });
  });
});

describe('recorte durante el arrastre', () => {
  it('un arrastre fuera del viewport queda recortado al margen', () => {
    const m = mount();
    pointer(handle, 'pointerdown', 110, 105);
    pointer(handle, 'pointermove', 5000, 5000);
    expect(panel.style.left).toBe(`${VP_W - 200 - 8}px`);
    expect(panel.style.top).toBe(`${VP_H - 100 - 8}px`);
    expect(m.position()).toEqual({ left: VP_W - 208, top: VP_H - 108 });
  });
});

/* ----------------------------------------------------------------- resize */

describe('recolocación tras resize', () => {
  it('si el viewport se encoge, el panel vuelve a quedar dentro', () => {
    const onMoved = vi.fn();
    const m = mount('editor', { onMoved });
    pointer(handle, 'pointerdown', 110, 105);
    pointer(handle, 'pointermove', 410, 105);
    pointer(handle, 'pointerup', 410, 105);
    expect(m.position()).toEqual({ left: 400, top: 100 });

    setViewport(450, VP_H);
    window.dispatchEvent(new Event('resize'));
    expect(panel.style.left).toBe(`${450 - 200 - 8}px`);
    expect(m.position()).toEqual({ left: 242, top: 100 });
    expect(onMoved).toHaveBeenLastCalledWith({ left: 242, top: 100 });
  });

  it('un resize sin posición manual no altera el panel', () => {
    const m = mount();
    setViewport(300, 200);
    window.dispatchEvent(new Event('resize'));
    expect(m.isMoved()).toBe(false);
    expect(panel.style.left).toBe('');
  });
});

/* --------------------------------------------------------------- teclado */

describe('teclado con el foco en el asa', () => {
  it('Alt+flecha mueve KEY_STEP (16 px) desde la colocación automática', () => {
    expect(KEY_STEP).toBe(16);
    const m = mount();
    key(handle, 'ArrowRight', { alt: true });
    expect(panel.style.left).toBe(`${100 + KEY_STEP}px`);
    expect(panel.style.top).toBe('100px');
    expect(m.isMoved()).toBe(true);
  });

  it('las cuatro flechas se aplican en su eje', () => {
    const m = mount();
    key(handle, 'ArrowRight', { alt: true });
    key(handle, 'ArrowDown', { alt: true });
    key(handle, 'ArrowLeft', { alt: true });
    key(handle, 'ArrowUp', { alt: true });
    expect(m.position()).toEqual({ left: 100, top: 100 });
    key(handle, 'ArrowUp', { alt: true });
    expect(m.position()).toEqual({ left: 100, top: 100 - KEY_STEP });
  });

  it('Mayús+Alt+flecha mueve KEY_STEP_BIG (64 px)', () => {
    expect(KEY_STEP_BIG).toBe(64);
    const m = mount();
    key(handle, 'ArrowDown', { alt: true, shift: true });
    expect(m.position()).toEqual({ left: 100, top: 100 + KEY_STEP_BIG });
  });

  it('Alt+flecha con Ctrl o Meta no mueve', () => {
    const m = mount();
    key(handle, 'ArrowRight', { alt: true, ctrl: true });
    key(handle, 'ArrowRight', { alt: true, meta: true });
    expect(m.isMoved()).toBe(false);
  });

  it('una flecha sin Alt no mueve el panel', () => {
    const m = mount();
    const e = key(handle, 'ArrowRight');
    expect(e.defaultPrevented).toBe(false);
    expect(m.isMoved()).toBe(false);
  });

  it('las teclas lanzadas desde un control interno del asa no mueven el panel', () => {
    const m = mount();
    key(button, 'ArrowRight', { alt: true });
    expect(m.isMoved()).toBe(false);
  });

  it('Alt+flecha consume el evento', () => {
    mount();
    const e = key(handle, 'ArrowLeft', { alt: true });
    expect(e.defaultPrevented).toBe(true);
  });

  it('Inicio restablece la colocación automática', () => {
    const storage = memStorage();
    const onMoved = vi.fn();
    const m = mount('editor', { storage, onMoved });
    key(handle, 'ArrowRight', { alt: true });
    expect(m.isMoved()).toBe(true);

    key(handle, 'Home');
    expect(m.isMoved()).toBe(false);
    expect(m.position()).toBeNull();
    expect(panel.style.left).toBe('');
    expect(panel.style.top).toBe('');
    expect(onMoved).toHaveBeenLastCalledWith(null);
    expect(storage.removeItem).toHaveBeenCalledWith('perfect-front:panel-pos:editor');
  });

  it('doble clic en el asa restablece la colocación automática', () => {
    const m = mount();
    key(handle, 'ArrowRight', { alt: true });
    handle.dispatchEvent(new Event('dblclick', { bubbles: true, cancelable: true }));
    expect(m.isMoved()).toBe(false);
    expect(panel.style.left).toBe('');
  });

  it('reset() vuelve a la colocación automática y borra la posición guardada', () => {
    const storage = memStorage();
    const m = mount('drawer', { storage });
    key(handle, 'ArrowDown', { alt: true });
    expect(storage.data.has('perfect-front:panel-pos:drawer')).toBe(true);
    m.reset();
    expect(m.isMoved()).toBe(false);
    expect(storage.data.has('perfect-front:panel-pos:drawer')).toBe(false);
  });

  it('position() devuelve una copia', () => {
    const m = mount();
    key(handle, 'ArrowRight', { alt: true });
    const p = m.position();
    p!.left = -999;
    expect(m.position()).toEqual({ left: 100 + KEY_STEP, top: 100 });
  });
});

/* ------------------------------------------------------------ accesibilidad */

describe('atributos del asa', () => {
  it('aria-label «Mover panel», tabindex y marca de asa', () => {
    mount();
    expect(handle.getAttribute('aria-label')).toBe(GRIP_LABEL);
    expect(GRIP_LABEL).toBe('Mover panel');
    expect(handle.getAttribute('tabindex')).toBe('0');
    expect(handle.hasAttribute(GRIP_ATTR)).toBe(true);
    expect(handle.getAttribute('aria-keyshortcuts')).toContain('Alt+ArrowUp');
  });

  it('isGripEvent reconoce eventos nacidos en el asa y no en el resto', () => {
    mount();
    const onHandle = key(handle, 'ArrowRight', { alt: true });
    expect(isGripEvent(onHandle)).toBe(true);
    const onButton = key(button, 'ArrowRight', { alt: true });
    expect(isGripEvent(onButton)).toBe(false);
    const outside = key(document.body, 'ArrowRight', { alt: true });
    expect(isGripEvent(outside)).toBe(false);
  });
});

/* -------------------------------------------------------------- persistencia */

describe('persistencia por tipo', () => {
  it('al soltar tras arrastrar se guarda con la clave del tipo y coordenadas redondeadas', () => {
    const storage = memStorage();
    mount('launcher', { storage });
    pointer(handle, 'pointerdown', 110, 105);
    pointer(handle, 'pointermove', 210.4, 155.6);
    pointer(handle, 'pointerup', 210.4, 155.6);
    expect(storage.setItem).toHaveBeenCalledWith('perfect-front:panel-pos:launcher', JSON.stringify({ left: 200, top: 151 }));
  });

  it('restaura la posición guardada del mismo tipo al crear el panel', () => {
    const storage = memStorage();
    storage.data.set('perfect-front:panel-pos:launcher', JSON.stringify({ left: 50, top: 60 }));
    const m = mount('launcher', { storage });
    expect(m.isMoved()).toBe(true);
    expect(m.position()).toEqual({ left: 50, top: 60 });
    expect(panel.style.left).toBe('50px');
    expect(panel.style.top).toBe('60px');
  });

  it('cada tipo usa su propia clave: editor no lee la posición de drawer', () => {
    const storage = memStorage();
    storage.data.set('perfect-front:panel-pos:drawer', JSON.stringify({ left: 50, top: 60 }));
    const m = mount('editor', { storage });
    expect(m.isMoved()).toBe(false);
    expect(storage.getItem).toHaveBeenCalledWith('perfect-front:panel-pos:editor');
  });

  it('los tres tipos guardan en claves distintas', () => {
    const storage = memStorage();
    const kinds: PanelKind[] = ['editor', 'drawer', 'launcher'];
    for (const kind of kinds) {
      const m = mount(kind, { storage });
      key(handle, 'ArrowRight', { alt: true });
      m.destroy();
    }
    expect([...storage.data.keys()].sort()).toEqual([
      'perfect-front:panel-pos:drawer',
      'perfect-front:panel-pos:editor',
      'perfect-front:panel-pos:launcher',
    ]);
  });

  it('una posición guardada inválida se ignora', () => {
    const storage = memStorage();
    storage.data.set('perfect-front:panel-pos:editor', 'no es json');
    const m = mount('editor', { storage });
    expect(m.isMoved()).toBe(false);
  });

  it('un storage que lanza no rompe la creación, el arrastre ni el restablecimiento', () => {
    expect(() => mount('editor', { storage: throwingStorage() })).not.toThrow();
    const m = movables[movables.length - 1]!;
    expect(() => {
      pointer(handle, 'pointerdown', 110, 105);
      pointer(handle, 'pointermove', 210, 155);
      pointer(handle, 'pointerup', 210, 155);
    }).not.toThrow();
    expect(m.position()).toEqual({ left: 200, top: 150 });
    expect(() => key(handle, 'Home')).not.toThrow();
    expect(m.isMoved()).toBe(false);
  });

  it('storage null: el panel se mueve sin persistir', () => {
    const m = mount('editor', { storage: null });
    key(handle, 'ArrowRight', { alt: true });
    expect(m.isMoved()).toBe(true);
    expect(() => key(handle, 'Home')).not.toThrow();
  });
});

/* -------------------------------------------------------------------- destroy */

describe('destroy libera listeners', () => {
  it('cada addEventListener de makeMovable tiene su removeEventListener equivalente', () => {
    const addSpy = vi.spyOn(handle, 'addEventListener');
    const winAddSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(handle, 'removeEventListener');
    const winRemoveSpy = vi.spyOn(window, 'removeEventListener');

    const m = mount();
    m.destroy();

    const adds = [...addSpy.mock.calls.map((c) => ['handle', ...c] as const), ...winAddSpy.mock.calls.map((c) => ['window', ...c] as const)];
    const removes = [...removeSpy.mock.calls.map((c) => ['handle', ...c] as const), ...winRemoveSpy.mock.calls.map((c) => ['window', ...c] as const)];
    expect(adds.length).toBeGreaterThan(0);
    for (const [target, type, fn] of adds) {
      const match = removes.find(([t, rt, rf]) => t === target && rt === type && rf === fn);
      expect(match, `sin removeEventListener para ${target}:${type}`).toBeDefined();
    }
  });

  it('tras destroy, los eventos ya no mueven ni restablecen el panel', () => {
    const m = mount();
    m.destroy();
    pointer(handle, 'pointerdown', 110, 105);
    pointer(handle, 'pointermove', 210, 155);
    expect(panel.style.left).toBe('');
    key(handle, 'ArrowRight', { alt: true });
    expect(m.isMoved()).toBe(false);
    setViewport(300, 200);
    window.dispatchEvent(new Event('resize'));
    expect(panel.style.left).toBe('');
  });

  it('retira los atributos del asa', () => {
    const m = mount();
    m.destroy();
    expect(handle.hasAttribute(GRIP_ATTR)).toBe(false);
    expect(handle.getAttribute('aria-label')).toBeNull();
    expect(handle.getAttribute('tabindex')).toBeNull();
    expect(handle.getAttribute('role')).toBeNull();
    expect(handle.getAttribute('aria-keyshortcuts')).toBeNull();
    expect(handle.title).toBe('');
  });

  it('destroy es idempotente', () => {
    const removeSpy = vi.spyOn(handle, 'removeEventListener');
    const m = mount();
    m.destroy();
    const count = removeSpy.mock.calls.length;
    expect(() => m.destroy()).not.toThrow();
    expect(removeSpy.mock.calls.length).toBe(count);
  });
});

/* ------------------------------------------------------------- onMoved */

describe('onMoved', () => {
  it('se llama con la posición al mover y con null al restablecer', () => {
    const onMoved = vi.fn();
    mount('editor', { onMoved });
    key(handle, 'ArrowRight', { alt: true });
    expect(onMoved).toHaveBeenLastCalledWith({ left: 100 + KEY_STEP, top: 100 });
    key(handle, 'Home');
    expect(onMoved).toHaveBeenLastCalledWith(null);
  });
});
