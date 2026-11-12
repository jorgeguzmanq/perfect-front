import { LIMITS, type AttachmentSource, type AttachmentUpload } from '@perfect-front/shared';
import { localId } from './dom';
import type { ScreenshotUpload } from './types';

/** Imágenes de un comentario en construcción: pegar, soltar, abrir y capturar; máx. 20; reubicables entre secciones. */

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const ACCEPTED_MIME = ['image/png', 'image/jpeg', 'image/webp'] as const;
type Mime = (typeof ACCEPTED_MIME)[number];

export interface PendingImage {
  clientId: string;
  name: string;
  source: AttachmentSource;
  mimeType: Mime;
  bytes: number;
  dataBase64: string;
  /** Sección a la que está atada (null = suelta). */
  sectionId: string | null;
  /** `blob:`/`data:` para la miniatura. */
  previewUrl: string;
}

export type AddResult = { ok: true; image: PendingImage } | { ok: false; error: string };

const isMime = (t: string): t is Mime => (ACCEPTED_MIME as readonly string[]).includes(t);

const EXT: Record<Mime, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/** Nombre seguro y corto (el servidor lo guarda como metadato). */
function safeName(name: string, mime: Mime): string {
  // eslint-disable-next-line no-control-regex -- quita caracteres de control del nombre a propósito
  const base = name.replace(/^.*[\\/]/, '').replace(/[\u0000-\u001F\u007F]/g, '').trim();
  return (base || `imagen.${EXT[mime]}`).slice(0, LIMITS.attachmentName);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

/** Blob de una imagen pendiente (desde su base64, sin fetch). */
export function imageToBlob(m: Pick<PendingImage, 'dataBase64' | 'mimeType'>): Blob {
  const bin = atob(m.dataBase64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m.mimeType });
}

/** Nombre de descarga: el del adjunto con extensión .png (copiar/descargar normalizan a PNG solo al copiar). */
export function downloadNameOf(m: Pick<PendingImage, 'name'>): string {
  return m.name;
}

export interface AttachmentsOptions {
  /** Cambios de lista (contador, miniaturas, «Incluye»). */
  onChange?(): void;
}

export class Attachments {
  private list: PendingImage[] = [];
  /** Suma de caracteres base64 ya aceptados (límite de la request). */
  private chars = 0;

  constructor(private readonly opts: AttachmentsOptions = {}) {}

  get items(): readonly PendingImage[] {
    return this.list;
  }
  get count(): number {
    return this.list.length;
  }
  get remaining(): number {
    return LIMITS.attachments - this.list.length;
  }
  /** Bloqueo: con 20 no se aceptan más. */
  get full(): boolean {
    return this.list.length >= LIMITS.attachments;
  }
  /** «3 / 20». */
  get counter(): string {
    return `${this.list.length} / ${LIMITS.attachments}`;
  }

  /** Valida y suma un File/Blob. Nunca lanza: devuelve el error para mostrarlo en el panel. */
  async addFile(file: File | Blob, source: AttachmentSource, sectionId: string | null = null): Promise<AddResult> {
    const name = (file as File).name ?? '';
    if (this.full) return { ok: false, error: `Máximo ${LIMITS.attachments} imágenes por comentario.` };
    const mime = file.type;
    if (!isMime(mime)) {
      return { ok: false, error: `«${name || 'archivo'}» no es una imagen. Usa PNG, JPG o WebP de hasta 5 MB.` };
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return { ok: false, error: `«${name || 'imagen'}» pesa ${formatBytes(file.size)}. El máximo es 5 MB.` };
    }
    let dataBase64: string;
    try {
      dataBase64 = toBase64(await file.arrayBuffer());
    } catch {
      return { ok: false, error: `No se pudo leer «${name || 'imagen'}».` };
    }
    return this.push({
      mimeType: mime,
      bytes: file.size,
      dataBase64,
      name: safeName(name, mime),
      source,
      sectionId,
      previewUrl: URL.createObjectURL(file),
    });
  }

  /** Varios archivos (drop, input file, pegado). Devuelve los errores acumulados (el primero basta para mostrar). */
  async addFiles(files: Iterable<File | Blob>, source: AttachmentSource, sectionId: string | null = null): Promise<string[]> {
    const errors: string[] = [];
    for (const f of files) {
      const r = await this.addFile(f, source, sectionId);
      if (!r.ok) errors.push(r.error);
    }
    return errors;
  }

  /** Captura de la página (ya viene validada por ScreenshotUploadSchema). */
  addCapture(shot: ScreenshotUpload, sectionId: string | null = null): AddResult {
    if (this.full) return { ok: false, error: `Máximo ${LIMITS.attachments} imágenes por comentario.` };
    const bytes = Math.floor((shot.dataBase64.length * 3) / 4);
    return this.push({
      mimeType: shot.mimeType,
      bytes,
      dataBase64: shot.dataBase64,
      name: `captura.${EXT[shot.mimeType]}`,
      source: 'capture',
      sectionId,
      previewUrl: `data:${shot.mimeType};base64,${shot.dataBase64}`,
    });
  }

