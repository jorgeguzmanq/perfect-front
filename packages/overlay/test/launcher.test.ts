// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bootPage, HINT_KEY, LAYER_KEY, type PfApi } from '../src/boot-core';

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
const okFetch = () =>
  vi.fn<typeof fetch>(async (u) =>
    String(u).endsWith('/comment')
      ? json({ ok: true, data: { id: 'c', collection: 'inbox', route: '/' } })
      : json({ ok: true, comments: [] }),
  );

let api: PfApi | null = null;
const boot = () => (api = bootPage({ token: 't', base: '/__pf', fetch: okFetch() }));
const lhost = () => document.querySelector<HTMLElement>('[data-perfect-front-launcher]');
const lq = <T extends Element = HTMLElement>(sel: string) => lhost()?.shadowRoot?.querySelector(sel) as T | null;
const lbtn = (label: string) =>
  Array.from(lhost()!.shadowRoot!.querySelectorAll('button')).find((b) => b.textContent === label) as HTMLButtonElement;
const ohost = () => document.querySelector<HTMLElement>('[data-perfect-front-overlay]');
const click = (t: EventTarget, init: Record<string, unknown> = {}) => {
  const ev = new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, ...init });
  t.dispatchEvent(ev);
  return ev;
};
const key = (k: string, t: EventTarget = document.body) =>
  t.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, composed: true }));

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<main><button id="b1">Comprar</button></main>';
});
afterEach(() => {
  api?.destroy();
  api = null;
  vi.useRealTimers();
  vi.doUnmock('../src/capture');
  localStorage.clear();
  document.body.innerHTML = '';
});

