import { proposalsToComment, type CommentId, type CommentProposal, type CreateCommentRequest, type GroupId } from '@perfect-front/shared';
import { Attachments, bindImageDrop, bindImagePaste } from './attachments';
import { ContentEditor, detectContent } from './content-edit';
import { describe, fileLabel, h } from './dom';
import { makeMovable, type Movable } from './drag-panel';
import { navAvailability, navTarget, siblingPos, type NavDir } from './dom-nav';
import type { EditorCtx, GroupsPort, NodeEdits, PanelTab, Region, Scope } from './editor-ctx';
import { inspectFor, renderComment, renderContent, renderQueue, renderStruct, renderStyles } from './editor-tabs';
import { bindingStep, groupRefForCreate, needsReorder, orderWithInserted, queueFor, type GroupBinding } from './groups';
import { icon, type IconName } from './icons';
import { interpretEditorKey, type KeyLike } from './keymap';
import { COPY_LABELS, copyAll, previewFor, writeClipboard, type CopyKey } from './location-copy';
import { buildRequestV2 } from './payload';
import { Sections } from './sections';
import { generateSelectorCandidates } from './selector';
import type { Selection } from './selection';
import { StyleEditor, type StyleInspection, type StyleRow } from './style-edit';
import type { CapturedShot, ScreenshotUpload, SubmitResult } from './types';

/**
 * Editor v2 (panel con pestañas Comentar · Contenido · Estilos · Estructura · Cola). Es un controlador
 * independiente del overlay: quien lo orquesta le da la selección, recibe los cambios de foco y delega el
 * teclado. No toca el código del proyecto observado: todo lo que cambia es vista previa reversible.
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
  /** Nodos seleccionados (para resaltar todos). */
  readonly nodes: readonly Element[];
  /** Línea de inserción de la propuesta de reordenar, para dibujarla en la página. */
  reorderIndicator(): { el: Element; side: 'before' | 'after' } | null;
  /** Clic en la página: sin `additive` reemplaza la selección; con Shift (o «Sumar» activo) suma/quita. */
  pickElement(el: Element, additive: boolean): void;
  setScope(s: Scope): void;
  /** Teclado delegado por el overlay. Devuelve true si lo consumió. */
  handleKey(e: KeyLike, info: { own: boolean; typing: boolean }): boolean;
  save(): void;
  /** Suma capturas de nodo como adjuntos (source 'capture'); respeta el tope de 20 y la sección activa. */
  attachShots(shots: readonly CapturedShot[]): { added: number; error?: string };
  setBusy(b: boolean): void;
  destroy(): void;
}

const STATUS_TABS: Array<{ id: PanelTab; label: string; icon: IconName }> = [
  { id: 'comment', label: 'Comentar', icon: 'comment' },
  { id: 'content', label: 'Contenido', icon: 'text' },
  { id: 'styles', label: 'Estilos', icon: 'style' },
  { id: 'struct', label: 'Estructura', icon: 'move' },
  { id: 'queue', label: 'Cola', icon: 'queue' },
];

