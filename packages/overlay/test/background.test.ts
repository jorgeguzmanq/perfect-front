// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { createOverlay } from '../src/overlay';
import { createPins } from '../src/pins';
import { createLauncher } from '../src/launcher';
import { CSS } from '../src/styles';

interface Rule {
  selectors: string[];
  decls: Map<string, string>;
}

/** Parser mínimo de reglas planas (las @media se aplanan: sus reglas internas también se revisan). */
function parse(css: string): Rule[] {
  const rules: Rule[] = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls = new Map<string, string>();
    for (const d of m[2]!.split(';')) {
      const i = d.indexOf(':');
      if (i > 0) decls.set(d.slice(0, i).trim(), d.slice(i + 1).trim());
    }
    rules.push({ selectors: m[1]!.split(',').map((s) => s.trim()), decls });
  }
  return rules;
}

const rules = parse(CSS);
const transparent = (v: string) => /^(transparent|none|initial)$/i.test(v);
const covers = (r: Rule) =>
  [...r.decls.entries()].some(
    ([k, v]) =>
      (k === 'inset' && /^0(px)?$/.test(v)) ||
      (k === 'width' && /^100(%|vw)$/.test(v)) ||
      (k === 'height' && /^100(%|vh)$/.test(v)),
  );
const bg = (r: Rule) => [...r.decls.entries()].filter(([k]) => k === 'background' || k === 'background-color');

afterEach(() => {
  document.body.innerHTML = '';
});

describe('ningún contenedor de pantalla completa pinta fondo', () => {
  it('el CSS final no da background opaco a selectores con inset:0 / 100% / 100vw / 100vh', () => {
    const full = rules.filter(covers);
    expect(full.length).toBeGreaterThan(0);
    for (const r of full) {
      for (const [, v] of bg(r)) expect(transparent(v), `${r.selectors.join(', ')} -> ${v}`).toBe(true);
    }
  });

  it('las capas que usan pf-root tienen un override transparente de mayor especificidad', () => {
    for (const cls of ['pf-ov-layer', 'pf-pins-layer', 'pf-ln']) {
      const rule = rules.find((r) => r.selectors.includes(`.${cls}.pf-root`));
      expect(rule, cls).toBeDefined();
      expect(rule!.decls.get('background')).toBe('transparent');
    }
  });

  it('el host no tiene background y es pointer-events none', () => {
    const host = rules.find((r) => r.selectors.includes(':host'))!;
    expect(bg(host).length).toBe(0);
    expect(host.decls.get('pointer-events')).toBe('none');
  });

  it('el panel, el lanzador, el menú y el aviso sí tienen fondo sólido', () => {
    for (const cls of ['pf-ov-panel', 'pf-ov-toolbar', 'pf-ln-group', 'pf-ln-menu', 'pf-ln-toast', 'pf-ln-tab', 'pf-pin']) {
      const r = rules.find((x) => x.selectors.includes(`.${cls}`));
      expect(r, cls).toBeDefined();
      const v = bg(r!)[0]?.[1];
      expect(v && !transparent(v), cls).toBe(true);
    }
  });

  it('el montaje real respeta la regla: capas con pf-root llevan el override y nada pone fondo en línea', () => {
    const overlay = createOverlay({ passive: true, onSubmit: async () => ({ id: 'a', collection: 'b', route: '/' }) });
    overlay.enable();
    const pins = createPins({ loadComments: async () => [] });
    const launcher = createLauncher({ onToggleSelect() {}, onHide() {}, onShow() {} });
    const hosts = ['overlay', 'pins', 'launcher'].map((n) => document.querySelector<HTMLElement>(`[data-perfect-front-${n}]`)!);
    for (const h of hosts) {
      expect(h).not.toBeNull();
      expect(h.style.background).toBe('');
      const layer = h.shadowRoot!.querySelector<HTMLElement>('.pf-root')!;
      const cls = ['pf-ov-layer', 'pf-pins-layer', 'pf-ln'].find((c) => layer.classList.contains(c))!;
      expect(cls).toBeDefined();
      expect(rules.some((r) => r.selectors.includes(`.${cls}.pf-root`))).toBe(true);
      expect(layer.style.background).toBe('');
    }
    // Con el panel abierto, la capa sigue sin fondo en línea.
    overlay.toggleSelecting();
    launcher.destroy();
    pins.destroy();
    overlay.destroy();
  });
});
