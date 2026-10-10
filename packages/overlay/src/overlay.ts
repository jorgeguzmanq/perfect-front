import { CreateCommentRequestSchema, LIMITS, ScreenshotUploadSchema } from '@perfect-front/shared';
import { HOST_ATTR, isPfNode } from './constants';
import { buildRequest, snapshotElement, type ElementSnapshot } from './context';
import { icon, type IconName } from './icons';
import { reactComponents } from './react';
import { injectStylesIntoShadowRoot } from './styles';
import type { OverlayHandle, OverlayOptions, OverlayState, ScreenshotUpload, SubmitResult } from './types';

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

function h<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function describe(el: Element): string {
  const id = el.getAttribute('id');
  const cls = (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean).slice(0, 2);
  return el.localName + (id ? `#${id}` : '') + cls.map((c) => `.${c}`).join('');
}

type Tab = 'comment' | 'levels';
type Scope = 'element' | 'view';

interface Panel {
  root: HTMLElement;
  textarea: HTMLTextAreaElement;
  error: HTMLElement;
  save: HTMLButtonElement;
  cancel: HTMLButtonElement;
  capture: HTMLButtonElement | null;
  captureInfo: HTMLElement | null;
  shotBox: HTMLInputElement | null;
  chip: HTMLElement;
  src: HTMLElement;
  name: HTMLElement;
  chain: HTMLElement;
  up: HTMLButtonElement;
  down: HTMLButtonElement;
  tabComment: HTMLButtonElement;
  tabLevels: HTMLButtonElement;
  levelsBadge: HTMLElement;
  paneComment: HTMLElement;
  paneLevels: HTMLElement;
  levelsList: HTMLElement;
  segElement: HTMLButtonElement;
  segView: HTMLButtonElement;
  footChip: HTMLElement;
  footPath: HTMLElement;
}

