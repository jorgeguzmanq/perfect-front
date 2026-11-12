// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { chip, foot, idHeader, incl, key, led, pbar, setLit, toggle, tray, warn } from '../src/deck';
import { CSS } from '../src/styles';

describe('deck: piezas DOM', () => {
  it('key aplica variante, icono, aria y clic', () => {
    let n = 0;
    const b = key(document, 'Guardar', { variant: 'hot', icon: 'check', onClick: () => n++ });
    expect(b.className).toContain('pf-dk-key--hot');
    expect(b.textContent).toBe(' Guardar');
    expect(b.querySelector('svg')).not.toBeNull();
    b.click();
    expect(n).toBe(1);
    const sq = key(document, '', { sq: true, ariaLabel: 'Cerrar', variant: 'ghost' });
    expect(sq.getAttribute('aria-label')).toBe('Cerrar');
    expect(sq.title).toBe('Cerrar');
    setLit(sq, true);
    expect(sq.classList.contains('pf-dk-key--lit')).toBe(true);
  });

  it('led, chip, warn, toggle y pbar exponen estado accesible', () => {
    expect(led(document, true, 'teal').className).toContain('pf-dk-led--on');
    expect(led(document, false).className).not.toContain('pf-dk-led--on');
    const c = chip(document, '3 nodos', { on: true, led: true, onClick: () => undefined });
    expect(c.tagName).toBe('BUTTON');
    expect(c.className).toContain('pf-dk-chip--on');
    expect(warn(document, 'Error', { bad: true }).getAttribute('role')).toBe('alert');
    expect(warn(document, 'Aviso').getAttribute('role')).toBeNull();
    const t = toggle(document, false, 'Grupo');
    t.click();
    expect(t.getAttribute('aria-pressed')).toBe('true');
    expect(pbar(document, 140).getAttribute('aria-valuenow')).toBe('100');
  });

  it('idHeader, incl, foot y tray componen la cabecera, «Incluye» y el pie', () => {
    const hd = idHeader(document, { tag: 'btn', title: 'Button', titleNote: 'en Card', sub: 'src/Card.tsx:42', actions: [key(document, '', { sq: true, ariaLabel: 'Cerrar' })] });
    expect(hd.root.querySelector('.pf-dk-tagk')!.textContent).toBe('btn');
    expect(hd.title.textContent).toContain('en Card');
    expect(hd.sub.title).toBe('src/Card.tsx:42');
    expect(incl(document, [])).toBeNull();
    const inc = incl(document, [{ label: '2 imágenes' }])!;
    expect(inc.textContent).toContain('Incluye');
    expect(inc.querySelectorAll('.pf-dk-chip--on').length).toBe(1);
    const f = foot(document, { shortcuts: [{ keys: ['Ctrl', '↵'], label: 'guardar' }], cancel: key(document, 'Cancelar'), primary: key(document, 'Guardar') });
    expect(f.querySelectorAll('kbd').length).toBe(2);
    expect(tray(document, [key(document, 'A')], { label: 'Escena' }).getAttribute('aria-label')).toBe('Escena');
  });
});

describe('deck: CSS ensamblado', () => {
  it('lleva los tokens en :host y las piezas con prefijo pf-dk-', () => {
    expect(CSS).toContain('--pf-dk-ph: #a39df2');
    expect(CSS).toContain('.pf-dk-key--hot');
    expect(CSS).toContain('.pf-dk-unit');
    expect(CSS).not.toMatch(/fonts\.googleapis|@import url|url\(https?:/);
  });
});
