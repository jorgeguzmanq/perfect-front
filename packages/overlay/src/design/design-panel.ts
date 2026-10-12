import { h } from '../dom';
import type { StyleEditor, StyleRow } from '../style-edit';
import { normColor, shadowPresets, themeSwatches, toHex } from './color';
import { tailwindEquivalent, usesTailwind } from './equivalent';
import { field, grid2, numberInput, pills, rect, section, segment, swatch, tip, type SegOption } from './panel-ui';
import { SPACING_PX } from './tailwind-model';

/**
 * Modo «Visual» de la pestaña Estilos: controles para elegir qué cambiar (disposición, espaciado, tamaño, tipografía,
 * color, borde, efectos, posición). NO escribe className ni toca el código: cada control produce un cambio
 * `before → after` en el StyleEditor (vista previa inline reversible + propuesta de estilo). El `before` es el valor
 * calculado; si el elemento usa Tailwind, la propuesta lleva además la clase equivalente (informativa).
 */

export interface DesignEnv {
  doc: Document;
  el: Element;
  ed: StyleEditor;
  disabled: boolean;
  /** Avisa de que cambió el recuento de cambios (pestañas e «Incluye»). */
  changed(): void;
}

type SectionKey = 'layout' | 'spacing' | 'size' | 'typography' | 'color' | 'border' | 'effects' | 'position';

interface UiState {
  open: Record<SectionKey, boolean>;
  colorTarget: 'background' | 'color' | 'border-color';
}

const uiStates = new WeakMap<StyleEditor, UiState>();
const uiOf = (ed: StyleEditor): UiState => {
  let s = uiStates.get(ed);
  if (!s) {
    s = { open: { layout: true, spacing: true, size: false, typography: true, color: true, border: false, effects: false, position: false }, colorTarget: 'color' };
    uiStates.set(ed, s);
  }
  return s;
};

const ICON = {
  layout: 'M4 4h6v16H4zM14 4h6v7h-6zM14 15h6v5h-6z',
  spacing: 'M3 3h18v18H3zM8 8h8v8H8z',
  size: 'M4 20V4h16M8 20h12V8M20 20L8 8',
  typography: 'M5 6h14M12 6v14M8 20h8',
  color: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 3v18',
  border: 'M4 20V10a6 6 0 016-6h10',
  effects: 'M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1',
  position: 'M3 3h18v18H3zM9 3v18M3 9h18',
};

const ic = (d: string): string => `svg:${d}`;
const bars = (a: string, b: string, c: string): string => ic(`${a}${b}${c}`);

