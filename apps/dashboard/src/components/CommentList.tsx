import { useId, useRef, useState } from "react";
import { commentStatuses, type CommentStatus } from "@perfect-front/design-tokens";
import type { CollectionInfo, VisualComment } from "@perfect-front/shared";
import type { CorruptEntry } from "../api/client";
import { validateCollectionName } from "../lib/collections";
import { toggleStatus, type Filters, type SortOrder } from "../lib/filters";
import { STATUS_LABEL, formatDate, truncate } from "../lib/format";
import { StatusChip } from "./StatusChip";

interface Props {
  comments: VisualComment[];
  visible: VisualComment[];
  collections: CollectionInfo[];
  corrupt: CorruptEntry[];
  filters: Filters;
  selectedId: string | null;
  checked: ReadonlySet<string>;
  statusCounts: Record<CommentStatus, number>;
  onFilters: (f: Filters) => void;
  onOpen: (id: string) => void;
  onToggleChecked: (id: string) => void;
  onCheckAll: (ids: string[]) => void;
  onClearChecked: () => void;
  onBatchMove: (to: string) => void;
  /** Devuelve un mensaje de error o null si se creó. */
  onCreateCollection: (name: string) => Promise<string | null>;
  batchBusy: boolean;
}

export function CommentList(p: Props) {
  const listRef = useRef<HTMLUListElement>(null);
  const uid = useId();
  const [batchTarget, setBatchTarget] = useState("");
  const [newName, setNewName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const { filters, onFilters } = p;

  const onListKey = (e: React.KeyboardEvent<HTMLUListElement>): void => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const items = [...(listRef.current?.querySelectorAll<HTMLButtonElement>("button.db-item-main") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (items.length === 0 || i === -1) return;
    e.preventDefault();
    const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : e.key === "ArrowDown" ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1);
    items[next]?.focus();
  };

  const submitCollection = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const v = validateCollectionName(newName, p.collections.map((c) => c.name));
    if (!v.ok) return setNameError(v.message);
    const err = await p.onCreateCollection(v.name);
    setNameError(err);
    if (err === null) setNewName("");
  };

  return (
    <div className="db-comments">
      <div className="db-field">
        <label htmlFor={`${uid}-q`}>Buscar por ID, texto o ruta</label>
        <input id={`${uid}-q`} type="search" className="pf-input" value={filters.query} placeholder="p. ej. /pricing" onChange={(e) => onFilters({ ...filters, query: e.target.value })} />
      </div>

      <fieldset className="db-fieldset">
        <legend>Estado</legend>
        <div className="db-chips">
          {commentStatuses.map((s) => (
            <button key={s} type="button" className="db-filter pf-focusable" aria-pressed={filters.statuses.includes(s)} onClick={() => onFilters({ ...filters, statuses: toggleStatus(filters.statuses, s) })}>
              {STATUS_LABEL[s]} <span className="db-muted">{p.statusCounts[s]}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="db-fieldset">
        <legend>Colección</legend>
        <div className="db-chips">
          <button type="button" className="db-filter pf-focusable" aria-pressed={filters.collection === null} onClick={() => onFilters({ ...filters, collection: null })}>
            Todas <span className="db-muted">{p.comments.length}</span>
          </button>
          {p.collections.map((c) => (
            <button key={c.name} type="button" className="db-filter pf-focusable" aria-pressed={filters.collection === c.name} onClick={() => onFilters({ ...filters, collection: c.name })}>
              {c.name} <span className="db-muted">{c.count}</span>
            </button>
          ))}
        </div>
        <form className="db-inline-form" onSubmit={(e) => void submitCollection(e)} noValidate>
          <label className="db-sr-only" htmlFor={`${uid}-col`}>
            Nombre de la nueva colección
          </label>
          <input
            id={`${uid}-col`}
            className="pf-input"
            value={newName}
            placeholder="Nueva colección"
            maxLength={64}
            aria-invalid={nameError !== null}
            aria-describedby={nameError ? `${uid}-col-err` : undefined}
            onChange={(e) => {
              setNewName(e.target.value);
              setNameError(null);
            }}
          />
          <button type="submit" className="pf-btn">
            Crear
          </button>
        </form>
        {nameError ? (
          <p id={`${uid}-col-err`} className="db-error" role="alert">
            {nameError}
          </p>
        ) : null}
      </fieldset>

      <div className="db-field">
        <label htmlFor={`${uid}-sort`}>Orden</label>
        <select id={`${uid}-sort`} className="pf-input" value={filters.sort} onChange={(e) => onFilters({ ...filters, sort: e.target.value as SortOrder })}>
          <option value="newest">Más recientes primero</option>
          <option value="oldest">Más antiguos primero</option>
        </select>
      </div>

      {p.corrupt.length > 0 ? (
        <div className="db-warning" role="status">
          <strong>{p.corrupt.length === 1 ? "1 archivo de comentario ilegible" : `${p.corrupt.length} archivos de comentario ilegibles`}.</strong> Se omiten de la lista:
          <ul>
            {p.corrupt.slice(0, 5).map((c) => (
              <li key={`${c.collection}/${c.file}`}>
                <code>
                  {c.collection}/{c.file}
                </code>{" "}
                — {c.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {p.checked.size > 0 ? (
        <div className="db-batch" role="group" aria-label="Acciones por lote">
          <span>{p.checked.size} seleccionados</span>
          <label className="db-sr-only" htmlFor={`${uid}-batch`}>
            Mover seleccionados a
          </label>
          <select id={`${uid}-batch`} className="pf-input" value={batchTarget} onChange={(e) => setBatchTarget(e.target.value)}>
            <option value="">Mover a…</option>
            {p.collections.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
          <button type="button" className="pf-btn pf-btn--primary" disabled={batchTarget === "" || p.batchBusy} onClick={() => p.onBatchMove(batchTarget)}>
            Mover
          </button>
          <button type="button" className="pf-btn" onClick={p.onClearChecked}>
            Limpiar
          </button>
        </div>
      ) : p.visible.length > 1 ? (
        <button type="button" className="pf-btn" onClick={() => p.onCheckAll(p.visible.map((c) => c.id))}>
          Seleccionar los {p.visible.length} visibles
        </button>
      ) : null}

      {p.visible.length === 0 ? (
        <div className="db-empty">
          {p.comments.length === 0 ? <p>Este proyecto aún no tiene comentarios.</p> : <p>Ningún comentario coincide con los filtros.</p>}
          {p.comments.length > 0 ? (
            <button type="button" className="pf-btn" onClick={() => onFilters({ ...filters, query: "", statuses: [], collection: null })}>
              Quitar filtros
            </button>
          ) : null}
        </div>
      ) : (
        <ul className="db-list db-comment-list" ref={listRef} aria-label={`Comentarios (${p.visible.length})`} onKeyDown={onListKey}>
          {p.visible.map((c) => (
            <li key={c.id} className="db-item">
              <input type="checkbox" className="db-check" checked={p.checked.has(c.id)} onChange={() => p.onToggleChecked(c.id)} aria-label={`Seleccionar ${c.id}`} />
              <button type="button" className="db-item-main pf-focusable" aria-current={c.id === p.selectedId ? "true" : undefined} onClick={() => p.onOpen(c.id)}>
                <span className="db-item-text">{truncate(c.comment, 90)}</span>
                <span className="db-item-meta">
                  <StatusChip status={c.status} />
                  <span className="db-muted">
                    {c.location.route} · {c.collection} · {formatDate(c.createdAt)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
