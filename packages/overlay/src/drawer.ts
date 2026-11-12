import type { CommentId, ReadingGroup } from '@perfect-front/shared';
import { renderAgentPanel, type AgentPanelState } from './agent-panel';
import { asLin, chip, cnt, key, lcd, led, lrow, num, text, tray, warn, type DeckTone } from './deck';
import { h } from './dom';
import { makeMovable } from './drag-panel';
import { AGENT_LABEL, agentStateFor, groupBrief, queueFor, slugGroupId, type AgentApi, type AgentRequestInfo, type CommentsApi, type GroupsApi, type QueueComment } from './groups';
import { writeClipboard } from './location-copy';
import { NO_SOURCE, OPEN_LABEL, openInCode, targetOfComment, type OpenApi } from './open-code';

/**
 * Cajón de comentarios (capa 10 «Cajón» del deck): lectura y orden de la cola, aparte del editor. Pestañas
 * Abiertos · Grupos · Resueltos, y el panel «Enviar a agente» (capa 11, agent-panel.ts).
 * No guarda estado de servidor: pide datos con `load()` y escribe con `GroupsApi`.
 */

export interface DrawerOptions {
  doc: Document;
  layer: HTMLElement;
  /** Comentarios y grupos actuales (el orquestador los carga; el cajón llama a esto al abrir y tras cada cambio). */
  load(): Promise<{ comments: QueueComment[]; groups: ReadingGroup[]; requests?: AgentRequestInfo[] }>;
  api: GroupsApi;
  /** «Enviar a agente»: si falta, el cajón no muestra los botones. */
  agent?: AgentApi;
  /** Editar/eliminar comentarios guardados: si falta, el cajón no muestra esos botones. */
  comments?: CommentsApi;
  /** «Abrir en el código» (↗): si falta, el cajón no muestra el botón. */
  openCode?: OpenApi;
  /** Tras editar o eliminar (p. ej. para refrescar los pines). */
  onChanged?(): void;
  /** Ruta actual (cabecera). */
  route(): string;
  /** Saltar al nodo de un comentario (pin). */
  onGoto?(c: QueueComment): void;
  /** «Añadir» comentario a un grupo: abre el editor con ese grupo preseleccionado. */
  onAddToGroup?(groupId: string): void;
  announce?(msg: string): void;
}

export interface DrawerHandle {
  open(tab?: DrawerTab, focusId?: string): void;
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
/** LED por estado del comentario (ignorado/archivado: apagado). */
const STATUS_TONE: Record<string, DeckTone | undefined> = { pending: 'amber', in_progress: 'teal', resolved: 'green' };
/** LED de la solicitud al agente: enviada = ámbar, tomada = teal, resuelta = verde. */
const AGENT_TONE: Record<AgentRequestInfo['status'], DeckTone> = { pending: 'amber', taken: 'teal', done: 'green' };
const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);
const where = (c: QueueComment) => (c.location.selector ? c.location.selector.split(' > ').pop()! : 'vista');

