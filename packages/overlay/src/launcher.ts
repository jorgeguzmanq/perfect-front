import { LAUNCHER_ATTR } from './constants';
import { makeMovable } from './drag-panel';
import { icon } from './icons';
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
  showHint(text?: string): void;
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
  const main = button('pf-ln-main');
  const label = el('span', 'pf-ln-label', 'Comentar');
  const badge = el('span', 'pf-ln-badge', '0');
  main.append(icon(doc, 'comment'), label, badge);
  const more = button('pf-ln-more');
  more.setAttribute('aria-label', 'Más opciones de la capa');
  more.setAttribute('aria-haspopup', 'menu');
  more.setAttribute('aria-expanded', 'false');
  more.title = 'Más opciones';
  more.append(icon(doc, 'layers'));
  const grip = el('span', 'pf-ln-grip');
  grip.setAttribute('aria-hidden', 'true');
  grip.textContent = '⋮⋮';
  group.append(grip, main, more);

  const menu = el('div', 'pf-ln-menu');
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Opciones de la capa');
  menu.hidden = true;
  const itemHide = button('pf-ln-item', 'Ocultar capa');
  const itemList = button('pf-ln-item', 'Ver comentarios');
  const itemComments = opts.onOpenComments ? button('pf-ln-item', 'Comentarios') : null;
  const itemCapture = opts.onCaptureNode ? button('pf-ln-item', 'Capturar nodo · Alt+Mayús+S') : null;
  for (const i of [itemComments, itemCapture, itemHide, itemList]) i?.setAttribute('role', 'menuitem');
  const info = el('p', 'pf-ln-info');
  info.setAttribute('role', 'status');
  info.hidden = true;
  if (itemComments) menu.appendChild(itemComments);
  if (itemCapture) menu.appendChild(itemCapture);
  menu.append(itemList, itemHide, info);

  // Capa oculta: solo una pestaña mínima.
  const tab = button('pf-ln-tab', 'Mostrar capa');
  tab.setAttribute('aria-label', 'Mostrar capa de comentarios');
  tab.hidden = true;

  // Aviso.
  const toast = el('div', 'pf-ln-toast');
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  const toastText = el('span');
  const toastClose = button('pf-ln-toastx');
  toastClose.setAttribute('aria-label', 'Cerrar aviso');
  toastClose.append(icon(doc, 'close'));
  toast.append(toastText, toastClose);
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
      if (!info.hidden) renderInfo();
    },
    showHint(text = HINT_TEXT) {
      if (gone) return;
      toastText.textContent = text;
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
