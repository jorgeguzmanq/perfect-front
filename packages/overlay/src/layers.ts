import { isPfNode } from './constants';
import { ancestorsOf, parentOf, siblingsOf } from './dom-nav';
import { chip, DK, led } from './deck';
import { describe, h } from './dom';
import type { EditorCtx } from './editor-ctx';
import { icon } from './icons';
import { reactComponents } from './react';

/**
 * Vista «Capas»: el árbol del DOM alrededor del nodo enfocado (ancestros, hermanos e hijos). Solo lee el DOM
 * del sitio; los nodos propios (isPfNode) quedan fuera. El resaltado al pasar el cursor lo dibuja el overlay.
 */

export type LayerKind = 'ancestor' | 'sibling' | 'focus' | 'child';
export interface LayerRow {
  el: Element;
  /** Profundidad 1-based (aria-level). */
  level: number;
  kind: LayerKind;
}
export interface LayerMore {
  more: number;
  level: number;
  where: 'before' | 'after';
}
export interface LayerModel {
  rows: Array<LayerRow | LayerMore>;
}

export const MAX_LIST = 40;

const visibleKids = (el: Element): Element[] => Array.from(el.children).filter((c) => !isPfNode(c));

/** Ventana de a lo sumo `max` elementos que contiene `idx`. */
function windowed<T>(list: readonly T[], idx: number, max: number): { items: T[]; before: number; after: number } {
  if (list.length <= max) return { items: [...list], before: 0, after: 0 };
  const start = Math.max(0, Math.min(idx - Math.floor(max / 2), list.length - max));
  return { items: list.slice(start, start + max), before: start, after: list.length - start - max };
}

/** Modelo puro del árbol: ancestros (sin html), hermanos del foco (con él) y los hijos del foco justo tras él. */
export function buildLayerModel(focus: Element): LayerModel {
  const rows: LayerModel['rows'] = [];
  const chain = ancestorsOf(focus).slice(0, -1);
  chain.forEach((el, i) => rows.push({ el, level: i + 1, kind: 'ancestor' }));
  const level = chain.length + 1;
  const sibs = parentOf(focus) ? siblingsOf(focus) : [focus];
  const at = Math.max(0, sibs.indexOf(focus));
  const w = windowed(sibs, at, MAX_LIST);
  if (w.before) rows.push({ more: w.before, level, where: 'before' });
  for (const s of w.items) {
    rows.push({ el: s, level, kind: s === focus ? 'focus' : 'sibling' });
    if (s === focus) {
      const kids = visibleKids(focus);
      kids.slice(0, MAX_LIST).forEach((k) => rows.push({ el: k, level: level + 1, kind: 'child' }));
      if (kids.length > MAX_LIST) rows.push({ more: kids.length - MAX_LIST, level: level + 1, where: 'after' });
    }
  }
  if (w.after) rows.push({ more: w.after, level, where: 'after' });
  return { rows };
}

/** Nombre del componente React solo cuando el nodo es la raíz DOM de ese componente (evita repetirlo en cada descendiente). */
export function componentRootName(el: Element): string | null {
  const own = reactComponents(el)?.[0];
  if (!own) return null;
  const parent = el.parentElement;
  const up = parent ? reactComponents(parent)?.[0] : null;
  return own !== up ? own : null;
}

const OPEN = new Set(['pending', 'in_progress']);

/** Comentarios abiertos de esta ruta por elemento (resuelve cada selector una sola vez). */
export function commentCounts(ctx: EditorCtx): Map<Element, number> {
  const map = new Map<Element, number>();
  const route = ctx.doc.location.pathname || '/';
  for (const c of ctx.groupsPort?.comments() ?? []) {
    if (!OPEN.has(c.status) || c.scope !== 'element' || !c.location.selector || c.location.frame) continue;
    if (c.location.route.split('?')[0] !== route) continue;
    try {
      const el = ctx.doc.querySelector(c.location.selector);
      if (el && !isPfNode(el)) map.set(el, (map.get(el) ?? 0) + 1);
    } catch {
      /* selector inválido */
    }
  }
  return map;
}

