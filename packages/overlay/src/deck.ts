import { h } from './dom';
import { icon, type IconName } from './icons';

/**
 * «Comment Deck»: piezas DOM reutilizables del nuevo look del overlay (manual `.design/overlay-layer-immersive-minimalist.html`).
 * Cada helper devuelve un elemento con clases `pf-dk-*` (CSS en styles-deck.ts); no tienen estado ni registran
 * listeners salvo el `onClick` que se les pasa. Las capas del overlay las componen sin inventar CSS propio.
 */

/** Tono de un LED / texto de LCD. */
export type DeckTone = 'violet' | 'teal' | 'green' | 'amber' | 'red';
/** Tipos de texto del LCD: t1 (grande), t2 (título), tx (cuerpo), ts (secundario), tg (destacado). */
export type DeckText = 't1' | 't2' | 'tx' | 'ts' | 'tg';
export type KeyVariant = 'lit' | 'hot' | 'ghost' | 'dng';

/** Nombres de clase del deck, para quien necesite componerlos a mano (p. ej. añadir a un botón existente). */
export const DK = {
  unit: 'pf-dk-unit',
  lcd: 'pf-dk-lcd',
  lp: 'pf-dk-lp',
  key: 'pf-dk-key',
  tray: 'pf-dk-tray',
  rack: 'pf-dk-rack',
  chip: 'pf-dk-chip',
  led: 'pf-dk-led',
  lab: 'pf-dk-lab',
  kb: 'pf-dk-kb',
  warn: 'pf-dk-warn',
  lin: 'pf-dk-lin',
  fx: 'pf-dk-fx',
  col: 'pf-dk-col',
  grow: 'pf-dk-grow',
} as const;

const cls = (...parts: Array<string | false | null | undefined>): string => parts.filter(Boolean).join(' ');

// --- Chasis, pantalla y texto -------------------------------------------------------------------

export interface UnitOpts {
  /** Rótulo del modelo («PF·NOTE»). Sin él no se pinta la línea de modelo. */
  model?: string;
  /** Número de capa en negrita junto al modelo («03»). */
  name?: string;
  cls?: string;
}

/** Chasis `.unit`: contenedor oscuro de cada módulo. */
export function unit(doc: Document, o: UnitOpts = {}): HTMLElement {
  const u = h(doc, 'div', cls(DK.unit, o.cls));
  if (o.model) {
    const m = h(doc, 'div', 'pf-dk-model', `${o.model} `);
    if (o.name) m.appendChild(h(doc, 'b', undefined, o.name));
    m.appendChild(h(doc, 'i'));
    u.appendChild(m);
  }
  return u;
}

/** Pantalla `.lcd` (con relleno `.lp` por defecto). */
export function lcd(doc: Document, o: { pad?: boolean; cls?: string } = {}): HTMLElement {
  return h(doc, 'div', cls(DK.lcd, o.pad !== false && DK.lp, o.cls));
}

/** Texto de LCD (`t1`/`t2`/`tx`/`ts`/`tg`) con tono opcional. */
export function text(doc: Document, kind: DeckText, content: string | Node, tone?: DeckTone, tag: 'div' | 'span' | 'p' = 'div'): HTMLElement {
  const e = h(doc, tag, cls(`pf-dk-${kind}`, tone && `pf-dk-tone-${tone}`));
  if (typeof content === 'string') e.textContent = content;
  else e.appendChild(content);
  return e;
}

/** Etiqueta de panel `.lab` (`paper` = tono claro). */
export function lab(doc: Document, content: string, paper = false): HTMLElement {
  return h(doc, 'div', cls(DK.lab, paper && 'pf-dk-lab--p'), content);
}

/** Tecla de teclado `.kb` («Ctrl», «↵», «Esc»). */
export function kb(doc: Document, label: string): HTMLElement {
  return h(doc, 'kbd', DK.kb, label);
}

