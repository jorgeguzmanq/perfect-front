import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CollectionInfo, PerfectFrontEvent, ProjectSummary, VisualComment } from "@perfect-front/shared";
import { ApiError, type ApiClient, type CorruptEntry } from "./api/client";
import { CommentDetail } from "./components/CommentDetail";
import { CommentList } from "./components/CommentList";
import { useAnnouncer } from "./components/LiveRegion";
import { Panel } from "./components/Panel";
import { ProjectList } from "./components/ProjectList";
import { useEventStream, type StreamState } from "./hooks/useEventStream";
import { useRoute } from "./hooks/useRoute";
import { upsertComment } from "./lib/conflict";
import { applyCommentEvent } from "./lib/events";
import { DEFAULT_FILTERS, countByStatus, filterComments, planBatchMove, type Filters } from "./lib/filters";

type Load<T> = { status: "loading" } | { status: "error"; message: string; auth: boolean } | { status: "ready"; data: T };

const toError = (e: unknown): { status: "error"; message: string; auth: boolean } => ({
  status: "error",
  message: e instanceof Error ? e.message : "Error desconocido",
  auth: e instanceof ApiError && e.isAuth,
});

const NARROW = "(max-width: 52rem)";
const STREAM_LABEL: Record<StreamState, string> = { connecting: "Conectando…", live: "En vivo", reconnecting: "Reconectando…" };

interface ProjectData {
  comments: VisualComment[];
  corrupt: CorruptEntry[];
  collections: CollectionInfo[];
}

