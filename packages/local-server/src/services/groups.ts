import { GroupStorage } from "@perfect-front/comment-storage";
import { PerfectFrontError, type ReadingGroup } from "@perfect-front/shared";
import type { ProjectRegistry } from "../registry";
import type { CommentsService } from "./comments";

/** Grupos de lectura por proyecto. Pertenencia y orden viven en `comment.group`; aquí se mantienen coherentes. */
export class GroupsService {
  private readonly stores = new Map<string, Promise<GroupStorage>>();

  constructor(
    private readonly registry: ProjectRegistry,
    private readonly comments: CommentsService,
  ) {}

  private store(projectId: string): Promise<GroupStorage> {
    const rec = this.registry.get(projectId);
    let s = this.stores.get(rec.id);
    if (!s) {
      s = GroupStorage.open(rec.root);
      this.stores.set(rec.id, s);
      s.catch(() => this.stores.delete(rec.id));
    }
    return s;
  }

  async list(projectId: string): Promise<ReadingGroup[]> {
    return (await this.store(projectId)).list();
  }

  async create(projectId: string, input: unknown): Promise<ReadingGroup> {
    return (await this.store(projectId)).create(input);
  }

  async update(projectId: string, id: string, patch: unknown): Promise<ReadingGroup> {
    return (await this.store(projectId)).update(id, patch);
  }

  /** Miembros actuales del grupo, en orden de cola. */
  private async members(projectId: string, groupId: string) {
    const all = await this.comments.list(projectId, {});
    return all
      .filter((c) => c.group?.id === groupId)
      .sort((a, b) => (a.group!.position - b.group!.position) || (a.id < b.id ? -1 : 1));
  }

  /** `order[i]` pasa a position i+1; los miembros ausentes salen del grupo. Todos los ids deben ser miembros. */
  async reorder(projectId: string, id: string, order: string[]): Promise<ReadingGroup> {
    const s = await this.store(projectId);
    const group = await s.get(id);
    const current = await this.members(projectId, group.id);
    const known = new Set<string>(current.map((c) => c.id));
    const unknown = order.filter((cid) => !known.has(cid));
    if (unknown.length > 0) throw new PerfectFrontError("invalid_request", "La cola incluye comentarios que no pertenecen al grupo");
    const inOrder = new Set<string>(order);
    for (let i = 0; i < order.length; i++) {
      const c = current.find((x) => x.id === order[i])!;
      if (c.group!.position !== i + 1) await this.comments.update(projectId, c.id, { group: { id: group.id, position: i + 1 } });
    }
    for (const c of current) if (!inOrder.has(c.id)) await this.comments.update(projectId, c.id, { group: null });
    return s.touch(group.id);
  }

  /** Borra el grupo y desvincula a sus comentarios (los comentarios no se eliminan). */
  async delete(projectId: string, id: string): Promise<void> {
    const s = await this.store(projectId);
    const group = await s.get(id);
    for (const c of await this.members(projectId, group.id)) {
      await this.comments.update(projectId, c.id, { group: null });
    }
    await s.delete(group.id);
  }
}
