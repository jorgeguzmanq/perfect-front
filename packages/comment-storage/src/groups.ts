import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  CreateGroupRequestSchema,
  GroupIdSchema,
  PerfectFrontError,
  ReadingGroupSchema,
  UpdateGroupRequestSchema,
  nowTimestamp,
  zodDetails,
  type ReadingGroup,
} from "@perfect-front/shared";
import { STORAGE_LIMITS } from "./paths";
import { FsRepository } from "./repository";

const GROUPS_VERSION = 1;
const MAX_GROUPS = 500;

const GroupsFileSchema = z
  .object({ version: z.literal(GROUPS_VERSION), groups: z.array(ReadingGroupSchema).max(MAX_GROUPS) })
  .strict();

function parseWith<T>(schema: { safeParse(v: unknown): unknown }, input: unknown): T {
  const r = schema.safeParse(input) as { success: boolean; data?: T; error?: Parameters<typeof zodDetails>[0] };
  if (!r.success) throw new PerfectFrontError("invalid_request", "Datos inválidos", r.error ? zodDetails(r.error) : undefined);
  return r.data as T;
}

/**
 * Grupos de lectura en `.perfect-front/groups.json` (escritura atómica, serializada por proceso).
 * Solo guarda nombre/nota; la pertenencia y el orden viven en `comment.group`.
 */
export class GroupStorage {
  private tail: Promise<unknown> = Promise.resolve();
  private constructor(
    private readonly repo: FsRepository,
    private readonly clock: () => Date,
  ) {}

  static async open(root: string, options: { now?: () => Date } = {}): Promise<GroupStorage> {
    const repo = await FsRepository.open(root);
    await repo.ensureLayout();
    return new GroupStorage(repo, options.now ?? (() => new Date()));
  }

  private lock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async load(): Promise<ReadingGroup[]> {
    const file = this.repo.groupsFile;
    if (!(await this.repo.exists(file))) return [];
    const raw = await this.repo.readJson(file, STORAGE_LIMITS.groupsFile);
    const r = GroupsFileSchema.safeParse(raw);
    if (!r.success) throw new PerfectFrontError("invalid_data", "groups.json inválido", zodDetails(r.error));
    return r.data.groups;
  }

  private async save(groups: ReadingGroup[]): Promise<void> {
    await this.repo.writeJson(
      this.repo.groupsFile,
      { version: GROUPS_VERSION, groups },
      (v) => GroupsFileSchema.parse(v),
      { overwrite: true, maxBytes: STORAGE_LIMITS.groupsFile },
    );
  }

  private ts(): string {
    return nowTimestamp(this.clock());
  }

  private static parseId(id: unknown): string {
    const r = GroupIdSchema.safeParse(id);
    if (!r.success) throw new PerfectFrontError("invalid_id", "ID de grupo inválido");
    return r.data;
  }

  list(): Promise<ReadingGroup[]> {
    return this.lock(() => this.load());
  }

  get(id: string): Promise<ReadingGroup> {
    const gid = GroupStorage.parseId(id);
    return this.lock(async () => {
      const g = (await this.load()).find((x) => x.id === gid);
      if (!g) throw new PerfectFrontError("not_found", "Grupo no encontrado");
      return g;
    });
  }

  create(input: unknown): Promise<ReadingGroup> {
    const body = parseWith<z.infer<typeof CreateGroupRequestSchema>>(CreateGroupRequestSchema, input);
    return this.lock(async () => {
      const groups = await this.load();
      if (groups.length >= MAX_GROUPS) throw new PerfectFrontError("invalid_request", "Demasiados grupos");
      const id = body.id ?? GroupIdSchema.parse(`g-${randomUUID().replace(/-/g, "").slice(0, 12)}`);
      if (groups.some((g) => g.id === id)) throw new PerfectFrontError("conflict", "El grupo ya existe");
      const now = this.ts();
      const group: ReadingGroup = ReadingGroupSchema.parse({
        id,
        name: body.name,
        note: body.note,
        readFirst: body.readFirst,
        createdAt: now,
        updatedAt: now,
      });
      await this.save([...groups, group]);
      return group;
    });
  }

  update(id: string, patch: unknown): Promise<ReadingGroup> {
    const gid = GroupStorage.parseId(id);
    const p = parseWith<z.infer<typeof UpdateGroupRequestSchema>>(UpdateGroupRequestSchema, patch);
    return this.lock(async () => {
      const groups = await this.load();
      const i = groups.findIndex((g) => g.id === gid);
      if (i < 0) throw new PerfectFrontError("not_found", "Grupo no encontrado");
      const next: ReadingGroup = ReadingGroupSchema.parse({ ...groups[i]!, ...p, updatedAt: this.ts() });
      groups[i] = next;
      await this.save(groups);
      return next;
    });
  }

  /** Quita el grupo. Devuelve false si no existía. Los comentarios deben desvincularse aparte. */
  delete(id: string): Promise<boolean> {
    const gid = GroupStorage.parseId(id);
    return this.lock(async () => {
      const groups = await this.load();
      const rest = groups.filter((g) => g.id !== gid);
      if (rest.length === groups.length) return false;
      await this.save(rest);
      return true;
    });
  }

  /** Sella `updatedAt` (p. ej. tras reordenar la cola). */
  touch(id: string): Promise<ReadingGroup> {
    const gid = GroupStorage.parseId(id);
    return this.lock(async () => {
      const groups = await this.load();
      const i = groups.findIndex((g) => g.id === gid);
      if (i < 0) throw new PerfectFrontError("not_found", "Grupo no encontrado");
      const next = { ...groups[i]!, updatedAt: this.ts() };
      groups[i] = next;
      await this.save(groups);
      return next;
    });
  }
}
