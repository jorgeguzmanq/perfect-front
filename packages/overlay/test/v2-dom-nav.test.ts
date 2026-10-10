// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { HOST_ATTR } from '../src/constants';
import {
  ancestorsOf,
  firstChildOf,
  navAvailability,
  navTarget,
  parentOf,
  siblingPos,
  siblingsOf,
} from '../src/dom-nav';

const byId = (id: string) => document.getElementById(id)!;

beforeEach(() => {
  document.body.innerHTML = '<main id="m"><ul id="l"><li id="a"></li><li id="b"></li><li id="c"></li></ul></main>';
  // Nodo propio de Perfect Front al inicio de la lista: debe ser invisible para la navegación.
  const pf = document.createElement('i');
  pf.setAttribute(HOST_ATTR, '');
  byId('l').prepend(pf);
});

describe('hermanos y posición', () => {
  it('siblingsOf excluye nodos propios de Perfect Front', () => {
    expect(siblingsOf(byId('b'))).toEqual([byId('a'), byId('b'), byId('c')]);
  });

  it('un elemento sin padre es hermano único de sí mismo', () => {
    const solo = document.createElement('div');
    expect(siblingsOf(solo)).toEqual([solo]);
  });

  it('siblingPos devuelve posición 0-based y cantidad', () => {
    expect(siblingPos(byId('c'))).toEqual({ pos: 2, count: 3 });
    expect(siblingPos(byId('a'))).toEqual({ pos: 0, count: 3 });
  });

  it('firstChildOf ignora el nodo de Perfect Front', () => {
    expect(firstChildOf(byId('l'))).toBe(byId('a'));
    expect(firstChildOf(byId('a'))).toBeNull();
  });
});

describe('parentOf', () => {
  it('devuelve el padre, pero no el <html>', () => {
    expect(parentOf(byId('a'))).toBe(byId('l'));
    expect(parentOf(document.body)).toBeNull();
    expect(parentOf(null)).toBeNull();
  });
});

describe('navTarget: ↑↓←→', () => {
  it('← y → van al hermano anterior y siguiente', () => {
    const stack: Element[] = [];
    expect(navTarget(byId('b'), 'prev', stack)).toBe(byId('a'));
    expect(navTarget(byId('b'), 'next', stack)).toBe(byId('c'));
  });

  it('no hay hermano más allá de los extremos', () => {
    const stack: Element[] = [];
    expect(navTarget(byId('a'), 'prev', stack)).toBeNull();
    expect(navTarget(byId('c'), 'next', stack)).toBeNull();
  });

  it('← / → vacían la pila de regreso', () => {
    const stack: Element[] = [byId('c')];
    navTarget(byId('b'), 'next', stack);
    expect(stack).toHaveLength(0);
  });

  it('↑ sube al padre y recuerda de dónde venía', () => {
    const stack: Element[] = [];
    expect(navTarget(byId('a'), 'parent', stack)).toBe(byId('l'));
    expect(stack).toEqual([byId('a')]);
  });

  it('↓ regresa por el mismo camino por el que se subió', () => {
    const stack: Element[] = [];
    navTarget(byId('b'), 'parent', stack); // sube a la lista, pila = [b]
    expect(navTarget(byId('l'), 'child', stack)).toBe(byId('b'));
    expect(stack).toHaveLength(0);
  });

  it('↓ sin camino de regreso baja al primer hijo visible', () => {
    expect(navTarget(byId('l'), 'child', [])).toBe(byId('a'));
  });

  it('↓ ignora un recuerdo que no es descendiente del elemento actual', () => {
    const stack: Element[] = [document.body];
    expect(navTarget(byId('l'), 'child', stack)).toBe(byId('a'));
  });

  it('↓ en una hoja no tiene destino', () => {
    expect(navTarget(byId('a'), 'child', [])).toBeNull();
  });

  it('↑ en body no hay padre: no sale al <html> y no deja recuerdo', () => {
    const stack: Element[] = [];
    expect(navTarget(document.body, 'parent', stack)).toBeNull();
    expect(stack).toHaveLength(0);
  });
});

describe('navAvailability', () => {
  it('describe qué direcciones están disponibles desde un elemento del medio', () => {
    expect(navAvailability(byId('b'))).toEqual({ parent: true, child: false, prev: true, next: true });
  });

  it('en el último hermano, → no está disponible; con hijos, ↓ sí', () => {
    expect(navAvailability(byId('c')).next).toBe(false);
    expect(navAvailability(byId('l')).child).toBe(true);
  });

  it('sin elemento, todo está deshabilitado', () => {
    expect(navAvailability(null)).toEqual({ parent: false, child: false, prev: false, next: false });
  });
});

describe('ancestorsOf (migas)', () => {
  it('va del ancestro más lejano (body) al propio elemento, sin html', () => {
    const ids = ancestorsOf(byId('a')).map((e) => e.id || e.localName);
    expect(ids).toEqual(['body', 'm', 'l', 'a']);
  });
});
