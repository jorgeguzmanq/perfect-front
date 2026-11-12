import type { FrameRef } from '@perfect-front/shared';
import { PINS_ATTR, isPfNode } from './constants';
import { isTopWindow } from './frame';
import { injectStylesIntoShadowRoot } from './styles';
import { describe, h } from './dom';
import { asLin, chip, key, warn, type DeckTone } from './deck';
import type { CommentsApi } from './groups';

/** Subconjunto de VisualComment que usan los pines (contrato de GET {base}/comments). */
export interface PinComment {
  id: string;
  status: string;
  scope: string;
  comment: string;
  location: { route: string; selector: string | null; selectorCandidates?: string[]; frame?: FrameRef | null };
  elementRect?: unknown;
  group?: { id: string; position: number } | null;
  createdAt?: string;
  /** Para el control de concurrencia al editar desde el popover. */
  updatedAt?: string;
}

export interface PinsOptions {
  document?: Document;
  loadComments(): Promise<PinComment[]>;
  /** Se llama tras cada redibujado con los totales (alimenta el lanzador). */
  onStats?(s: { total: number; here: number; located: number; route: string }): void;
  /** Editar/eliminar desde el popover del pin. Sin él, el popover es de solo lectura (estado, nota y «Ir al nodo»). */
  comments?: CommentsApi | null;
  /** Nombre legible de un grupo (por id) para «Grupo A · paso 2». */
  groupName?(id: string): string | undefined;
  /** Tras editar o eliminar (el llamador refresca el cajón y demás). */
  onChanged?(): void;
  /** Cambios de estado detectados al recargar (otro cliente, el agente o la CLI): alimenta avisos y feedback del pin. */
  onTransitions?(list: PinTransition[]): void;
}

/** Un comentario que cambió de estado entre dos cargas. `n` es el número de pin (null si no lo tuvo). */
export interface PinTransition {
  comment: PinComment;
  from: string;
  to: string;
  n: number | null;
}

export interface PinsHandle {
  /** Vuelve a pedir los comentarios y redibuja. */
  refresh(): Promise<void>;
  /** Redibuja con los comentarios ya cargados (p. ej. tras navegar). */
  relocate(): void;
  destroy(): void;
  /** Comentarios abiertos (pendientes o en curso), con o sin pin. */
  readonly total: number;
  /** Abiertos de la ruta actual. */
  readonly here: number;
  /** Abiertos de la ruta actual que tienen pin. */
  readonly located: number;
}

const OPEN = new Set(['pending', 'in_progress']);
const RELOCATE_DELAYS = [150, 600, 1500];
const STATUS_LABEL: Record<string, string> = { pending: 'Pendiente', in_progress: 'En curso' };
const STATUS_TONE: Record<string, DeckTone> = { pending: 'amber', in_progress: 'teal' };
const POP_GAP = 10;
const FLASH_MS = 1400;
/** Pulso «en curso» y fantasma «resuelto» (verde y se atenúa). */
const LIVE_WORKING_MS = 2600;
const LIVE_DONE_MS = 2200;
const CLOSED = new Set(['resolved', 'archived']);

const routeOf = (doc: Document) => (doc.location.pathname || '/') + (doc.location.search || '');

function sameRoute(commentRoute: string, doc: Document): boolean {
  if (commentRoute === routeOf(doc)) return true;
  // Una ruta guardada sin query coincide con cualquier query de la misma ruta.
  return !commentRoute.includes('?') && commentRoute === (doc.location.pathname || '/');
}

function resolve(doc: Document, c: PinComment): Element | null {
  const sels = [c.location.selector, ...(c.location.selectorCandidates ?? [])].filter(
    (s): s is string => typeof s === 'string' && s.length > 0,
  );
  for (const s of sels) {
    try {
      const el = doc.querySelector(s);
      if (el && !isPfNode(el)) return el;
    } catch {
      /* selector inválido: se prueba el siguiente */
    }
  }
  return null;
}

interface Entry {
  n: number;
  comment: PinComment;
  el: Element | null;
  pin: HTMLButtonElement | null;
}

