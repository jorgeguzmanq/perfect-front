import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { createCommentStorage, type CommentStorage } from "@perfect-front/comment-storage";
import { PerfectFrontError, ProjectIdSchema, type ProjectId } from "@perfect-front/shared";
import { readJsonIfExists, writeFileAtomic } from "./fs-util";

const RecordSchema = z
  .object({
    id: ProjectIdSchema,
    root: z.string().min(1).max(1024),
    name: z.string().min(1).max(120),
    url: z.string().max(2048).nullable(),
    /** URL original detrás del proxy (url = la del proxy). Ausente en registros anteriores. */
    targetUrl: z.string().max(2048).nullable().optional(),
    command: z.string().max(500).nullable(),
    framework: z.string().max(80).nullable(),
    registeredAt: z.string(),
  })
  .strict();
export type ProjectRecord = z.infer<typeof RecordSchema>;

const FileSchema = z.object({ version: z.literal(1), projects: z.array(z.unknown()) }).strict();

/** ID estable entre sesiones: hash de la raíz real (sin mayúsculas en Windows). */
export function projectIdFor(realRoot: string): ProjectId {
  const norm = process.platform === "win32" ? realRoot.toLowerCase() : realRoot;
  return ProjectIdSchema.parse(`p_${crypto.createHash("sha256").update(norm).digest("hex").slice(0, 16)}`);
}

/**
 * Registro interno projectId -> raíz. Es la única vía para convertir un id en una
 * ruta: ninguna petición de overlay aporta rutas. Se persiste en `stateDir` y se
 * reconstruye en el arranque; los comentarios viven siempre en el proyecto.
 */
export class ProjectRegistry {
  private readonly records = new Map<string, ProjectRecord>();
  private readonly storages = new Map<string, Promise<CommentStorage>>();
  private writeChain: Promise<void> = Promise.resolve();

  private constructor(private readonly file: string) {}

  static async load(stateDir: string): Promise<ProjectRegistry> {
    const reg = new ProjectRegistry(path.join(stateDir, "projects.json"));
    const raw = await readJsonIfExists(reg.file);
    const parsed = FileSchema.safeParse(raw);
    if (parsed.success) {
      for (const item of parsed.data.projects) {
        const r = RecordSchema.safeParse(item);
        if (!r.success) continue;
        // Descarta raíces que ya no existen.
        const stat = await fs.stat(r.data.root).catch(() => null);
        if (stat?.isDirectory()) reg.records.set(r.data.id, r.data);
      }
    }
    return reg;
  }

  list(): ProjectRecord[] {
    return [...this.records.values()].sort((a, b) => (a.registeredAt < b.registeredAt ? -1 : 1));
  }

  /** Resuelve un id contra el registro; desconocido o mal formado nunca toca el disco. */
  get(idInput: string): ProjectRecord {
    const parsed = ProjectIdSchema.safeParse(idInput);
    if (!parsed.success) throw new PerfectFrontError("invalid_id", "ProjectId inválido");
    const rec = this.records.get(parsed.data);
    if (!rec) throw new PerfectFrontError("not_found", "Proyecto no registrado");
    return rec;
  }

  has(id: string): boolean {
    return this.records.has(id);
  }

  async storage(idInput: string): Promise<CommentStorage> {
    const rec = this.get(idInput);
    let s = this.storages.get(rec.id);
    if (!s) {
      s = createCommentStorage(rec.root);
      this.storages.set(rec.id, s);
      s.catch(() => this.storages.delete(rec.id));
    }
    return s;
  }

  /** `created` indica si el id era nuevo. */
  async put(rec: ProjectRecord): Promise<{ created: boolean }> {
    const created = !this.records.has(rec.id);
    this.records.set(rec.id, rec);
    await this.persist();
    return { created };
  }

  /** Quita el proyecto del registro (no toca el disco del proyecto: los comentarios se conservan). */
  async remove(id: string): Promise<boolean> {
    if (!this.records.delete(id)) return false;
    this.storages.delete(id);
    await this.persist();
    return true;
  }

  private persist(): Promise<void> {
    const body = JSON.stringify({ version: 1, projects: this.list() }, null, 2) + "\n";
    const run = this.writeChain.then(() => writeFileAtomic(this.file, body));
    this.writeChain = run.catch(() => undefined);
    return run;
  }
}
