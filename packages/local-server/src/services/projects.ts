import fs from "node:fs/promises";
import path from "node:path";
import { createCommentStorage } from "@perfect-front/comment-storage";
import { detectProject } from "@perfect-front/project-detector";
import {
  PerfectFrontError,
  RegisterProjectRequestSchema,
  nowTimestamp,
  type ProjectSummary,
  type RegisterProjectRequest,
} from "@perfect-front/shared";
import type { EventBus } from "../events";
import type { ProcessController, ProcessInfo, ProcessTarget } from "../process/controller";
import { projectIdFor, type ProjectRecord, type ProjectRegistry } from "../registry";

export class ProjectsService {
  constructor(
    private readonly registry: ProjectRegistry,
    private readonly bus: EventBus,
    private readonly processes: ProcessController,
  ) {}

  target(rec: ProjectRecord): ProcessTarget {
    // Con proxy, el proceso real vive en la URL original (la del registro es la del proxy).
    return { root: rec.root, url: rec.targetUrl ?? rec.url, command: rec.command };
  }

  async summary(rec: ProjectRecord, info?: ProcessInfo): Promise<ProjectSummary> {
    const proc: ProcessInfo | null = info ?? (await this.processes.status(this.target(rec)).catch(() => null));
    // Proyecto ilegible: se lista igual, sin contador.
    const pendingCount = await this.registry
      .storage(rec.id)
      .then(async (s) => (await s.listComments({ status: "pending" })).comments.length)
      .catch(() => 0);
    // Con proxy, `url` es la del proxy (la que se abre) y el proceso reporta la original.
    const proxied = typeof rec.targetUrl === "string";
    return {
      id: rec.id,
      name: rec.name,
      url: proxied ? rec.url : (proc?.url ?? rec.url),
      ...(proxied ? { targetUrl: rec.targetUrl } : {}),
      framework: rec.framework,
      processState: proc?.state ?? "stopped",
      managed: proc?.managed ?? false,
      pendingCount,
    };
  }

  async list(): Promise<ProjectSummary[]> {
    return Promise.all(this.registry.list().map((r) => this.summary(r)));
  }

  get(id: string): ProjectRecord {
    return this.registry.get(id);
  }

  /** Solo el CLI llega aquí (DELETE). Idempotente: devuelve false si ya no estaba. */
  async unregister(idInput: string): Promise<boolean> {
    const rec = this.registry.get(idInput);
    const removed = await this.registry.remove(rec.id);
    if (removed) this.bus.publish({ type: "project.removed", at: nowTimestamp(), projectId: rec.id });
    return removed;
  }

  /** Solo el CLI llega aquí (ruta protegida). Resuelve la raíz real y la valida. */
  async register(input: unknown): Promise<ProjectSummary> {
    const req: RegisterProjectRequest = RegisterProjectRequestSchema.parse(input);
    if (!path.isAbsolute(req.root)) throw new PerfectFrontError("invalid_request", "root debe ser una ruta absoluta");
    let real: string;
    try {
      real = await fs.realpath(req.root);
      if (!(await fs.stat(real)).isDirectory()) throw new Error("not a directory");
    } catch {
      throw new PerfectFrontError("not_found", "La raíz no existe o no es una carpeta");
    }
    const id = projectIdFor(real);
    const previous = this.registry.has(id) ? this.registry.get(id) : null;

    // Crea/valida `.perfect-front/` (idempotente) antes de aceptar el registro.
    const config = await (await createCommentStorage(real)).getConfig();

    const detected = ((): { url: string; framework: string | null } | null => {
      try {
        const d = detectProject({ cwd: real });
        return {
          url: d.url,
          framework: d.framework ? (d.framework.ui ? `${d.framework.bundler}-${d.framework.ui}` : d.framework.bundler) : null,
        };
      } catch {
        return null;
      }
    })();

    const url = req.url ?? req.config?.url ?? config.url ?? detected?.url ?? previous?.url ?? null;
    const targetUrl = req.targetUrl ?? (url !== null && url === previous?.url ? (previous.targetUrl ?? null) : null);
    const rec: ProjectRecord = {
      id,
      root: real,
      name: (req.config?.name ?? config.name ?? (path.basename(real) || "project")).slice(0, 120),
      url,
      targetUrl,
      command: req.config?.command ?? config.command ?? previous?.command ?? null,
      framework: detected?.framework ?? previous?.framework ?? null,
      registeredAt: previous?.registeredAt ?? nowTimestamp(),
    };
    const { created } = await this.registry.put(rec);
    const project = await this.summary(rec);
    // Evento solo tras persistir el registro.
    this.bus.publish({
      type: created ? "project.registered" : "project.updated",
      at: nowTimestamp(),
      projectId: rec.id,
      project,
    });
    return project;
  }
}
