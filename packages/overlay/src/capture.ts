import { toJpeg, toPng } from 'html-to-image';
import { ScreenshotUploadSchema } from '@perfect-front/shared';
import { isPfNode } from './constants';
import type { ScreenshotUpload } from './types';

const MAX_BASE64 = 10_000_000;

function parseDataUrl(url: string): ScreenshotUpload {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(url);
  if (!m) throw new Error('formato de captura no soportado');
  return ScreenshotUploadSchema.parse({ mimeType: m[1], dataBase64: m[2] });
}

/**
 * Captura el viewport actual con html-to-image (el llamador oculta el host del overlay).
 * PNG primero; si excede el límite de shared, reintenta en JPEG a menor calidad/escala.
 */
export async function captureViewport(win: Window = window): Promise<ScreenshotUpload> {
  const doc = win.document;
  const root = doc.documentElement;
  const width = Math.max(1, Math.round(win.innerWidth));
  const height = Math.max(1, Math.round(win.innerHeight));
  const attempt = (pixelRatio: number) => ({
    cacheBust: true,
    pixelRatio,
    width,
    height,
    style: { transform: `translate(${-win.scrollX}px, ${-win.scrollY}px)`, transformOrigin: 'top left' },
    filter: (n: Node) => !isPfNode(n),
  });
  const dpr = Math.min(win.devicePixelRatio || 1, 2);

  const png = await toPng(root, attempt(dpr));
  const dataBase64 = png.slice(png.indexOf(',') + 1);
  if (dataBase64.length <= MAX_BASE64) return parseDataUrl(png);

  for (const [ratio, quality] of [
    [1, 0.8],
    [0.75, 0.6],
  ] as const) {
    const jpeg = await toJpeg(root, { ...attempt(ratio), quality });
    if (jpeg.length - jpeg.indexOf(',') - 1 <= MAX_BASE64) return parseDataUrl(jpeg);
  }
  throw new Error('la captura excede el tamaño máximo permitido');
}
