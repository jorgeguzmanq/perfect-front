import type { ProcessState } from "@perfect-front/shared";

/**
 * Frontera con la gestión de procesos. La API nunca recibe comandos del cliente:
 * el controlador resuelve el plan a partir de la raíz registrada.
 */
export interface ProcessInfo {
  state: ProcessState;
  managed: boolean;
  url: string | null;
  pid: number | null;
}

export interface ProcessTarget {
  /** Raíz registrada (nunca viene de una petición de overlay). */
  root: string;
  url: string | null;
  /** Comando explícito registrado por el CLI, si existe. */
  command: string | null;
}

export type StopOutcome = { outcome: "stopped" | "external" | "none"; pid?: number | undefined };

export interface ProcessController {
  status(target: ProcessTarget): Promise<ProcessInfo>;
  start(target: ProcessTarget): Promise<ProcessInfo>;
  stop(target: ProcessTarget): Promise<StopOutcome>;
  /** Últimas líneas de salida, o null si no hay captura. */
  logs(target: ProcessTarget, lines: number): Promise<string[] | null>;
}

/** Controlador inerte: útil como valor por defecto en pruebas o cuando no se gestionan procesos. */
export class NullProcessController implements ProcessController {
  async status(target: ProcessTarget): Promise<ProcessInfo> {
    return { state: "stopped", managed: false, url: target.url, pid: null };
  }
  async start(): Promise<ProcessInfo> {
    throw new Error("process control not configured");
  }
  async stop(): Promise<StopOutcome> {
    return { outcome: "none" };
  }
  async logs(): Promise<string[] | null> {
    return null;
  }
}
