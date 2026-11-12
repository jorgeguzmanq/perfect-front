import type { AgentRequestInfo } from './groups';
import type { PinTransition } from './pins';

/** Cambios en vivo: SSE `{base}/events` con reconexión y, si cae o no existe, polling. Sin dependencias del resto del overlay. */

export const LIVE_DEBOUNCE_MS = 150;
export const LIVE_BACKOFF_MIN_MS = 1000;
export const LIVE_BACKOFF_MAX_MS = 10_000;
export const LIVE_POLL_VISIBLE_MS = 3000;
export const LIVE_POLL_HIDDEN_MS = 15_000;

const EVENT_TYPES = ['comment.created', 'comment.updated', 'comment.moved', 'comment.resolved', 'comment.deleted', 'collection.created', 'collection.renamed', 'collection.deleted'];

export interface LiveEvent {
  type: string;
  commentId?: string;
  status?: string;
  updatedAt?: string;
}
export type LiveState = 'connecting' | 'sse' | 'polling' | 'closed';
export type LiveReason = 'event' | 'poll' | 'wake' | 'open';

export interface LiveOptions {
  /** Prefijo de la API en el mismo origen (p. ej. '/__pf'). */
  base: string;
  /** Token del overlay: EventSource no admite cabeceras, va por query `pf_token` (el proxy lo valida solo en /events). */
  token: string;
  /** Ráfagas agrupadas (150 ms): refrescar pines, cajón y grupos. */
  onChange(events: LiveEvent[], reason: LiveReason): void;
  onState?(state: LiveState): void;
  window?: Window;
  EventSource?: typeof EventSource | undefined;
  debounceMs?: number;
}

export interface LiveHandle {
  readonly state: LiveState;
  /** Fuerza un refetch (debounced), p. ej. tras una escritura propia. */
  nudge(): void;
  close(): void;
}

export function connectLive(opts: LiveOptions): LiveHandle {
  const win = opts.window ?? window;
  const doc = win.document;
  const ES = opts.EventSource ?? (win as unknown as { EventSource?: typeof EventSource }).EventSource ?? globalThis.EventSource;
  const debounceMs = opts.debounceMs ?? LIVE_DEBOUNCE_MS;
  const url = `${opts.base.replace(/\/+$/, '')}/events?pf_token=${encodeURIComponent(opts.token)}`;

  let state: LiveState = 'connecting';
  let es: EventSource | null = null;
  let closed = false;
  let dropped = false; // hubo una caída: al reabrir se hace un refetch de recuperación
  let backoff = LIVE_BACKOFF_MIN_MS;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let pending: LiveEvent[] = [];
  let reason: LiveReason = 'event';
  const offs: Array<() => void> = [];

  const setState = (s: LiveState) => {
    if (state === s) return;
    state = s;
    opts.onState?.(s);
  };

  const trigger = (r: LiveReason, ev?: LiveEvent) => {
    if (closed) return;
    if (ev) pending.push(ev);
    reason = ev ? 'event' : pending.length ? reason : r;
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      const events = pending;
      pending = [];
      if (!closed) opts.onChange(events, reason);
    }, debounceMs);
  };

  // --- polling (solo mientras SSE no está disponible) ---------------------------------------------------------------
  const pollDelay = () => (doc.visibilityState === 'hidden' ? LIVE_POLL_HIDDEN_MS : LIVE_POLL_VISIBLE_MS);
  const stopPolling = () => {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
  };
  const startPolling = () => {
    stopPolling();
    if (closed || state === 'sse') return;
    pollTimer = setTimeout(() => {
      pollTimer = null;
      trigger('poll');
      startPolling();
    }, pollDelay());
  };

  // --- SSE ---------------------------------------------------------------------------------------------------------
  const parse = (type: string, data: unknown): LiveEvent => {
    try {
      const o = JSON.parse(String(data)) as Partial<LiveEvent> | null;
      return {
        type,
        ...(typeof o?.commentId === 'string' ? { commentId: o.commentId } : {}),
        ...(typeof o?.status === 'string' ? { status: o.status } : {}),
        ...(typeof o?.updatedAt === 'string' ? { updatedAt: o.updatedAt } : {}),
      };
    } catch {
      return { type };
    }
  };

  const connect = () => {
    if (closed || !ES) return;
    const source = new ES(url);
    es = source;
    source.onopen = () => {
      if (closed || es !== source) return;
      backoff = LIVE_BACKOFF_MIN_MS;
      stopPolling();
      setState('sse');
      if (dropped) {
        dropped = false;
        trigger('open'); // pudo perderse algo mientras estuvo caído
      }
    };
    source.onerror = () => {
      if (closed || es !== source) return;
      dropped = true;
      setState('polling');
      startPolling();
      // CONNECTING: el navegador reintenta solo (reenvía Last-Event-ID). CLOSED: reconexión manual con backoff.
      if (source.readyState === 2) {
        source.close();
        es = null;
        const wait = backoff;
        backoff = Math.min(backoff * 2, LIVE_BACKOFF_MAX_MS);
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connect();
        }, wait);
      }
    };
    const onEvent = (type: string) => (m: Event) => trigger('event', parse(type, (m as MessageEvent).data));
    for (const t of EVENT_TYPES) source.addEventListener(t, onEvent(t));
    source.onmessage = (m) => trigger('event', parse('message', m.data));
  };

  // --- refetch inmediato al volver a la pestaña / foco / red --------------------------------------------------------
  const wake = () => trigger('wake');
  const onVisible = () => {
    if (doc.visibilityState !== 'hidden') wake();
    if (pollTimer) startPolling(); // re-arma con el intervalo de la nueva visibilidad
  };
  doc.addEventListener('visibilitychange', onVisible);
  win.addEventListener('focus', wake);
  win.addEventListener('online', wake);
  offs.push(() => {
    doc.removeEventListener('visibilitychange', onVisible);
    win.removeEventListener('focus', wake);
    win.removeEventListener('online', wake);
  });

  // Sin SSE (o hasta que abra) el polling cubre; al abrir se detiene.
  if (ES) connect();
  else setState('polling');
  startPolling();

  return {
    get state() {
      return state;
    },
    nudge: () => trigger('wake'),
    close() {
      if (closed) return;
      closed = true;
      stopPolling();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (flushTimer) clearTimeout(flushTimer);
      es?.close();
      es = null;
      for (const f of offs) f();
      setState('closed');
    },
  };
}