/** Etiqueta cuadrada `.tagk` (tag del elemento en la cabecera de identidad). */
export function tagk(doc: Document, label: string): HTMLElement {
  const t = h(doc, 'span', 'pf-dk-tagk', label);
  t.setAttribute('aria-hidden', 'true');
  return t;
}

// --- Teclas, LED, chips ------------------------------------------------------------------------

export interface KeyOpts {
  variant?: KeyVariant | undefined;
  /** Tecla cuadrada (solo icono). Exige `ariaLabel`. */
  sq?: boolean;
  sm?: boolean;
  tall?: boolean;
  icon?: IconName;
  iconSize?: number;
  /** `aria-label` (y `title` si no se da otro). */
  ariaLabel?: string;
  title?: string;
  disabled?: boolean;
  /** `aria-pressed`. */
  pressed?: boolean;
  /** Clases extra. */
  cls?: string;
  onClick?: (e: MouseEvent) => void;
}

/** Tecla `.key` (botón). `label` puede ir vacío para teclas de solo icono. */
export function key(doc: Document, label: string, o: KeyOpts = {}): HTMLButtonElement {
  const b = h(
    doc,
    'button',
    cls(
      DK.key,
      o.variant === 'lit' && 'pf-dk-key--lit',
      o.variant === 'hot' && 'pf-dk-key--hot',
      o.variant === 'ghost' && 'pf-dk-key--ghost',
      o.variant === 'dng' && 'pf-dk-key--dng',
      o.sq && 'pf-dk-key--sq',
      o.sm && 'pf-dk-key--sm',
      o.tall && 'pf-dk-key--tall',
      o.cls,
    ),
  );
  b.type = 'button';
  if (o.icon) b.appendChild(icon(doc, o.icon, o.iconSize ?? 16));
  if (label) b.appendChild(doc.createTextNode(o.icon ? ` ${label}` : label));
  if (o.ariaLabel) {
    b.setAttribute('aria-label', o.ariaLabel);
    b.title = o.title ?? o.ariaLabel;
  } else if (o.title) b.title = o.title;
  if (o.disabled) b.disabled = true;
  if (o.pressed !== undefined) b.setAttribute('aria-pressed', String(o.pressed));
  if (o.onClick) b.addEventListener('click', o.onClick);
  return b;
}

/** Marca una tecla existente como encendida/apagada (`.key.lit`) sin recrearla. */
export function setLit(b: HTMLElement, on: boolean): void {
  b.classList.toggle('pf-dk-key--lit', on);
}

/** Contador `.cnt` dentro de una tecla. */
export function cnt(doc: Document, n: number | string): HTMLElement {
  return h(doc, 'span', 'pf-dk-cnt', String(n));
}

/** LED `.led` (tono `violet` por defecto cuando está encendido). */
export function led(doc: Document, on = true, tone: DeckTone = 'violet'): HTMLElement {
  const l = h(doc, 'i', cls(DK.led, tone !== 'violet' && `pf-dk-led--${tone}`, on && 'pf-dk-led--on'));
  l.setAttribute('aria-hidden', 'true');
  return l;
}

export interface ChipOpts {
  on?: boolean;
  /** Pinta un LED delante (encendido si `on`). */
  led?: boolean | DeckTone;
  icon?: IconName;
  tag?: 'span' | 'button' | 'code';
  onClick?: ((e: MouseEvent) => void) | undefined;
}

/** Chip `.chip` (pastilla con LED). Con `onClick` o `tag: 'button'` es un botón. */
export function chip(doc: Document, label: string, o: ChipOpts = {}): HTMLElement {
  const tag = o.tag ?? (o.onClick ? 'button' : 'span');
  const c = h(doc, tag, cls(DK.chip, o.on && 'pf-dk-chip--on'));
  if (c instanceof HTMLButtonElement) c.type = 'button';
  if (o.led) c.appendChild(led(doc, !!o.on, typeof o.led === 'string' ? o.led : 'violet'));
  if (o.icon) c.appendChild(icon(doc, o.icon, 13));
  c.appendChild(doc.createTextNode(label));
  if (o.onClick) c.addEventListener('click', o.onClick as EventListener);
  return c;
}

