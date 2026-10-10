import fs from "node:fs";
import path from "node:path";
import { isSameProcess } from "../process/identity";
import { killTree } from "../process/kill";
import { runDir, writeFileAtomic } from "../process/state";

/**
 * Metadata del proxy de un proyecto: `<root>/.perfect-front/run/proxy.json`.
 * `detached: false` = vive dentro de la sesion en primer plano (pid = el de la sesion,
 * que lo cierra al salir); `true` = hijo administrado lanzado por `start`/`--detach`.
 * Nunca guarda tokens.
 */
export interface ProxyState {
  version: 1;
  pid: number;
  startedAt: string;
  detached: boolean;
  /** Origen del proxy, p. ej. http://127.0.0.1:7788/ */
  baseUrl: string;
  port: number;
  /** URL original (dev server / servidor estatico) detras del proxy. */
  targetUrl: string;
}

export const proxyStatePath = (root: string): string => path.join(runDir(root), "proxy.json");
export const proxyLogPath = (root: string): string => path.join(runDir(root), "proxy.log");

export function writeProxyState(root: string, s: ProxyState): void {
  writeFileAtomic(proxyStatePath(root), JSON.stringify(s, null, 2) + "\n");
}

export function clearProxyState(root: string): void {
  fs.rmSync(proxyStatePath(root), { force: true });
}

export function readProxyState(root: string): ProxyState | null {
  try {
    const s = JSON.parse(fs.readFileSync(proxyStatePath(root), "utf8")) as Partial<ProxyState> | null;
    if (
      s &&
      s.version === 1 &&
      Number.isInteger(s.pid) &&
      (s.pid as number) > 0 &&
      typeof s.startedAt === "string" &&
      typeof s.detached === "boolean" &&
      typeof s.baseUrl === "string" &&
      typeof s.port === "number" &&
      typeof s.targetUrl === "string"
    ) {
      return s as ProxyState;
    }
  } catch {
    /* ausente o corrupto */
  }
  return null;
}

/** Estado del proxy solo si su proceso sigue siendo el mismo (PID + hora de inicio); si no, lo borra. */
export async function liveProxyState(root: string): Promise<ProxyState | null> {
  const s = readProxyState(root);
  if (!s) return null;
  if (await isSameProcess(s.pid, s.startedAt)) return s;
  clearProxyState(root);
  return null;
}

export type StopProxyResult = { outcome: "stopped"; pid: number } | { outcome: "foreground" } | { outcome: "none" };

/** Detiene el proxy administrado (hijo). El de una sesion en primer plano lo cierra su sesion: no se toca. */
export async function stopProxy(root: string): Promise<StopProxyResult> {
  const s = await liveProxyState(root);
  if (!s) return { outcome: "none" };
  if (!s.detached) return { outcome: "foreground" };
  await killTree(s.pid);
  clearProxyState(root);
  return { outcome: "stopped", pid: s.pid };
}
