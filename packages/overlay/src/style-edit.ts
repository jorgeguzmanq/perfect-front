import { LIMITS, type CommentProposal, type LocationSource, type StyleChange } from '@perfect-front/shared';
import { isPfNode } from './constants';
import { localId } from './dom';

/**
 * Pestaña Estilos. «Editable» = valor declarado en el código del proyecto (módulos CSS, Tailwind, inline…).
 * «Foundation» = tokens de :root, reset/preflight, librerías (node_modules) y valores heredados: solo lectura
 * (se puede «Comentar» una referencia, no cambiar). La vista previa es inline y reversible; el código del
 * proyecto no se toca (SPEC: nada fuera de .perfect-front/).
 */

type StyleProposal = Extract<CommentProposal, { kind: 'style' }>;

export type RowKind = 'num' | 'color' | 'select';

interface PropDef {
  prop: string;
  /** Longhand para leer el valor calculado (si `prop` es shorthand). */
  read?: string;
  kind: RowKind;
  group: string;
  options?: string[];
}

const PROPS: PropDef[] = [
  { prop: 'font-size', kind: 'num', group: 'Tipografía' },
  { prop: 'font-weight', kind: 'select', group: 'Tipografía', options: ['300', '400', '500', '600', '700', '800'] },
  { prop: 'line-height', kind: 'num', group: 'Tipografía' },
  { prop: 'padding-inline', read: 'padding-inline-start', kind: 'num', group: 'Espaciado' },
  { prop: 'padding-block', read: 'padding-block-start', kind: 'num', group: 'Espaciado' },
  { prop: 'gap', read: 'row-gap', kind: 'num', group: 'Espaciado' },
  { prop: 'background', read: 'background-color', kind: 'color', group: 'Color y forma' },
  { prop: 'color', kind: 'color', group: 'Color y forma' },
  { prop: 'border-radius', read: 'border-top-left-radius', kind: 'num', group: 'Color y forma' },
];

export interface StyleRow {
  property: string;
  kind: RowKind;
  group: string;
  options?: string[];
  /** Valor actual (calculado, con unidad). */
  value: string;
  origin: 'editable' | 'foundation';
  source: LocationSource | null;
  /** Etiqueta del origen para mostrar («PricingCard.module.css»). */
  sourceLabel: string | null;
  token: string | null;
}

export interface FoundationRow {
  property: string;
  value: string;
  sourceLabel: string;
  swatch: string | null;
}

export interface StyleInspection {
  groups: Array<{ name: string; rows: StyleRow[] }>;
  foundations: FoundationRow[];
}

