import { ScreenshotUploadSchema } from '@perfect-front/shared';
import { createCaptureController, type CaptureController } from './capture-ui';
import { HOST_ATTR, isPfNode } from './constants';
import { describe, h } from './dom';
import { isGripEvent } from './drag-panel';
import { CROSS_ORIGIN_MSG, isCrossOriginFrame } from './frame';
import { createEditor, type EditorHandle } from './editor';
import type { Scope } from './editor-ctx';
import type { GroupBinding } from './groups';
import { Selection } from './selection';
import { injectStylesIntoShadowRoot } from './styles';
import type {
  CapturedShot,
  OverlayHandle,
  OverlayOptions,
  OverlayState,
  ScreenshotUpload,
  ShotAttachPort,
  SubmitResult,
} from './types';

/**
 * Modo del Shadow Root. Se deja 'open' a propósito: permite inspeccionarlo con DevTools,
 * probarlo (tests e2e/unitarios leen `host.shadowRoot`) y depurar estilos. La contrapartida
 * es que el código de la página puede hacer `host.shadowRoot`. Para cerrarlo basta cambiar
 * esta constante a 'closed'; el overlay conserva su propia referencia y no depende de
 * `host.shadowRoot`. (Los tests usan 'open'.)
 */
export const SHADOW_MODE: 'open' | 'closed' = 'open';

export { HOST_ATTR };

const BLOCKED_EVENTS = [
  'pointerdown',
  'pointerup',
  'mousedown',
  'mouseup',
  'click',
  'dblclick',
  'auxclick',
  'contextmenu',
  'submit',
  'dragstart',
] as const;


