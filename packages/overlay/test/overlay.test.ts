// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateCommentRequestSchema, type CreateCommentRequest } from '@perfect-front/shared';
import { createOverlay, type OverlayHandle, type OverlayState } from '../src/index';

const flush = () => new Promise<void>((r) => setTimeout(r, 0));
const ok = { id: 'c1', collection: 'inbox', route: '/' };

// --- seguimiento de listeners -------------------------------------------------------
const live = new Map<string, number>();
const ids = new WeakMap<object, number>();
let seq = 0;
const key = (t: object, type: string, fn: unknown, o: unknown) => {
  const idOf = (x: object) => ids.get(x) ?? (ids.set(x, ++seq), seq);
  const cap = typeof o === 'boolean' ? o : !!(o as { capture?: boolean } | undefined)?.capture;
  return `${idOf(t)}|${type}|${idOf(fn as object)}|${cap}`;
};
type Fn = (this: EventTarget, type: string, fn: never, o?: never) => void;
const patched: Array<[object, Fn, Fn]> = [];
beforeEach(() => {
  // happy-dom sobreescribe addEventListener en varias clases: se parchea cada prototipo que lo define.
  for (const obj of [document, window, document.body, document.createElement('div')]) {
    for (let p = Object.getPrototypeOf(obj); p; p = Object.getPrototypeOf(p)) {
      if (!Object.hasOwn(p, 'addEventListener') || patched.some(([x]) => x === p)) continue;
      const add = p.addEventListener as Fn;
      const rem = p.removeEventListener as Fn;
      patched.push([p, add, rem]);
      p.addEventListener = function (this: EventTarget, type: string, fn: never, o?: never) {
        live.set(key(this, type, fn, o), 1);
        return add.call(this, type, fn, o);
      };
      p.removeEventListener = function (this: EventTarget, type: string, fn: never, o?: never) {
        live.delete(key(this, type, fn, o));
        return rem.call(this, type, fn, o);
      };
    }
  }
});

let overlay: OverlayHandle | null = null;
afterEach(() => {
  overlay?.destroy();
  overlay = null;
  for (const [p, add, rem] of patched.splice(0)) {
    (p as EventTarget).addEventListener = add;
    (p as EventTarget).removeEventListener = rem;
  }
  live.clear();
  document.body.innerHTML = '';
  document.title = '';
});

const hostEl = () => document.querySelector('[data-perfect-front-overlay]') as HTMLElement | null;
const sr = () => hostEl()!.shadowRoot!;
const q = <T extends Element = HTMLElement>(sel: string) => sr().querySelector(sel) as T | null;
const btn = (label: string) =>
  Array.from(sr().querySelectorAll('button')).find((b) => b.textContent === label) as HTMLButtonElement;

function page() {
  document.body.innerHTML = `
    <main id="app">
      <a id="lnk" href="/other">Enlace</a>
      <button id="b1" type="button">Comprar</button>
      <form id="f"><input name="email"><button id="sub" type="submit">Enviar</button></form>
      <div id="outer"><section id="mid"><p id="inner">Hola</p></section></div>
      <svg id="s" viewBox="0 0 10 10"><path id="pth" d="M0 0"/></svg>
    </main>`;
  document.title = 'Mi página';
}

function make(extra: Partial<Parameters<typeof createOverlay>[0]> = {}) {
  const states: OverlayState[] = [];
  const onSubmit = vi.fn<(r: CreateCommentRequest) => Promise<typeof ok>>(async () => ok);
  overlay = createOverlay({ onSubmit, onStateChange: (s) => states.push(s), ...extra });
  return { onSubmit, states, o: overlay };
}

const fire = (t: EventTarget, type: string, init: Record<string, unknown> = {}) => {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, ...init });
  t.dispatchEvent(ev);
  return ev;
};
const key$ = (k: string, init: Record<string, unknown> = {}, t: EventTarget = document.body) => {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, composed: true, ...init });
  t.dispatchEvent(ev);
  return ev;
};
const pick = (id: string) => fire(document.getElementById(id)!, 'click');
const textarea = () => q<HTMLTextAreaElement>('textarea')!;

