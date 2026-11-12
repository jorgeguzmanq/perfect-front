// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootPage, type PfApi } from '../src/boot-core';
import { createDrawer } from '../src/drawer';
import type { QueueComment } from '../src/groups';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise<void>((r) => setTimeout(r, 0));
};

const row = (id: string, text: string, updatedAt = '2026-10-04T10:00:00.000Z') => ({
  id,
  status: 'pending',
  scope: 'element',
  comment: text,
  createdAt: updatedAt,
  updatedAt,
  location: { route: '/', selector: '#b1', selectorCandidates: ['#b1'] },
  elementRect: { x: 0, y: 0, width: 10, height: 10 },
});

let api: PfApi | null = null;
afterEach(() => {
  api?.destroy();
  api = null;
  document.body.innerHTML = '';
  try {
    localStorage.clear();
  } catch {
    /* sin almacenamiento */
  }
});

/** Servidor simulado: lista mutable de comentarios con PATCH (control de updatedAt) y DELETE. */
function fakeServer(initial: ReturnType<typeof row>[]) {
  let comments = [...initial];
  const calls: Array<{ method: string; url: string; headers: Record<string, string>; body?: unknown }> = [];
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, headers, body });
    if (url.endsWith('/comments') && method === 'GET') return json({ ok: true, data: { comments } });
    const m = /\/comments\/([^/]+)$/.exec(url);
    if (m && method === 'PATCH') {
      const cur = comments.find((c) => c.id === m[1]);
      if (!cur) return json({ ok: false, error: { code: 'not_found', message: 'no existe' } }, 404);
      const exp = headers['x-pf-expected-updated-at'];
      if (exp && exp !== cur.updatedAt) {
        return json({ ok: false, error: { code: 'conflict', message: 'El comentario cambió desde que lo abriste; recárgalo' } }, 409);
      }
      Object.assign(cur, { comment: (body as { comment: string }).comment, updatedAt: '2026-10-05T00:00:00.000Z' });
      return json({ ok: true, comment: cur });
    }
    if (m && method === 'DELETE') {
      comments = comments.filter((c) => c.id !== m[1]);
      return json({ ok: true, deleted: { id: m[1] } });
    }
    if (url.endsWith('/groups') || url.endsWith('/agent/requests')) return json({ ok: true, groups: [], requests: [] });
    return json({ ok: false, error: { code: 'not_found', message: 'nope' } }, 404);
  });
  return { fetchMock, calls, mutate: (id: string, text: string) => Object.assign(comments.find((c) => c.id === id)!, { comment: text, updatedAt: '2026-10-06T00:00:00.000Z' }) };
}

async function openDrawer(fetchMock: typeof fetch) {
  document.body.innerHTML = '<main><button id="b1">Comprar</button></main>';
  api = bootPage({ token: 'tok', base: '/__pf', fetch: fetchMock });
  const host = document.querySelector<HTMLElement>('[data-perfect-front-launcher]')!;
  const sr = host.shadowRoot!;
  sr.querySelector<HTMLElement>('[aria-label="Más opciones de la capa"]')!.click();
  Array.from(sr.querySelectorAll('button')).find((b) => b.textContent === 'Comentarios')!.click();
  await flush();
  const drawer = () => sr.querySelector('.pf-dw')!;
  const btn = (label: string) => Array.from(drawer().querySelectorAll('button')).find((b) => b.textContent?.trim() === label || b.getAttribute('aria-label') === `${label} comentario`) as HTMLButtonElement | undefined;
  return { sr, drawer, btn };
}