const DISPLAY: SegOption[] = [
  { value: 'block', label: 'Bloque' },
  { value: 'flex', label: 'Flex' },
  { value: 'grid', label: 'Grid' },
  { value: 'none', label: ic('M2 2l20 20M6.2 6.2A10 10 0 002 12s4 7 10 7a9 9 0 004.8-1.4M9.9 4.2A10 10 0 0112 4c6 0 10 8 10 8a15 15 0 01-2.1 2.9'), title: 'none (ocultar)' },
];
const DIRECTION: SegOption[] = [
  { value: 'row', label: ic('M4 12h16M15 7l5 5-5 5'), title: 'row' },
  { value: 'column', label: ic('M12 4v16M7 15l5 5 5-5'), title: 'column' },
];
const ALIGN: SegOption[] = [
  { value: 'flex-start', label: bars('M4 5h16', rect(8, 8, 3, 10), rect(13, 8, 3, 6)), title: 'start' },
  { value: 'center', label: bars('M4 12h16', rect(8, 7, 3, 10), rect(13, 9, 3, 6)), title: 'center' },
  { value: 'flex-end', label: bars('M4 19h16', rect(8, 6, 3, 10), rect(13, 10, 3, 6)), title: 'end' },
  { value: 'stretch', label: bars('M4 5h16M4 19h16', rect(8, 8, 3, 8), rect(13, 8, 3, 8)), title: 'stretch' },
];
const JUSTIFY: SegOption[] = [
  { value: 'flex-start', label: bars('M5 4v16', rect(8, 9, 4, 6), rect(14, 9, 4, 6)), title: 'start' },
  { value: 'center', label: bars('M12 4v16', rect(5, 9, 4, 6), rect(15, 9, 4, 6)), title: 'center' },
  { value: 'flex-end', label: bars('M19 4v16', rect(6, 9, 4, 6), rect(12, 9, 4, 6)), title: 'end' },
  { value: 'space-between', label: bars('M4 4v16M20 4v16', rect(7, 9, 4, 6), rect(13, 9, 4, 6)), title: 'space-between' },
];
const TEXT_ALIGN: SegOption[] = [
  { value: 'left', label: ic('M4 6h16M4 12h10M4 18h14'), title: 'left' },
  { value: 'center', label: ic('M4 6h16M7 12h10M5 18h14'), title: 'center' },
  { value: 'right', label: ic('M4 6h16M10 12h10M6 18h14'), title: 'right' },
];
const FONT_SIZES: SegOption[] = [
  ['xs', 12], ['sm', 14], ['base', 16], ['lg', 18], ['xl', 20], ['2xl', 24], ['3xl', 30], ['4xl', 36],
].map(([l, px]) => ({ value: `${px}px`, label: String(l), title: `${px}px` }));
const WEIGHTS: SegOption[] = ['400', '500', '600', '700'].map((w) => ({ value: w, label: w }));
const TRANSFORM: SegOption[] = [
  { value: 'none', label: 'Aa' },
  { value: 'uppercase', label: 'AA' },
  { value: 'lowercase', label: 'aa' },
  { value: 'capitalize', label: 'Aa Bb' },
];
const DECORATION: SegOption[] = [
  { value: 'none', label: '—', title: 'none' },
  { value: 'underline', label: 'U', title: 'underline' },
  { value: 'line-through', label: 'S', title: 'line-through' },
];
const RADIUS: SegOption[] = [0, 2, 4, 6, 8, 12, 16, 9999].map((n) => ({ value: `${n}px`, label: n === 9999 ? 'full' : String(n), title: `${n}px` }));
const BORDER_W: SegOption[] = [0, 1, 2, 4].map((n) => ({ value: `${n}px`, label: String(n), title: `${n}px` }));
const BORDER_S: SegOption[] = [
  { value: 'solid', label: '—', title: 'solid' },
  { value: 'dashed', label: '- -', title: 'dashed' },
  { value: 'dotted', label: '···', title: 'dotted' },
];
const POSITION: SegOption[] = [
  { value: 'static', label: 'static' },
  { value: 'relative', label: 'rel', title: 'relative' },
  { value: 'absolute', label: 'abs', title: 'absolute' },
  { value: 'fixed', label: 'fixed' },
  { value: 'sticky', label: 'sticky' },
];
const OVERFLOW: SegOption[] = ['visible', 'hidden', 'auto'].map((v) => ({ value: v, label: v }));

/** Escala px de espaciado (de la escala Tailwind) para ↑/↓. */
const PX_SCALE: number[] = Array.from(new Set(Object.values(SPACING_PX))).sort((a, b) => a - b);

const pxNum = (v: string): string => {
  const n = parseFloat(v);
  return Number.isFinite(n) && /px$/i.test(v.trim()) ? String(Math.round(n * 100) / 100) : '';
};

