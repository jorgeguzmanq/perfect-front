import { toPng } from 'html-to-image';
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
export async function renderBox(box: Box, scale: CaptureScale, label: string, win: Window = window): Promise<RenderedShot> {
  const root = win.document.documentElement;
  const width = Math.max(1, Math.ceil(box.width));
  const height = Math.max(1, Math.ceil(box.height));
  const dataUrl = await toPng(root, {
    cacheBust: true,
    pixelRatio: scale,
    width,
    height,
    // Las coordenadas del viewport pasan a página sumando el scroll; el clon se traslada para que `box` caiga en (0,0).
    style: { transform: `translate(${-(box.left + win.scrollX)}px, ${-(box.top + win.scrollY)}px)`, transformOrigin: 'top left' },
    filter: (n: Node) => !isPfNode(n),
  });
  const m = /^data:(image\/png);base64,([A-Za-z0-9+/]*={0,2})$/.exec(dataUrl);
  if (!m) throw new Error('formato de captura no soportado');
  const up = ScreenshotUploadSchema.parse({ mimeType: m[1], dataBase64: m[2] });
  const bytes = Math.floor((up.dataBase64.length * 3) / 4);
  if (bytes > MAX_CAPTURE_BYTES) throw new Error('pasa de 5 MB');
  return {
    ...up,
    mimeType: 'image/png',
    name: shotName(label, scale),
    scale,
    width: width * scale,
    height: height * scale,
    bytes,
    label,
  };
}
