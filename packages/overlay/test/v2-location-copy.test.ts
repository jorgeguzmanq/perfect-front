// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Selection, type SelectedNode } from '../src/selection';
import {
  copyAll,
  copyText,
  previewFor,
  quickCopyText,
  refInput,
  writeClipboard,
} from '../src/location-copy';

const byId = (id: string) => document.getElementById(id)!;

let nodes: SelectedNode[];

beforeEach(() => {
  (window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL('http://localhost:3000/landing');
  document.body.innerHTML =
    '<section id="hero"><button id="cta" data-pf-src="src/Hero.tsx:7">Empezar</button><button id="sin">Otro</button></section>';
  const sel = new Selection();
  sel.set(byId('cta'));
  sel.add(byId('sin'));
  nodes = [...sel.nodes];
});

describe('formatos por nodo', () => {
  it('refInput toma la ruta del documento y el origen de data-pf-src', () => {
    const ref = refInput(document, nodes[0]!);
    expect(ref.route).toBe('/landing');
    expect(ref.source).toEqual({ file: 'src/Hero.tsx', line: 7 });
    expect(ref.selector).toBe(nodes[0]!.snap.selector);
  });

  it('«archivo y línea» es null si el nodo no trae data-pf-src', () => {
    expect(copyText(document, nodes[0]!, 'file')).toBe('src/Hero.tsx:7');
    expect(copyText(document, nodes[1]!, 'file')).toBeNull();
  });

  it('«selector CSS» devuelve el selector del snapshot', () => {
    expect(copyText(document, nodes[1]!, 'sel')).toBe(nodes[1]!.snap.selector);
  });

  it('«referencia pf://» usa la ruta sin barra inicial y el último tramo del selector', () => {
    const last = nodes[0]!.snap.selector.split(' > ').pop();
    expect(copyText(document, nodes[0]!, 'pf')).toBe(`pf://landing#${last}`);
  });

  it('«markdown» pone archivo y etiqueta entre backticks y termina con la ruta', () => {
    const md = copyText(document, nodes[0]!, 'md')!;
    expect(md).toContain('`src/Hero.tsx:7`');
    expect(md.endsWith(' en /landing')).toBe(true);
    expect(copyText(document, nodes[1]!, 'md')).toMatch(/^`[^`]+` en \/landing$/);
  });
});

describe('copiar todos (multiselección)', () => {
  it('lista un guion por nodo con el mejor dato disponible (archivo, si no selector)', () => {
    expect(copyAll(document, nodes)).toBe(`- src/Hero.tsx:7\n- ${nodes[1]!.snap.selector}`);
  });

  it('previewFor «todos» solo aplica con multiselección y separa con ⏎', () => {
    const multi = previewFor(document, nodes, 0, 'all')!;
    expect(multi).toContain(' ⏎ ');
    expect(previewFor(document, [nodes[0]!], 0, 'all')).toBeNull();
  });

  it('previewFor de un formato devuelve el valor del nodo enfocado o null si no hay dato', () => {
    expect(previewFor(document, nodes, 0, 'file')).toBe('src/Hero.tsx:7');
    expect(previewFor(document, nodes, 1, 'file')).toBeNull();
    expect(previewFor(document, nodes, 9, 'sel')).toBeNull();
  });
});

describe('clic simple', () => {
  it('prefiere archivo:línea y cae al selector si no existe', () => {
    expect(quickCopyText(document, nodes[0]!)).toBe('src/Hero.tsx:7');
    expect(quickCopyText(document, nodes[1]!)).toBe(nodes[1]!.snap.selector);
  });
});

describe('writeClipboard', () => {
  it('usa la API async del portapapeles cuando funciona', async () => {
    const writeText = vi.fn(async () => undefined);
    const doc = { defaultView: { navigator: { clipboard: { writeText } } } } as unknown as Document;
    await expect(writeClipboard(doc, 'hola')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('hola');
  });

  it('si la API se niega, cae a execCommand y limpia el textarea temporal', async () => {
    const ta = { value: '', setAttribute: vi.fn(), style: { cssText: '' }, select: vi.fn(), remove: vi.fn() };
    const doc = {
      defaultView: { navigator: { clipboard: { writeText: vi.fn(async () => Promise.reject(new Error('denied'))) } } },
      createElement: vi.fn(() => ta),
      body: { appendChild: vi.fn() },
      execCommand: vi.fn(() => true),
    } as unknown as Document;
    await expect(writeClipboard(doc, 'texto')).resolves.toBe(true);
    expect(ta.value).toBe('texto');
    expect(doc.execCommand).toHaveBeenCalledWith('copy');
    expect(ta.remove).toHaveBeenCalled();
  });

  it('sin API y con execCommand fallido devuelve false, sin lanzar', async () => {
    const ta = { value: '', setAttribute: vi.fn(), style: { cssText: '' }, select: vi.fn(), remove: vi.fn() };
    const doc = {
      defaultView: { navigator: {} },
      createElement: () => ta,
      body: { appendChild: vi.fn() },
      execCommand: vi.fn(() => false),
    } as unknown as Document;
    await expect(writeClipboard(doc, 'x')).resolves.toBe(false);
  });

  it('si execCommand lanza, devuelve false sin propagar el error', async () => {
    const ta = { value: '', setAttribute: vi.fn(), style: { cssText: '' }, select: vi.fn(), remove: vi.fn() };
    const doc = {
      defaultView: { navigator: {} },
      createElement: () => ta,
      body: { appendChild: vi.fn() },
      execCommand: vi.fn(() => {
        throw new Error('boom');
      }),
    } as unknown as Document;
    await expect(writeClipboard(doc, 'x')).resolves.toBe(false);
  });
});