/** Rellena `box` con el panel Visual para `env.el`. */
export function renderDesignPanel(env: DesignEnv, box: HTMLElement): void {
  const { doc, el, ed } = env;
  const win = el.ownerDocument.defaultView;
  const ui = uiOf(ed);
  const dark = !!win?.matchMedia?.('(prefers-color-scheme: dark)').matches;
  const classAttr = el.getAttribute('class') ?? '';
  const tailwind = usesTailwind(classAttr);
  const wrap = h(doc, 'div', 'pf-dz');
  box.appendChild(wrap);

  const computed = (prop: string): string => (win ? win.getComputedStyle(el).getPropertyValue(prop).trim() : '');
  /** Valor actual: el elegido, o el calculado (que con la vista previa activa ya lo refleja). */
  const cur = (prop: string, read = prop): string => ed.changes.get(prop)?.after ?? computed(read);

  function commit(prop: string, read: string, after: string, group: string, token: string | null = null): void {
    if (!ed.hasRow(prop)) {
      const row: StyleRow = { property: prop, kind: 'select', group, value: computed(read), origin: 'editable', source: null, sourceLabel: null, token: null };
      ed.addRow(row);
    }
    const tw = tailwind ? tailwindEquivalent(classAttr, prop, after) : null;
    ed.set(prop, after, { tailwind: tw, token });
  }
  const clear = (prop: string): void => ed.revert(prop);

  // Lo que cada sección toca (para el contador de la cabecera).
  const touched = new Map<SectionKey, Set<string>>();
  const mark = (s: SectionKey, p: string): void => {
    const set = touched.get(s) ?? new Set<string>();
    set.add(p);
    touched.set(s, set);
  };

  /** Redibuja conservando el foco (por `data-key`). */
  function draw(): void {
    const root = wrap.getRootNode() as Document | ShadowRoot;
    const key = (root.activeElement as HTMLElement | null)?.dataset?.key;
    wrap.textContent = '';
    build();
    env.changed();
    if (key) Array.from(wrap.querySelectorAll<HTMLElement>('[data-key]')).find((e) => e.dataset.key === key)?.focus();
  }

  const seg = (s: SectionKey, prop: string, label: string, options: SegOption[], opts: { read?: string; norm?: (v: string) => string } = {}): HTMLElement => {
    mark(s, prop);
    const read = opts.read ?? prop;
    const norm = opts.norm ?? ((v: string) => v);
    const now = norm(cur(prop, read));
    const active = options.find((o) => norm(o.value) === now)?.value ?? null;
    return segment(doc, {
      options, value: active, label, key: prop, disabled: env.disabled,
      onChange: (v) => {
        if (v === null) clear(prop);
        else commit(prop, read, v, s);
        draw();
      },
    });
  };

  const px = (s: SectionKey, prop: string, label: string, opts: { read?: string; unit?: string; scale?: readonly number[]; min?: number } = {}): HTMLElement => {
    mark(s, prop);
    const read = opts.read ?? prop;
    const apply = (v: string): void => {
      if (v === '' || !Number.isFinite(Number(v))) clear(prop);
      else commit(prop, read, `${v}px`, s);
    };
    return numberInput(doc, {
      value: pxNum(cur(prop, read)), unit: 'px', label, key: prop, disabled: env.disabled,
      ...(opts.scale ? { scale: opts.scale } : {}),
      min: opts.min ?? 0,
      onInput: (v) => {
        apply(v);
        env.changed();
      },
      onChange: (v) => {
        apply(v);
        draw();
      },
    });
  };

  const text = (s: SectionKey, prop: string, label: string, placeholder: string): HTMLElement => {
    mark(s, prop);
    const wrapI = h(doc, 'span', 'pf-dz-num pf-dz-num--text');
    const inp = h(doc, 'input');
    inp.type = 'text';
    inp.spellcheck = false;
    inp.placeholder = placeholder;
    inp.value = ed.changes.get(prop)?.after ?? '';
    inp.disabled = env.disabled;
    inp.dataset.key = prop;
    inp.setAttribute('aria-label', label);
    if (!inp.value) inp.placeholder = computed(prop) || placeholder;
    inp.addEventListener('change', () => {
      const v = inp.value.trim();
      if (!v) clear(prop);
      else commit(prop, prop, v, s);
      draw();
    });
    wrapI.appendChild(inp);
    return wrapI;
  };

  const sideBox = (kind: 'padding' | 'margin', s: SectionKey): HTMLElement => {
    const holder = h(doc, 'div', `pf-dz-sides pf-dz-sides--${kind}`);
    holder.appendChild(h(doc, 'span', 'pf-dz-sidelbl', kind === 'padding' ? 'Padding' : 'Margen'));
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      const w = px(s, `${kind}-${side}`, `${kind}-${side}`, { scale: PX_SCALE, min: kind === 'margin' ? -64 : 0 });
      w.classList.add(`pf-dz-side-${side}`);
      holder.appendChild(w);
    }
    return holder;
  };

  const colorBlock = (): HTMLElement => {
    const box2 = h(doc, 'div', 'pf-dz-colors');
    const targets = [
      { value: 'background', label: 'Fondo', read: 'background-color' },
      { value: 'color', label: 'Texto', read: 'color' },
      { value: 'border-color', label: 'Borde', read: 'border-top-color' },
    ] as const;
    box2.appendChild(pills(doc, targets.map((t) => ({ value: t.value, label: t.label })), ui.colorTarget, (v) => {
      ui.colorTarget = v as UiState['colorTarget'];
      draw();
    }, 'ctarget'));
    const t = targets.find((x) => x.value === ui.colorTarget) ?? targets[1];
    for (const x of targets) mark('color', x.value);
    const now = normColor(cur(t.value, t.read));
    const sw = h(doc, 'div', 'pf-dz-swatches');
    for (const c of themeSwatches(dark)) {
      sw.appendChild(swatch(doc, {
        value: c.value, title: c.token ? `${c.name} (${c.token})` : c.name, key: `sw:${c.name}`, disabled: env.disabled,
        active: normColor(c.value) === now,
        onPick: () => {
          commit(t.value, t.read, c.value, 'color', c.token);
          draw();
        },
      }));
    }
    box2.appendChild(field(doc, `Tokens del tema · ${t.label.toLowerCase()}`, sw));
    const row = h(doc, 'div', 'pf-dz-colorrow');
    const picker = h(doc, 'input');
    picker.type = 'color';
    picker.value = toHex(now) ?? '#000000';
    picker.disabled = env.disabled;
    picker.dataset.key = 'color-picker';
    picker.setAttribute('aria-label', `Elegir color de ${t.label.toLowerCase()}`);
    const txt = h(doc, 'input');
    txt.type = 'text';
    txt.spellcheck = false;
    txt.placeholder = 'otro: #ff6600 · rgb() · var(--x)';
    txt.value = ed.changes.get(t.value)?.after ?? '';
    txt.disabled = env.disabled;
    txt.dataset.key = 'color-text';
    txt.setAttribute('aria-label', `Color de ${t.label.toLowerCase()} (CSS)`);
    picker.addEventListener('input', () => {
      commit(t.value, t.read, picker.value, 'color');
      txt.value = picker.value;
      env.changed();
    });
    picker.addEventListener('change', draw);
    txt.addEventListener('change', () => {
      const v = txt.value.trim();
      if (!v) clear(t.value);
      else commit(t.value, t.read, v, 'color');
      draw();
    });
    row.append(picker, txt);
    box2.appendChild(row);
    box2.appendChild(tip(doc, 'Los colores del tema son los de Perfect Front; el valor aplicado viaja como «antes → después».'));
    return box2;
  };

  function build(): void {
    touched.clear();
    const secs: Array<[SectionKey, string, () => Node[]]> = [
      ['layout', 'Disposición', () => {
        const disp = cur('display');
        const isFlex = disp === 'flex' || disp === 'inline-flex';
        const isGrid = disp === 'grid' || disp === 'inline-grid';
        const out: Node[] = [field(doc, 'Mostrar como', seg('layout', 'display', 'Mostrar como', DISPLAY, { norm: (v) => (v === 'inline-flex' ? 'flex' : v === 'inline-grid' ? 'grid' : v) }))];
        if (isFlex || isGrid) {
          out.push(grid2(doc,
            isFlex ? field(doc, 'Dirección', seg('layout', 'flex-direction', 'Dirección', DIRECTION, { norm: (v) => (v === 'row-reverse' ? 'row' : v === 'column-reverse' ? 'column' : v) })) : field(doc, 'Columnas', text('layout', 'grid-template-columns', 'Columnas', 'repeat(3, 1fr)')),
            field(doc, 'Gap', px('layout', 'gap', 'Gap', { read: 'row-gap', scale: PX_SCALE })),
          ));
          out.push(grid2(doc,
            field(doc, 'Alinear (eje cruzado)', seg('layout', 'align-items', 'Alinear', ALIGN, { norm: (v) => (v === 'start' ? 'flex-start' : v === 'end' ? 'flex-end' : v) })),
            field(doc, 'Justificar (eje principal)', seg('layout', 'justify-content', 'Justificar', JUSTIFY, { norm: (v) => (v === 'start' ? 'flex-start' : v === 'end' ? 'flex-end' : v) })),
          ));
          if (isFlex) out.push(field(doc, 'Ajuste de línea', seg('layout', 'flex-wrap', 'Ajuste de línea', [{ value: 'nowrap', label: 'Una línea' }, { value: 'wrap', label: 'Envolver' }])));
        }
        return out;
      }],
      ['spacing', 'Espaciado', () => {
        const m = sideBox('margin', 'spacing');
        const inner = h(doc, 'div', 'pf-dz-inner');
        inner.append(sideBox('padding', 'spacing'), h(doc, 'div', 'pf-dz-core'));
        m.appendChild(inner);
        return [m, tip(doc, '↑/↓ recorren la escala (0 · 2 · 4 · 6 · 8 · … · 256 px); vacío quita el cambio.')];
      }],
      ['size', 'Tamaño', () => [
        grid2(doc, field(doc, 'Ancho', text('size', 'width', 'Ancho', 'auto · 320px · 50%')), field(doc, 'Alto', text('size', 'height', 'Alto', 'auto · 48px'))),
        grid2(doc, field(doc, 'Mín. ancho', text('size', 'min-width', 'Mín. ancho', '0')), field(doc, 'Máx. ancho', text('size', 'max-width', 'Máx. ancho', 'none · 640px'))),
      ]],
      ['typography', 'Tipografía', () => [
        field(doc, 'Tamaño', seg('typography', 'font-size', 'Tamaño de fuente', FONT_SIZES)),
        grid2(doc, field(doc, 'Peso', seg('typography', 'font-weight', 'Peso', WEIGHTS)), field(doc, 'Alinear', seg('typography', 'text-align', 'Alinear texto', TEXT_ALIGN, { norm: (v) => (v === 'start' ? 'left' : v === 'end' ? 'right' : v) }))),
        grid2(doc, field(doc, 'Transformar', seg('typography', 'text-transform', 'Transformar', TRANSFORM)), field(doc, 'Decoración', seg('typography', 'text-decoration-line', 'Decoración', DECORATION))),
        grid2(doc, field(doc, 'Interlineado', text('typography', 'line-height', 'Interlineado', '1.5 · 24px')), field(doc, 'Interletrado', text('typography', 'letter-spacing', 'Interletrado', '0.02em'))),
      ]],
      ['color', 'Color', () => [colorBlock()]],
      ['border', 'Borde y radio', () => [
        grid2(doc, field(doc, 'Grosor', seg('border', 'border-width', 'Grosor del borde', BORDER_W, { read: 'border-top-width' })), field(doc, 'Estilo', seg('border', 'border-style', 'Estilo del borde', BORDER_S, { read: 'border-top-style' }))),
        field(doc, 'Radio (px)', seg('border', 'border-radius', 'Radio', RADIUS, { read: 'border-top-left-radius' })),
      ]],
      ['effects', 'Efectos', () => {
        mark('effects', 'opacity');
        const op = cur('opacity') || '1';
        const range = h(doc, 'input', 'pf-dz-range');
        range.type = 'range';
        range.min = '0';
        range.max = '100';
        range.step = '5';
        range.value = String(Math.round(Number(op) * 100));
        range.disabled = env.disabled;
        range.dataset.key = 'opacity';
        range.setAttribute('aria-label', 'Opacidad');
        const lab = h(doc, 'span', 'pf-dz-lbl', `Opacidad ${range.value}%`);
        range.addEventListener('input', () => {
          lab.textContent = `Opacidad ${range.value}%`;
          if (range.value === '100' && !ed.changes.has('opacity')) return;
          if (range.value === '100') clear('opacity');
          else commit('opacity', 'opacity', String(Number(range.value) / 100), 'effects');
          env.changed();
        });
        range.addEventListener('change', draw);
        const shadows = shadowPresets(dark);
        mark('effects', 'box-shadow');
        const nowS = cur('box-shadow');
        const sh = segment(doc, {
          options: shadows.map((s) => ({ value: s.name, label: s.name, title: s.token ?? s.name })), key: 'box-shadow', label: 'Sombra', disabled: env.disabled,
          value: shadows.find((s) => s.value === nowS || (s.name === 'none' && nowS === 'none'))?.name ?? null,
          onChange: (v) => {
            const p = shadows.find((s) => s.name === v);
            if (!p) clear('box-shadow');
            else commit('box-shadow', 'box-shadow', p.value, 'effects', p.token);
            draw();
          },
        });
        const f = h(doc, 'div', 'pf-dz-field');
        f.append(lab, range);
        return [field(doc, 'Sombra', sh), f];
      }],
      ['position', 'Posición', () => [
        field(doc, 'Posición', seg('position', 'position', 'Posición', POSITION)),
        grid2(doc, field(doc, 'Z-index', text('position', 'z-index', 'Z-index', 'auto · 10')), field(doc, 'Desborde', seg('position', 'overflow', 'Desborde', OVERFLOW))),
      ]],
    ];
    for (const [key, title, mk] of secs) {
      const body = h(doc, 'div', 'pf-dz-body');
      // Los controles se construyen siempre (registran qué propiedades toca la sección para el contador).
      body.append(...mk());
      wrap.appendChild(section(doc, {
        title, key, icon: ICON[key], open: ui.open[key], changes: Array.from(touched.get(key) ?? []).filter((p) => ed.changes.has(p)).length,
        onToggle: () => {
          ui.open[key] = !ui.open[key];
          draw();
        },
      }, body));
    }
    wrap.appendChild(h(doc, 'p', 'pf-dz-note', tailwind
      ? 'Este elemento usa Tailwind: cada cambio viaja con la clase equivalente (informativa). El código no se toca.'
      : 'Cada cambio viaja como «propiedad: antes → después» (valor calculado). El código no se toca.'));
  }

  build();
}