  private push(p: Omit<PendingImage, 'clientId'>): AddResult {
    if (this.chars + p.dataBase64.length > LIMITS.uploadsBase64) {
      if (p.previewUrl.startsWith('blob:')) URL.revokeObjectURL(p.previewUrl);
      return { ok: false, error: 'Las imágenes juntas son demasiado grandes. Quita alguna.' };
    }
    const image: PendingImage = { ...p, clientId: localId('img', new Set(this.list.map((i) => i.clientId))) };
    this.chars += p.dataBase64.length;
    this.list.push(image);
    this.opts.onChange?.();
    return { ok: true, image };
  }

  remove(clientId: string): void {
    const i = this.list.findIndex((m) => m.clientId === clientId);
    if (i < 0) return;
    const [m] = this.list.splice(i, 1);
    if (m) {
      this.chars -= m.dataBase64.length;
      if (m.previewUrl.startsWith('blob:')) URL.revokeObjectURL(m.previewUrl);
    }
    this.opts.onChange?.();
  }

  /** Reubica una imagen en otra sección (null = suelta). */
  moveTo(clientId: string, sectionId: string | null): void {
    const m = this.list.find((x) => x.clientId === clientId);
    if (!m || m.sectionId === sectionId) return;
    m.sectionId = sectionId;
    this.opts.onChange?.();
  }

  inSection(sectionId: string | null): PendingImage[] {
    return this.list.filter((m) => m.sectionId === sectionId);
  }

  /** Cuando se borra una sección, sus imágenes quedan sueltas (no se pierden). */
  releaseSection(sectionId: string): void {
    let any = false;
    for (const m of this.list) {
      if (m.sectionId === sectionId) {
        m.sectionId = null;
        any = true;
      }
    }
    if (any) this.opts.onChange?.();
  }

  clear(): void {
    for (const m of this.list) if (m.previewUrl.startsWith('blob:')) URL.revokeObjectURL(m.previewUrl);
    this.list = [];
    this.chars = 0;
    this.opts.onChange?.();
  }

  /** Para `CreateCommentRequest.uploads`. */
  toUploads(): AttachmentUpload[] {
    return this.list.map((m) => ({
      clientId: m.clientId,
      name: m.name,
      source: m.source,
      sectionId: m.sectionId,
      mimeType: m.mimeType,
      dataBase64: m.dataBase64,
    }));
  }
}

/** Archivos de imagen de un DataTransfer / ClipboardData. */
export function imageFilesFrom(dt: DataTransfer | null | undefined): File[] {
  if (!dt) return [];
  const out: File[] = [];
  for (const it of Array.from(dt.items ?? [])) {
    if (it.kind === 'file' && it.type.startsWith('image/')) {
      const f = it.getAsFile();
      if (f) out.push(f);
    }
  }
  if (!out.length) for (const f of Array.from(dt.files ?? [])) if (f.type.startsWith('image/')) out.push(f);
  return out;
}

/** Hay archivos arrastrándose (para mostrar «Suelta para adjuntar» sin leerlos aún). */
export const hasFiles = (dt: DataTransfer | null | undefined): boolean => !!dt && Array.from(dt.types ?? []).includes('Files');

export interface DropzoneHooks {
  onDraggingChange(on: boolean): void;
  /** Recibe los archivos soltados ya filtrados a imágenes. */
  onFiles(files: File[], source: 'drop'): void;
  /** Soltaron algo que no es imagen. */
  onRejected(message: string): void;
}

/** Ctrl+V de imágenes sobre `scope` (normalmente el panel, para que funcione con el foco en el textarea). */
export function bindImagePaste(scope: HTMLElement, onFiles: (files: File[]) => void): () => void {
  const fn = (e: Event) => {
    const files = imageFilesFrom((e as ClipboardEvent).clipboardData);
    if (!files.length) return; // texto: lo maneja el textarea
    e.preventDefault();
    onFiles(files);
  };
  scope.addEventListener('paste', fn);
  return () => scope.removeEventListener('paste', fn);
}

/** Soltar archivos sobre `zone`. Devuelve la función de limpieza. */
export function bindImageDrop(zone: HTMLElement, hooks: DropzoneHooks): () => void {
  let depth = 0;
  const off: Array<() => void> = [];
  const on = (type: string, fn: (e: Event) => void) => {
    zone.addEventListener(type, fn);
    off.push(() => zone.removeEventListener(type, fn));
  };
  on('dragenter', (e) => {
    if (!hasFiles((e as DragEvent).dataTransfer)) return;
    e.preventDefault();
    if (depth++ === 0) hooks.onDraggingChange(true);
  });
  on('dragover', (e) => {
    if (hasFiles((e as DragEvent).dataTransfer)) e.preventDefault();
  });
  on('dragleave', () => {
    if (depth > 0 && --depth === 0) hooks.onDraggingChange(false);
  });
  on('drop', (e) => {
    if (!hasFiles((e as DragEvent).dataTransfer)) return;
    e.preventDefault();
    depth = 0;
    hooks.onDraggingChange(false);
    const files = imageFilesFrom((e as DragEvent).dataTransfer);
    if (files.length) hooks.onFiles(files, 'drop');
    else hooks.onRejected('Solo se pueden adjuntar imágenes (PNG, JPG o WebP).');
  });
  return () => off.forEach((f) => f());
}
