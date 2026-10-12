// Modelo editable de un string de clases Tailwind para el panel de Diseño.
//
// El panel no edita el string: edita PROPIEDADES ('display', 'padding-top',
// 'text-color', …) dentro de un ESTADO (base, hover:, dark:, md:, …). Cada propiedad
// sabe qué tokens le pertenecen (`match`) y cómo escribirse (`write`). El string se
// regenera preservando el orden y todo lo que el panel no entiende ('Otras clases').
//
// Puramente cliente y sin dependencias: recibe el value del campo `class-name` que ya
// entrega el detector, devuelve el string nuevo que viaja en el mismo SavePayload.

export type TwToken = {
  raw: string;
  /** Prefijo de variantes tal cual, sin el último ':' — '' para base, 'hover', 'dark:hover', 'md'. */
  variant: string;
  /** Utilidad sin variantes ni '!' — 'px-3', 'bg-primary/50', '-mt-2'. */
  base: string;
  important: boolean;
};

export function parseTokens(value: string): TwToken[] {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((raw) => {
      // Un ':' dentro de [] (valores arbitrarios) no separa variantes.
      let depth = 0;
      let lastColon = -1;
      for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];
        if (ch === '[') depth++;
        else if (ch === ']') depth--;
        else if (ch === ':' && depth === 0) lastColon = i;
      }
      const variant = lastColon === -1 ? '' : raw.slice(0, lastColon);
      let base = lastColon === -1 ? raw : raw.slice(lastColon + 1);
      const important = base.startsWith('!');
      if (important) base = base.slice(1);
      return { raw, variant, base, important };
    });
}

export function serializeTokens(tokens: TwToken[]): string {
  return tokens.map((t) => t.raw).join(' ');
}

function makeToken(variant: string, base: string, important = false): TwToken {
  return { raw: `${variant ? `${variant}:` : ''}${important ? '!' : ''}${base}`, variant, base, important };
}

/** Estados disponibles: los que ya aparecen en el string + los habituales, base primero. */
export const DEFAULT_STATES = ['', 'hover', 'focus', 'active', 'disabled', 'dark', 'sm', 'md', 'lg'];
export function listStates(tokens: TwToken[]): string[] {
  const present = new Set(tokens.map((t) => t.variant));
  const out = [...DEFAULT_STATES];
  for (const v of present) if (!out.includes(v)) out.push(v);
  return out;
}
export function stateHasTokens(tokens: TwToken[], variant: string): boolean {
  return tokens.some((t) => t.variant === variant);
}
export function stateLabel(variant: string): string {
  return variant === '' ? 'base' : variant;
}

// ---------------------------------------------------------------------------
// Propiedades
// ---------------------------------------------------------------------------

/**
 * Una propiedad de diseño dentro de un estado. `match(base)` dice si un token base
 * le pertenece; `read(bases)` devuelve el valor lógico a partir de los tokens
 * matcheados; `write(value)` devuelve los tokens base que la representan (vacío =
 * quitar).
 */
export type TwProperty<V> = {
  match: (base: string) => boolean;
  read: (bases: string[]) => V;
  write: (value: V) => string[];
};

/** Lee una propiedad en un estado. */
export function readProp<V>(tokens: TwToken[], variant: string, prop: TwProperty<V>): V {
  return prop.read(tokens.filter((t) => t.variant === variant && prop.match(t.base)).map((t) => t.base));
}

/**
 * Escribe una propiedad en un estado: quita todos los tokens de esa propiedad en ese
 * estado e inserta los nuevos en la posición del primero que quitó (o al final).
 * Los tokens con `!` conservan el flag.
 */
export function writeProp<V>(tokens: TwToken[], variant: string, prop: TwProperty<V>, value: V): TwToken[] {
  const next: TwToken[] = [];
  let insertAt = -1;
  let important = false;
  for (const t of tokens) {
    if (t.variant === variant && prop.match(t.base)) {
      if (insertAt === -1) insertAt = next.length;
      important = important || t.important;
      continue;
    }
    next.push(t);
  }
  const fresh = prop.write(value).map((b) => makeToken(variant, b, important));
  if (insertAt === -1) return [...next, ...fresh];
  next.splice(insertAt, 0, ...fresh);
  return next;
}

