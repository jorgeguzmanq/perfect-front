import path from "node:path";
import {
  COMMENT_VERSION,
  CONFIG_VERSION,
  DEFAULT_COLLECTIONS,
  PerfectFrontError,
  generateCommentId,
  nowTimestamp,
  zodDetails,
  type CommentId,
} from "@perfect-front/shared";
import { renderMarkdown } from "./markdown";
import { STORAGE_LIMITS, parseCollectionName, parseCommentId } from "./paths";
import { FsRepository } from "./repository";
import {
  CreateCommentRequestSchema,
  ListCommentsQuerySchema,
  MoveCommentRequestSchema,
  ProjectConfigSchema,
  ResolveCommentRequestSchema,
  UpdateCommentRequestSchema,
  decodeScreenshot,
  migrateComment,
  migrateProjectConfig,
  type CollectionInfo,
  type CreateCommentRequest,
  type ListCommentsQuery,
  type ProjectConfig,
  type ResolveCommentRequest,
  type UpdateCommentRequest,
  type VisualComment,
} from "./schemas";

export interface CommentStorageOptions {
  /** Reloj inyectable (pruebas). */
  now?: () => Date;
}

export interface InitReport {
  createdConfig: boolean;
  createdCollections: string[];
}

/** Entrada ilegible: se reporta sin bloquear el listado. `file` es relativo a la colección. */
export interface CorruptEntry {
  collection: string;
  file: string;
  code: string;
  message: string;
}

export interface ListResult {
  comments: VisualComment[];
  errors: CorruptEntry[];
}

export type MoveResult =
  | { id: string; ok: true; comment: VisualComment }
  | { id: string; ok: false; error: { code: string; message: string } };

export interface GitignoreSuggestion {
  entry: string;
  exists: boolean;
  alreadyIgnored: boolean;
  /** Líneas a agregar a mano. Perfect Front nunca modifica .gitignore. */
  snippet: string | null;
}

const GITIGNORE_ENTRY = ".perfect-front/";
const IGNORE_FORMS = new Set([".perfect-front", ".perfect-front/", "/.perfect-front", "/.perfect-front/", ".perfect-front/*"]);

function parseWith<T>(schema: { safeParse(v: unknown): unknown }, input: unknown): T {
  const r = schema.safeParse(input) as { success: boolean; data?: T; error?: Parameters<typeof zodDetails>[0] };
  if (!r.success) throw new PerfectFrontError("invalid_request", "Datos inválidos", r.error ? zodDetails(r.error) : undefined);
  return r.data as T;
}

function errInfo(e: unknown): { code: string; message: string } {
  if (e instanceof PerfectFrontError) return { code: e.code, message: e.message };
  return { code: "storage_error", message: "Error de almacenamiento" };
}

export class CommentStorage {
  private readonly locks = new Map<string, Promise<unknown>>();
  private constructor(
    private readonly repo: FsRepository,
    private readonly clock: () => Date,
    readonly initReport: InitReport,
  ) {}

  /**
   * Inicializa `.perfect-front/` bajo `root` (sin sobrescribir configuración existente)
   * y devuelve el servicio. Es idempotente.
   */
  static async init(root: string, options: CommentStorageOptions = {}): Promise<CommentStorage> {
    const repo = await FsRepository.open(root);
    await repo.ensureLayout();

    let createdConfig = false;
    if (!(await repo.exists(repo.configFile))) {
      const name = (path.basename(repo.rootReal) || "project").slice(0, 120);
      const config: ProjectConfig = ProjectConfigSchema.parse({
        version: CONFIG_VERSION,
        name,
        defaultCollection: "inbox",
        resolvedCollection: "resolved",
      });
      try {
        await repo.writeJson(repo.configFile, config, migrateProjectConfig, {
          overwrite: false,
          maxBytes: STORAGE_LIMITS.configFile,
        });
        createdConfig = true;
      } catch (e) {
        // Otro proceso la creó entre medias: se respeta.
        if (!(e instanceof PerfectFrontError && e.code === "conflict")) throw e;
      }
    }
    // Una configuración existente pero inválida se reporta; nunca se reemplaza.
    const config = migrateProjectConfig(await repo.readJson(repo.configFile, STORAGE_LIMITS.configFile));

    const wanted = new Set<string>(DEFAULT_COLLECTIONS);
    if (config.defaultCollection) wanted.add(config.defaultCollection);
    if (config.resolvedCollection) wanted.add(config.resolvedCollection);
    const createdCollections: string[] = [];
    for (const c of wanted) if (await repo.ensureCollectionDir(c)) createdCollections.push(c);

    return new CommentStorage(repo, options.now ?? (() => new Date()), { createdConfig, createdCollections });
  }

  // --- Utilidades internas ---------------------------------------------------

