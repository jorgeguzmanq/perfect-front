// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearNextSourceCache,
  enrichSnapshotSource,
  isNextPage,
  normalizeNextFile,
  parseStack,
  readDebugStack,
  resolveNextSource,
} from '../src/next-source';
import { snapshotElement } from '../src/context';

const TURBO = `Error: react-stack-top-frame
    at exports.jsxDEV (http://localhost:3000/_next/static/chunks/node_modules_next_dist_compiled_react_cjs_react-jsx-dev-runtime_development_a1b2._.js:330:41)
    at Hero (http://localhost:3000/_next/static/chunks/src_components_Hero_tsx_c3d4._.js:12:88)
    at Object.react_stack_bottom_frame (http://localhost:3000/_next/static/chunks/node_modules_next_dist_compiled_react-dom_5e6f._.js:1500:20)`;

const WEBPACK = `Error: react-stack-top-frame
    at jsxDEV (webpack-internal:///(app-pages-browser)/./node_modules/next/dist/compiled/react/cjs/react-jsx-dev-runtime.development.js:330:41)
    at Page (webpack-internal:///(app-pages-browser)/./src/app/page.tsx:20:88)`;

const FIREFOX = 'Hero@http://localhost:3000/_next/static/chunks/src_Hero.js:12:88\nrenderWithHooks@http://x/node_modules_react-dom.js:1:1';

function withFiber(el: Element, stack: string | undefined) {
  (el as unknown as Record<string, unknown>)['__reactFiber$abc'] = { type: 'button', _debugStack: stack === undefined ? undefined : { stack } };
}

const ok = (body: unknown) => ({ ok: true, json: async () => body }) as Response;
const frameRes = (file: string, line1 = 12, column1 = 5, extra: object = {}) => [
  { status: 'fulfilled', value: { originalStackFrame: { file, line1, column1, ignored: false, ...extra } } },
];

beforeEach(() => {
  clearNextSourceCache();
  document.head.innerHTML = '';
  document.body.innerHTML = '<button id="b">Ok</button>';
  delete (window as unknown as Record<string, unknown>).next;
});

describe('parseStack / readDebugStack', () => {
  it('Turbopack: descarta frames internos y deja el de código de usuario', () => {
    const b = document.getElementById('b')!;
    withFiber(b, TURBO);
    expect(readDebugStack(b)).toEqual([
      { file: 'http://localhost:3000/_next/static/chunks/src_components_Hero_tsx_c3d4._.js', line: 12, column: 88, fn: 'Hero' },
    ]);
  });

  it('webpack: webpack-internal', () => {
    const b = document.getElementById('b')!;
    withFiber(b, WEBPACK);
    const f = readDebugStack(b);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ file: 'webpack-internal:///(app-pages-browser)/./src/app/page.tsx', line: 20, column: 88 });
  });

  it('formato Firefox/Safari', () => {
    const f = parseStack(FIREFOX);
    expect(f[0]).toMatchObject({ fn: 'Hero', line: 12, column: 88 });
  });

  it('sin _debugStack o sin fiber devuelve []', () => {
    const b = document.getElementById('b')!;
    expect(readDebugStack(b)).toEqual([]);
    withFiber(b, undefined);
    expect(readDebugStack(b)).toEqual([]);
  });
});

describe('normalizeNextFile', () => {
  it.each([
    ['[project]/src/app/page.tsx', 'src/app/page.tsx'],
    ['turbopack:///[project]/src/app/page.tsx [app-client] (ecmascript)', 'src/app/page.tsx'],
    ['webpack-internal:///(app-pages-browser)/./src/app/page.tsx', 'src/app/page.tsx'],
    ['src/components/Hero.tsx', 'src/components/Hero.tsx'],
    ['C:\\Dev\\app\\src\\a.tsx', 'C:\\Dev\\app\\src\\a.tsx'],
    ['[project]/node_modules/react/index.js', null],
    ['http://localhost:3000/_next/x.js', null],
  ])('%s', (input, out) => expect(normalizeNextFile(input)).toBe(out));
});

