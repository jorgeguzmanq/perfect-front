// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { createOverlay, type OverlayHandle } from '../src/index';
import { CSS } from '../src/styles';

/**
 * Pila de vistas del editor: base «Comentar» minimalista (sin pestañas) + una subvista a la vez que se abre desde
 * un chip «Proponer». Qué aparece y cuándo lo fija el mapa de la capa 00 del diseño.
 */

const okRes = { id: 'c1', collection: 'inbox', route: '/' };
let overlay: OverlayHandle | null = null;
afterEach(() => {
  overlay?.destroy();
  overlay = null;
  document.body.innerHTML = '';
});

const sr = () => document.querySelector<HTMLElement>('[data-perfect-front-overlay]')!.shadowRoot!;
const q = <T extends Element = HTMLElement>(s: string) => sr().querySelector(s) as T | null;
const chips = () => Array.from(sr().querySelectorAll('[data-pf-chip]')).map((c) => c.getAttribute('data-pf-chip'));
const chip = (v: string) => q<HTMLButtonElement>(`[data-pf-chip="${v}"]`)!;
const back = () => q<HTMLButtonElement>('[data-pf-back]');
const esc = () => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, composed: true }));
const click = (id: string, init: MouseEventInit = {}) =>
  document.getElementById(id)!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, ...init }));

function page() {
  document.body.innerHTML = `
    <main id="app">
      <section id="list"><p id="t1">uno</p><p id="t2">dos</p><div id="box"><span>hijo</span></div></section>
      <section id="solo"><p id="only">solo</p></section>
      <p id="styled" style="font-size:14px;padding-inline:8px;color:red;border-radius:4px">estilos</p>
    </main>`;
}
function open(id: string, extra: Partial<Parameters<typeof createOverlay>[0]> = {}) {
  overlay = createOverlay({ onSubmit: async () => okRes, ...extra });
  overlay.enable();
  click(id);
}

