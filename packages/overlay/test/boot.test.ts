// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateCommentRequestSchema } from '@perfect-front/shared';
import { bootPage, LAYER_KEY, type PfApi } from '../src/boot-core';

const TOKEN = 'tok-123';
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>;

function comment(over: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    status: 'pending',
    scope: 'element',
    comment: 'Hacer más grande el botón',
    createdAt: '2026-10-04T10:00:00.000Z',
    location: { route: '/', selector: '#b1', selectorCandidates: ['button#b1'] },
    elementRect: { x: 0, y: 0, width: 10, height: 10 },
    ...over,
  };
}

let api: PfApi | null = null;
let fetchMock: FetchMock;

function makeFetch(comments: unknown[] = [], post: () => Response = () => json({ ok: true, data: { id: 'c9', collection: 'inbox', route: '/' } })) {
  fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url.endsWith('/comments')) return json({ ok: true, comments });
    if (url.endsWith('/comment') && init?.method === 'POST') return post();
    return json({ ok: false, error: { code: 'not_found', message: 'nope' } }, 404);
  });
  return fetchMock;
}

const boot = (f = makeFetch()) => (api = bootPage({ token: TOKEN, base: '/__pf', fetch: f }));

const overlayHost = () => document.querySelector<HTMLElement>('[data-perfect-front-overlay]');
const pinsHost = () => document.querySelector<HTMLElement>('[data-perfect-front-pins]');
const osr = () => overlayHost()!.shadowRoot!;
const q = <T extends Element = HTMLElement>(sel: string) => osr().querySelector(sel) as T | null;
const btn = (label: string) =>
  Array.from(osr().querySelectorAll('button')).find((b) => b.textContent === label) as HTMLButtonElement;
const launcherHost = () => document.querySelector<HTMLElement>('[data-perfect-front-launcher]');
const lq = <T extends Element = HTMLElement>(sel: string) => launcherHost()?.shadowRoot?.querySelector(sel) as T | null;
const lbtn = (label: string) =>
  Array.from(launcherHost()!.shadowRoot!.querySelectorAll('button')).find((b) => b.textContent === label) as HTMLButtonElement;
const pins = () => Array.from(pinsHost()?.shadowRoot?.querySelectorAll('.pf-pin') ?? []);
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise<void>((r) => setTimeout(r, 0));
};

const fire = (t: EventTarget, type: string, init: Record<string, unknown> = {}) => {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, ...init });
  t.dispatchEvent(ev);
  return ev;
};
const keydown = (k: string, init: Record<string, unknown> = {}, t: EventTarget = document.body) =>
  t.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, composed: true, ...init }));

function page() {
  document.body.innerHTML = `
    <main id="app">
      <a id="lnk" href="/other">Enlace</a>
      <div id="outer"><section id="mid"><button id="b1" type="button">Comprar</button></section></div>
    </main>`;
  document.title = 'Mi página';
}

beforeEach(() => {
  localStorage.clear();
  page();
});

afterEach(() => {
  api?.destroy();
  api = null;
  localStorage.clear();
  document.body.innerHTML = '';
});

