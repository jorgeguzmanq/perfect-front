/** Lógica pura de la captura de nodos: escalas disponibles, tamaño real en píxeles y nombres de archivo. */

export const CAPTURE_SCALES = [1, 2, 3, 4] as const;
export type CaptureScale = (typeof CAPTURE_SCALES)[number];

/** Lado máximo del resultado (px): por encima, los navegadores no pueden crear el canvas. */
export const MAX_CAPTURE_SIDE = 16_384;
/** Área máxima del resultado (px²): más allá, el canvas falla o agota la memoria. */
export const MAX_CAPTURE_PIXELS = 100_000_000;
/** Peso máximo por archivo (coincide con MAX_IMAGE_BYTES de los adjuntos). */
export const MAX_CAPTURE_BYTES = 5 * 1024 * 1024;

export interface Size {
  width: number;
  height: number;
}

export interface Box extends Size {
  left: number;
  top: number;
}

export interface ScaleOption {
  scale: CaptureScale;
  /** Tamaño real en píxeles del resultado a esta escala. */
  width: number;
  height: number;
  enabled: boolean;
  /** Motivo por el que está deshabilitada. */
  reason?: string;
}

/** 16384 -> «16 384» (sin depender del locale). */
export const formatPx = (n: number): string => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/** «496×136». */
export const formatSize = (s: Size): string => `${formatPx(s.width)}×${formatPx(s.height)}`;

/**
 * Opciones de escala para un nodo de `w`×`h` px CSS: tamaño real de cada una y si excede `max` px por lado
 * (o el área máxima). Función pura: no toca el DOM.
 */
export function scaleOptions(
  w: number,
  h: number,
  max: number = MAX_CAPTURE_SIDE,
  scales: readonly CaptureScale[] = CAPTURE_SCALES,
): ScaleOption[] {
  const bw = Math.max(1, Math.ceil(Number.isFinite(w) ? w : 1));
  const bh = Math.max(1, Math.ceil(Number.isFinite(h) ? h : 1));
  return scales.map((scale) => {
    const width = bw * scale;
    const height = bh * scale;
    if (width > max || height > max) {
      return { scale, width, height, enabled: false, reason: `Pasa de ${formatPx(max)} px por lado` };
    }
    if (width * height > MAX_CAPTURE_PIXELS) {
      return { scale, width, height, enabled: false, reason: 'Demasiados píxeles para renderizarse' };
    }
    return { scale, width, height, enabled: true };
  });
}

/**
 * Opciones para varios nodos «por separado»: se muestra el tamaño del nodo más grande y una escala
 * queda deshabilitada si cualquiera de los nodos la excede.
 */
export function scaleOptionsForEach(sizes: readonly Size[], max: number = MAX_CAPTURE_SIDE): ScaleOption[] {
  if (sizes.length === 0) return scaleOptions(1, 1, max);
  const biggest = sizes.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a));
  const base = scaleOptions(biggest.width, biggest.height, max);
  return base.map((o) => {
    if (o.enabled) {
      const bad = sizes.map((s) => scaleOptions(s.width, s.height, max).find((x) => x.scale === o.scale)!).find((x) => !x.enabled);
      if (bad) return bad.reason === undefined ? { ...o, enabled: false } : { ...o, enabled: false, reason: bad.reason };
    }
    return o;
  });
}

/** Caja que contiene a todas (coordenadas del viewport). null si no hay ninguna. */
export function unionBox(boxes: readonly Box[]): Box | null {
  if (boxes.length === 0) return null;
  let l = Infinity;
  let t = Infinity;
  let r = -Infinity;
  let b = -Infinity;
  for (const x of boxes) {
    l = Math.min(l, x.left);
    t = Math.min(t, x.top);
    r = Math.max(r, x.left + x.width);
    b = Math.max(b, x.top + x.height);
  }
  return { left: l, top: t, width: r - l, height: b - t };
}

/** Parte de `label` apta para un nombre de archivo (a-z, 0-9, guion). */
export function slug(label: string): string {
  const s = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return s || 'nodo';
}

/** `nodo-button-cta@2x.png`. */
export function shotName(label: string, scale: CaptureScale, ext = 'png'): string {
  return `nodo-${slug(label)}@${scale}x.${ext}`;
}
