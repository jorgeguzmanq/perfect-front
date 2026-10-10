import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createAdaptorServer } from "@hono/node-server";
import { PerfectFrontError, nowTimestamp } from "@perfect-front/shared";
import { parseExtensionIds } from "./security";
import { createCore, type Core, type CoreOptions } from "./app";
import { DEFAULT_PORT, LOOPBACK_HOST, PORT_FALLBACK_SPAN, SERVER_VERSION, defaultStateDir } from "./config";
import { readDiscovery, removeDiscovery, writeDiscovery, type Discovery } from "./discovery";

export interface StartOptions extends Partial<Omit<CoreOptions, "getPort" | "stateDir">> {
  stateDir?: string;
  /** Puerto preferido (45800). 0 = efímero directo. */
  port?: number;
  /** Escribe el archivo de descubrimiento (por defecto sí). */
  writeDiscovery?: boolean;
}

export interface RunningServer {
  url: string;
  host: string;
  port: number;
  token: string;
  cliToken: string;
  stateDir: string;
  core: Core;
  close(): Promise<void>;
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (e: Error): void => reject(e);
    server.once("error", onError);
    server.listen(port, LOOPBACK_HOST, () => {
      server.off("error", onError);
      resolve((server.address() as AddressInfo).port);
    });
  });
}

/** Prueba el puerto preferido, luego los siguientes y por último uno efímero. */
async function bindWithFallback(server: Server, preferred: number): Promise<number> {
  if (preferred === 0) return listen(server, 0);
  for (let i = 0; i <= PORT_FALLBACK_SPAN; i++) {
    const p = preferred + i;
    if (p > 65535) break;
    try {
      return await listen(server, p);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== "EADDRINUSE" && code !== "EACCES") throw e;
    }
  }
  return listen(server, 0);
}

/** ¿Hay ya una instancia viva anunciada en el archivo de descubrimiento? */
async function liveInstance(d: Discovery): Promise<boolean> {
  try {
    const res = await fetch(`http://${LOOPBACK_HOST}:${d.port}/api/health`, { signal: AbortSignal.timeout(500) });
    const body = (await res.json()) as { ok?: unknown };
    return res.ok && body.ok === true;
  } catch {
    return false;
  }
}

export async function startServer(options: StartOptions = {}): Promise<RunningServer> {
  const stateDir = options.stateDir ?? defaultStateDir();
  const publish = options.writeDiscovery ?? true;

  if (publish) {
    const existing = await readDiscovery(stateDir);
    if (existing && (await liveInstance(existing))) {
      throw new PerfectFrontError("conflict", "Ya hay una instancia de Perfect Front en ejecución");
    }
  }

  let boundPort: number | null = null;
  const { stateDir: _s, port: _p, writeDiscovery: _w, ...coreOptions } = options;
  void _s;
  void _p;
  void _w;
  // IDs de desarrollo adicionales: opción explícita + PF_EXTENSION_IDS (inválidos => error al arrancar).
  const extensionIds = [...(coreOptions.extensionIds ?? []), ...parseExtensionIds(process.env.PF_EXTENSION_IDS)];
  const core = await createCore({ ...coreOptions, extensionIds, stateDir, getPort: () => boundPort });

  const server = createAdaptorServer({ fetch: core.app.fetch, hostname: LOOPBACK_HOST }) as Server;
  try {
    boundPort = await bindWithFallback(server, options.port ?? DEFAULT_PORT);
  } catch (e) {
    core.close();
    throw e;
  }
  const port = boundPort;
  const url = `http://${LOOPBACK_HOST}:${port}`;

  const discovery: Discovery = {
    version: 1,
    apiVersion: 1,
    serverVersion: SERVER_VERSION,
    pid: process.pid,
    host: LOOPBACK_HOST,
    port,
    url,
    token: core.token,
    cliToken: core.cliToken,
    startedAt: nowTimestamp(),
  };
  if (publish) {
    try {
      await writeDiscovery(stateDir, discovery);
    } catch (e) {
      core.close();
      await closeHttp(server);
      throw e;
    }
  }

  let closed: Promise<void> | null = null;
  return {
    url,
    host: LOOPBACK_HOST,
    port,
    token: core.token,
    cliToken: core.cliToken,
    stateDir,
    core,
    close: () =>
      (closed ??= (async () => {
        core.close(); // termina los streams SSE para que el cierre no se cuelgue
        await closeHttp(server);
        if (publish) await removeDiscovery(stateDir, discovery.token);
      })()),
  };
}

function closeHttp(server: Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) return resolve();
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

