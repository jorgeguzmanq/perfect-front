// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectLive, createNotices, progressFor, LIVE_POLL_HIDDEN_MS, LIVE_POLL_VISIBLE_MS, type LiveHandle } from '../src/live';
import { createPins, type PinComment, type PinTransition } from '../src/pins';

class FakeES {
  static all: FakeES[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((m: { data: string }) => void) | null = null;
  listeners = new Map<string, Array<(e: Event) => void>>();
  closed = false;
  constructor(public url: string) {
    FakeES.all.push(this);
  }
  addEventListener(t: string, fn: (e: Event) => void) {
    this.listeners.set(t, [...(this.listeners.get(t) ?? []), fn]);
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  emit(type: string, data: object) {
    for (const fn of this.listeners.get(type) ?? []) fn({ data: JSON.stringify(data) } as unknown as Event);
  }
  fail(state: 0 | 2) {
    this.readyState = state;
    this.onerror?.();
  }
}
const ES = FakeES as unknown as typeof EventSource;

let live: LiveHandle | null = null;
const onChange = vi.fn();
const start = (extra: Partial<Parameters<typeof connectLive>[0]> = {}) =>
  (live = connectLive({ base: '/__pf/', token: 't k', onChange, EventSource: ES, ...extra }));

beforeEach(() => {
  vi.useFakeTimers();
  FakeES.all = [];
  onChange.mockReset();
});
afterEach(() => {
  live?.close();
  live = null;
  vi.useRealTimers();
});

describe('connectLive', () => {
  it('abre EventSource en {base}/events con el token por query', () => {
    start();
    expect(FakeES.all[0]!.url).toBe('/__pf/events?pf_token=t%20k');
  });

  it('agrupa ráfagas de eventos en un solo onChange (150 ms)', () => {
    start();
    const es = FakeES.all[0]!;
    es.open();
    es.emit('comment.updated', { type: 'comment.updated', commentId: 'a', status: 'in_progress' });
    es.emit('comment.resolved', { type: 'comment.resolved', commentId: 'a', status: 'resolved' });
    vi.advanceTimersByTime(149);
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(onChange).toHaveBeenCalledTimes(1);
    const [events, reason] = onChange.mock.calls[0]!;
    expect(reason).toBe('event');
    expect(events.map((e: { type: string }) => e.type)).toEqual(['comment.updated', 'comment.resolved']);
    expect(events[1]).toMatchObject({ commentId: 'a', status: 'resolved' });
  });

  it('cae a polling (3 s visible) mientras SSE no abre y lo detiene al abrir', () => {
    start();
    vi.advanceTimersByTime(LIVE_POLL_VISIBLE_MS + 200);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![1]).toBe('poll');
    FakeES.all[0]!.open();
    expect(live!.state).toBe('sse');
    onChange.mockClear();
    vi.advanceTimersByTime(LIVE_POLL_VISIBLE_MS * 3);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('sin EventSource usa solo polling; oculta, cada 15 s', () => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    const states: string[] = [];
    start({ EventSource: undefined, window: { ...window, document, addEventListener: window.addEventListener.bind(window), removeEventListener: window.removeEventListener.bind(window), EventSource: undefined } as unknown as Window, onState: (s) => states.push(s) });
    expect(live!.state === 'polling' || states.includes('polling')).toBe(true);
    vi.advanceTimersByTime(LIVE_POLL_VISIBLE_MS + 200);
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(LIVE_POLL_HIDDEN_MS);
    expect(onChange).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  it('reconecta con backoff 1 s → 10 s tras un cierre y recupera al reabrir', () => {
    start();
    FakeES.all[0]!.open();
    FakeES.all[0]!.fail(2);
    expect(live!.state).toBe('polling');
    expect(FakeES.all).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(FakeES.all).toHaveLength(2);
    FakeES.all[1]!.fail(2);
    vi.advanceTimersByTime(1999);
    expect(FakeES.all).toHaveLength(2);
    vi.advanceTimersByTime(2);
    expect(FakeES.all).toHaveLength(3);
    // el backoff topa en 10 s
    for (let i = 0; i < 5; i++) {
      FakeES.all.at(-1)!.fail(2);
      vi.advanceTimersByTime(10_000);
    }
    const n = FakeES.all.length;
    FakeES.all.at(-1)!.fail(2);
    vi.advanceTimersByTime(9999);
    expect(FakeES.all).toHaveLength(n);
    vi.advanceTimersByTime(2);
    expect(FakeES.all).toHaveLength(n + 1);
    onChange.mockClear();
    FakeES.all.at(-1)!.open();
    vi.advanceTimersByTime(200);
    expect(onChange.mock.calls.at(-1)![1]).toBe('open');
    expect(live!.state).toBe('sse');
  });

  it('en CONNECTING deja el reintento al navegador (Last-Event-ID) y hace polling', () => {
    start();
    FakeES.all[0]!.open();
    FakeES.all[0]!.fail(0);
    vi.advanceTimersByTime(LIVE_POLL_VISIBLE_MS + 200);
    expect(FakeES.all).toHaveLength(1);
    expect(FakeES.all[0]!.closed).toBe(false);
    expect(onChange).toHaveBeenCalled();
  });

  it('refetch inmediato en visibilitychange, focus y online', () => {
    start();
    FakeES.all[0]!.open();
    window.dispatchEvent(new Event('focus'));
    vi.advanceTimersByTime(160);
    expect(onChange).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('online'));
    vi.advanceTimersByTime(160);
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(160);
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(onChange.mock.calls.every((c) => c[1] === 'wake')).toBe(true);
  });

  it('close() cierra el EventSource y detiene todo', () => {
    start();
    const es = FakeES.all[0]!;
    live!.close();
    expect(es.closed).toBe(true);
    window.dispatchEvent(new Event('focus'));
    vi.advanceTimersByTime(20_000);
    expect(onChange).not.toHaveBeenCalled();
  });
});

const tr = (id: string, from: string, to: string, n: number | null, updatedAt = 'u1'): PinTransition => ({
  comment: { id, status: to, scope: 'element', comment: 'x', location: { route: '/', selector: '#a' }, updatedAt },
  from,
  to,
  n,
});

describe('createNotices', () => {
  const mk = (progress: (id: string) => { done: number; total: number } | null, openLeft = 1) => {
    const announce = vi.fn();
    const n = createNotices({ announce, progress, openLeft: () => openLeft });
    return { announce, n };
  };

  it('«Comentario #5 resuelto · 2 de 3» con acción hacia el cajón', () => {
    const { announce, n } = mk(() => ({ done: 2, total: 3 }));
    n.push([tr('c5', 'in_progress', 'resolved', 5)]);
    vi.advanceTimersByTime(500);
    expect(announce).toHaveBeenCalledWith('Comentario #5 resuelto · 2 de 3', { id: 'c5', tab: 'done' });
  });

  it('«Todo resuelto ✓» al resolverse el último', () => {
    const { announce, n } = mk(() => ({ done: 3, total: 3 }), 0);
    n.push([tr('c5', 'in_progress', 'resolved', 5)]);
    vi.advanceTimersByTime(500);
    expect(announce).toHaveBeenCalledWith('Todo resuelto ✓', { id: 'c5', tab: 'done' });
  });

  it('agrupa ráfagas en un solo aviso', () => {
    const { announce, n } = mk(() => ({ done: 2, total: 5 }));
    n.push([tr('a', 'in_progress', 'resolved', 1)]);
    vi.advanceTimersByTime(100);
    n.push([tr('b', 'in_progress', 'resolved', 2)]);
    vi.advanceTimersByTime(500);
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce.mock.calls[0]![0]).toBe('2 comentarios resueltos · 2 de 5');
  });

  it('«en curso» cuando el agente toma el comentario', () => {
    const { announce, n } = mk(() => null);
    n.push([tr('a', 'pending', 'in_progress', 3)]);
    vi.advanceTimersByTime(500);
    expect(announce).toHaveBeenCalledWith('Comentario #3 en curso', { id: 'a', tab: 'open' });
  });

  it('dedupe: no avisa de cambios propios (id+updatedAt) ni de id propio reciente', () => {
    const { announce, n } = mk(() => null);
    n.own('a', 'u1');
    n.own('b');
    n.push([tr('a', 'in_progress', 'resolved', 1, 'u1'), tr('b', 'in_progress', 'resolved', 2, 'u9')]);
    vi.advanceTimersByTime(500);
    expect(announce).not.toHaveBeenCalled();
    n.push([tr('a', 'in_progress', 'resolved', 1, 'u2')]); // otro updatedAt: cambio ajeno
    vi.advanceTimersByTime(500);
    expect(announce).toHaveBeenCalledTimes(1);
  });
});

describe('progressFor', () => {
  const cs = [
    { id: 'a', status: 'resolved', group: { id: 'g' } },
    { id: 'b', status: 'in_progress', group: { id: 'g' } },
    { id: 'c', status: 'pending' },
  ];
  it('usa la solicitud más reciente que incluye el comentario', () => {
    const reqs = [
      { id: 'r1', createdAt: '1', commentIds: ['a', 'b', 'c'], groupId: null, status: 'taken' as const },
      { id: 'r2', createdAt: '2', commentIds: ['a', 'b'], groupId: null, status: 'taken' as const },
    ];
    expect(progressFor('a', cs, reqs)).toEqual({ done: 1, total: 2 });
  });
  it('sin solicitud usa el grupo; sin grupo, null', () => {
    expect(progressFor('b', cs, [])).toEqual({ done: 1, total: 2 });
    expect(progressFor('c', cs, [])).toBeNull();
  });
});

describe('pins en vivo', () => {
  const row = (o: Partial<PinComment> = {}): PinComment => ({
    id: 'c1',
    status: 'pending',
    scope: 'element',
    comment: 'Texto',
    location: { route: '/', selector: '#card' },
    createdAt: '2026-10-04T10:00:00.000Z',
    updatedAt: 'u0',
    ...o,
  });
  let rows: PinComment[];
  const onTransitions = vi.fn();
  const pinsRoot = () => document.querySelector<HTMLElement>('[data-perfect-front-pins]')!.shadowRoot!;

  beforeEach(() => {
    document.body.innerHTML = '<div id="card" style="width:10px;height:10px"></div>';
    document.getElementById('card')!.getBoundingClientRect = () => ({ left: 0, top: 0, right: 100, bottom: 40, width: 100, height: 40, x: 0, y: 0, toJSON() {} }) as DOMRect;
    onTransitions.mockReset();
    rows = [row()];
  });

  it('en curso pulsa el pin; resuelto deja un pin fantasma que desaparece', async () => {
    const pins = createPins({ loadComments: async () => rows, onTransitions });
    await pins.refresh();
    expect(onTransitions).not.toHaveBeenCalled(); // primera carga: sin transiciones

    rows = [row({ status: 'in_progress', updatedAt: 'u1' })];
    await pins.refresh();
    expect(pinsRoot().querySelector('.pf-pin')!.getAttribute('data-live')).toBe('working');
    expect(onTransitions.mock.calls[0]![0][0]).toMatchObject({ from: 'pending', to: 'in_progress', n: 1 });
    vi.advanceTimersByTime(3000);
    expect(pinsRoot().querySelector('.pf-pin')!.hasAttribute('data-live')).toBe(false);

    rows = [row({ status: 'resolved', updatedAt: 'u2' })];
    await pins.refresh();
    const ghost = pinsRoot().querySelector('.pf-pin--ghost')!;
    expect(ghost.textContent).toBe('1');
    expect(ghost.getAttribute('data-live')).toBe('done');
    expect(onTransitions.mock.calls[1]![0][0]).toMatchObject({ to: 'resolved', n: 1 });
    expect(pins.total).toBe(0);
    vi.advanceTimersByTime(2500);
    expect(pinsRoot().querySelector('.pf-pin--ghost')).toBeNull();
    pins.destroy();
  });
});
