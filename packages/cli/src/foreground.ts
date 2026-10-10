import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXIT_PROCESS_DIED, type SessionInfo } from "./session-constants";
import {
  ensureServer,
  outdatedMessage,
  type EnsuredServer,
  getServerStatus,
  killOwnedServer,
  registerProject,
  setupLocal,
  unregisterProject,
  type EnsureServerOptions,
  type LocalSetup,
} from "./local-server";
import type { DiscoveryInfo } from "./discovery";
import { ensureRunning, type ProcessStatus, type StartOptions, type Target } from "./process";
import { isAlive, isSameProcess } from "./process/identity";
import { killTree } from "./process/kill";
import { clearState, readState, writeFileAtomic } from "./process/state";
import { proxyTargetOf, startProxyHost, swapOrigin, type ProxyHost } from "./proxy/host";
import { clearProxyState, readProxyState, stopProxy, writeProxyState } from "./proxy/state";

/**
 * Modo primer plano: esta sesion es duena de lo que inicia (dev server y, si lo
 * lanzo ella, el servidor local) y lo apaga al salir. Varias sesiones comparten
 * un servidor local: las que no lo lanzaron solo des-registran su proyecto, y si
 * el dueno cae, la primera que lo nota lo relanza y se vuelve duena.
 */

/** Proxy en marcha delante del destino (la capa de comentarios esta inyectada). */
export interface ProxyReady {
  /** Origen del proxy (http://127.0.0.1:<puerto>). */
  baseUrl: string;
  port: number;
  /** Pagina del proyecto bajo el proxy (la que se abre). */
  url: string;
  /** Misma pagina en el destino original. */
  targetUrl: string;
}

export interface ForegroundArgs {
  target: Target;
  stateDir: string;
  noServer: boolean;
  /** Abortar = apagar (SIGINT/SIGTERM/SIGHUP/SIGBREAK o canal de control). */
  signal: AbortSignal;
  start: StartOptions;
  server: EnsureServerOptions;
  monitorMs: number;
  /** URL a registrar en el servidor local a partir de la del proceso (HTML estatico: la de la pagina elegida). */
  mapUrl?: (url: string | null) => string | null;
  /** Proxy con la capa inyectada delante del destino (el proxy vive dentro de esta sesion). Sin esto, no hay proxy. */
  proxy?: { overlay: () => Promise<string>; listenPort?: number | undefined; log?: ((line: string) => void) | undefined };
  onReady: (info: { action: "started" | "connected"; status: ProcessStatus; local: LocalSetup | null; proxy: ProxyReady | null; proxyReason: string | null }) => void;
  notify: (msg: string) => void;
}

const sessionsDir = (stateDir: string): string => path.join(stateDir, "sessions");
const sameRoot = (a: string, b: string): boolean => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);

/** Sesiones vivas; poda las muertas sin limpiar (estado obsoleto). */
export function readSessions(stateDir: string): SessionInfo[] {
  let names: string[];
  try {
    names = fs.readdirSync(sessionsDir(stateDir));
  } catch {
    return [];
  }
  const out: SessionInfo[] = [];
  for (const n of names) {
    const file = path.join(sessionsDir(stateDir), n);
    try {
      const s = JSON.parse(fs.readFileSync(file, "utf8")) as SessionInfo;
      if (Number.isInteger(s.pid) && typeof s.root === "string" && isAlive(s.pid)) out.push(s);
      else fs.rmSync(file, { force: true });
    } catch {
      fs.rmSync(file, { force: true });
    }
  }
  return out;
}

export function spawnGuard(parentPid: number, childPid: number): void {
  const guard = fileURLToPath(new URL("../bin/guard.mjs", import.meta.url));
  try {
    const c = spawn(process.execPath, [guard, String(parentPid), String(childPid)], { detached: true, stdio: "ignore", windowsHide: true, shell: false });
    c.on("error", () => undefined);
    c.unref();
  } catch {
    /* sin vigilante: queda solo la limpieza al salir */
  }
}

