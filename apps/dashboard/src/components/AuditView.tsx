import { useId, useMemo, useState } from "react";
import { commentStatuses, type CommentStatus } from "@perfect-front/design-tokens";
import type { LocationSource, ReadingGroup, VisualComment } from "@perfect-front/shared";
import type { ApiClient } from "../api/client";
import { DEFAULT_AUDIT_FILTERS, NO_GROUP, buildAuditRows, distinctRoutes, elementsLabel, filterAudit, sourceKey, sourceLabel, stepLabel, type AuditFilters, type AuditRow } from "../lib/audit";
import { toggleStatus } from "../lib/filters";
import { STATUS_LABEL, truncate } from "../lib/format";
import { Screenshot } from "./Screenshot";
import { StatusChip } from "./StatusChip";

const MAX_THUMBS = 4;

interface Props {
  api: ApiClient;
  projectId: string;
  comments: VisualComment[];
  groups: ReadingGroup[];
  /** Fallo al cargar los grupos: la vista sigue funcionando con los ids de grupo. */
  groupsError: string | null;
  onOpenComment: (id: string) => void;
  announce: (msg: string) => void;
}

type OpenState = { kind: "ok" | "error"; message: string };

/** Vista de auditoria: todos los comentarios del proyecto con su contexto (cola, elementos, adjuntos) para revisarlos de un vistazo. */
export function AuditView({ api, projectId, comments, groups, groupsError, onOpenComment, announce }: Props) {
  const uid = useId();
  const [filters, setFilters] = useState<AuditFilters>(DEFAULT_AUDIT_FILTERS);
  const [opened, setOpened] = useState<Record<string, OpenState>>({});
  const [opening, setOpening] = useState<string | null>(null);

  const rows = useMemo(() => buildAuditRows(comments, groups), [comments, groups]);
  const visible = useMemo(() => filterAudit(rows, filters), [rows, filters]);
  const routes = useMemo(() => distinctRoutes(comments), [comments]);
  const groupOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) if (r.groupId && !seen.has(r.groupId)) seen.set(r.groupId, r.groupName ?? r.groupId);
    return [...seen].sort((a, b) => a[1].localeCompare(b[1], "es"));
  }, [rows]);

  const openSource = async (key: string, src: LocationSource): Promise<void> => {
    setOpening(key);
    try {
      await api.openInEditor(projectId, { file: src.file, line: src.line ?? 1, ...(src.column != null ? { column: src.column } : {}) });
      setOpened((o) => ({ ...o, [key]: { kind: "ok", message: `Abierto ${sourceLabel(src)} en el editor.` } }));
      announce(`Abierto ${sourceLabel(src)} en el editor`);
    } catch (e) {
      setOpened((o) => ({ ...o, [key]: { kind: "error", message: e instanceof Error ? e.message : "No se pudo abrir el editor." } }));
    } finally {
      setOpening(null);
    }
  };

  const filtered = filters.statuses.length > 0 || filters.group !== null || filters.route !== null || filters.query.trim() !== "";

  return (
    <section className="db-audit" aria-labelledby={`${uid}-title`}>
      <header className="db-audit-head">
        <h2 id={`${uid}-title`} className="db-panel-title">
          Auditoría
        </h2>
        <p className="db-muted" role="status">
          {visible.length} de {comments.length} comentario{comments.length === 1 ? "" : "s"}
        </p>
      </header>

      {groupsError ? (
        <div className="db-warning" role="alert">
          No se pudieron cargar los grupos ({groupsError}); se muestran sus identificadores.
        </div>
      ) : null}

      <div className="db-audit-filters">
        <div className="db-field">
          <label htmlFor={`${uid}-q`}>Buscar</label>
          <input id={`${uid}-q`} type="search" className="pf-input" value={filters.query} placeholder="ID, texto, ruta, grupo o archivo" onChange={(e) => setFilters({ ...filters, query: e.target.value })} />
        </div>
        <div className="db-field">
          <label htmlFor={`${uid}-group`}>Grupo</label>
          <select id={`${uid}-group`} className="pf-input" value={filters.group ?? ""} onChange={(e) => setFilters({ ...filters, group: e.target.value === "" ? null : e.target.value })}>
            <option value="">Todos</option>
            <option value={NO_GROUP}>Sin grupo</option>
            {groupOptions.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div className="db-field">
          <label htmlFor={`${uid}-route`}>Ruta</label>
          <select id={`${uid}-route`} className="pf-input" value={filters.route ?? ""} onChange={(e) => setFilters({ ...filters, route: e.target.value === "" ? null : e.target.value })}>
            <option value="">Todas</option>
            {routes.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <fieldset className="db-fieldset">
          <legend>Estado</legend>
          <div className="db-chips">
            {commentStatuses.map((s: CommentStatus) => (
              <button key={s} type="button" className="db-filter pf-focusable" aria-pressed={filters.statuses.includes(s)} onClick={() => setFilters({ ...filters, statuses: toggleStatus(filters.statuses, s) })}>
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      {comments.length === 0 ? (
        <div className="db-empty">
          <p>Este proyecto aún no tiene comentarios.</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="db-empty">
          <p>Ningún comentario coincide con los filtros.</p>
          {filtered ? (
            <button type="button" className="pf-btn" onClick={() => setFilters(DEFAULT_AUDIT_FILTERS)}>
              Limpiar filtros
            </button>
          ) : null}
        </div>
      ) : (
        <ol className="db-audit-list">
          {visible.map((r) => (
            <AuditItem key={r.comment.id} row={r} api={api} projectId={projectId} opened={opened} opening={opening} onOpenComment={onOpenComment} onOpenSource={openSource} />
          ))}
        </ol>
      )}
    </section>
  );
}

interface ItemProps {
  row: AuditRow;
  api: ApiClient;
  projectId: string;
  opened: Record<string, OpenState>;
  opening: string | null;
  onOpenComment: (id: string) => void;
  onOpenSource: (key: string, src: LocationSource) => Promise<void>;
}

function AuditItem({ row, api, projectId, opened, opening, onOpenComment, onOpenSource }: ItemProps) {
  const c = row.comment;
  const step = stepLabel(row);
  const els = elementsLabel(row);
  const thumbs = c.attachments.slice(0, MAX_THUMBS);
  return (
    <li className="db-audit-item" aria-label={`Comentario ${c.id}`}>
      <div className="db-item-meta">
        <StatusChip status={c.status} />
        {step ? <span className="db-chip">{step}</span> : null}
        {els ? <span className="db-chip">{els}</span> : null}
        {row.sections > 0 ? <span className="db-chip">{row.sections} {row.sections === 1 ? "sección" : "secciones"}</span> : null}
        {row.proposals > 0 ? <span className="db-chip">{row.proposals} {row.proposals === 1 ? "propuesta" : "propuestas"}</span> : null}
        <code className="db-muted">{c.location.route}</code>
      </div>
      <p className="db-audit-text">{truncate(c.comment, 280)}</p>
      {thumbs.length > 0 ? (
        <div className="db-thumbs">
          {thumbs.map((a) => (
            <Screenshot key={a} api={api} projectId={projectId} commentId={c.id} attachment={a} alt={`Adjunto de ${c.id}`} compact />
          ))}
          {c.attachments.length > MAX_THUMBS ? <span className="db-muted">+{c.attachments.length - MAX_THUMBS}</span> : null}
        </div>
      ) : null}
      <div className="db-actions">
        <button type="button" className="pf-btn" onClick={() => onOpenComment(c.id)}>
          Ver detalle<span className="db-sr-only"> de {c.id}</span>
        </button>
        {row.sources.map((s) => {
          const key = `${c.id}|${sourceKey(s)}`;
          return (
            <button key={key} type="button" className="pf-btn" disabled={opening === key} onClick={() => void onOpenSource(key, s)}>
              Abrir en el código <code>{sourceLabel(s)}</code>
            </button>
          );
        })}
      </div>
      {row.sources.map((s) => {
        const key = `${c.id}|${sourceKey(s)}`;
        const state = opened[key];
        return state ? (
          <p key={key} className={state.kind === "error" ? "db-error" : "db-muted"} role={state.kind === "error" ? "alert" : "status"}>
            {state.message}
          </p>
        ) : null;
      })}
    </li>
  );
}