export function createPins(opts: PinsOptions): PinsHandle {
  const doc = opts.document ?? document;
  const win = doc.defaultView;

  const host = doc.createElement('div');
  host.setAttribute(PINS_ATTR, '');
  const shadow = host.attachShadow({ mode: 'open' });
  injectStylesIntoShadowRoot(shadow, doc);
  const layer = doc.createElement('div');
  layer.className = 'pf-root pf-pins-layer';
  shadow.appendChild(layer);
  doc.documentElement.appendChild(host);

  let destroyed = false;
  let all: PinComment[] = [];
  let entries: Entry[] = [];
  /** Pines «fantasma» de comentarios recién resueltos: no son interactivos y desaparecen solos. */
  let ghosts: Entry[] = [];
  let stats = { total: 0, here: 0, located: 0 };
  let frame: ReturnType<typeof setTimeout> | number = 0;
  const cleanups: Array<() => void> = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const listen = (t: EventTarget, type: string, fn: () => void, o?: boolean) => {
    t.addEventListener(type, fn, o);
    cleanups.push(() => t.removeEventListener(type, fn, o));
  };

  const place = (e: Entry) => {
    if (!e.pin) return;
    if (!e.el || !e.el.isConnected) e.el = resolve(doc, e.comment);
    const r = e.el?.getBoundingClientRect();
    if (!e.el || !r || (r.width === 0 && r.height === 0)) {
      e.pin.hidden = true;
      return;
    }
    e.pin.hidden = false;
    e.pin.style.left = `${r.right - 8}px`;
    e.pin.style.top = `${r.top - 8}px`;
  };

  // --- Popover del pin (capa 13 «pin»): estado, nota, grupo y paso + ir al nodo, editar, eliminar ------------------
  type PopMode = 'view' | 'edit' | 'confirm';
  let openId: string | null = null;
  let popMode: PopMode = 'view';
  let pop: HTMLElement | null = null;
  const find = (id: string | null) => (id ? (entries.find((x) => x.comment.id === id) ?? null) : null);

  const placePop = () => {
    const e = find(openId);
    if (!pop || !e?.pin || e.pin.hidden) return;
    const r = e.pin.getBoundingClientRect();
    const vw = win?.innerWidth ?? 0;
    const vh = win?.innerHeight ?? 0;
    const w = pop.offsetWidth;
    const hh = pop.offsetHeight;
    let left = r.right + POP_GAP;
    if (vw && left + w > vw - 8) left = Math.max(8, r.left - POP_GAP - w);
    let top = r.top;
    if (vh && top + hh > vh - 8) top = Math.max(8, vh - hh - 8);
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  };

  const closePop = (refocus: boolean) => {
    const e = find(openId);
    pop?.remove();
    pop = null;
    openId = null;
    popMode = 'view';
    for (const x of entries) x.pin?.removeAttribute('data-open');
    if (refocus) e?.pin?.focus();
  };

  const goToNode = (e: Entry) => {
    if (!e.el?.isConnected) e.el = resolve(doc, e.comment);
    e.el?.scrollIntoView?.({ block: 'center', inline: 'nearest' });
    const pin = e.pin;
    if (!pin) return;
    pin.setAttribute('data-flash', '');
    later(FLASH_MS, () => pin.removeAttribute('data-flash'));
    reposition();
  };

  const errMsg = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

  const renderPop = (e: Entry, error = '') => {
    if (!e.pin) return;
    const c = e.comment;
    pop?.remove();
    const box = h(doc, 'div', 'pf-dk-unit pf-dk-fl-pop');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'false');
    box.setAttribute('aria-label', `Comentario ${e.n}`);
    const head = h(doc, 'div', 'pf-dk-fx pf-dk-g8 pf-dk-fl-pophd');
    const sel = h(doc, 'span', 'pf-dk-ts pf-dk-grow pf-dk-ell', e.el ? describe(e.el) : (c.location.selector ?? ''));
    sel.title = sel.textContent ?? '';
    const closeBtn = key(doc, '', { sq: true, sm: true, variant: 'ghost', icon: 'close', iconSize: 12, ariaLabel: 'Cerrar', onClick: () => closePop(true) });
    head.append(chip(doc, STATUS_LABEL[c.status] ?? c.status, { on: true, led: STATUS_TONE[c.status] ?? 'violet' }), sel, closeBtn);
    box.appendChild(head);
    const body = h(doc, 'div', 'pf-dk-col pf-dk-g8 pf-dk-fl-popbd');
    let first: HTMLElement;
    const backToView = () => {
      popMode = 'view';
      const cur = find(c.id);
      if (cur) renderPop(cur);
    };
    if (popMode === 'edit') {
      const ta = asLin(h(doc, 'textarea'));
      ta.value = c.comment;
      ta.rows = 3;
      ta.setAttribute('aria-label', 'Texto del comentario');
      const save = key(doc, 'Guardar', { sm: true, variant: 'hot' });
      const cancel = key(doc, 'Cancelar', { sm: true, variant: 'ghost', onClick: backToView });
      save.addEventListener('click', () => {
        const text = ta.value.trim();
        if (!text) return renderPop(e, 'El comentario no puede quedar vacío.');
        save.disabled = true;
        void (async () => {
          try {
            await opts.comments!.update(c.id, text, c.updatedAt);
            popMode = 'view';
            opts.onChanged?.();
            await api.refresh();
          } catch (err) {
            const cur = find(c.id);
            if (cur) renderPop(cur, errMsg(err, 'No se pudo guardar el cambio.'));
          }
        })();
      });
      ta.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
          ev.preventDefault();
          save.click();
        }
      });
      const row = h(doc, 'div', 'pf-dk-fx pf-dk-g6');
      row.append(save, cancel);
      body.append(ta, row);
      first = ta;
    } else if (popMode === 'confirm') {
      box.setAttribute('role', 'alertdialog');
      body.appendChild(warn(doc, '¿Eliminar este comentario? No se puede deshacer'));
      const ok = key(doc, 'Eliminar', { sm: true, variant: 'dng' });
      const no = key(doc, 'Cancelar', { sm: true, variant: 'ghost', onClick: backToView });
      ok.addEventListener('click', () => {
        ok.disabled = true;
        void (async () => {
          try {
            await opts.comments!.remove(c.id);
            closePop(false);
            opts.onChanged?.();
            await api.refresh();
          } catch (err) {
            const cur = find(c.id);
            if (cur) renderPop(cur, errMsg(err, 'No se pudo eliminar el comentario.'));
          }
        })();
      });
      const row = h(doc, 'div', 'pf-dk-fx pf-dk-g6');
      row.append(ok, no);
      body.appendChild(row);
      first = no;
    } else {
      body.appendChild(h(doc, 'p', 'pf-dk-tx pf-dk-fl-note', c.comment));
      if (c.group) {
        const g = opts.groupName?.(c.group.id);
        body.appendChild(h(doc, 'p', 'pf-dk-ts', `${g ? `Grupo ${g}` : 'Grupo'} · paso ${c.group.position}`));
      }
      const acts = h(doc, 'div', 'pf-dk-fx pf-dk-g6 pf-dk-fl-acts');
      const go = key(doc, 'Ir al nodo', { sm: true, icon: 'select', iconSize: 14, onClick: () => goToNode(e) });
      acts.appendChild(go);
      if (opts.comments) {
        acts.appendChild(key(doc, '', { sm: true, sq: true, variant: 'ghost', icon: 'edit', iconSize: 14, ariaLabel: 'Editar', onClick: () => ((popMode = 'edit'), renderPop(e)) }));
        acts.appendChild(key(doc, '', { sm: true, sq: true, variant: 'ghost', icon: 'trash', iconSize: 14, ariaLabel: 'Eliminar', onClick: () => ((popMode = 'confirm'), renderPop(e)) }));
      }
      body.appendChild(acts);
      first = go;
    }
    if (error) body.appendChild(warn(doc, error, { bad: true }));
    box.appendChild(body);
    box.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      ev.stopPropagation();
      if (popMode !== 'view') backToView();
      else closePop(true);
    });
    layer.appendChild(box);
    pop = box;
    placePop();
    first.focus();
  };

  const openPop = (e: Entry) => {
    if (openId === e.comment.id) return closePop(true);
    closePop(false);
    openId = e.comment.id;
    popMode = 'view';
    e.pin?.setAttribute('data-open', '');
    renderPop(e);
  };

  const paint = () => {
    if (destroyed) return;
    for (const e of entries) e.pin?.remove();
    const open = all
      .filter((c) => OPEN.has(c.status))
      .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
    entries = open.map((comment, i) => ({ n: i + 1, comment, el: null, pin: null }));
    let here = 0;
    let located = 0;
    for (const e of entries) {
      // Un comentario hecho dentro de un marco se pinta en el marco (su propia capa); la ventana superior no lo cuenta.
      if (e.comment.location.frame && isTopWindow(win)) continue;
      if (!sameRoute(e.comment.location.route, doc)) continue;
      here++;
      if (e.comment.scope !== 'element') continue;
      e.el = resolve(doc, e.comment);
      if (!e.el) continue;
      located++;
      const pin = doc.createElement('button');
      pin.type = 'button';
      pin.className = 'pf-pin';
      pin.textContent = String(e.n);
      pin.setAttribute('aria-label', `Comentario ${e.n}: ${e.comment.comment.slice(0, 200)}`);
      const tip = doc.createElement('span');
      tip.className = 'pf-pin__tip';
      tip.setAttribute('role', 'tooltip');
      tip.textContent = e.comment.comment.slice(0, 300);
      pin.appendChild(tip);
      pin.setAttribute('aria-haspopup', 'dialog');
      if (e.comment.group) pin.classList.add('pf-pin--g');
      pin.addEventListener('click', () => openPop(e));
      layer.appendChild(pin);
      e.pin = pin;
      place(e);
    }
    // El popover abierto sobrevive al redibujado si su pin sigue ahí (en edición/confirmación no se reconstruye).
    if (openId) {
      const cur = find(openId);
      if (!cur?.pin) closePop(false);
      else {
        cur.pin.setAttribute('data-open', '');
        if (popMode === 'view') renderPop(cur);
        else placePop();
      }
    }
    stats = { total: entries.length, here, located };
    opts.onStats?.({ ...stats, route: routeOf(doc) });
  };

  const reposition = () => {
    if (frame || destroyed) return;
    const run = () => {
      frame = 0;
      for (const e of entries) place(e);
      for (const g of ghosts) place(g);
      placePop();
    };
    frame = win?.requestAnimationFrame ? win.requestAnimationFrame(run) : setTimeout(run, 16);
  };

  const working = (e: Entry | undefined) => {
    const pin = e?.pin;
    if (!pin) return;
    pin.setAttribute('data-live', 'working');
    later(LIVE_WORKING_MS, () => pin.removeAttribute('data-live'));
  };

  const ghost = (old: Entry | undefined, t: PinTransition) => {
    if (!old?.pin || old.pin.hidden) return; // no tenía pin visible: nada que animar
    const pin = doc.createElement('span');
    pin.className = 'pf-pin pf-pin--ghost';
    pin.textContent = String(old.n);
    pin.setAttribute('aria-hidden', 'true');
    pin.setAttribute('data-live', 'done');
    layer.appendChild(pin);
    const g: Entry = { n: old.n, comment: t.comment, el: old.el, pin: pin as unknown as HTMLButtonElement };
    ghosts.push(g);
    place(g);
    later(LIVE_DONE_MS, () => {
      pin.remove();
      ghosts = ghosts.filter((x) => x !== g);
    });
  };

  const later = (ms: number, fn: () => void) => {
    const t = setTimeout(() => {
      timers.delete(t);
      if (!destroyed) fn();
    }, ms);
    timers.add(t);
  };

  const relocate = () => {
    paint();
    // Una SPA renderiza la vista nueva después de cambiar la URL: reintenta unos instantes.
    for (const ms of RELOCATE_DELAYS) later(ms, paint);
  };

  listen(
    doc,
    'click',
    ((ev: Event) => {
      if (openId && !ev.composedPath().includes(host)) closePop(false);
    }) as () => void,
    true,
  );
  listen(doc, 'scroll', reposition, true);
  if (win) listen(win, 'resize', reposition);
  let mutTimer: ReturnType<typeof setTimeout> | null = null;
  const MO = win?.MutationObserver ?? (typeof MutationObserver !== 'undefined' ? MutationObserver : null);
  const mo = MO
    ? new MO(() => {
        if (mutTimer) clearTimeout(mutTimer);
        mutTimer = setTimeout(() => {
          mutTimer = null;
          if (destroyed) return;
          if (entries.some((e) => !e.el || !e.el.isConnected)) paint();
          else reposition();
        }, 300);
      })
    : null;
  if (mo && doc.body) mo.observe(doc.body, { childList: true, subtree: true });

  const api: PinsHandle = {
    async refresh() {
      let next: PinComment[];
      try {
        next = await opts.loadComments();
      } catch {
        // Sin servidor se conserva lo ya cargado; el contador queda como estaba.
        return;
      }
      const prev = new Map(all.map((c) => [c.id, c] as const));
      const prevN = new Map(entries.map((e) => [e.comment.id, e] as const));
      const hadSnapshot = prev.size > 0;
      all = next;
      paint();
      if (!hadSnapshot || destroyed) return;
      const list: PinTransition[] = [];
      for (const c of next) {
        const old = prev.get(c.id);
        if (!old || old.status === c.status) continue;
        const now = entries.find((e) => e.comment.id === c.id);
        list.push({ comment: c, from: old.status, to: c.status, n: prevN.get(c.id)?.n ?? now?.n ?? null });
      }
      if (!list.length) return;
      for (const t of list) {
        if (t.to === 'in_progress') working(entries.find((e) => e.comment.id === t.comment.id));
        else if (CLOSED.has(t.to)) ghost(prevN.get(t.comment.id), t);
      }
      opts.onTransitions?.(list);
    },
    relocate,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      closePop(false);
      for (const fn of cleanups) fn();
      mo?.disconnect();
      if (mutTimer) clearTimeout(mutTimer);
      for (const t of timers) clearTimeout(t);
      timers.clear();
      host.remove();
      entries = [];
      ghosts = [];
    },
    get total() {
      return stats.total;
    },
    get here() {
      return stats.here;
    },
    get located() {
      return stats.located;
    },
  };
  return api;
}