describe('vista base «Comentar»', () => {
  it('no tiene pestañas ni bandeja ni navegador permanentes, y solo tres teclas en la cabecera', () => {
    page();
    open('t1');
    expect(q('[role="tab"]')).toBeNull();
    expect(q('[role="tablist"]')).toBeNull();
    expect(q('.pf-ov-tray')!.hidden).toBe(true); // la bandeja de nodos solo existe en multiselección
    expect(q('.pf-ov-pos')).toBeNull(); // el navegador ↑↓←→ no es permanente
    expect(back()).toBeNull(); // no hay «‹ Comentar» en la base
    // Cabecera: copiar, cerrar y el menú «⋯» (sin openCode no hay ↗). Capas/Eliminar/Minimizar viven en el menú.
    const head = Array.from(q('.pf-ov-tools')!.querySelectorAll('button')).map((b) => b.getAttribute('aria-label'));
    expect(head).toEqual(['Copiar referencia completa', 'Más acciones', 'Cerrar (Esc)']);
    expect(q('[data-pf-remove]')!.closest('[role="menu"]')).not.toBeNull();
    expect(q('[role="menu"]')!.hidden).toBe(true);
    expect(q('[role="region"][aria-label="Comentario"]')).not.toBeNull();
  });

  it('el menú «⋯» ofrece Capas, Navegar, Sumar, Elegir otro, Añadir sección, Minimizar y Eliminar; Esc lo cierra primero', () => {
    page();
    open('t1');
    const more = q<HTMLButtonElement>('[aria-label="Más acciones"]')!;
    more.click();
    expect(more.getAttribute('aria-expanded')).toBe('true');
    const items = Array.from(sr().querySelectorAll('[role="menu"] [role="menuitem"], [role="menu"] [role="menuitemcheckbox"]')).map((b) => b.textContent);
    expect(items).toEqual(['Capas', 'Navegar por el DOM↑↓←→', 'Sumar elementoShift+clic', 'Elegir otro elemento', 'Añadir sección', 'Minimizar panel', 'Eliminar elemento']);
    esc();
    expect(q('[role="menu"]')!.hidden).toBe(true);
    expect(overlay!.state).toBe('EDITING'); // el primer Esc solo cerró el menú
  });

  it('«Añadir sección» sale del menú y crea el bloque en la base', () => {
    page();
    open('t1');
    q<HTMLButtonElement>('[aria-label="Más acciones"]')!.click();
    Array.from(sr().querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find((b) => b.textContent === 'Añadir sección')!.click();
    expect(sr().querySelectorAll('.pf-ov-section')).toHaveLength(1);
  });

  it('una sola franja de imágenes: Pega o arrastra · Abrir… · Capturar', () => {
    page();
    open('t1', { onRequestCapture: async () => ({ mimeType: 'image/png', dataBase64: 'AAAA' }) });
    expect(sr().querySelectorAll('[data-pf-dz]')).toHaveLength(1);
    const txt = q('.pf-ov-dz-idle')!.textContent!;
    expect(txt).toContain('Pega');
    expect(txt).toContain('Abrir…');
    expect(txt).toContain('Capturar');
    expect(q('[aria-label="Captura de la página"]')).not.toBeNull(); // «Vista visible» dentro del menú Capturar
  });

  it('«Incluye» solo aparece si hay algo', () => {
    page();
    open('t1');
    expect(q('.pf-ov-inc')!.hidden).toBe(true);
  });

  it('el ancho base es ~26rem (no 30rem) y no hay scroll interno en la base', () => {
    expect(CSS).toContain('.pf-ov-panel--v2 { gap: var(--pf-space-2); width: min(26rem, 100vw);');
    expect(CSS).toContain('.pf-ov-body:not([data-view="comment"]) {');
    expect(CSS).not.toMatch(/\.pf-ov-panel--v2 \{[^}]*30rem/);
  });
});

describe('chips «Proponer» según el mapa', () => {
  it('un nodo con texto propio y hermanos: Texto, Estilos y Orden (sin Grupo si no hay grupos)', () => {
    page();
    open('t1');
    expect(chips()).toEqual(['content', 'styles', 'struct']);
  });

  it('Texto se oculta si el nodo no tiene texto propio', () => {
    page();
    open('box');
    expect(chips()).toEqual(['styles', 'struct']);
  });

  it('Orden se oculta si el nodo no tiene hermanos', () => {
    page();
    open('only');
    expect(chips()).toEqual(['content', 'styles']);
  });

  it('varios nodos: Texto solo según el foco, Estilos sí, Orden se oculta; la bandeja aparece', () => {
    page();
    open('t1');
    expect(q('.pf-ov-tray')!.hidden).toBe(true);
    click('t2', { shiftKey: true });
    expect(q('.pf-ov-tray')!.hidden).toBe(false);
    expect(chips()).toEqual(['content', 'styles']); // foco = t2 (con texto)
    click('box', { shiftKey: true }); // el foco pasa a un nodo sin texto propio
    expect(chips()).toEqual(['styles']);
  });

  it('toda la vista: sin Texto, Estilos ni Orden', () => {
    page();
    open('t1');
    q<HTMLButtonElement>('.pf-ov-seg button:last-child')!.click(); // «Toda la vista»
    expect(chips()).toEqual([]);
    expect(q('.pf-ov-propose')).toBeNull();
  });

  it('Grupo: «Agrupar» si hay grupos disponibles; oculto si no hay', () => {
    page();
    open('t1', { groups: { api: {} as never, groups: () => [], comments: () => [] } });
    expect(chips()).toEqual(['content', 'styles', 'struct', 'group']);
    expect(chip('group').textContent).toContain('Agrupar');
  });

  it('el chip se enciende cuando esa vista ya tiene cambios y «Incluye» los resume', () => {
    page();
    open('t1');
    chip('styles').click();
    // Cambiar un estilo desde la lista (la primera sección viene abierta).
    Array.from(sr().querySelectorAll<HTMLButtonElement>('.pf-ov-seg button')).find((b) => b.textContent === 'Lista')!.click();
    const input = q<HTMLInputElement>('.pf-ov-srow input')!;
    input.value = '99';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(q('.pf-ov-inc')!.hidden).toBe(false);
    expect(q('.pf-ov-inc')!.textContent).toContain('cambio de estilo');
    back()!.click();
    expect(chip('styles').classList.contains('pf-dk-chip--on')).toBe(true);
  });
});

describe('subvistas de la pila', () => {
  it('abrir por chip reemplaza el cuerpo, muestra «‹ Comentar» + título y da el foco al botón; pie e «Incluye» persisten', () => {
    page();
    open('t1');
    expect(q('textarea')).not.toBeNull();
    chip('content').click();
    expect(q('textarea#pf-ov-comment')).toBeNull(); // el cuerpo se reemplazó
    expect(back()!.textContent).toContain('Comentar');
    expect(q('.pf-ov-viewtitle')!.textContent).toBe('Texto');
    expect(q('[role="region"]')!.getAttribute('aria-labelledby')).toBe('pf-ov-view-title');
    expect(sr().activeElement).toBe(back());
    expect(q('.pf-ov-target')!.hidden).toBe(true); // el alcance solo se ve en la base
    // El pie persiste.
    const foot = Array.from(sr().querySelectorAll('.pf-ov-foot2 button')).map((b) => b.textContent);
    expect(foot).toEqual(['Cancelar', 'Guardar']);
  });

  it('«‹ Comentar» vuelve a la base y devuelve el foco al chip de origen', () => {
    page();
    open('t1');
    chip('styles').click();
    expect(q('.pf-ov-viewtitle')!.textContent).toBe('Estilos');
    back()!.click();
    expect(back()).toBeNull();
    expect(q('textarea#pf-ov-comment')).not.toBeNull();
    expect(sr().activeElement).toBe(chip('styles'));
  });

  it('Esc en dos pasos: primero vuelve a la base, después cierra el editor', () => {
    page();
    open('t1');
    chip('struct').click();
    expect(q('.pf-ov-viewtitle')!.textContent).toBe('Orden');
    esc();
    expect(overlay!.state).toBe('EDITING');
    expect(back()).toBeNull();
    expect(q('textarea#pf-ov-comment')).not.toBeNull();
    esc();
    expect(overlay!.state).toBe('SELECTING');
    expect(q('textarea')).toBeNull();
  });

  it('Capas se abre desde el menú y muestra el navegador ↑↓←→ como fila delgada', () => {
    page();
    open('t1');
    expect(q('.pf-ov-pos')).toBeNull();
    q<HTMLButtonElement>('[aria-label="Más acciones"]')!.click();
    Array.from(sr().querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find((b) => b.textContent === 'Capas')!.click();
    expect(q('.pf-ov-viewtitle')!.textContent).toBe('Capas');
    expect(q('[role="tree"]')).not.toBeNull();
    expect(q('.pf-ov-pos')).not.toBeNull();
    esc();
    expect(q('.pf-ov-pos')).toBeNull();
  });

  it('el navegador aparece solo mientras se navega y se apaga al volver a la nota', () => {
    page();
    open('t1');
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true, cancelable: true, composed: true }));
    expect(q('.pf-ov-pos')!.textContent).toBe('2/3');
    q<HTMLTextAreaElement>('textarea')!.dispatchEvent(new FocusEvent('focus'));
    expect(q('.pf-ov-pos')).toBeNull();
  });

  it('si la vista abierta deja de aplicar (navegar a un nodo sin texto) la pila vuelve a la base', () => {
    page();
    open('t1');
    chip('content').click();
    expect(q('.pf-ov-viewtitle')!.textContent).toBe('Texto');
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true, cancelable: true, composed: true }));
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true, cancelable: true, composed: true }));
    expect(back()).toBeNull(); // #box no tiene texto propio
    expect(chips()).not.toContain('content');
  });

  it('la transición es corta (≤180 ms) y respeta prefers-reduced-motion', () => {
    page();
    open('t1');
    chip('styles').click();
    expect(q('.pf-ov-body')!.classList.contains('pf-ov-vt--fwd')).toBe(true);
    back()!.click();
    expect(q('.pf-ov-body')!.classList.contains('pf-ov-vt--back')).toBe(true);
    const ms = Array.from(CSS.matchAll(/\.pf-ov-vt--(?:fwd|back) \{ animation: [\w-]+ (\d+)ms/g)).map((m) => Number(m[1]));
    expect(ms.length).toBe(2);
    for (const n of ms) expect(n).toBeLessThanOrEqual(180);
    expect(CSS).toMatch(/prefers-reduced-motion: reduce\) \{ \.pf-ov-vt--fwd, \.pf-ov-vt--back \{ animation: none; \} \}/);
  });
});

