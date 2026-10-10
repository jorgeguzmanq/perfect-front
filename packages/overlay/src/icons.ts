const NS = 'http://www.w3.org/2000/svg';

const PATHS = {
  up: 'M4 10l4-4 4 4',
  down: 'M4 6l4 4 4-4',
  select: 'M3 3h3M10 3h3M3 3v3M13 3v3M3 13h3M3 10v3M13 10v1M7.5 7.5l5 2-2 1-1 2z',
  trash: 'M3 4.5h10M6.5 4.5V3h3v1.5M5 4.5l.5 8h5l.5-8',
  close: 'M4 4l8 8M12 4l-8 8',
  layers: 'M2.5 5h11M2.5 8h11M2.5 11h11',
  comment: 'M3 3.5h10v7H7.5L5 13v-2.5H3z',
  left: 'M10 4l-4 4 4 4',
  right: 'M6 4l4 4-4 4',
  cam: 'M2.5 5h2l1-1.5h5l1 1.5h2v7.5h-11zM8 10.2a2 2 0 100-.01',
  list: 'M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01',
  check: 'M3.5 8.5l3 3 6-6.5',
  warn: 'M8 3l5.5 9.5h-11zM8 7v2.5M8 11.2v.01',
  plus: 'M8 3.5v9M3.5 8h9',
  lock: 'M4.5 7.5h7v5h-7zM6 7.5V5.5a2 2 0 014 0v2',
  img: 'M2.5 3.5h11v9h-11zM2.5 10.5l3-3 3 3 2-2 3 3M10.5 6.2v.01',
  link: 'M6.5 9.5a2.5 2.5 0 003.5 0l2-2a2.5 2.5 0 00-3.5-3.5l-.5.5M9.5 6.5a2.5 2.5 0 00-3.5 0l-2 2a2.5 2.5 0 003.5 3.5l.5-.5',
  grip: 'M6 4h.01M10 4h.01M6 8h.01M10 8h.01M6 12h.01M10 12h.01',
  copy: 'M5.5 5.5h7v7h-7zM3.5 10.5v-7h7',
  style: 'M3 13l1-3 7-7 2 2-7 7zM9.5 4.5l2 2',
  move: 'M8 2.5v11M5 5l3-2.5L11 5M5 11l3 2.5 3-2.5',
  queue: 'M3 4h10M3 8h8M3 12h5',
  undo: 'M5 4L2.5 6.5 5 9M2.5 6.5H9a3.5 3.5 0 010 7H6',
  folder: 'M2 4.5h4l1.5 1.5H14v6.5H2z',
  chev: 'M4 6l4 4 4-4',
  node: 'M3 3h10v10H3zM6 6h4v4H6z',
  text: 'M3 4h10M8 4v9M6 13h4',
  globe: 'M8 2.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2.5 8h11M8 2.5c1.8 1.6 2.6 3.4 2.6 5.5S9.8 11.9 8 13.5C6.2 11.9 5.4 10.1 5.4 8S6.2 4.1 8 2.5z',
  eyeoff: 'M2 2l12 12M6.2 4.4A6.6 6.6 0 018 4c4.2 0 6.5 4 6.5 4a11 11 0 01-2 2.4M4.3 5.7C2.7 6.9 1.5 8 1.5 8s2.3 4 6.5 4c.8 0 1.5-.2 2.1-.4',
} as const;

export type IconName = keyof typeof PATHS;

/** Icono SVG (16x16 por defecto) con `currentColor`; decorativo (aria-hidden). */
export function icon(doc: Document, name: IconName, size = 16): SVGSVGElement {
  const svg = doc.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
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
