// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  copyImage,
  downloadAll,
  downloadImage,
  imageFileName,
  mountShotActions,
} from '../src/clipboard';

/** Espera a los setTimeout de aria-live (30 ms) y a las cadenas async de los clics. */
const flush = (ms = 80) => new Promise((r) => setTimeout(r, ms));

const png = () => new Blob(['png'], { type: 'image/png' });
const jpeg = () => new Blob(['jpg'], { type: 'image/jpeg' });

class FakeClipboardItem {
  constructor(public data: Record<string, Blob>) {}
}

class FakeImage {
  naturalWidth = 16;
  naturalHeight = 9;
  decoding = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_v: string) {
    queueMicrotask(() => this.onload?.());
  }
}

let write: ReturnType<typeof vi.fn>;
let clicks: Array<{ download: string; href: string }>;

const setNavigator = (clipboard: unknown) =>
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard });

beforeEach(() => {
  document.body.innerHTML = '';
  write = vi.fn(async () => undefined);
  setNavigator({ write });
  vi.stubGlobal('ClipboardItem', FakeClipboardItem);
  vi.stubGlobal('Image', FakeImage);
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);

  // happy-dom no fiable para canvas/blob URLs: se simula el canvas y el toBlob.
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: () => ({ drawImage: vi.fn() }),
  });
  Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', {
    configurable: true,
    value(this: HTMLCanvasElement, cb: (b: Blob | null) => void) {
      cb(new Blob(['converted'], { type: 'image/png' }));
    },
  });
  URL.createObjectURL = vi.fn(() => 'blob:mock') as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn();

  clicks = [];
  vi.spyOn(HTMLElement.prototype, 'click').mockImplementation(function (this: HTMLElement) {
    if (this instanceof HTMLAnchorElement) clicks.push({ download: this.download, href: this.href });
    else this.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  setNavigator(undefined);
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
});

describe('copyImage', () => {
  it('copia un PNG tal cual y devuelve ok', async () => {
    const blob = png();
    await expect(copyImage(blob)).resolves.toEqual({ ok: true, message: 'Imagen copiada', fallback: false });
    expect(write).toHaveBeenCalledTimes(1);
    const item = (write.mock.calls[0] as unknown as [FakeClipboardItem[]])[0][0];
    expect(item).toBeInstanceOf(FakeClipboardItem);
    expect(item!.data['image/png']).toBe(blob);
  });

  it('acepta una data URL PNG', async () => {
    const r = await copyImage('data:image/png;base64,iVBORw0KGgo=');
    expect(r.ok).toBe(true);
    const item = (write.mock.calls[0] as unknown as [FakeClipboardItem[]])[0][0];
    expect(item!.data['image/png']!.type).toBe('image/png');
  });

  it('convierte JPEG a PNG antes de escribir en el portapapeles', async () => {
    const r = await copyImage(jpeg());
    expect(r.ok).toBe(true);
    const item = (write.mock.calls[0] as unknown as [FakeClipboardItem[]])[0][0];
    const sent = item!.data['image/png']!;
    expect(sent.type).toBe('image/png');
    expect(sent).not.toBe(png());
  });

  it('convierte WebP a PNG', async () => {
    const webp = new Blob(['w'], { type: 'image/webp' });
    const r = await copyImage(webp);
    expect(r.ok).toBe(true);
    const item = (write.mock.calls[0] as unknown as [FakeClipboardItem[]])[0][0];
    expect(item!.data['image/png']!.type).toBe('image/png');
  });

  it('NotAllowedError → {ok:false, fallback:true} con mensaje en español', async () => {
    const err = Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    write.mockRejectedValueOnce(err);
    const r = await copyImage(png());
    expect(r.ok).toBe(false);
    expect(r.fallback).toBe(true);
    expect(r.message).toBe('El navegador bloqueó el acceso al portapapeles. Puedes descargarla.');
  });

  it('SecurityError → {ok:false, fallback:true} con mensaje en español', async () => {
    const err = Object.assign(new Error('sec'), { name: 'SecurityError' });
    write.mockRejectedValueOnce(err);
    const r = await copyImage(png());
    expect(r).toEqual({
      ok: false,
      fallback: true,
      message: 'El navegador no permite copiar desde esta página. Puedes descargarla.',
    });
  });

  it('otro error → mensaje genérico en español, sin lanzar', async () => {
    write.mockRejectedValueOnce(new Error('raro'));
    const r = await copyImage(png());
    expect(r).toEqual({ ok: false, fallback: true, message: 'No se pudo copiar la imagen. Puedes descargarla.' });
  });

  it('sin ClipboardItem → fallback con mensaje de navegador no compatible', async () => {
    vi.stubGlobal('ClipboardItem', undefined);
    const r = await copyImage(png());
    expect(r.ok).toBe(false);
    expect(r.fallback).toBe(true);
    expect(r.message).toBe('Este navegador no permite copiar imágenes. Puedes descargarla.');
    expect(write).not.toHaveBeenCalled();
  });

  it('contexto inseguro → fallback con mensaje de página segura', async () => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false });
    const r = await copyImage(png());
    expect(r.ok).toBe(false);
    expect(r.fallback).toBe(true);
    expect(r.message).toBe('Copiar requiere una página segura (HTTPS o localhost). Puedes descargarla.');
    expect(write).not.toHaveBeenCalled();
  });
});

