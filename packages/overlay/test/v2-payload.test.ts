// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { COMMENT_VERSION, CreateCommentRequestSchema, type CommentProposal } from '@perfect-front/shared';
import { Attachments } from '../src/attachments';
import { buildRequestV2, hasContent, targetSelectorFor, type DraftV2 } from '../src/payload';
import { Sections } from '../src/sections';
import { Selection } from '../src/selection';

const byId = (id: string) => document.getElementById(id)!;

beforeEach(() => {
  (window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL('http://localhost:3000/landing');
  document.body.innerHTML =
    '<section id="hero"><button id="cta" data-pf-src="src/Hero.tsx:7">Empezar</button><button id="sin">Otro</button></section>';
});

const PNG_B64 = 'AQIDBA==';

function draft(over: Partial<DraftV2> = {}): DraftV2 {
  return {
    doc: document,
    scope: 'view',
    selection: new Selection(),
    main: 'Hola',
    fallbackText: null,
    sections: new Sections(),
    attachments: new Attachments(),
    proposals: [],
    group: null,
    ...over,
  };
}

function elementDraft(over: Partial<DraftV2> = {}): DraftV2 {
  const sel = new Selection();
  sel.set(byId('cta'));
  sel.add(byId('sin'));
  return draft({ scope: 'element', selection: sel, main: 'Mover el botón', ...over });
}

describe('buildRequestV2: request válida', () => {
  it('vista completa: arma una request v2 que pasa CreateCommentRequestSchema', () => {
    const r = buildRequestV2(draft());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(CreateCommentRequestSchema.safeParse(r.request).success).toBe(true);
    expect(r.request).toMatchObject({
      version: COMMENT_VERSION,
      scope: 'view',
      comment: 'Hola',
      group: null,
      sections: [],
      uploads: [],
      extraTargets: [],
      proposals: [],
    });
    expect(r.request.location.selector).toBeNull();
    expect(r.request.location.route).toBe('/landing');
    expect(r.request.elementRect).toBeNull();
  });

  it('elemento: el principal va en location y el resto en extraTargets', () => {
    const d = elementDraft();
    const r = buildRequestV2(d);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(CreateCommentRequestSchema.safeParse(r.request).success).toBe(true);
    expect(r.request.scope).toBe('element');
    expect(r.request.location.selector).toBe(d.selection.nodes[0]!.snap.selector);
    expect(r.request.elementRect).not.toBeNull();
    expect(r.request.extraTargets).toHaveLength(1);
    expect(r.request.extraTargets[0]!.selector).toBe(d.selection.nodes[1]!.snap.selector);
  });

  it('con texto principal vacío, arma el comentario con las secciones («Título: texto»)', () => {
    const sections = new Sections();
    const s = sections.add('Antes')!;
    sections.update(s.id, { text: 'El botón' });
    const r = buildRequestV2(draft({ main: '  ', sections }));
    expect(r.ok && r.request.comment).toBe('Antes: El botón');
    expect(r.ok && r.request.sections).toEqual([{ id: s.id, title: 'Antes', text: 'El botón' }]);
  });

  it('usa el texto de reserva si el principal está vacío', () => {
    const r = buildRequestV2(draft({ main: '', fallbackText: 'Cambiar texto de A a B' }));
    expect(r.ok && r.request.comment).toBe('Cambiar texto de A a B');
  });

  it('sin texto, principal, secciones ni reserva, devuelve el error para mostrar', () => {
    const r = buildRequestV2(draft({ main: '   ' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('Escribe un comentario antes de guardar.');
  });

  it('la sección con imágenes se conserva aunque esté vacía; la vacía sin imágenes se omite', () => {
    const sections = new Sections();
    const withImg = sections.add()!; // sin título ni texto: solo sobrevive por tener imagen
    const empty = sections.add()!;
    const attachments = new Attachments();
    expect(attachments.addCapture({ mimeType: 'image/png', dataBase64: PNG_B64 }, withImg.id).ok).toBe(true);

    const r = buildRequestV2(draft({ sections, attachments }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(CreateCommentRequestSchema.safeParse(r.request).success).toBe(true);
    expect(r.request.sections.map((s) => s.id)).toEqual([withImg.id]);
    expect(empty.id).not.toBe(withImg.id);
    expect(r.request.uploads).toHaveLength(1);
    expect(r.request.uploads[0]).toMatchObject({ sectionId: withImg.id, source: 'capture', dataBase64: PNG_B64 });
  });

  it('las imágenes sueltas viajan con sectionId null', () => {
    const attachments = new Attachments();
    attachments.addCapture({ mimeType: 'image/png', dataBase64: PNG_B64 }, null);
    const r = buildRequestV2(draft({ attachments }));
    expect(r.ok && r.request.uploads[0]!.sectionId).toBeNull();
    expect(r.ok && CreateCommentRequestSchema.safeParse(r.request).success).toBe(true);
  });

  it('incluye las propuestas (p. ej. reordenar) tal cual, validadas por el schema', () => {
    const proposal: CommentProposal = {
      id: 'p-1',
      kind: 'reorder',
      targetSelector: '#l > li',
      parentSelector: '#l',
      from: 1,
      to: 2,
      siblingCount: 3,
    };
    const r = buildRequestV2(draft({ proposals: [proposal] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.request.proposals).toEqual([proposal]);
    expect(CreateCommentRequestSchema.safeParse(r.request).success).toBe(true);
  });

  it('incluye la referencia de grupo cuando el comentario va a un grupo', () => {
    const r = buildRequestV2(draft({ group: { id: 'grupo-a', position: 2 } as never }));
    expect(r.ok && r.request.group).toEqual({ id: 'grupo-a', position: 2 });
  });

  it('un dato que el schema rechaza se devuelve como error legible, no como excepción', () => {
    const r = buildRequestV2(draft({ group: { id: 'Id Malo!', position: 1 } as never }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.startsWith('El comentario no es válido:')).toBe(true);
  });
});

describe('hasContent', () => {
  const base = () => ({
    main: '',
    fallbackText: null,
    sections: new Sections(),
    attachments: new Attachments(),
    proposals: [] as CommentProposal[],
  });

  it('vacío no tiene contenido', () => {
    expect(hasContent(base())).toBe(false);
  });

  it('texto principal, reserva, sección con texto, imagen o propuesta cuentan como contenido', () => {
    expect(hasContent({ ...base(), main: 'x' })).toBe(true);
    expect(hasContent({ ...base(), fallbackText: 'x' })).toBe(true);

    const s = new Sections();
    const sec = s.add()!;
    s.update(sec.id, { text: 'algo' });
    expect(hasContent({ ...base(), sections: s })).toBe(true);

    const a = new Attachments();
    a.addCapture({ mimeType: 'image/png', dataBase64: PNG_B64 }, null);
    expect(hasContent({ ...base(), attachments: a })).toBe(true);

    expect(
      hasContent({
        ...base(),
        proposals: [{ id: 'p-1', kind: 'reorder', targetSelector: null, parentSelector: null, from: 1, to: 2, siblingCount: 2 }],
      }),
    ).toBe(true);
  });

  it('una sección solo con título no es contenido', () => {
    const s = new Sections();
    s.add('Solo título');
    expect(hasContent({ ...base(), sections: s })).toBe(false);
  });
});

describe('targetSelectorFor', () => {
  it('el nodo principal no lleva selector (null); los demás, su selector', () => {
    const sel = new Selection();
    sel.set(byId('cta'));
    sel.add(byId('sin'));
    expect(targetSelectorFor(sel, 0)).toBeNull();
    expect(targetSelectorFor(sel, 1)).toBe(sel.nodes[1]!.snap.selector);
    expect(targetSelectorFor(sel, 5)).toBeNull();
  });
});
