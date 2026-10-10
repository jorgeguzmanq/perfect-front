import type { ProjectSummary, RunningServer } from "@perfect-front/shared";

/** Lógica pura (sin chrome.*) compartida por el service worker y el popup. */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export const isLoopbackHttp = (url: string | undefined | null): boolean => {
  try {
    const u = new URL(url ?? "");
    return u.protocol === "http:" && LOOPBACK_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
};

/** Origen exacto (protocolo + host + puerto) o null. */
export const originOf = (url: string | undefined | null): string | null => {
  if (!url) return null;
  try {
    const o = new URL(url).origin;
    return o === "null" ? null : o;
  } catch {
    return null;
  }
};

/** Origen canónico: localhost, 127.0.0.1 y [::1] son el mismo host. Distingue protocolo y puerto. */
export function originKey(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.origin === "null") return null;
    const host = LOOPBACK_HOSTS.has(u.hostname) ? "loopback" : u.hostname;
    return `${u.protocol}//${host}:${u.port || (u.protocol === "https:" ? "443" : "80")}`;
  } catch {
    return null;
  }
}

const basePath = (url: URL): string => url.pathname.replace(/\/+$/, "");

/**
 * Puntuación de pertenencia de una URL a un proyecto: -1 si el origen difiere; 0 si coincide el origen;
 * longitud+1 de la ruta del proyecto si además la URL cuelga de ella (solo sirve para desempatar).
 */
export function matchScore(projectUrl: string | null, tabUrl: string): number {
  const pk = originKey(projectUrl);
  if (!projectUrl || pk === null || pk !== originKey(tabUrl)) return -1;
  const base = basePath(new URL(projectUrl));
  const path = basePath(new URL(tabUrl));
  return path === base || path.startsWith(`${base}/`) ? base.length + 1 : 0;
}

export interface Match {
  port: number;
  project: ProjectSummary;
}

/** Proyecto al que pertenece una URL, entre todos los servidores (mismo origen; desempata el prefijo más largo). */
export function findProject(servers: RunningServer[], url: string): Match | undefined {
  let best: (Match & { score: number }) | undefined;
  for (const s of servers) {
    for (const project of s.projects) {
      const score = matchScore(project.url, url);
      if (score >= 0 && (!best || score > best.score)) best = { port: s.port, project, score };
    }
  }
  return best && { port: best.port, project: best.project };
}
