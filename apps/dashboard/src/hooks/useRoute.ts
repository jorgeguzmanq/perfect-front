import { useCallback, useEffect, useState } from "react";

export interface Route {
  projectId: string | null;
  commentId: string | null;
}

/** `/projects/<id>[/comments/<id>]`. El servidor hace fallback SPA, asi que son URLs recargables. */
export function parseRoute(pathname: string): Route {
  const m = /^\/projects\/([^/]+)(?:\/comments\/([^/]+))?\/?$/.exec(pathname);
  if (!m) return { projectId: null, commentId: null };
  try {
    return { projectId: decodeURIComponent(m[1]!), commentId: m[2] ? decodeURIComponent(m[2]) : null };
  } catch {
    return { projectId: null, commentId: null };
  }
}

export function routePath(r: Route): string {
  if (!r.projectId) return "/";
  const base = `/projects/${encodeURIComponent(r.projectId)}`;
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
