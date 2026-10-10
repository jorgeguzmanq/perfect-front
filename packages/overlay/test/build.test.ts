// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { buildOverlayBundle } from '../src/build';

describe('buildOverlayBundle', () => {
  it('produce un IIFE que al evaluarse define window.__pf y monta la capa', async () => {
    const js = await buildOverlayBundle();
    expect(typeof js).toBe('string');
    expect(js.length).toBeGreaterThan(1000);
    // El CSS entra como texto (sin ?inline de Vite) y sin imports/exports de módulo.
    expect(js).toContain('--pf-color-accent');
    expect(js).not.toMatch(/^\s*(import|export)\s/m);

    localStorage.clear();
    document.body.innerHTML = '<main id="app"><button id="b1">x</button></main>';
    const stub = vi.fn(async (...args: [string]) => (void args, new Response(JSON.stringify({ ok: true, comments: [] }))));
    vi.stubGlobal('fetch', stub);
    const script = document.createElement('script');
    script.setAttribute('data-pf-token', 'abc');
    script.setAttribute('data-pf-base', '/__pf');
    document.head.appendChild(script);

    (0, eval)(js);

    const pf = (window as unknown as { __pf?: { isEnabled(): boolean; state: string; version: string; destroy(): void } }).__pf;
    expect(pf).toBeDefined();
    expect(pf!.isEnabled()).toBe(true);
    expect(pf!.state).toBe('IDLE');
    expect(document.querySelector('[data-perfect-front-overlay]')).not.toBeNull();
    await vi.waitFor(() => expect(stub).toHaveBeenCalled());
    expect(String(stub.mock.calls[0]![0])).toBe('/__pf/comments');
    pf!.destroy();
    expect((window as unknown as { __pf?: unknown }).__pf).toBeUndefined();
    vi.unstubAllGlobals();
  }, 30_000);
});
