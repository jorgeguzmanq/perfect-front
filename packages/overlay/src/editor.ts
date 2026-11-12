import { proposalsToComment, type CommentId, type CommentProposal, type CreateCommentRequest, type GroupId } from '@perfect-front/shared';
import { Attachments, bindImageDrop, bindImagePaste } from './attachments';
import { ContentEditor, detectContent } from './content-edit';
import { chip as dkChip, key as dkKey, kb as dkKb, led as dkLed, tagk as dkTagk, warn as dkWarn } from './deck';
import { describe, fileLabel, h } from './dom';
import type { Movable } from './drag-panel';
import { makeFloating, type Floating } from './floating';
import { navAvailability, navTarget, siblingPos, type NavDir } from './dom-nav';
import { VIEW_TITLE, type EditorCtx, type GroupsPort, type NodeEdits, type PanelView, type Region, type Scope } from './editor-ctx';
import { renderLayers } from './layers';
import { NO_SOURCE, OPEN_LABEL, openInCode, targetFromSrc, type OpenApi } from './open-code';
import { inspectFor, renderComment, renderContent, renderQueue, renderStruct, renderStyles } from './editor-tabs';
import { bindingStep, groupRefForCreate, needsReorder, orderWithInserted, queueFor, type GroupBinding } from './groups';
import { icon, type IconName } from './icons';
import { interpretEditorKey, type KeyLike } from './keymap';
import { fullReference, writeClipboard } from './location-copy';
import { buildRequestV2 } from './payload';
import { Sections } from './sections';
import { generateSelectorCandidates } from './selector';
import type { Selection } from './selection';
import { StyleEditor, type StyleInspection, type StyleRow } from './style-edit';
import type { CapturedShot, ScreenshotUpload, SubmitResult } from './types';

/**
 * Editor v2 como PILA DE VISTAS (divulgación progresiva, una cosa a la vez): la base «Comentar» (identidad,
 * alcance, nota, imágenes, «Incluye», pie) y, encima, una subvista por vez (Texto · Estilos · Orden · Grupo ·
 * Capas) que se abre desde un chip «Proponer», desde «Incluye» o desde el menú «⋯». Qué aparece y cuándo lo
 * fija el mapa del diseño (capa 00): lo que cambia el contexto va fuera de las vistas; lo que no aplica se oculta
 * (ruido) o se apaga; lo raro va en el menú «⋯»; lo ya incluido se resume en «Incluye».
 *
 * Es un controlador independiente del overlay: quien lo orquesta le da la selección, recibe los cambios de foco y
 * delega el teclado. No toca el código del proyecto observado: todo lo que cambia es vista previa reversible.
 */

export interface EditorOptions {
  doc: Document;
  /** Contenedor (capa del Shadow Root) donde se monta el panel. */
  layer: HTMLElement;
  selection: Selection;
  scope: Scope;
  /** Borrador previo (al volver de «Elegir otro»). */
  draft?: string;
  groups?: GroupsPort | null;
  /** «Abrir en el código» (↗ en la cabecera). Sin esto no se muestra el botón. */
  openCode?: OpenApi | null;
  /** Grupo preseleccionado (p. ej. «Añadir» desde el cajón). */
  binding?: GroupBinding | null;
  /** Captura de la página (el llamador oculta el overlay mientras tanto). null = falló. */
  requestCapture?: (() => Promise<ScreenshotUpload | null>) | null;
  /** Abre la captura de nodos con escalas (Alt+Mayús+S). Sin él no se muestra el menú «Capturar». */
  requestNodeCapture?: (() => void) | null;
  onSubmit(req: CreateCommentRequest): Promise<SubmitResult>;
  onSaved?(res: SubmitResult): void;
  /** Cerrar/cancelar (Esc, «Cancelar», X). */
  onClose(): void;
  /** «Elegir otro elemento»: vuelve al modo selección conservando el borrador. */
  onPick(draft: string): void;
  /** El foco o la selección cambió: reposicionar resaltado y panel. */
  onFocusChange(): void;
  /** El panel volvió a su colocación automática (Inicio / doble clic en la cabecera): hay que recolocarlo. */
  onPanelReset?(): void;
  announce(msg: string): void;
}

export interface EditorHandle {
  readonly root: HTMLElement;
  /** Movimiento manual del panel (arrastre/teclado en la cabecera). */
  readonly movable: Movable;
  readonly selection: Selection;
  readonly scope: Scope;
  readonly draft: string;
  /** Elemento enfocado (para resaltado). */
  readonly focusEl: Element | null;
  /** Nodo resaltado desde la vista Capas (sin seleccionar). */
  readonly hoverEl: Element | null;
  /** Nodos seleccionados (para resaltar todos). */
  readonly nodes: readonly Element[];
  /** Línea de inserción de la propuesta de reordenar, para dibujarla en la página. */
  reorderIndicator(): { el: Element; side: 'before' | 'after' } | null;
  /** Clic en la página: sin `additive` reemplaza la selección; con Shift (o «Sumar» activo) suma/quita. */
  pickElement(el: Element, additive: boolean): void;
  setScope(s: Scope): void;
  /** Vista abierta de la pila ('comment' = base). */
  readonly view: PanelView;
  /** Teclado delegado por el overlay. Devuelve true si lo consumió. */
  handleKey(e: KeyLike, info: { own: boolean; typing: boolean }): boolean;
  save(): void;
  /** Suma capturas de nodo como adjuntos (source 'capture'); respeta el tope de 20 y la sección activa. */
  attachShots(shots: readonly CapturedShot[]): { added: number; error?: string };
  setBusy(b: boolean): void;
  destroy(): void;
}