describe('Estilos: divulgación progresiva', () => {
  it('modo Lista: solo la primera sección (y las con cambios) abiertas; Foundation plegada', () => {
    page();
    open('styled');
    chip('styles').click();
    const lista = Array.from(sr().querySelectorAll<HTMLButtonElement>('.pf-ov-seg button')).find((b) => b.textContent === 'Lista')!;
    lista.click();
    const heads = Array.from(sr().querySelectorAll<HTMLButtonElement>('.pf-ov-gh'));
    expect(heads.length).toBeGreaterThan(1);
    expect(heads[0]!.getAttribute('aria-expanded')).toBe('true');
    for (const h of heads.slice(1)) expect(h.getAttribute('aria-expanded')).toBe('false');
    expect(q('.pf-ov-sgroup--fnd button')!.getAttribute('aria-expanded')).toBe('false');
    // Abrir otra sección la despliega.
    heads[1]!.click();
    expect(Array.from(sr().querySelectorAll<HTMLButtonElement>('.pf-ov-gh'))[1]!.getAttribute('aria-expanded')).toBe('true');
    // Un grupo con cambios queda abierto y lo indica con un contador.
    const input = q<HTMLInputElement>('.pf-ov-srow input')!;
    input.value = '99';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(q('.pf-ov-gh .pf-ov-badge')!.textContent).toBe('1');
  });

  it('modo Visual: solo la primera sección abierta por defecto', () => {
    page();
    open('t1');
    chip('styles').click();
    const opened = Array.from(sr().querySelectorAll<HTMLButtonElement>('.pf-dz-sech')).filter((b) => b.getAttribute('aria-expanded') === 'true');
    expect(opened).toHaveLength(1);
  });
});
