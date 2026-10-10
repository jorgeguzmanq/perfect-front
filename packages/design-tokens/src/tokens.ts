/**
 * Mismos valores que tokens.css, tipados. Sirve para:
 *  - leer valores en TS (p. ej. status -> clase),
 *  - obtener el CSS como string (`getTokensCss()`) e inyectarlo en un Shadow Root.
 * Si cambias un valor aquí, cámbialo también en tokens.css (y viceversa).
 */

export const colorLight = {
  bg: '#ffffff',
  surface: '#f6f7f9',
  'surface-raised': '#ffffff',
  border: '#d5d9e0',
  text: '#14161a',
  'text-muted': '#5b6270',
  accent: '#2f5bea',
  'accent-hover': '#2349c4',
  'accent-fg': '#ffffff',
  danger: '#c42b1c',
  focus: '#2f5bea',
  'overlay-backdrop': 'rgb(20 22 26 / 0.4)',
} as const;

export const colorDark = {
  bg: '#0f1115',
  surface: '#181b21',
  'surface-raised': '#1e222a',
  border: '#2c313a',
  text: '#e8eaee',
  'text-muted': '#a0a7b4',
  accent: '#7c9cff',
  'accent-hover': '#9bb3ff',
  'accent-fg': '#0b1020',
  danger: '#ff7b6e',
  focus: '#9bb3ff',
  'overlay-backdrop': 'rgb(0 0 0 / 0.6)',
} as const;

export const commentStatuses = ['pending', 'in_progress', 'resolved', 'ignored', 'archived'] as const;
export type CommentStatus = (typeof commentStatuses)[number];

type StatusPair = { readonly fg: string; readonly bg: string };

export const statusLight: Readonly<Record<CommentStatus, StatusPair>> = {
  pending: { fg: '#8a5300', bg: '#fff1d6' },
  in_progress: { fg: '#1d4ed8', bg: '#e0e9ff' },
  resolved: { fg: '#146c2e', bg: '#dcf5e3' },
  ignored: { fg: '#4b5563', bg: '#eceef2' },
  archived: { fg: '#5b4b8a', bg: '#ece8f7' },
};

export const statusDark: Readonly<Record<CommentStatus, StatusPair>> = {
  pending: { fg: '#ffc766', bg: '#3a2a08' },
  in_progress: { fg: '#9db8ff', bg: '#16264d' },
  resolved: { fg: '#7fdc9b', bg: '#10301b' },
  ignored: { fg: '#b4bac6', bg: '#262a31' },
  archived: { fg: '#c3b5f0', bg: '#2a2342' },
};

export const font = {
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  size: { xs: '0.75rem', sm: '0.8125rem', md: '0.875rem', lg: '1rem', xl: '1.25rem' },
  weight: { regular: '400', medium: '500', bold: '600' },
  lineHeight: { tight: '1.25', base: '1.5' },
} as const;

export const space = {
  1: '0.25rem',
  2: '0.5rem',
  3: '0.75rem',
  4: '1rem',
  5: '1.5rem',
  6: '2rem',
  7: '3rem',
} as const;

export const radius = { sm: '4px', md: '8px', lg: '12px', full: '9999px' } as const;

export const shadowLight = {
  sm: '0 1px 2px rgb(0 0 0 / 0.08)',
  md: '0 4px 12px rgb(0 0 0 / 0.12)',
  lg: '0 12px 32px rgb(0 0 0 / 0.18)',
} as const;

export const shadowDark = {
  sm: '0 1px 2px rgb(0 0 0 / 0.4)',
  md: '0 4px 12px rgb(0 0 0 / 0.5)',
  lg: '0 12px 32px rgb(0 0 0 / 0.6)',
} as const;

export const zIndex = { base: 0, dropdown: 100, modal: 1000, overlay: 2147483000 } as const;

export const motion = {
  duration: { fast: '120ms', base: '200ms', slow: '320ms' },
  ease: { standard: 'cubic-bezier(0.2, 0, 0, 1)' },
} as const;

export const focus = { ringWidth: '2px', ringOffset: '2px' } as const;
export const controlHeight = '2rem';

/** Clases del chip para un estado: 'pf-chip pf-chip--in_progress'. */
export const statusChipClass = (s: CommentStatus): string => `pf-chip pf-chip--${s}`;

const decl = (name: string, value: string | number): string => `  --pf-${name}: ${value};`;

function themeVars(
  c: Readonly<Record<string, string>>,
  st: Readonly<Record<CommentStatus, StatusPair>>,
  sh: Readonly<Record<string, string>>,
  scheme: 'light' | 'dark',
): string[] {
  const out = [`  color-scheme: ${scheme};`];
  for (const [k, v] of Object.entries(c)) out.push(decl(`color-${k}`, v));
  for (const s of commentStatuses) {
    const n = s.replace('_', '-');
    out.push(decl(`status-${n}-fg`, st[s].fg), decl(`status-${n}-bg`, st[s].bg));
  }
  for (const [k, v] of Object.entries(sh)) out.push(decl(`shadow-${k}`, v));
  return out;
}

/** CSS completo de variables (equivalente a tokens.css) para inyectar en un Shadow Root. */
export function getTokensCss(): string {
  const shared: string[] = [];
  const add = (prefix: string, o: Readonly<Record<string, string | number>>): void => {
    for (const [k, v] of Object.entries(o)) shared.push(decl(`${prefix}-${k}`, v));
  };
  add('font', { sans: font.sans, mono: font.mono });
  add('font-size', font.size);
  add('font-weight', font.weight);
  add('line-height', font.lineHeight);
  add('space', space);
  add('radius', radius);
  add('z', zIndex);
  add('duration', motion.duration);
  shared.push(decl('ease-standard', motion.ease.standard));
  shared.push(decl('focus-ring-width', focus.ringWidth), decl('focus-ring-offset', focus.ringOffset));
  shared.push(decl('focus-ring', 'var(--pf-focus-ring-width) solid var(--pf-color-focus)'));
  shared.push(decl('control-height', controlHeight));

  const light = themeVars(colorLight, statusLight, shadowLight, 'light');
  const dark = themeVars(colorDark, statusDark, shadowDark, 'dark');
  const block = (sel: string, lines: string[]): string => `${sel} {\n${lines.join('\n')}\n}`;

  return [
    block(':root,\n:host', [...light, ...shared]),
    `@media (prefers-color-scheme: dark) {\n${block(
      ':root:not([data-theme="light"]),\n:host(:not([data-theme="light"]))',
      dark,
    )}\n}`,
    block(':root[data-theme="dark"],\n:host([data-theme="dark"])', dark),
    '@media (prefers-reduced-motion: reduce) {\n  :root,\n  :host {\n    --pf-duration-fast: 0ms;\n    --pf-duration-base: 0ms;\n    --pf-duration-slow: 0ms;\n  }\n}',
  ].join('\n\n');
}
