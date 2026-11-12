// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootPage, type PfApi } from '../src/boot-core';
import { createOverlay, type OverlayHandle } from '../src/index';
import { NO_SOURCE, targetFromSrc, targetOfComment } from '../src/open-code';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise<void>((r) => setTimeout(r, 0));
};

let api: PfApi | null = null;
let overlay: OverlayHandle | null = null;
afterEach(() => {
  api?.destroy();
  overlay?.destroy();
  api = overlay = null;
  document.body.innerHTML = '';
  try {
    localStorage.clear();
  } catch {
    /* sin almacenamiento */
  }
});

describe('destino de «Abrir en el código»', () => {
  it('data-pf-src, location.source y el archivo:línea del hint', () => {
    expect(targetFromSrc('src/App.tsx:12:3')).toEqual({ file: 'src/App.tsx', line: 12, column: 3 });
    expect(targetFromSrc('src/App.tsx:12')).toEqual({ file: 'src/App.tsx', line: 12 });
    expect(targetFromSrc(null)).toBeNull();
    expect(targetOfComment({ location: { source: { file: 'a.tsx', line: null } } })).toEqual({ file: 'a.tsx', line: 1 });
    expect(targetOfComment({ location: { componentHint: 'Card < Page (src/Card.tsx:40)' } })).toEqual({ file: 'src/Card.tsx', line: 40 });
    expect(targetOfComment({ location: { componentHint: 'Card' } })).toBeNull();
  });
});

const row = (id: string, location: Record<string, unknown>) => ({
  id,
  status: 'pending',
  scope: 'element',
  comment: `texto ${id}`,
  createdAt: '2026-10-04T10:00:00.000Z',
  updatedAt: '2026-10-04T10:00:00.000Z',
  location: { route: '/', selector: '#b1', selectorCandidates: ['#b1'], ...location },
  elementRect: { x: 0, y: 0, width: 10, height: 10 },
});

async function openDrawer(comments: unknown[], openRes: () => Response) {
  const calls: Array<{ url: string; method: string; body: unknown; token: string | undefined }> = [];
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.endsWith('/open')) {
      calls.push({ url, method, body: JSON.parse(String(init?.body)), token: (init?.headers as Record<string, string>)['X-PF-Token'] });
      return openRes();
    }
    if (url.endsWith('/comments')) return json({ ok: true, data: { comments } });
    if (url.endsWith('/groups') || url.endsWith('/agent/requests')) return json({ ok: true, groups: [], requests: [] });
    return json({ ok: false, error: { code: 'not_found', message: 'nope' } }, 404);
  });
  document.body.innerHTML = '<main><button id="b1">Comprar</button></main>';
  api = bootPage({ token: 'tok', base: '/__pf', fetch: fetchMock });
  const sr = document.querySelector<HTMLElement>('[data-perfect-front-launcher]')!.shadowRoot!;
  sr.querySelector<HTMLElement>('[aria-label="Más opciones de la capa"]')!.click();
  Array.from(sr.querySelectorAll('button')).find((b) => b.textContent === 'Comentarios')!.click();
  await flush();
  return { sr, calls, codeBtns: () => Array.from(sr.querySelectorAll<HTMLButtonElement>('.pf-dw [data-pf-open]')) };
}

describe('cajón: ↗ Abrir en el código', () => {
  it('hace POST /open con {file,line,column} y confirma', async () => {
    const { sr, calls, codeBtns } = await openDrawer([row('c1', { source: { file: 'src/Buy.tsx', line: 7, column: 2 } })], () => json({ ok: true }));
    const [b] = codeBtns();
    expect(b!.disabled).toBe(false);
    b!.click();
    await flush();
    expect(calls).toEqual([{ url: '/__pf/open', method: 'POST', body: { file: 'src/Buy.tsx', line: 7, column: 2 }, token: 'tok' }]);
    expect(sr.textContent).toContain('Abriendo src/Buy.tsx:7');
  });

  it('muestra el mensaje del servidor si no hay editor (editor_not_found)', async () => {
    const { sr, codeBtns } = await openDrawer(
      [row('c1', { componentHint: 'Buy (src/Buy.tsx:7)' })],
      () => json({ ok: false, error: { code: 'editor_not_found', message: 'No hay editor configurado: define EDITOR.' } }, 404),
    );
    codeBtns()[0]!.click();
    await flush();
    expect(sr.textContent).toContain('No hay editor configurado: define EDITOR.');
  });

  it('sin archivo de origen queda deshabilitado con tooltip y no llama al servidor', async () => {
    const { calls, codeBtns } = await openDrawer([row('c1', {})], () => json({ ok: true }));
    const [b] = codeBtns();
    expect(b!.disabled).toBe(true);
    expect(b!.title).toBe(NO_SOURCE);
    b!.click();
    await flush();
    expect(calls).toHaveLength(0);
  });
});

describe('editor: ↗ en la cabecera', () => {
  const start = (open: ((t: unknown) => Promise<void>) | null) => {
    document.body.innerHTML = '<main><button id="b1" data-pf-src="src/Buy.tsx:7:2">Comprar</button><p id="p">sin fuente</p></main>';
    overlay = createOverlay({ onSubmit: async () => ({ id: 'a', collection: 'b', route: '/' }), openCode: open ? { open } : null });
    overlay.enable();
  };
  const pick = (id: string) => document.getElementById(id)!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
  const btn = () => document.querySelector<HTMLElement>('[data-perfect-front-overlay]')!.shadowRoot!.querySelector<HTMLButtonElement>('.pf-ov-tools [data-pf-open]');

  it('abre el archivo:línea:columna del nodo enfocado', async () => {
    const open = vi.fn(async () => undefined);
    start(open);
    pick('b1');
    expect(btn()!.disabled).toBe(false);
    btn()!.click();
    await flush();
    expect(open).toHaveBeenCalledWith({ file: 'src/Buy.tsx', line: 7, column: 2 });
  });

  it('sin data-pf-src está deshabilitado; sin puerto no se muestra', () => {
    start(vi.fn(async () => undefined));
    pick('p');
    expect(btn()!.disabled).toBe(true);
    expect(btn()!.title).toBe(NO_SOURCE);
    overlay!.destroy();
    start(null);
    pick('b1');
    expect(btn()).toBeNull();
  });
});