describe('boot', () => {
  it('monta el overlay, expone window.__pf y deja la capa activa por defecto', async () => {
    const a = boot();
    expect(window.__pf).toBe(a);
    expect(typeof a.version).toBe('string');
    expect(a.isEnabled()).toBe(true);
    expect(a.state).toBe('IDLE');
    expect(overlayHost()).not.toBeNull();
    expect(pinsHost()).not.toBeNull();
    await flush();
    a.destroy();
    expect(window.__pf).toBeUndefined();
    expect(overlayHost()).toBeNull();
    expect(pinsHost()).toBeNull();
  });

  it('es idempotente: un segundo boot no monta de nuevo', () => {
    const a = boot();
    const b = bootPage({ token: 'otro', base: '/__pf', fetch: makeFetch() });
    expect(b).toBe(a);
    expect(document.querySelectorAll('[data-perfect-front-overlay]').length).toBe(1);
    expect(document.querySelectorAll('[data-perfect-front-pins]').length).toBe(1);
  });

  it("localStorage['pf:layer']='off' arranca apagado, sin pines ni captura de clics", () => {
    localStorage.setItem(LAYER_KEY, 'off');
    const a = boot();
    expect(a.isEnabled()).toBe(false);
    expect(a.state).toBe('OFF');
    expect(overlayHost()).toBeNull();
    expect(pinsHost()).toBeNull();
    const spy = vi.fn();
    document.getElementById('b1')!.addEventListener('click', spy);
    const ev = fire(document.getElementById('b1')!, 'click', { altKey: true });
    expect(ev.defaultPrevented).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('enable()/disable() montan, desmontan y actualizan la preferencia', async () => {
    localStorage.setItem(LAYER_KEY, 'off');
    const a = boot();
    a.enable();
    expect(a.isEnabled()).toBe(true);
    expect(localStorage.getItem(LAYER_KEY)).toBe('on');
    expect(overlayHost()).not.toBeNull();
    await flush();
    a.disable();
    expect(a.isEnabled()).toBe(false);
    expect(localStorage.getItem(LAYER_KEY)).toBe('off');
    expect(overlayHost()).toBeNull();
    expect(pinsHost()).toBeNull();
    expect(a.state).toBe('OFF');
  });

  it('con localStorage bloqueado sigue funcionando', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const a = boot();
    expect(a.isEnabled()).toBe(true);
    expect(() => a.disable()).not.toThrow();
    spy.mockRestore();
    set.mockRestore();
  });
});

describe('interacción', () => {
  it('un clic normal pasa a la página; Alt+clic abre el comentario', () => {
    const a = boot();
    const spy = vi.fn();
    document.getElementById('b1')!.addEventListener('click', spy);
    const normal = fire(document.getElementById('b1')!, 'click');
    expect(normal.defaultPrevented).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(a.state).toBe('IDLE');

    const mod = fire(document.getElementById('b1')!, 'click', { altKey: true });
    expect(mod.defaultPrevented).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(a.state).toBe('EDITING');
  });

  it('Alt+mousemove resalta con la pista y sin Alt no resalta', () => {
    boot();
    fire(document.getElementById('b1')!, 'mousemove');
    expect(q('.pf-ov-highlight')!.hidden).toBe(true);
    fire(document.getElementById('b1')!, 'mousemove', { altKey: true });
    expect(q('.pf-ov-highlight')!.hidden).toBe(false);
    expect(q('.pf-ov-tip')!.hidden).toBe(false);
    expect(q('.pf-ov-tip')!.textContent).toContain('Alt+clic');
  });

  it('Ctrl+Mayús+C alterna el modo selección: ahí el clic normal comenta', () => {
    const a = boot();
    keydown('C', { ctrlKey: true, shiftKey: true });
    expect(a.state).toBe('SELECTING');
    const ev = fire(document.getElementById('lnk')!, 'click');
    expect(ev.defaultPrevented).toBe(true);
    expect(a.state).toBe('EDITING');
  });

  it('Escape cierra el panel y devuelve la capa a IDLE sin tocar la página', () => {
    const a = boot();
    fire(document.getElementById('b1')!, 'click', { altKey: true });
    keydown('Escape');
    expect(a.state).toBe('IDLE');
    expect(q('textarea')).toBeNull();
    expect(overlayHost()).not.toBeNull();
  });

  it('panel: sin pestañas Diseño/Contenido; Comentar y Niveles; alcance elemento/vista', () => {
    boot();
    fire(document.getElementById('b1')!, 'click', { altKey: true });
    const tabs = Array.from(osr().querySelectorAll('[role="tab"]')).map((t) => t.textContent);
    expect(tabs.some((t) => t?.includes('Diseño') || t?.includes('Contenido'))).toBe(false);
    expect(tabs.some((t) => t?.startsWith('Niveles'))).toBe(true);
    expect(tabs.some((t) => t?.startsWith('Comentar'))).toBe(true);
    expect(q<HTMLTextAreaElement>('textarea')!.placeholder).toBe('Qué habría que cambiar acá…');
    expect(btn('Este elemento').getAttribute('aria-pressed')).toBe('true');
    btn('Toda la vista').click();
    expect(btn('Toda la vista').getAttribute('aria-pressed')).toBe('true');
    expect(q('.pf-ov-title')!.textContent).toBe('Toda la vista');
  });

  it('flechas padre/hijo (botones y teclado) y lista de Niveles navegable', () => {
    boot();
    fire(document.getElementById('b1')!, 'click', { altKey: true });
    expect(q('.pf-ov-src')!.textContent).toBe('#b1');
    (osr().querySelector('[aria-label^="Elemento padre"]') as HTMLButtonElement).click();
    expect(q('.pf-ov-src')!.textContent).toBe('#mid');
    keydown('ArrowUp', {}, osr().querySelector('[aria-label^="Elemento padre"]')!);
    expect(q('.pf-ov-src')!.textContent).toBe('#outer');
    keydown('ArrowDown', {}, osr().querySelector('[aria-label^="Elemento hijo"]')!);
    expect(q('.pf-ov-src')!.textContent).toBe('#mid');
    // Las flechas dentro del textarea no se secuestran.
    keydown('ArrowUp', {}, q('textarea')!);
    expect(q('.pf-ov-src')!.textContent).toBe('#mid');

    (osr().querySelector('#pf-ov-tab-levels') as HTMLButtonElement).click();
    const items = Array.from(osr().querySelectorAll<HTMLButtonElement>('.pf-ov-level'));
    expect(items.map((i) => i.textContent)).toEqual(['body', 'main#app', 'div#outer', 'section#mid']);
    items[1]!.click();
    expect(q('.pf-ov-src')!.textContent).toBe('#app');
    expect(osr().querySelector('.pf-ov-level[aria-current="true"]')!.textContent).toBe('main#app');
  });

  it('nombre de componente React y cadena "en A < B" desde un fiber simulado', () => {
    const el = document.getElementById('b1')!;
    function Button() {}
    function Card() {}
    function Page() {}
    function Provider() {}
    const fiber = {
      type: 'button',
      return: {
        type: Button,
        return: {
          type: Provider,
          return: { type: { displayName: 'Card' }, return: { type: { render: Page }, return: null } },
        },
      },
    };
    (el as unknown as Record<string, unknown>)['__reactFiber$abc123'] = fiber;
    void Card;
    boot();
    fire(el, 'click', { altKey: true });
    expect(q('.pf-ov-title')!.textContent).toBe('Button');
    expect(q('.pf-ov-chain')!.textContent).toBe('en Card < Page');
    expect(q('.pf-ov-foot .pf-ov-path')!.textContent).toContain('Button < Card < Page');
  });

  it('un elemento fuera de React no muestra cadena', () => {
    boot();
    fire(document.getElementById('lnk')!, 'click', { altKey: true });
    expect(q('.pf-ov-title')!.textContent).toBe('a#lnk');
    expect(q('.pf-ov-chain')!.hidden).toBe(true);
  });

  it('archivo:línea solo con data-pf-src (del nodo o su ancestro)', async () => {
    document.getElementById('mid')!.setAttribute('data-pf-src', 'src/components/Landing.tsx:103');
    boot();
    fire(document.getElementById('b1')!, 'click', { altKey: true });
    expect(q('.pf-ov-src')!.textContent).toBe('Landing.tsx:103');
    expect(q('.pf-ov-src')!.title).toBe('src/components/Landing.tsx:103');
    q<HTMLTextAreaElement>('textarea')!.value = 'x';
    btn('Guardar').click();
    await flush();
    const body = JSON.parse(String(fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/comment'))![1]!.body));
    expect(body.location.componentHint).toContain('Landing.tsx:103');
  });
});

describe('pines y contador', () => {
  it('dibuja pines desde GET /comments, cuenta los no ubicables y manda X-PF-Token', async () => {
    const f = makeFetch([
      comment(),
      comment({ id: 'c2', comment: 'Perdido', createdAt: '2026-10-04T11:00:00.000Z', location: { route: '/', selector: '#no-existe', selectorCandidates: [] } }),
      comment({ id: 'c3', comment: 'Otra ruta', createdAt: '2026-10-04T12:00:00.000Z', location: { route: '/otra', selector: '#b1' } }),
      comment({ id: 'c4', status: 'resolved', comment: 'Resuelto' }),
      comment({ id: 'c5', scope: 'view', comment: 'De toda la vista', createdAt: '2026-10-04T13:00:00.000Z', location: { route: '/', selector: null } }),
    ]);
    boot(f);
    await vi.waitFor(() => expect(pins().length).toBe(1));
    expect(pins()[0]!.textContent).toContain('1');
    expect(pins()[0]!.querySelector('[role="tooltip"]')!.textContent).toBe('Hacer más grande el botón');
    expect(lq('.pf-ln-badge')!.textContent).toBe('4');
    lbtn('Ver comentarios').click();
    expect(lq('.pf-ln-info')!.textContent).toContain('4 pendientes');
    expect(lq('.pf-ln-info')!.textContent).toContain('3 en esta ruta');
    const get = f.mock.calls.find((c) => String(c[0]) === '/__pf/comments')!;
    expect((get[1]!.headers as Record<string, string>)['X-PF-Token']).toBe(TOKEN);
  });

  it('el selector candidato ubica el pin cuando el principal falla', async () => {
    boot(makeFetch([comment({ location: { route: '/', selector: '#viejo', selectorCandidates: ['section#mid > button'] } })]));
    await vi.waitFor(() => expect(pins().length).toBe(1));
  });

  it('refresca al navegar (pushState) y limpia el patch al desmontar', async () => {
    const original = history.pushState;
    boot(makeFetch([comment({ location: { route: '/b', selector: '#b1' } })]));
    await vi.waitFor(() => expect(lq('.pf-ln-badge')!.textContent).toBe('1'));
    expect(pins().length).toBe(0);
    expect(history.pushState).not.toBe(original);
    history.pushState(null, '', '/b');
    if (location.pathname !== '/b') (window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL('http://localhost:3000/b');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await vi.waitFor(() => expect(pins().length).toBe(1));
    api!.destroy();
    expect(history.pushState).toBe(original);
    history.pushState(null, '', '/');
  });

  it('si /comments falla, la página sigue sin pines y sin errores', async () => {
    boot(vi.fn<typeof fetch>(async () => json({ ok: false, error: { code: 'x', message: 'boom' } }, 500)));
    await flush();
    expect(pins().length).toBe(0);
    expect(api!.state).toBe('IDLE');
  });
});

describe('guardado', () => {
  it('POST /__pf/comment con X-PF-Token, JSON válido y refresco de pines', async () => {
    const f = makeFetch([]);
    boot(f);
    await flush();
    fire(document.getElementById('b1')!, 'click', { altKey: true });
    q<HTMLTextAreaElement>('textarea')!.value = '  Cambiar el color  ';
    btn('Guardar').click();
    await vi.waitFor(() => expect(api!.state).toBe('SELECTING'));
    const call = f.mock.calls.find((c) => String(c[0]) === '/__pf/comment')!;
    expect(call[1]!.method).toBe('POST');
    const h = call[1]!.headers as Record<string, string>;
    expect(h['X-PF-Token']).toBe(TOKEN);
    expect(h['Content-Type']).toBe('application/json');
    const body = JSON.parse(String(call[1]!.body));
    expect(body.comment).toBe('Cambiar el color');
    expect(body.scope).toBe('element');
    expect(CreateCommentRequestSchema.safeParse(body).success).toBe(true);
    // onSaved vuelve a pedir /comments
    await vi.waitFor(() => expect(f.mock.calls.filter((c) => String(c[0]) === '/__pf/comments').length).toBeGreaterThanOrEqual(2));
  });

  it('Toda la vista envía scope view', async () => {
    const f = makeFetch();
    boot(f);
    fire(document.getElementById('b1')!, 'click', { altKey: true });
    btn('Toda la vista').click();
    q<HTMLTextAreaElement>('textarea')!.value = 'Todo raro';
    keydown('Enter', { ctrlKey: true }, q('textarea')!);
    await vi.waitFor(() => expect(api!.state).toBe('SELECTING'));
    const body = JSON.parse(String(f.mock.calls.find((c) => String(c[0]) === '/__pf/comment')![1]!.body));
    expect(body.scope).toBe('view');
    expect(body.location.selector).toBeNull();
    expect(CreateCommentRequestSchema.safeParse(body).success).toBe(true);
  });

  it('un error del servidor conserva el texto y muestra el mensaje', async () => {
    boot(makeFetch([], () => json({ ok: false, error: { code: 'unauthorized', message: 'Token inválido' } }, 401)));
    fire(document.getElementById('b1')!, 'click', { altKey: true });
    const ta = q<HTMLTextAreaElement>('textarea')!;
    ta.value = 'No debo perder esto';
    btn('Guardar').click();
    await vi.waitFor(() => expect(api!.state).toBe('ERROR'));
    expect(q('.pf-ov-error')!.textContent).toContain('Token inválido');
    expect(q<HTMLTextAreaElement>('textarea')!.value).toBe('No debo perder esto');
    expect(q<HTMLTextAreaElement>('textarea')!.disabled).toBe(false);
  });

  it('una respuesta no JSON también conserva el texto', async () => {
    boot(makeFetch([], () => new Response('<html>502</html>', { status: 502 })));
    fire(document.getElementById('b1')!, 'click', { altKey: true });
    q<HTMLTextAreaElement>('textarea')!.value = 'texto';
    btn('Guardar').click();
    await vi.waitFor(() => expect(api!.state).toBe('ERROR'));
    expect(q('.pf-ov-error')!.textContent).toContain('502');
    expect(q<HTMLTextAreaElement>('textarea')!.value).toBe('texto');
  });
});

describe('captura opcional', () => {
  it('«Incluir captura» captura (host oculto) y la envía en screenshot', async () => {
    vi.resetModules();
    vi.doMock('../src/capture', () => ({
      captureViewport: vi.fn(async () => {
        expect(overlayHost()!.style.visibility).toBe('hidden');
        return { mimeType: 'image/png', dataBase64: 'iVBORw0KGgo=' };
      }),
    }));
    const mod = await import('../src/boot-core');
    const f = makeFetch();
    api = mod.bootPage({ token: TOKEN, base: '/__pf', fetch: f });
    fire(document.getElementById('b1')!, 'click', { altKey: true });
    const box = q<HTMLInputElement>('#pf-ov-shot')!;
    expect(box.type).toBe('checkbox');
    expect(box.parentElement!.textContent).toBe('Incluir captura');
    box.checked = true;
    q<HTMLTextAreaElement>('textarea')!.value = 'con captura';
    btn('Guardar').click();
    await vi.waitFor(() => expect(api!.state).toBe('SELECTING'));
    const body = JSON.parse(String(f.mock.calls.find((c) => String(c[0]) === '/__pf/comment')![1]!.body));
    expect(body.screenshot).toEqual({ mimeType: 'image/png', dataBase64: 'iVBORw0KGgo=' });
    expect(CreateCommentRequestSchema.safeParse(body).success).toBe(true);
    expect(overlayHost()!.style.visibility).toBe('');
    vi.doUnmock('../src/capture');
  });

  it('sin marcar la casilla no se captura', async () => {
    const f = makeFetch();
    boot(f);
    fire(document.getElementById('b1')!, 'click', { altKey: true });
    q<HTMLTextAreaElement>('textarea')!.value = 'sin captura';
    btn('Guardar').click();
    await vi.waitFor(() => expect(api!.state).toBe('SELECTING'));
    const body = JSON.parse(String(f.mock.calls.find((c) => String(c[0]) === '/__pf/comment')![1]!.body));
    expect(body.screenshot).toBeUndefined();
  });
});
