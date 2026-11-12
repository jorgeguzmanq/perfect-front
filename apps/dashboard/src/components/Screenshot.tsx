import { useEffect, useState } from "react";
import type { ApiClient } from "../api/client";

interface Props {
  api: ApiClient;
  projectId: string;
  commentId: string;
  attachment: string | null;
  alt: string;
  /** Miniatura para listas: sin avisos largos. */
  compact?: boolean;
}

/** Captura servida por el endpoint con token: se descarga con Bearer y se muestra como blob URL local. */
export function Screenshot({ api, projectId, commentId, attachment, alt, compact = false }: Props) {
  const [state, setState] = useState<{ status: "idle" | "loading" | "error"; url: string | null; message?: string }>({ status: "idle", url: null });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!attachment) {
      setState({ status: "idle", url: null });
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    setState({ status: "loading", url: null });
    api
      .getAttachment(projectId, commentId, attachment)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ status: "idle", url: objectUrl });
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ status: "error", url: null, message: e instanceof Error ? e.message : "Error desconocido" });
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [api, projectId, commentId, attachment, retry]);

  if (compact && !attachment) return null;
  if (compact && state.status === "loading") {
    return (
      <span className="db-thumb db-thumb--loading" role="status">
        Cargando…
      </span>
    );
  }
  if (compact && state.status === "error") {
    return (
      <button type="button" className="db-thumb db-thumb--error pf-btn" title={state.message} onClick={() => setRetry((n) => n + 1)}>
        Reintentar captura
      </button>
    );
  }
  if (!attachment) return <p className="db-muted db-shot-empty">Este comentario no tiene captura.</p>;
  if (state.status === "loading") return <p className="db-muted db-shot-empty">Cargando captura…</p>;
  if (state.status === "error") {
    return (
      <div className="db-warning" role="alert">
        No se pudo cargar la captura: {state.message}{" "}
        <button type="button" className="pf-btn" onClick={() => setRetry((n) => n + 1)}>
          Reintentar
        </button>
      </div>
    );
  }
  return state.url ? <img className={compact ? "db-thumb" : "db-shot"} src={state.url} alt={alt} /> : null;
}