describe('cajón: editar y eliminar comentarios guardados', () => {
  it('Editar guarda con PATCH y X-PF-Expected-Updated-At, y repinta con el texto nuevo', async () => {
    const srv = fakeServer([row('c1', 'texto viejo')]);
    const { drawer, btn } = await openDrawer(srv.fetchMock);
    expect(drawer().textContent).toContain('texto viejo');
    btn('Editar')!.click();
    const ta = drawer().querySelector('textarea')!;
    expect(ta.value).toBe('texto viejo');
    ta.value = 'texto nuevo';
    btn('Guardar')!.click();
    await flush();
    const patch = srv.calls.find((c) => c.method === 'PATCH')!;
    expect(patch.url).toBe('/__pf/comments/c1');
    expect(patch.body).toEqual({ comment: 'texto nuevo' });
    expect(patch.headers['x-pf-expected-updated-at']).toBe('2026-10-04T10:00:00.000Z');
    expect(patch.headers['x-pf-token']).toBe('tok');
    expect(drawer().querySelector('textarea')).toBeNull();
    expect(drawer().textContent).toContain('texto nuevo');
  });

  it('Esc cancela y Ctrl+Enter guarda', async () => {
    const srv = fakeServer([row('c1', 'uno')]);
    const { drawer, btn } = await openDrawer(srv.fetchMock);
    btn('Editar')!.click();
    drawer().querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(drawer().querySelector('textarea')).toBeNull();
    expect(srv.calls.some((c) => c.method === 'PATCH')).toBe(false);
    btn('Editar')!.click();
    const ta = drawer().querySelector('textarea')!;
    ta.value = 'dos';
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    await flush();
    expect(srv.calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
  });

  it('conflicto: muestra el mensaje del servidor y recarga el texto real', async () => {
    const srv = fakeServer([row('c1', 'original')]);
    const { sr, drawer, btn } = await openDrawer(srv.fetchMock);
    btn('Editar')!.click();
    srv.mutate('c1', 'cambiado por otro');
    const ta = drawer().querySelector('textarea')!;
    ta.value = 'mi edición';
    btn('Guardar')!.click();
    await flush();
    expect(sr.textContent).toContain('El comentario cambió desde que lo abriste');
    expect(drawer().textContent).toContain('cambiado por otro');
    expect(drawer().textContent).not.toContain('mi edición');
  });

  it('Eliminar pide confirmación en el cajón; Cancelar no llama al servidor; confirmar hace DELETE y refresca', async () => {
    const srv = fakeServer([row('c1', 'borrame'), row('c2', 'me quedo')]);
    const confirmSpy = vi.fn(() => true);
    (window as unknown as { confirm: unknown }).confirm = confirmSpy;
    const { sr, drawer, btn } = await openDrawer(srv.fetchMock);
    btn('Eliminar')!.click();
    expect(drawer().textContent).toContain('¿Eliminar este comentario? No se puede deshacer');
    btn('Cancelar')!.click();
    expect(drawer().textContent).not.toContain('¿Eliminar este comentario?');
    expect(srv.calls.some((c) => c.method === 'DELETE')).toBe(false);

    btn('Eliminar')!.click();
    // El botón de confirmación es el que vive dentro de la barra de alerta.
    drawer().querySelector<HTMLButtonElement>('[role="alertdialog"] .pf-dk-key--dng')!.click();
    await flush();
    const del = srv.calls.find((c) => c.method === 'DELETE')!;
    expect(del.url).toBe('/__pf/comments/c1');
    expect(del.headers['x-pf-token']).toBe('tok');
    expect(drawer().textContent).not.toContain('borrame');
    expect(drawer().textContent).toContain('me quedo');
    expect(sr.textContent).toContain('Comentario eliminado.');
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});

describe('createDrawer sin `comments`', () => {
  it('no muestra Editar ni Eliminar', async () => {
    document.body.innerHTML = '';
    const layer = document.createElement('div');
    document.body.appendChild(layer);
    const c: QueueComment = { id: 'c1', status: 'pending', comment: 'x', scope: 'element', location: { route: '/', selector: '#a' } };
    const d = createDrawer({
      doc: document,
      layer,
      load: async () => ({ comments: [c], groups: [] }),
      api: {} as never,
      route: () => '/',
    });
    d.open();
    await flush();
    expect(Array.from(layer.querySelectorAll('button')).some((b) => /^(Editar|Eliminar)/.test(b.textContent?.trim() ?? '') || /^(Editar|Eliminar) comentario/.test(b.getAttribute('aria-label') ?? ''))).toBe(false);
    d.destroy();
  });
});