export function renderLayers(ctx: EditorCtx, box: HTMLElement): void {
  const doc = ctx.doc;
  const focus = ctx.sel.focus?.el;
  if (!focus) {
    box.appendChild(h(doc, 'p', 'pf-ov-hint', 'Elige un elemento para ver sus capas.'));
    return;
  }
  const counts = commentCounts(ctx);
  const model = buildLayerModel(focus);

  const intro = h(doc, 'p', 'pf-ov-hint pf-dk-ts', 'Clic enfoca el nodo; Shift o Ctrl+clic lo suma a la selección. Flechas para moverte, Enter para elegir.');
  const tree = h(doc, 'div', `pf-ly ${DK.lcd} ${DK.lp}`);
  tree.setAttribute('role', 'tree');
  tree.setAttribute('aria-label', 'Capas del DOM');
  tree.setAttribute('aria-multiselectable', 'true');

  const items: HTMLElement[] = [];
  const target = new Map<HTMLElement, Element>();
  const kidCount = (el: Element) => visibleKids(el).length;

  const parentRow = [...model.rows].reverse().find((x): x is LayerRow => 'el' in x && x.kind === 'ancestor');
  for (const r of model.rows) {
    if ('more' in r) {
      const m = h(doc, 'div', 'pf-ly-more pf-dk-ts', `… ${r.more} más`);
      m.setAttribute('role', 'none');
      m.style.setProperty('--pf-ly-level', String(r.level));
      tree.appendChild(m);
      continue;
    }
    const row = h(doc, 'div', `pf-ly-row pf-ly-row--${r.kind} pf-dk-lrow`);
    const hasKids = kidCount(r.el) > 0;
    row.setAttribute('role', 'treeitem');
    row.setAttribute('aria-level', String(r.level));
    row.setAttribute('aria-selected', String(ctx.sel.has(r.el)));
    if (r.kind === 'ancestor' || r.kind === 'focus') row.setAttribute('aria-expanded', 'true');
    else if (hasKids) row.setAttribute('aria-expanded', 'false');
    row.tabIndex = r.kind === 'focus' ? 0 : -1;
    row.style.setProperty('--pf-ly-level', String(r.level));
    row.appendChild(led(doc, r.kind === 'focus' || ctx.sel.has(r.el), 'violet'));
    const comp = componentRootName(r.el);
    if (comp) row.appendChild(h(doc, 'span', 'pf-ly-comp', comp));
    row.appendChild(h(doc, 'span', `pf-ly-label ${r.kind === 'focus' ? 'pf-dk-tg' : 'pf-dk-ts'}`, describe(r.el)));
    if (r === parentRow) row.appendChild(chip(doc, 'padre', { on: true }));
    if (r.kind === 'focus') row.appendChild(chip(doc, 'foco', { on: true }));
    const n = counts.get(r.el) ?? 0;
    const cmt = n ? `${n} comentario${n > 1 ? 's' : ''} abierto${n > 1 ? 's' : ''}` : '';
    if (n) {
      const b = h(doc, 'span', 'pf-ly-cmt', String(n));
      b.title = cmt;
      row.appendChild(b);
    }
    row.setAttribute('aria-label', [comp, describe(r.el), cmt].filter(Boolean).join(', '));
    const eye = h(doc, 'button', 'pf-ly-eye');
    eye.type = 'button';
    eye.tabIndex = -1;
    eye.setAttribute('aria-label', 'Elegir capa');
    eye.appendChild(icon(doc, 'eye', 12));
    row.appendChild(eye);
    target.set(row, r.el);
    items.push(row);
    tree.appendChild(row);
  }

  const choose = (row: HTMLElement, additive: boolean) => {
    const el = target.get(row);
    if (!el) return;
    if (additive) ctx.pick(el, true);
    else ctx.retarget(el);
    // El panel se redibuja: el foco del teclado vuelve al nodo enfocado.
    box.querySelector<HTMLElement>('[role="treeitem"][tabindex="0"]')?.focus();
  };

  for (const row of items) {
    ctx.on(row, 'click', (e) => {
      const m = e as MouseEvent;
      choose(row, m.shiftKey || m.ctrlKey || m.metaKey);
    });
    ctx.on(row, 'mouseenter', () => ctx.hover(target.get(row) ?? null));
    ctx.on(row, 'focus', () => ctx.hover(target.get(row) ?? null));
  }
  ctx.on(tree, 'mouseleave', () => ctx.hover(null));
  ctx.on(tree, 'focusout', (e) => {
    const next = (e as FocusEvent).relatedTarget as Node | null;
    if (!next || !tree.contains(next)) ctx.hover(null);
  });
  ctx.on(tree, 'keydown', (e) => {
    const k = e as KeyboardEvent;
    const cur = (k.target as HTMLElement).closest?.('[role="treeitem"]') as HTMLElement | null;
    if (!cur) return;
    const i = items.indexOf(cur);
    const go = (j: number) => {
      const t = items[Math.max(0, Math.min(items.length - 1, j))];
      if (!t) return;
      for (const x of items) x.tabIndex = x === t ? 0 : -1;
      t.focus();
    };
    const levelOf = (row: HTMLElement | undefined) => Number(row?.getAttribute('aria-level') ?? 0);
    switch (k.key) {
      case 'ArrowDown':
        go(i + 1);
        break;
      case 'ArrowUp':
        go(i - 1);
        break;
      case 'Home':
        go(0);
        break;
      case 'End':
        go(items.length - 1);
        break;
      case 'ArrowLeft': {
        // Al nodo padre: la fila anterior de menor nivel.
        const up = items.slice(0, i).reverse().findIndex((x) => levelOf(x) < levelOf(cur));
        if (up >= 0) go(i - 1 - up);
        break;
      }
      case 'ArrowRight':
        if (levelOf(items[i + 1]) > levelOf(cur)) go(i + 1);
        break;
      case 'Enter':
      case ' ':
        choose(cur, k.shiftKey || k.ctrlKey || k.metaKey);
        break;
      default:
        return;
    }
    k.preventDefault();
    k.stopPropagation();
  });

  box.append(intro, tree);
}
