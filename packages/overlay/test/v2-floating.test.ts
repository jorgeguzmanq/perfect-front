// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SIZE, EDGE, MIN_SIZE, ZONE, clampSize, loadDock, makeFloating, nearEdge, saveDock, type Floating } from '../src/floating';
import { CSS } from '../src/styles';

const VP = { width: 1000, height: 800 };
const setViewport = (width: number, height: number) => {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true });
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true, writable: true });
};
const setRect = (el: HTMLElement, left: number, top: number, width = 300, height = 200) => {
  el.getBoundingClientRect = () => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} }) as DOMRect;
};
const pointer = (t: EventTarget, type: string, x: number, y: number) => {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(e, { clientX: { value: x }, clientY: { value: y }, pointerId: { value: 1 }, pointerType: { value: 'mouse' }, button: { value: 0 } });
  t.dispatchEvent(e);
};
const key = (t: EventTarget, k: string, mods: { ctrl?: boolean; alt?: boolean; shift?: boolean } = {}) => {
  const e = new KeyboardEvent('keydown', { key: k, ctrlKey: !!mods.ctrl, altKey: !!mods.alt, shiftKey: !!mods.shift, bubbles: true, cancelable: true });
  t.dispatchEvent(e);
  return e;
};
const memStorage = () => {
  const d = new Map<string, string>();
  return { getItem: (k: string) => d.get(k) ?? null, setItem: (k: string, v: string) => void d.set(k, v), removeItem: (k: string) => void d.delete(k), data: d };
};

let layer: HTMLElement;
let panel: HTMLElement;
let handle: HTMLElement;
let fl: Floating | null = null;
const storage = memStorage();
const onClose = vi.fn();
const onPanelReset = vi.fn();
const make = () => {
  fl = makeFloating(panel, handle, { kind: 'editor', layer, label: () => 'button.cta', onClose, onPanelReset, storage });
  return fl;
};

beforeEach(() => {
  setViewport(VP.width, VP.height);
  storage.data.clear();
  onClose.mockClear();
  onPanelReset.mockClear();
  layer = document.createElement('div');
  panel = document.createElement('div');
  handle = document.createElement('div');
  panel.appendChild(handle);
  layer.appendChild(panel);
  document.body.appendChild(layer);
  setRect(panel, 100, 100);
});
afterEach(() => {
  fl?.destroy();
  fl = null;
  document.body.innerHTML = '';
});

describe('helpers puros', () => {
  it('clampSize respeta mínimo y máximo por borde', () => {
    expect(clampSize('right', 10, VP)).toBe(MIN_SIZE.right);
    expect(clampSize('right', 5000, VP)).toBe(720);
    expect(clampSize('right', 400, VP)).toBe(400);
    expect(clampSize('bottom', 5000, VP)).toBe(560);
    expect(clampSize('bottom', 100, VP)).toBe(MIN_SIZE.bottom);
  });

  it('nearEdge elige el borde más cercano dentro del umbral', () => {
    expect(nearEdge(500, 400, VP, ZONE)).toBeNull();
    expect(nearEdge(950, 400, VP, ZONE)).toBe('right');
    expect(nearEdge(400, 770, VP, ZONE)).toBe('bottom');
    expect(nearEdge(990, 790, VP, ZONE)).toBe('right');
    expect(nearEdge(900, 400, VP, EDGE)).toBeNull();
  });

  it('loadDock/saveDock sobreviven a JSON inválido y a un almacenamiento que lanza', () => {
    expect(loadDock('editor', null)).toEqual({ anchor: null, ...DEFAULT_SIZE });
    const bad = { getItem: () => '{no', setItem() {}, removeItem() {} };
    expect(loadDock('editor', bad).anchor).toBeNull();
    const boom = {
      getItem: () => {
        throw new Error('x');
      },
      setItem: () => {
        throw new Error('x');
      },
      removeItem() {},
    };
    expect(loadDock('editor', boom).anchor).toBeNull();
    expect(() => saveDock('editor', { anchor: 'right', right: 300, bottom: 300 }, boom)).not.toThrow();
  });
});

