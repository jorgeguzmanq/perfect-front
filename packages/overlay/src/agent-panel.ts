import { asLin, chip, idHeader, key, lab, lcd, led, lrow, text, tray, warn, type DeckTone } from './deck';
import { h } from './dom';
import { AGENT_LABEL, queueFor, type AgentRequestInfo, type QueueComment } from './groups';
import type { ReadingGroup } from '@perfect-front/shared';

/**
 * Capa 11 «Agente»: panel «Enviar a agente» del cajón. Vista previa del prompt (qué hay y dónde, NUNCA el texto de los
 * comentarios), copiar/enviar, estado «Enviado», bandeja de solicitudes y ayuda de `perfect-front watch`.
 * Sin estado propio de servidor: el cajón le pasa los datos y los callbacks.
 */

export type AgentSub = 'ready' | 'inbox' | 'watch';

export interface AgentPanelState {
  sub: AgentSub;
  /** Grupo al que se limita el envío (null = toda la cola pendiente). */
  groupId: string | null;
  /** ID o JSON que el agente destino entregó a la persona (se pega en el campo del panel). */
  agentRef: string;
  /** Última solicitud enviada desde el panel (muestra «Enviado»). */
  sent: AgentRequestInfo | null;
}

export interface AgentPanelDeps {
  doc: Document;
  state: AgentPanelState;
  route: string;
  comments: readonly QueueComment[];
  groups: readonly ReadingGroup[];
  requests: readonly AgentRequestInfo[];
  /** Envía y repinta (el cajón gestiona errores y refresco). */
  send(req: { groupId?: string; agentRef?: string }): void;
  copy(text: string): void;
  repaint(): void;
}

const OPEN = new Set(['pending', 'in_progress']);
const REQ_TONE: Record<AgentRequestInfo['status'], DeckTone> = { pending: 'amber', taken: 'green', done: 'green' };
const REQ_LABEL: Record<AgentRequestInfo['status'], string> = { pending: 'Pendiente', taken: 'Leída por el agente', done: 'Resuelta' };

/** Etiqueta corta de una solicitud: posición en la bandeja («r-001»), no el id interno. */
export const requestLabel = (id: string, requests: readonly AgentRequestInfo[]): string => {
  const i = requests.findIndex((r) => r.id === id);
  return i < 0 ? id : `r-${String(i + 1).padStart(3, '0')}`;
};

/** Comentarios que viajarían en el envío: la cola de un grupo (en orden) o todo lo pendiente. */
export function sendTarget(comments: readonly QueueComment[], groupId: string | null): QueueComment[] {
  if (groupId) return queueFor(groupId, comments).filter((c) => OPEN.has(c.status));
  return comments.filter((c) => c.status === 'pending');
}

/** Prompt de ejemplo: solo IDs, rutas y comandos; ningún texto de comentario. */
export function previewPrompt(target: readonly QueueComment[], route: string, groupId: string | null): string {
  const n = target.length;
  const ids = target.map((c) => c.id);
  const shown = ids.length > 8 ? `${ids.slice(0, 8).join(', ')} … (+${ids.length - 8})` : ids.join(', ') || '(ninguno)';
  return [
    `Hay ${n} ${n === 1 ? 'comentario abierto' : 'comentarios abiertos'} en ${route}${groupId ? ` (grupo ${groupId})` : ''}.`,
    `IDs: ${shown}`,
    'Ficheros: .perfect-front/comments/',
    'Léelos con la CLI de perfect-front (`perfect-front show <id> --json`) y al terminar márcalos como resueltos.',
  ].join('\n');
}

export function renderAgentPanel(d: AgentPanelDeps): HTMLElement {
  const { doc, state } = d;
  const root = h(doc, 'div', 'pf-dk-col pf-dw-agent');
  const target = sendTarget(d.comments, state.groupId);
  const n = target.length;
  const groupText = state.groupId ? `grupo ${state.groupId}` : 'toda la cola';
  root.appendChild(
    idHeader(doc, {
      tag: '↗',
      title: 'Enviar a agente',
      sub: `${n} ${n === 1 ? 'comentario abierto' : 'comentarios abiertos'} · ${groupText} · ${d.route}`,
    }).root,
  );

  const subs: Array<[AgentSub, string]> = [
    ['ready', 'Enviar'],
    ['inbox', 'Bandeja'],
    ['watch', 'Ayuda watch'],
  ];
  const t = tray(
    doc,
    subs.map(([id, label]) => {
      const k = key(doc, label, {
        variant: state.sub === id ? 'lit' : undefined,
        onClick: () => {
          state.sub = id;
          if (id !== 'ready') state.sent = null;
          d.repaint();
        },
      });
      k.setAttribute('role', 'tab');
      k.setAttribute('aria-selected', String(state.sub === id));
      return k;
    }),
    { role: 'tablist', label: 'Vistas del agente', cls: 'pf-dw-agent-tabs' },
  );
  root.appendChild(t);

  if (state.sub === 'inbox') root.appendChild(inbox(d));
  else if (state.sub === 'watch') root.appendChild(watchHelp(d));
  else if (state.sent) root.appendChild(sentView(d, state.sent));
  else root.appendChild(ready(d, target));
  return root;
}

