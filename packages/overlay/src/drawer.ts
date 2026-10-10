import type { CommentId, ReadingGroup } from '@perfect-front/shared';
import { h } from './dom';
import { makeMovable } from './drag-panel';
import { groupBrief, queueFor, slugGroupId, type GroupsApi, type QueueComment } from './groups';
import { icon, type IconName } from './icons';
import { writeClipboard } from './location-copy';

/**
 * Cajón de comentarios: lectura y orden de la cola, aparte del editor. Pestañas Abiertos · Grupos · Resueltos.
 * No guarda estado de servidor: pide datos con `load()` y escribe con `GroupsApi`.
 */

export interface DrawerOptions {
  doc: Document;
  layer: HTMLElement;
  /** Comentarios y grupos actuales (el orquestador los carga; el cajón llama a esto al abrir y tras cada cambio). */
  load(): Promise<{ comments: QueueComment[]; groups: ReadingGroup[] }>;
  api: GroupsApi;
  /** Ruta actual (cabecera). */
  route(): string;
  /** Saltar al nodo de un comentario (pin). */
  onGoto?(c: QueueComment): void;
  /** «Añadir» comentario a un grupo: abre el editor con ese grupo preseleccionado. */
  onAddToGroup?(groupId: string): void;
  announce?(msg: string): void;
}

export interface DrawerHandle {
  open(tab?: DrawerTab): void;
  close(): void;
  toggle(): void;
  refresh(): Promise<void>;
  readonly isOpen: boolean;
  destroy(): void;
}

export type DrawerTab = 'open' | 'groups' | 'done';

const OPEN = new Set(['pending', 'in_progress']);
const DONE = new Set(['resolved', 'archived', 'ignored']);
const STATUS_LABEL: Record<string, string> = { pending: 'Pendiente', in_progress: 'En curso', resolved: 'Resuelto', ignored: 'Ignorado', archived: 'Archivado' };
const where = (c: QueueComment) => (c.location.selector ? c.location.selector.split(' > ').pop()! : 'vista');