describe('anclaje', () => {
  it('anclar a la derecha marca el panel, crea el borde accesible y evita la recolocación automática', () => {
    const f = make();
    expect(f.movable.isMoved()).toBe(false);
    f.setAnchor('right');
    expect(panel.getAttribute('data-pf-anchor')).toBe('right');
    expect(panel.classList.contains('pf-dk-fl--right')).toBe(true);
    expect(panel.style.getPropertyValue('--pf-fl-size')).toBe('360px');
    expect(f.movable.isMoved()).toBe(true);
    const edge = layer.querySelector<HTMLElement>('.pf-dk-fl-edge')!;
    expect(edge.getAttribute('role')).toBe('separator');
    expect(edge.getAttribute('aria-orientation')).toBe('vertical');
    expect(edge.tabIndex).toBe(0);
    expect(JSON.parse(storage.data.get('perfect-front:panel-dock:editor')!).anchor).toBe('right');
  });

  it('el borde cambia el ancho con el teclado y con el puntero y lo recuerda', () => {
    const f = make();
    f.setAnchor('right');
    const edge = layer.querySelector<HTMLElement>('.pf-dk-fl-edge')!;
    key(edge, 'ArrowLeft');
    expect(f.size()).toBe(376);
    key(edge, 'ArrowRight', { shift: true });
    expect(f.size()).toBe(312);
    pointer(edge, 'pointerdown', 640, 300);
    pointer(edge, 'pointermove', 600, 300);
    expect(f.size()).toBe(400);
    pointer(edge, 'pointermove', 100, 300);
    expect(f.size()).toBe(720);
    pointer(edge, 'pointerup', 100, 300);
    expect(JSON.parse(storage.data.get('perfect-front:panel-dock:editor')!).right).toBe(720);
    f.destroy();
    fl = null;
    const again = make();
    expect(again.anchor()).toBe('right');
    expect(again.size()).toBe(720);
    expect(panel.getAttribute('data-pf-anchor')).toBe('right');
  });

  it('anclar abajo y soltar con el teclado (Ctrl+Alt+flechas) devuelve la colocación automática', () => {
    const f = make();
    key(handle, 'ArrowDown', { ctrl: true, alt: true });
    expect(f.anchor()).toBe('bottom');
    expect(layer.querySelector('.pf-dk-fl-edge')!.getAttribute('aria-orientation')).toBe('horizontal');
    key(handle, 'ArrowLeft', { ctrl: true, alt: true });
    expect(f.anchor()).toBeNull();
    expect(panel.hasAttribute('data-pf-anchor')).toBe(false);
    expect(layer.querySelector('.pf-dk-fl-edge')).toBeNull();
    expect(onPanelReset).toHaveBeenCalled();
    expect(f.movable.isMoved()).toBe(false);
  });

  it('arrastrar: aparecen fantasma y zonas, y soltar en el borde ancla', () => {
    const f = make();
    pointer(handle, 'pointerdown', 150, 110);
    pointer(handle, 'pointermove', 800, 300);
    expect(panel.classList.contains('pf-dk-fl--drag')).toBe(true);
    expect(layer.querySelector('.pf-dk-fl-ghost')).not.toBeNull();
    const right = layer.querySelector<HTMLElement>('.pf-dk-fl-zone--right')!;
    expect(right.hidden).toBe(true);
    pointer(handle, 'pointermove', 930, 300);
    expect(right.hidden).toBe(false);
    expect(right.classList.contains('pf-dk-fl-zone--hot')).toBe(false);
    pointer(handle, 'pointermove', 980, 300);
    expect(right.classList.contains('pf-dk-fl-zone--hot')).toBe(true);
    pointer(handle, 'pointerup', 980, 300);
    expect(f.anchor()).toBe('right');
    expect(layer.querySelector('.pf-dk-fl-ghost')).toBeNull();
    expect(layer.querySelector('.pf-dk-fl-zone')).toBeNull();
    expect(panel.classList.contains('pf-dk-fl--drag')).toBe(false);
  });

  it('soltar lejos de los bordes no ancla; arrastrar un panel anclado lo suelta', () => {
    const f = make();
    pointer(handle, 'pointerdown', 150, 110);
    pointer(handle, 'pointermove', 400, 300);
    pointer(handle, 'pointerup', 400, 300);
    expect(f.anchor()).toBeNull();
    f.setAnchor('right');
    pointer(handle, 'pointerdown', 700, 20);
    pointer(handle, 'pointermove', 500, 200);
    expect(f.anchor()).toBeNull();
    pointer(handle, 'pointerup', 500, 200);
    expect(f.anchor()).toBeNull();
  });

  it('un clic sin mover no crea fantasma ni ancla', () => {
    const f = make();
    pointer(handle, 'pointerdown', 150, 110);
    pointer(handle, 'pointerup', 990, 110);
    expect(f.anchor()).toBeNull();
    expect(layer.querySelector('.pf-dk-fl-ghost')).toBeNull();
  });
});