export function createOverlay(opts: OverlayOptions): OverlayHandle {
  const doc = opts.document ?? document;
  const win = doc.defaultView;
  const passive = opts.passive === true;

  let state: OverlayState = 'OFF';
  let destroyed = false;
  let session = 0;
  let cleanups: Array<() => void> = [];

  let host: HTMLElement | null = null;
  let layer: HTMLElement | null = null;
  let highlight: HTMLElement | null = null;
  let highlightLabel: HTMLElement | null = null;
  let tip: HTMLElement | null = null;
  let live: HTMLElement | null = null;
  let toolbar: HTMLElement | null = null;
  let extraMarks: HTMLElement[] = [];
  /** Resaltado del nodo bajo el cursor en la pestaña «Capas». */
  let hoverMark: HTMLElement | null = null;
  let insertMark: HTMLElement | null = null;
  /** Captura de nodos (marco + escalas + resultado). Vive en la capa del overlay; se libera en unmount. */
  let capture: CaptureController | null = null;
  let captureNodes: Element[] = [];

  /** Editor v2 (panel con pestañas). Existe solo en EDITING / SAVING / ERROR. */
  let editor: EditorHandle | null = null;
  const sel = new Selection();
  let pendingBinding: GroupBinding | null = null;

  /** Elemento resaltado en modo selección (en edición manda `editor.focusEl`). */
  let current: Element | null = null;
  let childStack: Element[] = [];
  let draft = '';
  let capturing = false;
  let prevFocus: Element | null = null;
  let returnFocus: Element | null = null;
  let hoverTarget: Element | null = null;

  const setState = (s: OverlayState) => {
    if (state === s) return;
    state = s;
    updateTip();
    try {
      opts.onStateChange?.(s);
    } catch {
      /* un callback del consumidor no debe romper el overlay */
    }
  };

  const listen = (
    target: EventTarget,
    type: string,
    fn: (e: Event) => void,
    options?: AddEventListenerOptions | boolean,
  ) => {
    target.addEventListener(type, fn, options);
    cleanups.push(() => target.removeEventListener(type, fn, options));
  };

  const isOwn = (e: Event): boolean => {
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    if (host && (e.target === host || path.includes(host))) return true;
    return isPfNode(e.target) || path.some(isPfNode);
  };

  const announce = (msg: string) => {
    if (!live) return;
    live.textContent = '';
    live.textContent = msg;
  };

  const restoreFocus = (el: Element | null) => {
    if (el && el.isConnected && typeof (el as HTMLElement).focus === 'function') {
      try {
        (el as HTMLElement).focus();
      } catch {
        /* sin foco que restaurar */
      }
    }
  };


  // --- Resaltado -------------------------------------------------------------

  function updateTip() {
    if (!tip || !highlight) return;
    const picking = state === 'SELECTING' || state === 'IDLE';
    tip.hidden = highlight.hidden || !picking;
    tip.textContent = state === 'SELECTING' ? 'clic para comentar' : 'Alt+clic para comentar';
  }

  const box = (mark: HTMLElement, r: DOMRect) => {
    mark.hidden = false;
    mark.style.top = `${r.top}px`;
    mark.style.left = `${r.left}px`;
    mark.style.width = `${r.width}px`;
    mark.style.height = `${r.height}px`;
  };

  const placeHighlight = () => {
    if (!highlight || !highlightLabel || !layer) return;
    const main = editor ? editor.focusEl : current;
    if (!main || !main.isConnected) {
      highlight.hidden = true;
    } else {
      box(highlight, main.getBoundingClientRect());
      highlightLabel.textContent = describe(main);
      // Multiselección: la marca del foco lleva su número (1…n) como las demás.
      const order = editor ? editor.nodes : [];
      if (order.length > 1) highlight.dataset.n = String(order.indexOf(main) + 1);
      else delete highlight.dataset.n;
    }
    // Resto de los nodos de una multiselección (marcas en el shadow DOM propio; la página no se toca).
    const extra = editor ? editor.nodes.filter((n) => n !== main && n.isConnected) : [];
    while (extraMarks.length < extra.length) {
      const m = h(doc, 'div', 'pf-ov-highlight pf-ov-highlight--extra');
      layer.appendChild(m);
      extraMarks.push(m);
    }
    extraMarks.forEach((m, i) => {
      const n = extra[i];
      if (n) {
        box(m, n.getBoundingClientRect());
        m.dataset.n = String((editor?.nodes.indexOf(n) ?? -1) + 1);
      } else m.hidden = true;
    });
    // Nodo señalado desde la pestaña «Capas» (solo una marca propia; no se toca la página).
    const hov = editor?.hoverEl ?? null;
    if (hov && hov !== main) {
      if (!hoverMark) {
        hoverMark = h(doc, 'div', 'pf-ov-highlight pf-ov-highlight--hover');
        layer.appendChild(hoverMark);
      }
      box(hoverMark, hov.getBoundingClientRect());
    } else if (hoverMark) hoverMark.hidden = true;
    // Línea de inserción de la propuesta de reordenar.
    const ins = editor?.reorderIndicator() ?? null;
    if (ins?.el.isConnected) {
      if (!insertMark) {
        insertMark = h(doc, 'div', 'pf-ov-insert');
        insertMark.style.position = 'fixed';
        insertMark.style.height = '3px';
        insertMark.style.borderRadius = '2px';
        insertMark.style.background = 'var(--pf-dk-ph, var(--pf-color-accent))';
        insertMark.style.boxShadow = '0 0 0 1px var(--pf-dk-desk, transparent)';
        insertMark.style.pointerEvents = 'none';
        layer.appendChild(insertMark);
      }
      const r = ins.el.getBoundingClientRect();
      insertMark.hidden = false;
      insertMark.style.left = `${r.left}px`;
      insertMark.style.width = `${r.width}px`;
      insertMark.style.top = `${(ins.side === 'before' ? r.top : r.bottom) - 1}px`;
    } else if (insertMark) insertMark.hidden = true;
    updateTip();
  };

  const setCurrent = (el: Element | null) => {
    current = el;
    placeHighlight();
  };

  const placePanel = () => {
    if (!editor || editor.movable.isMoved()) return;
    const p = editor.root;
    const el = editor.focusEl;
    if (el?.isConnected && editor.scope === 'element') {
      p.classList.remove('pf-ov-panel--view');
      const r = el.getBoundingClientRect();
      const vw = win?.innerWidth ?? 0;
      const vh = win?.innerHeight ?? 0;
      const top = Math.max(0, Math.min(r.bottom, vh - p.offsetHeight));
      const left = Math.max(0, Math.min(r.left, vw - p.offsetWidth));
      p.style.top = `${top}px`;
      p.style.left = `${left}px`;
    } else {
      p.classList.add('pf-ov-panel--view');
      p.style.top = '';
      p.style.left = '';
    }
  };

  const refocus = () => {
    placeHighlight();
    placePanel();
  };

  // --- Montaje / desmontaje -----------------------------------------------------

  const mount = () => {
    prevFocus = doc.activeElement;
    host = h(doc, 'div');
    host.setAttribute(HOST_ATTR, '');
    const shadow = host.attachShadow({ mode: SHADOW_MODE });
    injectStylesIntoShadowRoot(shadow, doc);
    layer = h(doc, 'div', 'pf-root pf-ov-layer');
    highlight = h(doc, 'div', 'pf-ov-highlight');
    highlight.hidden = true;
    highlightLabel = h(doc, 'span', 'pf-ov-label');
    highlight.appendChild(highlightLabel);
    tip = h(doc, 'div', 'pf-ov-tip');
    tip.hidden = true;
    live = h(doc, 'div', 'pf-ov-sr-only');
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');
    layer.append(highlight, tip, live);
    shadow.appendChild(layer);
    capture = createCaptureController({
      doc,
      layer,
      attach: attachShots,
      announce,
      onShotCard: (card) => opts.onShotCard?.(card),
    });
    // Los eventos de teclado escritos en el overlay no deben llegar a los handlers (burbuja) de la página.
    for (const t of ['keydown', 'keyup', 'keypress']) {
      listen(layer, t, (e) => e.stopPropagation());
    }
    doc.documentElement.appendChild(host);
  };


  const unmount = () => {
    for (const fn of cleanups) fn();
    cleanups = [];
    capture?.destroy(); // libera sus listeners de scroll/resize y quita la capa de captura
    capture = null;
    captureNodes = [];
    editor?.destroy(); // revierte las vistas previas aplicadas a la página
    editor = null;
    host?.remove();
    const restore = prevFocus;
    host = layer = highlight = highlightLabel = tip = live = toolbar = insertMark = hoverMark = null;
    extraMarks = [];
    current = null;
    hoverTarget = null;
    sel.clear();
    pendingBinding = null;
    draft = '';
    capturing = false;
    childStack = [];
    prevFocus = null;
    returnFocus = null;
    restoreFocus(restore);
  };

  const clearUi = () => {
    toolbar?.remove();
    toolbar = null;
    editor?.destroy();
    editor = null;
    for (const m of extraMarks) m.remove();
    extraMarks = [];
    insertMark?.remove();
    insertMark = null;
    hoverMark?.remove();
    hoverMark = null;
  };

  // --- Vistas por estado ------------------------------------------------------------

  /** Capa activa sin interceptar la página (solo modo `passive`). */
  const showIdle = () => {
    clearUi();
    sel.clear();
    draft = '';
    childStack = [];
    setCurrent(null);
    setState('IDLE');
  };

  const showSelecting = () => {
    clearUi();
    sel.clear();
    setCurrent(null);
    childStack = [];
    if (!layer) return;
    const bar = h(doc, 'div', 'pf-ov-toolbar');
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Perfect Front: selección');
    const hint = h(
      doc,
      'span',
      'pf-ov-hint',
      'Haz clic en un elemento. Flechas arriba/abajo: padre e hijo. Enter: elegir. Esc: salir.',
    );
    const viewBtn = h(doc, 'button', 'pf-btn', 'Comentar la vista');
    viewBtn.type = 'button';
    listen(viewBtn, 'click', () => {
      sel.clear();
      setCurrent(null);
      showEditing();
    });
    const exitBtn = h(doc, 'button', 'pf-btn', 'Salir');
    exitBtn.type = 'button';
    listen(exitBtn, 'click', () => (passive ? showIdle() : handle.disable()));
    bar.append(hint, viewBtn, exitBtn);
    layer.appendChild(bar);
    toolbar = bar;
    setState('SELECTING');
    announce('Modo selección activo. Elige un elemento o comenta la vista.');
  };

  /** Monta el editor v2 con la selección actual (vacía = toda la vista). */
  const showEditing = () => {
    clearUi();
    if (!layer) return;
    if (!returnFocus) {
      const a = doc.activeElement;
      returnFocus = a && !isPfNode(a) && a !== doc.body ? a : null;
    }
    const scope: Scope = sel.size > 0 ? 'element' : 'view';
    const my = session;
    current = null;
    const ed = createEditor({
      doc,
      layer,
      selection: sel,
      scope,
      draft,
      groups: opts.groups ?? null,
      openCode: opts.openCode ?? null,
      binding: pendingBinding,
      requestCapture: opts.onRequestCapture ? requestCapture : null,
      requestNodeCapture: () => void startCapture(),
      onSubmit: async (req) => {
        if (capturing) throw new Error('Espera a que termine la captura.');
        setState('SAVING');
        try {
          return await opts.onSubmit(req);
        } catch (err) {
          if (my === session && !destroyed) setState('ERROR');
          throw err;
        }
      },
      onSaved: (res) => {
        if (my !== session || destroyed) return;
        showSaved(res);
      },
      onClose: () => cancelEditing(),
      onPanelReset: () => placePanel(),
      onPick: (d) => {
        draft = d;
        showSelecting();
      },
      onFocusChange: refocus,
      announce,
    });
    pendingBinding = null;
    editor = ed;
    refocus();
    setState('EDITING');
    ed.root.querySelector<HTMLElement>('textarea')?.focus();
    announce(scope === 'element' ? 'Editando comentario del elemento.' : 'Editando comentario de la vista.');
  };

  const toBase = () => (passive ? showIdle() : showSelecting());

  const cancelEditing = () => {
    if (state !== 'EDITING' && state !== 'ERROR') return;
    draft = '';
    const f = returnFocus;
    returnFocus = null;
    toBase();
    if (passive) restoreFocus(f);
  };

  /**
   * Captura la vista y devuelve la imagen (o null si falló). No se oculta nada: la captura excluye los
   * nodos propios con el filtro isPfNode, así que no hay parpadeo.
   */
  const requestCapture = async (): Promise<ScreenshotUpload | null> => {
    if (!opts.onRequestCapture || capturing || (state !== 'EDITING' && state !== 'ERROR')) return null;
    const my = session;
    capturing = true;
    try {
      const shot = ScreenshotUploadSchema.parse(await opts.onRequestCapture());
      return my !== session ? null : shot;
    } catch {
      return null;
    } finally {
      if (my === session) capturing = false;
    }
  };

  // --- Captura de nodos (Alt+Mayús+S) -------------------------------------------------------

  /** Nodos a capturar: la selección del editor, o el nodo resaltado / bajo el cursor. */
  const captureTargets = (): Element[] => {
    const picked = editor ? editor.nodes.filter((n) => n.isConnected) : [];
    if (picked.length) return [...picked];
    const one = current ?? hoverTarget;
    return one?.isConnected && !isPfNode(one) ? [one] : [];
  };

  /** «Adjuntar N»: si aún no hay editor abre uno con los nodos capturados y deja que reciba las imágenes. */
  const attachShots = (shots: readonly CapturedShot[]): { added: number; error?: string } => {
    if (!editor) {
      const [first, ...rest] = captureNodes.filter((n) => n.isConnected);
      if (!first) return { added: 0, error: 'El nodo ya no está en la página.' };
      sel.set(first);
      for (const n of rest) sel.add(n);
      showEditing();
    }
    const port = editor as unknown as Partial<ShotAttachPort> | null;
    if (!port?.attachShots) return { added: 0, error: 'El editor todavía no admite adjuntar capturas.' };
    return port.attachShots(shots);
  };

  /** Alt+Mayús+S: captura rápida 1× sin panel (un render; se adjunta y se copia). */
  const quickCapture = (): boolean => {
    if (!capture || state === 'OFF' || state === 'SAVING') return false;
    const nodes = captureTargets();
    if (!nodes.length) {
      announce('Elige un nodo para capturarlo.');
      return false;
    }
    captureNodes = nodes;
    void capture.quick(nodes);
    return true;
  };

  const startCapture = (): boolean => {
    if (!capture || state === 'OFF' || state === 'SAVING') return false;
    const nodes = captureTargets();
    if (!nodes.length) {
      announce('Elige un nodo para capturarlo.');
      return false;
    }
    captureNodes = nodes;
    return capture.open(nodes);
  };

  const showSaved = (res: SubmitResult) => {
    clearUi();
    if (!layer) return;
    draft = '';
    setState('SAVED');
    // Sin panel intermedio: queda listo para elegir el siguiente elemento (Esc para salir).
    showSelecting();
    announce(`Comentario guardado (${res.id}). Elige otro elemento o pulsa Esc para salir.`);
    try {
      opts.onSaved?.(res);
    } catch {
      /* un callback del consumidor no debe romper el overlay */
    }
  };

  const closeSaved = () => {
    if (!passive) return handle.disable();
    const f = returnFocus;
    returnFocus = null;
    showIdle();
    restoreFocus(f);
  };

  // --- Eventos de la página ------------------------------------------------------------

  const moveCurrent = (el: Element | null) => {
    if (el) setCurrent(el);
  };

  const elementTarget = (e: Event): Element | null => {
    const t = e.target as Node | null;
    return t && t.nodeType === 1 ? (t as Element) : null;
  };

  const onMouseMove = (e: Event) => {
    if (isOwn(e)) return;
    const el = elementTarget(e);
    if (state === 'SELECTING') {
      if (el) {
        childStack = [];
        setCurrent(el);
      }
    } else if (state === 'IDLE' && el) {
      hoverTarget = el;
      if ((e as MouseEvent).altKey) {
        childStack = [];
        setCurrent(el);
      } else if (current) setCurrent(null);
    }
  };


  const onBlocked = (e: Event) => {
    if (state === 'OFF' || isOwn(e)) return;
    const me = e as MouseEvent;
    const mod = passive && me.altKey === true;
    const editing = state === 'EDITING' || state === 'ERROR';
    // En edición, Alt+clic (modo pasivo) o Shift+clic eligen/suman elementos; el clic normal es de la página.
    const picking = state === 'SELECTING' || (mod && (state === 'IDLE' || editing)) || (editing && me.shiftKey === true);
    if (!picking) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    const el = e.type === 'click' ? elementTarget(e) : null;
    if (!el) return;
    if (isCrossOriginFrame(el)) announce(CROSS_ORIGIN_MSG);
    if (editing) {
      editor?.pickElement(el, me.shiftKey === true);
      return;
    }
    sel.set(el);
    showEditing();
  };

  const inTree = (e: Event): boolean => {
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    return path.some((n) => (n as Element).getAttribute?.('role') === 'tree');
  };

  const typingInField = (e: Event): boolean => {
    const first = (typeof e.composedPath === 'function' ? e.composedPath()[0] : e.target) as Element | undefined;
    const tag = first?.localName;
    return (
      tag === 'textarea' || tag === 'input' || tag === 'select' || !!(first as HTMLElement | undefined)?.isContentEditable
    );
  };


  const onKeyUp = (e: Event) => {
    if ((e as KeyboardEvent).key === 'Alt' && state === 'IDLE' && current) setCurrent(null);
  };

  const onKeyDown = (e: Event) => {
    const k = e as KeyboardEvent;
    if (state === 'OFF' || isGripEvent(k)) return;
    const stop = () => {
      k.preventDefault();
      k.stopPropagation();
      k.stopImmediatePropagation();
    };
    // Con la captura abierta, Esc la cierra y el resto de teclas son suyas (no del editor).
    if (capture?.active) {
      if (k.key === 'Escape') {
        stop();
        capture.close();
      }
      return;
    }
    // Alt+Mayús+S: capturar el nodo seleccionado (code: en Mac Alt+Mayús+S no produce «s»).
    if (k.altKey && k.shiftKey && !k.ctrlKey && !k.metaKey && k.code === 'KeyS') {
      stop();
      quickCapture();
      return;
    }
    // Atajo de SPEC §9.5: Ctrl/Cmd+Mayús+C alterna el modo selección (clic normal = comentar).
    if (passive && (k.ctrlKey || k.metaKey) && k.shiftKey && (k.key === 'c' || k.key === 'C')) {
      if (state === 'IDLE' || state === 'SELECTING' || state === 'EDITING' || state === 'ERROR') {
        stop();
        toggleSelecting();
      }
      return;
    }
    if (state === 'IDLE') {
      if (k.key === 'Alt' && hoverTarget?.isConnected) setCurrent(hoverTarget);
      return;
    }
    if (editor) {
      // Editor v2: Esc, Ctrl/Cmd+Enter y flechas las interpreta el editor; en SAVING no se atiende nada.
      if (state === 'SAVING') return;
      // El árbol de «Capas» usa las flechas para moverse entre filas (no para navegar el DOM).
      if (/^(Arrow|Home$|End$)/.test(k.key) && !k.altKey && inTree(e)) return;
      if (editor.handleKey(k, { own: isOwn(e), typing: typingInField(e) })) stop();
      return;
    }
    if (k.key === 'Escape') {
      if (state === 'SAVING') return;
      stop();
      if (state === 'SELECTING') {
        if (passive) showIdle();
        else handle.disable();
      } else if (state === 'SAVED') closeSaved();
      return;
    }
    if (state !== 'SELECTING' || isOwn(e)) return;
    if (k.key === 'ArrowUp') {
      stop();
      const base = current ?? doc.body;
      const parent = base?.parentElement;
      if (base && parent && parent !== doc.documentElement) {
        childStack.push(base);
        moveCurrent(parent);
      } else if (!current && base) moveCurrent(base);
    } else if (k.key === 'ArrowDown') {
      stop();
      if (!current) return moveCurrent(doc.body);
      const back = childStack.pop();
      const child = back && current.contains(back) && back !== current ? back : null;
      const next = child
        ? Array.from(current.children).find((c) => c === child || c.contains(child))
        : Array.from(current.children).find((c) => c !== host);
      moveCurrent(next ?? null);
    } else if (k.key === 'Enter' || k.key === ' ') {
      stop();
      if (current) {
        sel.set(current);
        showEditing();
      }
    }
  };

  const toggleSelecting = () => {
    if (!passive) return;
    if (state === 'IDLE') showSelecting();
    else if (state === 'SELECTING') showIdle();
    else if (state === 'EDITING' || state === 'ERROR') {
      if (editor) draft = editor.draft;
      showSelecting();
    }
  };

  const enable = () => {
    if (destroyed || state !== 'OFF') return;
    session++;
    mount();
    listen(doc, 'mousemove', onMouseMove, true);
    for (const t of BLOCKED_EVENTS) listen(doc, t, onBlocked, true);
    listen(doc, 'keydown', onKeyDown, true);
    if (passive) listen(doc, 'keyup', onKeyUp, true);
    listen(doc, 'scroll', refocus, true);
    if (win) listen(win, 'resize', refocus);
    if (passive) showIdle();
    else showSelecting();
  };

  const handle: OverlayHandle = {
    enable,
    disable() {
      if (state === 'OFF') return;
      session++;
      unmount();
      setState('OFF');
    },
    toggleSelecting,
    captureSelectedNodes: startCapture,
    startInGroup(groupId) {
      if (state === 'OFF' || state === 'EDITING' || state === 'SAVING' || state === 'ERROR') return;
      pendingBinding = { groupId, afterId: null };
      if (state === 'IDLE') showSelecting();
    },
    destroy() {
      destroyed = true;
      handle.disable();
    },
    get state() {
      return state;
    },
  };

  return handle;
}
