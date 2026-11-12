import type { CommentStatus, LocationSource, ReadingGroup, VisualComment } from "@perfect-front/shared";

/** Filtro de grupo: null = todos, NO_GROUP = sin grupo, otro valor = id del grupo. */
export const NO_GROUP = "__none__";

export interface AuditFilters {
  query: string;
  statuses: CommentStatus[];
  group: string | null;
  /** null = todas las rutas. */
  route: string | null;
}

export const DEFAULT_AUDIT_FILTERS: AuditFilters = { query: "", statuses: [], group: null, route: null };

export interface AuditRow {
  comment: VisualComment;
  groupId: string | null;
  groupName: string | null;
  /** Posicion en la cola del grupo y total de comentarios del grupo. */
  step: number | null;
  total: number | null;
  /** Elemento principal + los adicionales de la multiseleccion. */
  elements: number;
  sections: number;
  proposals: number;
  sources: LocationSource[];
}

const norm = (s: string): string => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

/** Archivo:linea de las propuestas y de los elementos extra, sin repetidos (el principal no guarda fuente). */
export function collectSources(c: VisualComment): LocationSource[] {
  const out: LocationSource[] = [];
  const seen = new Set<string>();
  const add = (s: LocationSource | null | undefined): void => {
    if (!s) return;
    const key = sourceKey(s);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(s);
  };
  for (const p of c.proposals) {
    if (p.kind === "style") for (const ch of p.changes) add(ch.source);
    else if (p.kind !== "reorder") add(p.source);
  }
  for (const t of c.extraTargets) add(t.source);
  return out;
}

export function buildAuditRows(comments: readonly VisualComment[], groups: readonly ReadingGroup[]): AuditRow[] {
  const names = new Map(groups.map((g) => [g.id as string, g.name]));
  const totals = new Map<string, number>();
  for (const c of comments) if (c.group) totals.set(c.group.id, (totals.get(c.group.id) ?? 0) + 1);
  return comments.map((c) => ({
    comment: c,
    groupId: c.group?.id ?? null,
    groupName: c.group ? (names.get(c.group.id) ?? c.group.id) : null,
    step: c.group?.position ?? null,
    total: c.group ? (totals.get(c.group.id) ?? null) : null,
    elements: c.extraTargets.length + 1,
    sections: c.sections.length,
    proposals: c.proposals.length,
    sources: collectSources(c),
  }));
}

/** Orden de ejecucion: primero los de grupo (por nombre y posicion), luego los sueltos por fecha. */
export function sortAuditRows(rows: readonly AuditRow[]): AuditRow[] {
  return [...rows].sort((a, b) => {
    if ((a.groupId === null) !== (b.groupId === null)) return a.groupId === null ? 1 : -1;
    if (a.groupId !== null && b.groupId !== null) {
      const byGroup = (a.groupName ?? "").localeCompare(b.groupName ?? "", "es");
      if (byGroup !== 0) return byGroup;
      if (a.step !== b.step) return (a.step ?? 0) - (b.step ?? 0);
    }
    return a.comment.createdAt === b.comment.createdAt ? (a.comment.id < b.comment.id ? -1 : 1) : a.comment.createdAt < b.comment.createdAt ? -1 : 1;
  });
}

export function matchesAudit(r: AuditRow, f: AuditFilters): boolean {
  const c = r.comment;
  if (f.statuses.length > 0 && !f.statuses.includes(c.status)) return false;
  if (f.group !== null && (f.group === NO_GROUP ? r.groupId !== null : r.groupId !== f.group)) return false;
  if (f.route !== null && c.location.route !== f.route) return false;
  const q = norm(f.query.trim());
  if (q === "") return true;
  const hay = [c.id, c.comment, c.location.route, c.location.text ?? "", r.groupName ?? "", ...c.sections.map((s) => `${s.title ?? ""} ${s.text}`), ...r.sources.map((s) => s.file)];
  return hay.some((s) => norm(s).includes(q));
}

export function filterAudit(rows: readonly AuditRow[], f: AuditFilters): AuditRow[] {
  return sortAuditRows(rows.filter((r) => matchesAudit(r, f)));
}

export function distinctRoutes(comments: readonly VisualComment[]): string[] {
  return [...new Set(comments.map((c) => c.location.route))].sort((a, b) => a.localeCompare(b));
}

/** Etiquetas de los chips: «paso 2/3 · grupo X» y «3 elementos» (null si no aplica). */
export function stepLabel(r: AuditRow): string | null {
  return r.groupName === null ? null : `paso ${r.step ?? "?"}/${r.total ?? "?"} · grupo ${r.groupName}`;
}
export function elementsLabel(r: AuditRow): string | null {
  return r.elements > 1 ? `${r.elements} elementos` : null;
}
export function sourceKey(s: LocationSource): string {
  return `${s.file}:${s.line ?? ""}:${s.column ?? ""}`;
}
export function sourceLabel(s: LocationSource): string {
  return `${s.file}${s.line ? `:${s.line}` : ""}`;
}
