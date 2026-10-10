// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { CommentProposalSchema } from '@perfect-front/shared';
import { ReorderModel } from '../src/reorder';

const byId = (id: string) => document.getElementById(id)!;
const childIds = () => Array.from(document.getElementById('l')!.children).map((c) => c.id);

beforeEach(() => {
  document.body.innerHTML =
    '<main><ul id="l"><li id="a">A</li><li id="b">B</li><li id="c">C</li><li id="d">D</li></ul></main>';
});

describe('ReorderModel: mover de N a M', () => {
  it('posiciones iniciales 1-based y cantidad de hermanos', () => {
    const m = new ReorderModel(byId('b'));
    expect(m.from).toBe(2);
    expect(m.to).toBe(2);
    expect(m.siblingCount).toBe(4);
    expect(m.changed).toBe(false);
  });

  it('moveTo(4) desde 2: el orden virtual cambia, from se conserva y changed queda activo', () => {
    const m = new ReorderModel(byId('b'));
    expect(m.moveTo(4)).toBe(true);
    expect(m.from).toBe(2);
    expect(m.to).toBe(4);
    expect(m.changed).toBe(true);
    expect(m.virtualOrder.map((e) => e.id)).toEqual(['a', 'c', 'd', 'b']);
  });

  it('no muta el DOM de la página al reordenar', () => {
    const before = childIds();
    const m = new ReorderModel(byId('b'));
    m.moveTo(4);
    m.moveUp();
    m.dropOn(byId('d'));
    expect(childIds()).toEqual(before);
  });

  it('moveTo a la misma posición devuelve false y no cambia nada', () => {
    const m = new ReorderModel(byId('b'));
    expect(m.moveTo(2)).toBe(false);
    expect(m.changed).toBe(false);
  });

  it('acota la posición a 1..N y redondea', () => {
    const m = new ReorderModel(byId('b'));
    m.moveTo(99);
    expect(m.to).toBe(4);
    m.moveTo(0);
    expect(m.to).toBe(1);
    m.moveTo(2.6);
    expect(m.to).toBe(3);
  });

  it('moveUp / moveDown respetan los extremos', () => {
    const m = new ReorderModel(byId('a'));
    expect(m.canUp).toBe(false);
    expect(m.moveUp()).toBe(false);
    expect(m.moveDown()).toBe(true);
    expect(m.to).toBe(2);
    expect(m.canUp).toBe(true);

    m.moveTo(4);
    expect(m.canDown).toBe(false);
    expect(m.moveDown()).toBe(false);
  });

  it('dropOn toma la posición del hermano de destino', () => {
    const m = new ReorderModel(byId('b'));
    expect(m.dropOn(byId('d'))).toBe(true);
    expect(m.to).toBe(4);
    expect(m.dropOn(document.createElement('li'))).toBe(false);
  });

  it('undo restaura el orden original', () => {
    const m = new ReorderModel(byId('b'));
    m.moveTo(4);
    m.undo();
    expect(m.virtualOrder.map((e) => e.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(m.to).toBe(m.from);
    expect(m.changed).toBe(false);
  });
});

describe('ReorderModel: indicador de inserción', () => {
  it('sin cambio no hay indicador', () => {
    expect(new ReorderModel(byId('b')).indicator()).toBeNull();
  });

  it('al bajar, la línea va después del hermano original que ocupa la posición de destino', () => {
    const m = new ReorderModel(byId('b'));
    m.moveTo(3);
    // Original [a,b,c,d]: la posición 3 de destino corresponde a original[2] = c.
    expect(m.indicator()).toEqual({ el: byId('c'), side: 'after' });
  });

  it('al subir, la línea va antes del hermano que ocupa la posición de destino', () => {
    const m = new ReorderModel(byId('c'));
    m.moveUp();
    expect(m.indicator()).toEqual({ el: byId('b'), side: 'before' });
  });
});

describe('ReorderModel: propuesta', () => {
  it('sin cambio no genera propuesta', () => {
    expect(new ReorderModel(byId('b')).toProposal('#b', '#l')).toBeNull();
  });

  it('genera una propuesta reorder «mover de 2 a 4» válida para el schema', () => {
    const m = new ReorderModel(byId('b'));
    m.moveTo(4);
    const p = m.toProposal('#b', '#l');
    expect(p).toMatchObject({
      kind: 'reorder',
      targetSelector: '#b',
      parentSelector: '#l',
      from: 2,
      to: 4,
      siblingCount: 4,
    });
    expect(p!.id.startsWith('p-')).toBe(true);
    expect(CommentProposalSchema.safeParse(p).success).toBe(true);
  });

  it('el id de la propuesta evita los ya tomados', () => {
    const m = new ReorderModel(byId('b'));
    m.moveTo(4);
    const first = m.toProposal('#b', null)!;
    const second = m.toProposal('#b', null, new Set([first.id]))!;
    expect(second.id).not.toBe(first.id);
  });
});