export function createDrawer(opts: DrawerOptions): DrawerHandle {
  const doc = opts.doc;
  let tab: DrawerTab = 'open';
  let isOpen = false;
  let destroyed = false;
  let data: { comments: QueueComment[]; groups: ReadingGroup[]; requests?: AgentRequestInfo[] } = { comments: [], groups: [] };
  let newGroupOpen = false;
  let dragId: string | null = null;
  /** Edición en línea y comentario pendiente de confirmar su borrado. */
  let editingId: string | null = null;
  let confirmId: string | null = null;
  /** Vista «Enviar a agente» (capa 11) en lugar de las pestañas. */
  let agentView = false;
  /** Comentario a resaltar al pintar (aviso «Ver» de los cambios en vivo). */
  let focusId: string | null = null;
  const agentState: AgentPanelState = { sub: 'ready', groupId: null, agentRef: '', sent: null };

  const root = h(doc, 'aside', 'pf-dw pf-dk-unit');
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

  /** Chip pequeño: el LED indica el estado de la solicitud al agente más reciente. */
  const agentChip = (status: AgentRequestInfo['status'] | null): HTMLElement | null => {
    if (!status) return null;
    const c = chip(doc, AGENT_LABEL[status], { on: true });
    c.classList.add('pf-dw-gtag');
    c.prepend(led(doc, true, AGENT_TONE[status]));
    return c;
  };

  const gChip = (label: string): HTMLElement => {
    const c = chip(doc, label, { on: true });
    c.classList.add('pf-dw-gtag');
    return c;
  };

  /** Enviar a agente: el widget solo manda IDs, el agente ya está abierto en su terminal. */
  function sendBtn(label: string, req: { commentIds?: string[]; groupId?: string }): HTMLElement {
    return key(doc, label, {
      sm: true,
      icon: 'queue',
      iconSize: 12,
      onClick: () => {
        void api(() => opts.agent!.send(req).then(() => say('Enviado al agente.')), 'No se pudo enviar al agente.');
      },
    });
  }

  /** ↗ Abrir en el código: usa `location.source` (o el archivo:línea del hint); sin fuente queda deshabilitado. */
  function codeBtn(c: QueueComment): HTMLButtonElement {
    const t = targetOfComment(c);
    const label = t ? `${OPEN_LABEL}: ${t.file}:${t.line}` : NO_SOURCE;
    const b = key(doc, '', {
      sq: true,
      sm: true,
      variant: 'ghost',
      icon: 'external',
      iconSize: 13,
      ariaLabel: label,
      disabled: !t,
      cls: 'pf-dw-code',
    });
    b.setAttribute('data-pf-open', '');
    if (t) on(b, 'click', () => void openInCode(opts.openCode!, t, say));
    return b;
  }

  /** Fila de comentario: LED de estado, texto, chips de grupo/agente y acciones. */
  function item(c: QueueComment): HTMLElement {
    if (opts.comments && editingId === c.id) return editForm(c);
    const done = DONE.has(c.status);
    const tone = STATUS_TONE[c.status];
    const body = h(doc, 'button', done ? 'pf-dw-ci pf-dw-ci--done pf-dk-grow' : 'pf-dw-ci pf-dk-grow');
    body.type = 'button';
    const sub = h(doc, 'div', 'pf-dk-ts pf-dw-sub');
    sub.append(doc.createTextNode(`${STATUS_LABEL[c.status] ?? c.status} · ${where(c)}`));
    const g = groupTag(c);
    if (g) sub.appendChild(gChip(g));
    const ac = agentChip(agentStateFor({ commentId: c.id }, data.requests ?? []));
    if (ac) sub.appendChild(ac);
    body.append(text(doc, 'tg', c.comment.slice(0, 160)), sub);
    on(body, 'click', () => opts.onGoto?.(c));

    const row = lrow(doc, led(doc, !!tone, tone ?? 'violet'), body);
    row.classList.add('pf-dw-row');
    row.setAttribute('data-pf-id', c.id);
    if (opts.openCode) row.appendChild(codeBtn(c));
    if (opts.agent && OPEN.has(c.status)) row.appendChild(sendBtn('Enviar', { commentIds: [c.id] }));
    if (opts.comments && confirmId !== c.id) row.appendChild(actions(c));
    if (!opts.comments || confirmId !== c.id) return row;
    const wrap = h(doc, 'div', 'pf-dw-card');
    wrap.append(row, confirmBar(c));
    return wrap;
  }

  function actions(c: QueueComment): HTMLElement {
    const row = h(doc, 'span', 'pf-dk-fx pf-dk-g6 pf-dw-acts');
    row.append(
      key(doc, '', {
        sq: true,
        sm: true,
        variant: 'ghost',
        icon: 'text',
        iconSize: 14,
        ariaLabel: 'Editar comentario',
        onClick: () => {
          editingId = c.id;
          confirmId = null;
          paint();
        },
      }),
      key(doc, '', {
        sq: true,
        sm: true,
        variant: 'ghost',
        icon: 'trash',
        iconSize: 14,
        ariaLabel: 'Eliminar comentario',
        onClick: () => {
          confirmId = c.id;
          editingId = null;
          paint();
        },
      }),
    );
    return row;
  }

  /** Confirmación propia del cajón (nada de window.confirm: el widget vive en un Shadow Root). */
  function confirmBar(c: QueueComment): HTMLElement {
    const box = h(doc, 'div', 'pf-dw-del');
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-label', 'Confirmar eliminación');
    box.appendChild(warn(doc, '¿Eliminar este comentario? No se puede deshacer', { bad: true }));
    const row = h(doc, 'div', 'pf-dk-fx pf-dk-g8 pf-dw-btns');
    const no = key(doc, 'Cancelar', {
      variant: 'ghost',
      onClick: () => {
        confirmId = null;
        paint();
      },
    });
    const ok = key(doc, 'Eliminar', {
      variant: 'dng',
      icon: 'trash',
      onClick: () => {
        ok.disabled = true;
        void (async () => {
          try {
            await opts.comments!.remove(c.id);
            confirmId = null;
            say('Comentario eliminado.');
            opts.onChanged?.();
          } catch (e) {
            say(errText(e, 'No se pudo eliminar el comentario.'));
          }
          await refresh();
        })();
      },
    });
    row.append(no, ok);
    box.appendChild(row);
    return box;
  }

  /** Edición en línea del texto principal: Guardar/Cancelar, Ctrl+Enter guarda y Esc cancela. */
  function editForm(c: QueueComment): HTMLElement {
    const box = lrow(doc);
    box.classList.add('pf-dw-edit');
    const ta = asLin(h(doc, 'textarea'));
    ta.rows = 3;
    ta.value = c.comment;
    ta.setAttribute('aria-label', 'Texto del comentario');
    const stop = () => {
      editingId = null;
      paint();
    };
    const save = key(doc, 'Guardar', {
      variant: 'hot',
      onClick: () => {
        const t = ta.value.trim();
        if (!t) return say('El comentario no puede estar vacío.');
        if (t === c.comment) return stop();
        save.disabled = true;
        void (async () => {
          try {
            await opts.comments!.update(c.id, t, c.updatedAt);
            say('Comentario actualizado.');
            opts.onChanged?.();
          } catch (e) {
            // Conflicto (cambió en otro lado) u otro fallo: se avisa y se recarga el estado real.
            say(errText(e, 'No se pudo guardar el comentario.'));
          }
          editingId = null;
          await refresh();
        })();
      },
    });
    const cancel = key(doc, 'Cancelar', { variant: 'ghost', onClick: stop });
    on<KeyboardEvent>(ta, 'keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        save.click();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        stop();
      }
    });
    const row = h(doc, 'div', 'pf-dk-fx pf-dk-g8 pf-dw-btns');
    row.append(cancel, save);
    box.append(text(doc, 'ts', `Editar comentario · ${where(c)}`), ta, row);
    queueMicrotask(() => ta.focus());
    return box;
  }

  function groupCard(g: ReadingGroup): HTMLElement {
    const card = h(doc, 'div', 'pf-dw-gcard');
    const head = h(doc, 'div', 'pf-dk-rack');
    const gc = chip(doc, g.id, { on: true });
    gc.classList.add('pf-dw-gtag');
    const t = h(doc, 'div', 'pf-dk-grow');
    t.append(text(doc, 'tg', g.name));
    if (g.note.trim()) t.append(text(doc, 'ts', g.note.slice(0, 160)));
    head.append(gc, t);
    card.appendChild(head);

    const queue = queueFor(g.id, data.comments);
    const list = lcd(doc, { cls: 'pf-dw-q' });
    queue.forEach((c, i) => {
      const tone = STATUS_TONE[c.status];
      const qi = lrow(doc, num(doc, i + 1));
      qi.classList.add('pf-dw-qi');
      if (c.status === 'resolved') qi.classList.add('pf-dw-qi--done');
      qi.draggable = true;
      const qc = h(doc, 'div', 'pf-dk-grow');
      const small = h(doc, 'div', 'pf-dk-ts pf-dw-sub');
      small.append(led(doc, !!tone, tone ?? 'violet'), doc.createTextNode(` ${STATUS_LABEL[c.status] ?? c.status} · ${where(c)}`));
      qc.append(text(doc, 'tg', c.comment.slice(0, 120)), small);
      qi.appendChild(qc);
      on<DragEvent>(qi, 'dragstart', (e) => {
        dragId = c.id;
        e.dataTransfer?.setData('text/plain', c.id);
      });
      on<DragEvent>(qi, 'dragover', (e) => {
        if (dragId) {
          e.preventDefault();
          qi.classList.add('pf-dw-qi--over');
        }
      });
      on(qi, 'dragleave', () => qi.classList.remove('pf-dw-qi--over'));
      on<DragEvent>(qi, 'drop', (e) => {
        e.preventDefault();
        qi.classList.remove('pf-dw-qi--over');
        const from = dragId;
        dragId = null;
        if (!from || from === c.id) return;
        const ids = queue.map((x) => x.id).filter((id) => id !== from);
        ids.splice(ids.indexOf(c.id), 0, from);
        void api(() => opts.api.reorderGroup(g.id, { order: ids as CommentId[] }), 'No se pudo reordenar la cola.');
      });
      list.appendChild(qi);
    });
    if (!queue.length) list.appendChild(text(doc, 'ts', 'Aún no hay comentarios en este grupo.'));
    card.appendChild(list);

    const foot = h(doc, 'div', 'pf-dk-fx pf-dk-g8 pf-dk-wr');
    foot.appendChild(
      key(doc, 'Copiar como brief', {
        icon: 'copy',
        iconSize: 13,
        onClick: () => {
          void writeClipboard(doc, groupBrief(g, queue)).then((ok) => say(ok ? 'Brief copiado.' : 'No se pudo copiar al portapapeles.'));
        },
      }),
    );
    if (opts.agent && queue.some((c) => OPEN.has(c.status))) {
      foot.appendChild(sendBtn('Enviar grupo', { groupId: g.id }));
      const ac = agentChip(agentStateFor({ groupId: g.id }, data.requests ?? []));
      if (ac) foot.appendChild(ac);
    }
    if (opts.onAddToGroup) {
      foot.appendChild(key(doc, 'Añadir', { icon: 'plus', iconSize: 13, onClick: () => opts.onAddToGroup?.(g.id) }));
    }
    card.appendChild(foot);
    return card;
  }

  function newGroup(): HTMLElement {
    if (!newGroupOpen) {
      return key(doc, 'Grupo nuevo', {
        icon: 'plus',
        iconSize: 13,
        onClick: () => {
          newGroupOpen = true;
          paint();
        },
      });
    }
    const row = h(doc, 'div', 'pf-dk-fx pf-dk-g8');
    const name = asLin(h(doc, 'input'));
    name.type = 'text';
    name.placeholder = 'Nombre del grupo';
    name.setAttribute('aria-label', 'Nombre del grupo');
    name.classList.add('pf-dk-grow');
    const create = () => {
      const n = name.value.trim();
      if (!n) return;
      const id = slugGroupId(n, new Set(data.groups.map((g) => g.id as string)));
      newGroupOpen = false;
      void api(() => opts.api.createGroup({ id: id as ReadingGroup['id'], name: n, note: '', readFirst: true }).then(() => undefined), 'No se pudo crear el grupo.');
    };
    const ok = key(doc, 'Crear', { variant: 'hot', onClick: create });
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

  /** Envío desde el panel del agente: guarda la solicitud para mostrar «Enviado» y refresca la bandeja. */
  function sendFromPanel(req: { groupId?: string; agentRef?: string }): void {
    void api(async () => {
      const r = await opts.agent!.send(req);
      agentState.sent = r;
      say('Enviado al agente.');
    }, 'No se pudo enviar al agente.');
  }

  function paint(): void {
    if (destroyed) return;
    root.textContent = '';
    const tools = h(doc, 'div', 'pf-dk-fx pf-dk-g8');
    const title = h(doc, 'span', 'pf-dk-t2 pf-dk-grow');
    title.append(doc.createTextNode('Comentarios '), h(doc, 'span', 'pf-dk-ts', opts.route()));
    if (opts.agent) {
      tools.appendChild(
        key(doc, 'Enviar a agente', {
          icon: 'open',
          iconSize: 14,
          variant: agentView ? 'lit' : undefined,
          pressed: agentView,
          onClick: () => {
            agentView = !agentView;
            agentState.sent = null;
            paint();
          },
        }),
      );
    }
    tools.appendChild(
      key(doc, '', {
        sq: true,
        variant: 'ghost',
        icon: 'close',
        iconSize: 14,
        ariaLabel: 'Cerrar cajón',
        title: 'Cerrar',
        onClick: () => handle.close(),
      }),
    );
    const head = lcd(doc, { cls: 'pf-dk-fx pf-dk-g8 pf-dw-head' });
    head.append(title, tools);
    grip.textContent = '';
    grip.appendChild(head);

    if (agentView && opts.agent) {
      const panel = renderAgentPanel({
        doc,
        state: agentState,
        route: opts.route(),
        comments: data.comments,
        groups: data.groups,
        requests: data.requests ?? [],
        send: sendFromPanel,
        copy: (t) => void writeClipboard(doc, t).then((ok) => say(ok ? 'Prompt copiado.' : 'No se pudo copiar al portapapeles.')),
        repaint: paint,
      });
      const wrap = h(doc, 'div', 'pf-dw-body');
      wrap.appendChild(panel);
      root.append(grip, wrap);
      return;
    }

    const open = data.comments.filter((c) => OPEN.has(c.status));
    const done = data.comments.filter((c) => DONE.has(c.status));
    const defs: Array<[DrawerTab, string, number]> = [
      ['open', 'Abiertos', open.length],
      ['groups', 'Grupos', data.groups.length],
      ['done', 'Resueltos', done.length],
    ];
    const tabs = tray(
      doc,
      defs.map(([id, label, n]) => {
        const b = key(doc, label, {
          variant: id === tab ? 'lit' : undefined,
          onClick: () => {
            tab = id;
            paint();
          },
        });
        b.append(doc.createTextNode(' '), cnt(doc, n));
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', String(id === tab));
        return b;
      }),
      { role: 'tablist', label: 'Comentarios' },
    );

    const body = lcd(doc, { cls: 'pf-dw-body pf-dk-col' });
    if (tab === 'open' && opts.agent && open.some((c) => c.status === 'pending')) {
      const bar = h(doc, 'div', 'pf-dw-bar');
      bar.appendChild(sendBtn(`Enviar toda la cola (${open.filter((c) => c.status === 'pending').length})`, {}));
      body.appendChild(bar);
    }
    if (tab === 'open') for (const c of open) body.appendChild(item(c));
    if (tab === 'done') for (const c of done) body.appendChild(item(c));
    if (tab === 'groups') {
      for (const g of data.groups) body.appendChild(groupCard(g));
    }
    if (!body.querySelector('.pf-dw-row, .pf-dw-gcard, .pf-dw-edit, .pf-dw-card')) {
      body.appendChild(text(doc, 'ts', tab === 'done' ? 'Nada resuelto todavía.' : tab === 'groups' ? 'Aún no hay grupos.' : 'No hay comentarios abiertos.'));
    }
    root.append(grip, tabs, body);
    if (tab === 'groups') root.appendChild(newGroup());
    if (focusId) {
      const row = Array.from(root.querySelectorAll<HTMLElement>('[data-pf-id]')).find((r) => r.getAttribute('data-pf-id') === focusId);
      if (row) {
        row.scrollIntoView?.({ block: 'center' });
        row.setAttribute('data-flash', '');
        setTimeout(() => row.removeAttribute('data-flash'), 1600);
      }
    }
  }

  async function refresh(): Promise<void> {
    try {
      data = await opts.load();
    } catch {
      say('No se pudieron cargar los comentarios.');
    }
    if (isOpen) paint();
    focusId = null;
  }

  const handle: DrawerHandle = {
    open(t, focus) {
      if (destroyed) return;
      focusId = focus ?? null;
      if (t) {
        tab = t;
        agentView = false;
      }
      isOpen = true;
      root.hidden = false;
      paint();
      void refresh();
    },
    close() {
      isOpen = false;
      root.hidden = true;
      newGroupOpen = false;
      editingId = null;
      confirmId = null;
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