describe('lanzador', () => {
  it('está presente en IDLE con texto, insignia 0 y accesible', () => {
    boot();
    const main = lq<HTMLButtonElement>('.pf-ln-main')!;
    expect(main.localName).toBe('button');
    expect(main.textContent).toContain('Comentar');
    expect(lq('.pf-ln-badge')!.textContent).toBe('0');
    expect(main.getAttribute('aria-label')).toContain('Comentar');
    expect(main.getAttribute('aria-pressed')).toBe('false');
    expect(lq('.pf-ln-toast')!.getAttribute('aria-live')).toBe('polite');
    expect(lq('.pf-ln-menu')!.getAttribute('role')).toBe('menu');
  });

  it('clic activa la selección, el siguiente clic normal abre el panel y Esc sale', () => {
    boot();
    const main = lq<HTMLButtonElement>('.pf-ln-main')!;
    main.click();
    expect(api!.state).toBe('SELECTING');
    expect(main.getAttribute('aria-pressed')).toBe('true');
    expect(main.textContent).toContain('Selecciona un elemento');
    expect(click(document.getElementById('b1')!).defaultPrevented).toBe(true);
    expect(api!.state).toBe('EDITING');
    key('Escape');
    expect(api!.state).toBe('IDLE');

    main.click();
    key('Escape');
    expect(api!.state).toBe('IDLE');
    expect(main.textContent).toContain('Comentar');
    main.click();
    main.click();
    expect(api!.state).toBe('IDLE');
  });

  it('Alt+clic y Ctrl+Mayús+C siguen funcionando', () => {
    boot();
    expect(click(document.getElementById('b1')!, { altKey: true }).defaultPrevented).toBe(true);
    expect(api!.state).toBe('EDITING');
    key('Escape');
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'C', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }),
    );
    expect(api!.state).toBe('SELECTING');
  });

  it('menú: botón abre, Esc cierra y vuelve el foco', () => {
    boot();
    const more = lq<HTMLButtonElement>('.pf-ln-more')!;
    more.click();
    expect(more.getAttribute('aria-expanded')).toBe('true');
    expect(lq('.pf-ln-menu')!.hidden).toBe(false);
    key('Escape', lq('.pf-ln-menu')!);
    expect(lq('.pf-ln-menu')!.hidden).toBe(true);
    expect(more.getAttribute('aria-expanded')).toBe('false');
  });

  it('clic derecho abre el menú; un clic fuera lo cierra sin bloquear la página', () => {
    boot();
    lq('.pf-ln-main')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, composed: true }));
    expect(lq('.pf-ln-menu')!.hidden).toBe(false);
    const spy = vi.fn();
    document.getElementById('b1')!.addEventListener('click', spy);
    expect(click(document.getElementById('b1')!).defaultPrevented).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(lq('.pf-ln-menu')!.hidden).toBe(true);
  });

  it("'Ocultar capa' deja la pestaña 'Mostrar capa' y se puede reactivar", () => {
    boot();
    lq<HTMLButtonElement>('.pf-ln-more')!.click();
    lbtn('Ocultar capa').click();
    expect(localStorage.getItem(LAYER_KEY)).toBe('off');
    expect(api!.isEnabled()).toBe(false);
    expect(ohost()).toBeNull();
    expect(lq('.pf-ln-group')!.hidden).toBe(true);
    const tab = lq<HTMLButtonElement>('.pf-ln-tab')!;
    expect(tab.hidden).toBe(false);
    expect(tab.textContent).toBe('Mostrar capa');
    tab.click();
    expect(localStorage.getItem(LAYER_KEY)).toBe('on');
    expect(api!.isEnabled()).toBe(true);
    expect(ohost()).not.toBeNull();
    expect(lq('.pf-ln-group')!.hidden).toBe(false);
  });

  it('con pf:layer=off arranca solo con la pestaña y sin aviso', () => {
    localStorage.setItem(LAYER_KEY, 'off');
    boot();
    expect(lq('.pf-ln-tab')!.hidden).toBe(false);
    expect(lq('.pf-ln-toast')!.hidden).toBe(true);
    expect(localStorage.getItem(HINT_KEY)).toBeNull();
  });

  it('el aviso sale una sola vez por origen, se descarta y se autodescarta', () => {
    vi.useFakeTimers();
    boot();
    const toast = lq('.pf-ln-toast')!;
    expect(toast.hidden).toBe(false);
    expect(toast.textContent).toContain('Alt+clic');
    expect(localStorage.getItem(HINT_KEY)).toBe('1');
    vi.advanceTimersByTime(6100);
    expect(toast.hidden).toBe(true);
    api!.destroy();
    boot();
    expect(lq('.pf-ln-toast')!.hidden).toBe(true);

    api!.destroy();
    localStorage.clear();
    boot();
    lq<HTMLButtonElement>('.pf-ln-toastx')!.click();
    expect(lq('.pf-ln-toast')!.hidden).toBe(true);
  });

  it('no hay lanzador en iframes (la capa sí funciona con Alt+clic)', () => {
    const fake = Object.create(window) as Window;
    Object.defineProperty(fake, 'top', { value: {} });
    Object.defineProperty(fake, '__pf', { value: undefined, writable: true, configurable: true });
    api = bootPage({ token: 't', base: '/__pf', fetch: okFetch(), window: fake });
    expect(lhost()).toBeNull();
    expect(ohost()).not.toBeNull();
    expect(click(document.getElementById('b1')!, { altKey: true }).defaultPrevented).toBe(true);
    expect(api.state).toBe('EDITING');
  });

  it('el lanzador se oculta durante la captura', async () => {
    vi.resetModules();
    let during = '';
    vi.doMock('../src/capture', () => ({
      captureViewport: vi.fn(async () => {
        during = lhost()!.style.visibility;
        return { mimeType: 'image/png', dataBase64: 'iVBORw0KGgo=' };
      }),
    }));
    const mod = await import('../src/boot-core');
    api = mod.bootPage({ token: 't', base: '/__pf', fetch: okFetch() });
    click(document.getElementById('b1')!, { altKey: true });
    const sr = ohost()!.shadowRoot!;
    (sr.querySelector('#pf-ov-shot') as HTMLInputElement).checked = true;
    (sr.querySelector('textarea') as HTMLTextAreaElement).value = 'x';
    Array.from(sr.querySelectorAll('button')).find((b) => b.textContent === 'Guardar')!.click();
    await vi.waitFor(() => expect(api!.state).toBe('SELECTING'));
    expect(during).toBe('hidden');
    expect(lhost()!.style.visibility).toBe('');
  });
});
