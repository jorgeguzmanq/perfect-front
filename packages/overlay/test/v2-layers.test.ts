// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { buildLayerModel, MAX_LIST, type LayerRow } from '../src/layers';
import { createOverlay, type OverlayHandle } from '../src/index';

const okRes = { id: 'c1', collection: 'inbox', route: '/' };
let overlay: OverlayHandle | null = null;
afterEach(() => {
  overlay?.destroy();
  overlay = null;
  document.body.innerHTML = '';
});

const sr = () => document.querySelector<HTMLElement>('[data-perfect-front-overlay]')!.shadowRoot!;
const q = <T extends Element = HTMLElement>(s: string) => sr().querySelector(s) as T | null;
const rows = () => Array.from(sr().querySelectorAll<HTMLElement>('[role="treeitem"]'));
const rowOf = (text: string) => rows().find((r) => r.querySelector('.pf-ly-label')!.textContent!.startsWith(text))!;

function page() {
  document.body.innerHTML = `
    <main id="app">
      <section id="a"><p id="a1">uno</p></section>
      <section id="mid"><p id="m1">dos</p><p id="m2">tres</p><span id="m3"></span></section>
      <section id="z"></section>
    </main>`;
}
function openEditor(id: string) {
  overlay = createOverlay({ onSubmit: async () => okRes });
  overlay.enable();
  document.getElementById(id)!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
}
/** «Capas» es una vista rara: se abre desde el menú «⋯» de la cabecera. */
const openLayers = () => {
  q<HTMLButtonElement>('[aria-label="Más acciones"]')!.click();
  Array.from(sr().querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find((b) => b.textContent === 'Capas')!.click();
};

describe('buildLayerModel', () => {
  it('ancestros (sin html), hermanos con el foco e hijos justo después del foco', () => {
    page();
    const m = buildLayerModel(document.getElementById('mid')!);
    const r = m.rows as LayerRow[];
    expect(r.map((x) => `${x.kind}:${x.level}:${x.el.id || x.el.localName}`)).toEqual([
      'ancestor:1:body',
      'ancestor:2:app',
      'sibling:3:a',
      'focus:3:mid',
      'child:4:m1',
      'child:4:m2',
      'child:4:m3',
      'sibling:3:z',
    ]);
  });

  it('no incluye nodos propios de Perfect Front y acota listas largas', () => {
    document.body.innerHTML = '<div id="p"></div>';
    const p = document.getElementById('p')!;
    const own = document.createElement('div');
    own.setAttribute('data-perfect-front-overlay', '');
    p.appendChild(own);
    for (let i = 0; i < MAX_LIST + 10; i++) p.appendChild(document.createElement('i'));
    const m = buildLayerModel(p).rows;
    const kids = m.filter((x): x is LayerRow => 'el' in x && x.kind === 'child');
    expect(kids).toHaveLength(MAX_LIST);
    expect(kids.some((k) => k.el === own)).toBe(false);
    expect(m.some((x) => 'more' in x && x.more === 10)).toBe(true);
  });
});

describe('vista Capas', () => {
  it('muestra el árbol con roles ARIA y marca el foco', () => {
    page();
    openEditor('mid');
    openLayers();
    const tree = q('[role="tree"]')!;
    expect(tree.getAttribute('aria-label')).toBe('Capas del DOM');
    expect(rowOf('section#mid').getAttribute('tabindex')).toBe('0');
    expect(rowOf('section#mid').getAttribute('aria-selected')).toBe('true');
    expect(rowOf('p#m1').getAttribute('aria-level')).toBe('4');
  });

  it('clic enfoca el nodo (reutiliza retarget) y Shift/Ctrl+clic lo suma a la selección', () => {
    page();
    openEditor('mid');
    openLayers();
    rowOf('p#m1').click();
    expect(q('.pf-ov-sub')!.textContent).toContain('#m1');
    expect(rowOf('p#m1').getAttribute('aria-selected')).toBe('true');
    rowOf('p#m2').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    expect(q('.pf-ov-tray')!.hidden).toBe(false);
    expect(rowOf('p#m2').getAttribute('aria-selected')).toBe('true');
    expect(rowOf('p#m1').getAttribute('aria-selected')).toBe('true');
    rowOf('span#m3').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    expect(q('.pf-ov-title')!.textContent).toBe('3 elementos');
  });

  it('al pasar el cursor resalta con una marca propia sin tocar el DOM del sitio', () => {
    page();
    openEditor('mid');
    openLayers();
    const before = document.body.innerHTML;
    document.getElementById('m2')!.getBoundingClientRect = () => ({ top: 5, left: 6, width: 70, height: 20 }) as DOMRect;
    rowOf('p#m2').dispatchEvent(new MouseEvent('mouseenter'));
    const mark = q('.pf-ov-highlight--hover')!;
    expect(mark.hidden).toBe(false);
    expect(mark.style.width).toBe('70px');
    expect(document.body.innerHTML).toBe(before);
    q('.pf-ly')!.dispatchEvent(new MouseEvent('mouseleave'));
    expect(q('.pf-ov-highlight--hover')!.hidden).toBe(true);
  });

  it('las flechas mueven el foco entre filas sin navegar el DOM; Enter elige', () => {
    page();
    openEditor('mid');
    openLayers();
    const arrow = (el: Element, key: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, composed: true }));
    arrow(rowOf('section#mid'), 'ArrowDown'); // baja a p#m1
    expect(rowOf('p#m1').getAttribute('tabindex')).toBe('0');
    expect(q('.pf-ov-sub')!.textContent).toContain('#mid'); // la selección no cambió
    arrow(rowOf('p#m1'), 'ArrowLeft'); // sube a la fila de menor nivel (section#mid)
    expect(rowOf('section#mid').getAttribute('tabindex')).toBe('0');
    arrow(rowOf('section#mid'), 'ArrowDown');
    arrow(rowOf('p#m1'), 'Enter');
    expect(q('.pf-ov-sub')!.textContent).toContain('#m1');
  });

  it('indica comentarios abiertos del nodo y el nombre de componente solo en su raíz DOM', () => {
    page();
    function Card() {
      return null;
    }
    const fiber = { type: Card, return: null };
    for (const id of ['mid', 'm1']) (document.getElementById(id) as unknown as Record<string, unknown>)['__reactFiber$t'] = fiber;
    const comments = [
      { id: 'c1', status: 'pending', comment: 'x', scope: 'element', location: { route: '/', selector: '#m1' } },
      { id: 'c2', status: 'resolved', comment: 'y', scope: 'element', location: { route: '/', selector: '#m2' } },
    ];
    overlay = createOverlay({ onSubmit: async () => okRes, groups: { api: {} as never, groups: () => [], comments: () => comments } });
    overlay.enable();
    document.getElementById('mid')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
    openLayers();
    expect(rowOf('p#m1').querySelector('.pf-ly-cmt')!.textContent).toBe('1');
    expect(rowOf('p#m2').querySelector('.pf-ly-cmt')).toBeNull(); // resuelto: no cuenta
    expect(rowOf('section#mid').querySelector('.pf-ly-comp')!.textContent).toBe('Card');
    expect(rowOf('p#m1').querySelector('.pf-ly-comp')).toBeNull(); // mismo componente que su padre
  });
});
