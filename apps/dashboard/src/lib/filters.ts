import type { CommentStatus, VisualComment } from "@perfect-front/shared";

export type SortOrder = "newest" | "oldest";

export interface Filters {
  query: string;
  /** Vacio = todos los estados. */
  statuses: CommentStatus[];
  /** null = todas las colecciones. */
  collection: string | null;
  sort: SortOrder;
}

export const DEFAULT_FILTERS: Filters = { query: "", statuses: [], collection: null, sort: "newest" };

const norm = (s: string): string => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

/** Busqueda por ID, texto del comentario, ruta, URL, titulo y texto del elemento (sin acentos, sin mayusculas). */
export function matchesQuery(c: VisualComment, query: string): boolean {
  const q = norm(query.trim());
  if (q === "") return true;
  const hay = [c.id, c.comment, c.location.route, c.location.url, c.location.title ?? "", c.location.text ?? ""];
  return hay.some((s) => norm(s).includes(q));
}

export function sortComments(list: readonly VisualComment[], order: SortOrder): VisualComment[] {
  const dir = order === "newest" ? -1 : 1;
  // createdAt es ISO-8601 UTC: el orden lexicografico es cronologico; el id desempata de forma estable.
  return [...list].sort((a, b) => (a.createdAt === b.createdAt ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) * dir : (a.createdAt < b.createdAt ? -1 : 1) * dir));
}

export function filterComments(list: readonly VisualComment[], f: Filters): VisualComment[] {
  const out = list.filter(
    (c) =>
      (f.statuses.length === 0 || f.statuses.includes(c.status)) &&
      (f.collection === null || c.collection === f.collection) &&
      matchesQuery(c, f.query),
  );
  return sortComments(out, f.sort);
}

export function countByStatus(list: readonly VisualComment[]): Record<CommentStatus, number> {
  const counts: Record<CommentStatus, number> = { pending: 0, in_progress: 0, resolved: 0, ignored: 0, archived: 0 };
  for (const c of list) counts[c.status] += 1;
  return counts;
}

export function toggleStatus(current: readonly CommentStatus[], status: CommentStatus): CommentStatus[] {
  return current.includes(status) ? current.filter((s) => s !== status) : [...current, status];
}

/** Plan de movimiento por lote: sin ids repetidos, sin ids desconocidos y sin los que ya estan en destino. */
export function planBatchMove(selected: Iterable<string>, comments: readonly VisualComment[], target: string): { ids: string[]; skipped: string[] } {
  const byId = new Map(comments.map((c) => [c.id as string, c]));
  const ids: string[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  for (const id of selected) {
    if (seen.has(id)) continue;
    seen.add(id);
    const c = byId.get(id);
    if (!c || c.collection === target) skipped.push(id);
    else ids.push(id);
  }
  return { ids, skipped };
}
