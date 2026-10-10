import type { CommentEvent, PerfectFrontEvent, VisualComment } from "@perfect-front/shared";
import { upsertComment } from "./conflict";

export const EVENT_TYPES = [
  "project.registered",
  "project.updated",
  "project.removed",
  "comment.created",
  "comment.updated",
  "comment.moved",
  "comment.resolved",
  "comment.deleted",
  "collection.created",
  "collection.renamed",
  "collection.deleted",
  "process.state",
  "process.log",
] as const;

/** Parseo defensivo de un mensaje SSE: null si no es un evento reconocible. */
export function parseEvent(data: string): PerfectFrontEvent | null {
  try {
    const v: unknown = JSON.parse(data);
    if (typeof v === "object" && v !== null && typeof (v as { type?: unknown }).type === "string" && typeof (v as { projectId?: unknown }).projectId === "string") {
      return v as PerfectFrontEvent;
    }
  } catch {
    /* ignorado */
  }
  return null;
}

/** Aplica un evento de comentario a la lista del proyecto abierto. Eventos de otras colecciones/proyectos no la alteran. */
export function applyCommentEvent(list: readonly VisualComment[], event: PerfectFrontEvent): VisualComment[] {
  switch (event.type) {
    case "comment.created":
    case "comment.updated":
    case "comment.resolved":
    case "comment.moved":
      return upsertComment(list, (event as Extract<CommentEvent, { comment: VisualComment }>).comment);
    case "comment.deleted":
      return list.filter((c) => c.id !== event.commentId);
    default:
      return list as VisualComment[];
  }
}

/** Retardo de reconexion con backoff exponencial acotado (ms). */
export function backoffDelay(attempt: number, base = 1000, max = 15_000): number {
  return Math.min(max, base * 2 ** Math.max(0, attempt));
}
