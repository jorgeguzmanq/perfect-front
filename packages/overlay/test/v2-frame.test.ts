// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommentLocationSchema } from '@perfect-front/shared';
import { bootPage, type PfApi } from '../src/boot-core';
import { buildRequest, snapshotElement } from '../src/context';
import { CROSS_ORIGIN_MSG, frameInfo, isCrossOriginFrame, locateElement } from '../src/frame';
import { createPins } from '../src/pins';

const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise<void>((r) => setTimeout(r, 0));
};

const restores: Array<() => void> = [];
let api: PfApi | null = null;
afterEach(() => {
  api?.destroy();
  api = null;
  for (const r of restores.splice(0)) r();
  document.body.innerHTML = '';
});

/** Simula que `window` es un marco dentro de un anfitrión (top distinto, frameElement dado). */
function asFrame(win: Window, frameElement: Element | null) {
  for (const [k, v] of [['top', {}], ['frameElement', frameElement]] as const) {
    const prev = Object.getOwnPropertyDescriptor(win, k);
    Object.defineProperty(win, k, { configurable: true, get: () => v });
    restores.push(() => (prev ? Object.defineProperty(win, k, prev) : delete (win as unknown as Record<string, unknown>)[k]));
  }
}

/** `<iframe>` del anfitrión con su propio documento accesible (mismo origen) o null (otro origen). */
function iframe(host: Document, attrs: Record<string, string>, inner: Document | null) {
  const f = host.createElement('iframe');
  for (const [k, v] of Object.entries(attrs)) {
    if (k !== 'src') f.setAttribute(k, v);
  }
  // `src` solo se simula: así happy-dom no intenta cargar la página del marco.
  const fake = attrs.src;
  if (fake) {
    const get = f.getAttribute.bind(f);
    f.getAttribute = (n: string) => (n === 'src' ? fake : get(n));
  }
  Object.defineProperty(f, 'contentDocument', { configurable: true, get: () => inner });
  host.body.appendChild(f);
  return f;
}
const innerDoc = (html: string) => {
  const d = document.implementation.createHTMLDocument('marco');
  d.body.innerHTML = html;
  return d;
};

describe('frameInfo y la request', () => {
  it('ventana superior: sin frame', () => {
    document.body.innerHTML = '<button id="b">x</button>';
    expect(frameInfo(document)).toBeNull();
    const req = buildRequest(document, 'hola', snapshotElement(document.getElementById('b')!)) as { location: Record<string, unknown> };
    expect(req.location.frame).toBeUndefined();
  });

  it('dentro de un marco guarda url, selector del iframe y ruta anfitriona; la request valida', () => {
    document.body.innerHTML = '<button id="b" data-pf-src="src/B.tsx:3">x</button>';
    const host = document.implementation.createHTMLDocument('host');
    const f = iframe(host, { id: 'preview', src: '/embed' }, null);
    asFrame(window, f);
    const info = frameInfo(document)!;
    expect(info.url).toBe(document.location.href);
    expect(info.selector).toBe('#preview');
    const req = buildRequest(document, 'hola', snapshotElement(document.getElementById('b')!)) as { location: Record<string, unknown> };
    expect(req.location.frame).toEqual(info);
    expect(req.location.source).toEqual({ file: 'src/B.tsx', line: 3 });
    expect(CommentLocationSchema.safeParse(req.location).success).toBe(true);
  });

  it('anfitrión ilegible (otro origen): frame con selector null, sin romper', () => {
    asFrame(window, null);
    expect(frameInfo(document)).toMatchObject({ selector: null });
  });
});