describe('imageFileName', () => {
  it('genera pf-<selector-saneado>-<escala>x.png', () => {
    expect(imageFileName('#Hero Card', 2)).toBe('pf-hero-card-2x.png');
    expect(imageFileName('#Hero Card', '1.5')).toBe('pf-hero-card-1.5x.png');
  });

  it('usa la escala 1 por defecto y «captura» si el selector está vacío', () => {
    expect(imageFileName('')).toBe('pf-captura-1x.png');
    expect(imageFileName('!!!', 3)).toBe('pf-captura-3x.png');
  });

  it('recorta el selector a 40 caracteres sin guiones sobrantes', () => {
    const name = imageFileName('a'.repeat(60) + ' b', 1);
    expect(name).toBe(`pf-${'a'.repeat(40)}-1x.png`);
  });
});

describe('downloadImage / downloadAll', () => {
  it('downloadImage crea un <a download> con el nombre y lo dispara', () => {
    const blob = png();
    downloadImage(blob, 'pf-hero-1x.png');
    expect(clicks).toEqual([{ download: 'pf-hero-1x.png', href: 'blob:mock' }]);
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('downloadImage acepta data URL', () => {
    downloadImage('data:image/png;base64,AAAA', 'x.png');
    expect(clicks[0]?.download).toBe('x.png');
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
  });

  it('downloadAll descarga una por una y desambigua nombres repetidos', async () => {
    vi.useFakeTimers();
    const p = downloadAll([
      { src: png(), name: 'pf-a-1x.png' },
      { src: png(), name: 'pf-a-1x.png' },
      { src: png(), name: 'pf-b-1x.png' },
    ]);
    await vi.runAllTimersAsync();
    await p;
    expect(clicks.map((c) => c.download)).toEqual(['pf-a-1x.png', 'pf-a-1x-2.png', 'pf-b-1x.png']);
  });
});

describe('mountShotActions', () => {
  const setup = (opts: Partial<Parameters<typeof mountShotActions>[1]> = {}, noImage = false) => {
    const container = document.createElement('div');
    container.className = 'pf-ov-shot-actions';
    document.body.append(container);
    const onResult = vi.fn();
    const base = opts.getBlob || noImage ? {} : { blob: png() };
    const off = mountShotActions(container, { ...base, name: 'pf-hero-1x.png', onResult, ...opts });
    const btn = (label: string) =>
      [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement;
    return { container, off, onResult, btn };
  };

  it('añade los botones Copiar y Descargar', () => {
    const { container } = setup();
    const labels = [...container.querySelectorAll('button')].map((b) => b.textContent?.trim());
    expect(labels).toEqual(['Copiar', 'Descargar']);
  });

  it('Copiar con éxito anuncia «Imagen copiada» en aria-live y no descarga', async () => {
    const { btn, onResult } = setup();
    btn('Copiar').click();
    await flush();
    const live = document.querySelector('[data-pf-copy-live]')!;
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(live.textContent).toBe('Imagen copiada');
    expect(clicks).toHaveLength(0);
    expect(onResult).toHaveBeenCalledWith('Imagen copiada', true);
  });

  it('si Copiar falla, avisa y cae a descarga con el nombre indicado', async () => {
    write.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'NotAllowedError' }));
    const { btn, onResult } = setup();
    btn('Copiar').click();
    await flush();
    expect(clicks.map((c) => c.download)).toEqual(['pf-hero-1x.png']);
    expect(onResult).toHaveBeenNthCalledWith(
      1,
      'El navegador bloqueó el acceso al portapapeles. Puedes descargarla.',
      false,
    );
    expect(onResult).toHaveBeenNthCalledWith(2, 'Imagen descargada', true);
    expect(document.querySelector('[data-pf-copy-live]')!.textContent).toBe('Imagen descargada');
  });

  it('Descargar usa el nombre indicado y anuncia «Imagen descargada»', async () => {
    const { btn, onResult } = setup();
    btn('Descargar').click();
    await flush();
    expect(clicks.map((c) => c.download)).toEqual(['pf-hero-1x.png']);
    expect(write).not.toHaveBeenCalled();
    expect(onResult).toHaveBeenCalledWith('Imagen descargada', true);
  });

  it('getBlob se evalúa perezosamente, al pulsar', async () => {
    const getBlob = vi.fn(() => png());
    const { btn } = setup({ getBlob });
    expect(getBlob).not.toHaveBeenCalled();
    btn('Copiar').click();
    await flush();
    expect(getBlob).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('sin imagen, Copiar informa del error sin lanzar', async () => {
    const { btn, onResult } = setup({}, true);
    btn('Copiar').click();
    await flush();
    expect(onResult).toHaveBeenCalledWith('No se pudo copiar la imagen.', false);
    expect(document.querySelector('[data-pf-copy-live]')!.textContent).toBe('No se pudo copiar la imagen.');
  });

  it('disabled deshabilita ambos botones', () => {
    const { container } = setup({ disabled: true });
    expect([...container.querySelectorAll('button')].every((b) => b.disabled)).toBe(true);
  });

  it('la función devuelta quita los listeners: los clics posteriores no hacen nada', async () => {
    const { btn, off, onResult } = setup();
    const copyBtn = btn('Copiar');
    const downBtn = btn('Descargar');
    off();
    copyBtn.click();
    downBtn.click();
    await flush();
    expect(write).not.toHaveBeenCalled();
    expect(clicks).toHaveLength(0);
    expect(onResult).not.toHaveBeenCalled();
  });
});