// --- Avisos --------------------------------------------------------------------------------------------------------

const CLOSED = new Set(['resolved', 'archived']);

interface ProgressComment {
  id: string;
  status: string;
  group?: { id: string } | null;
}

/** «d de t» de la solicitud al agente más reciente que incluye el comentario o, si no hay, de su grupo. */
export function progressFor(
  id: string,
  comments: readonly ProgressComment[],
  requests: readonly AgentRequestInfo[],
): { done: number; total: number } | null {
  const hits = requests.filter((r) => r.commentIds.includes(id));
  let ids: string[] | null = hits.length ? hits.reduce((a, b) => (b.createdAt >= a.createdAt ? b : a)).commentIds : null;
  if (!ids) {
    const g = comments.find((c) => c.id === id)?.group?.id;
    if (g) ids = comments.filter((c) => c.group?.id === g).map((c) => c.id);
  }
  if (!ids) return null;
  const set = new Set(ids);
  const known = comments.filter((c) => set.has(c.id)); // los borrados dejan de contar
  if (!known.length) return null;
  return { done: known.filter((c) => CLOSED.has(c.status)).length, total: known.length };
}

export interface NoticeOptions {
  /** Aviso del lanzador con acción «Ver» (abre el cajón en ese comentario). */
  announce(text: string, focus: { id: string; tab: 'open' | 'done' }): void;
  progress(id: string): { done: number; total: number } | null;
  /** Comentarios abiertos tras la última carga. */
  openLeft(): number;
  /** Ventana de agrupación de ráfagas. */
  windowMs?: number;
  /** Tiempo durante el que se ignora un comentario recién tocado por este widget si no se conoce su updatedAt. */
  ownMs?: number;
  now?(): number;
}

export interface NoticesHandle {
  /** Marca una escritura propia (editar/eliminar) para no avisar de ella. */
  own(id: string, updatedAt?: string): void;
  push(list: readonly PinTransition[]): void;
  destroy(): void;
}

export function createNotices(o: NoticeOptions): NoticesHandle {
  const now = o.now ?? (() => Date.now());
  const ownKeys = new Set<string>();
  const ownUntil = new Map<string, number>();
  let batch: PinTransition[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const isOwn = (t: PinTransition) =>
    ownKeys.has(`${t.comment.id}|${t.comment.updatedAt ?? ''}`) || (ownUntil.get(t.comment.id) ?? 0) > now();
  const tag = (t: PinTransition) => (t.n === null ? '' : ` #${t.n}`);

  const flush = () => {
    timer = null;
    const list = batch;
    batch = [];
    if (!list.length) return;
    const resolved = list.filter((t) => CLOSED.has(t.to));
    const taken = list.filter((t) => t.to === 'in_progress');
    const reopened = list.filter((t) => t.to === 'pending' && CLOSED.has(t.from));
    if (resolved.length) {
      const last = resolved[resolved.length - 1]!;
      const p = o.progress(last.comment.id);
      const complete = p ? p.done >= p.total : o.openLeft() === 0;
      const what = resolved.length === 1 ? `Comentario${tag(last)} resuelto` : `${resolved.length} comentarios resueltos`;
      o.announce(complete ? 'Todo resuelto ✓' : p ? `${what} · ${p.done} de ${p.total}` : what, { id: last.comment.id, tab: 'done' });
    } else if (taken.length) {
      const last = taken[taken.length - 1]!;
      o.announce(taken.length === 1 ? `Comentario${tag(last)} en curso` : `${taken.length} comentarios en curso`, { id: last.comment.id, tab: 'open' });
    } else if (reopened.length) {
      const last = reopened[reopened.length - 1]!;
      o.announce(reopened.length === 1 ? `Comentario${tag(last)} reabierto` : `${reopened.length} comentarios reabiertos`, { id: last.comment.id, tab: 'open' });
    }
  };

  return {
    own(id, updatedAt) {
      if (updatedAt) ownKeys.add(`${id}|${updatedAt}`);
      else ownUntil.set(id, now() + (o.ownMs ?? 5000));
    },
    push(list) {
      const fresh = list.filter((t) => !isOwn(t));
      if (!fresh.length) return;
      batch.push(...fresh);
      timer ??= setTimeout(flush, o.windowMs ?? 400);
    },
    destroy() {
      if (timer) clearTimeout(timer);
      timer = null;
      batch = [];
    },
  };
}
