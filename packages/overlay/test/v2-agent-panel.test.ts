// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { previewPrompt, renderAgentPanel, requestLabel, sendTarget, type AgentPanelState } from '../src/agent-panel';
import type { AgentRequestInfo, QueueComment } from '../src/groups';

const c = (id: string, status = 'pending', group?: { id: string; position: number }): QueueComment => ({
  id,
  status,
  comment: `SECRETO-${id}`,
  scope: 'element',
  location: { route: '/pricing', selector: '#a' },
  ...(group ? { group } : {}),
});
const reqs: AgentRequestInfo[] = [
  { id: 'ar_1', createdAt: '2026-10-01', commentIds: ['c1'], groupId: null, status: 'done' },
  { id: 'ar_2', createdAt: '2026-10-02', commentIds: ['c2', 'c3'], groupId: 'a', status: 'pending' },
];

describe('panel «Enviar a agente»', () => {
  it('la vista previa lleva IDs y rutas, nunca el texto de los comentarios', () => {
    const t = sendTarget([c('c1'), c('c2', 'resolved'), c('c3')], null);
    const p = previewPrompt(t, '/pricing', null);
    expect(p).toContain('Hay 2 comentarios abiertos en /pricing.');
    expect(p).toContain('IDs: c1, c3');
    expect(p).not.toContain('SECRETO');
  });

  it('el alcance de grupo respeta el orden de la cola', () => {
    const t = sendTarget([c('c1', 'pending', { id: 'a', position: 2 }), c('c2', 'pending', { id: 'a', position: 1 })], 'a');
    expect(t.map((x) => x.id)).toEqual(['c2', 'c1']);
  });

  it('etiqueta las solicitudes r-NNN y la bandeja muestra su estado', () => {
    expect(requestLabel('ar_2', reqs)).toBe('r-002');
    const state: AgentPanelState = { sub: 'inbox', groupId: null, agentRef: '', sent: null };
    const el = renderAgentPanel({ doc: document, state, route: '/pricing', comments: [], groups: [], requests: reqs, send() {}, copy() {}, repaint() {} });
    expect(el.textContent).toContain('r-002.json');
    expect(el.textContent).toContain('Pendiente');
    expect(el.textContent).toContain('Resuelta');
  });

  it('«Enviado» muestra la solicitud y «Ver bandeja»', () => {
    const state: AgentPanelState = { sub: 'ready', groupId: null, agentRef: '', sent: reqs[1]! };
    const el = renderAgentPanel({ doc: document, state, route: '/', comments: [c('c2')], groups: [], requests: reqs, send() {}, copy() {}, repaint() {} });
    expect(el.textContent).toContain('Enviado');
    expect(el.textContent).toContain('r-002');
    expect(Array.from(el.querySelectorAll('button')).some((b) => b.textContent === 'Ver bandeja')).toBe(true);
  });
});
