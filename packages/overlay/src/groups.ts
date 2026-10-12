import {
  LIMITS,
  type CommentGroupRef,
  type CreateGroupRequest,
  type ReadingGroup,
  type ReorderGroupRequest,
  type UpdateGroupRequest,
} from '@perfect-front/shared';

/**
 * Grupos de lectura y cola. La persistencia es del servidor (`/groups`, ver api.ts de shared); este módulo
 * define el puerto `GroupsApi` que boot-core debe implementar con fetch, y la lógica pura de la cola.
 */

export interface GroupsApi {
  listGroups(): Promise<ReadingGroup[]>;
  createGroup(req: CreateGroupRequest): Promise<ReadingGroup>;
  updateGroup(id: string, req: UpdateGroupRequest): Promise<ReadingGroup>;
  /** `order[i]` pasa a posición i+1; los ausentes salen del grupo. */
  reorderGroup(id: string, req: ReorderGroupRequest): Promise<void>;
  /** PATCH de un comentario existente: lo ata (o suelta con null) a un grupo. */
  setCommentGroup(commentId: string, ref: CommentGroupRef | null): Promise<void>;
}

/** Petición «Enviar a agente» tal como la devuelve `/agent/requests` (sin prompt ni texto de comentarios). */
export interface AgentRequestInfo {
  id: string;
  createdAt: string;
  commentIds: string[];
  groupId: string | null;
  status: 'pending' | 'taken' | 'done';
}

/** Puerto del buzón del agente: el widget solo envía IDs (ninguno = toda la cola pendiente). */
export interface AgentApi {
  send(req: { commentIds?: string[]; groupId?: string }): Promise<AgentRequestInfo>;
  list(): Promise<AgentRequestInfo[]>;
}

export const AGENT_LABEL: Record<AgentRequestInfo['status'], string> = { pending: 'Enviada', taken: 'Tomada', done: 'Resuelta' };

/** Estado de la petición más reciente que incluye el comentario (o el grupo), o null si nunca se envió. */
export function agentStateFor(target: { commentId?: string; groupId?: string }, requests: readonly AgentRequestInfo[]): AgentRequestInfo['status'] | null {
  const hits = requests.filter((r) => (target.commentId ? r.commentIds.includes(target.commentId) : r.groupId === target.groupId));
  if (!hits.length) return null;
  return hits.reduce((a, b) => (b.createdAt >= a.createdAt ? b : a)).status;
}

/** Subconjunto de VisualComment que necesita la cola y el cajón. */
export interface QueueComment {
  id: string;
  status: string;
  comment: string;
  scope: string;
  location: { route: string; selector: string | null };
  group?: { id: string; position: number } | null;
}

/** Cola de un grupo ordenada por `position`. */
export function queueFor(groupId: string, comments: readonly QueueComment[]): QueueComment[] {
  return comments
    .filter((c) => c.group?.id === groupId)
    .sort((a, b) => (a.group?.position ?? 0) - (b.group?.position ?? 0));
}

/** Id de grupo válido (`[a-z0-9][a-z0-9_-]*`, ≤64) a partir de un nombre; evita colisiones. */
export function slugGroupId(name: string, taken: ReadonlySet<string>): string {
  const base =
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 56) || 'grupo';
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const id = `${base}-${i}`;
    if (!taken.has(id)) return id;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/**
 * Dónde se coloca el comentario en construcción: grupo y comentario tras el cual va (null = al final).
 * `create`: el grupo aún no existe (se crea al guardar). `joinWith`: comentario suelto que se mete al grupo
 * junto con este («Se crea un grupo con ambos»).
 */
export interface GroupBinding {
  groupId: string;
  afterId: string | null;
  create?: { name: string };
  joinWith?: string;
}

/** Posición (1-based) que ocuparía según el binding; `at` en la barra «Incluye» («paso N»). */
export function bindingStep(binding: GroupBinding, queue: readonly QueueComment[]): number {
  if (!binding.afterId) return queue.length + 1;
  const i = queue.findIndex((c) => c.id === binding.afterId);
  return i < 0 ? queue.length + 1 : i + 2;
}

/**
 * `group` de la request de creación: siempre al final (la posición definitiva se fija con
 * `orderWithInserted` + reorderGroup una vez que existe el id del comentario nuevo).
 */
export function groupRefForCreate(binding: GroupBinding, queue: readonly QueueComment[]): CommentGroupRef {
  const position = Math.min(queue.length + 1, LIMITS.groupItems);
  return { id: binding.groupId as CommentGroupRef['id'], position };
}

/** Orden completo de la cola con el comentario nuevo insertado tras `afterId` (para ReorderGroupRequest). */
export function orderWithInserted(queue: readonly QueueComment[], newId: string, afterId: string | null): string[] {
  const ids = queue.map((c) => c.id).filter((id) => id !== newId);
  const at = afterId ? ids.indexOf(afterId) + 1 : ids.length;
  ids.splice(at < 0 ? ids.length : at, 0, newId);
  return ids;
}

/** ¿Hace falta reordenar tras crear? (no si va al final). */
export const needsReorder = (binding: GroupBinding, queue: readonly QueueComment[]): boolean =>
  !!binding.afterId && queue.length > 0 && queue[queue.length - 1]?.id !== binding.afterId;

/** Brief en Markdown de un grupo (menú «Copiar como brief» del cajón). */
export function groupBrief(group: ReadingGroup, queue: readonly QueueComment[]): string {
  const lines = [`# Grupo ${group.id}: ${group.name}`, ''];
  if (group.note.trim()) lines.push(group.note.trim(), '');
  if (group.readFirst) lines.push('> Lee la nota y toda la cola, en orden, antes de actuar.', '');
  queue.forEach((c, i) => {
    const where = c.location.selector ? ` (\`${c.location.selector.replace(/`/g, "'")}\` en ${c.location.route})` : ` (${c.location.route})`;
    lines.push(`${i + 1}. [${c.status}] ${c.comment.replace(/\s+/g, ' ').trim()}${where}`);
  });
  return lines.join('\n');
}
