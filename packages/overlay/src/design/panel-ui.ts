import { h } from '../dom';

/** Piezas DOM vanilla del panel Visual (clases `.pf-dz-*`, ver styles-v2.ts). Sin estado: reciben `doc` y callbacks. */

const NS = 'http://www.w3.org/2000/svg';

/** Icono 16x16 de trazo (`d` = path), decorativo. */
export function svgIcon(doc: Document, d: string, size = 14): SVGSVGElement {
  const svg = doc.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const p = doc.createElementNS(NS, 'path');
  p.setAttribute('d', d);
  svg.appendChild(p);
  return svg;
}

/** Path de un rectángulo (para componer iconos con `d`). */
export const rect = (x: number, y: number, w: number, hh: number): string => `M${x} ${y}h${w}v${hh}h${-w}z`;

export interface SegOption {
  value: string;
  /** Texto o icono (path SVG con prefijo `svg:`). */
  label: string;
  title?: string;
}

export interface SegmentOpts {
  options: SegOption[];
  /** Valor activo (null = ninguno). */
  value: string | null;
  /** `null` = se pulsó la opción ya activa (quitar el cambio). */
  onChange: (v: string | null) => void;
  label: string;
  disabled?: boolean;
  key: string;
}

export function field(doc: Document, label: string, ...children: Node[]): HTMLElement {
  const f = h(doc, 'div', 'pf-dz-field');
  f.appendChild(h(doc, 'span', 'pf-dz-lbl', label));
  f.append(...children);
  return f;
}

export function grid2(doc: Document, ...children: Node[]): HTMLElement {
  const g = h(doc, 'div', 'pf-dz-g2');
  g.append(...children);
  return g;
}

export function tip(doc: Document, text: string): HTMLElement {
  return h(doc, 'span', 'pf-dz-tip', text);
}

export function segment(doc: Document, o: SegmentOpts): HTMLElement {
  const seg = h(doc, 'div', 'pf-dz-seg');
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', o.label);
  for (const op of o.options) {
    const b = h(doc, 'button', 'pf-dz-segbtn');
    b.type = 'button';
    b.dataset.key = `${o.key}:${op.value}`;
    b.disabled = !!o.disabled;
    b.setAttribute('aria-pressed', String(op.value === o.value));
    b.title = op.title ?? op.value;
    b.setAttribute('aria-label', `${o.label}: ${op.title ?? op.value}`);
    if (op.label.startsWith('svg:')) b.appendChild(svgIcon(doc, op.label.slice(4)));
    else b.textContent = op.label;
    b.addEventListener('click', () => o.onChange(op.value === o.value ? null : op.value));
    seg.appendChild(b);
  }
  return seg;
}

export interface NumberOpts {
  /** Valor numérico actual (sin unidad) o '' si no hay. */
  value: string;
  unit?: string;
  label: string;
  key: string;
  /** Escala para ↑/↓ (valores ascendentes). */
  scale?: readonly number[];
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  placeholder?: string;
  /** `input` = al teclear (sin redibujar); `change` = al confirmar. '' = quitar el cambio. */
  onInput: (v: string) => void;
  onChange: (v: string) => void;
}

export function numberInput(doc: Document, o: NumberOpts): HTMLElement {
  const wrap = h(doc, 'span', 'pf-dz-num');
  const inp = h(doc, 'input');
  inp.type = 'text';
  inp.inputMode = 'decimal';
  inp.spellcheck = false;
  inp.value = o.value;
  inp.placeholder = o.placeholder ?? '·';
  inp.disabled = !!o.disabled;
  inp.dataset.key = o.key;
  inp.setAttribute('aria-label', o.label);
  inp.addEventListener('input', () => o.onInput(inp.value.trim()));
  inp.addEventListener('change', () => o.onChange(inp.value.trim()));
  inp.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const up = e.key === 'ArrowUp';
    const cur = Number(inp.value);
    const base = Number.isFinite(cur) && inp.value.trim() !== '' ? cur : 0;
    let next: number;
    if (o.scale?.length) {
      next = up ? (o.scale.find((s) => s > base) ?? base) : ([...o.scale].reverse().find((s) => s < base) ?? base);
    } else {
      const step = (o.step ?? 1) * (e.shiftKey ? 10 : 1);
      next = base + (up ? step : -step);
    }
    if (o.min !== undefined) next = Math.max(o.min, next);
    if (o.max !== undefined) next = Math.min(o.max, next);
    inp.value = String(Math.round(next * 100) / 100);
    o.onChange(inp.value);
  });
  wrap.appendChild(inp);
  if (o.unit) wrap.appendChild(h(doc, 'em', undefined, o.unit));
  return wrap;
}

export interface SectionOpts {
  title: string;
  icon: string;
  open: boolean;
  /** Número de cambios propuestos en la sección. */
  changes: number;
  onToggle: () => void;
  key: string;
}

export function section(doc: Document, o: SectionOpts, body: Node): HTMLElement {
  const s = h(doc, 'section', 'pf-dz-sec');
  const head = h(doc, 'button', 'pf-dz-sech');
  head.type = 'button';
  head.dataset.key = `sec:${o.key}`;
  head.setAttribute('aria-expanded', String(o.open));
  head.append(svgIcon(doc, o.icon, 14), h(doc, 'b', undefined, o.title));
  if (o.changes) head.appendChild(h(doc, 'span', 'pf-dz-chg', `${o.changes}`));
  head.appendChild(svgIcon(doc, 'M6 9l6 6 6-6', 14));
  head.addEventListener('click', o.onToggle);
  s.appendChild(head);
  if (o.open) {
    const b = h(doc, 'div', 'pf-dz-secb');
    b.appendChild(body);
    s.appendChild(b);
  }
  return s;
}

export interface SwatchOpts {
  /** Valor CSS aplicado (hex, rgb, `transparent`). */
  value: string;
  title: string;
  active: boolean;
  key: string;
  disabled?: boolean;
  onPick: () => void;
}

export function swatch(doc: Document, o: SwatchOpts): HTMLButtonElement {
  const b = h(doc, 'button', o.value === 'transparent' ? 'pf-dz-swt pf-dz-swt--none' : 'pf-dz-swt');
  b.type = 'button';
  b.title = o.title;
  b.setAttribute('aria-label', o.title);
  b.setAttribute('aria-pressed', String(o.active));
  b.dataset.key = o.key;
  b.disabled = !!o.disabled;
  if (o.value !== 'transparent') b.style.background = o.value;
  b.addEventListener('click', o.onPick);
  return b;
}

/** Pestañas pequeñas (Fondo / Texto / Borde). */
export function pills(
  doc: Document,
  items: Array<{ value: string; label: string }>,
  value: string,
  onPick: (v: string) => void,
  key: string,
): HTMLElement {
  const wrap = h(doc, 'div', 'pf-dz-pills');
  for (const it of items) {
    const b = h(doc, 'button', 'pf-dz-pill', it.label);
    b.type = 'button';
    b.dataset.key = `${key}:${it.value}`;
    b.setAttribute('aria-pressed', String(it.value === value));
    b.addEventListener('click', () => onPick(it.value));
    wrap.appendChild(b);
  }
  return wrap;
}
