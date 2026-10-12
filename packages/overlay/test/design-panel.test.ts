// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { CommentProposalSchema, proposalsToComment } from '@perfect-front/shared';
import { HOST_ATTR } from '../src/constants';
import { normColor, shadowPresets, themeSwatches, toHex } from '../src/design/color';
import { renderDesignPanel } from '../src/design/design-panel';
import { StyleEditor, type StyleRow } from '../src/style-edit';

const rowsOf = (): StyleRow[] => [];

beforeEach(() => {
  document.body.innerHTML = '<main><p id="t" class="flex p-4 text-sm" style="display:block;color:rgb(0, 0, 0)">Hola</p><p id="plain" class="card">x</p><div id="host"></div></main>';
});

const mkEditor = (el: Element, all: Element[] = [el]) => new StyleEditor(rowsOf(), () => ({ focus: el, all }));

function visual(el: HTMLElement) {
  const ed = mkEditor(el);
  const box = document.createElement('div');
  document.body.appendChild(box);
  let changes = 0;
  renderDesignPanel({ doc: document, el, ed, disabled: false, changed: () => changes++ }, box);
  return { ed, box, changes: () => changes };
}

const btn = (box: HTMLElement, key: string) => box.querySelector<HTMLButtonElement>(`[data-key="${key}"]`)!;

describe('panel Visual: propuesta before→after', () => {
  it('renderiza las secciones y un segmento produce un cambio con vista previa inline', () => {
    const el = document.getElementById('t')!;
    const { ed, box } = visual(el);
    expect(box.querySelectorAll('.pf-dz-sec').length).toBe(8);
    btn(box, 'text-align:center').click();
    expect(ed.changes.get('text-align')?.after).toBe('center');
    expect(el.style.getPropertyValue('text-align')).toBe('center');
    // re-pulsar la opción activa quita el cambio y restaura
    btn(box, 'text-align:center').click();
    expect(ed.count).toBe(0);
    expect(el.style.getPropertyValue('text-align')).toBe('');
  });

  it('elemento con Tailwind: la propuesta lleva la clase equivalente y valida contra el esquema', () => {
    const el = document.getElementById('t')!;
    const { ed, box } = visual(el);
    btn(box, 'font-weight:700').click();
    const p = ed.toProposal('p#t', new Set())!;
    expect(CommentProposalSchema.safeParse(p).success).toBe(true);
    const c = p.changes[0]!;
    expect(c.property).toBe('font-weight');
    expect(c.after).toBe('700');
    expect(c.origin).toBe('editable');
    expect(c.tailwind).toBe('— → font-bold');
  });

  it('elemento sin Tailwind: sin clase equivalente; before = valor calculado', () => {
    const el = document.getElementById('plain')!;
    const { ed, box } = visual(el);
    btn(box, 'text-transform:uppercase').click();
    const p = ed.toProposal('p#plain', new Set())!;
    expect(CommentProposalSchema.safeParse(p).success).toBe(true);
    expect(p.changes[0]!.tailwind).toBeUndefined();
    expect(p.changes[0]!.after).toBe('uppercase');
  });

  it('swatch del tema: token --pf-color-* viaja en la propuesta', () => {
    const el = document.getElementById('plain')!;
    const { ed, box } = visual(el);
    btn(box, 'sw:accent').click();
    const c = ed.toProposal('p#plain', new Set())!.changes[0]!;
    expect(c.token).toBe('--pf-color-accent');
    expect(c.after).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('comentario autogenerado, sin nota', () => {
    const el = document.getElementById('t')!;
    const { ed, box } = visual(el);
    btn(box, 'font-weight:700').click();
    const p = ed.toProposal('p#t', new Set())!;
    expect(proposalsToComment([p])).toMatch(/^Cambiar estilo: font-weight .+ → 700$/);
  });

  it('revertAll limpia la vista previa; los nodos propios (isPfNode) nunca se pintan', () => {
    const el = document.getElementById('t')!;
    const { ed, box } = visual(el);
    btn(box, 'text-align:right').click();
    ed.revertAll();
    expect(el.style.getPropertyValue('text-align')).toBe('');
    const host = document.getElementById('host')!;
    host.setAttribute(HOST_ATTR, '');
    const e2 = mkEditor(host);
    e2.addRow({ property: 'color', kind: 'color', group: 'x', value: 'red', origin: 'editable', source: null, sourceLabel: null, token: null });
    e2.set('color', 'blue');
    expect(host.style.getPropertyValue('color')).toBe('');
  });
});

describe('design/color', () => {
  it('normaliza y convierte colores', () => {
    expect(normColor('#fff')).toBe('rgb(255, 255, 255)');
    expect(normColor('rgba(1, 2, 3, 1)')).toBe('rgb(1, 2, 3)');
    expect(toHex('rgb(47, 91, 234)')).toBe('#2f5bea');
    expect(toHex('rgba(0, 0, 0, 0)')).toBeNull();
  });
  it('swatches y sombras salen de los tokens de perfect-front', () => {
    expect(themeSwatches(false).find((s) => s.name === 'accent')).toMatchObject({ token: '--pf-color-accent', value: '#2f5bea' });
    expect(themeSwatches(true).find((s) => s.name === 'accent')?.value).toBe('#7c9cff');
    expect(shadowPresets(false).map((s) => s.name)).toEqual(['none', 'sm', 'md', 'lg']);
  });
});
