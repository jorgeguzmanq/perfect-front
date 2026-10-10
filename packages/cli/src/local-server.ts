import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PerfectFrontError } from "@perfect-front/shared";
import { isAlive, isSameProcess } from "./process/identity";
import { killTree } from "./process/kill";
import { tailLines } from "./process/log-file";
import { writeFileAtomic } from "./process/state";
import { ServerNotRunningError, readDiscovery, type DiscoveryInfo } from "./discovery";

/**
 * Servidor local de Perfect Front como proceso hijo administrado.
 *
 * Decision: el CLI NO importa `@perfect-front/local-server` (este depende del CLI;
 * un import estatico seria un ciclo). Lanza su entry ejecutable (`src/bin.ts`) como
 * proceso persistente aparte: aisla el servidor del ciclo de vida del CLI (sobrevive
 * al comando), reutiliza la verificacion PID + hora de inicio del dev server y no
 * carga el servidor HTTP en cada invocacion de `comment`.
 *
 * Estado propio (junto a discovery.json, en el stateDir): `server.json` (pid y hora
 * de inicio del proceso que lanzo Perfect Front) y `server.log` (acotado).
 */

export interface ServerStatus {
  state: "running" | "stopped";
  /** true solo si lo lanzo Perfect Front y el PID sigue siendo el mismo proceso. */
  managed: boolean;
  url: string | null;
  pid: number | null;
}

export type ServerStopResult = { outcome: "stopped"; pid: number } | { outcome: "external"; url: string } | { outcome: "none" };

interface ServerState {
  version: 1;
  pid: number;
  startedAt: string;
}

type Discovered = DiscoveryInfo & { pid: number | null };

export const serverStatePath = (stateDir: string): string => path.join(stateDir, "server.json");
export const serverLogPath = (stateDir: string): string => path.join(stateDir, "server.log");

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function readServerState(stateDir: string): ServerState | null {
  try {
    const s = JSON.parse(fs.readFileSync(serverStatePath(stateDir), "utf8")) as Partial<ServerState> | null;
    if (s && s.version === 1 && Number.isInteger(s.pid) && (s.pid as number) > 0 && typeof s.startedAt === "string") return s as ServerState;
  } catch {
    /* ausente o corrupto */
  }
  return null;
}

/** Capacidades que el CLI exige a un servidor local para reutilizarlo (ver SERVER_FEATURES en local-server). */
export const REQUIRED_SERVER_FEATURES: readonly string[] = ["proxy-v1"];

