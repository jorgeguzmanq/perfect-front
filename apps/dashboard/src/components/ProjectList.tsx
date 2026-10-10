import type { ProjectSummary } from "@perfect-front/shared";
import { PROCESS_LABEL } from "../lib/format";
import { safeHttpUrl } from "../lib/html";

interface Props {
  projects: ProjectSummary[];
  selectedId: string | null;
  busyId: string | null;
  onSelect: (id: string) => void;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
}

export function ProjectList({ projects, selectedId, busyId, onSelect, onStart, onStop }: Props) {
  if (projects.length === 0) {
    return (
      <div className="db-empty">
        <p>No hay proyectos registrados.</p>
        <p className="db-muted">
          Ejecuta <code>perfect-front</code> dentro de tu proyecto para registrarlo.
        </p>
      </div>
    );
  }
  return (
    <ul className="db-list" aria-label="Proyectos">
      {projects.map((p) => {
        const href = p.url ? safeHttpUrl(p.url) : null;
        const running = p.processState === "running" || p.processState === "starting";
        return (
          <li key={p.id} className="db-project">
            <button type="button" className="db-project-main pf-focusable" aria-current={p.id === selectedId ? "true" : undefined} onClick={() => onSelect(p.id)}>
              <span className="db-project-name">{p.name}</span>
              <span className="db-badge" aria-label={`${p.pendingCount} pendientes`}>
                {p.pendingCount}
              </span>
              <span className="db-muted db-project-meta">
                {PROCESS_LABEL[p.processState]}
                {p.framework ? ` · ${p.framework}` : ""}
                {p.url ? ` · ${p.url}` : ""}
              </span>
            </button>
            <div className="db-project-actions">
              {href ? (
                <a className="pf-btn pf-focusable" href={href} target="_blank" rel="noopener noreferrer">
                  Abrir app<span className="db-sr-only"> {p.name} (nueva pestaña)</span>
                </a>
              ) : null}
              {running ? (
                <button type="button" className="pf-btn" disabled={busyId === p.id} onClick={() => onStop(p.id)}>
                  Detener<span className="db-sr-only"> {p.name}</span>
                </button>
              ) : p.processState !== "external" ? (
                <button type="button" className="pf-btn" disabled={busyId === p.id} onClick={() => onStart(p.id)}>
                  Iniciar<span className="db-sr-only"> {p.name}</span>
                </button>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
