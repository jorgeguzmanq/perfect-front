import { detectProject, DetectionError } from "@perfect-front/project-detector";
import { PerfectFrontError } from "@perfect-front/shared";
import type { ProcessController, ProcessInfo, ProcessTarget, StopOutcome } from "./controller";

/**
 * Implementación mínima sobre `@perfect-front/cli` (exporta `src/process`).
 * Se importa de forma perezosa para no cargar el CLI al arrancar el servidor
 * ni crear un ciclo de módulos si el CLI llega a depender de este paquete.
 *
 * Qué conviene extraer a un paquete compartido (p. ej. `@perfect-front/process`):
 * `ensureRunning`, `getStatus`, `stopManaged`, `readLogs`, `resolveSpawn` y el
 * estado `.perfect-front/run/`. Así el servidor no dependería del paquete del
 * ejecutable `comment`.
 */
type CliProcess = typeof import("@perfect-front/cli");

export interface CliControllerOptions {
  startTimeoutMs?: number;
  /** Inyectable para pruebas. */
  load?: () => Promise<CliProcess>;
}

export class CliProcessController implements ProcessController {
  private cli: Promise<CliProcess> | null = null;
  constructor(private readonly options: CliControllerOptions = {}) {}

  private mod(): Promise<CliProcess> {
    this.cli ??= (this.options.load ?? (() => import("@perfect-front/cli")))();
    return this.cli;
  }

  private plan(target: ProcessTarget) {
    try {
      const d = detectProject({
        cwd: target.root,
        overrides: {
          ...(target.url ? { url: target.url } : {}),
          ...(target.command ? { command: target.command } : {}),
        },
      });
      return { root: d.root, plan: { command: d.plan.command, args: d.plan.args, cwd: d.plan.cwd }, url: d.url };
    } catch (e) {
      if (e instanceof DetectionError) throw new PerfectFrontError("process_error", "No se pudo determinar cómo iniciar el proyecto");
      throw e;
    }
  }

  private static info(s: { state: string; managed: boolean; url: string | null; pid: number | null }): ProcessInfo {
    const state = s.state === "running" || s.state === "external" ? s.state : "stopped";
    return { state, managed: s.managed, url: s.url, pid: s.pid };
  }

  async status(target: ProcessTarget): Promise<ProcessInfo> {
    const cli = await this.mod();
    return CliProcessController.info(await cli.getStatus({ root: target.root, url: target.url }));
  }

  async start(target: ProcessTarget): Promise<ProcessInfo> {
    const cli = await this.mod();
    const opts = this.options.startTimeoutMs ? { startTimeoutMs: this.options.startTimeoutMs } : {};
    try {
      const r = await cli.ensureRunning(this.plan(target), opts);
      return CliProcessController.info(r.status);
    } catch (e) {
      if (e instanceof PerfectFrontError) throw e;
      throw new PerfectFrontError("process_error", "No se pudo iniciar el proceso");
    }
  }

  async stop(target: ProcessTarget): Promise<StopOutcome> {
    const cli = await this.mod();
    const r = await cli.stopManaged({ root: target.root, url: target.url });
    return r.outcome === "stopped" ? { outcome: "stopped", pid: r.pid } : { outcome: r.outcome };
  }

  async logs(target: ProcessTarget, lines: number): Promise<string[] | null> {
    const cli = await this.mod();
    return cli.readLogs(target.root, lines);
  }
}
