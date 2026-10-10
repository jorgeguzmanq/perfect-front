import { useEffect, useId, useState } from "react";
import type { CollectionInfo, ProjectSummary, ResolveCommentRequest, VisualComment } from "@perfect-front/shared";
import { ApiError, type ApiClient } from "../api/client";
import { copyText } from "../lib/clipboard";
import { hasEditConflict, isConflictError } from "../lib/conflict";
import { formatDate } from "../lib/format";
import { safeHttpUrl } from "../lib/html";
import { buildAgentPrompt } from "../lib/prompt";
import { ResolveForm } from "./ResolveForm";
import { Screenshot } from "./Screenshot";
import { StatusChip } from "./StatusChip";

interface Props {
  api: ApiClient;
  projectId: string;
  project: ProjectSummary | null;
  comment: VisualComment;
  collections: CollectionInfo[];
  onUpdated: (c: VisualComment) => void;
  onCollectionsChanged: () => void;
  announce: (message: string) => void;
}

function CopyButton({ text, label, announce, children }: { text: string; label: string; announce: (m: string) => void; children?: React.ReactNode }) {
  return (
    <button
      type="button"
      className="pf-btn"
      aria-label={label}
      onClick={() => void copyText(text).then((ok) => announce(ok ? "Copiado al portapapeles" : "No se pudo copiar"))}
    >
      {children ?? "Copiar"}
    </button>
  );
}

/** HTML capturado: SIEMPRE como texto dentro de <pre><code>; React lo escapa. Nunca se inyecta como marcado. */
export function HtmlCode({ html }: { html: string }) {
  return (
    <pre className="db-code" tabIndex={0} aria-label="HTML capturado (solo lectura)">
      <code>{html}</code>
    </pre>
  );
}

const errorMessage = (e: unknown): string => (e instanceof ApiError || e instanceof Error ? e.message : "Error desconocido");

