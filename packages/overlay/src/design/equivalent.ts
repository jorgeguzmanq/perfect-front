import * as tw from './tailwind-model';

/**
 * Clase Tailwind equivalente a un cambio CSS (dato INFORMATIVO de la propuesta de estilo: el overlay nunca
 * escribe className). Puro: recibe el `class` actual del elemento, la propiedad CSS y el valor elegido.
 */

const ALL_SECTIONS: tw.SectionKey[] = ['layout', 'spacing', 'size', 'typography', 'color', 'border', 'effects', 'position'];

/** El elemento «usa Tailwind» si alguna de sus clases base cae en una propiedad que el modelo conoce. */
export function usesTailwind(classAttr: string): boolean {
  const tokens = tw.parseTokens(classAttr);
  return ALL_SECTIONS.some((s) => tw.sectionTokens(tokens, '', s).length > 0);
}

const pxOf = (v: string): number | null => {
  const m = /^(-?\d*\.?\d+)px$/i.exec(v.trim());
  return m ? Number(m[1]) : null;
};

/** px -> clave de la escala de espaciado (`16px` -> `4`), o valor arbitrario `[13px]`. */
export function spacingKey(v: string): string | null {
  const t = v.trim();
  if (t === 'auto') return 'auto';
  if (t === '100%') return 'full';
  const n = pxOf(t);
  if (n === null) return t ? `[${t.replace(/\s+/g, '_')}]` : null;
  const neg = n < 0;
  const abs = Math.abs(n);
  const key = tw.SPACING_SCALE.find((k) => tw.SPACING_PX[k] === abs);
  const body = key ?? `[${abs}px]`;
  return neg ? `-${body}` : body;
}

const TEXT_PX: Record<number, string> = { 12: 'xs', 14: 'sm', 16: 'base', 18: 'lg', 20: 'xl', 24: '2xl', 30: '3xl', 36: '4xl', 48: '5xl', 60: '6xl' };
const WEIGHT: Record<string, string> = { '100': 'font-thin', '200': 'font-extralight', '300': 'font-light', '400': 'font-normal', '500': 'font-medium', '600': 'font-semibold', '700': 'font-bold', '800': 'font-extrabold', '900': 'font-black' };
const RADIUS_PX: Record<number, string> = { 0: 'none', 4: 'DEFAULT', 6: 'md', 8: 'lg', 12: 'xl', 16: '2xl', 24: '3xl', 9999: 'full' };

const enumOf = (prop: tw.TwProperty<string | null>, map: Record<string, string>) => ({ prop, map });

const ENUMS: Record<string, ReturnType<typeof enumOf>> = {
  display: enumOf(tw.display, { none: 'hidden', block: 'block', 'inline-block': 'inline-block', inline: 'inline', flex: 'flex', 'inline-flex': 'inline-flex', grid: 'grid', 'inline-grid': 'inline-grid', contents: 'contents', 'flow-root': 'flow-root', table: 'table' }),
  'flex-direction': enumOf(tw.flexDirection, { row: 'flex-row', 'row-reverse': 'flex-row-reverse', column: 'flex-col', 'column-reverse': 'flex-col-reverse' }),
  'flex-wrap': enumOf(tw.flexWrap, { wrap: 'flex-wrap', nowrap: 'flex-nowrap', 'wrap-reverse': 'flex-wrap-reverse' }),
  'align-items': enumOf(tw.alignItems, { 'flex-start': 'items-start', start: 'items-start', center: 'items-center', 'flex-end': 'items-end', end: 'items-end', stretch: 'items-stretch', baseline: 'items-baseline' }),
  'justify-content': enumOf(tw.justifyContent, { 'flex-start': 'justify-start', start: 'justify-start', center: 'justify-center', 'flex-end': 'justify-end', end: 'justify-end', 'space-between': 'justify-between', 'space-around': 'justify-around', 'space-evenly': 'justify-evenly' }),
  'text-align': enumOf(tw.textAlign, { left: 'text-left', center: 'text-center', right: 'text-right', justify: 'text-justify', start: 'text-start', end: 'text-end' }),
  'text-transform': enumOf(tw.textTransform, { none: 'normal-case', uppercase: 'uppercase', lowercase: 'lowercase', capitalize: 'capitalize' }),
  'text-decoration-line': enumOf(tw.textDecoration, { none: 'no-underline', underline: 'underline', 'line-through': 'line-through', overline: 'overline' }),
  'font-style': enumOf(tw.fontStyle, { normal: 'not-italic', italic: 'italic' }),
  position: enumOf(tw.position, { static: 'static', relative: 'relative', absolute: 'absolute', fixed: 'fixed', sticky: 'sticky' }),
  overflow: enumOf(tw.overflow, { auto: 'overflow-auto', hidden: 'overflow-hidden', clip: 'overflow-clip', visible: 'overflow-visible', scroll: 'overflow-scroll' }),
  'border-style': enumOf(tw.borderStyle, { solid: 'border-solid', dashed: 'border-dashed', dotted: 'border-dotted', double: 'border-double', none: 'border-none' }),
  'font-weight': enumOf(tw.fontWeight, WEIGHT),
};

