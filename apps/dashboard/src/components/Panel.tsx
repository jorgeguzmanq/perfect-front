import type { ReactNode } from "react";

interface Props {
  id: string;
  title: string;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
  className?: string;
}

/** Panel lateral plegable. Colapsado deja un riel con un unico boton (foco accesible). */
export function Panel({ id, title, collapsed, onToggle, children, className = "" }: Props) {
  return (
    <section className={`db-panel ${collapsed ? "is-collapsed" : ""} ${className}`} aria-labelledby={`${id}-title`}>
      <header className="db-panel-head">
        <h2 id={`${id}-title`} className="db-panel-title">
          {title}
        </h2>
        <button type="button" className="pf-btn db-icon-btn" aria-expanded={!collapsed} aria-controls={`${id}-body`} onClick={onToggle}>
          <span aria-hidden="true">{collapsed ? "»" : "«"}</span>
          <span className="db-sr-only">{collapsed ? `Mostrar ${title}` : `Ocultar ${title}`}</span>
        </button>
      </header>
      <div id={`${id}-body`} className="db-panel-body" hidden={collapsed}>
        {children}
      </div>
    </section>
  );
}
