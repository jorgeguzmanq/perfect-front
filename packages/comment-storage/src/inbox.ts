import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { PerfectFrontError, nowTimestamp, type VisualComment } from "@perfect-front/shared";
import { buildInboxPrompt, type AgentPromptContext } from "./agent-prompt";
import { PF_DIR } from "./paths";

/**
 * Buzón de peticiones al agente: `<proyecto>/.perfect-front/agent-inbox/<requestId>.json`.
 * El widget solo envía IDs; el archivo guarda el prompt (sin texto de comentarios) para que `watch` lo imprima.
 */

export const INBOX_DIR = "agent-inbox";
const REQUEST_ID_RE = /^ar_[a-z0-9]{8,32}$/;

export type AgentRequestStored = "pending" | "taken";
/** Estado derivado: pending -> taken (lo toma `watch` o algún comentario pasa a in_progress) -> done (todos resueltos). */
export type AgentRequestStatus = "pending" | "taken" | "done";

export interface AgentRequest {
  id: string;
  createdAt: string;
  commentIds: string[];
  groupId: string | null;
  /** Identificación del agente destino (id o JSON que él mismo entregó), si la persona la indicó. */
  agentRef?: string;
  prompt: string;
  status: AgentRequestStored;
}

export interface AgentRequestView extends Omit<AgentRequest, "status" | "prompt"> {
  status: AgentRequestStatus;
}

export const inboxDir = (root: string): string => path.join(root, PF_DIR, INBOX_DIR);

const isRequest = (v: unknown): v is AgentRequest => {
  const o = v as Partial<AgentRequest> | null;
  return (
    !!o &&
    typeof o.id === "string" &&
    REQUEST_ID_RE.test(o.id) &&
    Array.isArray(o.commentIds) &&
    o.commentIds.every((x) => typeof x === "string") &&
    typeof o.prompt === "string" &&
    (o.status === "pending" || o.status === "taken")
  );
};

async function writeAtomic(file: string, data: unknown): Promise<void> {
  const tmp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  await fs.rename(tmp, file);
}

/** Crea la petición. `queue` = comentarios pendientes ya filtrados y ordenados (ids, no texto, llegan al prompt). */
export async function createAgentRequest(
  root: string,
  input: { commentIds: string[]; groupId?: string | null; agentRef?: string },
  ctx: Omit<AgentPromptContext, "root"> = {},
): Promise<AgentRequest> {
  const ids = [...new Set(input.commentIds)];
  const groupId = input.groupId ?? null;
  const id = `ar_${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
  const req: AgentRequest = {
    id,
    createdAt: nowTimestamp(),
    commentIds: ids,
    groupId,
    ...(input.agentRef ? { agentRef: input.agentRef } : {}),
    prompt: buildInboxPrompt({ ...ctx, root }, { ids, groupId, ...(input.agentRef ? { agentRef: input.agentRef } : {}) }),
    status: "pending",
  };
  const dir = inboxDir(root);
  await fs.mkdir(dir, { recursive: true });
  await writeAtomic(path.join(dir, `${id}.json`), req);
  return req;
}

/** Peticiones ordenadas por creación (más antiguas primero); archivos ilegibles se ignoran. */
export async function listAgentRequests(root: string): Promise<AgentRequest[]> {
  let files: string[];
  try {
    files = await fs.readdir(inboxDir(root));
  } catch {
    return [];
  }
  const out: AgentRequest[] = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      const v: unknown = JSON.parse(await fs.readFile(path.join(inboxDir(root), f), "utf8"));
      if (isRequest(v) && `${v.id}.json` === f) out.push(v);
    } catch {
      /* escritura en curso o archivo corrupto */
    }
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1));
}

export async function markAgentRequestTaken(root: string, id: string): Promise<AgentRequest> {
  if (!REQUEST_ID_RE.test(id)) throw new PerfectFrontError("invalid_id", "ID de petición inválido");
  const file = path.join(inboxDir(root), `${id}.json`);
  let req: unknown;
  try {
    req = JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    throw new PerfectFrontError("not_found", "Petición no encontrada");
  }
  if (!isRequest(req)) throw new PerfectFrontError("invalid_data", "Petición ilegible");
  if (req.status === "taken") return req;
  const next: AgentRequest = { ...req, status: "taken" };
  await writeAtomic(file, next);
  return next;
}

/** Vista pública (sin prompt) con el estado derivado de los comentarios actuales. */
export function deriveAgentRequest(req: AgentRequest, comments: readonly { id: string; status: VisualComment["status"] }[]): AgentRequestView {
  const byId = new Map<string, VisualComment["status"]>(comments.map((c) => [c.id, c.status]));
  const states = req.commentIds.map((id) => byId.get(id));
  // Un comentario que ya no existe o se ignoró/archivó no bloquea el cierre.
  const open = states.filter((s) => s === "pending" || s === "in_progress");
  const anyClaimed = states.some((s) => s === "in_progress" || s === "resolved");
  let status: AgentRequestStatus = "pending";
  if (req.commentIds.length > 0 && open.length === 0) status = "done";
  else if (req.status === "taken" || anyClaimed) status = "taken";
  return {
    id: req.id,
    createdAt: req.createdAt,
    commentIds: req.commentIds,
    groupId: req.groupId,
    ...(req.agentRef ? { agentRef: req.agentRef } : {}),
    status,
  };
}