const RESET_SELECTOR = /^(\*|html|body|:root|\*,|::?before|::?after|:where\(\*)/i;

interface Found {
  value: string;
  selector: string;
  href: string | null;
  inline: boolean;
}

/** Última regla de autor que declara `prop` para `el` (aproxima la cascada; ignora especificidad). */
function findDeclaration(el: Element, prop: string): Found | null {
  let found: Found | null = null;
  const inl = (el as HTMLElement).style?.getPropertyValue(prop);
  const doc = el.ownerDocument;
  const visit = (rules: CSSRuleList, href: string | null) => {
    for (const r of Array.from(rules)) {
      const rr = r as CSSStyleRule & { cssRules?: CSSRuleList };
      if (rr.style && typeof rr.selectorText === 'string') {
        const v = rr.style.getPropertyValue(prop);
        if (!v) continue;
        try {
          if (el.matches(rr.selectorText)) found = { value: v.trim(), selector: rr.selectorText.trim(), href, inline: false };
        } catch {
          /* selector no evaluable */
        }
      } else if (rr.cssRules) visit(rr.cssRules, href);
    }
  };
  for (const sheet of Array.from(doc.styleSheets)) {
    try {
      visit(sheet.cssRules, sheet.href);
    } catch {
      /* hoja de otro origen: sin acceso a sus reglas */
    }
  }
  if (inl) return { value: inl.trim(), selector: '', href: null, inline: true };
  return found;
}

const tokenOf = (decl: string): string | null => /var\(\s*(--[A-Za-z0-9_-]+)/.exec(decl)?.[1] ?? null;

function fileOf(href: string | null): string | null {
  if (!href) return null;
  try {
    return new URL(href).pathname.replace(/^\//, '').slice(0, 500) || null;
  } catch {
    return href.slice(0, 500);
  }
}

const isFoundationSheet = (f: Found): boolean =>
  !f.inline && (RESET_SELECTOR.test(f.selector) || /node_modules|\/@fs\/|\/@vite\/|normalize|reset|preflight/i.test(f.href ?? ''));

export function inspectStyles(el: Element): StyleInspection {
  const win = el.ownerDocument.defaultView;
  const cs = win ? win.getComputedStyle(el) : null;
  const groups = new Map<string, StyleRow[]>();
  const foundations: FoundationRow[] = [];
  const seenFnd = new Set<string>();
  const addFnd = (f: FoundationRow) => {
    if (!seenFnd.has(f.property)) {
      seenFnd.add(f.property);
      foundations.push(f);
    }
  };
  const isColor = (v: string) => /^(#|rgb|hsl|color\()/i.test(v);

  for (const def of PROPS) {
    const computed = cs?.getPropertyValue(def.read ?? def.prop).trim() ?? '';
    if (!computed) continue;
    const decl = findDeclaration(el, def.prop) ?? (def.read ? findDeclaration(el, def.read) : null);
    const token = decl ? tokenOf(decl.value) : null;
    if (decl && isFoundationSheet(decl)) {
      addFnd({
        property: def.prop,
        value: computed,
        sourceLabel: decl.href ? (fileOf(decl.href) ?? 'reset') : `reset · ${decl.selector}`,
        swatch: def.kind === 'color' && isColor(computed) ? computed : null,
      });
      continue;
    }
    const file = decl && !decl.inline ? fileOf(decl.href) : null;
    const row: StyleRow = {
      property: def.prop,
      kind: def.kind,
      group: def.group,
      ...(def.options ? { options: def.options } : {}),
      value: computed,
      origin: 'editable',
      source: file ? { file, line: null } : null,
      sourceLabel: decl?.inline ? 'estilo en línea' : file ? (file.split('/').pop() ?? file) : null,
      token,
    };
    const list = groups.get(def.group) ?? [];
    list.push(row);
    groups.set(def.group, list);
    if (token && cs) {
      const tv = cs.getPropertyValue(token).trim();
      if (tv) addFnd({ property: token, value: tv, sourceLabel: 'token de diseño', swatch: isColor(tv) ? tv : null });
    }
  }
  if (cs) {
    const ff = cs.getPropertyValue('font-family').trim();
    if (ff) addFnd({ property: 'font-family', value: ff.slice(0, 120), sourceLabel: 'heredado', swatch: null });
    const bs = cs.getPropertyValue('box-sizing').trim();
    if (bs) addFnd({ property: 'box-sizing', value: bs, sourceLabel: 'reset / navegador', swatch: null });
  }
  return { groups: Array.from(groups, ([name, rows]) => ({ name, rows })), foundations };
}

/** Texto para insertar en el comentario al pulsar «Comentar» en una fila Foundation. */
export const foundationReference = (f: FoundationRow): string => `${f.property}: ${f.value} (${f.sourceLabel})`;

/** Parte numérica y unidad de un valor CSS («14px» -> 14, «px»). */
export function splitUnit(v: string): { n: string; unit: string } {
  const m = /^(-?\d*\.?\d+)\s*([a-z%]*)$/i.exec(v.trim());
  return m ? { n: m[1]!, unit: m[2] ?? '' } : { n: v, unit: '' };
}

interface Applied {
  el: HTMLElement;
  prop: string;
  prevValue: string;
  prevPriority: string;
}

export interface StyleChangeEntry {
  before: string;
  after: string;
  /** Clase Tailwind equivalente (solo informativa; modo Visual). */
  tailwind?: string | null;
  /** Token de diseño elegido en el modo Visual (sobrescribe el de la fila). */
  token?: string | null;
}

/** Datos extra de un cambio hecho desde el modo Visual. */
export interface StyleSetExtra {
  tailwind?: string | null;
  token?: string | null;
}

export class StyleEditor {
  private changesMap = new Map<string, StyleChangeEntry>();
  private applied: Applied[] = [];
  appliesTo: 'focus' | 'all' = 'focus';

  constructor(
    private rows: StyleRow[],
    /** Elementos sobre los que se previsualiza: `[foco]` o todos según `appliesTo`. */
    private readonly targets: () => { focus: Element | null; all: Element[] },
  ) {}

  get changes(): ReadonlyMap<string, StyleChangeEntry> {
    return this.changesMap;
  }
  get count(): number {
    return this.changesMap.size;
  }

  setRows(rows: StyleRow[]): void {
    this.rows = rows;
  }

  /** Registra una propiedad editable que la lista no trae (modo Visual: `before` = valor calculado). */
  addRow(row: StyleRow): void {
    if (!this.rows.some((r) => r.property === row.property)) this.rows.push(row);
  }

  hasRow(property: string): boolean {
    return this.rows.some((r) => r.property === property);
  }

  private els(): HTMLElement[] {
    const t = this.targets();
    const list = this.appliesTo === 'all' ? t.all : t.focus ? [t.focus] : [];
    return list.filter((e): e is HTMLElement => !!(e as HTMLElement).style && !isPfNode(e));
  }

  private paint(prop: string, value: string | null): void {
    for (const el of this.els()) {
      if (!this.applied.some((a) => a.el === el && a.prop === prop)) {
        this.applied.push({
          el,
          prop,
          prevValue: el.style.getPropertyValue(prop),
          prevPriority: el.style.getPropertyPriority(prop),
        });
      }
      if (value === null) el.style.removeProperty(prop);
      else el.style.setProperty(prop, value, 'important');
    }
  }

  /** Cambia una propiedad editable (vista previa inmediata). */
  set(property: string, after: string, extra?: StyleSetExtra): void {
    const row = this.rows.find((r) => r.property === property && r.origin === 'editable');
    if (!row) return;
    const v = after.trim().slice(0, LIMITS.styleValue);
    if (!v || v === row.value) {
      this.revert(property);
      return;
    }
    if (this.changesMap.size >= LIMITS.styleChanges && !this.changesMap.has(property)) return;
    this.changesMap.set(property, {
      before: row.value,
      after: v,
      ...(extra?.tailwind ? { tailwind: extra.tailwind } : {}),
      ...(extra?.token ? { token: extra.token } : {}),
    });
    this.paint(property, v);
  }

  revert(property: string): void {
    this.changesMap.delete(property);
    for (const a of this.applied.filter((x) => x.prop === property)) {
      if (a.prevValue) a.el.style.setProperty(a.prop, a.prevValue, a.prevPriority);
      else a.el.style.removeProperty(a.prop);
    }
    this.applied = this.applied.filter((x) => x.prop !== property);
  }

  revertAll(): void {
    for (const p of Array.from(this.changesMap.keys())) this.revert(p);
  }

  /** Cambiar «Aplicar a»: repinta con el nuevo alcance. */
  setAppliesTo(a: 'focus' | 'all'): void {
    if (a === this.appliesTo) return;
    const pending = Array.from(this.changesMap);
    for (const [p] of pending) {
      for (const x of this.applied.filter((y) => y.prop === p)) {
        if (x.prevValue) x.el.style.setProperty(x.prop, x.prevValue, x.prevPriority);
        else x.el.style.removeProperty(x.prop);
      }
    }
    this.applied = [];
    this.appliesTo = a;
    for (const [p, c] of pending) this.paint(p, c.after);
  }

  toProposal(targetSelector: string | null, taken?: ReadonlySet<string>): StyleProposal | null {
    if (!this.changesMap.size) return null;
    const changes: StyleChange[] = [];
    for (const [property, c] of this.changesMap) {
      const row = this.rows.find((r) => r.property === property);
      changes.push({
        property,
        before: c.before,
        after: c.after,
        origin: 'editable',
        ...(row?.source ? { source: row.source } : {}),
        ...(c.token ?? row?.token ? { token: (c.token ?? row?.token)! } : {}),
        ...(c.tailwind ? { tailwind: c.tailwind } : {}),
      });
    }
    return {
      id: localId('p', taken),
      kind: 'style',
      targetSelector,
      appliesTo: this.appliesTo,
      changes,
    };
  }
}