  private ts(): string {
    return nowTimestamp(this.clock());
  }

  private async withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve();
    const run = prev.then(fn);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.locks.set(id, tail);
    try {
      return await run;
    } finally {
      if (this.locks.get(id) === tail) this.locks.delete(id);
    }
  }

  async getConfig(): Promise<ProjectConfig> {
    return migrateProjectConfig(await this.repo.readJson(this.repo.configFile, STORAGE_LIMITS.configFile));
  }

  private async requireCollection(name: string): Promise<string> {
    const c = parseCollectionName(name);
    if (!(await this.repo.collectionExists(c))) {
      throw new PerfectFrontError("not_found", "La colección no existe");
    }
    return c;
  }

  /** Lee por ID buscando en todas las colecciones; la carpeta manda sobre el campo `collection`. */
  private async load(idInput: string): Promise<VisualComment> {
    const id = parseCommentId(idInput);
    const found = await this.repo.locate(id, await this.repo.listCollectionNames());
    if (found.length === 0) throw new PerfectFrontError("not_found", "Comentario no encontrado");
    if (found.length > 1) {
      throw new PerfectFrontError("conflict", "ID duplicado en varias colecciones; resuélvelo manualmente");
    }
    const collection = found[0]!;
    const raw = await this.repo.readJson(this.repo.commentFile(collection, id), STORAGE_LIMITS.commentFile);
    const comment = migrateComment(raw);
    if (comment.id !== id) throw new PerfectFrontError("invalid_data", "El ID del documento no coincide con su archivo");
    return { ...comment, collection: parseCollectionName(collection) };
  }

  private save(doc: VisualComment): Promise<VisualComment> {
    return this.repo.writeJson(this.repo.commentFile(doc.collection, doc.id), doc, migrateComment, {
      overwrite: true,
      maxBytes: STORAGE_LIMITS.commentFile,
    });
  }

  /**
   * Persiste `doc`; si cambia de colección hace rename del archivo (una sola copia)
   * y luego reescribe el documento de forma atómica con la nueva colección.
   */
  private async commit(from: string, doc: VisualComment): Promise<VisualComment> {
    if (doc.collection === from) return this.save(doc);
    await this.repo.moveFile(this.repo.commentFile(from, doc.id), this.repo.commentFile(doc.collection, doc.id));
    try {
      return await this.save(doc);
    } catch (e) {
      // Deshacer el movimiento (mejor esfuerzo); el archivo sigue siendo válido por la carpeta.
      await this.repo
        .moveFile(this.repo.commentFile(doc.collection, doc.id), this.repo.commentFile(from, doc.id))
        .catch(() => undefined);
      throw e;
    }
  }

  private async mutate(
    id: string,
    fn: (current: VisualComment) => Promise<VisualComment> | VisualComment,
  ): Promise<VisualComment> {
    const cid = parseCommentId(id);
    return this.withLock(cid, async () => {
      const current = await this.load(cid);
      const next = await fn(current);
      return this.commit(current.collection, next);
    });
  }

  // --- Colecciones -----------------------------------------------------------

  async listCollections(): Promise<CollectionInfo[]> {
    const out: CollectionInfo[] = [];
    for (const name of await this.repo.listCollectionNames()) {
      const entries = await this.repo.listEntries(name);
      out.push({ name: parseCollectionName(name), count: entries.filter((e) => e.id !== null).length });
    }
    return out;
  }

  async createCollection(name: string): Promise<CollectionInfo> {
    const c = parseCollectionName(name);
    if (!(await this.repo.ensureCollectionDir(c))) {
      throw new PerfectFrontError("conflict", "La colección ya existe");
    }
    return { name: c, count: 0 };
  }

  // --- Comentarios -----------------------------------------------------------

  async createComment(input: CreateCommentRequest | unknown): Promise<VisualComment> {
    const req = parseWith<CreateCommentRequest>(CreateCommentRequestSchema, input);
    const config = await this.getConfig();
    const collection = await this.requireCollection(req.collection ?? config.defaultCollection ?? "inbox");
    const cols = await this.repo.listCollectionNames();

    let id: CommentId | null = null;
    for (let i = 0; i < 8 && id === null; i++) {
      const candidate = generateCommentId(this.clock().getTime());
      if ((await this.repo.locate(candidate, cols)).length === 0) id = candidate;
    }
    if (id === null) throw new PerfectFrontError("conflict", "No se pudo generar un ID único");

    const attachments: string[] = [];
    let attachmentFile: string | null = null;
    if (req.screenshot) {
      const { bytes, ext } = decodeScreenshot(req.screenshot.mimeType, req.screenshot.dataBase64, STORAGE_LIMITS.attachment);
      const name = `${id}.${ext}`;
      attachmentFile = this.repo.attachmentFile(name);
      await this.repo.writeBinaryExclusive(attachmentFile, bytes, STORAGE_LIMITS.attachment);
      attachments.push(`attachments/${name}`);
    }

    const ts = this.ts();
    const doc = {
      version: COMMENT_VERSION,
      id,
      status: "pending",
      collection,
      scope: req.scope,
      comment: req.comment,
      project: { name: (config.name ?? (path.basename(this.repo.rootReal) || "project")).slice(0, 120), relativeRoot: "." },
      location: req.location,
      viewport: req.viewport,
      elementRect: req.elementRect,
      environment: req.environment,
      attachments,
      createdAt: ts,
      updatedAt: ts,
      resolution: null,
    };
    try {
      return await this.repo.writeJson(this.repo.commentFile(collection, id), doc, migrateComment, {
        overwrite: false,
        maxBytes: STORAGE_LIMITS.commentFile,
      });
    } catch (e) {
      if (attachmentFile) await this.repo.remove(attachmentFile);
      throw e;
    }
  }

  /** Lee por ID sin confiar en la colección: la busca en todas. */
  async getComment(id: string): Promise<VisualComment> {
    return this.load(id);
  }

  /** Lista todas las colecciones (o una). Los archivos corruptos van en `errors`. */
  async listComments(query: ListCommentsQuery | unknown = {}): Promise<ListResult> {
    const q = parseWith<ListCommentsQuery>(ListCommentsQuerySchema, query);
    const collections = q.collection ? [await this.requireCollection(q.collection)] : await this.repo.listCollectionNames();
    const comments: VisualComment[] = [];
    const errors: CorruptEntry[] = [];
    const seen = new Set<string>();
    for (const collection of collections) {
      for (const entry of await this.repo.listEntries(collection)) {
        const fail = (code: string, message: string) => errors.push({ collection, file: entry.file, code, message });
        if (entry.id === null) {
          fail("invalid_id", "Nombre de archivo no es un ID válido");
          continue;
        }
        try {
          const raw = await this.repo.readJson(this.repo.commentFile(collection, entry.id), STORAGE_LIMITS.commentFile);
          const c = migrateComment(raw);
          if (c.id !== entry.id) throw new PerfectFrontError("invalid_data", "El ID del documento no coincide con su archivo");
          if (seen.has(c.id)) throw new PerfectFrontError("conflict", "ID duplicado en otra colección");
          seen.add(c.id);
          comments.push({ ...c, collection: parseCollectionName(collection) });
        } catch (e) {
          const info = errInfo(e);
          fail(info.code, info.message);
        }
      }
    }
    const needle = q.q?.toLowerCase();
    const filtered = comments.filter((c) => {
      if (q.status && c.status !== q.status) return false;
      if (!needle) return true;
      return [c.id, c.comment, c.location.route, c.location.url].some((s) => s.toLowerCase().includes(needle));
    });
    filtered.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return { comments: filtered, errors };
  }

  async updateComment(id: string, patch: UpdateCommentRequest | unknown): Promise<VisualComment> {
    const p = parseWith<UpdateCommentRequest>(UpdateCommentRequestSchema, patch);
    return this.mutate(id, (c) => {
      const next: VisualComment = { ...c, updatedAt: this.ts() };
      if (p.comment !== undefined) next.comment = p.comment;
      if (p.status !== undefined) {
        next.status = p.status;
        if (p.status !== "resolved" && p.status !== "archived") next.resolution = null;
      }
      return next;
    });
  }

  async moveComment(id: string, to: string): Promise<VisualComment> {
    const { to: target } = parseWith<{ to: string }>(MoveCommentRequestSchema, { to });
    const cid = parseCommentId(id);
    return this.withLock(cid, async () => {
      const current = await this.load(cid);
      if (current.collection === target) return current;
      await this.requireCollection(target);
      return this.commit(current.collection, {
        ...current,
        collection: parseCollectionName(target),
        updatedAt: this.ts(),
      });
    });
  }

  /** Movimiento por lote: cada ID se procesa por separado y un fallo no detiene el resto. */
  async moveComments(ids: readonly string[], to: string): Promise<MoveResult[]> {
    parseCollectionName(to);
    const out: MoveResult[] = [];
    for (const id of ids) {
      try {
        out.push({ id, ok: true, comment: await this.moveComment(id, to) });
      } catch (e) {
        out.push({ id, ok: false, error: errInfo(e) });
      }
    }
    return out;
  }

  /** Marca resuelto, registra la resolución y mueve a `resolvedCollection` (por defecto `resolved`). */
  async resolveComment(id: string, input: ResolveCommentRequest | unknown): Promise<VisualComment> {
    const req = parseWith<ResolveCommentRequest>(ResolveCommentRequestSchema, input);
    const cid = parseCommentId(id);
    return this.withLock(cid, async () => {
      const current = await this.load(cid);
      const config = await this.getConfig();
      const target = parseCollectionName(config.resolvedCollection ?? "resolved");
      await this.repo.ensureCollectionDir(target);
      const ts = this.ts();
      return this.commit(current.collection, {
        ...current,
        collection: target,
        status: "resolved",
        updatedAt: ts,
        resolution: {
          resolvedAt: ts,
          resolvedBy: req.resolvedBy ?? null,
          summary: req.summary,
          filesChanged: req.filesChanged ?? [],
          verification: req.verification ?? [],
          commit: req.commit ?? null,
        },
      });
    });
  }

  /** Ignorar: cambia el estado sin mover el archivo. */
  async ignoreComment(id: string): Promise<VisualComment> {
    return this.mutate(id, (c) => ({ ...c, status: "ignored", resolution: null, updatedAt: this.ts() }));
  }

  /** Archivar: estado `archived` y movimiento a la colección `archived`; conserva la resolución. */
  async archiveComment(id: string): Promise<VisualComment> {
    const cid = parseCommentId(id);
    return this.withLock(cid, async () => {
      const current = await this.load(cid);
      await this.repo.ensureCollectionDir("archived");
      return this.commit(current.collection, {
        ...current,
        collection: parseCollectionName("archived"),
        status: "archived",
        updatedAt: this.ts(),
      });
    });
  }

  /** Reabrir: vuelve a `pending`, limpia la resolución y, si estaba en resolved/archived, regresa a la colección por defecto. */
  async reopenComment(id: string): Promise<VisualComment> {
    const cid = parseCommentId(id);
    return this.withLock(cid, async () => {
      const current = await this.load(cid);
      const config = await this.getConfig();
      const resolvedName = config.resolvedCollection ?? "resolved";
      let collection = current.collection as string;
      if (collection === resolvedName || collection === "archived") {
        collection = config.defaultCollection ?? "inbox";
        await this.repo.ensureCollectionDir(collection);
      }
      return this.commit(current.collection, {
        ...current,
        collection: parseCollectionName(collection),
        status: "pending",
        resolution: null,
        updatedAt: this.ts(),
      });
    });
  }

  // --- Exportación (solo lectura sobre los comentarios) ---------------------

  /** Genera Markdown en memoria; no modifica ningún comentario. */
  async exportMarkdown(query: ListCommentsQuery | unknown = {}): Promise<{ markdown: string; count: number; errors: CorruptEntry[] }> {
    const { comments, errors } = await this.listComments(query);
    const q = query as { collection?: string };
    const markdown = renderMarkdown(comments, {
      generatedAt: this.ts(),
      ...(q.collection ? { collection: q.collection } : {}),
    });
    return { markdown, count: comments.length, errors };
  }

  /** Escribe el reporte en `.perfect-front/exports/comments-YYYY-MM-DD[-colección].md` (sobrescribe el reporte del mismo día). */
  async writeMarkdownExport(query: ListCommentsQuery | unknown = {}): Promise<{ file: string; count: number; errors: CorruptEntry[] }> {
    const { markdown, count, errors } = await this.exportMarkdown(query);
    const collection = (query as { collection?: string }).collection;
    const day = this.ts().slice(0, 10);
    const file = `comments-${day}${collection ? `-${parseCollectionName(collection)}` : ""}.md`;
    await this.repo.ensureExportsDir();
    await this.repo.writeText(this.repo.exportFile(file), markdown, { overwrite: true, maxBytes: STORAGE_LIMITS.export });
    return { file: `exports/${file}`, count, errors };
  }

  // --- .gitignore (solo sugerencia) -----------------------------------------

  async suggestGitignore(): Promise<GitignoreSuggestion> {
    const text = await this.repo.readRootText(".gitignore", STORAGE_LIMITS.gitignore);
    if (text === null) {
      return { entry: GITIGNORE_ENTRY, exists: false, alreadyIgnored: false, snippet: GITIGNORE_ENTRY + "\n" };
    }
    const lines = text.split(/\r?\n/).map((l) => l.trim());
    // Gana la última regla que coincide; una negación posterior desactiva el ignorado.
    let ignored = false;
    for (const l of lines) {
      if (IGNORE_FORMS.has(l)) ignored = true;
      else if (l.startsWith("!") && IGNORE_FORMS.has(l.slice(1))) ignored = false;
    }
    return { entry: GITIGNORE_ENTRY, exists: true, alreadyIgnored: ignored, snippet: ignored ? null : GITIGNORE_ENTRY + "\n" };
  }
}

export function createCommentStorage(root: string, options: CommentStorageOptions = {}): Promise<CommentStorage> {
  return CommentStorage.init(root, options);
}