describe('estados', () => {
  it('OFF -> SELECTING -> EDITING -> SAVING -> SAVED -> OFF', async () => {
    page();
    const { o, states } = make();
    expect(o.state).toBe('OFF');
    o.enable();
    o.enable();
    expect(o.state).toBe('SELECTING');
    pick('b1');
    expect(o.state).toBe('EDITING');
    textarea().value = 'cambiar color';
    btn('Guardar').click();
    expect(o.state).toBe('SAVING');
    await flush();
    expect(o.state).toBe('SELECTING');
    o.disable();
    expect(o.state).toBe('OFF');
    expect(states).toEqual(['SELECTING', 'EDITING', 'SAVING', 'SAVED', 'SELECTING', 'OFF']);
  });

  it('enable tras destroy no hace nada', () => {
    page();
    const { o } = make();
    o.destroy();
    o.enable();
    expect(o.state).toBe('OFF');
    expect(hostEl()).toBeNull();
  });
});

describe('selección', () => {
  it('resalta el elemento bajo el cursor', () => {
    page();
    const { o } = make();
    o.enable();
    fire(document.getElementById('b1')!, 'mousemove');
    const hl = q('.pf-ov-highlight')!;
    expect(hl.hidden).toBe(false);
    expect(q('.pf-ov-label')!.textContent).toBe('button#b1');
  });

  it('excluye el propio overlay de la selección', () => {
    page();
    const { o } = make();
    o.enable();
    fire(document.getElementById('b1')!, 'mousemove');
    fire(btn('Salir'), 'mousemove');
    fire(hostEl()!, 'mousemove');
    expect(q('.pf-ov-label')!.textContent).toBe('button#b1');
    const ev = fire(q('.pf-ov-toolbar')!, 'click');
    expect(ev.defaultPrevented).toBe(false);
    expect(o.state).toBe('SELECTING');
  });

  it('el clic de selección no navega ni llega a la página; luego la página vuelve a funcionar', () => {
    page();
    const spy = vi.fn();
    document.getElementById('lnk')!.addEventListener('click', spy);
    const { o } = make();
    o.enable();
    const ev = pick('lnk');
    expect(ev.defaultPrevented).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    expect(o.state).toBe('EDITING');
    const ev2 = pick('lnk');
    expect(ev2.defaultPrevented).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('bloquea botones y envío de formularios durante la selección', () => {
    page();
    const spy = vi.fn();
    document.getElementById('b1')!.addEventListener('click', spy);
    document.getElementById('f')!.addEventListener('submit', spy);
    const { o } = make();
    o.enable();
    expect(fire(document.getElementById('f')!, 'submit').defaultPrevented).toBe(true);
    pick('sub');
    expect(spy).not.toHaveBeenCalled();
  });

  it('teclado: flechas padre/hijo, Enter confirma', () => {
    page();
    const { o } = make();
    o.enable();
    fire(document.getElementById('inner')!, 'mousemove');
    key$('ArrowUp');
    expect(q('.pf-ov-label')!.textContent).toBe('section#mid');
    key$('ArrowUp');
    expect(q('.pf-ov-label')!.textContent).toBe('div#outer');
    key$('ArrowDown');
    expect(q('.pf-ov-label')!.textContent).toBe('section#mid');
    key$('ArrowDown');
    expect(q('.pf-ov-label')!.textContent).toBe('p#inner');
    key$('ArrowUp');
    key$('Enter');
    expect(o.state).toBe('EDITING');
    expect(q('.pf-ov-code')!.textContent).toBe('#mid');
  });

  it('Escape en SELECTING desactiva', () => {
    page();
    const { o } = make();
    o.enable();
    key$('Escape');
    expect(o.state).toBe('OFF');
  });

  it('SVG: se puede seleccionar un hijo y el payload es válido', async () => {
    page();
    const { o, onSubmit } = make();
    o.enable();
    pick('pth');
    textarea().value = 'icono feo';
    btn('Guardar').click();
    await flush();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const req = onSubmit.mock.calls[0]![0];
    expect(req.location.selector).toBe('#pth');
    expect(CreateCommentRequestSchema.safeParse(req).success).toBe(true);
  });
});

describe('edición y guardado', () => {
  it('payload de elemento completo y válido', async () => {
    page();
    const { o, onSubmit } = make();
    o.enable();
    pick('b1');
    expect(o.state).toBe('EDITING');
    expect(sr().activeElement).toBe(textarea());
    textarea().value = '  más grande  ';
    btn('Guardar').click();
    await flush();
    const req = onSubmit.mock.calls[0]![0];
    expect(req.scope).toBe('element');
    expect(req.comment).toBe('más grande');
    expect(req.location.selector).toBe('#b1');
    expect(req.location.selectorCandidates.length).toBeGreaterThan(0);
    expect(req.location.text).toBe('Comprar');
    expect(req.location.html).toContain('<button');
    expect(req.location.title).toBe('Mi página');
    expect(req.location.route.startsWith('/')).toBe(true);
    expect(req.elementRect).not.toBeNull();
    expect(CreateCommentRequestSchema.safeParse(req).success).toBe(true);
  });

  it('scope view: sin selector, html ni rect', async () => {
    page();
    const { o, onSubmit } = make();
    o.enable();
    btn('Comentar la vista').click();
    expect(o.state).toBe('EDITING');
    textarea().value = 'todo está raro';
    btn('Guardar').click();
    await flush();
    const req = onSubmit.mock.calls[0]![0];
    expect(req.scope).toBe('view');
    expect(req.location.selector).toBeNull();
    expect(req.location.selectorCandidates).toEqual([]);
    expect(req.location.html).toBeNull();
    expect(req.elementRect).toBeNull();
    expect(CreateCommentRequestSchema.safeParse(req).success).toBe(true);
  });

  it('Ctrl/Cmd+Enter guarda, y un solo onSubmit aunque se repita', async () => {
    page();
    const { o, onSubmit } = make();
    o.enable();
    pick('b1');
    textarea().value = 'x';
    key$('Enter', { ctrlKey: true }, textarea());
    key$('Enter', { metaKey: true }, textarea());
    btn('Guardar').click();
    await flush();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(o.state).toBe('SELECTING');
  });

  it('comentario vacío no llama a onSubmit', async () => {
    page();
    const { o, onSubmit } = make();
    o.enable();
    pick('b1');
    btn('Guardar').click();
    await flush();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(o.state).toBe('EDITING');
    expect(q('.pf-ov-error')!.textContent).not.toBe('');
  });

  it('Escape cancela la edición y vuelve a selección sin guardar', () => {
    page();
    const { o, onSubmit } = make();
    o.enable();
    pick('b1');
    textarea().value = 'descartar';
    key$('Escape', {}, textarea());
    expect(o.state).toBe('SELECTING');
    expect(q('textarea')).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('accesibilidad: dialog, label, alert y región aria-live', () => {
    page();
    const { o } = make();
    o.enable();
    pick('b1');
    expect(q('[role="dialog"]')).not.toBeNull();
    const label = q<HTMLLabelElement>('label')!;
    expect(label.htmlFor).toBe(textarea().id);
    expect(q('[role="alert"]')).not.toBeNull();
    expect(q('[aria-live="polite"]')).not.toBeNull();
  });

  it('si onSubmit falla: ERROR, conserva el texto y permite reintentar', async () => {
    page();
    const { o, onSubmit } = make();
    onSubmit.mockRejectedValueOnce(new Error('sin servidor'));
    o.enable();
    pick('b1');
    textarea().value = 'texto largo importante';
    btn('Guardar').click();
    expect(o.state).toBe('SAVING');
    await flush();
    expect(o.state).toBe('ERROR');
    expect(textarea().value).toBe('texto largo importante');
    expect(textarea().disabled).toBe(false);
    expect(q('.pf-ov-error')!.textContent).toContain('sin servidor');
    btn('Guardar').click();
    await flush();
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(o.state).toBe('SELECTING');
  });

  it('un payload inválido no llega a onSubmit', async () => {
    page();
    const { o, onSubmit } = make();
    o.enable();
    pick('b1');
    textarea().value = 'x';
    textarea().maxLength = 100000;
    textarea().value = 'x'.repeat(10_001);
    btn('Guardar').click();
    await flush();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(o.state).toBe('ERROR');
    expect(textarea().value.length).toBe(10_001);
  });

  it('disable durante SAVING ignora el resultado tardío', async () => {
    page();
    let resolve!: (v: typeof ok) => void;
    const { o, states } = make({ onSubmit: () => new Promise((r) => (resolve = r)) });
    o.enable();
    pick('b1');
    textarea().value = 'a';
    btn('Guardar').click();
    o.disable();
    resolve(ok);
    await flush();
    expect(o.state).toBe('OFF');
    expect(states.at(-1)).toBe('OFF');
  });
});

describe('captura opcional', () => {
  it('sin onRequestCapture no hay botón', () => {
    page();
    const { o } = make();
    o.enable();
    pick('b1');
    expect(btn('Adjuntar captura')).toBeUndefined();
  });

  it('solo captura por acción explícita y la adjunta', async () => {
    page();
    const onRequestCapture = vi.fn(async () => ({ mimeType: 'image/png' as const, dataBase64: 'iVBORw0KGgo=' }));
    const { o, onSubmit } = make({ onRequestCapture });
    o.enable();
    pick('b1');
    expect(onRequestCapture).not.toHaveBeenCalled();
    btn('Adjuntar captura').click();
    await flush();
    expect(onRequestCapture).toHaveBeenCalledTimes(1);
    expect(hostEl()!.style.visibility).toBe('');
    textarea().value = 'con captura';
    btn('Guardar').click();
    await flush();
    expect(onSubmit.mock.calls[0]![0].screenshot?.mimeType).toBe('image/png');
  });
});

describe('limpieza', () => {
  const snapshotDom = () => document.documentElement.outerHTML;

  for (const how of ['disable', 'destroy'] as const) {
    it(`${how}() restaura DOM, listeners y foco`, async () => {
      page();
      const input = document.querySelector<HTMLInputElement>('input[name="email"]')!;
      input.focus();
      const domBefore = snapshotDom();
      const listenersBefore = live.size;
      const { o } = make({ onRequestCapture: async () => ({ mimeType: 'image/png', dataBase64: 'AAAA' }) });
      o.enable();
      expect(live.size).toBeGreaterThan(listenersBefore);
      fire(document.getElementById('b1')!, 'mousemove');
      pick('b1');
      textarea().value = 'x';
      btn('Guardar').click();
      await flush();
      o[how]();
      expect(snapshotDom()).toBe(domBefore);
      expect(live.size).toBe(listenersBefore);
      expect(hostEl()).toBeNull();
      expect(document.activeElement).toBe(input);
    });
  }

  it('ciclos enable/disable repetidos no acumulan nada', () => {
    page();
    const domBefore = snapshotDom();
    const before = live.size;
    const { o } = make();
    for (let i = 0; i < 5; i++) {
      o.enable();
      pick('b1');
      o.disable();
    }
    expect(snapshotDom()).toBe(domBefore);
    expect(live.size).toBe(before);
  });

  it('con el overlay apagado la página no se ve afectada', () => {
    page();
    const spy = vi.fn();
    document.getElementById('b1')!.addEventListener('click', spy);
    const { o } = make();
    o.enable();
    o.disable();
    expect(fire(document.getElementById('b1')!, 'click').defaultPrevented).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('el host usa un único nodo con Shadow Root y estilos --pf-*', () => {
    page();
    const { o } = make();
    o.enable();
    expect(document.querySelectorAll('[data-perfect-front-overlay]').length).toBe(1);
    const css = sr().querySelector('style')!.textContent!;
    expect(css).toContain('--pf-color-accent');
    expect(document.head.querySelector('style')).toBeNull();
  });
});
