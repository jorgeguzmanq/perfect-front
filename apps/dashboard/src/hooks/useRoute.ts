import { useCallback, useEffect, useState } from "react";

export interface Route {
  projectId: string | null;
  commentId: string | null;
  /** Vista de auditoria del proyecto (`/projects/<id>/audit`). Solo existe cuando es true. */
  audit?: true;
}

/** `/projects/<id>[/comments/<id> | /audit]`. El servidor hace fallback SPA, asi que son URLs recargables. */
export function parseRoute(pathname: string): Route {
  const m = /^\/projects\/([^/]+)(?:\/comments\/([^/]+)|\/(audit))?\/?$/.exec(pathname);
  if (!m) return { projectId: null, commentId: null };
  try {
    return { projectId: decodeURIComponent(m[1]!), commentId: m[2] ? decodeURIComponent(m[2]) : null, ...(m[3] ? { audit: true as const } : {}) };
  } catch {
    return { projectId: null, commentId: null };
  }
}

export function routePath(r: Route): string {
  if (!r.projectId) return "/";
  const base = `/projects/${encodeURIComponent(r.projectId)}`;
  if (r.audit) return `${base}/audit`;
  return r.commentId ? `${base}/comments/${encodeURIComponent(r.commentId)}` : base;
}

export function useRoute(): [Route, (r: Route, replace?: boolean) => void] {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));
  useEffect(() => {
    const onPop = (): void => setRoute(parseRoute(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const navigate = useCallback((r: Route, replace = false): void => {
    const path = routePath(r);
    if (path !== window.location.pathname) {
      if (replace) window.history.replaceState(null, "", path);
      else window.history.pushState(null, "", path);
    }
    setRoute(r);
  }, []);
  return [route, navigate];
}