describe('minimizar al dock', () => {
  it('Enter en la cabecera minimiza a una píldora con el nodo y mueve el foco; restaurar lo devuelve a la cabecera', () => {
    const f = make();
    handle.focus();
    const e = key(handle, 'Enter');
    expect(e.defaultPrevented).toBe(true);
    expect(f.minimized()).toBe(true);
    expect(panel.hasAttribute('data-pf-min')).toBe(true);
    const pill = layer.querySelector<HTMLElement>('.pf-dk-fl-pill')!;
    expect(pill.getAttribute('role')).toBe('region');
    expect(pill.textContent).toContain('Panel minimizado · button.cta');
    const restore = pill.querySelector<HTMLButtonElement>('button')!;
    expect(restore.getAttribute('aria-label')).toBe('Restaurar panel');
    expect(document.activeElement).toBe(restore);
    restore.click();
    expect(f.minimized()).toBe(false);
    expect(layer.querySelector('.pf-dk-fl-pill')).toBeNull();
    expect(panel.hasAttribute('data-pf-min')).toBe(false);
    expect(document.activeElement).toBe(handle);
  });

  it('Espacio también minimiza; Esc sobre la píldora cierra; los controles de la cabecera no minimizan', () => {
    const f = make();
    const btn = document.createElement('button');
    handle.appendChild(btn);
    key(btn, 'Enter');
    expect(f.minimized()).toBe(false);
    key(handle, ' ');
    expect(f.minimized()).toBe(true);
    key(layer.querySelector('.pf-dk-fl-pill button')!, 'Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('minimizado el borde de un panel anclado se oculta y al restaurar vuelve', () => {
    const f = make();
    f.setAnchor('bottom');
    f.setMinimized(true);
    expect(layer.querySelector<HTMLElement>('.pf-dk-fl-edge')!.hidden).toBe(true);
    f.setMinimized(false);
    expect(layer.querySelector<HTMLElement>('.pf-dk-fl-edge')!.hidden).toBe(false);
  });

  it('destroy limpia píldora, borde, atributos y listeners', () => {
    const f = make();
    f.setAnchor('right');
    f.setMinimized(true);
    f.destroy();
    fl = null;
    expect(layer.querySelector('.pf-dk-fl-pill')).toBeNull();
    expect(layer.querySelector('.pf-dk-fl-edge')).toBeNull();
    expect(panel.hasAttribute('data-pf-anchor')).toBe(false);
    expect(panel.hasAttribute('data-pf-min')).toBe(false);
    key(handle, 'Enter');
    expect(layer.querySelector('.pf-dk-fl-pill')).toBeNull();
  });
});

describe('orden de apilado', () => {
  it('lo define un solo módulo: marcas < panel < barra, y host de pines < overlay < lanzador', () => {
    const num = (re: RegExp) => Number(CSS.match(re)?.[1]);
    expect(num(/--pf-zf-marks:\s*(\d+)/)).toBeLessThan(num(/--pf-zf-panel:\s*(\d+)/));
    expect(num(/--pf-zf-panel:\s*(\d+)/)).toBeLessThan(num(/--pf-zf-bar:\s*(\d+)/));
    expect(CSS).toMatch(/:host\(\[data-perfect-front-pins\]\)\s*\{\s*z-index:\s*var\(--pf-z-overlay\)/);
    expect(CSS).toMatch(/:host\(\[data-perfect-front-overlay\]\)\s*\{\s*z-index:\s*calc\(var\(--pf-z-overlay\) \+ 1\)/);
    expect(CSS).toMatch(/:host\(\[data-perfect-front-launcher\]\)\s*\{\s*z-index:\s*calc\(var\(--pf-z-overlay\) \+ 2\)/);
  });
});