// --- Bandejas, racks, filas ---------------------------------------------------------------------

/** Bandeja `.tray`: grupo de teclas (pestañas, alcance, idioma). */
export function tray(doc: Document, keys: readonly HTMLElement[] = [], o: { label?: string; role?: string; cls?: string } = {}): HTMLElement {
  const t = h(doc, 'div', cls(DK.tray, o.cls));
  if (o.role) t.setAttribute('role', o.role);
  if (o.label) t.setAttribute('aria-label', o.label);
  t.append(...keys);
  return t;
}

/** Rack `.rack`: fila de módulo (lista de hermanos, grupos, cola). `cur` = actual. */
export function rack(doc: Document, o: { cur?: boolean; cls?: string } = {}): HTMLElement {
  return h(doc, 'div', cls(DK.rack, o.cur && 'pf-dk-rack--cur', o.cls));
}

/** Número `.num` de una fila de rack. */
export function num(doc: Document, n: number | string): HTMLElement {
  return h(doc, 'span', 'pf-dk-num', String(n));
}

/** Fila `.lrow` dentro de un LCD (separada por línea). */
export function lrow(doc: Document, ...children: Array<Node | string>): HTMLElement {
  const r = h(doc, 'div', 'pf-dk-lrow');
  r.append(...children);
  return r;
}

/** Aviso `.warn` (`bad` = error). Usa `role="alert"` solo si es error. */
export function warn(doc: Document, message: string | Node, o: { bad?: boolean; icon?: IconName | null; cls?: string } = {}): HTMLElement {
  const w = h(doc, 'p', cls(DK.warn, o.bad && 'pf-dk-warn--bad', o.cls));
  const ic = o.icon === undefined ? 'warn' : o.icon;
  if (ic) w.appendChild(icon(doc, ic, 16));
  const body = h(doc, 'span', 'pf-dk-grow');
  if (typeof message === 'string') body.textContent = message;
  else body.appendChild(message);
  w.appendChild(body);
  if (o.bad) w.setAttribute('role', 'alert');
  return w;
}

/** Interruptor `.tog` (`role="switch"` + `aria-pressed`). El llamador conecta el clic. */
export function toggle(doc: Document, pressed: boolean, ariaLabel: string, onToggle?: (next: boolean) => void): HTMLButtonElement {
  const b = h(doc, 'button', 'pf-dk-tog');
  b.type = 'button';
  b.setAttribute('role', 'switch');
  b.setAttribute('aria-pressed', String(pressed));
  b.setAttribute('aria-checked', String(pressed));
  b.setAttribute('aria-label', ariaLabel);
  b.addEventListener('click', () => {
    const next = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', String(next));
    b.setAttribute('aria-checked', String(next));
    onToggle?.(next);
  });
  return b;
}

/** Barra de progreso `.pbar` (0–100; `ok` = verde). */
export function pbar(doc: Document, percent: number, ok = false): HTMLElement {
  const pct = Math.max(0, Math.min(100, percent));
  const p = h(doc, 'div', cls('pf-dk-pbar', ok && 'pf-dk-pbar--ok'));
  p.setAttribute('role', 'progressbar');
  p.setAttribute('aria-valuemin', '0');
  p.setAttribute('aria-valuemax', '100');
  p.setAttribute('aria-valuenow', String(Math.round(pct)));
  const i = h(doc, 'i');
  i.style.width = `${pct}%`;
  p.appendChild(i);
  return p;
}

// --- Piezas compuestas --------------------------------------------------------------------------

