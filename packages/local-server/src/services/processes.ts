import { PerfectFrontError, nowTimestamp, type ProjectSummary } from "@perfect-front/shared";
import { LIMITS } from "../config";
import type { EventBus } from "../events";
import type { ProcessController, ProcessInfo } from "../process/controller";
import { redact } from "../security";
import type { ProjectsService } from "./projects";

export type StartOutcome = "started" | "connected";

export class ProcessesService {
  private readonly starting = new Set<string>();
  constructor(
    private readonly projects: ProjectsService,
    private readonly controller: ProcessController,
    private readonly bus: EventBus,
    private readonly secrets: () => string[],
  ) {}

  private emit(projectId: ProjectSummary["id"], info: ProcessInfo, project: ProjectSummary): void {
    const at = nowTimestamp();
    this.bus.publish({
      type: "process.state",
      at,
      projectId,
      state: info.state,
      pid: info.pid && info.pid > 0 ? info.pid : null,
      url: info.url,
    });
    this.bus.publish({ type: "project.updated", at, projectId, project });
  }

  async start(id: string): Promise<{ project: ProjectSummary; outcome: StartOutcome }> {
    const rec = this.projects.get(id);
    if (this.starting.has(rec.id)) throw new PerfectFrontError("conflict", "El proyecto ya se está iniciando");
    this.starting.add(rec.id);
    try {
      const before = await this.controller.status(this.projects.target(rec)).catch(() => null);
      this.bus.publish({
        type: "process.state",
        at: nowTimestamp(),
        projectId: rec.id,
        state: "starting",
        pid: null,
        url: rec.url,
      });
      let info: ProcessInfo;
      try {
        info = await this.controller.start(this.projects.target(rec));
      } catch (e) {
        const failed: ProcessInfo = { state: "failed", managed: false, url: rec.url, pid: null };
        this.emit(rec.id, failed, await this.projects.summary(rec, failed));
        if (e instanceof PerfectFrontError) throw new PerfectFrontError("process_error", redact(e.message, this.secrets()));
        throw new PerfectFrontError("process_error", "No se pudo iniciar el proceso");
      }
      const project = await this.projects.summary(rec, info);
      this.emit(rec.id, info, project);
      return { project, outcome: before && before.state !== "stopped" ? "connected" : "started" };
    } finally {
      this.starting.delete(rec.id);
    }
  }

  async stop(id: string): Promise<{ project: ProjectSummary; outcome: "stopped" | "external" | "none" }> {
    const rec = this.projects.get(id);
    let result;
    try {
      result = await this.controller.stop(this.projects.target(rec));
    } catch {
      throw new PerfectFrontError("process_error", "No se pudo detener el proceso");
    }
    const info = await this.controller
      .status(this.projects.target(rec))
      .catch((): ProcessInfo => ({ state: "stopped", managed: false, url: rec.url, pid: null }));
    const project = await this.projects.summary(rec, info);
    if (result.outcome === "stopped") this.emit(rec.id, info, project);
    return { project, outcome: result.outcome };
  }

  async logs(id: string, lines: number = LIMITS.defaultLogLines): Promise<string[]> {
    const rec = this.projects.get(id);
    const n = Math.min(Math.max(1, Math.floor(lines)), LIMITS.maxLogLines);
    const raw = await this.controller.logs(this.projects.target(rec), n).catch(() => null);
    return (raw ?? []).slice(-n).map((l) => redact(l, this.secrets()).slice(0, 2000));
  }
}