/** Propiedad 'un token de un set': el valor es el sufijo/nombre, o null si no está. */
function oneOf(options: readonly string[]): TwProperty<string | null> {
  const set = new Set(options);
  return {
    match: (b) => set.has(b),
    read: (bases) => bases[bases.length - 1] ?? null,
    write: (v) => (v ? [v] : []),
  };
}

/** Propiedad 'prefijo-valor' (px-3, gap-2, rounded-md…): valor = lo que sigue al prefijo. */
function prefixed(prefix: string, opts: { negative?: boolean; exclude?: (rest: string) => boolean } = {}): TwProperty<string | null> {
  const re = new RegExp(`^${opts.negative ? '-?' : ''}${prefix.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}-(.+)$`);
  return {
    match: (b) => {
      const m = re.exec(b);
      if (!m) return false;
      return !(opts.exclude && opts.exclude(m[1] ?? ''));
    },
    read: (bases) => {
      const last = bases[bases.length - 1];
      if (!last) return null;
      const m = re.exec(last)!;
      return (last.startsWith('-') ? '-' : '') + m[1];
    },
    write: (v) => {
      if (v === null || v === '') return [];
      return v.startsWith('-') ? [`-${prefix}-${v.slice(1)}`] : [`${prefix}-${v}`];
    },
  };
}

// ---- Disposición -----------------------------------------------------------

export const DISPLAY_OPTIONS = ['block', 'inline-block', 'inline', 'flex', 'inline-flex', 'grid', 'inline-grid', 'hidden', 'contents', 'flow-root', 'table'] as const;
export const display = oneOf(DISPLAY_OPTIONS);
export const flexDirection = oneOf(['flex-row', 'flex-row-reverse', 'flex-col', 'flex-col-reverse']);
export const flexWrap = oneOf(['flex-wrap', 'flex-nowrap', 'flex-wrap-reverse']);
export const alignItems = oneOf(['items-start', 'items-center', 'items-end', 'items-stretch', 'items-baseline']);
export const justifyContent = oneOf(['justify-start', 'justify-center', 'justify-end', 'justify-between', 'justify-around', 'justify-evenly', 'justify-stretch']);
export const gap = prefixed('gap', { exclude: (r) => r.startsWith('x-') || r.startsWith('y-') });
export const gapX = prefixed('gap-x');
export const gapY = prefixed('gap-y');
export const gridCols = prefixed('grid-cols');

// ---- Espaciado -------------------------------------------------------------

export const SPACING_SCALE = ['0', 'px', '0.5', '1', '1.5', '2', '2.5', '3', '3.5', '4', '5', '6', '7', '8', '9', '10', '11', '12', '14', '16', '20', '24', '28', '32', '36', '40', '48', '56', '64'];
export const SPACING_PX: Record<string, number> = Object.fromEntries(
  SPACING_SCALE.map((s) => [s, s === 'px' ? 1 : Number(s) * 4])
);

export type Sides = { t: string | null; r: string | null; b: string | null; l: string | null };

/**
 * Padding o margen como 4 lados lógicos. Lee p/px/py/pt/pr/pb/pl (idem m-) con
 * precedencia 'el más específico gana'; escribe la forma más compacta que reproduce
 * exactamente esos 4 lados (p-4 · px-3 py-2 · pt-1 …). Un lado `null` = sin token.
 */
export function sidesProp(kind: 'p' | 'm'): TwProperty<Sides> {
  const re = new RegExp(`^-?${kind}([xytrbl]?)-(.+)$`);
  return {
    match: (b) => re.test(b) && !/^m(ax|in)-/.test(b),
    read: (bases) => {
      const s: Sides = { t: null, r: null, b: null, l: null };
      for (const base of bases) {
        const m = re.exec(base)!;
        const v = (base.startsWith('-') ? '-' : '') + m[2];
        const side = m[1];
        if (side === '') s.t = s.r = s.b = s.l = v;
        else if (side === 'x') s.l = s.r = v;
        else if (side === 'y') s.t = s.b = v;
        else if (side === 't') s.t = v;
        else if (side === 'r') s.r = v;
        else if (side === 'b') s.b = v;
        else if (side === 'l') s.l = v;
      }
      return s;
    },
    write: (s) => {
      const tok = (side: string, v: string) => (v.startsWith('-') ? `-${kind}${side}-${v.slice(1)}` : `${kind}${side}-${v}`);
      const out: string[] = [];
      const { t, r, b, l } = s;
      if (t !== null && t === r && t === b && t === l) return [tok('', t)];
      if (l !== null && l === r) out.push(tok('x', l));
      else {
        if (l !== null) out.push(tok('l', l));
        if (r !== null) out.push(tok('r', r));
      }
      if (t !== null && t === b) out.push(tok('y', t));
      else {
        if (t !== null) out.push(tok('t', t));
        if (b !== null) out.push(tok('b', b));
      }
      return out;
    },
  };
}
export const padding = sidesProp('p');
export const margin = sidesProp('m');

