const NS = 'http://www.w3.org/2000/svg';

const PATHS = {
  up: 'M4 10l4-4 4 4',
  down: 'M4 6l4 4 4-4',
  select: 'M3 3h3M10 3h3M3 3v3M13 3v3M3 13h3M3 10v3M13 10v1M7.5 7.5l5 2-2 1-1 2z',
  trash: 'M3 4.5h10M6.5 4.5V3h3v1.5M5 4.5l.5 8h5l.5-8',
  close: 'M4 4l8 8M12 4l-8 8',
  layers: 'M2.5 5h11M2.5 8h11M2.5 11h11',
  comment: 'M3 3.5h10v7H7.5L5 13v-2.5H3z',
} as const;

export type IconName = keyof typeof PATHS;

/** Icono SVG de 16x16 con `currentColor`; decorativo (aria-hidden). */
export function icon(doc: Document, name: IconName): SVGSVGElement {
  const svg = doc.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const p = doc.createElementNS(NS, 'path');
  p.setAttribute('d', PATHS[name]);
  svg.appendChild(p);
  return svg;
}