const SCALED: Record<string, tw.TwProperty<string | null>> = {
  gap: tw.gap,
  'row-gap': tw.gapY,
  'column-gap': tw.gapX,
  width: tw.width,
  height: tw.height,
  'min-width': tw.minWidth,
  'min-height': tw.minHeight,
  'max-width': tw.maxWidth,
  'max-height': tw.maxHeight,
};

const COLORS: Record<string, tw.TwProperty<tw.ColorValue>> = {
  color: tw.textColor,
  'background-color': tw.bgColor,
  background: tw.bgColor,
  'border-color': tw.borderColor,
};

type Edit = (tokens: tw.TwToken[]) => tw.TwToken[];

/** Una edición del modelo para (propiedad CSS, valor), o null si el modelo no la representa. */
function editFor(cssProp: string, raw: string): Edit | null {
  const value = raw.trim();
  const e = ENUMS[cssProp];
  if (e) {
    const v = e.map[cssProp === 'font-weight' ? String(Math.round(Number(value) / 100) * 100) : value];
    return v ? (t) => tw.writeProp(t, '', e.prop, v) : null;
  }
  const sd = /^(padding|margin)-(top|right|bottom|left)$/.exec(cssProp);
  if (sd) {
    const prop = sd[1] === 'padding' ? tw.padding : tw.margin;
    const side = ({ top: 't', right: 'r', bottom: 'b', left: 'l' } as const)[sd[2] as 'top'];
    const key = spacingKey(value);
    return key === null ? null : (t) => tw.writeProp(t, '', prop, { ...tw.readProp(t, '', prop), [side]: key });
  }
  const sc = SCALED[cssProp];
  if (sc) {
    const key = spacingKey(value);
    return key === null ? null : (t) => tw.writeProp(t, '', sc, key);
  }
  const col = COLORS[cssProp];
  if (col) return (t) => tw.writeProp(t, '', col, { color: `[${value.replace(/\s+/g, '_')}]`, opacity: null });
  switch (cssProp) {
    case 'font-size': {
      const n = pxOf(value);
      const k = n === null ? undefined : TEXT_PX[n];
      return n === null ? null : (t) => tw.writeProp(t, '', tw.textSize, k ? `text-${k}` : `text-[${n}px]`);
    }
    case 'border-radius': {
      const n = pxOf(value);
      if (n === null) return null;
      const k = RADIUS_PX[n];
      return (t) => tw.writeProp(t, '', tw.rounded, k ?? `[${n}px]`);
    }
    case 'border-width': {
      const n = pxOf(value);
      return n === null ? null : (t) => tw.writeProp(t, '', tw.borderWidth, [0, 1, 2, 4, 8].includes(n) ? String(n) : null);
    }
    case 'opacity': {
      const n = Number(value);
      return Number.isFinite(n) ? (t) => tw.writeProp(t, '', tw.opacity, String(Math.round(n * 100))) : null;
    }
    case 'z-index':
      return /^-?\d+$/.test(value) ? (t) => tw.writeProp(t, '', tw.zIndex, value) : null;
    case 'box-shadow':
      return value === 'none' ? (t) => tw.writeProp(t, '', tw.shadow, 'none') : null;
    default:
      return null;
  }
}

/**
 * «clases antes → clases después» (solo las que cambian) para un cambio CSS sobre un elemento con Tailwind.
 * null si el modelo no sabe representarlo o no hay diferencia.
 */
export function tailwindEquivalent(classAttr: string, cssProp: string, cssValue: string): string | null {
  const edit = editFor(cssProp, cssValue);
  if (!edit) return null;
  const before = tw.parseTokens(classAttr);
  const after = edit(before);
  const had = new Set(before.map((t) => t.raw));
  const has = new Set(after.map((t) => t.raw));
  const removed = before.filter((t) => !has.has(t.raw)).map((t) => t.raw);
  const added = after.filter((t) => !had.has(t.raw)).map((t) => t.raw);
  if (!removed.length && !added.length) return null;
  return `${removed.join(' ') || '—'} → ${added.join(' ') || '—'}`.slice(0, 200);
}