export function App({ api }: { api: ApiClient }) {
  const [route, navigate] = useRoute();
  const { announce, region } = useAnnouncer();
  const [projects, setProjects] = useState<Load<ProjectSummary[]>>({ status: "loading" });
  const [data, setData] = useState<Load<ProjectData>>({ status: "loading" });
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [collapsed, setCollapsed] = useState({ projects: false, list: false });
  const [stream, setStream] = useState<StreamState>("connecting");
  const [busyProject, setBusyProject] = useState<string | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const projectId = route.projectId;
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;
  const seq = useRef(0);

  const loadProjects = useCallback(async (): Promise<void> => {
    try {
      const list = await api.listProjects();
      setProjects({ status: "ready", data: list });
    } catch (e) {
      setProjects((prev) => (prev.status === "ready" ? prev : toError(e)));
    }
  }, [api]);

  const loadProject = useCallback(
    async (id: string, quiet = false): Promise<void> => {
      const mine = ++seq.current;
      if (!quiet) setData({ status: "loading" });
      try {
        const [list, collections] = await Promise.all([api.listComments(id), api.listCollections(id)]);
        if (mine === seq.current) setData({ status: "ready", data: { comments: list.comments, corrupt: list.corrupt, collections } });
      } catch (e) {
        if (mine === seq.current) setData((prev) => (quiet && prev.status === "ready" ? prev : toError(e)));
      }
    },
    [api],
  );

  const reloadCollections = useCallback(async (): Promise<void> => {
    const id = projectIdRef.current;
    if (!id) return;
    try {
      const collections = await api.listCollections(id);
      setData((prev) => (prev.status === "ready" && projectIdRef.current === id ? { status: "ready", data: { ...prev.data, collections } } : prev));
    } catch {
      /* el siguiente evento o recarga lo corrige */
    }
  }, [api]);

  useEffect(() => void loadProjects(), [loadProjects]);

  // Sin proyecto en la URL: abrir el primero disponible.
  useEffect(() => {
    if (projectId === null && projects.status === "ready" && projects.data[0]) navigate({ projectId: projects.data[0].id, commentId: null }, true);
  }, [projectId, projects, navigate]);

  useEffect(() => {
    setChecked(new Set());
    setFilters(DEFAULT_FILTERS);
    if (projectId) void loadProject(projectId);
  }, [projectId, loadProject]);

  // En ventanas estrechas, abrir un comentario pliega los paneles laterales para dejar el detalle como superficie principal.
  useEffect(() => {
    if (route.commentId && window.matchMedia?.(NARROW).matches) setCollapsed({ projects: true, list: true });
  }, [route.commentId]);

  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const scheduleRefresh = useCallback((): void => {
    clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      void loadProjects();
      void reloadCollections();
    }, 250);
  }, [loadProjects, reloadCollections]);
  useEffect(() => () => clearTimeout(refreshTimer.current), []);

  const onEvent = useCallback(
    (ev: PerfectFrontEvent): void => {
      if (ev.type === "process.log") return;
      if (ev.type.startsWith("project.") || ev.type === "process.state") void loadProjects();
      if (ev.projectId !== projectIdRef.current) {
        if (ev.type.startsWith("comment.")) scheduleRefresh();
        return;
      }
      if (ev.type.startsWith("comment.")) {
        setData((prev) => (prev.status === "ready" ? { status: "ready", data: { ...prev.data, comments: applyCommentEvent(prev.data.comments, ev) } } : prev));
        scheduleRefresh();
        const id = "comment" in ev ? ev.comment.id : "commentId" in ev ? ev.commentId : null;
        if (id && id === route.commentId && ev.type !== "comment.created") announce("El comentario abierto se actualizó");
        else if (ev.type === "comment.created") announce("Nuevo comentario recibido");
      } else if (ev.type.startsWith("collection.")) {
        scheduleRefresh();
        void loadProject(ev.projectId, true);
      }
    },
    [announce, loadProject, loadProjects, route.commentId, scheduleRefresh],
  );

  useEventStream({
    url: api.eventsUrl(),
    onEvent,
    onState: setStream,
    // Tras reconectar se pudieron perder eventos: recargar en silencio.
    onOpen: (isReconnect) => {
      if (!isReconnect) return;
      void loadProjects();
      if (projectIdRef.current) void loadProject(projectIdRef.current, true);
    },
  });

  const comments = data.status === "ready" ? data.data.comments : [];
  const visible = useMemo(() => filterComments(comments, filters), [comments, filters]);
  const statusCounts = useMemo(() => countByStatus(comments), [comments]);
  const project = projects.status === "ready" ? (projects.data.find((p) => p.id === projectId) ?? null) : null;
  const selected = route.commentId ? (comments.find((c) => c.id === route.commentId) ?? null) : null;

  const onUpdated = useCallback(
    (c: VisualComment): void => {
      setData((prev) => (prev.status === "ready" ? { status: "ready", data: { ...prev.data, comments: upsertComment(prev.data.comments, c) } } : prev));
      scheduleRefresh();
    },
    [scheduleRefresh],
  );

  const toggleChecked = (id: string): void =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const batchMove = async (to: string): Promise<void> => {
    if (!projectId) return;
    const plan = planBatchMove(checked, comments, to);
    if (plan.ids.length === 0) {
      setNotice("Los comentarios seleccionados ya están en esa colección.");
      return;
    }
    setBatchBusy(true);
    setNotice(null);
    try {
      const results = await api.moveComments(projectId, plan.ids, to);
      const okCount = results.filter((r) => r.ok).length;
      for (const r of results) if (r.ok) onUpdated(r.comment);
      const failed = results.length - okCount;
      const msg = `${okCount} movidos a ${to}${plan.skipped.length ? `, ${plan.skipped.length} ya estaban allí` : ""}${failed ? `, ${failed} con error` : ""}.`;
      setNotice(msg);
      announce(msg);
      setChecked(new Set(results.filter((r) => !r.ok).map((r) => r.id)));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "No se pudo mover el lote.");
    } finally {
      setBatchBusy(false);
    }
  };

  const createCollection = async (name: string): Promise<string | null> => {
    if (!projectId) return "Sin proyecto seleccionado.";
    try {
      await api.createCollection(projectId, name);
      await reloadCollections();
      announce(`Colección ${name} creada`);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "No se pudo crear la colección.";
    }
  };

  const projectAction = async (id: string, action: "start" | "stop"): Promise<void> => {
    setBusyProject(id);
    try {
      await (action === "start" ? api.startProject(id) : api.stopProject(id));
      announce(action === "start" ? "Proyecto iniciado" : "Proyecto detenido");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "La acción falló.");
    } finally {
      setBusyProject(null);
      void loadProjects();
    }
  };

  return (
    <div className="pf-root db-app">
      <a className="db-skip" href="#detalle" onClick={() => document.getElementById("detalle")?.focus()}>
        Saltar al detalle
      </a>
      {region}
      <header className="db-topbar">
        <h1 className="db-title">Perfect Front</h1>
        <span className={`db-live db-live--${stream}`}>{STREAM_LABEL[stream]}</span>
      </header>
      {notice ? (
        <div className="db-notice" role="status">
          {notice}{" "}
          <button type="button" className="pf-btn" onClick={() => setNotice(null)}>
            Cerrar
          </button>
        </div>
      ) : null}

      <main className="db-layout" data-projects={collapsed.projects ? "collapsed" : "open"} data-list={collapsed.list ? "collapsed" : "open"}>
        <Panel id="projects" title="Proyectos" collapsed={collapsed.projects} onToggle={() => setCollapsed((c) => ({ ...c, projects: !c.projects }))}>
          {projects.status === "loading" ? <p className="db-muted">Cargando proyectos…</p> : null}
          {projects.status === "error" ? (
            <div className="db-warning" role="alert">
              {projects.auth ? "El token de sesión no es válido. Recarga la página desde el servidor local." : `No se pudieron cargar los proyectos: ${projects.message}`}{" "}
              <button type="button" className="pf-btn" onClick={() => void loadProjects()}>
                Reintentar
              </button>
            </div>
          ) : null}
          {projects.status === "ready" ? (
            <ProjectList projects={projects.data} selectedId={projectId} busyId={busyProject} onSelect={(id) => navigate({ projectId: id, commentId: null })} onStart={(id) => void projectAction(id, "start")} onStop={(id) => void projectAction(id, "stop")} />
          ) : null}
        </Panel>

        <Panel id="comments" title="Comentarios" collapsed={collapsed.list} onToggle={() => setCollapsed((c) => ({ ...c, list: !c.list }))}>
          {data.status === "loading" ? <p className="db-muted">Cargando comentarios…</p> : null}
          {data.status === "error" ? (
            <div className="db-warning" role="alert">
              No se pudieron cargar los comentarios: {data.message}{" "}
              <button type="button" className="pf-btn" onClick={() => projectId && void loadProject(projectId)}>
                Reintentar
              </button>
            </div>
          ) : null}
          {data.status === "ready" ? (
            <CommentList
              comments={comments}
              visible={visible}
              collections={data.data.collections}
              corrupt={data.data.corrupt}
              filters={filters}
              selectedId={route.commentId}
              checked={checked}
              statusCounts={statusCounts}
              onFilters={setFilters}
              onOpen={(id) => navigate({ projectId, commentId: id })}
              onToggleChecked={toggleChecked}
              onCheckAll={(ids) => setChecked(new Set(ids))}
              onClearChecked={() => setChecked(new Set())}
              onBatchMove={(to) => void batchMove(to)}
              onCreateCollection={createCollection}
              batchBusy={batchBusy}
            />
          ) : null}
        </Panel>

        <section id="detalle" className="db-main" tabIndex={-1} aria-label="Detalle del comentario">
          {!projectId ? (
            <div className="db-empty">
              <p>Selecciona un proyecto para ver sus comentarios.</p>
            </div>
          ) : data.status !== "ready" ? null : selected && projectId ? (
            <CommentDetail
              api={api}
              projectId={projectId}
              project={project}
              comment={selected}
              collections={data.data.collections}
              onUpdated={onUpdated}
              onCollectionsChanged={() => void reloadCollections()}
              announce={announce}
            />
          ) : route.commentId ? (
            <div className="db-empty">
              <p>
                No se encontró el comentario <code>{route.commentId}</code>. Pudo moverse o eliminarse.
              </p>
              <button type="button" className="pf-btn" onClick={() => navigate({ projectId, commentId: null })}>
                Volver a la lista
              </button>
            </div>
          ) : (
            <div className="db-empty">
              <p>Elige un comentario de la lista para ver su detalle.</p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

export function MissingToken() {
  return (
    <div className="pf-root db-app">
      <main className="db-empty db-fatal">
        <h1>Perfect Front</h1>
        <p>No hay token de sesión. Abre el dashboard desde el servidor local (la dirección que muestra <code>perfect-front</code>), en este mismo equipo.</p>
        <p className="db-muted">Si usas <code>vite dev</code>, inicia antes el servidor local para que exista el archivo de descubrimiento.</p>
      </main>
    </div>
  );
}
