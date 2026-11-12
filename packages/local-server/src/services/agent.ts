import { createAgentRequest, deriveAgentRequest, listAgentRequests, type AgentRequestView } from "@perfect-front/comment-storage";
import { PerfectFrontError, type CreateAgentRequest } from "@perfect-front/shared";
import type { ProjectRegistry } from "../registry";
import type { CommentsService } from "./comments";

/** Peticiones «Enviar a agente»: escribe en `.perfect-front/agent-inbox`; el agente las recoge con `watch`. */
export class AgentService {
  constructor(
    private readonly registry: ProjectRegistry,
    private readonly comments: CommentsService,
  ) {}

  async create(projectId: string, input: CreateAgentRequest): Promise<AgentRequestView> {
    const rec = this.registry.get(projectId);
    const all = await this.comments.list(projectId, {});
    const open = all.filter((c) => c.status === "pending" || c.status === "in_progress");
    let ids: string[];
    if (input.commentIds) {
      const known = new Set(all.map((c) => c.id));
      const missing = input.commentIds.filter((id) => !known.has(id));
      if (missing.length > 0) throw new PerfectFrontError("not_found", `Comentarios no encontrados: ${missing.join(", ")}`);
      ids = input.commentIds;
    } else if (input.groupId) {
      ids = open
        .filter((c) => c.group?.id === input.groupId)
        .sort((a, b) => a.group!.position - b.group!.position || (a.id < b.id ? -1 : 1))
        .map((c) => c.id);
    } else {
      ids = open.filter((c) => c.status === "pending").map((c) => c.id);
    }
    if (ids.length === 0) throw new PerfectFrontError("invalid_request", "No hay comentarios pendientes que enviar");
    const req = await createAgentRequest(rec.root, { commentIds: ids, groupId: input.groupId ?? null, ...(input.agentRef ? { agentRef: input.agentRef } : {}) });
    return deriveAgentRequest(req, all);
  }

  async list(projectId: string): Promise<AgentRequestView[]> {
    const rec = this.registry.get(projectId);
    const [reqs, all] = await Promise.all([listAgentRequests(rec.root), this.comments.list(projectId, {})]);
    return reqs.map((r) => deriveAgentRequest(r, all));
  }
}