export function CommentDetail({ api, projectId, project, comment, collections, onUpdated, onCollectionsChanged, announce }: Props) {
  const uid = useId();
  const [editing, setEditing] = useState<{ base: string; text: string } | null>(null);
  const [serverConflict, setServerConflict] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moveTo, setMoveTo] = useState("");

  // Al cambiar de comentario se reinicia todo el estado local.
  useEffect(() => {
    setEditing(null);
    setServerConflict(false);
    setResolving(false);
    setError(null);
    setMoveTo("");
  }, [comment.id]);

  const conflict = editing !== null && (serverConflict || hasEditConflict({ updatedAt: editing.base }, comment));
  const { location: loc } = comment;
  const pageUrl = safeHttpUrl(loc.url);

  const run = async (label: string, fn: () => Promise<VisualComment>, done: string): Promise<boolean> => {
    setBusy(label);
    setError(null);
    try {
      const next = await fn();
      onUpdated(next);
      announce(done);
      return true;
    } catch (e) {
      if (isConflictError(e)) {
        setServerConflict(true);
        setError("El comentario cambió desde que lo abriste. Recarga la versión actual para continuar.");
      } else setError(errorMessage(e));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const patchStatus = (status: "in_progress" | "ignored", done: string) =>
    run(status, () => api.updateComment(projectId, comment.id, { status }, comment.updatedAt), done);

  const archive = () =>
    run(
      "archive",
      async () => {
        const patched = await api.updateComment(projectId, comment.id, { status: "archived" }, comment.updatedAt);
        if (patched.collection === "archived") return patched;
        if (!collections.some((c) => c.name === "archived")) {
          await api.createCollection(projectId, "archived").catch(() => undefined);
          onCollectionsChanged();
        }
        return api.moveComment(projectId, comment.id, "archived");
      },
      "Comentario archivado",
    );

  const reload = async (keepText: boolean): Promise<void> => {
    setBusy("reload");
    try {
      const fresh = await api.getComment(projectId, comment.id);
      onUpdated(fresh);
      setServerConflict(false);
      setError(null);
      setEditing(keepText && editing ? { base: fresh.updatedAt, text: editing.text } : null);
      announce(keepText ? "Versión actual cargada; tu texto se conserva" : "Versión actual cargada");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const saveEdit = async (): Promise<void> => {
    if (!editing) return;
    const text = editing.text.trim();
    if (text === "") return setError("El comentario no puede quedar vacío.");
    if (text === comment.comment) return setEditing(null);
    const ok = await run("save", () => api.updateComment(projectId, comment.id, { comment: text }, editing.base), "Comentario guardado");
    if (ok) setEditing(null);
  };

  const resolve = async (req: ResolveCommentRequest): Promise<void> => {
    const ok = await run("resolve", () => api.resolveComment(projectId, comment.id, req), "Comentario resuelto");
    if (ok) setResolving(false);
  };

  const status = comment.status;
  const canResolve = status !== "resolved" && status !== "archived";
  const canReopen = status === "resolved" || status === "ignored" || status === "archived";
  const moveTargets = collections.filter((c) => c.name !== comment.collection);
  const disabled = busy !== null;

  return (
    <article className="db-detail" aria-labelledby={`${uid}-h`}>
      <header className="db-detail-head">
        <h2 id={`${uid}-h`} className="db-detail-title">
          <code>{comment.id}</code>
        </h2>
        <StatusChip status={status} />
        <span className="db-muted">
          {comment.collection} · creado {formatDate(comment.createdAt)} · actualizado {formatDate(comment.updatedAt)}
        </span>
      </header>

      {error ? (
        <div className="db-warning" role="alert">
          {error}
        </div>
      ) : null}

      <div className="db-actions" role="toolbar" aria-label="Acciones del comentario">
        {pageUrl ? (
          <a className="pf-btn pf-focusable" href={pageUrl} target="_blank" rel="noopener noreferrer">
            Abrir comentario en la página<span className="db-sr-only"> (nueva pestaña)</span>
          </a>
        ) : null}
        <CopyButton text={buildAgentPrompt(comment, project?.name)} label="Copiar prompt para el agente" announce={announce}>
          Copiar prompt para el agente
        </CopyButton>
        {canResolve ? (
          <button type="button" className="pf-btn pf-btn--primary" disabled={disabled} aria-expanded={resolving} onClick={() => setResolving(!resolving)}>
            Resolver…
          </button>
        ) : null}
        {status === "pending" ? (
          <button type="button" className="pf-btn" disabled={disabled} onClick={() => void patchStatus("in_progress", "Marcado en progreso")}>
            En progreso
          </button>
        ) : null}
        {status === "pending" || status === "in_progress" ? (
          <button type="button" className="pf-btn" disabled={disabled} onClick={() => void patchStatus("ignored", "Comentario ignorado")}>
            Ignorar
          </button>
        ) : null}
        {canReopen ? (
          <button type="button" className="pf-btn" disabled={disabled} onClick={() => void run("reopen", () => api.reopenComment(projectId, comment.id), "Comentario reabierto")}>
            Reabrir
          </button>
        ) : null}
        {status !== "archived" ? (
          <button type="button" className="pf-btn" disabled={disabled} onClick={() => void archive()}>
            Archivar
          </button>
        ) : null}
      </div>

      {moveTargets.length > 0 ? (
        <div className="db-inline-form">
          <label htmlFor={`${uid}-move`}>Mover a colección</label>
          <select id={`${uid}-move`} className="pf-input" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
            <option value="">Elegir…</option>
            {moveTargets.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
          <button type="button" className="pf-btn" disabled={disabled || moveTo === ""} onClick={() => void run("move", () => api.moveComment(projectId, comment.id, moveTo), `Movido a ${moveTo}`)}>
            Mover
          </button>
        </div>
      ) : null}

      {resolving ? <ResolveForm busy={busy === "resolve"} onSubmit={(r) => void resolve(r)} onCancel={() => setResolving(false)} /> : null}

      <section className="db-section" aria-label="Captura">
        <h3>Captura</h3>
        <Screenshot api={api} projectId={projectId} commentId={comment.id} attachment={comment.attachments[0] ?? null} alt={`Captura del comentario ${comment.id} en ${loc.route}`} />
      </section>

      <section className="db-section" aria-label="Texto del comentario">
        <h3>Comentario</h3>
        {editing ? (
          <div>
            {conflict ? (
              <div className="db-warning" role="alert">
                <p>
                  <strong>Conflicto de edición.</strong> Este comentario cambió después de que empezaste a editar (actualizado {formatDate(comment.updatedAt)}).
                </p>
                <div className="db-actions">
                  <button type="button" className="pf-btn pf-btn--primary" disabled={disabled} onClick={() => void reload(false)}>
                    Recargar y descartar mi edición
                  </button>
                  <button type="button" className="pf-btn" disabled={disabled} onClick={() => void reload(true)}>
                    Recargar y conservar mi texto
                  </button>
                </div>
              </div>
            ) : null}
            <label htmlFor={`${uid}-text`} className="db-sr-only">
              Texto del comentario
            </label>
            <textarea id={`${uid}-text`} className="pf-input db-textarea" rows={5} maxLength={10_000} value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })} />
            <div className="db-actions">
              <button type="button" className="pf-btn pf-btn--primary" disabled={disabled || conflict} onClick={() => void saveEdit()}>
                Guardar
              </button>
              <button type="button" className="pf-btn" disabled={disabled} onClick={() => { setEditing(null); setServerConflict(false); }}>
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <div>
            <p className="db-comment-text">{comment.comment}</p>
            <button type="button" className="pf-btn" disabled={disabled} onClick={() => setEditing({ base: comment.updatedAt, text: comment.comment })}>
              Editar texto
            </button>
          </div>
        )}
      </section>

      <section className="db-section" aria-label="Contexto">
        <h3>Contexto</h3>
        <dl className="db-dl">
          <dt>Ruta</dt>
          <dd>
            <code>{loc.route}</code>
          </dd>
          <dt>URL</dt>
          <dd>
            <code>{loc.url}</code>
          </dd>
          {loc.title ? (
            <>
              <dt>Título</dt>
              <dd>{loc.title}</dd>
            </>
          ) : null}
          <dt>Ámbito</dt>
          <dd>{comment.scope === "element" ? "Elemento" : "Vista completa"}</dd>
          {loc.text ? (
            <>
              <dt>Texto del elemento</dt>
              <dd>{loc.text}</dd>
            </>
          ) : null}
          {loc.componentHint ? (
            <>
              <dt>Componente (pista)</dt>
              <dd>{loc.componentHint}</dd>
            </>
          ) : null}
          <dt>Viewport</dt>
          <dd>
            {comment.viewport.width}×{comment.viewport.height} @{comment.viewport.devicePixelRatio}x · scroll {comment.viewport.scrollX},{comment.viewport.scrollY}
          </dd>
          {comment.elementRect ? (
            <>
              <dt>Rect del elemento</dt>
              <dd>
                x {comment.elementRect.x}, y {comment.elementRect.y}, {comment.elementRect.width}×{comment.elementRect.height}
              </dd>
            </>
          ) : null}
          {comment.environment.browser || comment.environment.framework ? (
            <>
              <dt>Entorno</dt>
              <dd>{[comment.environment.browser, comment.environment.framework, comment.environment.colorScheme].filter(Boolean).join(" · ")}</dd>
            </>
          ) : null}
        </dl>
      </section>

      {loc.selector || loc.selectorCandidates.length > 0 ? (
        <section className="db-section" aria-label="Selectores">
          <h3>Selectores</h3>
          <ul className="db-selectors">
            {[...(loc.selector ? [loc.selector] : []), ...loc.selectorCandidates.filter((s) => s !== loc.selector)].map((s) => (
              <li key={s}>
                <code>{s}</code>
                <CopyButton text={s} label={`Copiar selector ${s}`} announce={announce} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {loc.html ? (
        <section className="db-section" aria-label="HTML capturado">
          <h3>HTML capturado</h3>
          <HtmlCode html={loc.html} />
        </section>
      ) : null}

      <section className="db-section" aria-label="Resolución e historial">
        <h3>Resolución e historial</h3>
        {comment.resolution ? (
          <div className="db-card">
            <p>{comment.resolution.summary}</p>
            <dl className="db-dl">
              <dt>Resuelto</dt>
              <dd>
                {formatDate(comment.resolution.resolvedAt)}
                {comment.resolution.resolvedBy ? ` por ${comment.resolution.resolvedBy}` : ""}
              </dd>
              {comment.resolution.commit ? (
                <>
                  <dt>Commit</dt>
                  <dd>
                    <code>{comment.resolution.commit}</code>
                  </dd>
                </>
              ) : null}
              {comment.resolution.filesChanged.length > 0 ? (
                <>
                  <dt>Archivos</dt>
                  <dd>
                    <ul>
                      {comment.resolution.filesChanged.map((f) => (
                        <li key={f}>
                          <code>{f}</code>
                        </li>
                      ))}
                    </ul>
                  </dd>
                </>
              ) : null}
              {comment.resolution.verification.length > 0 ? (
                <>
                  <dt>Verificación</dt>
                  <dd>
                    <ul>
                      {comment.resolution.verification.map((v, i) => (
                        <li key={i}>{v}</li>
                      ))}
                    </ul>
                  </dd>
                </>
              ) : null}
            </dl>
          </div>
        ) : (
          <p className="db-muted">Sin resolución registrada.</p>
        )}
        <ol className="db-timeline">
          <li>Creado {formatDate(comment.createdAt)}</li>
          {comment.updatedAt !== comment.createdAt ? <li>Última actualización {formatDate(comment.updatedAt)}</li> : null}
          {comment.resolution ? <li>Resuelto {formatDate(comment.resolution.resolvedAt)}</li> : null}
        </ol>
      </section>
    </article>
  );
}