/** Salud del servidor: null si no responde; `features` null si es de una version anterior al campo. */
async function readHealth(d: DiscoveryInfo, timeoutMs = 800): Promise<{ features: string[] | null } | null> {
  try {
    const res = await fetch(`http://${d.host}:${d.port}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
    const body = (await res.json()) as { ok?: unknown; features?: unknown };
    if (!(res.ok && body.ok === true)) return null;
    return { features: Array.isArray(body.features) ? body.features.filter((f): f is string => typeof f === "string") : null };
  } catch {
    return null;
  }
}

const healthy = async (d: DiscoveryInfo, timeoutMs = 800): Promise<boolean> => (await readHealth(d, timeoutMs)) !== null;

export const missingFeatures = (features: string[] | null): string[] => REQUIRED_SERVER_FEATURES.filter((f) => !(features ?? []).includes(f));

/** Servidor local vivo pero anterior al contrato que el CLI necesita. */
export interface OutdatedServer {
  missing: string[];
  /** Lo lanzo Perfect Front (se puede reemplazar con seguridad). */
  managed: boolean;
  port: number;
}

export const outdatedMessage = (o: OutdatedServer): string =>
  `el servidor local en :${o.port} es una versión antigua y no lo inició Perfect Front — ciérralo y vuelve a ejecutar perfect-front`;

function discoveryOrNull(stateDir: string): Discovered | null {
  try {
    const d = readDiscovery(stateDir);
    // pid no forma parte de DiscoveryInfo; se relee del JSON para compararlo con el hijo lanzado.
    const raw = JSON.parse(fs.readFileSync(path.join(stateDir, "discovery.json"), "utf8")) as { pid?: unknown };
    return { ...d, pid: typeof raw.pid === "number" ? raw.pid : null };
  } catch (e) {
    if (e instanceof ServerNotRunningError) return null;
    throw e;
  }
}

const urlOf = (d: DiscoveryInfo): string => `http://${d.host}:${d.port}`;

export async function getServerStatus(stateDir: string): Promise<ServerStatus & { discovery: DiscoveryInfo | null; features: string[] | null }> {
  const d = discoveryOrNull(stateDir);
  const h = d ? await readHealth(d) : null;
  if (!d || !h) return { state: "stopped", managed: false, url: null, pid: null, discovery: null, features: null };
  const st = readServerState(stateDir);
  const managed = st !== null && d.pid === st.pid && (await isSameProcess(st.pid, st.startedAt));
  return { state: "running", managed, url: urlOf(d), pid: d.pid, discovery: d, features: h.features };
}

export interface ServerLaunch {
  file: string;
  args: string[];
  cwd: string;
}

/** Desde el repo no hay build: node + loader tsx sobre `local-server/src/bin.ts` (paquete hermano). */
export function defaultServerLaunch(): ServerLaunch {
  const entry = fileURLToPath(new URL("../../local-server/src/bin.ts", import.meta.url));
  const repoRoot = path.resolve(path.dirname(entry), "..", "..", "..");
  let loader = "tsx";
  try {
    loader = import.meta.resolve("tsx");
  } catch {
    /* se resuelve desde cwd = raiz del repo */
  }
  return { file: process.execPath, args: ["--import", loader, entry], cwd: repoRoot };
}

export interface EnsureServerOptions {
  /** 0 = efimero; por defecto el preferido del servidor (45800). */
  port?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  launch?: ServerLaunch;
  /** Si se indica, el servidor se cierra solo cuando ese PID desaparece (sesion en primer plano). */
  ownerPid?: number;
}

export class ServerStartError extends PerfectFrontError {
  readonly logs: string[];
  constructor(message: string, logs: string[]) {
    super("process_error", message);
    this.name = "ServerStartError";
    this.logs = logs;
  }
}

const strip = (s: ServerStatus & { discovery: DiscoveryInfo | null }): ServerStatus => ({ state: s.state, managed: s.managed, url: s.url, pid: s.pid });

export interface EnsuredServer {
  action: "started" | "connected";
  status: ServerStatus;
  discovery: DiscoveryInfo;
  /** El servidor que habia era antiguo y esta sesion lo reemplazo por uno nuevo (action = started). */
  replaced?: boolean;
  /** Servidor antiguo que NO se pudo reemplazar (no lo inicio Perfect Front): se reutiliza degradado, sin proxy. */
  outdated?: OutdatedServer;
}

/**
 * Reutiliza un servidor vivo (discovery valido + /api/health con las features requeridas) o lo arranca
 * en segundo plano. Un servidor antiguo administrado por Perfect Front se apaga y se reemplaza (las demas
 * sesiones vivas lo detectan y re-registran su proyecto); uno ajeno nunca se toca (`outdated`).
 * `force`: reemplaza un servidor administrado aunque anuncie las features (registro rechazado).
 */
export async function ensureServer(stateDir: string, options: EnsureServerOptions & { force?: boolean } = {}): Promise<EnsuredServer> {
  const verdict = (s: Awaited<ReturnType<typeof getServerStatus>>): { replace: boolean; outdated?: OutdatedServer } => {
    const missing = missingFeatures(s.features);
    if (missing.length === 0 && !options.force) return { replace: false };
    const outdated: OutdatedServer = { missing: missing.length > 0 ? missing : ["register"], managed: s.managed, port: s.discovery!.port };
    return s.managed ? { replace: true, outdated } : { replace: false, outdated };
  };
  const current = await getServerStatus(stateDir);
  if (current.discovery) {
    const v = verdict(current);
    if (!v.replace) return { action: "connected", status: strip(current), discovery: current.discovery, ...(v.outdated ? { outdated: v.outdated } : {}) };
  }

  // Un solo arranque a la vez entre sesiones (si no, dos hijos podrian anunciarse en puertos distintos).
  const timeoutMs = options.timeoutMs ?? 30_000;
  fs.mkdirSync(stateDir, { recursive: true });
  await acquireLock(stateDir, timeoutMs, options.signal);
  try {
    const again = await getServerStatus(stateDir);
    let replaced = false;
    if (again.discovery) {
      const v = verdict(again);
      if (!v.replace) return { action: "connected", status: strip(again), discovery: again.discovery, ...(v.outdated ? { outdated: v.outdated } : {}) };
      // Apagado limpio del antiguo (PID + hora de inicio verificados) y arranque del nuevo.
      await stopServer(stateDir);
      replaced = true;
    }
    const r = await spawnServer(stateDir, options);
    return replaced ? { ...r, replaced } : r;
  } finally {
    fs.rmSync(lockPath(stateDir), { force: true });
  }
}

const lockPath = (stateDir: string): string => path.join(stateDir, "server.lock");

async function acquireLock(stateDir: string, timeoutMs: number, signal?: AbortSignal): Promise<void> {
  const file = lockPath(stateDir);
  const end = Date.now() + timeoutMs;
  for (;;) {
    try {
      fs.writeFileSync(file, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: "wx" });
      return;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    try {
      const l = JSON.parse(fs.readFileSync(file, "utf8")) as { pid?: number; at?: number };
      const stale = !Number.isInteger(l.pid) || !isAlive(l.pid as number) || Date.now() - (l.at ?? 0) > 60_000;
      if (stale) fs.rmSync(file, { force: true });
    } catch {
      /* se esta escribiendo o desaparecio: reintenta */
    }
    if (signal?.aborted || Date.now() > end) throw new PerfectFrontError("process_error", "Timeout esperando el bloqueo de arranque del servidor local");
    await sleep(100);
  }
}

async function spawnServer(stateDir: string, options: EnsureServerOptions): Promise<EnsuredServer> {
  const launch = options.launch ?? defaultServerLaunch();
  const timeoutMs = options.timeoutMs ?? 30_000;
  const logFile = serverLogPath(stateDir);
  const fd = fs.openSync(logFile, "w"); // trunca; ademas el servidor limita su propia salida
  const args = [...launch.args, "--state-dir", stateDir, ...(options.port !== undefined ? ["--port", String(options.port)] : []), ...(options.ownerPid !== undefined ? ["--owner-pid", String(options.ownerPid)] : [])];

  let spawnError: Error | null = null;
  let exited: number | undefined;
  const child = spawn(launch.file, args, {
    cwd: launch.cwd,
    detached: true,
    stdio: ["ignore", fd, fd],
    windowsHide: true,
    shell: false,
  });
  fs.closeSync(fd);
  child.on("error", (e) => (spawnError = e));
  child.on("exit", (code) => (exited = code ?? -1));
  child.unref();

  const pid = child.pid;
  const fail = async (message: string): Promise<never> => {
    if (pid && exited === undefined) await killTree(pid);
    fs.rmSync(serverStatePath(stateDir), { force: true });
    throw new ServerStartError(message, tailLines(logFile, 20));
  };
  if (!pid) return fail(`No se pudo iniciar el servidor local${spawnError ? `: ${(spawnError as Error).message}` : ""}`);

  const startedAt = new Date().toISOString();
  writeFileAtomic(serverStatePath(stateDir), JSON.stringify({ version: 1, pid, startedAt } satisfies ServerState, null, 2) + "\n");

  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (options.signal?.aborted) await fail("Inicio cancelado");
    if (spawnError) await fail(`No se pudo iniciar el servidor local: ${(spawnError as Error).message}`);
    const d = discoveryOrNull(stateDir);
    if (d && d.pid === pid && (await healthy(d))) {
      return { action: "started", status: { state: "running", managed: true, url: urlOf(d), pid }, discovery: d };
    }
    if (exited !== undefined) {
      // Otra instancia pudo ganar la carrera: si responde, se conecta a esa.
      const other = await getServerStatus(stateDir);
      if (other.discovery) {
        fs.rmSync(serverStatePath(stateDir), { force: true });
        return { action: "connected", status: strip(other), discovery: other.discovery };
      }
      await fail(`El servidor local termino antes de estar disponible (codigo ${exited})`);
    }
    await sleep(150);
  }
  return fail("Timeout esperando al servidor local");
}

/** Detiene solo el servidor lanzado por Perfect Front (PID verificado contra su hora de inicio). */
export async function stopServer(stateDir: string, expectPid?: number): Promise<ServerStopResult> {
  const st = readServerState(stateDir);
  // expectPid: una sesion solo cierra el servidor que ella lanzo (no uno tomado despues por otra).
  if (st && (expectPid === undefined || st.pid === expectPid) && (await isSameProcess(st.pid, st.startedAt))) {
    await killTree(st.pid);
    fs.rmSync(serverStatePath(stateDir), { force: true });
    // taskkill /F (Windows) no ejecuta el cierre limpio: se borra discovery.json solo si era de ese PID.
    const d = discoveryOrNull(stateDir);
    if (d && d.pid === st.pid) fs.rmSync(path.join(stateDir, "discovery.json"), { force: true });
    return { outcome: "stopped", pid: st.pid };
  }
  if (st) fs.rmSync(serverStatePath(stateDir), { force: true });
  const cur = await getServerStatus(stateDir);
  if (cur.discovery && cur.url) return { outcome: "external", url: cur.url };
  return { outcome: "none" };
}

async function api<T>(d: DiscoveryInfo, method: string, route: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${urlOf(d)}${route}`, {
      method,
      headers: { authorization: `Bearer ${d.cliToken}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new ServerNotRunningError("El servidor local no responde");
  }
  if (!res.ok) throw new PerfectFrontError("process_error", `El servidor local rechazo ${method} ${route} (HTTP ${res.status})`);
  return (await res.json().catch(() => null)) as T;
}

export interface RegisteredProject {
  id: string;
  name: string;
  /** URL que se abre (con proxy: la del proxy). */
  url: string | null;
  /** URL original detras del proxy, si lo hay. */
  targetUrl?: string | null;
}

/** POST /api/projects/register con el token de CLI (sin Origin). */
export async function registerProject(d: DiscoveryInfo, root: string, url: string | null, targetUrl?: string | null): Promise<RegisteredProject> {
  const r = await api<{ project?: Partial<RegisteredProject> } | null>(d, "POST", "/api/projects/register", {
    root,
    ...(url ? { url } : {}),
    ...(url && targetUrl ? { targetUrl } : {}),
  });
  const p = r?.project;
  if (!p || typeof p.id !== "string" || typeof p.name !== "string") throw new PerfectFrontError("process_error", "Respuesta inesperada del servidor local");
  return { id: p.id, name: p.name, url: typeof p.url === "string" ? p.url : null, targetUrl: typeof p.targetUrl === "string" ? p.targetUrl : null };
}

/** DELETE /api/projects/:id (token de CLI). Tolera que el proyecto ya no este. */
export async function unregisterProject(d: DiscoveryInfo, id: string): Promise<void> {
  try {
    await api<unknown>(d, "DELETE", `/api/projects/${encodeURIComponent(id)}`);
  } catch (e) {
    if (e instanceof PerfectFrontError && /HTTP 404/.test(e.message)) return;
    throw e;
  }
}

export function readServerLogs(stateDir: string, lines: number): string[] | null {
  const f = serverLogPath(stateDir);
  return fs.existsSync(f) ? tailLines(f, lines) : null;
}

export interface LocalSetup {
  srv: EnsuredServer;
  project: RegisteredProject;
}

/** Asegura el servidor local y registra el proyecto. */
export async function setupLocal(stateDir: string, opts: EnsureServerOptions, root: string, url: string | null): Promise<LocalSetup> {
  const srv = await ensureServer(stateDir, opts);
  const project = await registerProject(srv.discovery, root, url);
  return { srv, project };
}

/** Cierre rapido del servidor que esta sesion lanzo (PID conocido: sin verificar identidad, que en Windows tarda). */
export async function killOwnedServer(stateDir: string, pid: number): Promise<void> {
  await killTree(pid);
  if (readServerState(stateDir)?.pid === pid) fs.rmSync(serverStatePath(stateDir), { force: true });
  const d = discoveryOrNull(stateDir);
  if (d && d.pid === pid) fs.rmSync(path.join(stateDir, "discovery.json"), { force: true });
}