export function createEditor(opts: EditorOptions): EditorHandle {
  const doc = opts.doc;
  const sel = opts.selection;
  let scope: Scope = opts.scope;
  let tab: PanelTab = 'comment';
  let destroyed = false;
  let addMode = false;
  let copyOpen = false;
  let copied: CopyKey | '' = '';
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
    get tab() {
      return tab;
    },
    set tab(t: PanelTab) {
      tab = t;
    },
    draft: opts.draft ?? '',
    busy: false,
    error: '',
    imgError: '',
    dragging: false,
    lang: '',
    fndOpen: false,
    styleMode: 'visual',
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

  // --- Totales para «Incluye» y pestañas ------------------------------------------------------

  const contentCount = () => ctx.allEdits().reduce((a, e) => a + (e.content?.changeCount ?? 0), 0);
  const styleCount = () => ctx.allEdits().reduce((a, e) => a + (e.style?.count ?? 0), 0);
  const moves = () => ctx.allEdits().flatMap((e) => (e.reorder?.changed ? [e.reorder] : []));

  // --- Raíz y regiones --------------------------------------------------------------------------

  const root = h(doc, 'div', 'pf-ov-panel pf-ov-panel--v2');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'false');
  root.setAttribute('aria-label', 'Comentar');
  const regions: Record<Region, HTMLElement> = {
    head: h(doc, 'div', 'pf-ov-head2'),
    tray: h(doc, 'div', 'pf-ov-tray'),
    strip: h(doc, 'div', 'pf-ov-target'),
    tabs: h(doc, 'div', 'pf-ov-tabs'),
    body: h(doc, 'div', 'pf-ov-body'),
    inc: h(doc, 'div', 'pf-ov-inc'),
    foot: h(doc, 'div', 'pf-ov-foot2'),
  };
  regions.tabs.setAttribute('role', 'tablist');
  regions.tabs.setAttribute('aria-label', 'Secciones');
  regions.body.setAttribute('role', 'tabpanel');
  root.append(regions.head, regions.tray, regions.strip, regions.tabs, regions.body, regions.inc, regions.foot);

  const mk = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => h(doc, tag, cls, text);
  const ibtn = (label: string, ic: IconName, onClick: () => void, disabled = false, cls = ''): HTMLButtonElement => {
    const b = mk('button', `pf-ov-iconbtn ${cls}`.trim());
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.title = label;
    b.disabled = disabled;
    b.appendChild(icon(doc, ic, 14));
    onc(b, 'click', onClick);
    return b;
  };
  const tbtn = (cls: string, label: string, onClick: () => void, ic?: IconName): HTMLButtonElement => {
    const b = mk('button', cls);
    b.type = 'button';
    if (ic) b.appendChild(icon(doc, ic, 13));
    b.appendChild(doc.createTextNode(ic ? ` ${label}` : label));
    onc(b, 'click', onClick);
    return b;
  };

  const isView = () => scope === 'view' || !sel.focus;
  const contentOk = () => !isView() && !!ctx.edits()?.content;

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
      case 'tabs':
        return paintTabs(box);
      case 'body':
        return paintBody(box);
      case 'inc':
        return paintInc(box);
      case 'foot':
        return paintFoot(box);
    }
  }
  const paintAll = () => (['head', 'tray', 'strip', 'tabs', 'body', 'inc', 'foot'] as const).forEach(paint);

  // --- Cabecera: identidad + copiar ubicación ---------------------------------------------------

  function paintHead(box: HTMLElement): void {
    box.textContent = '';
    const view = isView();
    const multi = sel.multi && !view;
    const n = sel.focus;
    const comps = n?.snap.components ?? null;
    const route = doc.location.pathname || '/';
    const kind = mk('span', 'pf-ov-kind', view ? 'vista' : multi ? String(sel.size) : n!.el.localName);
    kind.setAttribute('aria-hidden', 'true');
    const id = mk('div', 'pf-ov-id');
    const title = mk('h2', 'pf-ov-title');
    title.id = 'pf-ov-title';
    title.textContent = view ? 'Toda la vista' : multi ? `${sel.size} elementos` : (comps?.[0] ?? describe(n!.el));
    if (!view && !multi && comps && comps.length > 1) title.appendChild(mk('small', undefined, ` en ${comps.slice(1).join(' < ')}`));
    const subText = view
      ? route
      : multi
        ? `Foco: ${describe(n!.el)}${n!.snap.src ? ` · ${fileLabel(n!.snap.src)}` : ''}`
        : (n!.snap.src ?? n!.snap.selector);
    const sub = mk('p', 'pf-ov-sub', subText);
    sub.title = subText;
    id.append(title, sub);
    const tools = mk('div', 'pf-ov-tools');
    if (!view) {
      const wrap = mk('div', 'pf-ov-copywrap');
      const c = ibtn('Copiar ubicación', 'copy', () => {
        copyOpen = !copyOpen;
        copied = '';
        paintHead(box);
      });
      c.setAttribute('aria-haspopup', 'menu');
      c.setAttribute('aria-expanded', String(copyOpen));
      if (copyOpen) c.classList.add('pf-ov-iconbtn--on');
      wrap.appendChild(c);
      if (copyOpen) wrap.appendChild(copyMenu(box));
      tools.appendChild(wrap);
    }
    tools.appendChild(ibtn('Cerrar (Esc)', 'close', () => opts.onClose()));
    box.append(kind, id, tools);
  }

  function copyMenu(headBox: HTMLElement): HTMLElement {
    const menu = mk('div', 'pf-ov-copypop');
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Copiar ubicación');
    menu.appendChild(mk('h5', undefined, 'Copiar como'));
    const keys: CopyKey[] = ['file', 'sel', 'pf', 'md'];
    if (sel.multi) keys.push('all');
    for (const k of keys) {
      const value = previewFor(doc, sel.nodes, sel.focusIndex, k);
      const it = mk('button', 'pf-ov-cp');
      it.type = 'button';
      it.setAttribute('role', 'menuitem');
      it.disabled = value === null;
      const left = mk('span');
      left.append(mk('b', undefined, k === 'all' ? `Los ${sel.size} elementos` : COPY_LABELS[k]), mk('code', undefined, value ?? 'sin dato para este elemento'));
      it.appendChild(left);
      it.appendChild(copied === k ? mk('span', 'pf-ov-done', '¡Copiado!') : icon(doc, 'copy', 14));
      onc(it, 'click', () => {
        const n = sel.focus;
        const text = k === 'all' ? copyAll(doc, sel.nodes) : n ? previewFor(doc, [n], 0, k) : null;
        if (!text) return;
        void writeClipboard(doc, text).then((ok) => {
          copied = ok ? k : '';
          opts.announce(ok ? 'Ubicación copiada.' : 'No se pudo copiar al portapapeles.');
          if (!destroyed) paintHead(headBox);
        });
      });
      menu.appendChild(it);
    }
    return menu;
  }

  // --- Bandeja de nodos (solo multi) -------------------------------------------------------------

  function paintTray(box: HTMLElement): void {
    box.textContent = '';
    box.hidden = !(sel.multi && !isView());
    if (box.hidden) return;
    box.setAttribute('aria-label', 'Elementos seleccionados');
    sel.nodes.forEach((n, i) => {
      const chip = mk('span', 'pf-ov-tchip');
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
      chip.append(num, f, x);
      box.appendChild(chip);
    });
    box.appendChild(mk('span', 'pf-ov-hint', 'Shift+clic suma'));
  }

  // --- Objetivo: alcance, navegador ↑↓←→, sumar, elegir otro --------------------------------------

  function paintStrip(box: HTMLElement): void {
    box.textContent = '';
    const view = isView();
    const multi = sel.multi && !view;
    const row = mk('div', 'pf-ov-row');
    const seg = mk('div', 'pf-ov-seg');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Alcance del comentario');
    const segBtn = (label: string, pressed: boolean, onClick: () => void, disabled = false) => {
      const b = mk('button', 'pf-ov-segbtn', label);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(pressed));
      b.disabled = disabled;
      onc(b, 'click', onClick);
      return b;
    };
    seg.append(
      segBtn(multi ? `${sel.size} elementos` : 'Este elemento', !view, () => setScope('element'), sel.size === 0),
      segBtn('Toda la vista', view, () => setScope('view')),
    );
    row.appendChild(seg);
    box.appendChild(row);

    const nav = mk('div', view ? 'pf-ov-nav pf-ov-nav--off' : 'pf-ov-nav');
    nav.setAttribute('role', 'group');
    nav.setAttribute('aria-label', 'Moverse por el DOM');
    const av = navAvailability(view ? null : (sel.focus?.el ?? null));
    const pos = !view && sel.focus ? siblingPos(sel.focus.el) : { pos: 0, count: 0 };
    const g1 = mk('div', 'pf-ov-ngrp');
    g1.append(ibtn('Padre (↑)', 'up', () => navigate('parent'), !av.parent), ibtn('Primer hijo (↓)', 'down', () => navigate('child'), !av.child));
    const g2 = mk('div', 'pf-ov-ngrp');
    const posEl = mk('span', 'pf-ov-pos', view ? '–' : `${pos.pos + 1}/${pos.count}`);
    posEl.title = 'Posición entre hermanos';
    g2.append(ibtn('Hermano anterior (←)', 'left', () => navigate('prev'), !av.prev), posEl, ibtn('Hermano siguiente (→)', 'right', () => navigate('next'), !av.next));
    const sp = mk('span', 'pf-ov-sp');
    const add = tbtn(addMode ? 'pf-btn pf-btn--sm pf-btn--on' : 'pf-btn pf-btn--sm', 'Sumar', () => {
      addMode = !addMode;
      paintStrip(box);
      opts.announce(addMode ? 'Modo sumar: el siguiente clic añade un elemento.' : 'Modo sumar desactivado.');
    }, 'plus');
    add.setAttribute('aria-pressed', String(addMode));
    add.title = 'Sumar otro elemento (Shift+clic)';
    add.disabled = view || ctx.busy;
    const pick = ibtn('Elegir otro elemento', 'select', () => opts.onPick(ctx.draft));
    nav.append(g1, g2, sp, add, pick);
    box.appendChild(nav);
  }

  // --- Pestañas -------------------------------------------------------------------------------------

  function paintTabs(box: HTMLElement): void {
    box.textContent = '';
    const view = isView();
    for (const t of STATUS_TABS) {
      const b = mk('button', t.id === tab ? 'pf-ov-tab pf-ov-tab--on' : 'pf-ov-tab');
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(t.id === tab));
      b.tabIndex = t.id === tab ? 0 : -1;
      b.append(icon(doc, t.icon, 14), mk('span', undefined, t.label));
      let badge = 0;
      let dot = false;
      let off = '';
      if (t.id === 'comment') badge = att.count;
      if (t.id === 'content') {
        badge = contentCount();
        if (!contentOk()) off = view ? 'Elige un elemento' : 'Este elemento no tiene texto propio';
      }
      if (t.id === 'styles') {
        badge = styleCount();
        if (view) off = 'Elige un elemento';
      }
      if (t.id === 'struct') {
        badge = moves().length;
        if (view) off = 'Elige un elemento';
      }
      if (t.id === 'queue') dot = !!ctx.binding;
      if (off) {
        b.disabled = true;
        b.title = off;
      }
      if (badge) b.appendChild(mk('span', 'pf-ov-badge', String(badge)));
      if (dot) b.appendChild(mk('span', 'pf-ov-badge pf-ov-badge--dot'));
      onc(b, 'click', () => setTab(t.id));
      box.appendChild(b);
    }
    box.onkeydown = (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
      const enabled = STATUS_TABS.filter((t) => !(box.children[STATUS_TABS.indexOf(t)] as HTMLButtonElement).disabled);
      const i = enabled.findIndex((t) => t.id === tab);
      const next =
        e.key === 'Home' ? enabled[0] : e.key === 'End' ? enabled[enabled.length - 1] : enabled[(i + (e.key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length];
      if (!next) return;
      e.preventDefault();
      e.stopPropagation();
      setTab(next.id);
      (box.children[STATUS_TABS.indexOf(next)] as HTMLElement).focus();
    };
  }

  function setTab(t: PanelTab): void {
    tab = t;
    paint('tabs');
    paint('body');
    opts.onFocusChange();
  }

  // --- Cuerpo ------------------------------------------------------------------------------------------

  function paintBody(box: HTMLElement): void {
    for (const f of bodyCleanups) f();
    bodyCleanups = [];
    box.textContent = '';
    box.id = `pf-ov-pane-${tab}`;
    const e = ctx.edits();
    if (tab === 'content' && !contentOk()) tab = 'comment';
    if ((tab === 'styles' || tab === 'struct') && isView()) tab = 'comment';
    switch (tab) {
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
      case 'queue':
        renderQueue(ctx, box);
        break;
    }
    opts.onFocusChange(); // Estructura puede mostrar una línea de inserción.
  }

  /** Pegar/soltar imágenes en la pestaña Comentar. */
  function bindComment(box: HTMLElement): void {
    bodyCleanups.push(bindImagePaste(root, (files) => void addImages(files, 'paste', null)));
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
    if (tab !== 'comment') tab = 'comment';
    paint('tabs');
    paint('body');
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
    paint('tabs');
    paint('body');
    paint('inc');
  }

  // --- Incluye + pie --------------------------------------------------------------------------------------

  function paintInc(box: HTMLElement): void {
    box.textContent = '';
    const chips: Array<{ tab: PanelTab; ic: IconName; label: string }> = [];
    const view = isView();
    if (sel.multi && !view) chips.push({ tab: 'comment', ic: 'node', label: `${sel.size} nodos` });
    if (att.count) chips.push({ tab: 'comment', ic: 'img', label: `${att.count} ${att.count > 1 ? 'imágenes' : 'imagen'}` });
    const sc = styleCount();
    if (sc) chips.push({ tab: 'styles', ic: 'style', label: `${sc} ${sc > 1 ? 'cambios de estilo' : 'cambio de estilo'}` });
    const cc = contentCount();
    if (cc) {
      const first = ctx.allEdits().find((e) => e.content?.changeCount)?.content;
      chips.push({ tab: 'content', ic: 'text', label: cc > 1 || !first ? `${cc} textos editados` : `texto: ${first.shortSummary()}` });
    }
    const mv = moves()[0];
    if (mv) chips.push({ tab: 'struct', ic: 'move', label: `mover ${mv.from} → ${mv.to}` });
    if (ctx.binding) {
      const queue = queueFor(ctx.binding.groupId, opts.groups?.comments() ?? []);
      chips.push({ tab: 'queue', ic: 'queue', label: `Grupo ${ctx.binding.groupId} · paso ${bindingStep(ctx.binding, queue)}` });
    }
    box.hidden = chips.length === 0;
    if (!chips.length) return;
    box.setAttribute('aria-label', 'Incluye este comentario');
    box.appendChild(mk('small', undefined, 'Incluye'));
    for (const c of chips) {
      const b = mk('button', 'pf-ov-ichip');
      b.type = 'button';
      b.append(icon(doc, c.ic, 13), doc.createTextNode(c.label));
      onc(b, 'click', () => setTab(c.tab));
      box.appendChild(b);
    }
  }

  function paintFoot(box: HTMLElement): void {
    box.textContent = '';
    if (ctx.error) {
      const e = mk('p', 'pf-ov-error', ctx.error);
      e.setAttribute('role', 'alert');
      box.appendChild(e);
    }
    const keys = mk('div', 'pf-ov-keys');
    const k = (a: string[], t: string) => {
      const s = mk('span');
      for (const x of a) s.appendChild(mk('kbd', undefined, x));
      s.appendChild(doc.createTextNode(` ${t}`));
      return s;
    };
    keys.append(k(['Ctrl', '↵'], 'guardar'), k(['Esc'], 'cancelar'));
    const cancel = tbtn('pf-btn', 'Cancelar', () => opts.onClose());
    cancel.disabled = ctx.busy;
    const save = mk('button', 'pf-btn pf-btn--primary');
    save.type = 'button';
    save.disabled = ctx.busy;
    save.textContent = ctx.busy ? 'Guardando…' : ctx.binding ? 'Guardar en la cola' : 'Guardar';
    onc(save, 'click', () => void doSave());
    const remove = tbtn('pf-btn', 'Eliminar elemento', () => void doSave(true));
    remove.disabled = ctx.busy;
    remove.title = 'Guarda un comentario pidiendo eliminar este elemento (la nota es opcional)';
    remove.setAttribute('data-pf-remove', '');
    const bar = mk('div', 'pf-ov-actions');
    bar.append(keys, cancel, ...(isView() ? [] : [remove]), save);
    box.appendChild(bar);
    root.setAttribute('aria-busy', String(ctx.busy));
  }

  // --- Foco, navegación y selección ---------------------------------------------------------------------

  function afterFocusChange(selectionChanged = false): void {
    copyOpen = false;
    if (selectionChanged && sel.size === 0) scope = 'view';
    paintAll();
    opts.onFocusChange();
  }

  function navigate(dir: NavDir): void {
    const n = sel.focus;
    if (!n || isView() || ctx.busy) return;
    const next = navTarget(n.el, dir, childStack);
    if (!next) return;
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
    if (s === 'view' && tab !== 'comment' && tab !== 'queue') tab = 'comment';
    afterFocusChange();
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
      if (tab !== 'comment') setTab('comment');
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
      if (tab !== 'comment') setTab('comment');
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
    get nodes() {
      return scope === 'view' ? [] : sel.nodes.map((n) => n.el);
    },
    reorderIndicator() {
      if (tab !== 'struct') return null;
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
    handleKey(e, info) {
      const act = interpretEditorKey(e, { typing: info.typing, own: info.own, hasElement: !isView() });
      if (!act) return false;
      if (act.type === 'cancel') {
        if (copyOpen) {
          copyOpen = false;
          paint('head');
        } else opts.onClose();
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
      if (tab !== 'comment') tab = 'comment';
      paint('tabs');
      paint('body');
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
  const movable = makeMovable(root, regions.head, { kind: 'editor', onMoved: (p) => !p && opts.onPanelReset?.() });
  cleanups.push(() => movable.destroy());
  paintAll();
  return handle;
}
