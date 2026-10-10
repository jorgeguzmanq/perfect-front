import { spawn } from "node:child_process";
import fs from "node:fs";
import { PerfectFrontError } from "@perfect-front/shared";
import { waitForHttp, probeHttp } from "./http";
import { isSameProcess } from "./identity";
import { killTree } from "./kill";
import { readFrom, tailLines } from "./log-file";
import { resolveSpawn } from "./resolve-command";
import { clearState, logPath, readState, runDir, writeState, type ManagedState } from "./state";
import { detectAnnouncedUrl, portOf } from "./url";

export interface Plan {
  command: string;
  args: string[];
  cwd: string;
}

export interface Target {
  /** Raiz del proyecto (donde vive `.perfect-front/`). */
  root: string;
  plan: Plan;
  /** URL esperada segun deteccion/override; null si se desconoce. */
  url: string | null;
}

export type ProcessState = "running" | "external" | "stopped";

export interface ProcessStatus {
  state: ProcessState;
  /** true solo si el proceso fue iniciado por Perfect Front y sigue siendo el mismo. */
  managed: boolean;
  url: string | null;
  port: number | null;
  pid: number | null;
  startedAt: string | null;
  /** El servidor responde HTTP ahora mismo. */
  ready: boolean;
}

export type StopResult =
  | { outcome: "stopped"; pid: number }
  | { outcome: "external"; url: string | null }
  | { outcome: "none" };

