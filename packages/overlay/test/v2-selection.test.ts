// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { ExtraTargetSchema, LIMITS } from '@perfect-front/shared';
import { MAX_NODES, Selection } from '../src/selection';

/** Crea `n` botones con id `b0..bN` dentro de un contenedor; devuelve los elementos. */
function makeButtons(n: number, extraAttr?: Record<number, string>): Element[] {
  const host = document.createElement('div');
  host.id = 'host';
  for (let i = 0; i < n; i++) {
    const b = document.createElement('button');
    b.id = `b${i}`;
    b.textContent = `Botón ${i}`;
    if (extraAttr?.[i]) b.setAttribute('data-pf-src', extraAttr[i]!);
    host.appendChild(b);
  }
  document.body.appendChild(host);
  return Array.from(host.children);
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('Selection: básicos', () => {
  it('el máximo es el principal + LIMITS.extraTargets', () => {
    expect(MAX_NODES).toBe(1 + LIMITS.extraTargets);
  });

  it('set reemplaza toda la selección por un nodo con snapshot', () => {
    const [a, b] = makeButtons(2);
    const s = new Selection();
    s.add(b!);
    s.set(a!);
    expect(s.size).toBe(1);
    expect(s.multi).toBe(false);
    expect(s.focus!.el).toBe(a);
    expect(s.focus!.snap.selector).toBeTruthy();
    expect(s.focusIndex).toBe(0);
  });

  it('clear vacía la selección y no hay foco', () => {
    const [a] = makeButtons(1);
    const s = new Selection();
    s.set(a!);
    s.clear();
    expect(s.size).toBe(0);
    expect(s.focus).toBeNull();
  });

  it('setFocus ignora índices fuera de rango', () => {
    const [a, b] = makeButtons(2);
    const s = new Selection();
    s.add(a!);
    s.add(b!);
    s.setFocus(5);
    expect(s.focusIndex).toBe(1);
    s.setFocus(0);
    expect(s.focus!.el).toBe(a);
  });
});

describe('Selection: multiselección', () => {
  it('add suma un nodo y lo enfoca; repetido o ya presente devuelve false', () => {
    const [a, b] = makeButtons(2);
    const s = new Selection();
    s.set(a!);
    expect(s.add(b!)).toBe(true);
    expect(s.multi).toBe(true);
    expect(s.focus!.el).toBe(b);
    expect(s.add(b!)).toBe(false);
    expect(s.size).toBe(2);
  });

  it('tope de MAX_NODES: el elemento número 21 no entra', () => {
    const els = makeButtons(MAX_NODES + 1);
    const s = new Selection();
    s.set(els[0]!);
    for (const el of els.slice(1, MAX_NODES)) expect(s.add(el)).toBe(true);
    expect(s.size).toBe(MAX_NODES);
    expect(s.add(els[MAX_NODES]!)).toBe(false);
    expect(s.size).toBe(MAX_NODES);
  });

  it('toggle quita si ya estaba, suma si no, y no deja la selección vacía', () => {
    const [a, b] = makeButtons(2);
    const s = new Selection();
    s.set(a!);
    expect(s.toggle(b!)).toBe('added');
    expect(s.toggle(b!)).toBe('removed');
    expect(s.toggle(a!)).toBe('kept');
    expect(s.size).toBe(1);
  });

  it('toggle devuelve «full» cuando ya se llegó al máximo', () => {
    const els = makeButtons(MAX_NODES + 1);
    const s = new Selection();
    s.set(els[0]!);
    for (const el of els.slice(1, MAX_NODES)) s.add(el);
    expect(s.toggle(els[MAX_NODES]!)).toBe('full');
  });

  it('remove ajusta el foco cuando se quita un nodo anterior a él', () => {
    const [a, b, c] = makeButtons(3);
    const s = new Selection();
    s.set(a!);
    s.add(b!);
    s.add(c!);
    expect(s.focusIndex).toBe(2);
    expect(s.remove(0)).toBe(true);
    expect(s.focusIndex).toBe(1);
    expect(s.focus!.el).toBe(c);
  });

  it('remove del foco al final desplaza el foco al nuevo último', () => {
    const [a, b] = makeButtons(2);
    const s = new Selection();
    s.set(a!);
    s.add(b!);
    expect(s.remove(1)).toBe(true);
    expect(s.focusIndex).toBe(0);
    expect(s.focus!.el).toBe(a);
  });

  it('remove no quita el último nodo ni índices inválidos', () => {
    const [a] = makeButtons(1);
    const s = new Selection();
    s.set(a!);
    expect(s.remove(0)).toBe(false);
    expect(s.remove(7)).toBe(false);
    expect(s.size).toBe(1);
  });
});

describe('Selection: navegación (retarget)', () => {
  it('retarget reemplaza el nodo enfocado sin sumar', () => {
    const [a, b, c] = makeButtons(3);
    const s = new Selection();
    s.set(a!);
    s.add(b!);
    s.retarget(c!);
    expect(s.size).toBe(2);
    expect(s.nodes.map((n) => n.el)).toEqual([a, c]);
  });

  it('retarget sobre selección vacía crea el nodo', () => {
    const [a] = makeButtons(1);
    const s = new Selection();
    s.retarget(a!);
    expect(s.size).toBe(1);
    expect(s.focus!.el).toBe(a);
  });
});

describe('Selection: extraTargets', () => {
  it('el principal no viaja como extra; el resto sí, validados por ExtraTargetSchema', () => {
    const [a, b, c] = makeButtons(3, { 1: 'src/App.tsx:12' });
    const s = new Selection();
    s.set(a!);
    s.add(b!);
    s.add(c!);
    const extras = s.toExtraTargets();
    expect(extras).toHaveLength(2);
    expect(extras[0]!.selector).toBe(s.nodes[1]!.snap.selector);
    expect(extras[0]!.id.startsWith('t-')).toBe(true);
    for (const x of extras) expect(ExtraTargetSchema.safeParse(x).success).toBe(true);
  });

  it('toma el archivo:línea de data-pf-src como source, sin columna si no la hay', () => {
    const [a, b] = makeButtons(2, { 1: 'src/App.tsx:12' });
    const s = new Selection();
    s.set(a!);
    s.add(b!);
    const [x] = s.toExtraTargets();
    expect(x!.source).toEqual({ file: 'src/App.tsx', line: 12 });
  });

  it('sin data-pf-src no incluye la clave source', () => {
    const [a, b] = makeButtons(2);
    const s = new Selection();
    s.set(a!);
    s.add(b!);
    const [x] = s.toExtraTargets();
    expect('source' in x!).toBe(false);
  });

  it('los ids de los extras no colisionan con los ya tomados', () => {
    const [a, b, c] = makeButtons(3);
    const s = new Selection();
    s.set(a!);
    s.add(b!);
    s.add(c!);
    const first = s.toExtraTargets();
    const taken = new Set(first.map((x) => x.id));
    const again = s.toExtraTargets(taken);
    for (const x of again) expect(taken.has(x.id)).toBe(false);
  });

  it('con un solo nodo no hay extras', () => {
    const [a] = makeButtons(1);
    const s = new Selection();
    s.set(a!);
    expect(s.toExtraTargets()).toEqual([]);
  });
});

describe('Selection: refresh', () => {
  it('refresh conserva los elementos y el orden', () => {
    const [a, b] = makeButtons(2);
    const s = new Selection();
    s.set(a!);
    s.add(b!);
    s.refresh();
    expect(s.nodes.map((n) => n.el)).toEqual([a, b]);
  });
});
