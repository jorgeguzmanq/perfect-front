import { LAUNCHER_ATTR } from './constants';
import { makeMovable } from './drag-panel';
import { icon, type IconName } from './icons';
import { led } from './deck';
import { injectStylesIntoShadowRoot } from './styles';

export const HINT_TEXT = 'Capa de comentarios activa · Alt+clic sobre cualquier elemento, o pulsa Comentar';
const HINT_MS = 6000;

export interface LauncherOptions {
  document?: Document;
  /** Alterna el modo selección del overlay. */
  onToggleSelect(): void;
  /** «Ocultar capa» (equivale a disable()). */
  onHide(): void;
  /** «Mostrar capa» (equivale a enable()). */
  onShow(): void;
  /** Si se da, el menú añade «Comentarios», que abre el cajón de comentarios. */
  onOpenComments?(): void;
  /** Si se da, el menú añade «Capturar nodo» (Alt+Mayús+S): abre la captura del nodo seleccionado. */
  onCaptureNode?(): void;
}

export interface LauncherStats {
  total: number;
  here: number;
  route: string;
}

export interface LauncherHandle {
  readonly host: HTMLElement;
  /** Contenedor `.pf-root` del Shadow Root del lanzador (donde se monta el cajón). */
  readonly layer: HTMLElement;
  setLayerOn(on: boolean): void;
  setSelecting(on: boolean): void;
  setStats(s: LauncherStats): void;
  /** Aviso breve (aria-live polite) que se autodescarta. */
  showHint(text?: string, action?: { label: string; run(): void }): void;
  /** Oculta el lanzador sin quitarlo. Ya no se usa en las capturas (se excluyen con isPfNode, sin parpadeo). */
  setHidden(hidden: boolean): void;
  destroy(): void;
}

