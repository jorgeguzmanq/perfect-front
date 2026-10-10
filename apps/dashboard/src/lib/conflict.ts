import type { VisualComment } from "@perfect-front/shared";
import { ApiError } from "../api/client";

/**
 * Control de conflictos por `updatedAt`: la edicion parte de una version base. Si la version actual
 * (recibida por SSE o por recarga) tiene otro `updatedAt`, alguien mas la cambio.
 */
export function hasEditConflict(base: Pick<VisualComment, "updatedAt">, current: Pick<VisualComment, "updatedAt"> | null): boolean {
  return current !== null && current.updatedAt !== base.updatedAt;
}

export function isConflictError(e: unknown): boolean {
  return e instanceof ApiError && e.isConflict;
}

/** Sustituye/inserta un comentario conservando el resto de la lista. */
export function upsertComment(list: readonly VisualComment[], next: VisualComment): VisualComment[] {
  const i = list.findIndex((c) => c.id === next.id);
  if (i === -1) return [...list, next];
  const copy = [...list];
  copy[i] = next;
  return copy;
}