function ready(d: AgentPanelDeps, target: readonly QueueComment[]): HTMLElement {
  const { doc, state } = d;
  const box = h(doc, 'div', 'pf-dk-col pf-dw-agent-body');
  const groups = d.groups.filter((g) => queueFor(g.id, d.comments).some((c) => OPEN.has(c.status)));
  if (groups.length) {
    const row = h(doc, 'div', 'pf-dk-fx pf-dk-g8 pf-dk-wr');
    row.appendChild(lab(doc, 'Alcance'));
    row.appendChild(
      chip(doc, 'Toda la cola', {
        on: !state.groupId,
        led: true,
        onClick: () => {
          state.groupId = null;
          d.repaint();
        },
      }),
    );
    for (const g of groups) {
      row.appendChild(
        chip(doc, `Grupo ${g.id}`, {
          on: state.groupId === g.id,
          led: true,
          onClick: () => {
            state.groupId = g.id;
            d.repaint();
          },
        }),
      );
    }
    box.appendChild(row);
  }
  box.appendChild(lab(doc, 'Prompt que recibe el agente (ejemplo)'));
  const prompt = previewPrompt(target, d.route, state.groupId);
  const screen = lcd(doc);
  const pre = h(doc, 'pre', 'pf-dk-tg pf-dw-pre', prompt);
  screen.appendChild(pre);
  box.appendChild(screen);
  box.appendChild(
    text(doc, 'ts', 'El prompt solo dice qué hay y dónde (IDs, rutas, comandos). Nunca lleva el texto de los comentarios.'),
  );
  if (!target.length) box.appendChild(warn(doc, 'No hay comentarios pendientes que enviar.'));

  box.appendChild(lab(doc, 'Agente destino'));
  const ref = asLin(h(doc, 'input'));
  ref.type = 'text';
  ref.value = state.agentRef;
  ref.placeholder = 'Pega aquí el id (o JSON) que te dio el agente';
  ref.setAttribute('aria-label', 'ID del agente destino');
  ref.addEventListener('input', () => {
    state.agentRef = ref.value;
  });
  box.appendChild(ref);
  box.appendChild(
    text(doc, 'ts', 'Pídele al agente que se identifique (p. ej. «dame tu id de sesión en JSON») y pega su respuesta. Es opcional: se guarda con la solicitud.'),
  );
  box.appendChild(
    key(doc, 'Copiar petición de ID', {
      icon: 'copy',
      onClick: () => d.copy('Identifícate para recibir mis comentarios de Perfect Front: dame tu id de sesión en formato JSON, solo el JSON.'),
    }),
  );

  const actions = h(doc, 'div', 'pf-dk-fx pf-dk-g12');
  actions.append(
    key(doc, 'Copiar prompt', { icon: 'copy', onClick: () => d.copy(prompt) }),
    key(doc, 'Enviar a agente', {
      variant: 'hot',
      icon: 'open',
      disabled: !target.length,
      onClick: () => {
        const agentRef = state.agentRef.trim();
        d.send({ ...(state.groupId ? { groupId: state.groupId } : {}), ...(agentRef ? { agentRef } : {}) });
      },
    }),
  );
  box.appendChild(actions);
  return box;
}

function sentView(d: AgentPanelDeps, req: AgentRequestInfo): HTMLElement {
  const { doc, state } = d;
  const box = lcd(doc, { cls: 'pf-dk-fx pf-dk-g12 pf-dw-agent-sent' });
  box.setAttribute('role', 'status');
  const msg = h(doc, 'span', 'pf-dk-tx pf-dk-grow');
  msg.append(doc.createTextNode('Enviado · solicitud '), h(doc, 'b', undefined, requestLabel(req.id, d.requests)), doc.createTextNode(' guardada en la bandeja · esperando al agente'));
  box.append(
    led(doc, true, 'green'),
    msg,
    key(doc, 'Ver bandeja', {
      onClick: () => {
        state.sent = null;
        state.sub = 'inbox';
        d.repaint();
      },
    }),
  );
  return box;
}

function inbox(d: AgentPanelDeps): HTMLElement {
  const { doc } = d;
  const box = h(doc, 'div', 'pf-dk-col pf-dw-agent-body');
  box.appendChild(lab(doc, '.perfect-front/agent-inbox/'));
  const screen = lcd(doc);
  // Más reciente primero; la etiqueta rN sale de la posición en el orden de creación.
  const list = [...d.requests].reverse();
  for (const r of list) {
    const info = h(doc, 'div', 'pf-dk-grow');
    const count = `${r.commentIds.length} ${r.commentIds.length === 1 ? 'comentario' : 'comentarios'}${r.groupId ? ` · grupo ${r.groupId}` : ''}`;
    info.append(text(doc, 'tg', `${requestLabel(r.id, d.requests)}.json`), text(doc, 'ts', `${REQ_LABEL[r.status]} · ${count}`));
    info.setAttribute('data-status', r.status);
    info.title = AGENT_LABEL[r.status];
    screen.appendChild(lrow(doc, led(doc, true, REQ_TONE[r.status]), info));
  }
  if (!list.length) screen.appendChild(text(doc, 'ts', 'Aún no hay solicitudes enviadas.'));
  box.appendChild(screen);
  return box;
}

function watchHelp(d: AgentPanelDeps): HTMLElement {
  const { doc } = d;
  const box = h(doc, 'div', 'pf-dk-col pf-dw-agent-body');
  box.appendChild(lab(doc, 'Para que el agente se entere solo'));
  const screen = lcd(doc);
  screen.appendChild(h(doc, 'pre', 'pf-dk-tg pf-dw-pre', '$ perfect-front watch\n· esperando solicitudes…\n✓ r-002  3 comentarios  /pricing'));
  box.append(screen, text(doc, 'ts', 'Se deja corriendo con el Monitor del agente: cada solicitud nueva llega como evento.'));
  return box;
}
