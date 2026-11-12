/**
 * Ubicación en el código para proyectos Next.js SIN plugin (SPEC §9.6).
 * React 19 (dev) guarda en cada fiber `_debugStack` (un Error creado en la línea del JSX); el stack apunta a un
 * chunk empaquetado, y el dev server de Next lo traduce al archivo original en
 * `POST /__nextjs_original-stack-frames` (mismo origen: el proxy de Perfect Front lo reenvía tal cual).
 * Todo es best effort: cualquier fallo devuelve null y el overlay sigue como antes.
 */
import { fiberOf } from './react';

export interface RawFrame {
  file: string;
  line: number;
  column: number;
  fn?: string;
}

export interface NextSource {
  file: string;
  line: number;
  column: number;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const NEXT_ENDPOINT = '/__nextjs_original-stack-frames';
export const NEXT_TIMEOUT_MS = 1500;
const MAX_CANDIDATES = 3;
const MAX_CACHE = 500;

const CHROME = /^\s*at (?:(.*?) \()?(.+?):(\d+):(\d+)\)?\s*$/;
const FIREFOX = /^\s*(.*?)@(.+?):(\d+):(\d+)\s*$/;

/** Parsea el texto de un stack (Chrome/V8 o Firefox/Safari) a frames; ignora líneas que no encajan. */
export function parseStack(stack: string): RawFrame[] {
  const out: RawFrame[] = [];
  for (const raw of stack.split('\n')) {
    const m = CHROME.exec(raw) ?? FIREFOX.exec(raw);
    if (!m) continue;
    const file = m[2]!.replace(/\?\d+$/, '');
    const line = Number(m[3]);
    const column = Number(m[4]);
    if (!file || file === '<anonymous>' || !(line > 0)) continue;
    out.push({ file, line, column, ...(m[1] ? { fn: m[1] } : {}) });
  }
  return out;
}

/** Frames de infraestructura (React, Next, dependencias): no son código del usuario. */
export function isInternalFrame(f: RawFrame): boolean {
  if (f.fn && /react-stack-|jsxDEV|jsxs?\b|createElement|^Object\.react/.test(f.fn)) return true;
  return /node_modules|react-jsx|react-dom|react\.development|\/next\/dist\/|next_dist|\[project\]\/node_modules/.test(
    decodeURIComponent_(f.file),
  );
}

function decodeURIComponent_(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** `_debugStack` del fiber del elemento (React 19 dev) -> frames de código de usuario (los primeros). */
export function readDebugStack(el: Element): RawFrame[] {
  const fiber = fiberOf(el) as { _debugStack?: unknown } | null;
  const err = fiber?._debugStack as { stack?: unknown } | undefined;
  const text = err && typeof err.stack === 'string' ? err.stack : null;
  if (!text) return [];
  return parseStack(text.slice(0, 20000))
    .filter((f) => !isInternalFrame(f))
    .slice(0, MAX_CANDIDATES);
}

/** Barato: Next expone `window.next` o sirve scripts desde `/_next/`. */
export function isNextPage(doc: Document): boolean {
  const win = doc.defaultView as (Window & { next?: unknown; __NEXT_DATA__?: unknown }) | null;
  if (win && (win.next || win.__NEXT_DATA__)) return true;
  return !!doc.querySelector('script[src*="/_next/"]');
}

/** Normaliza el `file` de la respuesta de Next (ruta tal como viene; solo se recortan prefijos del bundler). */
export function normalizeNextFile(file: string): string | null {
  let f = file.trim();
  if (!f || f.length > 500) return null;
  f = f.replace(/^turbopack:\/\/\//, '').replace(/^webpack-internal:\/\/\//, '').replace(/^webpack:\/\/(_N_E\/)?/, '');
  f = f.replace(/^\([\w-]+\)\//, ''); // (app-pages-browser)/ · (rsc)/
  f = f.replace(/^\[project\]\//, '');
  f = f.replace(/ \[[^\]]*\].*$/, ''); // " [app-client] (ecmascript)"
  f = f.replace(/\?\d+$/, '');
  if (f.startsWith('file://')) f = decodeURIComponent_(f.replace(/^file:\/\/\/?(?=[A-Za-z]:)/, '').replace(/^file:\/\//, ''));
  f = f.replace(/^\.\//, '');
  if (!f || /node_modules/.test(f) || /^(https?|about|data|blob):/.test(f)) return null;
  return f;
}

function toSource(res: unknown): NextSource | null {
  if (!Array.isArray(res)) return null;
  for (const item of res) {
    const it = item as { status?: unknown; value?: { originalStackFrame?: Record<string, unknown> } } | null;
    if (!it || it.status !== 'fulfilled') continue;
    const f = it.value?.originalStackFrame;
    if (!f || f.ignored === true || typeof f.file !== 'string') continue;
    const line = Number(f.line1 ?? f.lineNumber);
    const col = Number(f.column1 ?? f.column ?? 1);
    if (!Number.isInteger(line) || line <= 0) continue;
    const file = normalizeNextFile(f.file);
    if (!file) continue;
    return { file, line, column: Number.isInteger(col) && col > 0 ? col : 1 };
  }
  return null;
}

const cache = new Map<string, Promise<NextSource | null>>();
const resolved = new WeakMap<Element, NextSource>();

export function clearNextSourceCache(): void {
  cache.clear();
}

const isServerFrame = (f: RawFrame) => /^(about:\/\/React\/Server|file:)/.test(f.file);

/** Pide a Next el origen real de los frames. null ante cualquier fallo (red, 404, timeout, formato). */
export function resolveNextSource(
  frames: RawFrame[],
  fetchImpl: FetchLike | undefined = typeof fetch === 'function' ? fetch.bind(globalThis) : undefined,
  opts: { timeoutMs?: number; isAppDirectory?: boolean } = {},
): Promise<NextSource | null> {
  if (!frames.length || !fetchImpl) return Promise.resolve(null);
  const key = frames.map((f) => `${f.file}:${f.line}:${f.column}`).join('|');
  const hit = cache.get(key);
  if (hit) return hit;
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => ctrl?.abort(), opts.timeoutMs ?? NEXT_TIMEOUT_MS);
  let transient = false;
  const p = (async (): Promise<NextSource | null> => {
    try {
      const res = await Promise.race([
        fetchImpl(NEXT_ENDPOINT, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            frames: frames.map((f) => ({
              file: f.file,
              methodName: f.fn ?? '<unknown>',
              line1: f.line,
              column1: f.column,
              arguments: [],
            })),
            isServer: frames.every(isServerFrame),
            isEdgeServer: false,
            isAppDirectory: opts.isAppDirectory ?? true,
          }),
          ...(ctrl ? { signal: ctrl.signal } : {}),
          credentials: 'same-origin',
        }),
        new Promise<never>((_, rej) => {
          ctrl?.signal.addEventListener('abort', () => rej(new Error('timeout')));
        }),
      ]);
      if (!res.ok) return null;
      return toSource(await res.json());
    } catch {
      transient = true;
      return null;
    } finally {
      clearTimeout(timer);
    }
  })();
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value as string);
  cache.set(key, p);
  void p.then(() => {
    if (transient) cache.delete(key); // los fallos de red/timeout se pueden reintentar
  });
  return p;
}

/** Resultado ya resuelto para el elemento (lectura síncrona para `snapshotElement`). */
export const cachedNextSource = (el: Element): string | null => {
  const s = resolved.get(el);
  return s ? `${s.file}:${s.line}:${s.column}` : null;
};

/**
 * Si el snapshot no trae `data-pf-src` y la página es Next, intenta ubicar el JSX y rellena `snap.src`
 * (y `componentHint`). Devuelve true si cambió algo (para repintar). Nunca lanza.
 */
export async function enrichSnapshotSource(
  snap: { src: string | null; components: string[] | null; componentHint: string | null },
  el: Element,
  fetchImpl?: FetchLike,
): Promise<boolean> {
  try {
    if (snap.src) return false;
    const known = cachedNextSource(el);
    let src = known;
    if (!src) {
      if (!isNextPage(el.ownerDocument)) return false;
      const frames = readDebugStack(el);
      if (!frames.length) return false;
      const win = el.ownerDocument.defaultView as (Window & { __next_f?: unknown }) | null;
      const s = await resolveNextSource(frames, fetchImpl, { isAppDirectory: !!win && '__next_f' in win });
      if (!s) return false;
      resolved.set(el, s);
      src = `${s.file}:${s.line}:${s.column}`;
    }
    if (snap.src) return false;
    snap.src = src;
    snap.componentHint = [snap.components?.join(' < '), `(${src})`].filter(Boolean).join(' ').slice(0, 200);
    return true;
  } catch {
    return false;
  }
}