export interface IdHeaderOpts {
  /** Etiqueta cuadrada (tag del elemento, «vista», número de nodos). */
  tag: string;
  title: string;
  sub: string;
  /** Texto añadido en gris tras el título («en PricingCard»). */
  titleNote?: string;
  /** Acciones a la derecha (teclas `sq`). */
  actions?: readonly HTMLElement[];
  /** Clases extra del LCD. */
  cls?: string;
}

/** Cabecera de identidad (`idHdr`): tag + título + subtítulo + acciones, dentro de un LCD. */
export function idHeader(doc: Document, o: IdHeaderOpts): { root: HTMLElement; title: HTMLElement; sub: HTMLElement; tools: HTMLElement } {
  const root = h(doc, 'div', cls(DK.lcd, DK.lp, DK.fx, 'pf-dk-g12', 'pf-dk-idhdr', o.cls));
  const id = h(doc, 'div', cls(DK.grow, 'pf-dk-id'));
  const title = h(doc, 'h2', 'pf-dk-t2', o.title);
  if (o.titleNote) title.appendChild(h(doc, 'small', 'pf-dk-ts', ` ${o.titleNote}`));
  const sub = h(doc, 'p', 'pf-dk-ts pf-dk-ell', o.sub);
  sub.title = o.sub;
  id.append(title, sub);
  const tools = h(doc, 'div', cls(DK.fx, 'pf-dk-g6'));
  if (o.actions) tools.append(...o.actions);
  root.append(tagk(doc, o.tag), id, tools);
  return { root, title, sub, tools };
}

/** Barra «Incluye»: etiqueta + chips encendidos con LED. Devuelve null si no hay nada. */
export function incl(doc: Document, items: ReadonlyArray<{ label: string; onClick?: () => void }>): HTMLElement | null {
  if (!items.length) return null;
  const box = h(doc, 'div', cls(DK.fx, 'pf-dk-g8', 'pf-dk-wr', 'pf-dk-incl'));
  box.appendChild(h(doc, 'span', DK.lab, 'Incluye'));
  for (const it of items) box.appendChild(chip(doc, it.label, { on: true, led: true, onClick: it.onClick }));
  return box;
}

/** Pie de acciones: atajos a la izquierda, `Cancelar` fantasma y la acción principal `hot`. */
export function foot(
  doc: Document,
  o: { shortcuts?: ReadonlyArray<{ keys: readonly string[]; label: string }>; extra?: readonly HTMLElement[]; cancel: HTMLElement; primary: HTMLElement },
): HTMLElement {
  const f = h(doc, 'div', cls(DK.fx, 'pf-dk-g12', 'pf-dk-foot'));
  const hints = h(doc, 'div', cls('pf-dk-ts', DK.grow, 'pf-dk-keys'));
  for (const [i, s] of (o.shortcuts ?? []).entries()) {
    if (i) hints.appendChild(doc.createTextNode(' · '));
    s.keys.forEach((k, j) => {
      if (j) hints.appendChild(doc.createTextNode(' '));
      hints.appendChild(kb(doc, k));
    });
    hints.appendChild(doc.createTextNode(` ${s.label}`));
  }
  f.append(hints, ...(o.extra ?? []), o.cancel, o.primary);
  return f;
}

/** Diff antes → después (`.diff`). */
export function diff(doc: Document, before: string, after: string): HTMLElement {
  const d = h(doc, 'div', 'pf-dk-diff');
  const a = h(doc, 'div');
  a.append(h(doc, 'small', 'pf-dk-ts', 'Antes'), h(doc, 'del', undefined, before || '—'));
  const b = h(doc, 'div');
  b.append(h(doc, 'small', 'pf-dk-ts', 'Después'), h(doc, 'ins', undefined, after || '—'));
  d.append(a, b);
  return d;
}

/** Campo de texto del deck (`.lin`) para `textarea`/`input`: solo añade la clase. */
export function asLin<T extends HTMLElement>(el: T): T {
  el.classList.add(DK.lin);
  return el;
}
