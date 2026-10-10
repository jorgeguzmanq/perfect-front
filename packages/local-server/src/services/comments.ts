import fs from "node:fs/promises";
import path from "node:path";
import { PF_DIR, STORAGE_LIMITS, isInside, type CommentStorage, type CorruptEntry, type MoveResult } from "@perfect-front/comment-storage";
import {
  CollectionNameSchema,
  PerfectFrontError,
  nowTimestamp,
  type CollectionInfo,
  type VisualComment,
} from "@perfect-front/shared";
import type { EventBus } from "../events";
import type { ProjectRegistry } from "../registry";

/**
 * Lógica de comentarios sobre `CommentStorage`. Cada evento se publica solo
 * después de que la escritura terminó (el `await` del storage ya resolvió).
 */
export class CommentsService {
  constructor(
    private readonly registry: ProjectRegistry,
    private readonly bus: EventBus,
  ) {}

  private storage(projectId: string): Promise<CommentStorage> {
    return this.registry.storage(projectId);
  }

  private pid(projectId: string) {
    return this.registry.get(projectId).id;
  }

  async list(projectId: string, query: unknown): Promise<VisualComment[]> {
    return (await (await this.storage(projectId)).listComments(query)).comments;
  }

  /** Como `list`, pero informa también de las entradas ilegibles (JSON corrupto) sin bloquear el listado. */
  async listDetailed(projectId: string, query: unknown): Promise<{ comments: VisualComment[]; corrupt: CorruptEntry[] }> {
    const r = await (await this.storage(projectId)).listComments(query);
    return { comments: r.comments, corrupt: r.errors };
  }

  async get(projectId: string, id: string): Promise<VisualComment> {
    return (await this.storage(projectId)).getComment(id);
  }

  async create(projectId: string, input: unknown): Promise<VisualComment> {
    const comment = await (await this.storage(projectId)).createComment(input);
    this.bus.publish({ type: "comment.created", at: nowTimestamp(), projectId: this.pid(projectId), comment });
    return comment;
  }

  /**
   * `expectedUpdatedAt` (cabecera `X-PF-Expected-Updated-At`): control de conflictos optimista.
   * Si el comentario cambió desde que el cliente lo leyó, lanza `conflict` sin escribir.
   */
  async update(projectId: string, id: string, patch: unknown, expectedUpdatedAt?: string): Promise<VisualComment> {
    if (expectedUpdatedAt !== undefined) {
      const current = await (await this.storage(projectId)).getComment(id);
      if (current.updatedAt !== expectedUpdatedAt) {
        throw new PerfectFrontError("conflict", "El comentario cambió desde que lo abriste; recárgalo");
      }
    }
    const comment = await (await this.storage(projectId)).updateComment(id, patch);
    this.bus.publish({ type: "comment.updated", at: nowTimestamp(), projectId: this.pid(projectId), comment });
    return comment;
  }

  async move(projectId: string, id: string, to: string): Promise<VisualComment> {
    const s = await this.storage(projectId);
    const before = await s.getComment(id);
    const comment = await s.moveComment(id, to);
    if (before.collection !== comment.collection) this.publishMoved(projectId, before.collection, comment);
    return comment;
  }

  async moveMany(projectId: string, ids: string[], to: string): Promise<MoveResult[]> {
    const s = await this.storage(projectId);
    const froms = new Map<string, string>();
    for (const id of ids) {
      try {
        froms.set(id, (await s.getComment(id)).collection);
      } catch {
        /* se reporta en el resultado del movimiento */
      }
    }
    const results = await s.moveComments(ids, to);
    for (const r of results) {
      const from = froms.get(r.id);
      if (r.ok && from && from !== r.comment.collection) this.publishMoved(projectId, from, r.comment);
    }
    return results;
  }

  private publishMoved(projectId: string, from: string, comment: VisualComment): void {
    this.bus.publish({
      type: "comment.moved",
      at: nowTimestamp(),
      projectId: this.pid(projectId),
      commentId: comment.id,
      from: CollectionNameSchema.parse(from),
      to: comment.collection,
      comment,
    });
  }

  async resolve(projectId: string, id: string, input: unknown): Promise<VisualComment> {
    const comment = await (await this.storage(projectId)).resolveComment(id, input);
    this.bus.publish({ type: "comment.resolved", at: nowTimestamp(), projectId: this.pid(projectId), comment });
    return comment;
  }

  async reopen(projectId: string, id: string): Promise<VisualComment> {
    const s = await this.storage(projectId);
    const before = await s.getComment(id);
    const comment = await s.reopenComment(id);
    if (before.collection !== comment.collection) this.publishMoved(projectId, before.collection, comment);
    else this.bus.publish({ type: "comment.updated", at: nowTimestamp(), projectId: this.pid(projectId), comment });
    return comment;
  }

  async listCollections(projectId: string): Promise<CollectionInfo[]> {
    return (await this.storage(projectId)).listCollections();
  }

  async createCollection(projectId: string, name: string): Promise<CollectionInfo> {
    const info = await (await this.storage(projectId)).createCollection(name);
    this.bus.publish({ type: "collection.created", at: nowTimestamp(), projectId: this.pid(projectId), collection: info.name });
    return info;
  }

  /**
   * Bytes de un adjunto del comentario. Solo se sirven archivos que el propio comentario declara en
   * `attachments`, con extensión de imagen permitida y firma binaria coherente (el MIME sale de la
   * firma, no del cliente). Nunca se interpreta una ruta del cliente: `file` es un nombre plano.
   */
  async readAttachment(projectId: string, id: string, file: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
    const rec = this.registry.get(projectId);
    const comment = await this.get(projectId, id);
    const rel = `attachments/${file}`;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(file) || file.includes("..") || !comment.attachments.some((a) => a === rel)) {
      throw new PerfectFrontError("not_found", "Adjunto no encontrado");
    }
    const ext = path.extname(file).toLowerCase();
    const expected = ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : null;
    if (!expected) throw new PerfectFrontError("not_found", "Tipo de adjunto no admitido");
    const base = path.join(rec.root, PF_DIR, "attachments");
    try {
      const real = await fs.realpath(path.join(base, file));
      if (!isInside(await fs.realpath(base), real)) throw new Error("fuera");
      const stat = await fs.stat(real);
      if (!stat.isFile() || stat.size > STORAGE_LIMITS.attachment) throw new Error("tamaño");
      const bytes = await fs.readFile(real);
      if (sniffImage(bytes) !== expected) throw new PerfectFrontError("invalid_data", "El adjunto no es una imagen válida");
      return { bytes, mimeType: expected };
    } catch (e) {
      if (e instanceof PerfectFrontError) throw e;
      throw new PerfectFrontError("not_found", "Adjunto no encontrado");
    }
  }
}

function sniffImage(b: Uint8Array): string | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}
