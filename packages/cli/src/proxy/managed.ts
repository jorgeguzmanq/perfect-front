import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PerfectFrontError } from "@perfect-front/shared";
import { isAlive } from "../process/identity";
import { killTree } from "../process/kill";
import { readFrom, tailLines } from "../process/log-file";
import { runDir } from "../process/state";
import { clearProxyState, liveProxyState, proxyLogPath, writeProxyState, type ProxyState } from "./state";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const ANNOUNCED = /Proxy:\s+(http:\/\/127\.0\.0\.1:(\d+))/;

export interface ManagedProxyArgs {
  root: string;
  stateDir: string;
  projectId: string;
  /** URL original (se compara con la del proxy vivo para reutilizarlo). */
  targetUrl: string;
  listenPort?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Se invoca con el PID del proxy recien lanzado (para el vigilante del dev server). */
  onSpawn?: (pid: number) => void;
}

/**
 * Proxy como hijo administrado (`start`/`--detach`): reutiliza uno vivo hacia el mismo destino
 * o lanza `proxy/bin.ts` (node + tsx) y espera su anuncio. Estado en proxy.json.
 */
export async function ensureManagedProxy(a: ManagedProxyArgs): Promise<{ action: "started" | "connected"; state: ProxyState }> {
  const live = await liveProxyState(a.root);
  if (live && live.detached && live.targetUrl === a.targetUrl) return { action: "connected", state: live };
  if (live && !live.detached) return { action: "connected", state: live }; // sesion en primer plano: ya hay capa
  if (live) {
    await killTree(live.pid);
    clearProxyState(a.root);
  }

  const entry = fileURLToPath(new URL("./bin.ts", import.meta.url));
  let loader = "tsx";
  try {
    loader = import.meta.resolve("tsx");
  } catch {
    /* se resuelve desde cwd */
  }
  const args = ["--import", loader, entry, "--state-dir", a.stateDir, "--project-id", a.projectId, "--target", a.targetUrl];
  if (a.listenPort !== undefined) args.push("--port", String(a.listenPort));
  fs.mkdirSync(runDir(a.root), { recursive: true });
  const logFile = proxyLogPath(a.root);
  const fd = fs.openSync(logFile, "w");
  let spawnError: Error | null = null;
  let exited: number | undefined;
  const child = spawn(process.execPath, args, { cwd: path.resolve(a.root), detached: true, stdio: ["ignore", fd, fd], windowsHide: true, shell: false });
  fs.closeSync(fd);
  child.on("error", (e) => (spawnError = e));
  child.on("exit", (c) => (exited = c ?? -1));
  child.unref();
  const pid = child.pid;
  const startedAt = new Date().toISOString();
  const fail = async (msg: string): Promise<never> => {
    if (pid && exited === undefined) await killTree(pid);
    clearProxyState(a.root);
    const tail = tailLines(logFile, 5);
    throw new PerfectFrontError("process_error", tail.length > 0 ? `${msg}: ${tail.join(" | ")}` : msg);
  };
  if (!pid) return fail("No se pudo iniciar el proxy");
  a.onSpawn?.(pid);

  const end = Date.now() + (a.timeoutMs ?? 20_000);
  let offset = 0;
  let seen = "";
  while (Date.now() < end) {
    if (a.signal?.aborted) await fail("Inicio del proxy cancelado");
    if (spawnError) await fail(`No se pudo iniciar el proxy: ${(spawnError as Error).message}`);
    const chunk = readFrom(logFile, offset);
    offset = chunk.offset;
    seen += chunk.text;
    const m = ANNOUNCED.exec(seen);
    if (m && isAlive(pid)) {
      const state: ProxyState = { version: 1, pid, startedAt, detached: true, baseUrl: m[1]!, port: Number(m[2]), targetUrl: a.targetUrl };
      writeProxyState(a.root, state);
      return { action: "started", state };
    }
    if (exited !== undefined) await fail(`El proxy termino antes de estar disponible (codigo ${exited})`);
    await sleep(100);
  }
  return fail("Timeout esperando al proxy");
}