describe('locateElement: entrar en el marco', () => {
  it('resuelve el selector dentro del iframe del mismo origen (por frame.selector)', () => {
    document.body.innerHTML = '';
    const inner = innerDoc('<button id="buy">Comprar</button>');
    const f = iframe(document, { id: 'preview' }, inner);
    const r = locateElement(document, { selector: '#buy', frame: { url: 'http://x.test/embed', selector: '#preview' } });
    expect(r).toEqual({ ok: true, el: inner.getElementById('buy'), frameEl: f });
  });

  it('sin frame.selector (comentario de otra versión) también lo busca en los marcos', () => {
    document.body.innerHTML = '<p id="top">arriba</p>';
    const inner = innerDoc('<button id="buy">Comprar</button>');
    iframe(document, {}, inner);
    const r = locateElement(document, { selector: '#buy' });
    expect(r.ok && r.el).toBe(inner.getElementById('buy'));
    expect(locateElement(document, { selector: '#top' })).toMatchObject({ ok: true, frameEl: null });
  });

  it('marco de otro origen: motivo cross-origin; si no existe, not-found', () => {
    document.body.innerHTML = '';
    const f = iframe(document, { id: 'ext', src: 'https://otro.test/' }, null);
    expect(isCrossOriginFrame(f)).toBe(true);
    expect(locateElement(document, { selector: '#x', frame: { url: 'https://otro.test/', selector: '#ext' } })).toEqual({ ok: false, reason: 'cross-origin' });
    document.body.innerHTML = '';
    expect(locateElement(document, { selector: '#x' })).toEqual({ ok: false, reason: 'not-found' });
  });
});

describe('pines y cajón con marcos', () => {
  const comment = (frame: unknown) => ({
    id: 'c1',
    status: 'pending',
    scope: 'element',
    comment: 'hola',
    location: { route: '/', selector: '#b', frame },
  });

  it('la ventana superior no cuenta los comentarios de marco; el marco sí los pinta', async () => {
    document.body.innerHTML = '<button id="b">x</button>';
    const frame = { url: 'http://localhost/embed', selector: '#p' };
    const top = createPins({ loadComments: async () => [comment(frame) as never] });
    await top.refresh();
    expect(top.here).toBe(0);
    top.destroy();
    asFrame(window, null);
    const inFrame = createPins({ loadComments: async () => [comment(frame) as never] });
    await inFrame.refresh();
    expect(inFrame.here).toBe(1);
    expect(inFrame.located).toBe(1);
    inFrame.destroy();
  });

  async function openDrawer(frame: unknown) {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      const body = url.endsWith('/comments') ? { ok: true, data: { comments: [comment(frame)] } } : { ok: true, groups: [], requests: [] };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    api = bootPage({ token: 't', base: '/__pf', fetch: fetchMock });
    const sr = document.querySelector<HTMLElement>('[data-perfect-front-launcher]')!.shadowRoot!;
    sr.querySelector<HTMLElement>('[aria-label="Más opciones de la capa"]')!.click();
    Array.from(sr.querySelectorAll('button')).find((b) => b.textContent === 'Comentarios')!.click();
    await flush();
    return sr;
  }

  it('«ir al elemento» desplaza el iframe y el nodo dentro del marco', async () => {
    document.body.innerHTML = '';
    const inner = innerDoc('<button id="b">Comprar</button>');
    const f = iframe(document, { id: 'p' }, inner);
    const spyFrame = vi.fn();
    const spyEl = vi.fn();
    (f as unknown as { scrollIntoView: unknown }).scrollIntoView = spyFrame;
    (inner.getElementById('b') as unknown as { scrollIntoView: unknown }).scrollIntoView = spyEl;
    const sr = await openDrawer({ url: 'http://localhost/embed', selector: '#p' });
    sr.querySelector<HTMLElement>('.pf-dw-ci')!.click();
    expect(spyFrame).toHaveBeenCalled();
    expect(spyEl).toHaveBeenCalled();
  });

  it('marco de otro origen: aviso claro y nada se rompe', async () => {
    document.body.innerHTML = '';
    iframe(document, { id: 'p', src: 'https://otro.test/' }, null);
    const sr = await openDrawer({ url: 'https://otro.test/', selector: '#p' });
    sr.querySelector<HTMLElement>('.pf-dw-ci')!.click();
    expect(sr.textContent).toContain(CROSS_ORIGIN_MSG);
  });
});
