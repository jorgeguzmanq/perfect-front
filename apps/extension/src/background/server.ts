import {
  HealthResponseSchema,
  ListProjectsResponseSchema,
  SERVER_PORT_RANGE,
  type RunningServer,
} from "@perfect-front/shared";

const PROBE_TIMEOUT_MS = 600;
const CACHE_MS = 2000;

const baseFor = (port: number): string => `http://127.0.0.1:${port}`;

async function timedFetch(url: string, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/** Sondea un puerto: health y luego proyectos. Sin credenciales: el servidor reconoce el Origin de la extensión. */
async function probe(port: number): Promise<RunningServer | null> {
  try {
    const health = await timedFetch(`${baseFor(port)}/api/health`, PROBE_TIMEOUT_MS);
    if (!health.ok || !HealthResponseSchema.safeParse(await health.json()).success) return null;
    const res = await timedFetch(`${baseFor(port)}/api/projects`, PROBE_TIMEOUT_MS * 3);
    if (!res.ok) return null;
    const parsed = ListProjectsResponseSchema.safeParse(await res.json());
    return parsed.success ? { port, projects: parsed.data.projects } : null;
  } catch {
    return null;
  }
}

let cache: { at: number; pending: Promise<RunningServer[]> } | undefined;

/** Descubre en paralelo todos los servidores del rango. Cachea ~2 s para no martillar. */
export function discoverServers(): Promise<RunningServer[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.pending;
  const ports: number[] = [];
  for (let p = SERVER_PORT_RANGE.first; p <= SERVER_PORT_RANGE.last; p++) ports.push(p);
  const pending = Promise.all(ports.map(probe)).then((r) => r.filter((s): s is RunningServer => s !== null));
  cache = { at: Date.now(), pending };
  return pending;
}
