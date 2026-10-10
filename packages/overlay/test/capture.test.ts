// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const toPng = vi.fn<(...a: unknown[]) => Promise<string>>();
const toJpeg = vi.fn<(...a: unknown[]) => Promise<string>>();
vi.mock('html-to-image', () => ({ toPng: (...a: unknown[]) => toPng(...a), toJpeg: (...a: unknown[]) => toJpeg(...a) }));

import { captureViewport } from '../src/capture';

beforeEach(() => {
  toPng.mockReset();
  toJpeg.mockReset();
});

describe('captureViewport', () => {
  it('devuelve PNG válido para shared', async () => {
    toPng.mockResolvedValue('data:image/png;base64,iVBORw0KGgo=');
    await expect(captureViewport()).resolves.toEqual({ mimeType: 'image/png', dataBase64: 'iVBORw0KGgo=' });
    expect(toJpeg).not.toHaveBeenCalled();
  });

  it('el filtro excluye los hosts de Perfect Front', async () => {
    toPng.mockResolvedValue('data:image/png;base64,AAAA');
    await captureViewport();
    const opts = toPng.mock.calls[0]![1] as { filter(n: Node): boolean };
    const host = document.createElement('div');
    host.setAttribute('data-perfect-front-overlay', '');
    expect(opts.filter(host)).toBe(false);
    expect(opts.filter(document.createElement('div'))).toBe(true);
  });

  it('si el PNG excede el límite cae a JPEG', async () => {
    toPng.mockResolvedValue('data:image/png;base64,' + 'A'.repeat(10_000_004));
    toJpeg.mockResolvedValue('data:image/jpeg;base64,/9j/4AAQ');
    await expect(captureViewport()).resolves.toEqual({ mimeType: 'image/jpeg', dataBase64: '/9j/4AAQ' });
  });

  it('si nada cabe, falla con un error claro', async () => {
    const big = 'A'.repeat(10_000_004);
    toPng.mockResolvedValue('data:image/png;base64,' + big);
    toJpeg.mockResolvedValue('data:image/jpeg;base64,' + big);
    await expect(captureViewport()).rejects.toThrow(/tamaño máximo/);
  });

  it('rechaza formatos no soportados', async () => {
    toPng.mockResolvedValue('data:image/gif;base64,R0lGOD');
    await expect(captureViewport()).rejects.toThrow(/formato/);
  });
});