// ---- Tamaño ----------------------------------------------------------------

export const width = prefixed('w');
export const height = prefixed('h');
export const size = prefixed('size');
export const minWidth = prefixed('min-w');
export const maxWidth = prefixed('max-w');
export const minHeight = prefixed('min-h');
export const maxHeight = prefixed('max-h');

// ---- Tipografía ------------------------------------------------------------

export const TEXT_SIZES = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', '8xl', '9xl'] as const;
export const textSize = oneOf(TEXT_SIZES.map((s) => `text-${s}`));
export const FONT_WEIGHTS = ['font-thin', 'font-extralight', 'font-light', 'font-normal', 'font-medium', 'font-semibold', 'font-bold', 'font-extrabold', 'font-black'] as const;
export const fontWeight = oneOf(FONT_WEIGHTS);
export const textAlign = oneOf(['text-left', 'text-center', 'text-right', 'text-justify', 'text-start', 'text-end']);
export const textTransform = oneOf(['uppercase', 'lowercase', 'capitalize', 'normal-case']);
export const textDecoration = oneOf(['underline', 'line-through', 'no-underline', 'overline']);
export const fontStyle = oneOf(['italic', 'not-italic']);
export const tracking = prefixed('tracking');
export const leading = prefixed('leading');
export const fontFamily = oneOf(['font-sans', 'font-serif', 'font-mono']);
export const truncate = oneOf(['truncate', 'text-ellipsis', 'text-clip']);

// ---- Color -----------------------------------------------------------------

/** Tokens de color del tema (shadcn) + paleta (ver @theme inline en globals.css). */
export const COLOR_TOKENS = [
  'background', 'foreground', 'card', 'card-foreground', 'popover', 'popover-foreground',
  'primary', 'primary-foreground', 'secondary', 'secondary-foreground', 'muted', 'muted-foreground',
  'accent', 'accent-foreground', 'destructive', 'destructive-foreground', 'border', 'input', 'ring',
  'sidebar', 'sidebar-foreground', 'sidebar-primary', 'sidebar-accent', 'sidebar-border',
  'white', 'black', 'transparent', 'current', 'inherit',
];
const COLOR_TOKEN_SET = new Set(COLOR_TOKENS);
const PALETTE_RE = /^[a-z]+-(50|[1-9]00|950)$/;
const ARBITRARY_RE = /^\[.+\]$/;

export type ColorValue = { color: string; opacity: string | null } | null;

function isColorSuffix(suffix: string): boolean {
  const color = suffix.split('/')[0] ?? '';
  return COLOR_TOKEN_SET.has(color) || PALETTE_RE.test(color) || ARBITRARY_RE.test(color) || /^\(--.+\)$/.test(color);
}

/** Color de un prefijo (bg, text, border, ring, …) — distingue text-sm (tamaño) de text-primary (color). */
export function colorProp(prefix: string): TwProperty<ColorValue> {
  const re = new RegExp(`^${prefix}-(.+)$`);
  return {
    match: (b) => {
      const m = re.exec(b);
      return !!m && isColorSuffix(m[1] ?? '');
    },
    read: (bases) => {
      const last = bases[bases.length - 1];
      if (!last) return null;
      const suffix = re.exec(last)![1] ?? '';
      const [color = '', opacity] = suffix.split('/');
      return { color, opacity: opacity ?? null };
    },
    write: (v) => (v ? [`${prefix}-${v.color}${v.opacity ? `/${v.opacity}` : ''}`] : []),
  };
}
export const bgColor = colorProp('bg');
export const textColor = colorProp('text');
export const borderColor = colorProp('border');
export const ringColor = colorProp('ring');

