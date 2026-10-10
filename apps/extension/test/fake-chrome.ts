import { vi } from "vitest";

export const EXT_ID = "abcdefghijklmnopabcdefghijklmnop";

class Area {
  constructor(public data: Record<string, unknown> = {}) {}
  async get(keys?: string | string[]): Promise<Record<string, unknown>> {
    const list = keys === undefined ? Object.keys(this.data) : Array.isArray(keys) ? keys : [keys];
    const out: Record<string, unknown> = {};
    for (const k of list) if (k in this.data) out[k] = structuredClone(this.data[k]);
    return out;
  }
  async set(items: Record<string, unknown>): Promise<void> {
    for (const [k, v] of Object.entries(items)) this.data[k] = structuredClone(v);
  }
  async remove(keys: string | string[]): Promise<void> {
    for (const k of Array.isArray(keys) ? keys : [keys]) delete this.data[k];
  }
}

export interface FakeTab {
  id: number;
  url: string;
  windowId: number;
}

/** Fake mínimo de chrome.* hecho a mano. `storage.local` sobrevive a "reinicios" del worker si se reutiliza. */
export function installChrome(opts: { tabs?: FakeTab[]; local?: Area; hostAccess?: boolean } = {}) {
  const tabs = new Map((opts.tabs ?? []).map((t) => [t.id, t]));
  const local = opts.local ?? new Area();
  let nextId = 100;
  const chromeFake = {
    runtime: { id: EXT_ID, sendMessage: vi.fn() },
    storage: { local },
    tabs: {
      get: vi.fn(async (id: number) => {
        const t = tabs.get(id);
        if (!t) throw new Error("No tab");
        return t;
      }),
      query: vi.fn(async () => [...tabs.values()]),
      update: vi.fn(async (id: number) => tabs.get(id)),
      create: vi.fn(async ({ url }: { url: string }) => {
        const t = { id: nextId++, url, windowId: 1 };
        tabs.set(t.id, t);
        return t;
      }),
    },
    windows: { update: vi.fn(async () => undefined) },
    scripting: { executeScript: vi.fn(async () => []) },
  };
  vi.stubGlobal("chrome", chromeFake);
  return { chrome: chromeFake, tabs, local };
}

export interface FakeProject {
  id: string;
  name: string;
  url: string | null;
  pendingCount?: number;
}

/** Servidores falsos por fetch, uno por puerto (127.0.0.1). Puertos sin entrada: conexión rechazada. */
export function installServers(servers: Record<number, FakeProject[]>) {
  const calls: { url: string; method: string }[] = [];
  const fn = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    const json = (status: number, v: unknown) => new Response(JSON.stringify(v), { status });
    const m = /^http:\/\/127\.0\.0\.1:(\d+)(\/.*)$/.exec(url);
    const projects = m ? servers[Number(m[1])] : undefined;
    if (!m || !projects) throw new TypeError("fetch failed");
    const path = m[2]!;
    if (path === "/api/health") return json(200, { ok: true, version: "0.0.0", apiVersion: 1 });
    if (path === "/api/projects") {
      return json(200, {
        ok: true,
        projects: projects.map((p) => ({ framework: null, processState: "running", managed: true, pendingCount: 0, ...p })),
      });
    }
    return json(404, { ok: false, error: { code: "not_found", message: "no" } });
  });
  vi.stubGlobal("fetch", fn);
  return { calls, fetch: fn };
}