export function createDrawer(opts: DrawerOptions): DrawerHandle {
  const doc = opts.doc;
  let tab: DrawerTab = 'open';
  let isOpen = false;
  let destroyed = false;
  let data: { comments: QueueComment[]; groups: ReadingGroup[] } = { comments: [], groups: [] };
  let newGroupOpen = false;
  let dragId: string | null = null;

  const root = h(doc, 'aside', 'pf-dw');
  root.hidden = true;
  root.setAttribute('role', 'complementary');
  root.setAttribute('aria-label', 'Comentarios');
  opts.layer.appendChild(root);
  // Asa estable: la cabecera se repinta dentro de ella.
  const grip = h(doc, 'div', 'pf-dw-grip');
  const movable = makeMovable(root, grip, { kind: 'drawer' });

  const offs: Array<() => void> = [];
  const on = <E extends Event = Event>(t: EventTarget, type: string, fn: (e: E) => void) => {
    t.addEventListener(type, fn as (e: Event) => void);
    offs.push(() => t.removeEventListener(type, fn as (e: Event) => void));
  };

  const say = (m: string) => opts.announce?.(m);

  const groupTag = (c: QueueComment): string | null => (c.group ? `${c.group.id}·${c.group.position}` : null);

  function item(c: QueueComment): HTMLElement {
    const b = h(doc, 'button', DONE.has(c.status) ? 'pf-dw-ci pf-dw-ci--done' : 'pf-dw-ci');
    b.type = 'button';
    const n = h(doc, 'span', 'pf-ov-qn');
    if (DONE.has(c.status)) n.appendChild(icon(doc, 'check', 12));
    else n.textContent = String(data.comments.filter((x) => OPEN.has(x.status)).indexOf(c) + 1);
    const body = h(doc, 'div');
    const small = h(doc, 'small');
    small.append(h(doc, 'span', `pf-chip pf-chip--${c.status}`, STATUS_LABEL[c.status] ?? c.status), doc.createTextNode(where(c)));
    const g = groupTag(c);
    if (g) small.appendChild(h(doc, 'span', 'pf-dw-gtag', g));
    body.append(h(doc, 'p', undefined, c.comment.slice(0, 160)), small);
    b.append(n, body);
    on(b, 'click', () => opts.onGoto?.(c));
    return b;
  }

  function groupCard(g: ReadingGroup): HTMLElement {
    const card = h(doc, 'div', 'pf-dw-gcard');
    const head = h(doc, 'header');
    head.appendChild(h(doc, 'span', 'pf-dw-gtag', g.id));
    const t = h(doc, 'div');
    t.append(h(doc, 'b', undefined, g.name), h(doc, 'small', undefined, g.note.slice(0, 160)));
    head.appendChild(t);
    card.appendChild(head);

    const queue = queueFor(g.id, data.comments);
    const list = h(doc, 'div', 'pf-ov-q pf-dw-q');
    queue.forEach((c, i) => {
      const qi = h(doc, 'div', c.status === 'resolved' ? 'pf-ov-qi pf-ov-qi--done' : 'pf-ov-qi');
      qi.draggable = true;
      const qc = h(doc, 'div', 'pf-ov-qc');
      const small = h(doc, 'small');
      small.append(icon(doc, 'grip', 12), h(doc, 'span', `pf-chip pf-chip--${c.status}`, STATUS_LABEL[c.status] ?? c.status), doc.createTextNode(where(c)));
      qc.append(h(doc, 'p', undefined, c.comment.slice(0, 120)), small);
      qi.append(h(doc, 'span', 'pf-ov-qn', String(i + 1)), qc);
      on<DragEvent>(qi, 'dragstart', (e) => {
        dragId = c.id;
        e.dataTransfer?.setData('text/plain', c.id);
      });
      on<DragEvent>(qi, 'dragover', (e) => {
        if (dragId) {
          e.preventDefault();
          qi.classList.add('pf-ov-qi--over');
        }
      });
      on(qi, 'dragleave', () => qi.classList.remove('pf-ov-qi--over'));
      on<DragEvent>(qi, 'drop', (e) => {
        e.preventDefault();
        qi.classList.remove('pf-ov-qi--over');
        const from = dragId;
        dragId = null;
        if (!from || from === c.id) return;
        const ids = queue.map((x) => x.id).filter((id) => id !== from);
        ids.splice(ids.indexOf(c.id), 0, from);
        void api(() => opts.api.reorderGroup(g.id, { order: ids as CommentId[] }), 'No se pudo reordenar la cola.');
      });
      list.appendChild(qi);
    });
    if (!queue.length) list.appendChild(h(doc, 'p', 'pf-ov-hint', 'Aún no hay comentarios en este grupo.'));
    card.appendChild(list);

    const foot = h(doc, 'footer');
    const brief = h(doc, 'button', 'pf-btn pf-btn--sm');
    brief.type = 'button';
    brief.append(icon(doc, 'copy', 12), doc.createTextNode(' Copiar como brief'));
    on(brief, 'click', () => {
      void writeClipboard(doc, groupBrief(g, queue)).then((ok) => say(ok ? 'Brief copiado.' : 'No se pudo copiar al portapapeles.'));
    });
    foot.appendChild(brief);
    if (opts.onAddToGroup) {
      const add = h(doc, 'button', 'pf-btn pf-btn--sm');
      add.type = 'button';
      add.append(icon(doc, 'plus', 12), doc.createTextNode(' Añadir'));
      on(add, 'click', () => opts.onAddToGroup?.(g.id));
      foot.appendChild(add);
    }
    card.appendChild(foot);
    return card;
  }

  function newGroup(): HTMLElement {
    if (!newGroupOpen) {
      const b = h(doc, 'button', 'pf-btn');
      b.type = 'button';
      b.append(icon(doc, 'plus', 13), doc.createTextNode(' Grupo nuevo'));
      on(b, 'click', () => {
        newGroupOpen = true;
        paint();
      });
      return b;
    }
    const row = h(doc, 'div', 'pf-ov-row');
    const name = h(doc, 'input', 'pf-input');
    name.type = 'text';
    name.placeholder = 'Nombre del grupo';
    name.setAttribute('aria-label', 'Nombre del grupo');
    const ok = h(doc, 'button', 'pf-btn pf-btn--primary', 'Crear');
    ok.type = 'button';
    const create = () => {
      const n = name.value.trim();
      if (!n) return;
      const id = slugGroupId(n, new Set(data.groups.map((g) => g.id as string)));
      newGroupOpen = false;
      void api(() => opts.api.createGroup({ id: id as ReadingGroup['id'], name: n, note: '', readFirst: true }).then(() => undefined), 'No se pudo crear el grupo.');
    };
    on(ok, 'click', create);
    on<KeyboardEvent>(name, 'keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        create();
      }
    });
    row.append(name, ok);
    queueMicrotask(() => name.focus());
    return row;
  }

  async function api(fn: () => Promise<void>, errMsg: string): Promise<void> {
    try {
      await fn();
      await refresh();
    } catch {
      say(errMsg);
      paint();
    }
  }

  function paint(): void {
    if (destroyed) return;
    root.textContent = '';
    const head = h(doc, 'div', 'pf-dw-head');
    const title = h(doc, 'h2', undefined, 'Comentarios');
    title.appendChild(h(doc, 'small', undefined, opts.route()));
    const close = h(doc, 'button', 'pf-ov-iconbtn');
    close.type = 'button';
    close.setAttribute('aria-label', 'Cerrar cajón');
    close.title = 'Cerrar';
    close.appendChild(icon(doc, 'close', 14));
    on(close, 'click', () => handle.close());
    head.append(title, close);
    grip.textContent = '';
    grip.appendChild(head);

    const open = data.comments.filter((c) => OPEN.has(c.status));
    const done = data.comments.filter((c) => DONE.has(c.status));
    const tabs = h(doc, 'div', 'pf-ov-tabs');
    tabs.setAttribute('role', 'tablist');
    const defs: Array<[DrawerTab, string, number, IconName]> = [
      ['open', 'Abiertos', open.length, 'list'],
      ['groups', 'Grupos', data.groups.length, 'queue'],
      ['done', 'Resueltos', done.length, 'check'],
    ];
    for (const [id, label, n] of defs) {
      const b = h(doc, 'button', id === tab ? 'pf-ov-tab pf-ov-tab--on' : 'pf-ov-tab');
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(id === tab));
      b.append(h(doc, 'span', undefined, label), h(doc, 'span', 'pf-ov-badge', String(n)));
      on(b, 'click', () => {
        tab = id;
        paint();
      });
      tabs.appendChild(b);
    }

    const body = h(doc, 'div', 'pf-dw-body');
    if (tab === 'open') for (const c of open) body.appendChild(item(c));
    if (tab === 'done') for (const c of done) body.appendChild(item(c));
    if (tab === 'groups') {
      for (const g of data.groups) body.appendChild(groupCard(g));
      body.appendChild(newGroup());
    }
    if (!body.children.length) body.appendChild(h(doc, 'p', 'pf-ov-hint', tab === 'done' ? 'Nada resuelto todavía.' : 'No hay comentarios abiertos.'));
    root.append(grip, tabs, body);
  }

  async function refresh(): Promise<void> {
    try {
      data = await opts.load();
    } catch {
      say('No se pudieron cargar los comentarios.');
    }
    if (isOpen) paint();
  }

  const handle: DrawerHandle = {
    open(t) {
      if (destroyed) return;
      if (t) tab = t;
      isOpen = true;
      root.hidden = false;
      paint();
      void refresh();
    },
    close() {
      isOpen = false;
      root.hidden = true;
      newGroupOpen = false;
    },
    toggle() {
      if (isOpen) handle.close();
      else handle.open();
    },
    refresh,
    get isOpen() {
      return isOpen;
    },
    destroy() {
      destroyed = true;
      movable.destroy();
      for (const f of offs) f();
      root.remove();
    },
  };
  return handle;
}