const fileLabel = (src: string) => src.replace(/^.*[\\/]/, '');

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
  let panel: Panel | null = null;
  let savedPanel: HTMLElement | null = null;

  let current: Element | null = null;
  let childStack: Element[] = [];
  let snap: ElementSnapshot | null = null;
  let scope: Scope = 'element';
  let tab: Tab = 'comment';
  let draft = '';
  let screenshot: ScreenshotUpload | null = null;
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

  const placeHighlight = () => {
    if (!highlight || !highlightLabel) return;
    if (!current || !current.isConnected) {
      highlight.hidden = true;
      updateTip();
      return;
    }
    const r = current.getBoundingClientRect();
    highlight.hidden = false;
    highlight.style.top = `${r.top}px`;
    highlight.style.left = `${r.left}px`;
    highlight.style.width = `${r.width}px`;
    highlight.style.height = `${r.height}px`;
    highlightLabel.textContent = describe(current);
    updateTip();
  };

  const setCurrent = (el: Element | null) => {
    current = el;
    placeHighlight();
  };

  const placePanel = () => {
    if (!panel) return;
    const p = panel.root;
    if (snap && scope === 'element' && current?.isConnected) {
      p.classList.remove('pf-ov-panel--view');
      const r = current.getBoundingClientRect();
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
    // Los eventos de teclado escritos en el overlay no deben llegar a los handlers (burbuja) de la página.
    for (const t of ['keydown', 'keyup', 'keypress']) {
      listen(layer, t, (e) => e.stopPropagation());
    }
    doc.documentElement.appendChild(host);
  };

  const unmount = () => {
    for (const fn of cleanups) fn();
    cleanups = [];
    host?.remove();
    const restore = prevFocus;
    host = layer = highlight = highlightLabel = tip = live = toolbar = savedPanel = null;
    panel = null;
    current = null;
    hoverTarget = null;
    snap = null;
    scope = 'element';
    tab = 'comment';
    draft = '';
    screenshot = null;
    capturing = false;
    childStack = [];
    prevFocus = null;
    returnFocus = null;
    restoreFocus(restore);
  };

  const clearUi = () => {
    toolbar?.remove();
    toolbar = null;
    panel?.root.remove();
    panel = null;
    savedPanel?.remove();
    savedPanel = null;
  };

  // --- Vistas por estado ------------------------------------------------------------

  /** Capa activa sin interceptar la página (solo modo `passive`). */
  const showIdle = () => {
    clearUi();
    snap = null;
    scope = 'element';
    draft = '';
    screenshot = null;
    childStack = [];
    setCurrent(null);
    setState('IDLE');
  };

  const showSelecting = () => {
    clearUi();
    snap = null;
    scope = 'element';
    screenshot = null;
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
      snap = null;
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

  const setError = (msg: string) => {
    if (!panel) return;
    panel.error.textContent = msg;
    panel.textarea.setAttribute('aria-invalid', msg ? 'true' : 'false');
    if (msg) announce(msg);
  };

  const setBusy = (busy: boolean) => {
    if (!panel) return;
    panel.textarea.disabled = busy;
    panel.save.disabled = busy;
    panel.root.querySelectorAll<HTMLButtonElement>('[data-pf-remove]').forEach((b) => (b.disabled = busy));
    panel.cancel.disabled = busy;
    if (panel.capture) panel.capture.disabled = busy;
    if (panel.shotBox) panel.shotBox.disabled = busy;
    panel.root.setAttribute('aria-busy', busy ? 'true' : 'false');
  };

  // --- Contexto del panel (cabecera, título, ruta, niveles) ---------------------------

  const firstChild = (el: Element): Element | null => Array.from(el.children).find((c) => !isPfNode(c)) ?? null;

  const parentOf = (el: Element | null): Element | null => {
    const p = el?.parentElement ?? null;
    return p && p !== doc.documentElement ? p : null;
  };

  const ancestorsOf = (el: Element): Element[] => {
    const out: Element[] = [];
    for (let c: Element | null = el; c && c !== doc.documentElement; c = c.parentElement) out.unshift(c);
    return out;
  };

  const renderContext = () => {
    const p = panel;
    if (!p) return;
    const el = snap && current ? current : null;
    const isElement = scope === 'element' && el !== null;
    const route = doc.location.pathname || '/';
    const comps = snap?.components ?? null;

    p.chip.textContent = isElement ? el.localName : 'vista';
    const srcText = isElement ? (snap!.src ? fileLabel(snap!.src) : snap!.selector) : route;
    p.src.textContent = srcText;
    p.src.title = isElement && snap!.src ? snap!.src : srcText;
    p.name.textContent = isElement ? (comps?.[0] ?? describe(el)) : 'Toda la vista';
    p.chain.textContent = isElement && comps && comps.length > 1 ? `en ${comps.slice(1).join(' < ')}` : '';
    p.chain.hidden = !p.chain.textContent;

    p.up.disabled = !el || !parentOf(el);
    p.down.disabled = !el || !firstChild(el);

    p.segElement.disabled = !snap;
    p.segElement.setAttribute('aria-pressed', String(isElement));
    p.segView.setAttribute('aria-pressed', String(!isElement));

    p.footChip.textContent = p.chip.textContent;
    const chainPath = isElement
      ? (comps?.join(' < ') ??
        ancestorsOf(el)
          .slice(-4)
          .map((n) => n.localName)
          .join(' > '))
      : '';
    p.footPath.textContent = [route, chainPath].filter(Boolean).join(' · ');

    // Niveles (solo lectura): ancestros del elemento, navegables.
    p.levelsList.textContent = '';
    if (!el) {
      p.levelsBadge.textContent = '0';
      p.levelsList.appendChild(h(doc, 'li', 'pf-ov-hint', 'Sin elemento seleccionado.'));
      return;
    }
    const chain = ancestorsOf(el);
    p.levelsBadge.textContent = String(chain.length);
    chain.forEach((n, i) => {
      const li = h(doc, 'li');
      const b = h(doc, 'button', 'pf-ov-level');
      b.type = 'button';
      b.style.paddingInlineStart = `calc(var(--pf-space-2) + ${Math.min(i, 12)} * var(--pf-space-2))`;
      const comp = reactComponents(n)?.[0];
      b.textContent = comp ? `${describe(n)} · ${comp}` : describe(n);
      if (n === el) b.setAttribute('aria-current', 'true');
      listen(b, 'click', () => {
        if (n !== current) selectElement(n, false);
        p.levelsList.querySelector<HTMLElement>('[aria-current="true"]')?.focus();
      });
      li.appendChild(b);
      p.levelsList.appendChild(li);
    });
  };

  const setTab = (t: Tab) => {
    tab = t;
    const p = panel;
    if (!p) return;
    p.paneComment.hidden = t !== 'comment';
    p.paneLevels.hidden = t !== 'levels';
    for (const [b, name] of [
      [p.tabComment, 'comment'],
      [p.tabLevels, 'levels'],
    ] as const) {
      b.setAttribute('aria-selected', String(t === name));
      b.tabIndex = t === name ? 0 : -1;
      b.classList.toggle('pf-ov-tab--on', t === name);
    }
  };

  const setScope = (s: Scope) => {
    if (s === 'element' && !snap) return;
    scope = s;
    renderContext();
    placePanel();
    announce(s === 'element' ? 'Comentario sobre este elemento.' : 'Comentario sobre toda la vista.');
  };

  /** Selecciona un elemento (flechas, niveles o Alt+clic) conservando el borrador. */
  const selectElement = (el: Element, keepStack: boolean) => {
    if (keepStack) {
      if (current && current !== el) childStack.push(current);
    } else childStack = [];
    current = el;
    snap = snapshotElement(el);
    scope = 'element';
    placeHighlight();
    renderContext();
    placePanel();
    announce(`Elemento seleccionado: ${panel?.name.textContent ?? describe(el)}.`);
  };

  const goParent = () => {
    const parent = parentOf(current);
    if (current && parent) selectElement(parent, true);
  };

  const goChild = () => {
    if (!current) return;
    const back = childStack.pop();
    const viaStack =
      back && current.contains(back) && back !== current
        ? Array.from(current.children).find((c) => c === back || c.contains(back))
        : undefined;
    const next = viaStack ?? firstChild(current);
    if (!next) return;
    current = next;
    snap = snapshotElement(next);
    scope = 'element';
    placeHighlight();
    renderContext();
    placePanel();
    announce(`Elemento seleccionado: ${panel?.name.textContent ?? describe(next)}.`);
  };

  const iconBtn = (label: string, name: IconName, onClick: () => void) => {
    const b = h(doc, 'button', 'pf-ov-iconbtn');
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.title = label;
    b.appendChild(icon(doc, name));
    listen(b, 'click', onClick);
    return b;
  };

  const showEditing = () => {
    clearUi();
    if (!layer) return;
    if (!snap) scope = 'view';
    if (!returnFocus) {
      const a = doc.activeElement;
      returnFocus = a && !isPfNode(a) && a !== doc.body ? a : null;
    }
    const root = h(doc, 'div', 'pf-ov-panel');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'false');
    root.setAttribute('aria-labelledby', 'pf-ov-title');

    // Cabecera: etiqueta, archivo:línea (o selector), padre/hijo, selección, borrar, cerrar.
    const chip = h(doc, 'span', 'pf-chip pf-chip--in_progress pf-ov-tag');
    const src = h(doc, 'span', 'pf-ov-code pf-ov-src');
    const up = iconBtn('Elemento padre (flecha arriba)', 'up', () => goParent());
    const down = iconBtn('Elemento hijo (flecha abajo)', 'down', () => goChild());
    const pickBtn = iconBtn('Elegir otro elemento', 'select', () => {
      if (panel) draft = panel.textarea.value;
      showSelecting();
    });
    const clearBtn = iconBtn('Borrar el borrador', 'trash', () => {
      if (!panel) return;
      panel.textarea.value = '';
      draft = '';
      screenshot = null;
      if (panel.shotBox) panel.shotBox.checked = false;
      if (panel.captureInfo) panel.captureInfo.textContent = '';
      setError('');
      panel.textarea.focus();
      announce('Borrador borrado.');
    });
    const closeBtn = iconBtn('Cerrar (Esc)', 'close', () => cancelEditing());
    const tools = h(doc, 'div', 'pf-ov-tools');
    tools.append(up, down, pickBtn, clearBtn, closeBtn);
    const head = h(doc, 'div', 'pf-ov-head');
    head.append(chip, src, tools);

    const name = h(doc, 'h2', 'pf-ov-title');
    name.id = 'pf-ov-title';
    const chain = h(doc, 'p', 'pf-ov-chain');
    const titleRow = h(doc, 'div', 'pf-ov-titlerow');
    titleRow.append(name, chain);

    // Pestañas (Diseño y Contenido quedan para una iteración posterior).
    const tabs = h(doc, 'div', 'pf-ov-tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Secciones del panel');
    const mkTab = (id: string, label: string, ic: IconName) => {
      const b = h(doc, 'button', 'pf-ov-tab');
      b.type = 'button';
      b.id = id;
      b.setAttribute('role', 'tab');
      b.append(icon(doc, ic), h(doc, 'span', undefined, label));
      return b;
    };
    const tabLevels = mkTab('pf-ov-tab-levels', 'Niveles', 'layers');
    const levelsBadge = h(doc, 'span', 'pf-ov-badge', '0');
    tabLevels.appendChild(levelsBadge);
    const tabComment = mkTab('pf-ov-tab-comment', 'Comentar', 'comment');
    tabs.append(tabLevels, tabComment);
    tabLevels.setAttribute('aria-controls', 'pf-ov-pane-levels');
    tabComment.setAttribute('aria-controls', 'pf-ov-pane-comment');
    listen(tabLevels, 'click', () => setTab('levels'));
    listen(tabComment, 'click', () => setTab('comment'));
    listen(tabs, 'keydown', (e) => {
      const k = (e as KeyboardEvent).key;
      if (k !== 'ArrowLeft' && k !== 'ArrowRight' && k !== 'Home' && k !== 'End') return;
      e.preventDefault();
      const next: Tab = tab === 'comment' ? 'levels' : 'comment';
      setTab(next);
      (next === 'comment' ? tabComment : tabLevels).focus();
    });

    // Pestaña Comentar.
    const paneComment = h(doc, 'div', 'pf-ov-pane');
    paneComment.id = 'pf-ov-pane-comment';
    paneComment.setAttribute('role', 'tabpanel');
    paneComment.setAttribute('aria-labelledby', 'pf-ov-tab-comment');

    const seg = h(doc, 'div', 'pf-ov-seg');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Alcance del comentario');
    const segElement = h(doc, 'button', 'pf-ov-segbtn', 'Este elemento');
    segElement.type = 'button';
    const segView = h(doc, 'button', 'pf-ov-segbtn', 'Toda la vista');
    segView.type = 'button';
    listen(segElement, 'click', () => setScope('element'));
    listen(segView, 'click', () => setScope('view'));
    seg.append(segElement, segView);

    const field = h(doc, 'div', 'pf-ov-field');
    const label = h(doc, 'label', 'pf-ov-sr-only', 'Comentario');
    label.htmlFor = 'pf-ov-comment';
    const textarea = h(doc, 'textarea', 'pf-input pf-ov-textarea');
    textarea.id = 'pf-ov-comment';
    textarea.required = true;
    textarea.maxLength = LIMITS.comment;
    textarea.rows = 5;
    textarea.placeholder = 'Qué habría que cambiar acá…';
    textarea.value = draft;
    textarea.setAttribute('aria-describedby', 'pf-ov-hint pf-ov-error');
    listen(textarea, 'input', () => (draft = textarea.value));
    const hint = h(doc, 'p', 'pf-ov-hint', 'Ctrl/Cmd + Enter para guardar. Esc para cancelar.');
    hint.id = 'pf-ov-hint';
    field.append(label, textarea, hint);

    const error = h(doc, 'p', 'pf-ov-error');
    error.id = 'pf-ov-error';
    error.setAttribute('role', 'alert');

    const foot = h(doc, 'p', 'pf-ov-foot');
    const footChip = h(doc, 'span', 'pf-chip pf-chip--in_progress pf-ov-tag');
    const footPath = h(doc, 'span', 'pf-ov-path');
    foot.append(footChip, footPath);

    const actions = h(doc, 'div', 'pf-ov-actions');
    let capture: HTMLButtonElement | null = null;
    let captureInfo: HTMLElement | null = null;
    let shotBox: HTMLInputElement | null = null;
    let shotRow: HTMLElement | null = null;
    if (opts.onRequestCapture && passive) {
      shotRow = h(doc, 'label', 'pf-ov-check');
      shotBox = h(doc, 'input');
      shotBox.type = 'checkbox';
      shotBox.id = 'pf-ov-shot';
      shotRow.append(shotBox, h(doc, 'span', undefined, 'Incluir captura'));
    } else if (opts.onRequestCapture) {
      capture = h(doc, 'button', 'pf-btn', 'Adjuntar captura');
      capture.type = 'button';
      captureInfo = h(doc, 'p', 'pf-ov-hint');
      captureInfo.setAttribute('role', 'status');
      listen(capture, 'click', () => void requestCapture());
    }
    const cancel = h(doc, 'button', 'pf-btn', 'Cancelar');
    cancel.type = 'button';
    listen(cancel, 'click', () => cancelEditing());
    const save = h(doc, 'button', 'pf-btn pf-btn--primary', 'Guardar');
    save.type = 'button';
    listen(save, 'click', () => void submit());
    const remove = h(doc, 'button', 'pf-btn', 'Eliminar elemento');
    remove.type = 'button';
    remove.setAttribute('data-pf-remove', '');
    remove.title = 'Guarda un comentario pidiendo eliminar este elemento (la nota es opcional)';
    listen(remove, 'click', () => void submit(true));
    if (capture) actions.appendChild(capture);
    actions.append(cancel, remove, save);

    paneComment.append(seg, field, error);
    if (captureInfo) paneComment.appendChild(captureInfo);
    if (shotRow) paneComment.appendChild(shotRow);
    paneComment.append(foot, actions);

    // Pestaña Niveles (solo lectura).
    const paneLevels = h(doc, 'div', 'pf-ov-pane');
    paneLevels.id = 'pf-ov-pane-levels';
    paneLevels.setAttribute('role', 'tabpanel');
    paneLevels.setAttribute('aria-labelledby', 'pf-ov-tab-levels');
    const levelsList = h(doc, 'ul', 'pf-ov-levels');
    levelsList.setAttribute('aria-label', 'Ancestros del elemento');
    paneLevels.appendChild(levelsList);

    root.append(head, titleRow, tabs, paneComment, paneLevels);
    layer.appendChild(root);
    panel = {
      root,
      textarea,
      error,
      save,
      cancel,
      capture,
      captureInfo,
      shotBox,
      chip,
      src,
      name,
      chain,
      up,
      down,
      tabComment,
      tabLevels,
      levelsBadge,
      paneComment,
      paneLevels,
      levelsList,
      segElement,
      segView,
      footChip,
      footPath,
    };
    renderContext();
    setTab('comment');
    placePanel();
    setState('EDITING');
    textarea.focus();
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

  /** Oculta el host, captura y lo vuelve a mostrar. Devuelve la captura o null si falló. */
  const captureNow = async (p: Panel): Promise<ScreenshotUpload | null> => {
    const my = session;
    capturing = true;
    // El overlay se oculta durante la captura para no contaminarla.
    if (host) host.style.visibility = 'hidden';
    try {
      const shot = ScreenshotUploadSchema.parse(await opts.onRequestCapture!());
      return my !== session || panel !== p ? null : shot;
    } catch {
      return null;
    } finally {
      if (my === session) {
        capturing = false;
        if (host) host.style.visibility = '';
      }
    }
  };

  const requestCapture = async () => {
    if (!opts.onRequestCapture || !panel || capturing || (state !== 'EDITING' && state !== 'ERROR')) return;
    const p = panel;
    const my = session;
    if (p.capture) p.capture.disabled = true;
    const shot = await captureNow(p);
    if (my !== session || panel !== p) return;
    if (shot) {
      screenshot = shot;
      if (p.captureInfo) p.captureInfo.textContent = 'Captura adjunta.';
      announce('Captura adjunta.');
    } else {
      screenshot = null;
      setError('No se pudo capturar la pantalla. Puedes guardar sin captura.');
    }
    if (p.capture) p.capture.disabled = (state as OverlayState) === 'SAVING';
  };

  const REMOVE_PREFIX = 'Eliminar este elemento.';

  const submit = async (remove = false) => {
    if ((state !== 'EDITING' && state !== 'ERROR') || !panel || capturing) return;
    const p = panel;
    if (remove && (scope !== 'element' || !snap)) {
      setError('Elige un elemento para marcarlo como eliminar.');
      return;
    }
    const note = p.textarea.value.trim();
    const text = remove ? (note ? `${REMOVE_PREFIX} ${note}` : REMOVE_PREFIX) : note;
    if (!text) {
      setError('Escribe un comentario antes de guardar.');
      p.textarea.focus();
      return;
    }
    const my = session;
    if (p.shotBox) {
      if (p.shotBox.checked && opts.onRequestCapture) {
        setError('');
        setBusy(true);
        announce('Capturando la pantalla…');
        const shot = await captureNow(p);
        if (my !== session || destroyed || panel !== p) return;
        setBusy(false);
        if (!shot) {
          p.shotBox.checked = false;
          setError(
            'No se pudo capturar la pantalla. Se desmarcó «Incluir captura»; vuelve a guardar para enviarlo sin ella.',
          );
          p.save.focus();
          return;
        }
        screenshot = shot;
      } else screenshot = null;
    }
    const raw = buildRequest(doc, text, scope === 'element' ? snap : null) as Record<string, unknown>;
    if (screenshot) raw.screenshot = screenshot;
    const parsed = CreateCommentRequestSchema.safeParse(raw);
    if (!parsed.success) {
      setState('ERROR');
      setError(`El comentario no es válido: ${parsed.error.issues[0]?.message ?? 'datos incorrectos'}.`);
      return;
    }
    setError('');
    setState('SAVING');
    setBusy(true);
    announce('Guardando comentario…');
    try {
      const res = await opts.onSubmit(parsed.data);
      if (my !== session || destroyed) return;
      showSaved(res);
    } catch (err) {
      if (my !== session || destroyed || panel !== p) return;
      setState('ERROR');
      setBusy(false);
      const detail = err instanceof Error && err.message ? ` ${err.message}` : '';
      setError(`No se pudo guardar.${detail} Tu comentario se conservó; inténtalo de nuevo.`);
      p.textarea.focus();
    }
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
    const mod = passive && (e as MouseEvent).altKey === true;
    const editing = state === 'EDITING' || state === 'ERROR';
    const picking = state === 'SELECTING' || (mod && (state === 'IDLE' || editing));
    if (!picking) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    const el = e.type === 'click' ? elementTarget(e) : null;
    if (!el) return;
    if (editing) {
      selectElement(el, false);
      return;
    }
    setCurrent(el);
    snap = snapshotElement(el);
    scope = 'element';
    showEditing();
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
    if (state === 'OFF') return;
    const stop = () => {
      k.preventDefault();
      k.stopPropagation();
      k.stopImmediatePropagation();
    };
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
    if (k.key === 'Escape') {
      if (state === 'SAVING') return;
      stop();
      if (state === 'SELECTING') {
        if (passive) showIdle();
        else handle.disable();
      } else if (state === 'SAVED') closeSaved();
      else cancelEditing();
      return;
    }
    if (k.key === 'Enter' && (k.ctrlKey || k.metaKey) && (state === 'EDITING' || state === 'ERROR')) {
      stop();
      void submit();
      return;
    }
    if ((state === 'EDITING' || state === 'ERROR') && (k.key === 'ArrowUp' || k.key === 'ArrowDown')) {
      if (k.altKey || (isOwn(e) && !typingInField(e))) {
        stop();
        if (k.key === 'ArrowUp') goParent();
        else goChild();
      }
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
        snap = snapshotElement(current);
        scope = 'element';
        showEditing();
      }
    }
  };

  const toggleSelecting = () => {
    if (!passive) return;
    if (state === 'IDLE') showSelecting();
    else if (state === 'SELECTING') showIdle();
    else if (state === 'EDITING' || state === 'ERROR') {
      if (panel) draft = panel.textarea.value;
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
    listen(doc, 'scroll', () => (placeHighlight(), placePanel()), true);
    if (win) listen(win, 'resize', () => (placeHighlight(), placePanel()));
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