/** Error de arranque con las ultimas lineas de salida del proceso. */
export class StartError extends PerfectFrontError {
  readonly logs: string[];
  constructor(message: string, logs: string[]) {
    super("process_error", message);
    this.name = "StartError";
    this.logs = logs;
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function getStatus(target: Pick<Target, "root" | "url">): Promise<ProcessStatus> {
  const st = readState(target.root);
  if (st) {
    if (await isSameProcess(st.pid, st.startedAt)) {
      const ready = st.url ? await probeHttp(st.url) : false;
      return { state: "running", managed: true, url: st.url, port: st.port, pid: st.pid, startedAt: st.startedAt, ready };
    }
    clearState(target.root); // metadata propia obsoleta: el proceso ya no existe o el PID fue reciclado
  }
  if (target.url && (await probeHttp(target.url))) {
    return { state: "external", managed: false, url: target.url, port: portOf(target.url), pid: null, startedAt: null, ready: true };
  }
  return { state: "stopped", managed: false, url: null, port: null, pid: null, startedAt: null, ready: false };
}

/** Espera maxima por defecto del primer arranque (Next/Angular pueden tardar mas de 30 s). */
export const DEFAULT_START_TIMEOUT_MS = 120_000;
const PROGRESS_EVERY_MS = 10_000;

export interface StartOptions {
  /** Sesion que lo posee; se guarda en process.json. */
  owner?: { pid: number; startedAt: string };
  /** Espera maxima hasta que el servidor responda HTTP (por defecto 120 s). */
  startTimeoutMs?: number;
  signal?: AbortSignal;
  /** Mensajes de progreso del arranque (inicio, URL anunciada, espera larga). */
  onProgress?: (message: string) => void;
}

/** Lanza el plan; nunca si ya hay un administrado vivo o algo respondiendo en la URL esperada. */
export async function ensureRunning(
  target: Target,
  options: StartOptions = {},
): Promise<{ action: "started" | "connected"; status: ProcessStatus }> {
  const current = await getStatus(target);
  if (current.state !== "stopped") return { action: "connected", status: current };
  if (!target.plan.command) {
    // --url: el servidor ya deberia estar corriendo; Perfect Front no inicia nada.
    throw new StartError(
      `No hay ningun servidor respondiendo en ${target.url ?? "la URL indicada"}. --url no inicia procesos: arranca tu servidor y reintenta, o usa --command "..." para que Perfect Front lo inicie`,
      [],
    );
  }
  const status = await startProcess(target, options);
  return { action: "started", status };
}

async function startProcess(target: Target, options: StartOptions): Promise<ProcessStatus> {
  const timeoutMs = options.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS;
  const progress = (m: string): void => {
    try {
      options.onProgress?.(m);
    } catch {
      /* el progreso nunca rompe el arranque */
    }
  };
  const spec = resolveSpawn(target.plan.command, target.plan.args);
  fs.mkdirSync(runDir(target.root), { recursive: true });
  const logFile = logPath(target.root);
  const fd = fs.openSync(logFile, "w"); // trunca: la captura queda acotada a esta ejecucion

  let spawnError: Error | null = null;
  let exited: number | null | undefined;
  const child = spawn(spec.file, spec.args, {
    cwd: target.plan.cwd,
    detached: true,
    stdio: ["ignore", fd, fd],
    windowsHide: true,
    windowsVerbatimArguments: spec.windowsVerbatimArguments,
    shell: false,
  });
  fs.closeSync(fd);
  child.on("error", (e) => (spawnError = e));
  child.on("exit", (code) => (exited = code ?? -1));
  child.unref();

  const pid = child.pid;
  const fail = async (message: string): Promise<never> => {
    if (pid && exited === undefined) await killTree(pid);
    clearState(target.root);
    throw new StartError(message, tailLines(logFile, 20));
  };

  if (!pid) return fail(`No se pudo iniciar el proceso${spawnError ? `: ${(spawnError as Error).message}` : ""}`);

  const state: ManagedState = {
    version: 1,
    pid,
    startedAt: new Date().toISOString(),
    command: target.plan.command,
    args: target.plan.args,
    cwd: target.plan.cwd,
    url: null,
    port: null,
    logFile,
    ...(options.owner ? { ownerPid: options.owner.pid, ownerStartedAt: options.owner.startedAt } : {}),
  };
  writeState(target.root, state);

  const t0 = Date.now();
  const end = t0 + timeoutMs;
  progress(
    `Iniciando el dev server (${[target.plan.command, ...target.plan.args].join(" ").slice(0, 120)}); espero hasta ${Math.round(timeoutMs / 1000)} s a que responda (el primer arranque de Next/Angular puede tardar)`,
  );
  let lastProgress = t0;
  let offset = 0;
  let seen = "";
  let announced: string | null = null;
  let lastProbe = 0;

  while (Date.now() < end) {
    if (options.signal?.aborted) {
      await fail("Inicio cancelado");
    }
    if (spawnError) await fail(`No se pudo iniciar el proceso: ${(spawnError as Error).message}`);
    const chunk = readFrom(logFile, offset);
    offset = chunk.offset;
    seen = (seen + chunk.text).slice(-16 * 1024);
    const wasAnnounced = announced !== null;
    announced = announced ?? detectAnnouncedUrl(seen);
    if (announced && !wasAnnounced) progress(`El dev server anuncia ${announced}; espero a que responda HTTP...`);
    if (Date.now() - lastProgress >= PROGRESS_EVERY_MS) {
      lastProgress = Date.now();
      const secs = Math.round((Date.now() - t0) / 1000);
      progress(
        announced
          ? `Sigue arrancando: ${announced} aun no responde (${secs} s de ${Math.round(timeoutMs / 1000)} s; la primera compilacion de Next/Angular puede tardar)`
          : target.url
            ? `Sigue arrancando: sin URL anunciada; espero respuesta en ${target.url} (${secs} s de ${Math.round(timeoutMs / 1000)} s)`
            : `Sigue arrancando: el dev server aun no anuncia ninguna URL (${secs} s de ${Math.round(timeoutMs / 1000)} s)`,
      );
    }

    if (exited !== undefined) {
      await fail(`El proceso termino antes de estar disponible (codigo ${exited})`);
    }
    // Servidores que no anuncian URL: se acepta la esperada si responde y el proceso sigue vivo.
    const candidate = announced ?? (target.url && Date.now() - lastProbe > 500 ? target.url : null);
    if (candidate) {
      lastProbe = Date.now();
      // Con URL anunciada la primera peticion puede compilar la pagina (varios segundos): sondeo paciente.
      if (await probeHttp(candidate, announced ? Math.min(15_000, Math.max(1000, end - Date.now())) : 1000)) {
        const url = candidate;
        const ready: ManagedState = { ...state, url, port: portOf(url) };
        writeState(target.root, ready);
        return { state: "running", managed: true, url, port: ready.port, pid, startedAt: state.startedAt, ready: true };
      }
    }
    await sleep(150);
  }
  if (announced) {
    const stillOk = await waitForHttp(announced, 1000);
    if (stillOk) {
      writeState(target.root, { ...state, url: announced, port: portOf(announced) });
      return { state: "running", managed: true, url: announced, port: portOf(announced), pid, startedAt: state.startedAt, ready: true };
    }
  }
  const hint = " (ajusta la espera con --start-timeout <segundos>)";
  return fail(announced ? `Timeout esperando respuesta HTTP en ${announced}${hint}` : `Timeout: el proceso no anuncio ninguna URL${hint}`);
}

/** Detiene solo lo iniciado por Perfect Front (PID verificado contra su hora de inicio). */
export async function stopManaged(target: Pick<Target, "root" | "url">): Promise<StopResult> {
  const st = readState(target.root);
  if (st && (await isSameProcess(st.pid, st.startedAt))) {
    await killTree(st.pid);
    clearState(target.root);
    return { outcome: "stopped", pid: st.pid };
  }
  if (st) clearState(target.root);
  if (target.url && (await probeHttp(target.url))) return { outcome: "external", url: target.url };
  return { outcome: "none" };
}

export function readLogs(root: string, lines: number): string[] | null {
  const st = readState(root);
  const file = st?.logFile ?? logPath(root);
  if (!fs.existsSync(file)) return null;
  return tailLines(file, lines);
}
