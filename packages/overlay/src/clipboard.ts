import { h } from './dom';
import { icon } from './icons';

/** Copiar/descargar imágenes. El portapapeles solo acepta PNG; copia de una en una. Sin dependencias del editor. */

export type ImageSource = Blob | string;

export interface CopyResult {
  ok: boolean;
  /** Mensaje en español listo para mostrar. */
  message: string;
  /** true = no se pudo copiar y conviene ofrecer la descarga. */
  fallback: boolean;
}

/** `data:` → Blob (sin fetch: puede estar bloqueado por CSP de la página). */
export function dataUrlToBlob(dataUrl: string): Blob {
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m) throw new Error('data URL inválida');
  const bin = m[2] ? atob(m[3] ?? '') : decodeURIComponent(m[3] ?? '');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] || 'application/octet-stream' });
}

export const toBlob = (src: ImageSource): Blob => (typeof src === 'string' ? dataUrlToBlob(src) : src);

/** JPEG/WebP → PNG vía canvas (el portapapeles solo acepta image/png). */
export async function toPng(src: ImageSource): Promise<Blob> {
  const blob = toBlob(src);
  if (blob.type === 'image/png') return blob;
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('decode'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const g = canvas.getContext('2d');
    if (!g) throw new Error('canvas');
    g.drawImage(img, 0, 0);
    return await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob'))), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Nunca lanza: devuelve el motivo en español. */
export async function copyImage(src: ImageSource): Promise<CopyResult> {
  const fail = (message: string): CopyResult => ({ ok: false, message: `${message} Puedes descargarla.`, fallback: true });
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    return fail('Copiar requiere una página segura (HTTPS o localhost).');
  }
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
    return fail('Este navegador no permite copiar imágenes.');
  }
  if (typeof document !== 'undefined' && typeof document.hasFocus === 'function' && !document.hasFocus()) {
    return fail('La página no tiene el foco; haz clic en ella e inténtalo de nuevo.');
  }
  try {
    const png = await toPng(src);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    return { ok: true, message: 'Imagen copiada', fallback: false };
  } catch (e) {
    const name = (e as { name?: string } | null)?.name;
    if (name === 'NotAllowedError') return fail('El navegador bloqueó el acceso al portapapeles.');
    if (name === 'SecurityError') return fail('El navegador no permite copiar desde esta página.');
    return fail('No se pudo copiar la imagen.');
  }
}

/** pf-<selector-saneado>-<escala>x.png */
export function imageFileName(selector: string, scale: number | string = 1): string {
  const s = (selector || 'captura')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `pf-${s || 'captura'}-${scale}x.png`;
}

/** Descarga vía <a download>. */
export function downloadImage(src: ImageSource, name: string): void {
  const blob = toBlob(src);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** «Descargar todas»: una descarga por imagen, espaciadas para que el navegador no las bloquee. */
export async function downloadAll(items: Array<{ src: ImageSource; name: string }>): Promise<void> {
  const used = new Map<string, number>();
  for (const it of items) {
    const n = used.get(it.name) ?? 0;
    used.set(it.name, n + 1);
    const name = n ? it.name.replace(/(\.[^.]+)?$/, `-${n + 1}$1`) : it.name;
    downloadImage(it.src, name);
    await new Promise((r) => setTimeout(r, 150));
  }
}

/** Región aria-live compartida por documento (se reutiliza; no se libera con cada botón). */
export function announceCopy(doc: Document, message: string, root: ParentNode = doc.body): void {
  let live = root.querySelector<HTMLElement>('[data-pf-copy-live]');
  if (!live) {
    live = h(doc, 'div', 'pf-ov-sr-only');
    live.setAttribute('data-pf-copy-live', '');
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');
    (root instanceof Element || root instanceof ShadowRoot || root instanceof DocumentFragment ? root : doc.body).appendChild(live);
  }
  live.textContent = '';
  // Re-escritura en el siguiente tick para que el lector repita mensajes iguales.
  setTimeout(() => {
    if (live) live.textContent = message;
  }, 30);
}

export interface ShotActionsOptions {
  blob?: Blob;
  /** Alternativa perezosa (p. ej. canvas.toBlob). Se evalúa al pulsar. */
  getBlob?: () => Blob | Promise<Blob>;
  /** Nombre de descarga (usa `imageFileName`). */
  name: string;
  /** Raíz para la región aria-live (por defecto, el contenedor). */
  liveRoot?: ParentNode;
  disabled?: boolean;
  /** Se llama tras copiar/descargar (mensaje ya listo, p. ej. para un toast propio). */
  onResult?(message: string, ok: boolean): void;
}

/** Añade «Copiar» y «Descargar» a `container` (p. ej. `.pf-ov-shot-actions`). Devuelve la función de limpieza. */
export function mountShotActions(container: HTMLElement, opts: ShotActionsOptions): () => void {
  const doc = container.ownerDocument;
  const off: Array<() => void> = [];
  const resolve = async (): Promise<Blob> => {
    if (opts.blob) return opts.blob;
    if (opts.getBlob) return opts.getBlob();
    throw new Error('sin imagen');
  };
  const mk = (label: string, ic: 'copy' | 'down', title: string, run: () => Promise<void>): HTMLButtonElement => {
    const b = h(doc, 'button', 'pf-dk-key pf-dk-key--sm pf-ov-clip-btn');
    b.type = 'button';
    b.title = title;
    b.disabled = !!opts.disabled;
    b.append(icon(doc, ic, 13), doc.createTextNode(` ${label}`));
    const fn = () => {
      void run();
    };
    b.addEventListener('click', fn);
    off.push(() => b.removeEventListener('click', fn));
    return b;
  };
  const say = (message: string, ok: boolean) => {
    announceCopy(doc, message, opts.liveRoot ?? (container.getRootNode() as ParentNode));
    opts.onResult?.(message, ok);
  };
  const download = async () => {
    try {
      downloadImage(await resolve(), opts.name);
      say('Imagen descargada', true);
    } catch {
      say('No se pudo descargar la imagen.', false);
    }
  };
  const copy = async () => {
    try {
      const r = await copyImage(await resolve());
      if (r.ok) return say(r.message, true);
      say(r.message, false);
      if (r.fallback) await download();
    } catch {
      say('No se pudo copiar la imagen.', false);
    }
  };
  container.append(mk('Copiar', 'copy', 'Copiar la imagen al portapapeles', copy), mk('Descargar', 'down', 'Descargar la imagen', download));
  return () => {
    off.forEach((f) => f());
    off.length = 0;
  };
}