describe('resolveNextSource', () => {
  const frames = [{ file: 'http://localhost:3000/_next/static/chunks/a.js', line: 12, column: 88, fn: 'Hero' }];

  it('POST al mismo origen con el formato de Next y respuesta válida', async () => {
    const f = vi.fn(async () => ok(frameRes('[project]/src/components/Hero.tsx', 14, 7)));
    const r = await resolveNextSource(frames, f as never);
    expect(r).toEqual({ file: 'src/components/Hero.tsx', line: 14, column: 7 });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/__nextjs_original-stack-frames');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.frames[0]).toMatchObject({ file: frames[0]!.file, line1: 12, column1: 88, methodName: 'Hero' });
    expect(body.isServer).toBe(false);
  });

  it('cachea por stack (un solo fetch)', async () => {
    const f = vi.fn(async () => ok(frameRes('src/a.tsx')));
    await resolveNextSource(frames, f as never);
    await resolveNextSource(frames, f as never);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['respuesta inválida', ok({ nope: 1 })],
    ['frame ignorado', ok(frameRes('src/a.tsx', 1, 1, { ignored: true }))],
    ['rechazado', ok([{ status: 'rejected', reason: 'x' }])],
    ['node_modules', ok(frameRes('[project]/node_modules/x/y.js'))],
    ['HTTP 404', { ok: false, json: async () => ({}) } as Response],
  ])('%s -> null', async (_n, res) => {
    expect(await resolveNextSource(frames, (async () => res) as never)).toBeNull();
  });

  it('timeout -> null y no se cachea el fallo', async () => {
    const hang = vi.fn((_u: string, init?: RequestInit) => new Promise<Response>((_, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('abort')))));
    expect(await resolveNextSource(frames, hang as never, { timeoutMs: 10 })).toBeNull();
    const f = vi.fn(async () => ok(frameRes('src/a.tsx')));
    expect(await resolveNextSource(frames, f as never)).toMatchObject({ file: 'src/a.tsx' });
  });

  it('red caída -> null', async () => {
    const f = vi.fn(async () => {
      throw new Error('net');
    });
    expect(await resolveNextSource(frames, f as never)).toBeNull();
  });
});

describe('enrichSnapshotSource', () => {
  const mkNext = () => {
    (window as unknown as Record<string, unknown>).next = {};
  };

  it('en una página Next rellena src y componentHint', async () => {
    mkNext();
    const b = document.getElementById('b')!;
    withFiber(b, TURBO);
    const snap = snapshotElement(b);
    expect(snap.src).toBeNull();
    const f = vi.fn(async () => ok(frameRes('[project]/src/components/Hero.tsx', 14, 7)));
    expect(await enrichSnapshotSource(snap, b, f as never)).toBe(true);
    expect(snap.src).toBe('src/components/Hero.tsx:14:7');
    expect(snap.componentHint).toContain('(src/components/Hero.tsx:14:7)');
    // el siguiente snapshot ya lo trae de forma síncrona
    expect(snapshotElement(b).src).toBe('src/components/Hero.tsx:14:7');
  });

  it('sin Next no hace fetch', async () => {
    const b = document.getElementById('b')!;
    withFiber(b, TURBO);
    const f = vi.fn();
    expect(isNextPage(document)).toBe(false);
    expect(await enrichSnapshotSource(snapshotElement(b), b, f as never)).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it('detecta Next por script /_next/', async () => {
    const q = vi.spyOn(document, 'querySelector').mockReturnValue(document.body);
    expect(isNextPage(document)).toBe(true);
    expect(q).toHaveBeenCalledWith('script[src*="/_next/"]');
    q.mockRestore();
  });

  it('respeta data-pf-src existente', async () => {
    mkNext();
    document.body.innerHTML = '<button id="b" data-pf-src="src/X.tsx:3">Ok</button>';
    const b = document.getElementById('b')!;
    withFiber(b, TURBO);
    const f = vi.fn();
    expect(await enrichSnapshotSource(snapshotElement(b), b, f as never)).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
});