export function createEditor(opts: EditorOptions): EditorHandle {
  const doc = opts.doc;
  const sel = opts.selection;
  let scope: Scope = opts.scope;
  let view: PanelView = 'comment';
  /** El navegador ↑↓←→ se muestra como fila delgada solo mientras se navega. */
  let navActive = false;
  let menuOpen = false;
  let destroyed = false;
  let addMode = false;
  let hoverEl: Element | null = null;
  let childStack: Element[] = [];
  const edits = new Map<Element, NodeEdits>();
  const inspections = new WeakMap<Element, StyleInspection>();
  let bodyCleanups: Array<() => void> = [];
  const cleanups: Array<() => void> = [];
  const onc = (t: EventTarget, type: string, fn: (e: Event) => void) => {
    t.addEventListener(type, fn);
    cleanups.push(() => t.removeEventListener(type, fn));
  };

  const att = new Attachments({ onChange: () => undefined });
  const sections = new Sections();

  /** Sección (dropzone) desde la que se pidió la última captura de nodo; null = suelta. */
  let captureSection: string | null = null;

  // --- Contexto compartido -----------------------------------------------------------------

  const ctx: EditorCtx = {
    doc,
    sel,
    get scope() {
      return scope;
    },
    set scope(s: Scope) {
      scope = s;
    },
    get view() {
      return view;
    },
    draft: opts.draft ?? '',
    busy: false,
    error: '',
    imgError: '',
    dragging: false,
    lang: '',
    fndOpen: false,
    styleMode: 'visual',
    styleOpen: {},
    att,
    sections,
    groupsPort: opts.groups ?? null,
    binding: opts.binding ?? null,
    canCapture: !!opts.requestCapture,
    edits: () => editsFor(sel.focus?.el ?? null),
    allEdits: () => Array.from(edits.values()),
    autoText: () => proposalsToComment(collectProposals().proposals),
    autoMerged: false,
    rerender: (...regions: Region[]) => {
      for (const r of new Set(regions)) paint(r);
    },
    setView: (v) => setView(v),
    available: (v) => viewAvailable(v),
    announce: (m) => opts.announce(m),
    on: (target, type, fn) => {
      target.addEventListener(type, fn);
      bodyCleanups.push(() => target.removeEventListener(type, fn));
    },
    addImages,
    captureImage,
    captureNodes: opts.requestNodeCapture
      ? (sectionId) => {
          captureSection = sectionId;
          opts.requestNodeCapture?.();
        }
      : null,
    navigate,
    retarget,
    focusNode,
    pick: (el, additive) => handle.pickElement(el, additive),
    hover: (el) => {
      if (hoverEl === el) return;
      hoverEl = el;
      opts.onFocusChange();
    },
    save: () => void save(),
  };

  function editsFor(el: Element | null): NodeEdits | null {
    if (!el || scope === 'view') return null;
    let e = edits.get(el);
    if (!e) {
      const node = sel.nodes.find((n) => n.el === el);
      e = { el, selector: node?.snap.selector ?? describe(el) };
      edits.set(el, e);
    }
    if (!e.contentChecked) {
      const info = detectContent(el);
      e.content = info ? new ContentEditor(el, info) : null;
      e.contentChecked = true;
    }
    return e;
  }

  const flatRows = (ins: StyleInspection): StyleRow[] => ins.groups.flatMap((g) => g.rows);

  function ensureStyles(e: NodeEdits): StyleInspection {
    let ins = inspections.get(e.el);
    if (!ins) {
      ins = inspectFor(e.el);
      inspections.set(e.el, ins);
    }
    if (!e.style) {
      e.style = new StyleEditor(flatRows(ins), () => ({ focus: e.el, all: sel.nodes.map((n) => n.el) }));
    }
    return ins;
  }

  // --- Totales para «Incluye» y los chips ------------------------------------------------------

  const contentCount = () => ctx.allEdits().reduce((a, e) => a + (e.content?.changeCount ?? 0), 0);
  const styleCount = () => ctx.allEdits().reduce((a, e) => a + (e.style?.count ?? 0), 0);
  const moves = () => ctx.allEdits().flatMap((e) => (e.reorder?.changed ? [e.reorder] : []));

  // --- Raíz y regiones --------------------------------------------------------------------------

  const root = h(doc, 'div', 'pf-ov-panel pf-ov-panel--v2 pf-dk-unit');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'false');
  root.setAttribute('aria-label', 'Comentar');
  const regions: Record<Region, HTMLElement> = {
    head: h(doc, 'div', 'pf-ov-head2 pf-dk-idhdr'),
    tray: h(doc, 'div', 'pf-ov-tray'),
    sub: h(doc, 'div', 'pf-ov-subhdr pf-dk-fx pf-dk-g8'),
    strip: h(doc, 'div', 'pf-ov-target'),
    nav: h(doc, 'div', 'pf-ov-nav pf-dk-fx pf-dk-g8'),
    body: h(doc, 'div', 'pf-ov-body'),
    inc: h(doc, 'div', 'pf-ov-inc pf-dk-fx pf-dk-g8 pf-dk-wr'),
    foot: h(doc, 'div', 'pf-ov-foot2'),
  };
  regions.nav.setAttribute('role', 'group');
  regions.nav.setAttribute('aria-label', 'Moverse por el DOM');
  regions.body.setAttribute('role', 'region');
  /** Menú «⋯» de la cabecera: va fuera de la cabecera para que arrastrar el panel no lo toque. */
  const menuEl = h(doc, 'div', 'pf-ov-menu pf-dk-unit');
  menuEl.setAttribute('role', 'menu');
  menuEl.setAttribute('aria-label', 'Más acciones');
  menuEl.hidden = true;
  root.append(regions.head, regions.tray, regions.sub, regions.strip, regions.nav, regions.body, regions.inc, regions.foot, menuEl);
  let menuTrigger: HTMLButtonElement | null = null;

  const mk = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => h(doc, tag, cls, text);
  const ibtn = (label: string, ic: IconName, onClick: () => void, disabled = false, cls = ''): HTMLButtonElement => {
    const b = mk('button', cls.includes('pf-dk-key') ? cls : `pf-ov-iconbtn ${cls}`.trim());
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.title = label;
    b.disabled = disabled;
    b.appendChild(icon(doc, ic, 14));
    onc(b, 'click', onClick);
    return b;
  };

  let floating: Floating | null = null;
  const isView = () => scope === 'view' || !sel.focus;
  const contentOk = () => !isView() && !!ctx.edits()?.content;
  /** «Orden» solo existe para UN nodo con hermanos (con varios o sin hermanos no hay a dónde moverlo). */
  const structOk = () => !isView() && !sel.multi && !!sel.focus && siblingPos(sel.focus.el).count > 1;

  /** El mapa: qué vistas se ofrecen según el estado (se ocultan si no aplican). */
  function viewAvailable(v: PanelView): boolean {
    switch (v) {
      case 'comment':
        return true;
      case 'content':
        return contentOk();
      case 'styles':
      case 'layers':
        return !isView();
      case 'struct':
        return structOk();
      case 'group':
        return !!ctx.groupsPort || !!ctx.binding;
    }
  }

  /** Si la vista abierta ya no aplica (p. ej. se navegó a un nodo sin texto), la pila vuelve a la base. */
  function ensureView(): boolean {
    if (view === 'comment' || viewAvailable(view)) return false;
    const was = view;
    view = 'comment';
    opts.announce(`Volviste a Comentar: ${VIEW_TITLE[was]} no aplica a este elemento.`);
    return true;
  }

  function paint(r: Region): void {
    if (destroyed) return;
    const box = regions[r];
    switch (r) {
      case 'head':
        return paintHead(box);
      case 'tray':
        return paintTray(box);
      case 'strip':
        return paintStrip(box);
      case 'nav':
        return paintNav(box);
      case 'sub':
        return paintSub(box);
      case 'body':
        return paintBody(box);
      case 'inc':
        return paintInc(box);
      case 'foot':
        return paintFoot(box);
    }
  }
  const paintAll = () => {
    ensureView();
    (['head', 'tray', 'sub', 'strip', 'nav', 'body', 'inc', 'foot'] as const).forEach(paint);
  };
  // Next.js resuelve la ubicación exacta de forma asíncrona: al llegar, se repinta la cabecera (archivo:línea).
  sel.onSource = () => {
    if (!destroyed) paint('head');
  };

  // --- Cabecera: identidad + 3 teclas (copiar, abrir, cerrar) + menú «⋯» ------------------------------------

  function paintHead(box: HTMLElement): void {
    box.textContent = '';
    const vw = isView();
    const multi = sel.multi && !vw;
    const n = sel.focus;
    const comps = n?.snap.components ?? null;
    const route = doc.location.pathname || '/';
    const kind = dkTagk(doc, vw ? 'vista' : multi ? String(sel.size) : n!.el.localName);
    kind.classList.add('pf-ov-kind');
    const id = mk('div', 'pf-ov-id pf-dk-id pf-dk-grow');
    const title = mk('h2', 'pf-ov-title pf-dk-t2');
    title.id = 'pf-ov-title';
    title.textContent = vw ? 'Toda la vista' : multi ? `${sel.size} elementos` : (comps?.[0] ?? describe(n!.el));
    if (!vw && !multi && comps && comps.length > 1) title.appendChild(mk('small', 'pf-dk-ts', ` en ${comps.slice(1).join(' < ')}`));
    const subText = vw
      ? route
      : multi
        ? `Foco: ${describe(n!.el)}${n!.snap.src ? ` · ${fileLabel(n!.snap.src)}` : ''}`
        : (n!.snap.src ?? n!.snap.selector);
    const sub = mk('p', 'pf-ov-sub pf-dk-ts', subText);
    sub.title = subText;
    id.append(title, sub);
    const tools = mk('div', 'pf-ov-tools pf-dk-fx pf-dk-g6');
    if (!vw) {
      // Un solo clic copia la referencia completa (ruta, componente, archivo, selector, texto, tamaño y pf://).
      const c = ibtn('Copiar referencia completa', 'copy', () => {
        const text = fullReference(doc, sel.nodes);
        if (!text) return;
        void writeClipboard(doc, text).then((ok) => {
          if (ok && !destroyed) c.classList.add('pf-dk-key--lit');
          opts.announce(ok ? 'Referencia copiada: ruta, componente, archivo, selector y más.' : 'No se pudo copiar al portapapeles.');
        });
      }, false, 'pf-dk-key pf-dk-key--sm pf-dk-key--sq');
      tools.appendChild(c);
      if (opts.openCode) {
        // ↗ Abrir en el código: el archivo:línea del nodo enfocado (data-pf-src). Sin fuente, deshabilitado.
        const target = targetFromSrc(n?.snap.src);
        const label = target ? `${OPEN_LABEL}: ${target.file}:${target.line}` : NO_SOURCE;
        const o = ibtn(label, 'external', () => {
          if (target) void openInCode(opts.openCode!, target, (m) => opts.announce(m));
        }, !target, 'pf-dk-key pf-dk-key--sm pf-dk-key--sq');
        o.setAttribute('data-pf-open', '');
        tools.appendChild(o);
      }
    }
    tools.appendChild(ibtn('Cerrar (Esc)', 'close', () => opts.onClose(), false, 'pf-dk-key pf-dk-key--sm pf-dk-key--sq pf-dk-key--ghost'));
    // «⋯»: lo raro (Capas, navegar, sumar, elegir otro, sección, eliminar, minimizar) no ocupa la cabecera.
    const more = ibtn('Más acciones', 'more', () => toggleMenu(), false, 'pf-dk-key pf-dk-key--sm pf-dk-key--sq pf-dk-key--ghost pf-ov-more');
    more.setAttribute('aria-haspopup', 'menu');
    more.setAttribute('aria-expanded', String(menuOpen));
    menuTrigger = more;
    tools.insertBefore(more, tools.lastElementChild);
    box.append(kind, id, tools);
    paintMenu();
  }

  interface MenuItem {
    label: string;
    ic: IconName;
    run: () => void;
    hint?: string;
    pressed?: boolean;
    danger?: boolean;
    attr?: string;
  }

  function menuItems(): MenuItem[] {
    const items: MenuItem[] = [];
    const vw = isView();
    if (!vw) {
      items.push({ label: 'Capas', ic: 'layers', run: () => setView('layers') });
      items.push({
        label: 'Navegar por el DOM',
        ic: 'move',
        hint: '↑↓←→',
        pressed: navActive,
        run: () => {
          navActive = !navActive;
          paint('nav');
          opts.announce(navActive ? 'Navegador del DOM visible.' : 'Navegador del DOM oculto.');
        },
      });
      items.push({
        label: 'Sumar elemento',
        ic: 'plus',
        hint: 'Shift+clic',
        pressed: addMode,
        run: () => {
          addMode = !addMode;
          paint('strip');
          opts.announce(addMode ? 'Modo sumar: el siguiente clic añade un elemento.' : 'Modo sumar desactivado.');
        },
      });
    }
    items.push({ label: 'Elegir otro elemento', ic: 'select', run: () => opts.onPick(ctx.draft) });
    if (!sections.full) {
      items.push({
        label: 'Añadir sección',
        ic: 'plus',
        run: () => {
          sections.add();
          if (view !== 'comment') setView('comment');
          else paint('body');
        },
      });
    }
    if (floating) items.push({ label: 'Minimizar panel', ic: 'min', run: () => floating!.setMinimized(true) });
    if (!vw) items.push({ label: 'Eliminar elemento', ic: 'trash', danger: true, attr: 'data-pf-remove', run: () => void doSave(true) });
    return items;
  }

  function paintMenu(): void {
    menuEl.textContent = '';
    for (const it of menuItems()) {
      const b = mk('button', it.danger ? 'pf-ov-mi pf-dk-key pf-dk-key--ghost pf-ov-mi--danger' : 'pf-ov-mi pf-dk-key pf-dk-key--ghost');
      b.type = 'button';
      b.setAttribute('role', it.pressed === undefined ? 'menuitem' : 'menuitemcheckbox');
      if (it.pressed !== undefined) b.setAttribute('aria-checked', String(it.pressed));
      if (it.attr) b.setAttribute(it.attr, '');
      b.tabIndex = -1;
      b.disabled = ctx.busy;
      b.append(icon(doc, it.ic, 14), doc.createTextNode(it.label));
      if (it.hint) b.appendChild(mk('kbd', 'pf-dk-kb pf-ov-mi-k', it.hint));
      onc(b, 'click', () => {
        closeMenu(false);
        it.run();
      });
      menuEl.appendChild(b);
    }
    menuEl.hidden = !menuOpen;
  }

  function toggleMenu(open = !menuOpen): void {
    if (destroyed) return;
    menuOpen = open;
    menuEl.hidden = !open;
    menuTrigger?.setAttribute('aria-expanded', String(open));
    if (open) menuEl.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
  }
  function closeMenu(refocus: boolean): void {
    if (!menuOpen) return;
    toggleMenu(false);
    if (refocus) menuTrigger?.focus();
  }
  onc(menuEl, 'keydown', (e) => {
    const k = e as KeyboardEvent;
    const items = Array.from(menuEl.querySelectorAll<HTMLElement>('button:not(:disabled)'));
    const i = items.indexOf((menuEl.getRootNode() as Document | ShadowRoot).activeElement as HTMLElement);
    let to = -1;
    if (k.key === 'ArrowDown') to = (i + 1) % items.length;
    else if (k.key === 'ArrowUp') to = (i - 1 + items.length) % items.length;
    else if (k.key === 'Home') to = 0;
    else if (k.key === 'End') to = items.length - 1;
    else if (k.key === 'Tab') closeMenu(false);
    if (to < 0) return;
    k.preventDefault();
    k.stopPropagation();
    items[to]?.focus();
  });
  // Clic fuera del menú (en la página o en el panel): se cierra sin más.
  onc(doc, 'pointerdown', (e) => {
    if (!menuOpen) return;
    const path = e.composedPath();
    if (path.includes(menuEl) || (menuTrigger && path.includes(menuTrigger))) return;
    closeMenu(false);
  });

  // --- Bandeja de nodos (solo multi) -------------------------------------------------------------

  function paintTray(box: HTMLElement): void {
    box.textContent = '';
    box.hidden = !(sel.multi && !isView());
    if (box.hidden) return;
    box.setAttribute('aria-label', 'Elementos seleccionados');
    sel.nodes.forEach((n, i) => {
      const chip = mk('span', i === sel.focusIndex ? 'pf-ov-tchip pf-dk-chip pf-dk-chip--on' : 'pf-ov-tchip pf-dk-chip');
      if (i === sel.focusIndex) chip.setAttribute('aria-current', 'true');
      const num = mk('i', undefined, String(i + 1));
      const f = mk('button', 'pf-ov-tfocus', describe(n.el));
      f.type = 'button';
      onc(f, 'click', () => {
        sel.setFocus(i);
        childStack = [];
        afterFocusChange();
      });
      const x = mk('button', 'pf-ov-tx');
      x.type = 'button';
      x.setAttribute('aria-label', `Quitar ${n.el.localName}`);
      x.appendChild(icon(doc, 'close', 11));
      onc(x, 'click', () => {
        sel.remove(i);
        afterFocusChange(true);
      });
      chip.append(dkLed(doc, i === sel.focusIndex), num, f, x);
      box.appendChild(chip);
    });
    box.appendChild(mk('span', 'pf-ov-hint pf-dk-ts', 'Shift+clic suma'));
  }

  // --- Alcance (solo en la base) ---------------------------------------------------------------------------

  function paintStrip(box: HTMLElement): void {
    box.textContent = '';
    box.hidden = view !== 'comment';
    if (box.hidden) return;
    const vw = isView();
    const multi = sel.multi && !vw;
    const seg = mk('div', 'pf-ov-seg pf-dk-tray');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Alcance del comentario');
    const segBtn = (label: string, pressed: boolean, onClick: () => void, disabled = false) => {
      const b = mk('button', 'pf-ov-segbtn pf-dk-key', label);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(pressed));
      b.disabled = disabled;
      onc(b, 'click', onClick);
      return b;
    };
    seg.append(
      segBtn(multi ? `${sel.size} elementos` : 'Este elemento', !vw, () => setScope('element'), sel.size === 0),
      segBtn('Toda la vista', vw, () => setScope('view')),
    );
    box.appendChild(seg);
    if (addMode) {
      const s = dkChip(doc, 'Clic en la página para sumar · Esc cancela', { on: true, led: true });
      s.setAttribute('role', 'status');
      box.appendChild(s);
    }
  }

  // --- Navegador ↑↓←→: fila delgada solo mientras se navega (o en Capas) ---------------------------------

  function paintNav(box: HTMLElement): void {
    box.textContent = '';
    const show = !isView() && !!sel.focus && (navActive || view === 'layers');
    box.hidden = !show;
    if (!show) return;
    const av = navAvailability(sel.focus!.el);
    const pos = siblingPos(sel.focus!.el);
    const sq = 'pf-dk-key pf-dk-key--sq';
    const g1 = mk('div', 'pf-ov-ngrp pf-dk-fx pf-dk-g6');
    g1.append(ibtn('Padre (↑)', 'up', () => navigate('parent'), !av.parent, sq), ibtn('Primer hijo (↓)', 'down', () => navigate('child'), !av.child, sq));
    const g2 = mk('div', 'pf-ov-ngrp pf-dk-fx pf-dk-g6');
    const posEl = mk('span', 'pf-ov-pos pf-dk-chip', `${pos.pos + 1}/${pos.count}`);
    posEl.title = 'Posición entre hermanos';
    g2.append(ibtn('Hermano anterior (←)', 'left', () => navigate('prev'), !av.prev, sq), posEl, ibtn('Hermano siguiente (→)', 'right', () => navigate('next'), !av.next, sq));
    box.append(g1, g2);
  }

  // --- Cabecera de subvista: «‹ Comentar» + título -------------------------------------------------------

  function paintSub(box: HTMLElement): void {
    box.textContent = '';
    box.hidden = view === 'comment';
    if (box.hidden) return;
    const back = mk('button', 'pf-ov-back pf-dk-key pf-dk-key--sm');
    back.type = 'button';
    back.setAttribute('data-pf-back', '');
    back.setAttribute('aria-label', 'Volver a Comentar');
    back.append(icon(doc, 'left', 13), doc.createTextNode('Comentar'));
    onc(back, 'click', () => setView('comment'));
    const t = mk('h3', 'pf-ov-viewtitle pf-dk-t2', VIEW_TITLE[view]);
    t.id = 'pf-ov-view-title';
    box.append(back, t);
  }

  // --- Pila: abrir / cerrar una subvista --------------------------------------------------------------------

  type FocusTo = 'auto' | 'note' | 'none';

  function setView(v: PanelView, focusTo: FocusTo = 'auto'): void {
    if (destroyed) return;
    if (!viewAvailable(v)) v = 'comment';
    if (v === view) return;
    const prev = view;
    closeMenu(false);
    view = v;
    if (v === 'layers') navActive = false;
    for (const r of ['sub', 'strip', 'nav', 'body'] as const) paint(r);
    animateView(v === 'comment' ? 'back' : 'fwd');
    if (focusTo !== 'none') {
      if (v !== 'comment') regions.sub.querySelector<HTMLElement>('[data-pf-back]')?.focus();
      else {
        const chip = focusTo === 'auto' ? regions.body.querySelector<HTMLElement>(`[data-pf-chip="${prev}"]`) : null;
        (chip ?? regions.body.querySelector<HTMLElement>('textarea'))?.focus();
      }
    }
    opts.announce(v === 'comment' ? 'Comentar.' : `Vista ${VIEW_TITLE[v]}.`);
  }

  /** Transición corta entre vistas (translate + fade ≤ 180 ms; sin movimiento con prefers-reduced-motion, ver CSS). */
  function animateView(dir: 'fwd' | 'back'): void {
    for (const el of [regions.sub, regions.body]) {
      el.classList.remove('pf-ov-vt--fwd', 'pf-ov-vt--back');
      void el.offsetWidth;
      el.classList.add(dir === 'fwd' ? 'pf-ov-vt--fwd' : 'pf-ov-vt--back');
    }
  }
  for (const el of [regions.sub, regions.body]) {
    onc(el, 'animationend', () => el.classList.remove('pf-ov-vt--fwd', 'pf-ov-vt--back'));
  }

  /** Vuelve a la base sin quitarle el foco a quien lo tenga (p. ej. tras adjuntar una imagen pegada). */
  function backToBase(): void {
    if (view !== 'comment') setView('comment', 'none');
    else paint('body');
  }

  // --- Cuerpo ------------------------------------------------------------------------------------------

  function paintBody(box: HTMLElement): void {
    for (const f of bodyCleanups) f();
    bodyCleanups = [];
    hoverEl = null;
    box.textContent = '';
    box.id = `pf-ov-pane-${view}`;
    box.dataset.view = view;
    if (view === 'comment') {
      box.removeAttribute('aria-labelledby');
      box.setAttribute('aria-label', 'Comentario');
    } else {
      box.removeAttribute('aria-label');
      box.setAttribute('aria-labelledby', 'pf-ov-view-title');
    }
    const e = ctx.edits();
    switch (view) {
      case 'comment':
        renderComment(ctx, box);
        bindComment(box);
        break;
      case 'content':
        renderContent(ctx, box);
        break;
      case 'styles':
        if (e) renderStyles(ctx, box, ensureStyles(e));
        break;
      case 'struct':
        renderStruct(ctx, box);
        break;
      case 'layers':
        renderLayers(ctx, box);
        break;
      case 'group':
        renderQueue(ctx, box);
        break;
    }
    opts.onFocusChange(); // Orden puede mostrar una línea de inserción.
  }

  /** Pegar/soltar imágenes en la base. La nota apaga el navegador ↑↓←→ al recibir el foco (ya no se navega). */
  function bindComment(box: HTMLElement): void {
    bodyCleanups.push(bindImagePaste(root, (files) => void addImages(files, 'paste', null)));
    const note = box.querySelector<HTMLTextAreaElement>('#pf-ov-comment');
    if (note) {
      const off = () => {
        if (!navActive) return;
        navActive = false;
        paint('nav');
      };
      note.addEventListener('focus', off);
      bodyCleanups.push(() => note.removeEventListener('focus', off));
    }
    box.querySelectorAll<HTMLElement>('[data-pf-dz]').forEach((zone) => {
      const sectionId = zone.getAttribute('data-pf-dz') || null;
      bodyCleanups.push(
        bindImageDrop(zone, {
          onDraggingChange: (on) => box.querySelectorAll('[data-pf-dz]').forEach((z) => z.classList.toggle('pf-ov-dz--over', on)),
          onFiles: (files, source) => void addImages(files, source, sectionId),
          onRejected: (m) => {
            ctx.imgError = m;
            paint('body');
          },
        }),
      );
    });
  }

  async function addImages(files: File[], source: 'paste' | 'drop' | 'open', sectionId: string | null): Promise<void> {
    if (!files.length || ctx.busy) return;
    const errors = await att.addFiles(files, source, sectionId);
    if (destroyed) return;
    ctx.imgError = errors[0] ?? '';
    if (ctx.imgError) opts.announce(ctx.imgError);
    else opts.announce(`${att.count} de 20 imágenes adjuntas.`);
    backToBase();
    paint('inc');
  }

  async function captureImage(): Promise<void> {
    if (!opts.requestCapture || ctx.busy) return;
    const shot = await opts.requestCapture();
    if (destroyed) return;
    if (!shot) ctx.imgError = 'No se pudo capturar la pantalla. Puedes guardar sin captura.';
    else {
      const r = att.addCapture(shot, null);
      ctx.imgError = r.ok ? '' : r.error;
    }
    backToBase();
    paint('inc');
  }

  // --- Incluye + pie --------------------------------------------------------------------------------------

  function paintInc(box: HTMLElement): void {
    box.textContent = '';
    const chips: Array<{ view: PanelView; ic: IconName; label: string }> = [];
    const vw = isView();
    if (sel.multi && !vw) chips.push({ view: 'comment', ic: 'node', label: `${sel.size} nodos` });
    if (att.count) chips.push({ view: 'comment', ic: 'img', label: `${att.count} ${att.count > 1 ? 'imágenes' : 'imagen'}` });
    const sc = styleCount();
    if (sc) chips.push({ view: 'styles', ic: 'style', label: `${sc} ${sc > 1 ? 'cambios de estilo' : 'cambio de estilo'}` });
    const cc = contentCount();
    if (cc) {
      const first = ctx.allEdits().find((e) => e.content?.changeCount)?.content;
      chips.push({ view: 'content', ic: 'text', label: cc > 1 || !first ? `${cc} textos editados` : `texto: ${first.shortSummary()}` });
    }
    const mv = moves()[0];
    if (mv) chips.push({ view: 'struct', ic: 'move', label: `mover ${mv.from} → ${mv.to}` });
    if (ctx.binding) {
      const queue = queueFor(ctx.binding.groupId, opts.groups?.comments() ?? []);
      chips.push({ view: 'group', ic: 'queue', label: `Grupo ${ctx.binding.groupId} · paso ${bindingStep(ctx.binding, queue)}` });
    }
    box.hidden = chips.length === 0;
    if (!chips.length) return;
    box.setAttribute('aria-label', 'Incluye este comentario');
    box.appendChild(mk('small', 'pf-dk-lab', 'Incluye'));
    for (const c of chips) {
      // En la base, lo que ya está a la vista (nodos, imágenes) no es un botón; el resto abre su vista.
      const here = c.view === view;
      const b = dkChip(doc, c.label, { on: true, led: true, ...(here ? {} : { tag: 'button' as const }) });
      if (!here) onc(b, 'click', () => setView(c.view));
      b.classList.add('pf-ov-ichip');
      box.appendChild(b);
    }
  }

  function paintFoot(box: HTMLElement): void {
    box.textContent = '';
    if (ctx.error) {
      const e = dkWarn(doc, ctx.error, { bad: true });
      e.classList.add('pf-ov-error');
      box.appendChild(e);
    }
    const keys = mk('div', 'pf-ov-keys pf-dk-ts pf-dk-grow');
    const k = (a: string[], t: string) => {
      const s = mk('span');
      a.forEach((x, i) => {
        if (i) s.appendChild(doc.createTextNode(' '));
        s.appendChild(dkKb(doc, x));
      });
      s.appendChild(doc.createTextNode(` ${t}`));
      return s;
    };
    keys.append(k(['Ctrl', '↵'], 'guardar'), k(['Esc'], 'cancelar'));
    const cancel = dkKey(doc, 'Cancelar', { variant: 'ghost', disabled: ctx.busy });
    onc(cancel, 'click', () => opts.onClose());
    const save = dkKey(doc, ctx.busy ? 'Guardando…' : ctx.binding ? 'Guardar en la cola' : 'Guardar', { variant: 'hot', disabled: ctx.busy });
    onc(save, 'click', () => void doSave());
    const bar = mk('div', 'pf-ov-actions pf-dk-fx pf-dk-g8 pf-dk-wr');
    bar.append(keys, cancel, save);
    box.appendChild(bar);
    root.setAttribute('aria-busy', String(ctx.busy));
  }

  // --- Foco, navegación y selección ---------------------------------------------------------------------

  function afterFocusChange(selectionChanged = false): void {
    if (selectionChanged && sel.size === 0) scope = 'view';
    paintAll();
    opts.onFocusChange();
  }

  function navigate(dir: NavDir): void {
    const n = sel.focus;
    if (!n || isView() || ctx.busy) return;
    const next = navTarget(n.el, dir, childStack);
    if (!next) return;
    navActive = true; // la fila ↑↓←→ aparece mientras se navega
    retarget(next, true);
  }

  /** Mueve el foco a otro elemento (sin sumar). */
  function retarget(el: Element, keepStack = false): void {
    if (!keepStack) childStack = [];
    sel.retarget(el);
    scope = 'element';
    afterFocusChange();
    opts.announce(`Elemento seleccionado: ${describe(el)}.`);
  }

  function focusNode(): void {
    opts.onFocusChange();
  }

  function setScope(s: Scope): void {
    if (s === 'element' && sel.size === 0) return;
    scope = s;
    afterFocusChange(); // ensureView() devuelve a la base las vistas que no aplican a «toda la vista»
    opts.announce(s === 'element' ? 'Comentario sobre este elemento.' : 'Comentario sobre toda la vista.');
  }

  // --- Guardar -----------------------------------------------------------------------------------------------

  function collectProposals(): { proposals: CommentProposal[] } {
    const proposals: CommentProposal[] = [];
    const taken = new Set<string>();
    const primary = sel.nodes[0]?.el ?? null;
    for (const e of ctx.allEdits()) {
      // En scope view toda propuesta lleva selector explícito (regla de shared).
      const target = !isView() && e.el === primary ? null : e.selector;
      const parent = e.el.parentElement;
      const parts = [
        e.content?.toProposal(target, taken),
        e.style?.toProposal(target, taken),
        e.reorder?.toProposal(e.selector, parent ? (generateSelectorCandidates(parent)[0] ?? null) : null, taken),
      ];
      for (const p of parts) {
        if (!p) continue;
        taken.add(p.id);
        proposals.push(p);
      }
    }
    return { proposals };
  }

  function revertPreviews(): void {
    for (const e of edits.values()) {
      e.content?.revertPreview();
      e.style?.revertAll();
    }
  }

  const REMOVE_PREFIX = 'Eliminar este elemento.';

  async function doSave(remove = false): Promise<void> {
    if (ctx.busy || destroyed) return;
    if (remove && (isView() || sel.nodes.length === 0)) {
      ctx.error = 'Elige un elemento para marcarlo como eliminar.';
      setView('comment', 'note');
      paint('foot');
      opts.announce(ctx.error);
      return;
    }
    const { proposals } = collectProposals();
    const note = ctx.draft.trim();
    const port = ctx.groupsPort;
    const b = ctx.binding;

    // Pasos previos de grupo (crear / meter el otro comentario) solo si hay binding y hace falta.
    let queue = b ? queueFor(b.groupId, port?.comments() ?? []) : [];
    const built = buildRequestV2({
      doc,
      scope: isView() ? 'view' : 'element',
      selection: sel,
      main: remove ? (note ? `${REMOVE_PREFIX} ${note}` : REMOVE_PREFIX) : ctx.draft,
      autoText: remove || ctx.autoMerged ? null : proposalsToComment(proposals),
      sections,
      attachments: att,
      proposals,
      group: b ? groupRefForCreate(b, queue) : null,
    });
    if (!built.ok) {
      ctx.error = built.error;
      setView('comment', 'note');
      paint('foot');
      opts.announce(built.error);
      return;
    }
    ctx.error = '';
    setBusy(true);
    opts.announce('Guardando comentario…');
    let request = built.request;
    try {
      if (b && port) {
        if (b.create) {
          const g = await port.api.createGroup({ id: b.groupId as GroupId, name: b.create.name, note: '', readFirst: true });
          b.groupId = g.id;
          delete b.create;
        }
        if (b.joinWith) {
          const joinId = b.joinWith;
          await port.api.setCommentGroup(joinId, { id: b.groupId as GroupId, position: 1 });
          delete b.joinWith;
          const other = port.comments().find((c) => c.id === joinId);
          if (other) queue = [{ ...other, group: { id: b.groupId, position: 1 } }, ...queue];
        }
        request = { ...request, group: groupRefForCreate(b, queue) };
      }
      const res = await opts.onSubmit(request);
      if (b && port && needsReorder(b, queue)) {
        // El comentario ya existe: se fija su paso real en la cola (best effort; no invalida el guardado).
        await port.api
          .reorderGroup(b.groupId, { order: orderWithInserted(queue, res.id, b.afterId) as CommentId[] })
          .catch(() => opts.announce('El comentario se guardó, pero no se pudo fijar su posición en la cola.'));
      }
      if (destroyed) return;
      revertPreviews();
      opts.onSaved?.(res);
    } catch (err) {
      if (destroyed) return;
      setBusy(false);
      const detail = err instanceof Error && err.message ? ` ${err.message}` : '';
      ctx.error = `No se pudo guardar.${detail} Tu comentario se conservó; inténtalo de nuevo.`;
      paint('foot');
      opts.announce(ctx.error);
    }
  }

  async function save(): Promise<void> {
    await doSave();
  }

  function setBusy(b: boolean): void {
    ctx.busy = b;
    paintAll();
  }

  // --- API pública ------------------------------------------------------------------------------------------------

  const handle: EditorHandle = {
    get movable() {
      return movable;
    },
    root,
    selection: sel,
    get scope() {
      return scope;
    },
    get draft() {
      return ctx.draft;
    },
    get focusEl() {
      return scope === 'view' ? null : (sel.focus?.el ?? null);
    },
    get hoverEl() {
      return hoverEl?.isConnected ? hoverEl : null;
    },
    get nodes() {
      return scope === 'view' ? [] : sel.nodes.map((n) => n.el);
    },
    reorderIndicator() {
      if (view !== 'struct') return null;
      return ctx.edits()?.reorder?.indicator() ?? null;
    },
    pickElement(el, additive) {
      if (ctx.busy) return;
      if (additive || addMode) {
        const r = sel.toggle(el);
        if (r === 'full') opts.announce('Máximo de elementos alcanzado.');
        if (r === 'kept') opts.announce('Debe quedar al menos un elemento.');
        addMode = false;
        scope = 'element';
        afterFocusChange();
        return;
      }
      retarget(el);
    },
    setScope,
    get view() {
      return view;
    },
    handleKey(e, info) {
      const act = interpretEditorKey(e, { typing: info.typing, own: info.own, hasElement: !isView() });
      if (!act) return false;
      if (act.type === 'cancel') {
        // Esc en pasos: menú «⋯» → modo sumar → subvista (vuelve a «Comentar») → recién entonces cierra.
        if (menuOpen) closeMenu(true);
        else if (addMode) {
          addMode = false;
          paint('strip');
          opts.announce('Modo sumar desactivado.');
        } else if (view !== 'comment') setView('comment');
        else opts.onClose();
        return true;
      }
      if (act.type === 'save') {
        void doSave();
        return true;
      }
      if (act.type === 'nav') {
        navigate(act.dir);
        return true;
      }
      return false;
    },
    save: () => void doSave(),
    attachShots(shots) {
      if (destroyed || ctx.busy) return { added: 0, error: 'El editor no admite cambios ahora.' };
      let added = 0;
      let error: string | undefined;
      const sectionId = sections.items.some((x) => x.id === captureSection) ? captureSection : null;
      for (const s of shots) {
        const r = att.addCapture({ mimeType: s.mimeType, dataBase64: s.dataBase64 }, sectionId);
        if (!r.ok) {
          error = r.error;
          break;
        }
        r.image.name = `pf-${s.name.replace(/\.png$/i, '').replace(/^nodo-/, '').replace('@', '-')}.png`;
        added++;
      }
      ctx.imgError = error ?? '';
      backToBase();
      paint('inc');
      opts.announce(error ?? `${added} captura${added === 1 ? '' : 's'} adjunta${added === 1 ? '' : 's'}.`);
      return error ? { added, error } : { added };
    },
    setBusy,
    destroy() {
      if (destroyed) return;
      revertPreviews();
      destroyed = true;
      for (const f of bodyCleanups) f();
      for (const f of cleanups) f();
      att.clear();
      root.remove();
    },
  };

  opts.layer.appendChild(root);
  // Panel flotante: movible, anclable a un borde y minimizable a una píldora (floating.ts).
  floating = makeFloating(root, regions.head, {
    kind: 'editor',
    layer: opts.layer,
    label: () => (isView() ? 'toda la vista' : describe(sel.focus!.el)),
    onClose: () => opts.onClose(),
    onPanelReset: () => opts.onPanelReset?.(),
  });
  const movable: Movable = floating.movable;
  cleanups.push(() => floating?.destroy());
  paintAll();
  return handle;
}
