import { getFontEmbedCSS, toPng } from 'html-to-image';
import { ScreenshotUploadSchema } from '@perfect-front/shared';
import { MAX_CAPTURE_BYTES, shotName, type Box, type CaptureScale } from './capture-scale';
import { isPfNode } from './constants';
import { describe } from './dom';
import type { CapturedShot } from './types';

const frame = (win: Window): Promise<void> =>
  new Promise((res) => {
    if (typeof win.requestAnimationFrame === 'function') win.requestAnimationFrame(() => res());
    else setTimeout(res, 16);
  });

/** Caja del elemento en coordenadas del viewport. */
export const boxOf = (el: Element): Box => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
};

/** ¿La caja está completa dentro del viewport? */
export function inViewport(b: Box, win: Window): boolean {
  return b.top >= 0 && b.left >= 0 && b.top + b.height <= win.innerHeight && b.left + b.width <= win.innerWidth;
}

/**
 * Si el nodo no se ve entero, lo desplaza a la vista (solo scroll; no toca estilos ni visibilidad).
 * Espera un frame para que el layout se asiente antes de medir.
 */
export async function revealNode(el: Element, win: Window): Promise<void> {
  if (!inViewport(boxOf(el), win) && typeof el.scrollIntoView === 'function') {
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' as ScrollBehavior });
    await frame(win);
  }
}

/** Etiqueta corta de uno o varios nodos para los nombres de archivo («button.cta»). */
export const nodeLabel = (el: Element): string => describe(el).replace(/#/g, '-');

export interface RenderedShot extends CapturedShot {
  /** Etiqueta usada para el nombre (para la tarjeta de resultado). */
  label: string;
}

/**
 * Renderiza de nuevo `box` (viewport) a `scale`× con html-to-image: la página se re-dibuja a esa densidad
 * de píxeles (no se estira una imagen). Los nodos propios (isPfNode: overlay, pines, lanzador y la capa
 * de captura) se excluyen con el filtro, así que NO hace falta ocultar nada de la página real.
 */
export interface RenderBoxOptions {
  /** Camino rápido (1×): reutiliza el CSS de fuentes ya calculado y el último resultado si la página no cambió. */
  fast?: boolean;
  /** Formato del archivo (PNG por defecto). WebP se obtiene re-codificando el render por canvas. */
  format?: 'png' | 'webp';
  /** `transparent` (por defecto) conserva el alfa; `page` pinta el color de fondo computado de la página. */
  background?: 'transparent' | 'page';
  /** Margen en px CSS alrededor del nodo (el render lo incluye; 0 por defecto). */
  margin?: number;
}

/** Color de fondo efectivo de la página: el primero no transparente entre `body` y `html`, o blanco. */
export function pageBackground(win: Window): string {
  for (const el of [win.document.body, win.document.documentElement]) {
    const c = el ? win.getComputedStyle(el).backgroundColor : '';
    if (c && c !== 'transparent' && !/rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0\s*\)/.test(c)) return c;
  }
  return '#ffffff';
}

/** Re-codifica un data URL PNG como WebP (canvas.toDataURL). Falla si el navegador no sabe codificar WebP. */
async function pngToWebp(dataUrl: string, win: Window): Promise<string> {
  const doc = win.document;
  const img = doc.createElement('img');
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error('no se pudo convertir a WebP'));
    img.src = dataUrl;
  });
  const canvas = doc.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('no se pudo convertir a WebP');
  g.drawImage(img, 0, 0);
  const out = canvas.toDataURL('image/webp', 0.92);
  if (!out.startsWith('data:image/webp')) throw new Error('este navegador no codifica WebP');
  return out;
}

// Caché del camino rápido: CSS de fuentes por ventana (se calcula perezosamente en la primera captura)
// y último resultado, válido mientras no haya mutaciones del DOM ni cambie caja, escala o etiqueta.
const fontCss = new WeakMap<Window, Promise<string>>();
const dirty = new WeakMap<Window, { n: number }>();
const lastShot = new WeakMap<Window, { key: string; shot: RenderedShot }>();

function mutations(win: Window): number {
  let c = dirty.get(win);
  if (!c) {
    const counter = { n: 0 };
    c = counter;
    dirty.set(win, c);
    if (typeof (win as Window & typeof globalThis).MutationObserver === 'function') {
      new (win as Window & typeof globalThis).MutationObserver(() => counter.n++).observe(win.document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
    } else counter.n = -1; // sin observador no se puede garantizar «sin cambios»
  }
  return c.n;
}

/** Vacía las cachés del camino rápido de `win` (tests / cambio de página). */
export function resetCaptureCache(win: Window = window): void {
  fontCss.delete(win);
  lastShot.delete(win);
}

export async function renderBox(
  box: Box,
  scale: CaptureScale,
  label: string,
  win: Window = window,
  ropts: RenderBoxOptions = {},
): Promise<RenderedShot> {
  const root = win.document.documentElement;
  const margin = Math.max(0, Math.round(ropts.margin ?? 0));
  const format = ropts.format ?? 'png';
  const page = ropts.background === 'page';
  if (margin) box = { left: box.left - margin, top: box.top - margin, width: box.width + 2 * margin, height: box.height + 2 * margin };
  const fast = ropts.fast === true && scale === 1 && !margin && !page && format === 'png';
  const mut = mutations(win);
  const key = `${mut}|${win.scrollX},${win.scrollY}|${box.left},${box.top},${box.width},${box.height}|${scale}|${label}`;
  if (fast && mut >= 0) {
    const hit = lastShot.get(win);
    if (hit && hit.key === key) return hit.shot;
  }
  let fontEmbedCSS: string | undefined;
  if (fast) {
    let p = fontCss.get(win);
    if (!p) {
      p = getFontEmbedCSS(root, { cacheBust: true, filter: (n: Node) => !isPfNode(n) }).catch(() => '');
      fontCss.set(win, p);
    }
    fontEmbedCSS = await p;
  }
  const width = Math.max(1, Math.ceil(box.width));
  const height = Math.max(1, Math.ceil(box.height));
  let dataUrl = await toPng(root, {
    cacheBust: true,
    pixelRatio: scale,
    width,
    height,
    // Las coordenadas del viewport pasan a página sumando el scroll; el clon se traslada para que `box` caiga en (0,0).
    style: { transform: `translate(${-(box.left + win.scrollX)}px, ${-(box.top + win.scrollY)}px)`, transformOrigin: 'top left' },
    filter: (n: Node) => !isPfNode(n),
    ...(page ? { backgroundColor: pageBackground(win) } : {}),
    ...(fontEmbedCSS ? { fontEmbedCSS } : {}),
  });
  if (format === 'webp') dataUrl = await pngToWebp(dataUrl, win);
  const m = /^data:(image\/(?:png|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(dataUrl);
  if (!m) throw new Error('formato de captura no soportado');
  const up = ScreenshotUploadSchema.parse({ mimeType: m[1], dataBase64: m[2] });
  const bytes = Math.floor((up.dataBase64.length * 3) / 4);
  if (bytes > MAX_CAPTURE_BYTES) throw new Error('pasa de 5 MB');
  const shot: RenderedShot = {
    ...up,
    mimeType: format === 'webp' ? 'image/webp' : 'image/png',
    name: shotName(label, scale, format),
    scale,
    width: width * scale,
    height: height * scale,
    bytes,
    label,
  };
  if (fast) lastShot.set(win, { key, shot });
  return shot;
}
