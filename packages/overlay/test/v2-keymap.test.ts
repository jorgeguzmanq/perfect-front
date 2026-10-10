import { describe, expect, it } from 'vitest';
import { interpretEditorKey, type KeyContext, type KeyLike } from '../src/keymap';

const key = (k: string, mods: Partial<Omit<KeyLike, 'key'>> = {}): KeyLike => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

/** Overlay enfocado fuera de un campo, con un elemento elegido: caso base para navegar. */
const idle: KeyContext = { typing: false, own: true, hasElement: true };
const typing: KeyContext = { typing: true, own: true, hasElement: true };

describe('interpretEditorKey', () => {
  it('Escape cancela siempre, con o sin elemento ni foco', () => {
    expect(interpretEditorKey(key('Escape'), idle)).toEqual({ type: 'cancel' });
    expect(interpretEditorKey(key('Escape'), typing)).toEqual({ type: 'cancel' });
    expect(interpretEditorKey(key('Escape'), { typing: false, own: false, hasElement: false })).toEqual({ type: 'cancel' });
  });

  it('Ctrl+Enter y Cmd+Enter guardan, también escribiendo', () => {
    expect(interpretEditorKey(key('Enter', { ctrlKey: true }), typing)).toEqual({ type: 'save' });
    expect(interpretEditorKey(key('Enter', { metaKey: true }), idle)).toEqual({ type: 'save' });
  });

  it('Enter solo, sin modificador, no hace nada', () => {
    expect(interpretEditorKey(key('Enter'), idle)).toBeNull();
    expect(interpretEditorKey(key('Enter', { shiftKey: true }), idle)).toBeNull();
  });

  it('las flechas mapean a su dirección: ↑ padre, ↓ hijo, ← anterior, → siguiente', () => {
    expect(interpretEditorKey(key('ArrowUp'), idle)).toEqual({ type: 'nav', dir: 'parent' });
    expect(interpretEditorKey(key('ArrowDown'), idle)).toEqual({ type: 'nav', dir: 'child' });
    expect(interpretEditorKey(key('ArrowLeft'), idle)).toEqual({ type: 'nav', dir: 'prev' });
    expect(interpretEditorKey(key('ArrowRight'), idle)).toEqual({ type: 'nav', dir: 'next' });
  });

  it('escribiendo en un campo, las flechas son del campo (sin Alt no navegan)', () => {
    expect(interpretEditorKey(key('ArrowUp'), typing)).toBeNull();
    expect(interpretEditorKey(key('ArrowLeft'), typing)).toBeNull();
  });

  it('escribiendo, Alt+flecha sí navega', () => {
    expect(interpretEditorKey(key('ArrowDown', { altKey: true }), typing)).toEqual({ type: 'nav', dir: 'child' });
    expect(interpretEditorKey(key('ArrowRight', { altKey: true }), typing)).toEqual({ type: 'nav', dir: 'next' });
  });

  it('un evento que no viene del overlay (página) no navega sin Alt', () => {
    const page: KeyContext = { typing: false, own: false, hasElement: true };
    expect(interpretEditorKey(key('ArrowUp'), page)).toBeNull();
    expect(interpretEditorKey(key('ArrowUp', { altKey: true }), page)).toEqual({ type: 'nav', dir: 'parent' });
  });

  it('sin elemento elegido («toda la vista») las flechas no navegan', () => {
    const view: KeyContext = { typing: false, own: true, hasElement: false };
    expect(interpretEditorKey(key('ArrowDown'), view)).toBeNull();
    expect(interpretEditorKey(key('ArrowDown', { altKey: true }), view)).toBeNull();
  });

  it('teclas no contempladas devuelven null', () => {
    expect(interpretEditorKey(key('a'), idle)).toBeNull();
    expect(interpretEditorKey(key('Tab'), idle)).toBeNull();
  });
});
