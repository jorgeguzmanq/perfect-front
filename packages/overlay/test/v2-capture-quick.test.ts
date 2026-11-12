// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const toPng = vi.fn(async (..._a: unknown[]) => 'data:image/png;base64,iVBORw0KGgo=');
const getFontEmbedCSS = vi.fn(async (..._a: unknown[]) => '@font-face{}');
vi.mock('html-to-image', () => ({
  toPng: (...a: unknown[]) => toPng(...a),
  getFontEmbedCSS: (...a: unknown[]) => getFontEmbedCSS(...a),
}));

import { renderBox, resetCaptureCache } from '../src/capture-node';

const box = { left: 0, top: 0, width: 100, height: 40 };

describe('captura rápida 1×', () => {
  beforeEach(() => {
    toPng.mockClear();
    getFontEmbedCSS.mockClear();
    resetCaptureCache(window);
  });

  it('1× hace exactamente 1 render y calcula fuentes una sola vez', async () => {
    await renderBox(box, 1, 'div', window, { fast: true });
    expect(toPng).toHaveBeenCalledTimes(1);
    expect(getFontEmbedCSS).toHaveBeenCalledTimes(1);
    expect(toPng.mock.calls[0]![1]).toMatchObject({ pixelRatio: 1, fontEmbedCSS: '@font-face{}' });
  });

  it('reutiliza fuentes y resultado si nada cambió; re-renderiza tras mutar el DOM', async () => {
    await renderBox(box, 1, 'div', window, { fast: true });
    await renderBox(box, 1, 'div', window, { fast: true });
    expect(toPng).toHaveBeenCalledTimes(1);
    document.body.appendChild(document.createElement('p'));
    await new Promise((r) => setTimeout(r, 0));
    await renderBox(box, 1, 'div', window, { fast: true });
    expect(toPng).toHaveBeenCalledTimes(2);
    expect(getFontEmbedCSS).toHaveBeenCalledTimes(1);
  });

  it('2× no usa el camino rápido (sin caché de fuentes)', async () => {
    await renderBox(box, 2, 'div', window, { fast: true });
    expect(getFontEmbedCSS).not.toHaveBeenCalled();
    expect(toPng.mock.calls[0]![1]).not.toHaveProperty('fontEmbedCSS');
  });

  it('margen y fondo de la página salen del camino rápido y se pasan al render', async () => {
    document.body.style.backgroundColor = 'rgb(10, 20, 30)';
    const shot = await renderBox(box, 1, 'div', window, { fast: true, margin: 8, background: 'page' });
    expect(getFontEmbedCSS).not.toHaveBeenCalled();
    expect(toPng.mock.calls[0]![1]).toMatchObject({ width: 116, height: 56, backgroundColor: 'rgb(10, 20, 30)' });
    expect(shot.width).toBe(116);
    document.body.style.backgroundColor = '';
  });
});