export async function runForeground(a: ForegroundArgs): Promise<number> {
  const { target, stateDir } = a;
  const me = { pid: process.pid, startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString() };
  let exitCode = 0;
  let devPid: number | null = null;
  let serverPid: number | null = null;
  let projectId: string | null = null;
  let discovery: DiscoveryInfo | null = null;
  let lastServerPid: number | null = null;
  let host: ProxyHost | null = null;
  let proxyReady: ProxyReady | null = null;
  let proxyReason: string | null = null;
  let tickRun: Promise<void> = Promise.resolve();

  const mapUrl = a.mapUrl ?? ((u: string | null): string | null => u);
  const sessionFile = path.join(sessionsDir(stateDir), `${me.pid}.json`);
  const serverOpts = (): EnsureServerOptions => ({ ...a.server, ownerPid: me.pid });

  try {
    readSessions(stateDir);
    writeFileAtomic(sessionFile, JSON.stringify({ pid: me.pid, startedAt: me.startedAt, root: target.root } satisfies SessionInfo) + "\n");

    // Dev server huerfano de una sesion que murio sin limpiar: se detiene y se reinicia.
    const old = readState(target.root);
    if (old?.ownerPid && old.ownerStartedAt && !(await isSameProcess(old.ownerPid, old.ownerStartedAt))) {
      if (await isSameProcess(old.pid, old.startedAt)) await killTree(old.pid);
      clearState(target.root);
    }

    const { action, status } = await ensureRunning(target, { ...a.start, owner: me });
    if (action === "started" && status.pid) {
      devPid = status.pid;
      spawnGuard(me.pid, devPid);
    }

    let local: LocalSetup | null = null;
    if (!a.noServer) {
      local = await setupLocal(stateDir, serverOpts(), target.root, mapUrl(status.url));
      discovery = local.srv.discovery;
      projectId = local.project.id;
      lastServerPid = local.srv.status.pid;
      if (local.srv.action === "started") serverPid = local.srv.status.pid;
    }

    // Proxy con la capa: necesita el servidor local (adonde van los comentarios) y un destino HTTP.
    // Nunca en silencio: si no queda activo, `proxyReason` dice por que y que hacer.
    const publish = async (rootUrl: string | null): Promise<void> => {
      // Registro sin proxy (URL original), para que el proyecto quede consistente.
      if (local) local = { ...local, project: await registerProject(local.srv.discovery, target.root, rootUrl).catch(() => local!.project) };
    };
    const useServer = async (r: EnsuredServer): Promise<void> => {
      const project = await registerProject(r.discovery, target.root, mapUrl(status.url));
      local = { srv: r, project };
      discovery = r.discovery;
      projectId = project.id;
      lastServerPid = r.status.pid;
      if (r.action === "started") serverPid = r.status.pid;
    };
    const attachProxy = async (retried: boolean): Promise<void> => {
      if (!local || !a.proxy) return;
      const targetPage = mapUrl(status.url);
      const t = targetPage ? proxyTargetOf(targetPage) : null;
      if (local.srv.outdated) {
        proxyReason = outdatedMessage(local.srv.outdated);
        return;
      }
      if (!targetPage || !t) {
        proxyReason = "el destino no es HTTP (el proxy no soporta HTTPS) — abre el proyecto por su URL http o usa un dev server sin HTTPS";
        return;
      }
      try {
        await stopProxy(target.root); // un proxy administrado (--detach) previo cede el puerto a esta sesion
        host = await startProxyHost({
          target: t,
          projectId: local.project.id,
          discovery: local.srv.discovery,
          getOverlayScript: a.proxy.overlay,
          ...(a.proxy.listenPort !== undefined ? { listenPort: a.proxy.listenPort } : {}),
          ...(a.proxy.log ? { log: a.proxy.log } : {}),
        });
        const proxyPage = swapOrigin(targetPage, host.url);
        local = { ...local, project: await registerProject(local.srv.discovery, target.root, proxyPage, targetPage) };
        proxyReady = { baseUrl: host.url, port: host.port, url: proxyPage, targetUrl: targetPage };
        writeProxyState(target.root, { version: 1, pid: me.pid, startedAt: me.startedAt, detached: false, baseUrl: host.url, port: host.port, targetUrl: targetPage });
      } catch (e) {
        await host?.close().catch(() => undefined);
        host = null;
        proxyReady = null;
        const msg = (e as Error).message;
        if (!retried && /HTTP 4\d\d/.test(msg)) {
          // Registro con targetUrl rechazado: servidor desactualizado -> reemplazo (si es nuestro) y reintento.
          const r = await ensureServer(stateDir, { ...serverOpts(), force: true });
          await useServer(r);
          return attachProxy(true);
        }
        proxyReason = `no se pudo iniciar el proxy (${msg}) — revisa el motivo y vuelve a ejecutar perfect-front (o usa --no-proxy)`;
        await publish(targetPage);
      }
    };
    await attachProxy(false);
    a.onReady({ action, status, local, proxy: proxyReady, proxyReason });

    let stop = (): void => undefined;
    const reconcile = async (): Promise<void> => {
      if (devPid !== null && !isAlive(devPid)) {
        a.notify("El dev server termino: apagando.");
        exitCode = EXIT_PROCESS_DIED;
        stop();
        return;
      }
      if (a.noServer) return;
      const s = await getServerStatus(stateDir);
      let d = s.discovery;
      let pid = s.pid;
      if (!d) {
        const r = await ensureServer(stateDir, serverOpts());
        d = r.discovery;
        pid = r.status.pid;
        if (r.action === "started") {
          serverPid = pid;
          a.notify("Servidor local caido: reiniciado desde esta terminal (ahora es la duena).");
        } else {
          a.notify("Servidor local caido: otra terminal lo reinicio.");
        }
      }
      if (serverPid !== null && pid !== serverPid) serverPid = null;
      if (pid !== lastServerPid || d.port !== discovery?.port) {
        discovery = d;
        lastServerPid = pid;
        if (host && proxyReady) {
          await host.rebind(d);
          projectId = (await registerProject(d, target.root, proxyReady.url, proxyReady.targetUrl)).id;
        } else {
          projectId = (await registerProject(d, target.root, mapUrl(status.url))).id;
        }
        a.notify("Proyecto registrado de nuevo en el servidor local.");
      }
    };

    await new Promise<void>((resolve) => {
      if (a.signal.aborted) {
        stop = (): void => resolve();
        resolve();
        return;
      }
      let busy = false;
      const timer = setInterval(() => {
        if (busy) return;
        busy = true;
        tickRun = reconcile()
          .catch(() => undefined) // se reintenta en el siguiente ciclo
          .finally(() => void (busy = false));
      }, a.monitorMs);
      stop = (): void => {
        clearInterval(timer);
        resolve();
      };
      a.signal.addEventListener("abort", stop, { once: true });
    });
    return exitCode;
  } finally {
    await tickRun;
    fs.rmSync(sessionFile, { force: true });
    const others = readSessions(stateDir).filter((s) => s.pid !== me.pid && sameRoot(s.root, target.root));
    const unregister = async (): Promise<void> => {
      if (projectId && discovery && others.length === 0) await unregisterProject(discovery, projectId).catch(() => undefined);
    };
    const killDev = async (): Promise<void> => {
      if (devPid === null) return;
      await killTree(devPid);
      if (readState(target.root)?.pid === devPid) clearState(target.root);
    };
    const closeProxy = async (): Promise<void> => {
      await host?.close().catch(() => undefined);
      if (readProxyState(target.root)?.pid === me.pid) clearProxyState(target.root);
    };
    await Promise.all([unregister(), killDev(), closeProxy()]);
    if (serverPid !== null) await killOwnedServer(stateDir, serverPid).catch(() => undefined);
  }
}