// ---- Borde y radio ---------------------------------------------------------

export const borderWidth: TwProperty<string | null> = {
  match: (b) => b === 'border' || /^border-(0|2|4|8)$/.test(b),
  read: (bases) => {
    const last = bases[bases.length - 1];
    if (!last) return null;
    return last === 'border' ? '1' : last.slice('border-'.length);
  },
  write: (v) => (v === null ? [] : v === '1' ? ['border'] : [`border-${v}`]),
};
export const borderStyle = oneOf(['border-solid', 'border-dashed', 'border-dotted', 'border-double', 'border-none']);
export const rounded: TwProperty<string | null> = {
  match: (b) => b === 'rounded' || /^rounded-(none|sm|md|lg|xl|2xl|3xl|4xl|full|\[.+\])$/.test(b),
  read: (bases) => {
    const last = bases[bases.length - 1];
    if (!last) return null;
    return last === 'rounded' ? 'DEFAULT' : last.slice('rounded-'.length);
  },
  write: (v) => (v === null ? [] : v === 'DEFAULT' ? ['rounded'] : [`rounded-${v}`]),
};
export const ROUNDED_OPTIONS = ['none', 'sm', 'DEFAULT', 'md', 'lg', 'xl', '2xl', '3xl', 'full'];

// ---- Efectos ---------------------------------------------------------------

export const shadow: TwProperty<string | null> = {
  match: (b) => b === 'shadow' || /^shadow-(2xs|xs|sm|md|lg|xl|2xl|none|inner)$/.test(b),
  read: (bases) => {
    const last = bases[bases.length - 1];
    if (!last) return null;
    return last === 'shadow' ? 'DEFAULT' : last.slice('shadow-'.length);
  },
  write: (v) => (v === null ? [] : v === 'DEFAULT' ? ['shadow'] : [`shadow-${v}`]),
};
export const SHADOW_OPTIONS = ['none', '2xs', 'xs', 'sm', 'DEFAULT', 'md', 'lg', 'xl', '2xl'];
export const opacity = prefixed('opacity');
export const transition = oneOf(['transition', 'transition-all', 'transition-colors', 'transition-opacity', 'transition-shadow', 'transition-transform', 'transition-none']);
export const duration = prefixed('duration');
export const cursor = prefixed('cursor');

// ---- Posición --------------------------------------------------------------

export const position = oneOf(['static', 'relative', 'absolute', 'fixed', 'sticky']);
export const zIndex = prefixed('z', { negative: true });
export const overflow = oneOf(['overflow-auto', 'overflow-hidden', 'overflow-clip', 'overflow-visible', 'overflow-scroll']);

// ---------------------------------------------------------------------------
// Agrupación para el resumen de cada sección
// ---------------------------------------------------------------------------

export type SectionKey = 'layout' | 'spacing' | 'size' | 'typography' | 'color' | 'border' | 'effects' | 'position';

type Matcher = Pick<TwProperty<unknown>, 'match'>;
const SECTION_PROPS: Record<SectionKey, Matcher[]> = {
  layout: [display, flexDirection, flexWrap, alignItems, justifyContent, gap, gapX, gapY, gridCols],
  spacing: [padding, margin],
  size: [width, height, size, minWidth, maxWidth, minHeight, maxHeight],
  typography: [textSize, fontWeight, textAlign, textTransform, textDecoration, fontStyle, tracking, leading, fontFamily, truncate],
  color: [bgColor, textColor, borderColor, ringColor],
  border: [borderWidth, borderStyle, rounded],
  effects: [shadow, opacity, transition, duration, cursor],
  position: [position, zIndex, overflow],
};

/** Tokens de un estado que pertenecen a una sección — para el resumen en gris del encabezado. */
export function sectionTokens(tokens: TwToken[], variant: string, section: SectionKey): string[] {
  const props = SECTION_PROPS[section];
  return tokens.filter((t) => t.variant === variant && props.some((p) => p.match(t.base))).map((t) => t.base);
}

/** Tokens de un estado que NINGUNA sección reclama — 'Otras clases'. */
export function unclaimedTokens(tokens: TwToken[], variant: string): string[] {
  const all = Object.values(SECTION_PROPS).flat();
  return tokens.filter((t) => t.variant === variant && !all.some((p) => p.match(t.base))).map((t) => t.base);
}
