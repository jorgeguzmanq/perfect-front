import { colorDark, colorLight, shadowDark, shadowLight } from '@perfect-front/design-tokens';

/** Colores del tema de Perfect Front que ofrece el panel Visual (sustituyen los swatches del tema de content-oep). */
export interface ThemeSwatch {
  /** Variable CSS del token (`--pf-color-accent`): viaja como `token` de la propuesta. */
  token: string | null;
  name: string;
  value: string;
}

const KEYS = ['bg', 'surface', 'surface-raised', 'border', 'text', 'text-muted', 'accent', 'accent-hover', 'accent-fg', 'danger'] as const;

export function themeSwatches(dark: boolean): ThemeSwatch[] {
  const c: Readonly<Record<string, string>> = dark ? colorDark : colorLight;
  const out: ThemeSwatch[] = KEYS.flatMap((k) => (c[k] ? [{ token: `--pf-color-${k}`, name: k, value: c[k]! }] : []));
  out.push({ token: null, name: 'white', value: '#ffffff' }, { token: null, name: 'black', value: '#000000' }, { token: null, name: 'transparent', value: 'transparent' });
  return out;
}

export interface ShadowPreset {
  name: string;
  value: string;
  token: string | null;
}

export function shadowPresets(dark: boolean): ShadowPreset[] {
  const s: Readonly<Record<string, string>> = dark ? shadowDark : shadowLight;
  return [{ name: 'none', value: 'none', token: null }, ...Object.entries(s).map(([k, v]) => ({ name: k, value: v, token: `--pf-shadow-${k}` }))];
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** `#rgb`/`#rrggbb` -> `rgb(r, g, b)` (forma del valor calculado); el resto se devuelve igual. */
export function normColor(v: string): string {
  const t = v.trim().toLowerCase();
  const m = HEX.exec(t);
  if (!m) return t.replace(/^rgba\((\d+),\s*(\d+),\s*(\d+),\s*1\)$/, 'rgb($1, $2, $3)');
  let x = m[1]!;
  if (x.length === 3) x = [...x].map((c) => c + c).join('');
  return `rgb(${parseInt(x.slice(0, 2), 16)}, ${parseInt(x.slice(2, 4), 16)}, ${parseInt(x.slice(4, 6), 16)})`;
}

/** `rgb(r, g, b)` / `#rgb` -> `#rrggbb` (para `<input type=color>`); null si no es un color opaco. */
export function toHex(v: string): string | null {
  const t = v.trim().toLowerCase();
  const m = HEX.exec(t);
  if (m) {
    const x = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join('') : m[1]!;
    return `#${x}`;
  }
  const r = /^rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\)$/.exec(t);
  if (!r || (r[4] !== undefined && Number(r[4]) === 0)) return null;
  return `#${[r[1], r[2], r[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
}