/** Lanzador flotante siempre visible: botón Comentar con insignia, menú y pestaña «Mostrar capa». */
export function createLauncher(opts: LauncherOptions): LauncherHandle {
  const doc = opts.document ?? document;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const button = (cls: string, text?: string) => {
    const b = el('button', cls, text);
    b.type = 'button';
    return b;
  };

  const host = el('div');
  host.setAttribute(LAUNCHER_ATTR, '');
  const shadow = host.attachShadow({ mode: 'open' });
  injectStylesIntoShadowRoot(shadow, doc);
  const root = el('div', 'pf-root pf-ln');

  // Estado activo.
  const group = el('div', 'pf-ln-group');
  const main = button('pf-ln-main pf-dk-key pf-dk-key--hot');
  const label = el('span', 'pf-ln-label', 'Comentar');
  const badge = el('span', 'pf-ln-badge pf-dk-cnt', '0');
  main.append(icon(doc, 'comment'), label, badge);
  const more = button('pf-ln-more pf-dk-key pf-dk-key--sq');
  more.setAttribute('aria-label', 'Más opciones de la capa');
  more.setAttribute('aria-haspopup', 'menu');
  more.setAttribute('aria-expanded', 'false');
  more.title = 'Más opciones';
  more.append(icon(doc, 'layers'));
  const grip = el('span', 'pf-ln-grip');
  grip.setAttribute('aria-hidden', 'true');
  grip.textContent = '⠿';
  group.classList.add('pf-dk-dock');
  group.append(grip, main, more);

  const menu = el('div', 'pf-ln-menu pf-dk-unit');
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Opciones de la capa');
  menu.hidden = true;
  const item = (text: string, ic: IconName) => {
    const b = button('pf-ln-item pf-dk-key pf-dk-key--ghost');
    b.append(icon(doc, ic, 16), doc.createTextNode(text));
    return b;
  };
  const itemHide = item('Ocultar capa', 'eyeoff');
  const itemList = item('Ver comentarios', 'queue');
  const itemComments = opts.onOpenComments ? item('Comentarios', 'list') : null;
  const itemCapture = opts.onCaptureNode ? item('Capturar nodo · Alt+Mayús+S', 'cam') : null;
  // Resumen del menú (pendientes y los de esta ruta), con el estilo de pantalla del deck.
  const cell = (caption: string) => {
    const c = el('div', 'pf-dk-lcd pf-ln-stat');
    const n = el('div', 'pf-dk-t1', '0');
    c.append(n, el('div', 'pf-dk-ts', caption));
    return { c, n };
  };
  const statTotal = cell('pendientes');
  const statHere = cell('en esta ruta');
  const statsRow = el('div', 'pf-dk-fx pf-dk-g8 pf-ln-stats');
  statsRow.append(statTotal.c, statHere.c);
  for (const i of [itemComments, itemCapture, itemHide, itemList]) i?.setAttribute('role', 'menuitem');
  const info = el('p', 'pf-ln-info pf-dk-ts');
  info.setAttribute('role', 'status');
  info.hidden = true;
  menu.appendChild(statsRow);
  if (itemComments) menu.appendChild(itemComments);
  if (itemCapture) menu.appendChild(itemCapture);
  menu.append(itemList, itemHide, info);

  // Capa oculta: solo una pestaña mínima.
  const tab = button('pf-ln-tab pf-dk-key', 'Mostrar capa');
  tab.setAttribute('aria-label', 'Mostrar capa de comentarios');
  tab.hidden = true;

  // Aviso.
  const toast = el('div', 'pf-ln-toast pf-dk-lcd pf-dk-lp pf-dk-fx pf-dk-g12');
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  const toastText = el('span', 'pf-dk-tx pf-dk-grow');
  const toastAct = button('pf-ln-toasta pf-dk-key pf-dk-key--sm');
  toastAct.hidden = true;
  const toastClose = button('pf-ln-toastx pf-dk-key pf-dk-key--sm pf-dk-key--sq pf-dk-key--ghost');
  toastClose.setAttribute('aria-label', 'Cerrar aviso');
  toastClose.append(icon(doc, 'close', 12));
  toast.append(led(doc, true, 'green'), toastText, toastAct, toastClose);
  let toastRun: (() => void) | null = null;
  toast.hidden = true;

  root.append(toast, menu, group, tab);
  shadow.appendChild(root);
  doc.documentElement.appendChild(host);

  // Reposicionado unificado (módulo drag-panel): el menú y el aviso siguen al grupo cuando se mueve.
  const follow = (p: { left: number; top: number } | null) => {
    for (const n of [menu, toast]) {
      for (const s of ['left', 'right', 'top', 'bottom'] as const) n.style[s] = '';
    }
    if (!p) return;
    const vh = doc.defaultView?.innerHeight ?? 0;
    const above = p.top > (vh || 0) / 2;
    menu.style.right = toast.style.right = 'auto';
    menu.style.left = toast.style.left = `${p.left}px`;
    if (above) {
      menu.style.bottom = `${vh - p.top + 8}px`;
      toast.style.bottom = `${vh - p.top + 8}px`;
    } else {
      menu.style.top = toast.style.top = `${p.top + group.getBoundingClientRect().height + 8}px`;
      menu.style.bottom = toast.style.bottom = 'auto';
    }
  };
  const movable = makeMovable(group, grip, { kind: 'launcher', onMoved: follow });

  let layerOn = true;
  let selecting = false;
  let stats: LauncherStats = { total: 0, here: 0, route: '/' };
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  let gone = false;

  const renderMain = () => {
    label.textContent = selecting ? 'Selecciona un elemento…' : 'Comentar';
    main.classList.toggle('pf-ln-main--on', selecting);
    main.classList.toggle('pf-dk-key--lit', selecting);
    main.classList.toggle('pf-dk-key--hot', !selecting);
    main.setAttribute('aria-pressed', String(selecting));
    main.setAttribute(
      'aria-label',
      selecting
        ? `Selecciona un elemento para comentar. ${stats.total} pendientes. Pulsa para cancelar`
        : `Comentar: elegir un elemento. ${stats.total} pendientes`,
    );
    main.title = selecting ? 'Esc para salir' : 'Alt+clic sobre cualquier elemento también comenta';
    badge.textContent = String(stats.total);
  };
  const renderStats = () => {
    statTotal.n.textContent = String(stats.total);
    statHere.n.textContent = String(stats.here);
  };
  const renderInfo = () => {
    info.textContent = `${stats.total} pendientes · ${stats.route} · ${stats.here} en esta ruta`;
  };
  const renderLayer = () => {
    group.hidden = !layerOn;
    tab.hidden = layerOn;
    if (!layerOn) closeMenu(false);
  };

  function closeMenu(refocus: boolean) {
    if (menu.hidden) return;
    menu.hidden = true;
    info.hidden = true;
    more.setAttribute('aria-expanded', 'false');
    if (refocus) more.focus();
  }
  const openMenu = () => {
    renderStats();
    menu.hidden = false;
    more.setAttribute('aria-expanded', 'true');
    (itemComments ?? itemList).focus();
  };
  const toggleMenu = () => (menu.hidden ? openMenu() : closeMenu(true));

  const listeners: Array<() => void> = [];
  const on = (t: EventTarget, type: string, fn: (e: Event) => void, o?: boolean) => {
    t.addEventListener(type, fn, o);
    listeners.push(() => t.removeEventListener(type, fn, o));
  };

  on(main, 'click', () => {
    closeMenu(false);
    opts.onToggleSelect();
  });
  on(main, 'contextmenu', (e) => {
    e.preventDefault();
    toggleMenu();
  });
  on(more, 'click', toggleMenu);
  on(itemList, 'click', () => {
    renderInfo();
    info.hidden = !info.hidden;
  });
  if (itemComments) {
    on(itemComments, 'click', () => {
      closeMenu(false);
      opts.onOpenComments?.();
    });
  }
  if (itemCapture) {
    on(itemCapture, 'click', () => {
      closeMenu(false);
      opts.onCaptureNode?.();
    });
  }
  on(itemHide, 'click', () => {
    closeMenu(false);
    opts.onHide();
  });
  on(tab, 'click', () => opts.onShow());
  on(toastClose, 'click', () => hideToast());
  on(toastAct, 'click', () => {
    const run = toastRun;
    hideToast();
    run?.();
  });
  on(menu, 'keydown', (e) => {
    const k = (e as KeyboardEvent).key;
    if (k !== 'ArrowDown' && k !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...(itemComments ? [itemComments] : []), ...(itemCapture ? [itemCapture] : []), itemList, itemHide];
    const i = items.findIndex((b) => shadow.activeElement === b);
    items[(i + (k === 'ArrowDown' ? 1 : items.length - 1)) % items.length]!.focus();
  });
  on(root, 'keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Escape' && !menu.hidden) {
      e.stopPropagation();
      closeMenu(true);
    }
  });
  // Clic fuera del lanzador cierra el menú (sin bloquearlo).
  on(
    doc,
    'click',
    (e) => {
      if (!menu.hidden && !e.composedPath().includes(host)) closeMenu(false);
    },
    true,
  );

  function hideToast() {
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = null;
    toast.hidden = true;
    toastRun = null;
    toastAct.hidden = true;
  }

  renderMain();
  renderLayer();

  return {
    host,
    layer: root,
    setLayerOn(v) {
      layerOn = v;
      if (!v) selecting = false;
      renderLayer();
      renderMain();
    },
    setSelecting(v) {
      selecting = v;
      renderMain();
    },
    setStats(s) {
      stats = s;
      renderMain();
      renderStats();
      if (!info.hidden) renderInfo();
    },
    showHint(text = HINT_TEXT, action) {
      if (gone) return;
      toastText.textContent = text;
      toastRun = action?.run ?? null;
      toastAct.hidden = !action;
      if (action) toastAct.textContent = action.label;
      toast.hidden = false;
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(hideToast, HINT_MS);
    },
    setHidden(h) {
      host.style.visibility = h ? 'hidden' : '';
    },
    destroy() {
      if (gone) return;
      gone = true;
      hideToast();
      movable.destroy();
      for (const fn of listeners) fn();
      host.remove();
    },
  };
}
