// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPins, type PinComment, type PinsHandle } from '../src/pins';
import type { CommentsApi } from '../src/groups';

const comment = (o: Partial<PinComment> = {}): PinComment => ({
  id: 'c1',
  status: 'in_progress',
  scope: 'element',
  comment: 'Precio anual en negrita',
  location: { route: '/', selector: '#card' },
  createdAt: '2026-10-04T10:00:00.000Z',
  updatedAt: '2026-10-04T10:00:00.000Z',
  group: { id: 'g1', position: 2 },
  ...o,
});

let pins: PinsHandle | null = null;
let rows: PinComment[] = [];
const comments: CommentsApi = { update: vi.fn(async () => {}), remove: vi.fn(async () => {}) };
const onChanged = vi.fn();
const host = () => document.querySelector<HTMLElement>('[data-perfect-front-pins]')!;
const q = <T extends Element = HTMLElement>(s: string) => host().shadowRoot!.querySelector(s) as T | null;
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
const btnByLabel = (label: string) =>
  Array.from(host().shadowRoot!.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.getAttribute('aria-label') === label || b.textContent?.trim() === label)!;

const mount = async (withApi = true) => {
  pins = createPins({
    loadComments: async () => rows,
    comments: withApi ? comments : null,
    groupName: (id) => (id === 'g1' ? 'A' : undefined),
    onChanged,
  });
  await pins.refresh();
};

beforeEach(() => {
  vi.mocked(comments.update).mockClear();
  vi.mocked(comments.remove).mockClear();
  onChanged.mockClear();
  rows = [comment()];
  document.body.innerHTML = '<main><div id="card" style="width:200px">Card</div></main>';
  const card = document.getElementById('card')!;
  card.getBoundingClientRect = () => ({ left: 100, top: 100, right: 300, bottom: 200, width: 200, height: 100, x: 100, y: 100, toJSON() {} }) as DOMRect;
  card.scrollIntoView = vi.fn();
});
afterEach(() => {
  pins?.destroy();
  pins = null;
  document.body.innerHTML = '';
});

describe('popover del pin', () => {
  it('clic abre un diálogo con estado (chip con LED), selector, nota, grupo y paso', async () => {
    await mount();
    const pin = q<HTMLButtonElement>('.pf-pin')!;
    expect(pin.classList.contains('pf-pin--g')).toBe(true);
    pin.click();
    const pop = q('.pf-dk-fl-pop')!;
    expect(pop.getAttribute('role')).toBe('dialog');
    expect(pop.getAttribute('aria-label')).toBe('Comentario 1');
    expect(pin.hasAttribute('data-open')).toBe(true);
    const chip = pop.querySelector('.pf-dk-chip')!;
    expect(chip.textContent).toBe('En curso');
    expect(chip.querySelector('.pf-dk-led--teal.pf-dk-led--on')).not.toBeNull();
    expect(pop.textContent).toContain('div#card');
    expect(pop.textContent).toContain('Precio anual en negrita');
    expect(pop.textContent).toContain('Grupo A · paso 2');
    expect(btnByLabel('Ir al nodo')).toBeDefined();
    expect(btnByLabel('Editar')).toBeDefined();
    expect(btnByLabel('Eliminar')).toBeDefined();
    expect(host().shadowRoot!.activeElement).toBe(btnByLabel('Ir al nodo'));
  });

  it('pendiente usa LED ámbar; sin commentsApi no hay editar ni eliminar', async () => {
    rows = [comment({ status: 'pending', group: null })];
    await mount(false);
    q<HTMLButtonElement>('.pf-pin')!.click();
    expect(q('.pf-dk-fl-pop .pf-dk-chip')!.textContent).toBe('Pendiente');
    expect(q('.pf-dk-fl-pop .pf-dk-led--amber')).not.toBeNull();
    expect(q('.pf-dk-fl-pop')!.textContent).not.toContain('Grupo');
    expect(Array.from(host().shadowRoot!.querySelectorAll('button')).some((b) => b.getAttribute('aria-label') === 'Editar')).toBe(false);
  });

  it('«Ir al nodo» desplaza al elemento', async () => {
    await mount();
    q<HTMLButtonElement>('.pf-pin')!.click();
    btnByLabel('Ir al nodo').click();
    expect(document.getElementById('card')!.scrollIntoView).toHaveBeenCalled();
    expect(q('.pf-pin')!.hasAttribute('data-flash')).toBe(true);
  });

  it('Esc cierra y devuelve el foco al pin; un segundo clic en el pin también cierra', async () => {
    await mount();
    const pin = q<HTMLButtonElement>('.pf-pin')!;
    pin.click();
    q('.pf-dk-fl-pop')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(q('.pf-dk-fl-pop')).toBeNull();
    expect(pin.hasAttribute('data-open')).toBe(false);
    expect(host().shadowRoot!.activeElement).toBe(pin);
    pin.click();
    expect(q('.pf-dk-fl-pop')).not.toBeNull();
    pin.click();
    expect(q('.pf-dk-fl-pop')).toBeNull();
  });

  it('un clic fuera lo cierra', async () => {
    await mount();
    q<HTMLButtonElement>('.pf-pin')!.click();
    document.getElementById('card')!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    expect(q('.pf-dk-fl-pop')).toBeNull();
  });

  it('editar guarda con updatedAt y refresca; vacío no guarda', async () => {
    await mount();
    q<HTMLButtonElement>('.pf-pin')!.click();
    btnByLabel('Editar').click();
    q<HTMLTextAreaElement>('.pf-dk-fl-pop textarea')!.value = '   ';
    btnByLabel('Guardar').click();
    expect(comments.update).not.toHaveBeenCalled();
    expect(q('.pf-dk-fl-pop [role="alert"]')).not.toBeNull();
    q<HTMLTextAreaElement>('.pf-dk-fl-pop textarea')!.value = 'Texto nuevo';
    btnByLabel('Guardar').click();
    await flush();
    expect(comments.update).toHaveBeenCalledWith('c1', 'Texto nuevo', '2026-10-04T10:00:00.000Z');
    expect(onChanged).toHaveBeenCalled();
    expect(q('.pf-dk-fl-pop textarea')).toBeNull();
  });

  it('eliminar pide confirmación; Cancelar vuelve y Eliminar borra y cierra', async () => {
    await mount();
    q<HTMLButtonElement>('.pf-pin')!.click();
    btnByLabel('Eliminar').click();
    const pop = q('.pf-dk-fl-pop')!;
    expect(pop.getAttribute('role')).toBe('alertdialog');
    expect(pop.textContent).toContain('¿Eliminar este comentario?');
    expect(comments.remove).not.toHaveBeenCalled();
    btnByLabel('Cancelar').click();
    expect(q('.pf-dk-fl-pop')!.getAttribute('role')).toBe('dialog');
    btnByLabel('Eliminar').click();
    rows = [];
    btnByLabel('Eliminar').click();
    await flush();
    expect(comments.remove).toHaveBeenCalledWith('c1');
    expect(onChanged).toHaveBeenCalled();
    expect(q('.pf-dk-fl-pop')).toBeNull();
    expect(q('.pf-pin')).toBeNull();
  });

  it('un error al eliminar se muestra y el popover sigue abierto', async () => {
    vi.mocked(comments.remove).mockRejectedValueOnce(new Error('boom'));
    await mount();
    q<HTMLButtonElement>('.pf-pin')!.click();
    btnByLabel('Eliminar').click();
    btnByLabel('Eliminar').click();
    await flush();
    expect(q('.pf-dk-fl-pop [role="alert"]')!.textContent).toContain('boom');
  });
});
