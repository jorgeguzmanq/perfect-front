import { describe, expect, it } from 'vitest';
import { LIMITS } from '@perfect-front/shared';
import { Sections, composeComment, type EditableSection } from '../src/sections';

const sec = (id: string, title: string, text: string): EditableSection => ({ id, title, text });

describe('Sections', () => {
  it('add crea secciones con id local «s-…» y texto vacío', () => {
    const s = new Sections();
    const a = s.add('Antes');
    expect(a).not.toBeNull();
    expect(a!.id.startsWith('s-')).toBe(true);
    expect(a!.title).toBe('Antes');
    expect(a!.text).toBe('');
    expect(s.items).toHaveLength(1);
  });

  it('ids únicos entre secciones creadas seguidas', () => {
    const s = new Sections();
    const ids = new Set(Array.from({ length: 10 }, () => s.add()!.id));
    expect(ids.size).toBe(10);
  });

  it('tope de LIMITS.sections (20): la 21 no se crea y full queda activo', () => {
    const s = new Sections();
    for (let i = 0; i < LIMITS.sections; i++) expect(s.add()).not.toBeNull();
    expect(s.full).toBe(true);
    expect(s.add('extra')).toBeNull();
    expect(s.items).toHaveLength(LIMITS.sections);
  });

  it('update recorta título y texto a sus límites', () => {
    const s = new Sections();
    const a = s.add()!;
    s.update(a.id, { title: 'T'.repeat(LIMITS.sectionTitle + 50), text: 'x'.repeat(LIMITS.sectionText + 50) });
    expect(s.items[0]!.title).toHaveLength(LIMITS.sectionTitle);
    expect(s.items[0]!.text).toHaveLength(LIMITS.sectionText);
  });

  it('update parcial solo toca el campo indicado e ignora ids desconocidos', () => {
    const s = new Sections();
    const a = s.add('Título')!;
    s.update(a.id, { text: 'Cuerpo' });
    expect(s.items[0]).toMatchObject({ title: 'Título', text: 'Cuerpo' });
    expect(() => s.update('no-existe', { text: 'x' })).not.toThrow();
  });

  it('remove quita solo la sección indicada; clear vacía la lista', () => {
    const s = new Sections();
    const a = s.add()!;
    const b = s.add()!;
    s.remove(a.id);
    expect(s.items.map((x) => x.id)).toEqual([b.id]);
    s.clear();
    expect(s.items).toHaveLength(0);
    expect(s.full).toBe(false);
  });

  it('toRequest omite secciones vacías sin imágenes y conserva las que tienen imágenes', () => {
    const s = new Sections();
    const a = s.add()!;
    const b = s.add()!;
    s.add()!; // vacía, sin imágenes: se omite
    s.update(a.id, { text: 'Con texto' });
    const out = s.toRequest(new Set([b.id]));
    expect(out).toEqual([
      { id: a.id, title: null, text: 'Con texto' },
      { id: b.id, title: null, text: '' },
    ]);
  });

  it('toRequest pasa título vacío o de solo espacios a null y recorta espacios del título', () => {
    const s = new Sections();
    const a = s.add('  Paso 1  ')!;
    s.update(a.id, { text: 'Hola' });
    expect(s.toRequest(new Set())[0]).toEqual({ id: a.id, title: 'Paso 1', text: 'Hola' });

    const b = s.add('   ')!;
    s.update(b.id, { text: 'Solo texto' });
    expect(s.toRequest(new Set())[1]!.title).toBeNull();
  });
});

describe('composeComment', () => {
  it('usa el texto principal recortado si existe', () => {
    expect(composeComment('  Cambiar el color  ', [sec('s-1', 'X', 'Y')])).toBe('Cambiar el color');
  });

  it('si el principal está vacío, arma el texto con «Título: texto» por sección', () => {
    const out = composeComment('', [sec('s-1', 'Antes', 'El botón'), sec('s-2', '', 'Después texto'), sec('s-3', 'Sin texto', '  ')]);
    expect(out).toBe('Antes: El botón\n\nDespués texto\n\nSin texto');
  });

  it('secciones vacías no aportan nada; sin nada devuelve cadena vacía', () => {
    expect(composeComment('   ', [sec('s-1', '', ''), sec('s-2', '  ', '  ')])).toBe('');
  });

  it('recorta al límite de LIMITS.comment', () => {
    const big = 'a'.repeat(LIMITS.comment + 100);
    expect(composeComment(big, [])).toHaveLength(LIMITS.comment);
  });
});
